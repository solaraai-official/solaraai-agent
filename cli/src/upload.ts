// The multipart upload: open it, PUT each part to its presigned URL (never with the API key),
// re-sign what failed, then complete it with every part's ETag in order.

import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { type Client, WRITE_RETRIES } from './client';
import { EXIT_USAGE, type JsonObject, SERVER_STEP, SolaraError } from './errors';
import { type HttpAnswer, NoAnswerError } from './http';
import { contentTypeFor, partRanges } from './media';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export interface Uploaded {
  upload_id: string;
  size_bytes: number;
}

function partUrls(answer: JsonObject): Map<number, string> {
  const urls = new Map<number, string>();
  for (const part of Array.isArray(answer.parts) ? (answer.parts as JsonObject[]) : []) {
    urls.set(Number(part.part_number), String(part.url));
  }
  return urls;
}

/** The file's size, or a refusal that says why it can't be uploaded. */
export async function uploadableSize(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new SolaraError(`no such file: ${path}`, 'Check the path.', { exitCode: EXIT_USAGE });
  if (info.size <= 0 || info.size > MAX_UPLOAD_BYTES) {
    throw new SolaraError(
      `${basename(path)} is ${info.size} bytes: Solara takes 1 byte to 2 GB`,
      'Trim or compress the video.',
      { exitCode: EXIT_USAGE },
    );
  }
  return info.size;
}

export async function uploadFile(client: Client, path: string, note: (line: string) => void): Promise<Uploaded> {
  const size = await uploadableSize(path);
  const opened = await client.call('POST', '/projects/uploads', {
    content_type: contentTypeFor(path),
    size_bytes: size,
  });
  const uploadId = typeof opened.upload_id === 'string' ? opened.upload_id : '';
  if (!uploadId) throw new SolaraError('Solara opened the upload without an upload_id', SERVER_STEP, { body: opened });
  const urls = partUrls(opened);
  const total = Number(opened.total_parts);
  const ranges = partRanges(size, Number(opened.part_size), total);
  note(`solara: uploading ${basename(path)}: ${(size / 1e6).toFixed(1)} MB in ${total} part(s)`);
  const etags = new Map<number, string>();
  const handle = await open(path, 'r');
  try {
    for (const [number, start, end] of ranges) {
      const chunk = Buffer.alloc(end - start);
      await handle.read(chunk, 0, chunk.length, start);
      etags.set(number, await putPart(client, uploadId, [number, total], urls, chunk, note));
      note(`solara: uploaded part ${number}/${total}`);
    }
  } finally {
    await handle.close();
  }
  const parts = [...etags.keys()].sort((a, b) => a - b).map((n) => ({ part_number: n, etag: etags.get(n) }));
  const done = await client.call('POST', `/projects/uploads/${uploadId}/complete`, { parts });
  return { upload_id: uploadId, size_bytes: typeof done.size_bytes === 'number' ? done.size_bytes : size };
}

/** One PUT of a part to its presigned URL: its ETag, or what went wrong. */
async function tryPut(client: Client, url: string, chunk: Buffer): Promise<{ etag: string } | { problem: string }> {
  let answer: HttpAnswer;
  try {
    answer = await client.transport({ method: 'PUT', url, headers: {}, body: chunk });
  } catch (error) {
    if (!(error instanceof NoAnswerError)) throw error;
    return { problem: `no answer (${error.message})` };
  }
  const etag = answer.headers.etag;
  return answer.status >= 200 && answer.status < 300 && etag ? { etag } : { problem: `HTTP ${answer.status}` };
}

/** PUTs one part, at most WRITE_RETRIES + 1 times, saying so on each failure; a retry first
 * re-signs the part (or learns it already arrived). */
async function putPart(
  client: Client,
  uploadId: string,
  [number, total]: [number, number],
  urls: Map<number, string>,
  chunk: Buffer,
  note: (line: string) => void,
): Promise<string> {
  let problem = 'no upload URL for it';
  for (let attempt = 0; ; attempt++) {
    const url = urls.get(number);
    const tried = url ? await tryPut(client, url, chunk) : { problem: 'no upload URL for it' };
    if ('etag' in tried) return tried.etag;
    problem = tried.problem;
    if (attempt === WRITE_RETRIES) break;
    const wait = 2 * (attempt + 1);
    note(`solara: part ${number}/${total}: ${problem}; retrying in ${wait}s (${attempt + 2} of ${WRITE_RETRIES + 1})`);
    await client.sleep(wait);
    const signed = await client.call('POST', `/projects/uploads/${uploadId}/parts`, { part_numbers: [number] });
    const held = (Array.isArray(signed.completed_parts) ? (signed.completed_parts as JsonObject[]) : []).find(
      (part) => Number(part.part_number) === number,
    );
    if (held) return String(held.etag);
    for (const [n, fresh] of partUrls(signed)) urls.set(n, fresh);
  }
  throw new SolaraError(
    `part ${number}/${total} of the upload failed ${WRITE_RETRIES + 1} times (last: ${problem})`,
    `Check the network, then run \`${client.cli} upload\` again (it starts a fresh upload).`,
  );
}
