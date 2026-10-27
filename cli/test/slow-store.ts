// A storage stand-in that takes an upload slowly but steadily. It runs inside the Node harness, not
// under Bun: it reads with `socket.read(n)` in paused mode, which on Node drains the kernel at the
// pace of those reads (Bun's net sockets don't), so the sender waits a few ms for room, never long.

import { type AddressInfo, createServer, type Socket } from 'node:net';

const SLICE = 16 * 1024;
const BEAT_MS = 8;

/** Reads each request 16 KiB every 8 ms (about 2 MB/s) for `slowMs`, then the rest at once, and
 * answers like S3. Returns its base URL. */
export async function startSlowStore(slowMs: number): Promise<string> {
  const server = createServer((socket) => readsSlowly(socket, slowMs));
  server.unref();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function readsSlowly(socket: Socket, slowMs: number): void {
  const start = performance.now();
  let head = Buffer.alloc(0);
  let length = -1;
  let received = 0;
  const answer = () => socket.end('HTTP/1.1 200 OK\r\nETag: "e1"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  const beat = setInterval(() => {
    if (length < 0) {
      const block = socket.read() as Buffer | null;
      if (!block) return;
      head = Buffer.concat([head, block]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      length = Number(/content-length:\s*(\d+)/i.exec(head.subarray(0, end).toString())?.[1] ?? 0);
      received = head.length - end - 4;
    }
    if (performance.now() - start < slowMs && received < length) {
      const block = socket.read(Math.min(SLICE, length - received)) as Buffer | null;
      received += block?.length ?? 0;
      return;
    }
    clearInterval(beat);
    if (received >= length) {
      answer();
      return;
    }
    socket.on('data', (block: Buffer) => {
      received += block.length;
      if (received >= length) answer();
    });
  }, BEAT_MS);
  socket.on('error', () => socket.destroy());
  socket.on('close', () => clearInterval(beat));
}
