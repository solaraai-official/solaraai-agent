// What a video's state means for the agent: its settings, when `wait` is done, and the app's links.

import { EXIT_USAGE, type JsonObject, SolaraError } from './errors';

export const DEFAULT_STYLE = 'brass';
export const PAUSE_MS_RANGE = [50, 500] as const;
export const SPEED_RANGE = [0.8, 2] as const;
export const ASPECTS = ['9:16', '16:9'] as const;
export const INTENSITIES = ['auto', 'light', 'medium', 'heavy'] as const;

export interface SettingsInput {
  style: string;
  prompt?: string | undefined;
  captionStyle?: string | undefined;
  intensity?: string | undefined;
  pauseMs?: number | undefined;
  speed?: number | undefined;
  aspect?: string | undefined;
}

function refuseUnless(ok: boolean, message: string): void {
  if (!ok) throw new SolaraError(message, '', { exitCode: EXIT_USAGE });
}

function within(value: number, [low, high]: readonly [number, number]): boolean {
  return value >= low && value <= high;
}

/** The project's settings. An optional value is sent only when given. */
export function buildSettings(input: SettingsInput): JsonObject {
  const settings: JsonObject = { edit_style: input.style };
  if (input.prompt) settings.prompt = input.prompt;
  if (input.captionStyle) settings.caption_preset = input.captionStyle;
  if (input.intensity) {
    const known = (INTENSITIES as readonly string[]).includes(input.intensity);
    refuseUnless(known, `--intensity must be one of ${INTENSITIES.join(', ')}`);
    settings.intensity = input.intensity;
  }
  if (input.pauseMs !== undefined) {
    refuseUnless(within(input.pauseMs, PAUSE_MS_RANGE), `--pause-ms must be ${PAUSE_MS_RANGE.join(' to ')}`);
    settings.pause_ms = input.pauseMs;
  }
  if (input.speed !== undefined) {
    refuseUnless(within(input.speed, SPEED_RANGE), `--speed must be ${SPEED_RANGE.join(' to ')}`);
    settings.speed = input.speed;
  }
  if (input.aspect !== undefined) {
    refuseUnless((ASPECTS as readonly string[]).includes(input.aspect), `--aspect must be ${ASPECTS.join(' or ')}`);
    settings.aspect = input.aspect;
  }
  return settings;
}

export type WaitDecision = 'working' | 'done' | 'failed';
export type WaitUntil = 'edit' | 'export';

// A new project's edit is ready at `awaiting_plan_review` (the editor's video plan, waiting for
// Export); after an export the video sits at `awaiting_approval`, then on to posting.
const EDIT_READY_STATES = [
  'awaiting_plan_review',
  'awaiting_approval',
  'awaiting_publish_time',
  'publishing',
  'published',
];

function int(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Whether `wait` is done: `edit` once the edit is ready to look at, `export` once the exported
 * video can be downloaded. Any state this does not know is still working. */
export function waitDecision(project: JsonObject, until: WaitUntil): WaitDecision {
  const state = project.state;
  if (state === 'failed') return 'failed';
  if (until === 'edit') return EDIT_READY_STATES.includes(String(state)) ? 'done' : 'working';
  if (state !== 'awaiting_approval') return 'working';
  const rev = int(project.rev);
  const exported = int(project.approved_rev) >= rev && rev > 0;
  return exported && project.video_url ? 'done' : 'working';
}

export function failureStep(project: JsonObject, cli: string): string {
  if (project.failure_reason === 'no_speech') return 'Nobody could be heard talking. Try a different clip.';
  return `Try again later with \`${cli} start\`, or tell the person to contact Solara support.`;
}

/** An export of rev is already under way or done: never send it again. */
export function exportInFlight(project: JsonObject, rev: number): boolean {
  if (project.state === 'rendering' || project.state === 'processing') return true;
  return int(project.approved_rev) >= rev;
}

export function currentRev(project: JsonObject): number {
  return int(project.rev);
}

/** The Solara app's origin: SOLARA_APP_URL, else the API's host with its `api` swapped for `app`
 * (api.solaraai.com is app.solaraai.com; eu-api.… is eu-app.…). */
export function appUrl(apiUrl: string, override?: string): string {
  if (override) return override.replace(/\/+$/, '');
  const url = new URL(apiUrl);
  const host = url.host.replace(/^api\./, 'app.').replace(/^([a-z0-9-]+)-api\./, '$1-app.');
  return `${url.protocol}//${host}`;
}
