// Exit codes, and what the agent should do next after each refusal the API can give an API key.

export const EXIT_OK = 0;
/** The API or the file refused: the `next:` line says what to do. */
export const EXIT_REFUSED = 1;
/** Bad arguments, or not signed in (no sign-in and no API key). */
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

/** How a run authenticates: the stored sign-in (`login`), or the environment's API key. */
export type AuthKind = 'login' | 'key';

/** The refusals that read differently for a sign-in than for an API key. */
function credentialSteps(cli: string, auth: AuthKind): Record<string, string> {
  const login = `Run \`${cli} login\` yourself, give the person the link and the code it prints, and wait while they choose Allow in Solara. Never ask them for a key or a token.`;
  if (auth === 'login') {
    return {
      api_key_invalid: `The sign-in ended. ${login}`,
      api_key_revoked: `The sign-in was disconnected in Solara. ${login}`,
      api_key_not_allowed: "The CLI can't do this. Ask the person to do it in the Solara app.",
      insufficient_scope: `The sign-in lacks this permission. ${login}`,
    };
  }
  return {
    api_key_invalid: `SOLARA_API_KEY was refused. ${login} On a server, the person sets a working key where you run.`,
    api_key_revoked: `This key was revoked. ${login} On a server, the person sets a new key where you run.`,
    api_key_not_allowed: "API keys can't do this. Ask the person to do it in the Solara app.",
    insufficient_scope: `This key lacks the permission. ${login}`,
  };
}

/**
 * What the agent should do next, by the API's error code. Every refusal the API can give a key or
 * a sign-in is here (services/backend/internal/transport); an unknown code falls back to the HTTP
 * status. `cli` is how this run was started (`solara`, or `npx -y solaraai`), so a next step can be
 * pasted; `auth` how it authenticated.
 */
export function nextSteps(cli: string, auth: AuthKind = 'key'): Record<string, string> {
  return {
    ...credentialSteps(cli, auth),
    agent_api_off: 'API access is off for this workspace. Tell the person to contact Solara support.',
    // A key follows the workspace's plan (owner, 2026-11-05): on the free plan it meets the free
    // plan's limits where the app shows them to the person.
    plan_required:
      "The workspace's plan doesn't cover this: on the free plan, its one export is used, or this downloads or posts a video Solara edited. " +
      'Tell the person: "You\'ve used your free export: upgrade to keep going" (app.solaraai.com/plans). Never subscribe yourself.',
    subscription_required:
      "The free plan's videos are used, or the recording is longer than the free plan takes. Tell the person: upgrade to keep going (app.solaraai.com/plans), or use a shorter clip. Never subscribe yourself.",
    allowance_used: "This month's videos are used up. Tell the person; don't retry.",
    api_key_daily_limit:
      "This sign-in or key started its videos for today (UTC). Wait until after midnight UTC; don't retry sooner.",
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
    free_limit:
      'This free video used its free AI pictures and music tracks. Tell the person: upgrading lifts the cap (app.solaraai.com/plans). Never subscribe yourself.',
    edit_timing_off:
      "Pause length and speed aren't offered to this workspace. Tell the person and ask whether to start without them (drop --pause-ms and --speed).",
    landscape_off:
      "16:9 isn't offered to this workspace yet. Tell the person and ask whether to make it 9:16 instead (drop --aspect).",
    // upload-url: a link Solara would not, or could not, fetch.
    url_not_allowed:
      'Solara refused the link (the detail says why). Ask the person for a public share link to the video file itself (Google Drive: Share -> Anyone with the link; Dropbox: Copy link).',
    url_not_public: `The link isn't public. Ask the person to share it as Anyone with the link (Google Drive) or to copy a Dropbox link, then run \`${cli} upload-url\` again.`,
    url_unreachable: `Solara couldn't download the file (the detail says why). Ask the person whether the link opens in a private window, or for the file itself: \`${cli} upload <file>\`.`,
    not_a_video: "The link isn't an .mp4, .mov or .webm video. Ask the person for the link to the video file itself.",
    video_too_large:
      'The file is over what Solara fetches (the detail says: 2 GB, less on the free plan). Ask the person for a smaller export or a shorter clip.',
    video_too_long: 'The video is over 10 minutes. Ask the person for a clip of 10 minutes or less.',
    url_fetches_busy:
      'Solara is already fetching videos (the detail says whose). Wait a minute for one to finish, then run the same command again.',
    url_fetch_daily_limit: `The free plan fetches a few videos a day from links, and this workspace has today (UTC). Tell the person: they can upload the file (\`${cli} upload <file>\`), wait until after midnight UTC, or upgrade (app.solaraai.com/plans). Never subscribe yourself.`,
  };
}

function statusSteps(cli: string, auth: AuthKind): Record<number, string> {
  return {
    400: "The request was malformed. Check the command's arguments.",
    401: credentialSteps(cli, auth).api_key_invalid ?? '',
    402: "The workspace's plan doesn't cover this. Tell the person they can upgrade at app.solaraai.com/plans; never subscribe yourself.",
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
export function nextStepFor(status: number, code: string, cli = 'solara', auth: AuthKind = 'key'): string {
  const byCode = nextSteps(cli, auth)[code];
  if (byCode) return byCode;
  if (status === 0) return NETWORK_STEP;
  if (status >= 500) return SERVER_STEP;
  return statusSteps(cli, auth)[status] ?? "Read the detail above; don't retry the same request unchanged.";
}
