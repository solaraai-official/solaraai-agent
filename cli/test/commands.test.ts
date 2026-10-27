// The commands against a stand-in API on 127.0.0.1: what they send, what they print, and what they
// tell the agent to do next.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WRITE_RETRIES } from '../src/client';
import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE, nextSteps, SERVER_STEP } from '../src/errors';
import { cli, type FakeApi, KEY, startFakeApi } from './fake-api';
import { clip, tempDir } from './mp4';

let api: FakeApi;

beforeEach(async () => {
  api = await startFakeApi();
});
afterEach(() => api.close());

const json = (body: Buffer) => JSON.parse(body.toString());

test('styles name each id apart from the name the app shows', async () => {
  // QA: `lumen: Halo` reads as two names, and only the id is accepted: an agent could send Halo.
  api.on('GET', '/api/v1/styles', {
    status: 200,
    json: {
      styles: [
        { id: 'brass', name: 'Brass', accent_color: '#c9a227' },
        { id: 'lumen', name: 'Halo', accent_color: '#ffd8a8', description: 'Soft light.' },
      ],
      caption_styles: [{ id: 'impact-glow', name: 'Impact Glow' }],
      default_caption_style: 'impact-glow',
    },
  });
  const result = await cli(['styles'], { apiUrl: api.url });
  expect(result.code).toBe(EXIT_OK);
  const out = result.stdout.split('\n');
  expect(out[0]).toContain('pass the id to --style, never the name');
  expect(out).toContain('  id: lumen  name: Halo  (accent #ffd8a8)');
  expect(out).toContain('  id: impact-glow  name: Impact Glow');
  expect(api.calls[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
});

test('the upload puts parts without the key, re-signs a failed one, and completes them in order', async () => {
  const file = clip(tempDir(), 'talk.MOV', 15_840, 250);
  const s3 = `${api.url}/s3`;
  api.on('POST', '/api/v1/projects/uploads', {
    status: 201,
    json: {
      upload_id: 'u1',
      part_size: 100,
      total_parts: 3,
      parts: [1, 2, 3].map((n) => ({ part_number: n, url: `${s3}/p${n}` })),
    },
  });
  api.on('PUT', '/s3/p1', { status: 200, headers: { ETag: '"e1"' } });
  // Part 2 fails once; the re-sign hands back a fresh URL.
  api.on('PUT', '/s3/p2', { status: 500 });
  api.on('POST', '/api/v1/projects/uploads/u1/parts', {
    status: 200,
    json: { parts: [{ part_number: 2, url: `${s3}/p2b` }], completed_parts: [] },
  });
  api.on('PUT', '/s3/p2b', { status: 200, headers: { ETag: '"e2"' } });
  api.on('PUT', '/s3/p3', { status: 200, headers: { ETag: '"e3"' } });
  api.on('POST', '/api/v1/projects/uploads/u1/complete', { status: 200, json: { upload_id: 'u1', size_bytes: 250 } });

  const result = await cli(['upload', file, '--json'], { apiUrl: api.url, env: { npm_command: 'exec' } });
  expect(result.code, result.stderr).toBe(EXIT_OK);
  expect(JSON.parse(result.stdout)).toEqual({ upload_id: 'u1', size_bytes: 250, duration_ms: 15_840 });
  expect(json(api.to('POST', '/api/v1/projects/uploads')[0]?.body ?? Buffer.from('{}'))).toEqual({
    content_type: 'video/quicktime',
    size_bytes: 250,
  });
  const puts = api.calls.filter((call) => call.method === 'PUT');
  expect(puts.every((call) => call.headers.authorization === undefined)).toBe(true);
  // The parts cover the file, the last is the remainder, and each is the file's own bytes.
  const sent = puts.filter((call) => call.path !== '/s3/p2').map((call) => call.body);
  expect(sent.map((part) => part.length)).toEqual([100, 100, 50]);
  expect(Buffer.concat(sent).equals(readFileSync(file))).toBe(true);
  expect(json(api.to('POST', '/api/v1/projects/uploads/u1/complete')[0]?.body ?? Buffer.from('{}'))).toEqual({
    parts: [
      { part_number: 1, etag: '"e1"' },
      { part_number: 2, etag: '"e2"' },
      { part_number: 3, etag: '"e3"' },
    ],
  });
  expect(result.sleeps).toEqual([2]);

  // Without --json, the next step is a command to paste, as this run was started (npx here).
  const again = await cli(['upload', file], { apiUrl: api.url, env: { npm_command: 'exec' } });
  expect(again.stdout).toContain(
    'Next: npx -y solaraai start --upload u1 --duration-ms 15840 --style brass --title "talk"',
  );
  expect(again.stdout + again.stderr).not.toContain(KEY);
});

describe('start', () => {
  const created = { status: 201, json: { video_id: 'v1', state: 'processing' } };

  test('sends an optional setting only when given', async () => {
    api.on('POST', '/api/v1/projects', created);
    const plain = await cli(['start', '--upload', 'u1', '--duration-ms', '9000'], { apiUrl: api.url });
    expect(plain.code, plain.stderr).toBe(EXIT_OK);
    const flags = ['--style', 'glass', '--prompt', 'Short.', '--pause-ms', '120', '--speed', '1.1', '--aspect', '16:9'];
    const full = await cli(['start', '--upload', 'u1', '--duration-ms', '9000', ...flags, '--title', 'Tips'], {
      apiUrl: api.url,
    });
    expect(full.code, full.stderr).toBe(EXIT_OK);
    const [first, second] = api.to('POST', '/api/v1/projects').map((call) => json(call.body));
    expect(first).toEqual({ upload_id: 'u1', source_duration_ms: 9000, settings: { edit_style: 'brass' } });
    expect(second).toEqual({
      upload_id: 'u1',
      source_duration_ms: 9000,
      title: 'Tips',
      settings: { edit_style: 'glass', prompt: 'Short.', pause_ms: 120, speed: 1.1, aspect: '16:9' },
    });
    expect(plain.stdout).toContain(`Edit link (show the person before exporting): ${api.url}/projects/v1`);
  });

  test.each([
    ['--pause-ms', '40'],
    ['--pause-ms', '501'],
    ['--speed', '0.7'],
    ['--speed', '2.01'],
    ['--speed', 'fast'],
    ['--aspect', '1:1'],
    ['--intensity', 'max'],
    ['--duration-ms', '12.5'],
  ])('refuses %s %s before sending anything', async (flag, value) => {
    const result = await cli(['start', '--upload', 'u1', '--duration-ms', '9000', flag, value], { apiUrl: api.url });
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain(flag);
    expect(api.calls).toEqual([]);
  });

  test('a write is retried only with the same Idempotency-Key', async () => {
    api.on('POST', '/api/v1/projects', { status: 503, json: { detail: 'busy' } }, created);
    const result = await cli(['start', '--upload', 'u1', '--duration-ms', '9000', '--json'], { apiUrl: api.url });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout).edit_link).toBe(`${api.url}/projects/v1`);
    const keys = api.to('POST', '/api/v1/projects').map((call) => call.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0] ?? '');
    expect(result.stderr).toContain(`Idempotency-Key ${keys[0]}`);
  });

  test('a refusal carries its code, its Retry-After and the next step, and is not retried', async () => {
    api.on('POST', '/api/v1/projects', {
      status: 429,
      json: { detail: 'this API key has started its 30 videos', code: 'api_key_daily_limit' },
      headers: { 'Retry-After': '3600' },
    });
    const result = await cli(['start', '--upload', 'u1', '--duration-ms', '9000'], { apiUrl: api.url });
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr).toContain('solara: this API key has started its 30 videos (api_key_daily_limit)');
    expect(result.stderr).toContain('retry after: 3600 seconds');
    expect(result.stderr).toContain('midnight UTC');
    expect(api.to('POST', '/api/v1/projects')).toHaveLength(1);
  });
});

