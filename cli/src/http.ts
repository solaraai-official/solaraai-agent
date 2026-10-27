// The network: node:http and node:https, so it runs on any Node 20+ with nothing installed.
//
// Every wait is bounded. A connection that moves no byte for `idleMs` (connecting, sending or
// receiving) is stalled: Node's socket timeout counts a write still draining as movement, so a
// slow uplink that keeps moving is never cut off (the Python CLI's one-write-one-deadline hang).
// Every request also has an overall deadline that grows with its size, so an answer that trickles
// in still ends.
//
// HTTPS_PROXY / HTTP_PROXY / NO_PROXY apply, as they do for curl, so the CLI works in an agent
// sandbox that reaches the internet through a proxy.

import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import tls from 'node:tls';
import { EXIT_USAGE, SolaraError } from './errors';

export interface Limits {
  /** Connecting, or no byte sent or received for this long: the connection is stalled. */
  idleMs: number;
  /** A request's deadline before its bytes are counted. */
  requestMs: number;
  /** Each byte of a body adds 1/this of a second to the deadline. */
  minBytesPerSecond: number;
}

export const LIMITS: Limits = { idleMs: 30_000, requestMs: 90_000, minBytesPerSecond: 16 * 1024 };

/** No answer: a timeout, a refused or reset connection, or an answer cut short. */
export class NoAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAnswerError';
  }
}

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Uint8Array | null;
  /** Stream a 2xx answer's body to this file (written beside it, then renamed) instead of memory. */
  saveTo?: string;
}

export interface HttpAnswer {
  status: number;
  /** Lower-case names. */
  headers: Record<string, string>;
  body: Buffer;
  /** Bytes written to `saveTo`. */
  savedBytes: number;
}

export type Transport = (request: HttpRequest) => Promise<HttpAnswer>;

export function createTransport(env: NodeJS.ProcessEnv, limits: Limits = LIMITS): Transport {
  return (request) => send(request, env, limits);
}

async function send(request: HttpRequest, env: NodeJS.ProcessEnv, limits: Limits): Promise<HttpAnswer> {
  const target = parseHttpUrl(request.url);
  const body = request.body ?? null;
  const headers: Record<string, string> = { ...request.headers };
  if (body) {
    headers['Content-Length'] = String(body.length);
    headers['Content-Type'] ??= 'application/octet-stream';
  }
  let deadline = Date.now() + limits.requestMs + ((body?.length ?? 0) / limits.minBytesPerSecond) * 1000;
  const proxy = proxyFor(target, env);
  const options: https.RequestOptions = { method: request.method, headers, timeout: limits.idleMs };
  if (proxy && target.protocol === 'https:') {
    const socket = await tunnel(proxy, target, limits.idleMs);
    options.createConnection = () => tls.connect({ socket, servername: target.hostname });
  } else if (proxy) {
    // Plain HTTP through a proxy: the absolute URL as the path, to the proxy.
    Object.assign(options, { host: proxy.hostname, port: proxy.port || 80, path: target.href, agent: false });
    Object.assign(headers, proxyAuthorization(proxy), { Host: target.host });
  } else {
    options.agent = false;
  }
  const client = target.protocol === 'https:' ? https : http;

  return new Promise<HttpAnswer>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let tooLong = 'sending the request took too long';
    const req = proxy && target.protocol !== 'https:' ? client.request(options) : client.request(target, options);
    const finish = (error: Error | null, answer?: HttpAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req.destroy();
        reject(error);
      } else if (answer) {
        resolve(answer);
      }
    };
    const armDeadline = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new NoAnswerError(tooLong)), Math.max(0, deadline - Date.now()));
    };
    armDeadline();
    req.on('timeout', () => finish(new NoAnswerError('timed out')));
    req.on('error', (error) => finish(asNoAnswer(error)));
    req.on('response', (res) => {
      tooLong = 'the answer took too long to arrive';
      const length = Number(res.headers['content-length']);
      if (Number.isFinite(length) && length > 0) {
        deadline += (length / limits.minBytesPerSecond) * 1000;
        armDeadline();
      }
      const status = res.statusCode ?? 0;
      const answerHeaders = lowerCaseHeaders(res.headers);
      res.on('error', (error) => finish(asNoAnswer(error)));
      res.on('close', () => {
        if (!res.complete) finish(new NoAnswerError('the answer was cut short'));
      });
      if (request.saveTo && status >= 200 && status < 300) {
        saveBody(res, request.saveTo).then(
          (savedBytes) => finish(null, { status, headers: answerHeaders, body: Buffer.alloc(0), savedBytes }),
          (error: Error) => finish(asNoAnswer(error)),
        );
        return;
      }
      const blocks: Buffer[] = [];
      res.on('data', (block: Buffer) => blocks.push(block));
      res.on('end', () => finish(null, { status, headers: answerHeaders, body: Buffer.concat(blocks), savedBytes: 0 }));
    });
    req.end(body ?? undefined);
  });
}

