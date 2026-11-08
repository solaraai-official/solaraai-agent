// The Solara API with a sign-in or an API key: one call, its retries, and a refusal turned into a
// next step.

import { type JsonObject, nextStepFor, SolaraError } from './errors';
import { type HttpAnswer, NoAnswerError, type Transport } from './http';
import type { Credential } from './oauth';

export const DEFAULT_API_URL = 'https://api.solaraai.com';
export const WRITE_RETRIES = 3;
/** A retry never sleeps longer; a longer Retry-After ends the command, with it in the next step. */
const MAX_RETRY_WAIT_SECONDS = 60;

export type Sleep = (seconds: number) => Promise<void>;

export interface ClientOptions {
  /** The stored sign-in or the environment's key; never printed. */
  auth: Credential;
  apiUrl: string;
  transport: Transport;
  sleep: Sleep;
  log: (line: string) => void;
  userAgent: string;
  /** How this run was started (`solara`, or `npx -y solaraai`), for the next steps it prints. */
  cli: string;
}

/** Polling delays: start, x1.5 each time, never above cap, with a little jitter. */
export function* backoffDelays(start = 5, factor = 1.5, cap = 30): Generator<number, never> {
  let delay = start;
  while (true) {
    yield Math.min(cap, delay) * (0.9 + Math.random() * 0.2);
    delay = Math.min(cap, delay * factor);
  }
}

export function retryAfterSeconds(headers: Record<string, string>): number | null {
  const value = Number.parseFloat(headers['retry-after'] ?? '');
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

/** A write may be sent again with the SAME Idempotency-Key: no answer, a server error, or the first
 * attempt still running. */
function isRetryable(status: number, code: string): boolean {
  return status === 0 || status >= 500 || code === 'idempotency_in_progress';
}

/** The answer's JSON: {} when empty, and a non-JSON answer as its detail. */
export function answerJson(answer: Pick<HttpAnswer, 'body'>): unknown {
  if (answer.body.length === 0) return {};
  const text = answer.body.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 500) };
  }
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

export class Client {
  readonly apiUrl: string;
  readonly transport: Transport;
  readonly sleep: Sleep;
  readonly cli: string;
  readonly userAgent: string;
  readonly auth: Credential;
  private readonly log: (line: string) => void;

  constructor(options: ClientOptions) {
    this.auth = options.auth;
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.transport = options.transport;
    this.sleep = options.sleep;
    this.log = options.log;
    this.userAgent = options.userAgent;
    this.cli = options.cli;
  }

  private headers(bearer: string, hasBody: boolean, idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return headers;
  }

  private async once(
    bearer: string,
    method: string,
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<HttpAnswer> {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const url = `${this.apiUrl}/api/v1${path}`;
    try {
      const headers = this.headers(bearer, data !== null, idempotencyKey);
      return await this.transport({ method, url, headers, body: data });
    } catch (error) {
      if (!(error instanceof NoAnswerError)) throw error;
      const detail = JSON.stringify({ detail: `no answer from Solara (${error.message})` });
      return { status: 0, headers: {}, body: Buffer.from(detail), savedBytes: 0 };
    }
  }

  /** One request with the credential's bearer; a sign-in's refused token is renewed once. */
  private async send(method: string, path: string, body: unknown, idempotencyKey?: string): Promise<HttpAnswer> {
    const bearer = await this.auth.bearer();
    const answer = await this.once(bearer, method, path, body, idempotencyKey);
    if (answer.status !== 401 || !this.auth.renew) return answer;
    await this.auth.renew(bearer);
    return this.once(await this.auth.bearer(), method, path, body, idempotencyKey);
  }

  /**
   * One API call. A read is retried on no answer or a 5xx; a write only with an Idempotency-Key,
   * and always with the same one, so a retry never spends twice. A sign-in's token refused (401)
   * is refreshed once and the call sent again: a 401 ran no handler, so nothing was spent.
   */
  async call(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<JsonObject> {
    const retries = method === 'GET' || idempotencyKey ? WRITE_RETRIES : 0;
    const delays = backoffDelays(2, 1.5, 15);
    for (let attempt = 0; ; attempt++) {
      const answer = await this.send(method, path, body, idempotencyKey);
      if (answer.status >= 200 && answer.status < 300) return asObject(answerJson(answer));
      const payload = asObject(answerJson(answer));
      const code = typeof payload.code === 'string' ? payload.code : '';
      const wait = retryAfterSeconds(answer.headers) || delays.next().value;
      // A Retry-After longer than a retry would wait is the next step's to honour, not a sleep.
      if (attempt < retries && isRetryable(answer.status, code) && wait <= MAX_RETRY_WAIT_SECONDS) {
        const got = answer.status || payload.detail || 'no answer';
        this.log(
          `solara: ${method} ${path} got ${got}; retrying in ${wait.toFixed(0)}s (${attempt + 2} of ${retries + 1})`,
        );
        await this.sleep(wait);
        continue;
      }
      throw refusal(answer, payload, code, this.cli, this.auth.kind);
    }
  }
}

function refusal(
  answer: HttpAnswer,
  payload: JsonObject,
  code: string,
  cli: string,
  auth: Credential['kind'],
): SolaraError {
  let detail = String(payload.detail || payload.title || `HTTP ${answer.status}`);
  // A 422 says only "validation failed"; which value was wrong is in `errors`.
  const problems = (Array.isArray(payload.errors) ? payload.errors : [])
    .filter((error): error is JsonObject => error !== null && typeof error === 'object')
    .map((error) => `${error.location ?? '?'}: ${error.message ?? ''}`);
  if (problems.length > 0) detail = `${detail} (${problems.join('; ')})`;
  return new SolaraError(detail, nextStepFor(answer.status, code, cli, auth), {
    status: answer.status,
    code,
    body: payload,
    retryAfter: retryAfterSeconds(answer.headers),
  });
}
