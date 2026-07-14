#!/usr/bin/env node
// Docs pipeline: markdown sources plus TypeDoc into one static site at dist/site.
// Deployed by the Pages job; run locally with `pnpm docs`.
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { marked } from 'marked';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = join(ROOT, 'dist', 'site');

rmSync(SITE, { recursive: true, force: true });
mkdirSync(join(SITE, 'adr'), { recursive: true });

const td = spawnSync('pnpm', ['exec', 'typedoc'], { cwd: ROOT, stdio: 'inherit' });
if (td.status !== 0) process.exit(td.status ?? 1);

cpSync(join(ROOT, 'apps/atlas/index.html'), join(SITE, 'atlas/index.html'));

// The live demo bundles beside the static atlas; both ship on Pages.
const demo = spawnSync('pnpm', ['--filter', '@app/demo-leaflet', 'build'], { cwd: ROOT, stdio: 'inherit' });
if (demo.status !== 0) process.exit(demo.status ?? 1);
cpSync(join(ROOT, 'apps/demo-leaflet/dist'), join(SITE, 'demo'), { recursive: true });

// The README captures ride along so the homepage hero and any guide that
// references a figure resolve on the deployed site, not just in the repo view.
cpSync(join(ROOT, 'docs/media'), join(SITE, 'media'), { recursive: true });

const CSS = `
:root{--bg:#0C131C;--panel:#121B27;--txt:#D7E1EA;--dim:#8CA0B3;--teal:#7FD8CC;--line:#22303F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);
font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
main{max-width:880px;margin:0 auto;padding:40px 22px 80px}
h1,h2,h3{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.01em;color:var(--teal)}
h1{font-size:26px;margin:8px 0 18px}h2{font-size:19px;margin-top:34px}h3{font-size:16px;color:var(--txt)}
a{color:var(--teal);text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}
figure{margin:18px 0}figcaption{color:var(--dim);font-size:13px;margin-top:6px}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}
th,td{border:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}
th{background:var(--panel);color:var(--teal);font-family:ui-monospace,monospace;font-size:12.5px}
code{background:var(--panel);padding:1px 5px;border-radius:4px;font-size:.9em}
pre{background:var(--panel);padding:12px;border-radius:8px;overflow:auto}
blockquote{border-left:3px solid var(--line);margin:0;padding:2px 14px;color:var(--dim)}
nav{font-size:13px;color:var(--dim);margin-bottom:10px}
.toc{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:16px 0 30px}
.toc .toc-h{margin:0 0 8px;color:var(--dim);font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.1em}
.toc ul{list-style:none;margin:0;padding:0;columns:2;column-gap:26px}
.toc li{margin:4px 0;break-inside:avoid;font-size:14px}
.toc li.toc-l3{padding-left:14px;font-size:13px}
.toc li.toc-l3 a{color:var(--dim)}
.toc a{color:var(--teal);text-decoration:none}
.toc a:hover{text-decoration:underline}
h2,h3{scroll-margin-top:14px}
@media(max-width:640px){.toc ul{columns:1}}
`;

