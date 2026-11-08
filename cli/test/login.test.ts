// `solara login`, `logout` and `status`: the device flow against a stand-in authorization server,
// the sign-in kept to this user, refreshed on its own, winning over SOLARA_API_KEY, and never
// printed.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialStore, configDir, LOCK_STALE_MS, type SignIn } from '../src/credentials';
import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from '../src/errors';
import { LIMITS } from '../src/http';
import { hasLocalBrowser } from '../src/login';
import { cli, type FakeApi, KEY, startFakeApi } from './fake-api';
import { tempDir } from './mp4';

const ACCESS = `eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9.${'a'.repeat(40)}.sig`;
const NEXT_ACCESS = `eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9.${'b'.repeat(40)}.sig`;
const REFRESH = `soa_rt_${'r'.repeat(80)}`;
const NEXT_REFRESH = `soa_rt_${'s'.repeat(80)}`;

let api: FakeApi;
let dir: string;

beforeEach(async () => {
  api = await startFakeApi();
  dir = tempDir();
});
afterEach(() => api.close());

function form(body: Buffer): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body.toString()));
}

function signedIn(expiresInMs: number, access = ACCESS, refresh = REFRESH): SignIn {
  return {
    client_id: 'solara-cli',
    access_token: access,
    access_expires_at: Date.now() + expiresInMs,
    refresh_token: refresh,
    scope: 'mcp:read mcp:edit mcp:export mcp:publish',
    signed_in_at: new Date().toISOString(),
  };
}

const identity = { workspace_name: 'Bakery on Main', credential: 'connected_app', name: 'Solara CLI' };
const tokens = (access: string, refresh: string) => ({
  status: 200,
  json: { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 600, scope: 'mcp:read' },
});

