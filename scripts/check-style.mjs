#!/usr/bin/env node
// Style gate: no em dashes anywhere (character or HTML entity), per project rules.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.pnpm-store']);
const EXTS = new Set(['.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.html', '.json', '.yml', '.yaml', '.txt']);
const BAD = [String.fromCharCode(0x2014), '&' + 'mdash;'];

let failures = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!EXTS.has(extname(name))) continue;
    const text = readFileSync(p, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const bad of BAD) {
        if (line.includes(bad)) {
          console.error(`${p}:${i + 1}: em dash found`);
          failures++;
        }
      }
    });
  }
}
walk(ROOT);
if (failures > 0) {
  console.error(`style gate failed: ${failures} occurrence(s)`);
  process.exit(1);
}
console.log('style gate clean');
