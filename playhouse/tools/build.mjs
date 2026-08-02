/**
 * Bundle the app into single self-contained HTML files.
 *
 *   dist/playhouse.html — a complete document, openable from disk or any host
 *   dist/artifact.html  — page content only (no doctype/html/head/body), for
 *                         publishing surfaces that supply their own skeleton
 *
 * Three.js is aliased to the vendored ESM build and inlined, so neither output
 * makes a single network request.
 */

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2021', 'safari15'],
  alias: { three: path.join(root, 'vendor/three.module.min.js') },
  write: false,
  legalComments: 'none',
  logLevel: 'info',
});

// Minified output contains `$&`-style sequences and can contain `</script`.
// The first breaks String.replace's replacement grammar (always pass a
// function); the second would close the tag early.
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<script type="module"[\s\S]*?<\/body>/);
const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
if (!styleMatch || !bodyMatch) throw new Error('index.html structure changed — build needs updating');

const style = styleMatch[1];
const markup = bodyMatch[1];
const title = titleMatch ? titleMatch[1] : 'Playhouse';

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

// --- Full document ----------------------------------------------------------
fs.writeFileSync(
  path.join(dist, 'playhouse.html'),
  html.replace('<script type="module" src="./src/main.js"></script>', () => `<script>${js}</script>`),
);

// --- Content-only, for embedding --------------------------------------------
const artifact = `<title>${title}</title>
<style>
/* The host skeleton may centre and pad the page; Playhouse needs the viewport. */
html, body { margin: 0 !important; padding: 0 !important; max-width: none !important; height: 100%; overflow: hidden; background: #07080c; }
${style}
</style>
${markup}
<script>${js}</script>
`;
fs.writeFileSync(path.join(dist, 'artifact.html'), artifact);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} kB`;
console.log(`\n  dist/playhouse.html  ${kb(fs.readFileSync(path.join(dist, 'playhouse.html'), 'utf8'))}`);
console.log(`  dist/artifact.html   ${kb(artifact)}\n`);
