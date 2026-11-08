// The Solara CLI's sign-in (`solara login`): the OAuth 2.0 device flow (RFC 8628) against
// Solara's own authorization server, as the client `solara-cli`. It works where no browser can
// reach this machine (an agent's sandbox, a server over SSH): the person opens a link on any
// device, signed in to Solara, checks the code and chooses Allow. The tokens go only to the
// credentials file and to Solara's token endpoint; nothing here prints or logs one.

import type { CredentialStore, SignIn } from './credentials';
import { EXIT_REFUSED, EXIT_USAGE, NETWORK_STEP, SERVER_STEP, SolaraError } from './errors';
import { NoAnswerError, type Transport } from './http';

export const CLIENT_ID = 'solara-cli';
export const DEVICE_PATH = '/oauth/device_authorization';
export const TOKEN_PATH = '/oauth/token';
export const REVOKE_PATH = '/oauth/revoke';
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/**
 * What the CLI's commands use, and nothing more: read (styles, status, wait, usage, calendar,
 * videos, whoami), edit (upload, upload-url, start) and export (export, download). No command
 * posts or asks to post, so it never asks for mcp:publish.
 */
export const SCOPES = 'mcp:read mcp:edit mcp:export';
/** An access token this close to expiry is refreshed first. */
const REFRESH_MARGIN_MS = 60_000;

/** What to tell the agent when there is no sign-in: it signs in itself, the person allows it. */
export function signInAgainStep(cli: string): string {
  return `Run \`${cli} login\` yourself, give the person the link and the code it prints, and wait while they choose Allow in Solara. Never ask them for a key or a token.`;
}

export interface OAuthAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** POSTs a form to the authorization server; no answer at all is a network refusal. */
export async function postForm(
  transport: Transport,
  url: string,
  form: Record<string, string>,
  userAgent: string,
): Promise<OAuthAnswer> {
  let answer: Awaited<ReturnType<Transport>>;
  try {
    answer = await transport({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
      body: Buffer.from(new URLSearchParams(form).toString()),
    });
  } catch (error) {
    if (!(error instanceof NoAnswerError)) throw error;
    throw new SolaraError(`no answer from Solara (${error.message})`, NETWORK_STEP);
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed = answer.body.length ? JSON.parse(answer.body.toString('utf8')) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
  } catch {
    body = {};
  }
  return { status: answer.status, body };
}

/** RFC 8628 §3.2's answer, as the CLI uses it. */
export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export async function startDevice(transport: Transport, apiUrl: string, userAgent: string): Promise<DeviceStart> {
  const { status, body } = await postForm(
    transport,
    apiUrl + DEVICE_PATH,
    // No `resource`: the server's default for this client is its API (RFC 8707), whatever host
    // this machine reaches it by.
    { client_id: CLIENT_ID, scope: SCOPES },
    userAgent,
  );
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '');
  if (status !== 200 || !text('device_code') || !text('user_code') || !text('verification_uri')) {
    throw oauthRefusal(status, body, 'Solara would not start a sign-in');
  }
  return {
    deviceCode: text('device_code'),
    userCode: text('user_code'),
    verificationUri: text('verification_uri'),
    verificationUriComplete: text('verification_uri_complete') || text('verification_uri'),
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 600,
    interval: typeof body.interval === 'number' ? body.interval : 5,
  };
}

function oauthRefusal(status: number, body: Record<string, unknown>, what: string): SolaraError {
  const code = typeof body.error === 'string' ? body.error : '';
  const detail = typeof body.error_description === 'string' ? `: ${body.error_description}` : '';
  if (status >= 500 || status === 0) return new SolaraError(`${what} (HTTP ${status})`, SERVER_STEP, { status });
  return new SolaraError(
    `${what}${detail}`,
    'Run the same command again; if it fails the same way, tell Solara support.',
    {
      status,
      code,
    },
  );
}

/** A token response turned into what the file keeps. */
function signInFrom(body: Record<string, unknown>, now: number, previous?: SignIn): SignIn | null {
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') return null;
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 600;
  return {
    client_id: CLIENT_ID,
    access_token: body.access_token,
    access_expires_at: now + expiresIn * 1000,
    refresh_token: body.refresh_token,
    scope: typeof body.scope === 'string' ? body.scope : (previous?.scope ?? ''),
    signed_in_at: previous?.signed_in_at ?? new Date(now).toISOString(),
  };
}

export interface PollOptions {
  transport: Transport;
  apiUrl: string;
  userAgent: string;
  sleep: (seconds: number) => Promise<void>;
  now: () => number;
}

