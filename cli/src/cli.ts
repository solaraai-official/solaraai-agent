// The entry point's logic: read the arguments and the environment, run one command, and turn any
// refusal into its message, its next step and its exit code.

import { parseArgs } from 'node:util';
import { version } from '../package.json' with { type: 'json' };
import { Client, DEFAULT_API_URL, type Sleep } from './client';
import {
  type Context,
  downloadCommand,
  exportCommand,
  startCommand,
  statusCommand,
  stylesCommand,
  uploadCommand,
  usageCommand,
  waitCommand,
} from './commands';
import { EXIT_OK, EXIT_USAGE, SolaraError } from './errors';
import { createTransport, LIMITS, type Limits } from './http';
import { loginCommand } from './login';
import { type CommandSpec, commandHelp, commandSpec, mainHelp, type OptionSpec } from './spec';
import type { WaitUntil } from './video';

export const VERSION: string = version;

export interface Io {
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  sleep?: Sleep;
  limits?: Limits;
}

/** How this run was started, so every command it prints can be pasted: through npx (`npm exec`),
 * or the installed `solara`. */
export function invokedAs(env: NodeJS.ProcessEnv): string {
  return env.npm_command === 'exec' ? 'npx -y solaraai' : 'solara';
}

type Values = Record<string, string | number | undefined>;

interface Parsed {
  args: string[];
  values: Values;
  json: boolean;
  help: boolean;
}

function usageError(message: string, spec: CommandSpec | null, cli: string): SolaraError {
  const help = spec ? `${cli} ${spec.name} --help` : `${cli} --help`;
  return new SolaraError(message, `Run \`${help}\` to see what it takes.`, { exitCode: EXIT_USAGE });
}

function convert(option: OptionSpec, raw: string, spec: CommandSpec, cli: string): string | number {
  if (option.choices && !option.choices.includes(raw)) {
    throw usageError(`--${option.name} must be one of ${option.choices.join(', ')} (got ${raw})`, spec, cli);
  }
  if (option.kind === 'string') return raw;
  const value = Number(raw.trim());
  if (option.kind === 'int' && !/^-?\d+$/.test(raw.trim())) {
    throw usageError(`--${option.name} must be a whole number (got ${raw})`, spec, cli);
  }
  if (raw.trim() === '' || !Number.isFinite(value)) {
    throw usageError(`--${option.name} must be a number (got ${raw})`, spec, cli);
  }
  return value;
}

function parse(spec: CommandSpec, argv: string[], cli: string): Parsed {
  const options: Record<string, { type: 'string' | 'boolean'; short?: string }> = {
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  };
  for (const option of spec.options) options[option.name] = { type: 'string' };
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error), spec, cli);
  }
  const help = parsed.values.help === true;
  if (help) return { args: [], values: {}, json: false, help };
  const args = parsed.positionals;
  if (args.length !== spec.args.length) {
    const wanted = spec.args.map((arg) => `<${arg.name}>`).join(' ') || 'no arguments';
    throw usageError(`${spec.name} takes ${wanted}; got ${args.length ? args.join(' ') : 'none'}`, spec, cli);
  }
  return { args, values: optionValues(spec, parsed.values, cli), json: parsed.values.json === true, help };
}

function optionValues(spec: CommandSpec, given: Record<string, unknown>, cli: string): Values {
  const values: Values = {};
  for (const option of spec.options) {
    const raw = given[option.name];
    if (typeof raw === 'string') values[option.name] = convert(option, raw, spec, cli);
    else if (option.default !== undefined) values[option.name] = convert(option, option.default, spec, cli);
    else if (option.required) throw usageError(`--${option.name} is required`, spec, cli);
  }
  return values;
}

