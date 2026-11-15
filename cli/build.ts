// Builds the files npm ships: dist/cli.js, the CLI, ESM for Node 20+, nothing imported but
// Node's own modules, with the `#!/usr/bin/env node` line its bin needs; and dist/solara.js, the
// command's old name (before 0.4.0), which says once that it is now `solaraai` and runs the same
// file. Not minified: whoever installs it can read what it does.
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = import.meta.dir;
const outfile = join(root, 'dist', 'cli.js');
const aliasFile = join(root, 'dist', 'solara.js');

const result = await Bun.build({
  entrypoints: [join(root, 'src', 'main.ts')],
  outdir: join(root, 'dist'),
  naming: 'cli.js',
  target: 'node',
  format: 'esm',
  minify: false,
  sourcemap: 'none',
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const code = await readFile(outfile, 'utf8');
if (!code.startsWith('#!/usr/bin/env node\n')) throw new Error(`${outfile} lost its #! line`);
// Zero runtime dependencies: anything imported that isn't node:* would be missing on install.
const foreign = [...code.matchAll(/^import .* from ["']([^"']+)["'];?$/gm)]
  .map((match) => match[1] ?? '')
  .filter((name) => !name.startsWith('node:'));
if (foreign.length > 0) throw new Error(`dist/cli.js imports ${foreign.join(', ')}: it must need nothing but Node`);
await chmod(outfile, 0o755);

// stderr, so --json output on stdout stays clean for whoever parses it.
const alias = `#!/usr/bin/env node
// \`solara\`, the old name of the \`solaraai\` command: it still works, and says so once per run.
process.stderr.write('solaraai: \`solara\` is the old name of this command: run \`solaraai\` instead (same commands).\\n');
await import('./cli.js');
`;
await writeFile(aliasFile, alias);
await chmod(aliasFile, 0o755);
console.log(`built ${outfile} (${(code.length / 1024).toFixed(1)} KiB) and ${aliasFile}`);
