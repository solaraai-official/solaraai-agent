// `upload-url`: Solara fetches the recording from a public link itself (create-project-upload-from-url),
// for a person who shares a Google Drive or Dropbox link instead of a file. The CLI starts the fetch
// with an Idempotency-Key and waits until Solara has the file; the same key picks the fetch up again.

import { randomUUID } from 'node:crypto';
import { backoffDelays } from './client';
import { type Context, emit } from './commands';
import { EXIT_NOT_READY, EXIT_OK, type JsonObject, nextSteps, SolaraError } from './errors';
import { DEFAULT_STYLE } from './video';

/** How long `upload-url` waits for Solara to have the file, by default. */
export const FETCH_TIMEOUT_SECONDS = 900;

function upload(answer: JsonObject): string {
  return typeof answer.upload_id === 'string' ? answer.upload_id : '';
}

/** A fetch that ended without the file: why, and what to do instead. */
function fetchRefusal(ctx: Context, state: JsonObject, again: string): SolaraError {
  if (state.status === 'failed') {
    const error = (state.error ?? {}) as JsonObject;
    const code = typeof error.code === 'string' ? error.code : 'url_unreachable';
    const message = typeof error.message === 'string' && error.message ? error.message : 'the fetch did not finish';
    return new SolaraError(message, nextSteps(ctx.cli)[code] ?? nextSteps(ctx.cli).url_unreachable, {
      code,
      body: state,
    });
  }
  if (state.status === 'aborted') {
    return new SolaraError('this upload was abandoned', `Run \`${again}\` without --idempotency-key.`, { body: state });
  }
  return new SolaraError(`the upload is ${state.status || 'in an unknown state'}`, `Run \`${again}\` again.`, {
    body: state,
  });
}

export async function uploadUrlCommand(
  ctx: Context,
  link: string,
  timeoutSeconds: number,
  idempotencyKey: string | undefined,
): Promise<number> {
  const again = `${ctx.cli} upload-url "${link}"`;
  const key = idempotencyKey || randomUUID();
  ctx.note(`solara: Idempotency-Key ${key} (repeat with --idempotency-key ${key} to pick this fetch up again)`);
  const started = await ctx.client.call('POST', '/projects/uploads/from-url', { url: link }, key);
  const uploadId = upload(started);
  if (!uploadId) throw new SolaraError('Solara started no fetch', `Run \`${again} --idempotency-key ${key}\`.`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  const delays = backoffDelays(3, 1.5, 15);
  let state: JsonObject = started;
  while (true) {
    state = await ctx.client.call('GET', `/projects/uploads/status/${uploadId}`);
    if (state.status !== 'fetching') break;
    if (Date.now() >= deadline) {
      throw new SolaraError('Solara is still fetching the file', `Run \`${again} --idempotency-key ${key}\` again.`, {
        body: state,
        exitCode: EXIT_NOT_READY,
      });
    }
    ctx.note('solara: fetching...');
    await ctx.client.sleep(delays.next().value);
  }
  if (state.status !== 'ready') throw fetchRefusal(ctx, state, again);
  if (state.used) {
    throw new SolaraError(
      'a video was already made from this upload',
      `Run \`${again}\` without --idempotency-key for a new upload.`,
      { code: 'upload_used', body: state },
    );
  }

  const duration = typeof state.duration_ms === 'number' && state.duration_ms > 0 ? state.duration_ms : 0;
  const start = `${ctx.cli} start --upload ${uploadId} --duration-ms ${duration || '<ms>'} --style ${DEFAULT_STYLE} --prompt "..."`;
  emit(
    ctx,
    state,
    duration
      ? [`Fetched: upload_id ${uploadId}, ${duration} ms long.`, `Next: ${start}`]
      : [
          `Fetched: upload_id ${uploadId}. The file doesn't say how long it is: ask the person (at most 10 minutes).`,
          `Next: ${start}`,
        ],
  );
  return EXIT_OK;
}
