// The CLI's network waits, on Node, against real sockets on 127.0.0.1: a server that never answers,
// an upload the far end stops reading, an answer that trickles in, and a slow upload that keeps
// moving (which must NOT be cut off). Each proves a wait ends, and how soon.

import { afterEach, beforeAll, expect, test } from 'bun:test';
import { createServer as createHttpServer } from 'node:http';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { WRITE_RETRIES } from '../src/client';
import { EXIT_REFUSED } from '../src/errors';
import { KEY } from './fake-api';
import { clip, tempDir } from './mp4';

const IDLE_MS = 400;
const servers: Server[] = [];
let harness = '';

beforeAll(async () => {
  const outdir = tempDir();
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, 'node-harness.ts')],
    outdir,
    target: 'node',
    format: 'esm',
  });
  expect(built.success).toBe(true);
  harness = join(outdir, 'node-harness.js');
});

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

interface Sent {
  status?: number;
  etag?: string;
  error?: string;
  message?: string;
  took: number;
}

async function onNode(
  args: string[],
  env: Record<string, string> = {},
  limits: object = { idleMs: IDLE_MS },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(['node', harness, ...args], {
    env: { PATH: process.env.PATH ?? '', HARNESS_LIMITS: JSON.stringify(limits), ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

async function send(request: object, limits?: object): Promise<Sent> {
  const { stdout, stderr } = await onNode(['send', JSON.stringify(request)], {}, limits);
  expect(stdout, stderr).not.toBe('');
  return JSON.parse(stdout) as Sent;
}

/** A raw TCP server whose handler gets each connection; returns its base URL. */
async function tcpServer(handler: (socket: Socket) => void): Promise<string> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => socket.destroy());
    handler(socket);
  });
  server.on('close', () => {
    for (const socket of sockets) socket.destroy();
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Calls `onHead` once the request's head has arrived, and takes its body as it comes. */
function onRequest(socket: Socket, onHead: () => void): void {
  let head = '';
  socket.on('data', (block: Buffer) => {
    if (head.includes('\r\n\r\n')) return;
    head += block.toString('latin1');
    if (head.includes('\r\n\r\n')) onHead();
  });
}

/** Takes a request's body, then never answers. */
const neverAnswers = (socket: Socket) => onRequest(socket, () => undefined);
/** Takes the first block of a request, then stops reading. */
const stopsReading = (socket: Socket) => socket.once('data', () => socket.pause());

test('a server that never answers times out', async () => {
  const url = await tcpServer(neverAnswers);
  const sent = await send({ method: 'GET', url: `${url}/api/v1/styles` });
  expect(sent.error).toBe('NoAnswerError');
  expect(sent.took).toBeGreaterThanOrEqual(IDLE_MS * 0.9);
  expect(sent.took).toBeLessThan(IDLE_MS + 2000);
});

test('an upload the far end stops reading times out', async () => {
  const url = await tcpServer(stopsReading);
  const sent = await send({ method: 'PUT', url: `${url}/part1`, bodyBytes: 32 * 1024 * 1024 });
  expect(sent.error).toBe('NoAnswerError');
  expect(sent.took).toBeLessThan(IDLE_MS + 2000);
});

test('a slow upload that keeps moving is not cut off', async () => {
  // The hang QA saw with the first CLI: a part went out as one write, and a timeout on one write is a
  // deadline for the whole part, so every part on a slow uplink failed at the timeout and was retried
  // in silence. Here the part takes three idle limits to send, steadily, and arrives. The store runs
  // in the Node harness (test/slow-store.ts); the idle limit is 1 s, not 0.4 s, so a busy CI machine
  // pausing the store for a few hundred ms is not mistaken for a stall.
  const idleMs = 1000;
  const request = { method: 'PUT', slowStoreMs: 3 * idleMs, bodyBytes: 32 * 1024 * 1024 };
  const sent = await send(request, { idleMs });
  expect(sent.status, sent.message).toBe(200);
  expect(sent.etag).toBe('"e1"');
  expect(sent.took).toBeGreaterThanOrEqual(3 * idleMs); // it outlasted the idle limit three times over
});

test('an answer that trickles in stops at the deadline', async () => {
  const url = await tcpServer((socket) => {
    onRequest(socket, () => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\nConnection: close\r\n\r\n');
      const drip = setInterval(() => socket.write('x'), 100);
      socket.on('close', () => clearInterval(drip));
    });
  });
  const sent = await send(
    { method: 'GET', url: `${url}/v1.mp4` },
    { idleMs: IDLE_MS, requestMs: 1000, minBytesPerSecond: 1e9 },
  );
  expect(sent.error).toBe('NoAnswerError');
  expect(sent.message).toBe('the answer took too long to arrive');
  expect(sent.took).toBeGreaterThanOrEqual(1000);
  expect(sent.took).toBeLessThan(3000);
});

test('an upload to a store that stalls ends with a next step', async () => {
  const store = await tcpServer(stopsReading);
  const signed: string[] = [];
  const api = createHttpServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const parts = [{ part_number: 1, url: `${store}/p1` }];
      let body: object = { parts, completed_parts: [] };
      if (req.url?.endsWith('/projects/uploads')) {
        body = { upload_id: 'u1', part_size: 8 * 1024 * 1024, total_parts: 1, parts };
      } else {
        signed.push(req.url ?? '');
      }
      res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
  try {
    const file = clip(tempDir(), 'talk.mp4', 15_840, 8 * 1024 * 1024);
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const start = performance.now();
    const result = await onNode(['cli', 'upload', file], { SOLARA_API_KEY: KEY, SOLARA_API_URL: apiUrl });
    const took = performance.now() - start;
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr.match(/retrying in/g)).toHaveLength(WRITE_RETRIES);
    expect(result.stderr).toContain(`failed ${WRITE_RETRIES + 1} times`);
    expect(result.stderr).toContain('next: Check the network');
    expect(took).toBeLessThan((WRITE_RETRIES + 1) * (IDLE_MS + 1000));
    expect(signed).toHaveLength(WRITE_RETRIES); // each retry re-signs the part
  } finally {
    api.close();
  }
});