/** What one poll's answer means: the tokens, wait as before, wait 5 seconds more, or a refusal. */
function pollAnswer(answer: OAuthAnswer, now: number): SignIn | 'pending' | 'slow_down' {
  if (answer.status === 200) {
    const signIn = signInFrom(answer.body, now);
    if (signIn) return signIn;
    throw new SolaraError('Solara answered the sign-in without tokens', SERVER_STEP);
  }
  switch (answer.body.error) {
    case 'authorization_pending':
      return 'pending';
    case 'slow_down':
      return 'slow_down';
    case 'access_denied':
      throw new SolaraError(
        'the sign-in was refused in Solara (Don’t allow)',
        'Tell the person; run login again only if they ask.',
        { exitCode: EXIT_REFUSED, code: 'access_denied' },
      );
    case 'expired_token':
      throw expired();
  }
  if (answer.status >= 500) return 'pending';
  throw oauthRefusal(answer.status, answer.body, 'the sign-in failed');
}

/** Polls until the person decides (RFC 8628 §3.4–3.5): the tokens, or a refusal that says why. */
export async function pollDevice(start: DeviceStart, options: PollOptions): Promise<SignIn> {
  const deadline = options.now() + start.expiresIn * 1000;
  let interval = Math.max(1, start.interval);
  while (options.now() <= deadline) {
    await options.sleep(interval);
    let answer: OAuthAnswer;
    try {
      answer = await postForm(
        options.transport,
        options.apiUrl + TOKEN_PATH,
        { grant_type: DEVICE_GRANT, device_code: start.deviceCode, client_id: CLIENT_ID },
        options.userAgent,
      );
    } catch (error) {
      // A poll that got no answer is tried again at the next interval, within the code's life.
      if (error instanceof SolaraError && error.status === 0) continue;
      throw error;
    }
    const outcome = pollAnswer(answer, options.now());
    if (outcome === 'slow_down') interval += 5;
    else if (outcome !== 'pending') return outcome;
  }
  throw expired();
}

function expired(): SolaraError {
  return new SolaraError(
    'the sign-in code expired before anyone chose Allow',
    'Run login again and give the person the new link and code.',
    { exitCode: EXIT_REFUSED, code: 'expired_token' },
  );
}

/** Revokes a sign-in's session (RFC 7009); true when Solara answered. */
export async function revoke(transport: Transport, apiUrl: string, token: string, userAgent: string): Promise<boolean> {
  try {
    const { status } = await postForm(transport, apiUrl + REVOKE_PATH, { token, client_id: CLIENT_ID }, userAgent);
    return status === 200;
  } catch (error) {
    if (error instanceof SolaraError) return false;
    throw error;
  }
}

/** How a command authenticates: a stored sign-in or the environment's API key. */
export interface Credential {
  kind: 'login' | 'key';
  /** The bearer to send now. */
  bearer(): Promise<string>;
  /** After a 401 for token: get a fresh one, or throw that the sign-in ended. */
  renew?(failed: string): Promise<void>;
}

export function keyCredential(key: string): Credential {
  return { kind: 'key', bearer: async () => key };
}

export interface LoginOptions {
  store: CredentialStore;
  apiUrl: string;
  transport: Transport;
  userAgent: string;
  cli: string;
  now: () => number;
}

/** A stored sign-in: its access token, refreshed when it is about to expire or was refused. */
export function loginCredential(initial: SignIn, options: LoginOptions): Credential {
  let current = initial;
  const fresh = (signIn: SignIn) => signIn.access_expires_at - REFRESH_MARGIN_MS > options.now();

  const refresh = async (failed?: string): Promise<SignIn> =>
    options.store.locked(async () => {
      // Another command may have refreshed while this one waited: its tokens are the live ones.
      const stored = await options.store.read(options.apiUrl);
      if (!stored) throw ended(options.cli);
      if (stored.access_token !== (failed ?? current.access_token) && fresh(stored)) return stored;
      return refreshStored(stored, options);
    });

  return {
    kind: 'login',
    async bearer() {
      if (!fresh(current)) current = await refresh();
      return current.access_token;
    },
    async renew(failed) {
      current = await refresh(failed);
    },
  };
}

/** Spends the stored refresh token (inside the store's lock): the next pair, kept; a refused one
 * signs out here too. */
async function refreshStored(stored: SignIn, options: LoginOptions): Promise<SignIn> {
  const { status, body } = await postForm(
    options.transport,
    options.apiUrl + TOKEN_PATH,
    {
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: CLIENT_ID,
    },
    options.userAgent,
  );
  if (status === 200) {
    const next = signInFrom(body, options.now(), stored);
    if (!next) throw new SolaraError('Solara answered the refresh without tokens', SERVER_STEP);
    await options.store.write(options.apiUrl, next);
    return next;
  }
  if (body.error === 'invalid_grant') {
    await options.store.write(options.apiUrl, null);
    throw ended(options.cli);
  }
  throw oauthRefusal(status, body, 'Solara would not refresh the sign-in');
}

export function ended(cli: string): SolaraError {
  return new SolaraError('the sign-in ended (disconnected in Solara, or unused for too long)', signInAgainStep(cli), {
    exitCode: EXIT_USAGE,
    code: 'sign_in_ended',
  });
}
