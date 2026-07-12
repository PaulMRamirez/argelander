#!/usr/bin/env node
// Bundle the demo to static files for Pages: main thread, SGP4 worker, CSS.
// Assets carry a build stamp so a deploy can never mix cached versions of
// the main bundle and the worker.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let buildId = 'dev';
try {
  buildId = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim();
} catch {
  // outside a git checkout the dev stamp is fine
}

await build({
  entryPoints: [join(here, 'src/main.ts'), join(here, 'src/sgp4-worker.ts')],
  bundle: true,
  format: 'iife',
  outdir: out,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  loader: { '.png': 'dataurl' },
  define: { __BUILD_ID__: JSON.stringify(buildId) },
});

const html = readFileSync(join(here, 'index.html'), 'utf8')
  .replaceAll('./main.css', `./main.css?v=${buildId}`)
  .replaceAll('./main.js', `./main.js?v=${buildId}`);
writeFileSync(join(out, 'index.html'), html);
console.log(`demo built at ${out} (build ${buildId})`);