test('a write without an Idempotency-Key is sent once: a retry could make a second one', async () => {
  api.on('POST', '/api/v1/projects/uploads', { status: 503, json: { detail: 'busy' } });
  const result = await cli(['upload', clip(tempDir(), 'talk.mp4', 1000, 64)], { apiUrl: api.url });
  expect(result.code).toBe(EXIT_REFUSED);
  expect(result.stderr).toContain(`next: ${SERVER_STEP}`);
  expect(api.to('POST', '/api/v1/projects/uploads')).toHaveLength(1);
});

describe('export', () => {
  test('one that got no answer looks before sending again', async () => {
    api.on(
      'GET',
      '/api/v1/projects/v1',
      { status: 200, json: { state: 'awaiting_approval', rev: 3, approved_rev: 2 } },
      { status: 200, json: { state: 'rendering', rev: 3, approved_rev: 2 } },
    );
    api.on('POST', '/api/v1/projects/v1/export', 'reset');
    const result = await cli(['export', 'v1'], { apiUrl: api.url });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    const exports = api.to('POST', '/api/v1/projects/v1/export');
    expect(exports).toHaveLength(WRITE_RETRIES + 1);
    expect(new Set(exports.map((call) => call.headers['idempotency-key'])).size).toBe(1);
    expect(json(exports[0]?.body ?? Buffer.from('{}'))).toEqual({ rev: 3 });
    expect(result.stdout).toContain('Next: solara wait v1 --until export');
  });

  test('an exported rev is not exported again', async () => {
    api.on('GET', '/api/v1/projects/v1', {
      status: 200,
      json: { state: 'awaiting_approval', rev: 3, approved_rev: 3 },
    });
    const result = await cli(['export', 'v1'], { apiUrl: api.url });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain('Rev 3 is already exported or exporting.');
    expect(api.to('POST', '/api/v1/projects/v1/export')).toEqual([]);
  });
});

