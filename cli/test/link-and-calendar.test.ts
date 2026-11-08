// The two commands that follow the agent API past the file upload: a recording Solara fetches from a
// link (upload-url), and the posting calendar, read-only (calendar).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { calendarWindow } from '../src/calendar';
import { EXIT_NOT_READY, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, nextSteps } from '../src/errors';
import { cli, type FakeApi, startFakeApi } from './fake-api';

let api: FakeApi;

beforeEach(async () => {
  api = await startFakeApi();
});
afterEach(() => api.close());

const LINK = 'https://www.dropbox.com/s/abc/talk.mp4?dl=0';
const STATUS = '/api/v1/projects/uploads/status/u1';
const fetching = { status: 200, json: { upload_id: 'u1', status: 'fetching', size_bytes: 9000 } };

describe('upload-url', () => {
  test('starts the fetch once, waits until Solara has the file, and says how to start', async () => {
    api.on('POST', '/api/v1/projects/uploads/from-url', {
      status: 201,
      json: { upload_id: 'u1', status: 'fetching', size_bytes: 9000 },
    });
    const ready = {
      upload_id: 'u1',
      status: 'ready',
      size_bytes: 9000,
      content_type: 'video/mp4',
      duration_ms: 31_540,
    };
    api.on('GET', STATUS, fetching, { status: 200, json: ready });

    const result = await cli(['upload-url', LINK], { apiUrl: api.url });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    const [start] = api.to('POST', '/api/v1/projects/uploads/from-url');
    expect(JSON.parse(start?.body.toString() ?? '{}')).toEqual({ url: LINK });
    expect(start?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.stderr).toContain(`Idempotency-Key ${start?.headers['idempotency-key']}`);
    expect(result.sleeps).toHaveLength(1);
    expect(result.stdout).toContain('Fetched: upload_id u1, 31540 ms long.');
    expect(result.stdout).toContain('Next: solara start --upload u1 --duration-ms 31540 --style brass');

    const json = await cli(['upload-url', LINK, '--json'], { apiUrl: api.url });
    expect(JSON.parse(json.stdout)).toEqual(ready);
  });

  test('a link that is not public says what to ask the person', async () => {
    api.on('POST', '/api/v1/projects/uploads/from-url', { status: 201, json: { upload_id: 'u1', status: 'fetching' } });
    api.on('GET', STATUS, {
      status: 200,
      json: {
        upload_id: 'u1',
        status: 'failed',
        error: { code: 'url_not_public', message: 'the link asks to sign in' },
      },
    });
    const result = await cli(['upload-url', LINK], { apiUrl: api.url });
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr).toContain('solara: the link asks to sign in (url_not_public)');
    expect(result.stderr).toContain(`next: ${nextSteps('solara').url_not_public}`);
  });

  test('past the timeout it is not ready, and the same key picks the fetch up again', async () => {
    api.on('POST', '/api/v1/projects/uploads/from-url', { status: 201, json: { upload_id: 'u1', status: 'fetching' } });
    api.on('GET', STATUS, fetching);
    const first = await cli(['upload-url', LINK, '--timeout', '0'], { apiUrl: api.url });
    expect(first.code).toBe(EXIT_NOT_READY);
    const key = api.to('POST', '/api/v1/projects/uploads/from-url')[0]?.headers['idempotency-key'] ?? '';
    expect(first.stderr).toContain(`next: Run \`solara upload-url "${LINK}" --idempotency-key ${key}\` again.`);

    await cli(['upload-url', LINK, '--timeout', '0', '--idempotency-key', key], { apiUrl: api.url });
    expect(api.to('POST', '/api/v1/projects/uploads/from-url')[1]?.headers['idempotency-key']).toBe(key);
  });
});

describe('calendar', () => {
  test('reads the posts in the window and says which failed', async () => {
    const query = new URLSearchParams({
      posts_only: 'true',
      from: '2026-11-09T00:00:00.000Z',
      to: '2026-11-16T00:00:00.000Z',
      limit: '50',
    });
    api.on('GET', `/api/v1/videos?${query}`, {
      status: 200,
      json: {
        videos: [
          {
            id: 'v1',
            title: 'Runner tips',
            post_status: 'scheduled',
            publish_at: '2026-11-10T09:00:00Z',
            platforms: ['instagram', 'tiktok'],
          },
          {
            id: 'v2',
            post_kind: 'text',
            caption: 'We open on Saturday.',
            post_status: 'failed',
            publish_at: '2026-11-11T08:30:00Z',
            platforms: ['linkedin'],
            deliveries: [{ platform: 'linkedin', state: 'failed', failure: 'account_needs_reconnect' }],
          },
        ],
      },
    });
    const result = await cli(['calendar', '--from', '2026-11-09', '--to', '2026-11-16'], { apiUrl: api.url });
    expect(result.code, result.stderr).toBe(EXIT_OK);
    const out = result.stdout.split('\n');
    expect(out).toContain('  2026-11-10 09:00 UTC  scheduled  instagram, tiktok  "Runner tips"  (video_id v1)');
    expect(out).toContain('      linkedin: failed (account_needs_reconnect)');
    expect(result.stdout).toContain('They retry it in the Solara calendar; you cannot.');
    expect(result.stdout).toContain(`Calendar: ${api.url}/calendar`);
  });

  test('defaults to this week and next, from Monday 00:00 UTC', () => {
    const now = new Date('2026-11-05T15:00:00Z'); // a Thursday
    const window = calendarWindow(undefined, undefined, now);
    expect(window.from.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    const sunday = calendarWindow(undefined, undefined, new Date('2026-11-08T23:00:00Z'));
    expect(sunday.from.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  test('a date it cannot read is refused before anything is sent', async () => {
    for (const argv of [
      ['calendar', '--from', 'next week'],
      ['calendar', '--from', '2026-11-16', '--to', '2026-11-09'],
    ]) {
      const result = await cli(argv, { apiUrl: api.url });
      expect(result.code).toBe(EXIT_USAGE);
      expect(result.stderr).toContain('next: Run `solara calendar --help`');
    }
    expect(api.calls).toEqual([]);
  });
});
