// Builds the one file npm ships: dist/solara.js, ESM for Node 20+, nothing imported but Node's own
// modules, with the `#!/usr/bin/env node` line its bin needs. Not minified: whoever installs it can
// read what it does.
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = import.meta.dir;
const outfile = join(root, 'dist', 'solara.js');

const result = await Bun.build({
  entrypoints: [join(root, 'src', 'main.ts')],
  outdir: join(root, 'dist'),
  naming: 'solara.js',
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
if (foreign.length > 0) throw new Error(`dist/solara.js imports ${foreign.join(', ')}: it must need nothing but Node`);
await chmod(outfile, 0o755);
console.log(`built ${outfile} (${(code.length / 1024).toFixed(1)} KiB)`);