function str(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

function num(values: Values, name: string): number | undefined {
  const value = values[name];
  return typeof value === 'number' ? value : undefined;
}

async function runCommand(spec: CommandSpec, ctx: Context, parsed: Parsed): Promise<number> {
  const { args, values } = parsed;
  const first = args[0] ?? '';
  switch (spec.name) {
    case 'styles':
      return stylesCommand(ctx);
    case 'upload':
      return uploadCommand(ctx, first);
    case 'start':
      return startCommand(ctx, {
        upload: str(values, 'upload') ?? '',
        durationMs: num(values, 'duration-ms'),
        file: str(values, 'file'),
        style: str(values, 'style') ?? '',
        title: str(values, 'title'),
        prompt: str(values, 'prompt'),
        captionStyle: str(values, 'caption-style'),
        intensity: str(values, 'intensity'),
        pauseMs: num(values, 'pause-ms'),
        speed: num(values, 'speed'),
        aspect: str(values, 'aspect'),
        idempotencyKey: str(values, 'idempotency-key'),
      });
    case 'status':
      return statusCommand(ctx, first);
    case 'wait':
      return waitCommand(ctx, first, (str(values, 'until') ?? 'edit') as WaitUntil, num(values, 'timeout') ?? 1800);
    case 'export':
      return exportCommand(ctx, first, num(values, 'rev'), str(values, 'idempotency-key'));
    case 'download':
      return downloadCommand(ctx, first, str(values, 'out'));
    case 'usage':
      return usageCommand(ctx);
    case 'login':
      throw new Error('login runs without a context');
  }
}

function printRefusal(refused: SolaraError, json: boolean, io: Io): void {
  const label = refused.code ? ` (${refused.code})` : '';
  io.stderr(`solara: ${refused.message}${label}\n`);
  if (refused.retryAfter) io.stderr(`retry after: ${refused.retryAfter.toFixed(0)} seconds\n`);
  if (refused.nextStep) io.stderr(`next: ${refused.nextStep}\n`);
  if (json && refused.body !== undefined) io.stdout(`${JSON.stringify(refused.body, null, 2)}\n`);
}

/** `--version`, `--help`, `help <command>` or nothing at all: answered without a command. */
function answerWithoutCommand(argv: string[], cli: string, say: (line: string) => void): number | null {
  const [name, asked] = argv;
  if (name === undefined) {
    say(mainHelp(cli, VERSION));
    return EXIT_USAGE;
  }
  if (name === '--version' || name === '-V' || name === 'version') {
    say(`solaraai ${VERSION}`);
    return EXIT_OK;
  }
  if (name === '--help' || name === '-h' || name === 'help') {
    const spec = asked ? commandSpec(asked) : undefined;
    say(spec ? commandHelp(spec, cli) : mainHelp(cli, VERSION));
    return EXIT_OK;
  }
  return null;
}

/** The API with the environment's key; null when SOLARA_API_KEY isn't a Solara key. */
function clientFor(io: Io, cli: string): Client | null {
  const apiUrl = io.env.SOLARA_API_URL || DEFAULT_API_URL;
  if (!/^https?:\/\/[^/]/.test(apiUrl)) {
    throw new SolaraError(`SOLARA_API_URL isn't an http(s) URL: ${apiUrl}`, 'Fix or unset SOLARA_API_URL.', {
      exitCode: EXIT_USAGE,
    });
  }
  const apiKey = io.env.SOLARA_API_KEY?.trim() ?? '';
  if (!apiKey.startsWith('sol_')) return null;
  return new Client({
    apiKey,
    apiUrl,
    transport: createTransport(io.env, io.limits ?? LIMITS),
    sleep: io.sleep ?? ((seconds) => new Promise((done) => setTimeout(done, seconds * 1000))),
    log: (line) => io.stderr(`${line}\n`),
    userAgent: `solaraai-cli/${VERSION} (node ${process.versions.node})`,
    cli,
  });
}

/** Runs one command line; returns its exit code. Never prints the API key. */
export async function run(argv: string[], io: Io): Promise<number> {
  const cli = invokedAs(io.env);
  const say = (line: string) => io.stdout(`${line}\n`);
  const answered = answerWithoutCommand(argv, cli, say);
  if (answered !== null) return answered;
  const [name = '', ...rest] = argv;
  const spec = commandSpec(name);
  let json = rest.includes('--json');
  try {
    if (!spec) throw usageError(`unknown command '${name}'`, null, cli);
    const parsed = parse(spec, rest, cli);
    json = parsed.json;
    if (parsed.help) {
      say(commandHelp(spec, cli));
      return EXIT_OK;
    }
    const client = clientFor(io, cli);
    if (spec.name === 'login') {
      return await loginCommand({ apiUrl: io.env.SOLARA_API_URL || DEFAULT_API_URL, env: io.env, cli, say, client });
    }
    if (!client) {
      io.stderr('solara: SOLARA_API_KEY is not set to a Solara API key (sol_live_...).\n');
      io.stderr(
        `next: ask the person to create one in Settings -> API keys and give it to you as SOLARA_API_KEY (\`${cli} login\` explains).\n`,
      );
      return EXIT_USAGE;
    }
    const ctx: Context = { client, env: io.env, cli, json, say, note: (line) => io.stderr(`${line}\n`) };
    return await runCommand(spec, ctx, parsed);
  } catch (error) {
    if (!(error instanceof SolaraError)) throw error;
    printRefusal(error, json, io);
    return error.exitCode;
  }
}
