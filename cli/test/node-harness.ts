// Runs a piece of the CLI on Node, the runtime it ships for, with short network limits: the
// network tests' waits depend on Node's own sockets, which Bun's node:http does not reproduce.
// network.test.ts bundles this for Node and runs it.
//
//   node harness.js send '<HttpRequest JSON, body as {"bodyBytes": n}>'   prints {status, etag} or {error}
//   node harness.js cli <argv...>                                         the CLI, sleeps skipped
//
// HARNESS_LIMITS (JSON) overrides the network limits. A request with `slowStoreMs` and no `url`
// goes to a slow-store.ts started in this process.

import { run } from '../src/cli';
import { createTransport, LIMITS, type Limits } from '../src/http';
import { startSlowStore } from './slow-store';

const limits: Limits = { ...LIMITS, ...JSON.parse(process.env.HARNESS_LIMITS ?? '{}') };
const [mode, ...rest] = process.argv.slice(2);

if (mode === 'send') {
  const { bodyBytes, slowStoreMs, ...request } = JSON.parse(rest[0] ?? '{}');
  if (slowStoreMs) request.url = `${await startSlowStore(slowStoreMs)}/part1`;
  const start = performance.now();
  try {
    const answer = await createTransport({}, limits)({ ...request, body: bodyBytes ? Buffer.alloc(bodyBytes) : null });
    const took = performance.now() - start;
    console.log(JSON.stringify({ status: answer.status, etag: answer.headers.etag, took }));
  } catch (error) {
    const took = performance.now() - start;
    console.log(JSON.stringify({ error: (error as Error).name, message: (error as Error).message, took }));
  }
} else if (mode === 'cli') {
  process.exitCode = await run(rest, {
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    sleep: () => Promise.resolve(),
    limits,
  });
}
