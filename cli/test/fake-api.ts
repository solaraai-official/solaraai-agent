// A stand-in for the Solara API and its storage on 127.0.0.1: real HTTP, canned answers, every
// request recorded. Never the live API.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { run } from '../src/cli';
import type { Limits } from '../src/http';

export const KEY = `sol_live_${'a'.repeat(72)}`;

export interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer;
}

/** An answer: a status with a JSON (or raw) body and headers, or `reset` to drop the connection. */
export type Answer =
  | { status: number; json?: unknown; raw?: string | Buffer; headers?: Record<string, string> }
  | 'reset';

export interface FakeApi {
  url: string;
  calls: Recorded[];
  /** Queues answers for a method and path (with its query); the last one repeats until more are
   * queued. */
  on(method: string, path: string, ...answers: Answer[]): void;
  to(method: string, path: string): Recorded[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const blocks: Buffer[] = [];
    req.on('data', (block: Buffer) => blocks.push(block));
    req.on('end', () => resolve(Buffer.concat(blocks)));
  });
}

export async function startFakeApi(): Promise<FakeApi> {
  const answers = new Map<string, Answer[]>();
  const repeating = new Set<string>();
  const calls: Recorded[] = [];
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const method = req.method ?? '';
    const path = req.url ?? '';
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) headers[name] = String(value);
    calls.push({ method, path, headers, body });
    const queue = answers.get(`${method} ${path}`);
    const sole = queue?.length === 1;
    const answer = sole ? queue?.[0] : queue?.shift();
    if (sole) repeating.add(`${method} ${path}`);
    if (!answer) {
      res.writeHead(599).end(`unexpected ${method} ${path}`);
      return;
    }
    if (answer === 'reset') {
      req.socket.destroy();
      return;
    }
    const raw = answer.raw ?? (answer.json === undefined ? '' : JSON.stringify(answer.json));
    res.writeHead(answer.status, { 'Content-Type': 'application/json', ...answer.headers });
    res.end(raw);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    calls,
    on(method, path, ...queued) {
      const key = `${method} ${path}`;
      // An answer already repeating gives way to the new ones.
      const kept = repeating.delete(key) ? [] : (answers.get(key) ?? []);
      answers.set(key, [...kept, ...queued]);
    },
    to(method, path) {
      return calls.filter((call) => call.method === method && call.path === path);
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  sleeps: number[];
}

/** The CLI, in this process, as an agent runs it: the key in SOLARA_API_KEY, the API at `apiUrl`.
 * Its sleeps are recorded, not slept. */
export async function cli(
  argv: string[],
  options: { apiUrl?: string; env?: NodeJS.ProcessEnv; limits?: Limits } = {},
): Promise<CliResult> {
  let stdout = '';
  let stderr = '';
  const sleeps: number[] = [];
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SOLARA_API_KEY: KEY,
    ...(options.apiUrl ? { SOLARA_API_URL: options.apiUrl } : {}),
    ...options.env,
  };
  const code = await run(argv, {
    env,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    sleep: async (seconds) => {
      sleeps.push(seconds);
    },
    ...(options.limits ? { limits: options.limits } : {}),
  });
  return { code, stdout, stderr, sleeps };
}