async function saveBody(res: http.IncomingMessage, path: string): Promise<number> {
  const partial = `${path}.part`;
  let bytes = 0;
  try {
    await new Promise<void>((done, fail) => {
      const file = createWriteStream(partial);
      res.on('data', (block: Buffer) => {
        bytes += block.length;
      });
      res.on('error', fail);
      res.on('close', () => {
        if (!res.complete) fail(new NoAnswerError('the answer was cut short'));
      });
      file.on('error', fail);
      file.on('finish', done);
      res.pipe(file);
    });
    await rename(partial, path);
    return bytes;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new SolaraError(`refusing a non-HTTP URL: ${raw}`, 'Check SOLARA_API_URL.', { exitCode: EXIT_USAGE });
  }
  return url;
}

function asNoAnswer(error: unknown): Error {
  if (error instanceof NoAnswerError || error instanceof SolaraError) return error;
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return new NoAnswerError(error.message || code || error.name);
  }
  return new NoAnswerError(String(error));
}

function lowerCaseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

// --- Proxies ---------------------------------------------------------------------------------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** The proxy for this URL, as curl reads the environment: https_proxy for https, http_proxy for
 * http (lower case first), NO_PROXY's hosts and domains bypassed, and never for this machine. */
export function proxyFor(target: URL, env: NodeJS.ProcessEnv): URL | null {
  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOOPBACK.has(host)) return null;
  const isHttps = target.protocol === 'https:';
  const raw = isHttps ? (env.https_proxy ?? env.HTTPS_PROXY) : (env.http_proxy ?? env.HTTP_PROXY);
  if (!raw || bypassesProxy(host, env.no_proxy ?? env.NO_PROXY ?? '')) return null;
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    throw new SolaraError(
      `the proxy address ${isHttps ? 'HTTPS_PROXY' : 'HTTP_PROXY'} isn't a URL`,
      'Fix or unset it.',
      {
        exitCode: EXIT_USAGE,
      },
    );
  }
}

function bypassesProxy(host: string, noProxy: string): boolean {
  return noProxy
    .split(',')
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/:\d+$/, '')
        .replace(/^\*?\./, ''),
    )
    .some((entry) => entry === '*' || (entry !== '' && (host === entry || host.endsWith(`.${entry}`))));
}

function proxyAuthorization(proxy: URL): Record<string, string> {
  if (!proxy.username) return {};
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { 'Proxy-Authorization': `Basic ${Buffer.from(credentials).toString('base64')}` };
}

/** A CONNECT tunnel through the proxy to the target's host and port. */
function tunnel(proxy: URL, target: URL, idleMs: number): Promise<Socket> {
  const authority = `${target.hostname}:${target.port || 443}`;
  return new Promise((resolve, reject) => {
    const req = (proxy.protocol === 'https:' ? https : http).request({
      host: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority, ...proxyAuthorization(proxy) },
      timeout: idleMs,
      agent: false,
    });
    req.on('connect', (res, socket) => {
      req.setTimeout(0);
      if (res.statusCode === 200) {
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(new NoAnswerError(`the proxy answered ${res.statusCode} to CONNECT ${authority}`));
    });
    req.on('timeout', () => req.destroy(new NoAnswerError('the proxy did not answer in time')));
    req.on('error', (error) => reject(asNoAnswer(error)));
    req.end();
  });
}