describe('download', () => {
  test('fetches the presigned URL without the key, into the file', async () => {
    const out = join(tempDir(), 'v1.mp4');
    api.on('GET', '/api/v1/projects/v1/download', { status: 200, json: { url: `${api.url}/cdn/v1.mp4?sig=1` } });
    api.on('GET', '/cdn/v1.mp4?sig=1', { status: 200, raw: 'MP4DATA', headers: { 'Content-Type': 'video/mp4' } });
    const result = await cli(['download', 'v1', '--out', out], { apiUrl: api.url });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    expect(readFileSync(out, 'utf8')).toBe('MP4DATA');
    expect(result.stdout).toContain(`Saved ${out} (7 bytes).`);
    expect(api.to('GET', '/cdn/v1.mp4?sig=1')[0]?.headers.authorization).toBeUndefined();
  });

  test('before any export says export first, not check the id', async () => {
    // The API's answer for a video never exported (live on a slot, 2026-10-17): a bare 404, which
    // the agent read as a wrong id.
    api.on('GET', '/api/v1/projects/v1/download', {
      status: 404,
      json: { title: 'Not Found', status: 404, detail: 'export not found' },
    });
    api.on('GET', '/api/v1/projects/v1', {
      status: 200,
      json: { state: 'awaiting_plan_review', rev: 1, approved_rev: 0 },
    });
    const result = await cli(['download', 'v1'], { apiUrl: api.url });
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr).toContain(`next: ${nextSteps('solara').not_exported}`);
  });

  test('of an unknown video still says check the id', async () => {
    api.on('GET', '/api/v1/projects/v1/download', { status: 404, json: { detail: 'project not found' } });
    api.on('GET', '/api/v1/projects/v1', {
      status: 404,
      json: { detail: 'project not found', code: 'project_not_found' },
    });
    const result = await cli(['download', 'v1'], { apiUrl: api.url });
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr).toContain('next: Not found. Check the id.');
  });
});

test('a 422 names the value that was wrong', async () => {
  // The API's 422 body, as a slot answered it: the detail alone was "validation failed".
  api.on('GET', '/api/v1/projects/nope', {
    status: 422,
    json: {
      status: 422,
      detail: 'validation failed',
      errors: [{ message: 'invalid value: invalid uuid', location: 'path.id', value: 'nope' }],
    },
  });
  const result = await cli(['status', 'nope', '--json'], { apiUrl: api.url });
  expect(result.code).toBe(EXIT_REFUSED);
  expect(result.stderr).toContain('solara: validation failed (path.id: invalid value: invalid uuid)');
  expect(JSON.parse(result.stdout).detail).toBe('validation failed');
});