function page(title, bodyHtml, depth = 0) {
  const home = depth ? '../'.repeat(depth) : './';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | argelander</title><style>${CSS}</style></head>
<body><main><nav><a href="${home}index.html">argelander docs</a></nav>${bodyHtml}</main></body></html>`;
}

function firstHeading(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1] : null;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

// GitHub-style heading slug: lowercased text, punctuation dropped, spaces to hyphens.
function slugify(text) {
  return stripTags(text).toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Give every h2 and h3 a stable id so a URL can deep-link a section, and build
// an "On this page" table of contents from them. Long pages get the nav; short
// ones (most ADRs) do not, so the block never dwarfs the page it heads. Slugs
// are de-duplicated the way GitHub does, with a numeric suffix on a repeat.
function anchorAndToc(html) {
  const toc = [];
  const seen = new Map();
  const withIds = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level, inner) => {
    const text = stripTags(inner).trim();
    let slug = slugify(text) || 'section';
    const n = (seen.get(slug) ?? -1) + 1;
    seen.set(slug, n);
    if (n) slug = `${slug}-${n}`;
    toc.push({ level: Number(level), slug, text });
    return `<h${level} id="${slug}">${inner}</h${level}>`;
  });
  if (toc.filter((h) => h.level === 2).length < 4) return withIds;
  const items = toc
    .map((h) => `<li class="toc-l${h.level}"><a href="#${h.slug}">${h.text}</a></li>`)
    .join('');
  const nav = `<nav class="toc" aria-label="On this page"><p class="toc-h">On this page</p><ul>${items}</ul></nav>`;
  return withIds.replace('</h1>', `</h1>${nav}`);
}

function render(srcPath, outPath, depth = 0) {
  const md = readFileSync(srcPath, 'utf8');
  const title = firstHeading(md) ?? basename(srcPath, '.md');
  writeFileSync(outPath, page(title, anchorAndToc(marked.parse(md)), depth));
  return title;
}

const entries = [];
entries.push(['Survey', 'survey.html',
  render(join(ROOT, 'docs/acquisition-geometry-survey.md'), join(SITE, 'survey.html'))]);
entries.push(['Guide', 'configuring-layers.html',
  render(join(ROOT, 'docs/configuring-layers.md'), join(SITE, 'configuring-layers.html'))]);
entries.push(['Requirements', 'requirements.html',
  render(join(ROOT, 'REQUIREMENTS.md'), join(SITE, 'requirements.html'))]);
const studyTitle = render(
  join(ROOT, 'docs/what-the-engine-must-know.md'), join(SITE, 'what-the-engine-must-know.html'));
for (const f of ['SPEC-STRIP', 'SPEC-INSTRUMENT-MODEL', 'SPEC-PROVIDER']) {
  entries.push([f, `${f.toLowerCase()}.html`,
    render(join(ROOT, 'specs', `${f}.md`), join(SITE, `${f.toLowerCase()}.html`))]);
}
const adrs = [];
for (const f of readdirSync(join(ROOT, 'adr')).sort()) {
  const out = f.replace(/\.md$/, '.html');
  adrs.push([render(join(ROOT, 'adr', f), join(SITE, 'adr', out), 1), `adr/${out}`]);
}

const index = `
<h1>argelander</h1>
<p>Acquisition Geometry Engine (AGE). Cosmolabe is what you see, Bessel is what computes, Argelander is what surveys.</p>
<figure>
<img src="media/hero.gif" alt="A constellation of SGP4 footprint strips sweeping Earth in the live Leaflet demo: committed swaths behind each platform, a bright now-line at the acquiring edge, planned coverage ahead.">
<figcaption>Instrument models and ephemerides in, time-tagged footprint strips out. The <a href="demo/index.html">live demo</a> propagates this in your browser.</figcaption>
</figure>
<h2>Demos</h2>
<p><a href="atlas/index.html">Acquisition Geometry Atlas</a>: 21 geometry families, 6 treatments, the visual regression corpus.<br>
<a href="demo/index.html">Live demo</a>: SGP4 footprints propagated in a worker, painted by argelander-leaflet over open tiles.</p>
<h2>Foundation</h2>
<p><a href="survey.html">${entries[0][2]}</a><br>
<a href="what-the-engine-must-know.html">${studyTitle}</a><br>
<a href="requirements.html">Requirements AGE-01 through AGE-20</a></p>
<h2>Guides</h2>
<p><a href="configuring-layers.html">${entries[1][2]}</a></p>
<h2>Contracts</h2>
<p>${entries.slice(3).map(([n, h]) => `<a href="${h}">${n}</a>`).join('<br>')}</p>
<h2>Decisions</h2>
<p>${adrs.map(([t, h]) => `<a href="${h}">${t}</a>`).join('<br>')}</p>
<h2>API</h2>
<p><a href="api/index.html">argelander-core reference</a> (generated by TypeDoc)</p>`;
writeFileSync(join(SITE, 'index.html'), page('index', index));
console.log('site built:', entries.length + adrs.length + 3, 'pages plus API reference');
