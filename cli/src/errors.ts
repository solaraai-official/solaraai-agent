// Exit codes, and what the agent should do next after each refusal the API can give an API key.

export const EXIT_OK = 0;
/** The API or the file refused: the `next:` line says what to do. */
export const EXIT_REFUSED = 1;
/** Bad arguments, or no API key. */
export const EXIT_USAGE = 2;
/** Not ready yet: run the same command again later. */
export const EXIT_NOT_READY = 3;

export type JsonObject = Record<string, unknown>;

export interface SolaraErrorOptions {
  status?: number;
  code?: string;
  body?: unknown;
  retryAfter?: number | null;
  exitCode?: number;
}

/** A refusal with what to do next. Exit code 1 by default (3 for not ready, 2 for bad arguments). */
export class SolaraError extends Error {
  readonly nextStep: string;
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  readonly retryAfter: number | null;
  readonly exitCode: number;

  constructor(message: string, nextStep = '', options: SolaraErrorOptions = {}) {
    super(message);
    this.name = 'SolaraError';
    this.nextStep = nextStep;
    this.status = options.status ?? 0;
    this.code = options.code ?? '';
    this.body = options.body;
    this.retryAfter = options.retryAfter ?? null;
    this.exitCode = options.exitCode ?? EXIT_REFUSED;
  }
}

/**
 * What the agent should do next, by the API's error code. Every refusal the API can give an API key
 * is here (services/backend/internal/transport); an unknown code falls back to the HTTP status.
 * `cli` is how this run was started (`solara`, or `npx -y solaraai`), so a next step can be pasted.
 */
export function nextSteps(cli: string): Record<string, string> {
  return {
    api_key_invalid: 'Check SOLARA_API_KEY: copy the key again from Settings -> API keys in the Solara app.',
    api_key_revoked: 'This key was revoked. Ask the account owner for a new key (Settings -> API keys).',
    api_key_not_allowed: "API keys can't do this. Ask the person to do it in the Solara app.",
    insufficient_scope: 'This key lacks the permission. Ask the account owner for a key that has it.',
    agent_api_off: 'API access is off for this workspace. Tell the person to contact Solara support.',
    plan_required:
      'API keys need a paid plan. Tell the person; they subscribe in the Solara app. Never try to subscribe yourself.',
    subscription_required: 'A paid plan is required. Tell the person; they subscribe in the Solara app.',
    allowance_used: "This month's videos are used up. Tell the person; don't retry.",
    api_key_daily_limit:
      "This key started its videos for today (UTC). Wait until after midnight UTC; don't retry sooner.",
    api_key_rate_limited: 'Too many requests this minute. Wait for Retry-After, then continue.',
    agent_spend_limit:
      "This workspace reached today's limit for agent work. Tell the person; retry after midnight UTC.",
    export_limit: 'This video hit its export limit for today. Wait for Retry-After before exporting it again.',
    idempotency_in_progress: `The same request is still running or was interrupted. Run \`${cli} status <video_id>\` before sending anything new.`,
    idempotency_key_reused:
      'That Idempotency-Key was used for a different request. Send a new key (omit --idempotency-key).',
    idempotency_key_required: `This request needs an Idempotency-Key. Run \`${cli} --version\` and update the CLI.`,
    project_not_found: 'No such video in this workspace. Check the video id.',
    plan_changed: `The edit changed. Run \`${cli} status <video_id>\` and export its current rev.`,
    not_exported: `Export the video first: \`${cli} export <video_id>\`.`,
    not_editable: `The video can't be changed in its current state. Run \`${cli} status <video_id>\`.`,
    free_limit: 'This workspace is out of free videos. Tell the person; they need a paid plan.',
    edit_timing_off:
      "Pause length and speed aren't offered to this workspace. Tell the person and ask whether to start without them (drop --pause-ms and --speed).",
    landscape_off:
      "16:9 isn't offered to this workspace yet. Tell the person and ask whether to make it 9:16 instead (drop --aspect).",
  };
}

function statusSteps(cli: string): Record<number, string> {
  return {
    400: "The request was malformed. Check the command's arguments.",
    401: 'Check SOLARA_API_KEY: copy the key again from Settings -> API keys.',
    402: 'A paid plan is required. Tell the person; they manage billing in the Solara app.',
    403: "API keys can't do this. Ask the person to do it in the Solara app.",
    404: 'Not found. Check the id.',
    409: `The video isn't in a state that allows this. Run \`${cli} status <video_id>\`.`,
    413: 'The file is too big: at most 2 GB.',
    422: 'The API refused the values sent. Read the detail and fix the arguments.',
    429: 'Too many requests. Wait for the Retry-After time, then try again.',
  };
}

export const SERVER_STEP = 'Solara had a problem. Wait a minute and run the same command again (it is safe to repeat).';
export const NETWORK_STEP =
  'No answer in time. Check the network, then run the same command again (it is safe to repeat).';

/** The next step for a refusal: by its code, else by its status (0 is no answer at all). */
export function nextStepFor(status: number, code: string, cli = 'solara'): string {
  const byCode = nextSteps(cli)[code];
  if (byCode) return byCode;
  if (status === 0) return NETWORK_STEP;
  if (status >= 500) return SERVER_STEP;
  return statusSteps(cli)[status] ?? "Read the detail above; don't retry the same request unchanged.";
}
