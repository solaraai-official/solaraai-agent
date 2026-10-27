// The source file: its type, its length and its display size. The length comes from the MP4/MOV
// header itself, so nothing needs to be installed; ffprobe is used when present.

import { execFile } from 'node:child_process';
import { type FileHandle, open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { EXIT_USAGE, SERVER_STEP, SolaraError } from './errors';

export const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function contentTypeFor(path: string): string {
  const type = CONTENT_TYPES[extname(path).toLowerCase()];
  if (!type) {
    throw new SolaraError(
      `${basename(path)}: Solara takes .mp4, .mov and .webm files`,
      'Convert the video to MP4 first.',
      {
        exitCode: EXIT_USAGE,
      },
    );
  }
  return type;
}

interface Box {
  kind: string;
  payload: number;
  end: number;
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** The ISO-BMFF boxes between start and end. */
async function boxes(handle: FileHandle, start: number, end: number): Promise<Box[]> {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const header = await readAt(handle, offset, 8);
    if (header.length < 8) break;
    let size = header.readUInt32BE(0);
    const kind = header.toString('latin1', 4, 8);
    let payload = offset + 8;
    if (size === 1) {
      const large = await readAt(handle, offset + 8, 8);
      if (large.length < 8) break;
      size = Number(large.readBigUInt64BE(0));
      payload = offset + 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < payload - offset) break;
    found.push({ kind, payload, end: offset + size });
    offset += size;
  }
  return found;
}

/** An mvhd box's duration in ms: version 1 has 64-bit times, version 0 32-bit ones. */
async function mvhdDurationMs(handle: FileHandle, payload: number): Promise<number | null> {
  const version = (await readAt(handle, payload, 1))[0];
  if (version === undefined) return null;
  const isLong = version === 1;
  const fields = await readAt(handle, payload + 4 + (isLong ? 16 : 8), isLong ? 12 : 8);
  if (fields.length < (isLong ? 12 : 8)) return null;
  const timescale = fields.readUInt32BE(0);
  const duration = isLong ? Number(fields.readBigUInt64BE(4)) : fields.readUInt32BE(4);
  return timescale === 0 ? null : Math.round((duration * 1000) / timescale);
}

/** The movie's duration from moov/mvhd (MP4 and MOV), wherever moov sits; null if absent. */
export async function mp4DurationMs(path: string): Promise<number | null> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const moov = (await boxes(handle, 0, size)).find((box) => box.kind === 'moov');
    if (!moov) return null;
    const mvhd = (await boxes(handle, moov.payload, moov.end)).find((box) => box.kind === 'mvhd');
    return mvhd ? await mvhdDurationMs(handle, mvhd.payload) : null;
  } finally {
    await handle.close();
  }
}

/** ffprobe's answer, or null when it is missing or fails. */
function ffprobe(args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ffprobe', args, { env, timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

export async function ffprobeDurationMs(path: string, env: NodeJS.ProcessEnv): Promise<number | null> {
  const out = await ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], env);
  const seconds = Number.parseFloat(out?.trim() ?? '');
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

interface ProbedStream {
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number | string }[];
}

/**
 * The video's display size (rotation applied), as ffprobe reads it; null without ffprobe.
 *
 * A phone films upright as a sideways stream with a 90° rotation: 1920x1080 turned is 1080x1920.
 * The API makes a source at least 4:3 wide 16:9 when the workspace has landscape.
 */
export async function displaySizeOf(path: string, env: NodeJS.ProcessEnv): Promise<[number, number] | null> {
  const args = ['-v', 'error', '-select_streams', 'v:0'];
  args.push('-show_entries', 'stream=width,height:stream_tags=rotate:stream_side_data=rotation', '-of', 'json', path);
  const out = await ffprobe(args, env);
  if (out === null) return null;
  let stream: ProbedStream | undefined;
  try {
    stream = (JSON.parse(out) as { streams?: ProbedStream[] }).streams?.[0];
  } catch {
    return null;
  }
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!stream || !Number.isInteger(width) || !Number.isInteger(height)) return null;
  const rotation = stream.tags?.rotate || stream.side_data_list?.find((side) => 'rotation' in side)?.rotation || 0;
  const quarterTurn = Math.round(Math.abs(Number(rotation)) / 90) % 2 === 1;
  return quarterTurn ? [height, width] : [width, height];
}

export async function durationMsOf(path: string, env: NodeJS.ProcessEnv, cli: string): Promise<number> {
  const duration = (await mp4DurationMs(path)) || (await ffprobeDurationMs(path, env));
  if (!duration) {
    throw new SolaraError(
      `couldn't read how long ${basename(path)} is`,
      `Pass it yourself: \`${cli} start ... --duration-ms <milliseconds>\`.`,
      { exitCode: EXIT_USAGE },
    );
  }
  return duration;
}

/** [part number, first byte, end byte] of each part; the last part is the remainder. */
export function partRanges(size: number, partSize: number, totalParts: number): [number, number, number][] {
  if (!(partSize > 0) || !(totalParts > 0)) throw new SolaraError('the upload has no parts', SERVER_STEP);
  return Array.from({ length: totalParts }, (_, i) => [i + 1, i * partSize, Math.min((i + 1) * partSize, size)]);
}
