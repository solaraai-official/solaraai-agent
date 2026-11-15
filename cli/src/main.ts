#!/usr/bin/env node
// solaraai: make edited short videos with Solara AI from a terminal or an AI agent, signed in with
// `solaraai login` (or an API key).
// `solaraai --help` explains everything. Docs: https://docs.solaraai.com/agents/skill-and-cli

import { run } from './cli';

run(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).then(
  (code) => {
    // Not process.exit(): it can cut off output still on its way down a pipe.
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`solaraai: unexpected error: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.stderr.write('next: run the same command again; if it fails the same way, tell Solara AI support.\n');
    process.exitCode = 1;
  },
);
