// `solara login`: where the API key comes from, and whether the one in the environment works. The
// CLI never stores a key: it reads SOLARA_API_KEY on every run, and never prints it.

import type { Client } from './client';
import { EXIT_OK, EXIT_USAGE } from './errors';
import { appUrl } from './video';

export function keyInstructions(apiUrl: string, env: NodeJS.ProcessEnv, cli: string): string[] {
  return [
    'Solara reads its API key from the environment variable SOLARA_API_KEY on every run. It never',
    'stores the key and never prints it.',
    '',
    `1. In Solara, open Settings -> API keys (${appUrl(apiUrl, env.SOLARA_APP_URL)}/settings/api-keys) and`,
    '   choose Create API key. Keys need a paid plan. Solara shows the key once.',
    '2. Put it in the environment the agent runs in, never in a chat or a file you commit:',
    '     export SOLARA_API_KEY="sol_live_..."',
    "   To keep it, use your agent's secret settings or your shell profile.",
    `3. Check it: ${cli} login`,
  ];
}

export interface LoginIo {
  apiUrl: string;
  env: NodeJS.ProcessEnv;
  cli: string;
  say: (line: string) => void;
  /** A client with the environment's key, or null when SOLARA_API_KEY isn't a Solara key. */
  client: Client | null;
}

/** Explains the key; with one set, checks it with one read (the plan's usage) and says so. A refused
 * key throws its SolaraError, whose next step says what to do. */
export async function loginCommand(io: LoginIo): Promise<number> {
  for (const line of keyInstructions(io.apiUrl, io.env, io.cli)) io.say(line);
  io.say('');
  if (!io.client) {
    io.say(
      io.env.SOLARA_API_KEY?.trim()
        ? 'SOLARA_API_KEY is set, but not to a Solara API key (they start with sol_live_).'
        : 'SOLARA_API_KEY is not set.',
    );
    return EXIT_USAGE;
  }
  const usage = await io.client.call('GET', '/projects/usage');
  const left = usage.exports_left === undefined ? '' : ` Exports left this month: ${usage.exports_left}.`;
  io.say(`SOLARA_API_KEY works with ${io.client.apiUrl}.${left}`);
  return EXIT_OK;
}
