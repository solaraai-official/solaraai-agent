// What each command does. Every command prints lines for a person (or, with --json, the API's
// answer) on stdout, its progress on stderr, and returns its exit code.

import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { backoffDelays, type Client } from './client';
import { EXIT_NOT_READY, EXIT_OK, EXIT_USAGE, type JsonObject, nextSteps, SolaraError } from './errors';
import { type HttpAnswer, NoAnswerError } from './http';
import { contentTypeFor, displaySizeOf, durationMsOf } from './media';
import { uploadableSize, uploadFile } from './upload';
import {
  appUrl,
  buildSettings,
  currentRev,
  DEFAULT_STYLE,
  exportInFlight,
  failureStep,
  type SettingsInput,
  type WaitUntil,
  waitDecision,
} from './video';

export interface Context {
  client: Client;
  env: NodeJS.ProcessEnv;
  cli: string;
  json: boolean;
  say: (line: string) => void;
  note: (line: string) => void;
}

export function emit(ctx: Context, result: unknown, lines: string[]): void {
  if (ctx.json) {
    ctx.say(JSON.stringify(result, null, 2));
    return;
  }
  for (const line of lines) ctx.say(line);
}

function editLink(ctx: Context, videoId: string): string {
  return `${appUrl(ctx.client.apiUrl, ctx.env.SOLARA_APP_URL)}/projects/${videoId}`;
}

/** One line per item: its id, then the name the app shows, in aligned columns. A style's name can
 * differ from its id (the app shows `lumen` as Halo), and only the id is accepted. */
function idAndNameLines(items: JsonObject[]): string[] {
  const width = Math.max(0, ...items.map((item) => String(item.id).length));
  return items.map((item) => `  id: ${String(item.id).padEnd(width)}  name: ${item.name}`);
}

function list(value: unknown): JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

export async function stylesCommand(ctx: Context): Promise<number> {
  const catalog = await ctx.client.call('GET', '/styles');
  const styles = list(catalog.styles);
  const lines = ['Styles: pass the id to --style, never the name (the name is what the app shows the person).'];
  idAndNameLines(styles).forEach((line, i) => {
    lines.push(`${line}  (accent ${styles[i]?.accent_color ?? ''})`);
    if (styles[i]?.description) lines.push(`      ${styles[i]?.description}`);
  });
  lines.push('Caption styles: pass the id to --caption-style.');
  lines.push(...idAndNameLines(list(catalog.caption_styles)));
  if (catalog.default_caption_style) lines.push(`Default caption style: ${catalog.default_caption_style}`);
  emit(ctx, catalog, lines);
  return EXIT_OK;
}

/** A title the person recognises in the app: the file's name, without its extension. */
function titleFrom(path: string): string {
  return basename(path, extname(path)).replaceAll('"', "'");
}

export async function uploadCommand(ctx: Context, file: string): Promise<number> {
  await uploadableSize(file);
  contentTypeFor(file);
  const duration = await durationMsOf(file, ctx.env, ctx.cli);
  const uploaded = await uploadFile(ctx.client, file, ctx.note);
  const result = { ...uploaded, duration_ms: duration };
  emit(ctx, result, [
    `Uploaded: upload_id ${result.upload_id}, ${duration} ms long.`,
    `Next: ${ctx.cli} start --upload ${result.upload_id} --duration-ms ${duration} --style ${DEFAULT_STYLE} ` +
      `--title "${titleFrom(file)}" --prompt "..."`,
  ]);
  return EXIT_OK;
}

export interface StartInput extends SettingsInput {
  upload: string;
  durationMs?: number | undefined;
  file?: string | undefined;
  title?: string | undefined;
  idempotencyKey?: string | undefined;
}

export async function startCommand(ctx: Context, input: StartInput): Promise<number> {
  const duration = input.durationMs || (input.file ? await durationMsOf(input.file, ctx.env, ctx.cli) : undefined);
  if (!duration) {
    throw new SolaraError('--duration-ms is required (or --file to read it)', '', { exitCode: EXIT_USAGE });
  }
  const body: JsonObject = { upload_id: input.upload, source_duration_ms: duration, settings: buildSettings(input) };
  // The format follows the source: a clip filmed sideways is made 16:9 where landscape is offered.
  const size = input.file ? await displaySizeOf(input.file, ctx.env) : null;
  if (size) [body.source_width, body.source_height] = size;
  if (input.title) body.title = input.title;
  const key = input.idempotencyKey || randomUUID();
  ctx.note(`solara: Idempotency-Key ${key} (repeat with --idempotency-key ${key} to retry safely)`);
  const created = await ctx.client.call('POST', '/projects', body, key);
  const video = typeof created.video_id === 'string' ? created.video_id : '';
  if (!video)
    throw new SolaraError('Solara started no video', `Run \`${ctx.cli} start\` again with --idempotency-key ${key}.`);
  const link = editLink(ctx, video);
  created.edit_link = link;
  emit(ctx, created, [
    `Started: video_id ${video} (${created.state}).`,
    `Edit link (show the person before exporting): ${link}`,
    `Next: ${ctx.cli} wait ${video}`,
  ]);
  return EXIT_OK;
}

function projectLines(ctx: Context, project: JsonObject): string[] {
  const lines = [
    `video_id ${project.video_id}: ${project.state}`,
    `  rev ${project.rev}, exported rev ${project.approved_rev}`,
  ];
  if (project.video_url) lines.push(`  an exported video is ready: ${ctx.cli} download ${project.video_id}`);
  if (project.state === 'failed') lines.push(`  failed: ${failureStep(project, ctx.cli)}`);
  return lines;
}

