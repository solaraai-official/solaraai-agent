// The source file: its length from the MP4/MOV header, its display size from ffprobe, and the files
// the CLI refuses before sending anything.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync } from 'node:fs';
import { EXIT_USAGE } from '../src/errors';
import { mp4DurationMs } from '../src/media';
import { cli, type FakeApi, startFakeApi } from './fake-api';
import { box, clip, FTYP, mvhd, tempDir, writeFile } from './mp4';

let api: FakeApi;
let dir: string;

beforeEach(async () => {
  api = await startFakeApi();
  dir = tempDir();
});
afterEach(() => api.close());

test('reads the length from mvhd wherever moov sits', async () => {
  expect(await mp4DurationMs(writeFile(dir, 'a.mp4', Buffer.concat([FTYP, box('moov', mvhd(0, 1000, 12_345))])))).toBe(
    12_345,
  );
  // moov after the media, a 64-bit mdat, and an mvhd version 1 with a 90 kHz timescale.
  const mdat = Buffer.alloc(16 + 32);
  mdat.writeUInt32BE(1, 0);
  mdat.write('mdat', 4, 'latin1');
  mdat.writeBigUInt64BE(BigInt(16 + 32), 8);
  const moov = box('moov', mvhd(1, 90_000, 90_000 * 61));
  expect(await mp4DurationMs(writeFile(dir, 'b.mov', Buffer.concat([FTYP, mdat, moov])))).toBe(61_000);
  expect(await mp4DurationMs(writeFile(dir, 'c.mp4', Buffer.concat([FTYP, box('free', Buffer.alloc(4))])))).toBeNull();
});

test('a clip whose length cannot be read asks for it, and sends nothing', async () => {
  const webm = writeFile(dir, 'd.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const result = await cli(['upload', webm], { apiUrl: api.url, env: { PATH: dir } });
  expect(result.code).toBe(EXIT_USAGE);
  expect(result.stderr).toContain('--duration-ms');
  expect(api.calls).toEqual([]);
});

test('only the video files Solara takes are uploaded', async () => {
  const avi = clip(dir, 'talk.avi', 1000, 64);
  const result = await cli(['upload', avi], { apiUrl: api.url });
  expect(result.code).toBe(EXIT_USAGE);
  expect(result.stderr).toContain('Solara takes .mp4, .mov and .webm files');
  expect((await cli(['upload', `${dir}/missing.mp4`], { apiUrl: api.url })).stderr).toContain('no such file');
  expect(api.calls).toEqual([]);
});

describe("start --file sends the display size, with a phone's quarter turn applied", () => {
  // The API makes a clip filmed sideways 16:9 where landscape is offered: an upright phone clip is a
  // sideways stream turned a quarter, so its display size is the other way round.
  const answers: Record<string, unknown> = {
    sideways: { streams: [{ width: 1920, height: 1080 }] },
    upright: { streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] },
    tagged: { streams: [{ width: 1920, height: 1080, tags: { rotate: '270' } }] },
  };

  async function startWith(name: string, path: string): Promise<Record<string, unknown>> {
    const file = clip(dir, `${name}.mp4`, 4000, 64);
    api.on('POST', '/api/v1/projects', { status: 201, json: { video_id: 'v1', state: 'processing' } });
    const result = await cli(['start', '--upload', 'u1', '--file', file], { apiUrl: api.url, env: { PATH: path } });
    expect(result.code, result.stderr).toBe(0);
    return JSON.parse(api.to('POST', '/api/v1/projects').at(-1)?.body.toString() ?? '{}');
  }

  test.each(Object.keys(answers))('%s', async (name) => {
    const bin = tempDir();
    const ffprobe = writeFile(
      bin,
      'ffprobe',
      `#!/bin/sh\nfor last; do :; done\ncase "$last" in ${Object.entries(answers)
        .map(([key, value]) => `*${key}.mp4) echo '${JSON.stringify(value)}' ;;`)
        .join(' ')} esac\n`,
    );
    chmodSync(ffprobe, 0o755);
    const sent = await startWith(name, `${bin}:/usr/bin:/bin`);
    const expected = name === 'sideways' ? [1920, 1080] : [1080, 1920];
    expect([sent.source_width, sent.source_height]).toEqual(expected);
    expect(sent.source_duration_ms).toBe(4000);
  });

  test('without ffprobe, no size is sent', async () => {
    const sent = await startWith('sideways', dir);
    expect(sent.source_width).toBeUndefined();
    expect(sent.source_duration_ms).toBe(4000);
  });
});
