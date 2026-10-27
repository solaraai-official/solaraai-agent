// The CLI as an agent meets it cold: its help, the key it needs and never shows, and the shipped
// file running on Node itself.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE, NETWORK_STEP } from '../src/errors';
import { COMMANDS } from '../src/spec';
import { cli, type FakeApi, KEY, startFakeApi } from './fake-api';

let api: FakeApi;

beforeEach(async () => {
  api = await startFakeApi();
});
afterEach(() => api.close());

describe('help', () => {
  test('`--help` names every command and needs no key', async () => {
    const result = await cli(['--help'], { env: { SOLARA_API_KEY: '' } });
    expect(result.code).toBe(EXIT_OK);
    for (const command of COMMANDS) expect(result.stdout).toContain(`\n  ${command.name} `);
    expect(result.stdout).toContain('Exit codes: 0 done, 1 refused');
  });

  test("a command's --help shows its usage, every option it takes, and an example", async () => {
    const result = await cli(['start', '--help'], { env: { SOLARA_API_KEY: '' } });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain('Usage: solara start --upload <upload_id> [options] [--json]');
    for (const option of COMMANDS.find((command) => command.name === 'start')?.options ?? []) {
      expect(result.stdout).toContain(`--${option.name} `);
    }
    expect(result.stdout).toContain('Example:');
    expect((await cli(['help', 'wait'])).stdout).toContain('Usage: solara wait <video_id>');
  });

  test('a wrong command or argument says how to find the right one', async () => {
    for (const argv of [['render'], ['wait'], ['styles', '--colour'], ['wait', 'v1', '--until', 'done']]) {
      const result = await cli(argv, { apiUrl: api.url });
      expect(result.code).toBe(EXIT_USAGE);
      expect(result.stderr).toMatch(/next: Run `solara (\w+ )?--help`/);
    }
    expect(api.calls).toEqual([]);
  });
});

describe('the key', () => {
  test('without one, a command says where to get one', async () => {
    const result = await cli(['styles'], { apiUrl: api.url, env: { SOLARA_API_KEY: '' } });
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain('Settings -> API keys');
    expect(api.calls).toEqual([]);
  });

  test('login explains where the key comes from, and stores nothing', async () => {
    const result = await cli(['login'], { apiUrl: api.url, env: { SOLARA_API_KEY: '' } });
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stdout).toContain('export SOLARA_API_KEY="sol_live_..."');
    expect(result.stdout).toContain(`${api.url}/settings/api-keys`);
    expect(result.stdout).toContain('SOLARA_API_KEY is not set.');
    expect(api.calls).toEqual([]);
  });

  test('login checks a key with one read and never prints it', async () => {
    api.on('GET', '/api/v1/projects/usage', { status: 200, json: { paid: true, exports_left: 7 } });
    const works = await cli(['login'], { apiUrl: api.url });
    expect(works.code).toBe(EXIT_OK);
    expect(works.stdout).toContain(`SOLARA_API_KEY works with ${api.url}. Exports left this month: 7.`);
    expect(works.stdout + works.stderr).not.toContain(KEY);

    api.on('GET', '/api/v1/projects/usage', {
      status: 401,
      json: { detail: 'this API key was revoked', code: 'api_key_revoked' },
    });
    const revoked = await cli(['login'], { apiUrl: api.url });
    expect(revoked.code).toBe(EXIT_REFUSED);
    expect(revoked.stderr).toContain('next: This key was revoked.');
    expect(revoked.stdout + revoked.stderr).not.toContain(KEY);
  });
});

describe('proxies', () => {
  test('a plain-HTTP API is reached through HTTP_PROXY', async () => {
    api.on('GET', 'http://solara.test/api/v1/styles', { status: 200, json: { styles: [], caption_styles: [] } });
    const result = await cli(['styles'], { apiUrl: 'http://solara.test', env: { HTTP_PROXY: api.url } });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    expect(api.calls[0]?.headers.host).toBe('solara.test');
  });

  test('HTTPS goes through a CONNECT tunnel, and a refused tunnel is the network', async () => {
    const asked: string[] = [];
    const proxy = createServer();
    proxy.on('connect', (req, socket) => {
      asked.push(req.url ?? '');
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    try {
      const result = await cli(['styles'], { apiUrl: 'https://solara.test', env: { HTTPS_PROXY: proxyUrl } });
      expect(result.code).toBe(EXIT_REFUSED);
      expect(result.stderr).toContain('the proxy answered 403 to CONNECT solara.test:443');
      expect(result.stderr).toContain(`next: ${NETWORK_STEP}`);
      expect(asked[0]).toBe('solara.test:443');
    } finally {
      proxy.close();
    }
  });
});

describe('the shipped file, on Node', () => {
  const root = join(import.meta.dir, '..');
  const bin = join(root, 'dist', 'solara.js');

  beforeAll(() => {
    const built = spawnSync('bun', ['build.ts'], { cwd: root, encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
  });

  test('runs with nothing installed, and talks to the API', async () => {
    const version = spawnSync('node', [bin, '--version'], { encoding: 'utf8' });
    expect(version.stdout.trim()).toMatch(/^solaraai \d+\.\d+\.\d+$/);

    api.on('GET', '/api/v1/styles', { status: 200, json: { styles: [{ id: 'brass', name: 'Brass' }] } });
    const env = { PATH: process.env.PATH, SOLARA_API_KEY: KEY, SOLARA_API_URL: api.url };
    const styles = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = Bun.spawn(['node', bin, 'styles', '--json'], { env, stdout: 'pipe' });
      void new Response(child.stdout).text().then(async (stdout) => resolve({ status: await child.exited, stdout }));
    });
    expect(styles.status).toBe(EXIT_OK);
    expect(JSON.parse(styles.stdout).styles[0].id).toBe('brass');
    expect(api.calls[0]?.headers['user-agent']).toMatch(/^solaraai-cli\/\d+\.\d+\.\d+ \(node /);
  });
});