export async function statusCommand(ctx: Context, videoId: string): Promise<number> {
  const project = await ctx.client.call('GET', `/projects/${videoId}`);
  emit(ctx, project, projectLines(ctx, project));
  return EXIT_OK;
}

async function waitFor(ctx: Context, videoId: string, until: WaitUntil, timeoutSeconds: number): Promise<JsonObject> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const delays = backoffDelays();
  while (true) {
    const project = await ctx.client.call('GET', `/projects/${videoId}`);
    const decision = waitDecision(project, until);
    if (decision === 'done') return project;
    if (decision === 'failed') {
      throw new SolaraError(`the video failed at ${project.failed_step || 'a step'}`, failureStep(project, ctx.cli), {
        body: project,
      });
    }
    if (Date.now() >= deadline) {
      throw new SolaraError(
        `still working (${project.state})`,
        `Run \`${ctx.cli} wait ${videoId}${until === 'export' ? ' --until export' : ''}\` again.`,
        { body: project, exitCode: EXIT_NOT_READY },
      );
    }
    ctx.note(`solara: ${project.state}...`);
    await ctx.client.sleep(delays.next().value);
  }
}

export async function waitCommand(ctx: Context, videoId: string, until: WaitUntil, timeout: number): Promise<number> {
  const project = await waitFor(ctx, videoId, until, timeout);
  const lines =
    until === 'edit'
      ? [
          `The edit is ready: ${editLink(ctx, videoId)}`,
          `Show it to the person and get a yes, then: ${ctx.cli} export ${videoId}`,
        ]
      : [`Exported. Next: ${ctx.cli} download ${videoId}`];
  emit(ctx, project, lines);
  return EXIT_OK;
}

export async function exportCommand(
  ctx: Context,
  videoId: string,
  rev: number | undefined,
  idempotencyKey: string | undefined,
): Promise<number> {
  const project = await ctx.client.call('GET', `/projects/${videoId}`);
  const target = rev || currentRev(project);
  if (target < 1) {
    throw new SolaraError('the video has no edit to export yet', `Run \`${ctx.cli} wait ${videoId}\` first.`, {
      exitCode: EXIT_NOT_READY,
    });
  }
  const next = `Next: ${ctx.cli} wait ${videoId} --until export`;
  if (exportInFlight(project, target) && !idempotencyKey) {
    emit(ctx, project, [`Rev ${target} is already exported or exporting.`, next]);
    return EXIT_OK;
  }
  const key = idempotencyKey || randomUUID();
  ctx.note(`solara: Idempotency-Key ${key} (repeat with --idempotency-key ${key} to retry safely)`);
  let exported: JsonObject;
  try {
    exported = await ctx.client.call('POST', `/projects/${videoId}/export`, { rev: target }, key);
  } catch (error) {
    if (!(error instanceof SolaraError) || (error.status !== 0 && error.status < 500)) throw error;
    // No answer, even after retrying with the same key: look before anything else is sent.
    const now = await ctx.client.call('GET', `/projects/${videoId}`);
    if (!exportInFlight(now, target)) throw error;
    exported = { state: now.state, rev: target };
  }
  emit(ctx, exported, [`Exporting rev ${exported.rev ?? target} (${exported.state}).`, next]);
  return EXIT_OK;
}

/** The download URL. The API answers a video that was never exported with a bare 404, which reads
 * as a wrong id: look at the video and say what to do instead. */
async function downloadLink(ctx: Context, videoId: string): Promise<string> {
  let link: JsonObject;
  try {
    link = await ctx.client.call('GET', `/projects/${videoId}/download`);
  } catch (refused) {
    if (!(refused instanceof SolaraError) || refused.status !== 404) throw refused;
    let project: JsonObject;
    try {
      project = await ctx.client.call('GET', `/projects/${videoId}`);
    } catch {
      throw refused;
    }
    if (project.state === 'rendering') {
      throw new SolaraError(
        'the export is still rendering',
        `Run \`${ctx.cli} wait ${videoId} --until export\`, then download.`,
        { exitCode: EXIT_NOT_READY },
      );
    }
    throw new SolaraError('this video has not been exported yet', nextSteps(ctx.cli).not_exported);
  }
  if (typeof link.url !== 'string' || !link.url) {
    throw new SolaraError('Solara gave no download link', `Run \`${ctx.cli} download ${videoId}\` again.`);
  }
  return link.url;
}

export async function downloadCommand(ctx: Context, videoId: string, out: string | undefined): Promise<number> {
  const url = await downloadLink(ctx, videoId);
  const path = out || `${videoId}.mp4`;
  const again = `\`${ctx.cli} download ${videoId}\` again for a fresh link.`;
  let answer: HttpAnswer;
  try {
    const headers = { 'User-Agent': ctx.client.userAgent };
    answer = await ctx.client.transport({ method: 'GET', url, headers, saveTo: path });
  } catch (error) {
    if (!(error instanceof NoAnswerError)) throw error;
    throw new SolaraError(`the download got no answer (${error.message})`, `Check the network, then run ${again}`);
  }
  if (answer.status < 200 || answer.status >= 300) {
    throw new SolaraError(`the download link answered ${answer.status}`, `Run ${again}`);
  }
  emit(ctx, { path, size_bytes: answer.savedBytes }, [`Saved ${path} (${answer.savedBytes} bytes).`]);
  return EXIT_OK;
}

export async function usageCommand(ctx: Context): Promise<number> {
  const usage = await ctx.client.call('GET', '/projects/usage');
  const lines = Object.entries(usage)
    .filter(([key]) => !key.startsWith('$'))
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  emit(ctx, usage, lines);
  return EXIT_OK;
}
