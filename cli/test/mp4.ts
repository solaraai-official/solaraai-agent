// Minimal ISO-BMFF files: just the boxes the CLI reads a clip's length from.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function box(kind: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(kind, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

export function mvhd(version: 0 | 1, timescale: number, duration: number): Buffer {
  const fields = Buffer.alloc(version === 1 ? 4 + 16 + 12 : 4 + 8 + 8);
  fields[0] = version;
  if (version === 1) {
    fields.writeUInt32BE(timescale, 20);
    fields.writeBigUInt64BE(BigInt(duration), 24);
  } else {
    fields.writeUInt32BE(timescale, 12);
    fields.writeUInt32BE(duration, 16);
  }
  return box('mvhd', Buffer.concat([fields, Buffer.alloc(80)]));
}

export const FTYP = box('ftyp', Buffer.from('isom\0\0\0\0isom', 'latin1'));

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'solara-cli-'));
}

export function writeFile(dir: string, name: string, data: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
}

/** A clip `ms` long whose total size is `size` bytes (the media itself is zeros). */
export function clip(dir: string, name: string, ms: number, size: number): string {
  const head = Buffer.concat([FTYP, box('moov', mvhd(0, 1000, ms))]);
  return writeFile(dir, name, Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]));
}
