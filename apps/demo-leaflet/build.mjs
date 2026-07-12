#!/usr/bin/env node
// Bundle the demo to static files for Pages: main thread, SGP4 worker, CSS.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, 'src/main.ts'), join(here, 'src/sgp4-worker.ts')],
  bundle: true,
  format: 'iife',
  outdir: out,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  loader: { '.png': 'dataurl' },
});
cpSync(join(here, 'index.html'), join(out, 'index.html'));
console.log('demo built at', out);
