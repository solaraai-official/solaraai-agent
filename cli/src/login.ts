// `solara login`, `logout` and `status` (alone, or `whoami`): the CLI's own sign-in, so the person
// never hands an agent a key. The tokens live only in the credentials file (credentials.ts) and
// travel only to Solara; this file prints the workspace's name, the link and the code, never a
// token.

import { spawn } from 'node:child_process';
import type { Client } from './client';
import type { CredentialStore } from './credentials';
import { EXIT_OK, EXIT_USAGE, type JsonObject, SolaraError } from './errors';
import type { Transport } from './http';
import { loginCredential, pollDevice, revoke, signInAgainStep, startDevice } from './oauth';

export interface AuthIo {
  apiUrl: string;
  env: NodeJS.ProcessEnv;
  cli: string;
  json: boolean;
  say: (line: string) => void;
  note: (line: string) => void;
  transport: Transport;
  userAgent: string;
  sleep: (seconds: number) => Promise<void>;
  /** Where the sign-in is kept; null when the environment names no home folder. */
  store: CredentialStore | null;
  /** Opens a link in this machine's browser (tests record it instead). */
  openUrl: (url: string) => void;
  /** Builds the API client for a credential. */
  client: (auth: Client['auth']) => Client;
}

/** The refusal when nothing signs the CLI in. */
export function notSignedIn(cli: string): SolaraError {
  return new SolaraError(
    'not signed in to Solara',
    `${signInAgainStep(cli)} On a server or in CI, SOLARA_API_KEY can hold a key instead.`,
    { exitCode: EXIT_USAGE },
  );
}

function noStore(): SolaraError {
  return new SolaraError(
    'no home folder to keep the sign-in in (HOME, XDG_CONFIG_HOME and SOLARA_CONFIG_DIR are unset)',
    'Set SOLARA_CONFIG_DIR to a folder only this user can read, then run login again.',
    { exitCode: EXIT_USAGE },
  );
}

/** Whether a browser opened here would reach the person: not over SSH, in CI or with no display. */
export function hasLocalBrowser(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT || env.CI) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

/** Opens url in the default browser, best effort: a failure only means the person opens it. */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url.replaceAll('&', '^&')]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // No opener here: the link is printed, the person opens it.
  }
}

/** Who a credential acts as, in one read (get-agent-identity). */
async function identity(client: Client): Promise<JsonObject> {
  return client.call('GET', '/agent/identity');
}

/** `login`: the device flow (RFC 8628), then the workspace's name. */
export async function loginCommand(io: AuthIo, browser: string): Promise<number> {
  if (!io.store) throw noStore();
  const store = io.store;
  // A sign-in over an existing one ends the old first: no forgotten session stays live in Solara.
  if ((await signOut(io, store)) !== null) io.note('Signed out of the previous sign-in first.');
  const start = await startDevice(io.transport, io.apiUrl, io.userAgent);
  const minutes = Math.max(1, Math.round(start.expiresIn / 60));
  io.note(`To sign in, open ${start.verificationUriComplete}`);
  io.note(`check that it shows the code ${start.userCode}, and choose Allow. (An agent: give the person both.)`);
  if (browser !== 'never' && hasLocalBrowser(io.env)) {
    io.openUrl(start.verificationUriComplete);
    io.note('(Opened in the browser on this computer.)');
  }
  io.note(`Waiting for Allow (the code expires in ${minutes} minutes)...`);
  const signIn = await pollDevice(start, {
    transport: io.transport,
    apiUrl: io.apiUrl,
    userAgent: io.userAgent,
    sleep: io.sleep,
    now: Date.now,
  });
  await store.locked(() => store.write(io.apiUrl, signIn));
  const client = io.client(
    loginCredential(signIn, {
      store,
      apiUrl: io.apiUrl,
      transport: io.transport,
      userAgent: io.userAgent,
      cli: io.cli,
      now: Date.now,
    }),
  );
  const who = await identity(client);
  if (io.json) io.say(JSON.stringify({ ...who, auth: 'login', api_url: io.apiUrl }, null, 2));
  else io.say(`Signed in to ${String(who.workspace_name ?? 'your workspace')}`);
  if (io.env.SOLARA_API_KEY?.trim()) io.note('This sign-in now wins over SOLARA_API_KEY (`logout` to use the key).');
  return EXIT_OK;
}

/** Ends the stored sign-in in Solara (RFC 7009) and deletes it here: null when there was none,
 * else whether Solara answered. */
async function signOut(io: AuthIo, store: CredentialStore): Promise<boolean | null> {
  return store.locked(async () => {
    const signIn = await store.read(io.apiUrl);
    if (!signIn) return null;
    const answered = await revoke(io.transport, io.apiUrl, signIn.refresh_token, io.userAgent);
    await store.write(io.apiUrl, null);
    return answered;
  });
}

/** `logout`: ends the sign-in in Solara and deletes it here. */
export async function logoutCommand(io: AuthIo): Promise<number> {
  const revoked = io.store ? await signOut(io, io.store) : null;
  if (revoked === null) io.say('Not signed in: nothing to sign out of.');
  else io.say(revoked ? 'Signed out.' : 'Signed out on this computer.');
  if (revoked === false) {
    io.note('solara: Solara could not be reached to end the sign-in there.');
    io.note('next: tell the person to disconnect "Solara CLI" in Solara, Settings -> Connected apps.');
  }
  if (io.env.SOLARA_API_KEY?.trim()) io.note('SOLARA_API_KEY is still set: the CLI uses it now.');
  return EXIT_OK;
}

/** `status` alone, or `whoami`: the workspace and how the CLI signs in, checked with one read. */
export async function whoamiCommand(io: AuthIo, client: Client | null): Promise<number> {
  if (!client) throw notSignedIn(io.cli);
  const who = await identity(client);
  const auth = client.auth.kind === 'login' ? 'login' : 'api_key';
  if (io.json) {
    io.say(JSON.stringify({ ...who, auth, api_url: client.apiUrl }, null, 2));
    return EXIT_OK;
  }
  io.say(`Workspace: ${String(who.workspace_name ?? '')}`);
  io.say(
    auth === 'login'
      ? `Signed in with: ${io.cli} login (Solara CLI)`
      : `Signed in with: the API key in SOLARA_API_KEY ("${String(who.name ?? '')}")`,
  );
  return EXIT_OK;
}