describe('login', () => {
  test('signs in with a code the person confirms, keeps the tokens to this user, and prints none', async () => {
    const page = `${api.url}/oauth/device?user_code=BCDF-GHJK`;
    api.on('POST', '/oauth/device_authorization', {
      status: 200,
      json: {
        device_code: `soa_dc_${'d'.repeat(58)}`,
        user_code: 'BCDF-GHJK',
        verification_uri: `${api.url}/oauth/device`,
        verification_uri_complete: page,
        expires_in: 600,
        interval: 5,
      },
    });
    api.on(
      'POST',
      '/oauth/token',
      { status: 400, json: { error: 'authorization_pending' } },
      { status: 400, json: { error: 'slow_down' } },
      tokens(ACCESS, REFRESH),
    );
    api.on('GET', '/api/v1/agent/identity', { status: 200, json: identity });

    const result = await cli(['login'], { apiUrl: api.url, env: { SOLARA_API_KEY: '', SOLARA_CONFIG_DIR: dir } });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    expect(result.stdout).toBe('Signed in to Bakery on Main\n');
    expect(result.stderr).toContain(page);
    expect(result.stderr).toContain('the code BCDF-GHJK');
    expect(result.sleeps).toEqual([5, 5, 10]); // the interval, then 5 more after slow_down (RFC 8628 §3.5)

    const started = form(api.to('POST', '/oauth/device_authorization')[0]?.body ?? Buffer.alloc(0));
    expect(started).toEqual({
      client_id: 'solara-cli',
      scope: 'mcp:read mcp:edit mcp:export',
    });
    const polls = api.to('POST', '/oauth/token').map((call) => form(call.body));
    expect(polls.every((poll) => poll.grant_type === 'urn:ietf:params:oauth:grant-type:device_code')).toBe(true);
    expect(api.to('GET', '/api/v1/agent/identity')[0]?.headers.authorization).toBe(`Bearer ${ACCESS}`);

    const path = join(dir, 'credentials.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readFileSync(path, 'utf8')).toContain(REFRESH);
    expect(result.stdout + result.stderr).not.toContain(ACCESS);
    expect(result.stdout + result.stderr).not.toContain(REFRESH);
    expect(result.stdout + result.stderr).not.toContain('soa_dc_');
  });

  test('a refused or expired code ends login with what to tell the person, and stores nothing', async () => {
    api.on('POST', '/oauth/device_authorization', {
      status: 200,
      json: {
        device_code: 'soa_dc_x',
        user_code: 'BCDF-GHJK',
        verification_uri: `${api.url}/oauth/device`,
        interval: 5,
      },
    });
    api.on('POST', '/oauth/token', { status: 400, json: { error: 'access_denied' } });
    const env = { SOLARA_API_KEY: '', SOLARA_CONFIG_DIR: dir };
    const refused = await cli(['login', '--browser', 'never'], { apiUrl: api.url, env });
    expect(refused.code).toBe(EXIT_REFUSED);
    expect(refused.stderr).toContain('the sign-in was refused');
    expect(refused.opened).toEqual([]);

    api.on('POST', '/oauth/token', { status: 400, json: { error: 'expired_token' } });
    const expired = await cli(['login', '--browser', 'never'], { apiUrl: api.url, env });
    expect(expired.code).toBe(EXIT_REFUSED);
    expect(expired.stderr).toContain('next: Run login again');
    expect(await new CredentialStore(dir).read(api.url)).toBeNull();
  });

  test('signing in again ends the old sign-in in Solara first', async () => {
    await new CredentialStore(dir).write(api.url, signedIn(600_000));
    api.on('POST', '/oauth/revoke', { status: 200 });
    api.on('POST', '/oauth/device_authorization', {
      status: 200,
      json: {
        device_code: 'soa_dc_y',
        user_code: 'BCDF-GHJK',
        verification_uri: `${api.url}/oauth/device`,
        interval: 5,
      },
    });
    api.on('POST', '/oauth/token', tokens(NEXT_ACCESS, NEXT_REFRESH));
    api.on('GET', '/api/v1/agent/identity', { status: 200, json: identity });
    const result = await cli(['login', '--browser', 'never'], {
      apiUrl: api.url,
      env: { SOLARA_API_KEY: '', SOLARA_CONFIG_DIR: dir },
    });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    const order = api.calls.map((call) => call.path);
    expect(order.indexOf('/oauth/revoke')).toBeLessThan(order.indexOf('/oauth/device_authorization'));
    expect(form(api.to('POST', '/oauth/revoke')[0]?.body ?? Buffer.alloc(0)).token).toBe(REFRESH);
    expect((await new CredentialStore(dir).read(api.url))?.refresh_token).toBe(NEXT_REFRESH);
  });

  test('a browser opens only where the person can see it', () => {
    expect(hasLocalBrowser({}, 'darwin')).toBe(true);
    expect(hasLocalBrowser({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' }, 'darwin')).toBe(false);
    expect(hasLocalBrowser({ CI: 'true' }, 'darwin')).toBe(false);
    expect(hasLocalBrowser({}, 'linux')).toBe(false); // no display: a server or a sandbox
    expect(hasLocalBrowser({ DISPLAY: ':0' }, 'linux')).toBe(true);
  });

  test('the sign-in is kept under the config folder the environment names, and nowhere without one', () => {
    expect(configDir({ SOLARA_CONFIG_DIR: '/x' })).toBe('/x');
    expect(configDir({ XDG_CONFIG_HOME: '/c', HOME: '/h' })).toBe('/c/solaraai');
    expect(configDir({ HOME: '/h' })).toBe('/h/.config/solaraai');
    expect(configDir({})).toBeNull();
  });
});

describe('the stored sign-in', () => {
  test('wins over SOLARA_API_KEY, and is refreshed before its token expires', async () => {
    await new CredentialStore(dir).write(api.url, signedIn(30_000)); // inside the minute's margin
    api.on('POST', '/oauth/token', tokens(NEXT_ACCESS, NEXT_REFRESH));
    api.on('GET', '/api/v1/styles', { status: 200, json: { styles: [], caption_styles: [] } });

    const result = await cli(['styles'], { apiUrl: api.url, env: { SOLARA_API_KEY: KEY, SOLARA_CONFIG_DIR: dir } });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    expect(form(api.to('POST', '/oauth/token')[0]?.body ?? Buffer.alloc(0))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: REFRESH,
      client_id: 'solara-cli',
    });
    expect(api.to('GET', '/api/v1/styles')[0]?.headers.authorization).toBe(`Bearer ${NEXT_ACCESS}`);
    expect((await new CredentialStore(dir).read(api.url))?.refresh_token).toBe(NEXT_REFRESH);
    expect(result.stdout + result.stderr).not.toContain(NEXT_ACCESS);
  });

  test('a token refused mid-command is refreshed once and the call sent again', async () => {
    await new CredentialStore(dir).write(api.url, signedIn(600_000));
    api.on(
      'GET',
      '/api/v1/styles',
      { status: 401, json: { code: 'api_key_invalid', detail: 'the sign-in is not valid or has ended' } },
      { status: 200, json: { styles: [], caption_styles: [] } },
    );
    api.on('POST', '/oauth/token', tokens(NEXT_ACCESS, NEXT_REFRESH));
    const result = await cli(['styles'], { apiUrl: api.url, env: { SOLARA_API_KEY: '', SOLARA_CONFIG_DIR: dir } });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    const bearers = api.to('GET', '/api/v1/styles').map((call) => call.headers.authorization);
    expect(bearers).toEqual([`Bearer ${ACCESS}`, `Bearer ${NEXT_ACCESS}`]);
  });

  test('a sign-in disconnected in Solara is forgotten, and the agent is told to have the person sign in', async () => {
    await new CredentialStore(dir).write(api.url, signedIn(600_000));
    api.on('GET', '/api/v1/styles', { status: 401, json: { code: 'api_key_invalid' } });
    api.on('POST', '/oauth/token', { status: 400, json: { error: 'invalid_grant' } });
    const result = await cli(['styles'], { apiUrl: api.url, env: { SOLARA_API_KEY: '', SOLARA_CONFIG_DIR: dir } });
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain('solara: the sign-in ended');
    expect(result.stderr).toContain('next: Run `solara login` yourself, give the person the link and the code');
    expect(await new CredentialStore(dir).read(api.url)).toBeNull();
  });

  test('two commands at once spend the refresh token once', async () => {
    await new CredentialStore(dir).write(api.url, signedIn(0));
    // A second refresh with the rotated token would be reuse, and revoke the sign-in.
    api.on('POST', '/oauth/token', tokens(NEXT_ACCESS, NEXT_REFRESH), {
      status: 400,
      json: { error: 'invalid_grant' },
    });
    api.on('GET', '/api/v1/styles', { status: 200, json: { styles: [], caption_styles: [] } });
    const env = { SOLARA_API_KEY: '', SOLARA_CONFIG_DIR: dir };
    const both = await Promise.all([
      cli(['styles'], { apiUrl: api.url, env }),
      cli(['styles'], { apiUrl: api.url, env }),
    ]);
    expect(both.map((result) => result.code)).toEqual([EXIT_OK, EXIT_OK]);
    expect(api.to('POST', '/oauth/token')).toHaveLength(1);
  });

  test('a sign-in for one API is not used for another', async () => {
    await new CredentialStore(dir).write('https://api.solaraai.com', signedIn(600_000));
    const result = await cli(['styles'], { apiUrl: api.url, env: { SOLARA_API_KEY: '', SOLARA_CONFIG_DIR: dir } });
    expect(result.code).toBe(EXIT_USAGE);
    expect(api.calls).toEqual([]);
  });

  test('a credentials file others could read is made this user’s again', async () => {
    const store = new CredentialStore(dir);
    await store.write(api.url, signedIn(600_000));
    const path = join(dir, 'credentials.json');
    writeFileSync(path, readFileSync(path), { mode: 0o644 });
    expect((await store.read(api.url))?.refresh_token).toBe(REFRESH);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('status and logout', () => {
  test('status says the workspace and how the CLI signs in', async () => {
    api.on('GET', '/api/v1/agent/identity', {
      status: 200,
      json: { ...identity, credential: 'api_key', name: 'Laptop' },
    });
    const withKey = await cli(['status'], { apiUrl: api.url });
    expect(withKey.code, withKey.stderr).toBe(EXIT_OK);
    expect(withKey.stdout).toBe(
      'Workspace: Bakery on Main\nSigned in with: the API key in SOLARA_API_KEY ("Laptop")\n',
    );

    await new CredentialStore(dir).write(api.url, signedIn(600_000));
    api.on('GET', '/api/v1/agent/identity', { status: 200, json: identity });
    const signed = await cli(['whoami', '--json'], { apiUrl: api.url, env: { SOLARA_CONFIG_DIR: dir } });
    expect(signed.code, signed.stderr).toBe(EXIT_OK);
    expect(JSON.parse(signed.stdout)).toMatchObject({ workspace_name: 'Bakery on Main', auth: 'login' });
    expect(api.to('GET', '/api/v1/agent/identity').at(-1)?.headers.authorization).toBe(`Bearer ${ACCESS}`);

    const none = await cli(['status'], { apiUrl: api.url, env: { SOLARA_API_KEY: '' } });
    expect(none.code).toBe(EXIT_USAGE);
    expect(none.stderr).toContain('next: Run `solara login` yourself, give the person the link and the code');
  });

  test('logout ends the sign-in in Solara, deletes it here, and leaves SOLARA_API_KEY alone', async () => {
    await new CredentialStore(dir).write(api.url, signedIn(600_000));
    api.on('POST', '/oauth/revoke', { status: 200 });
    const result = await cli(['logout'], { apiUrl: api.url, env: { SOLARA_CONFIG_DIR: dir } });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toBe('Signed out.\n');
    expect(form(api.to('POST', '/oauth/revoke')[0]?.body ?? Buffer.alloc(0))).toEqual({
      token: REFRESH,
      client_id: 'solara-cli',
    });
    expect(result.stderr).toContain('SOLARA_API_KEY is still set');
    expect(await new CredentialStore(dir).read(api.url)).toBeNull();

    await new CredentialStore(dir).write(api.url, signedIn(600_000));
    api.on('POST', '/oauth/revoke', 'reset');
    const offline = await cli(['logout'], { apiUrl: api.url, env: { SOLARA_CONFIG_DIR: dir } });
    expect(offline.code).toBe(EXIT_OK);
    expect(offline.stdout).toBe('Signed out on this computer.\n');
    expect(offline.stderr).toContain('Settings -> Connected apps');
    expect(await new CredentialStore(dir).read(api.url)).toBeNull();
  });
});

test("videos lists the workspace's videos", async () => {
  api.on('GET', '/api/v1/projects?limit=20', {
    status: 200,
    json: { items: [{ video_id: 'v1', state: 'awaiting_approval', title: 'Runner tips' }], total: 1 },
  });
  const result = await cli(['videos'], { apiUrl: api.url });
  expect(result.code, result.stderr).toBe(EXIT_OK);
  expect(result.stdout).toBe('  video_id v1  awaiting_approval  "Runner tips"\n1 video(s) in the workspace.\n');
});

describe('the lock beside the credentials file', () => {
  test('outlives the slowest refresh it guards', () => {
    expect(LOCK_STALE_MS).toBeGreaterThan(LIMITS.idleMs + LIMITS.requestMs);
  });

  test('a lock held for longer than a refresh usually takes is waited for, never broken', async () => {
    const store = new CredentialStore(dir);
    await store.write(api.url, signedIn(600_000));
    const lock = join(dir, 'credentials.json.lock');
    writeFileSync(lock, '');
    const minuteAgo = new Date(Date.now() - 60_000); // past the old 30 s, inside a refresh's deadline
    utimesSync(lock, minuteAgo, minuteAgo);
    let ran = false;
    const waiting = store.locked(async () => {
      ran = true;
    });
    await new Promise((done) => setTimeout(done, 400));
    expect(ran).toBe(false);
    expect(existsSync(lock)).toBe(true);
    rmSync(lock);
    await waiting;
    expect(ran).toBe(true);
  });
});
