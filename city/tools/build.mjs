// Bundles src/ into dist/ and mirrors assets/. Browser tests read dist/, so
// every test script calls this first rather than trusting a stale bundle.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

export async function build({ minify = true, entries = ['main'] } = {}) {
  fs.mkdirSync(dist, { recursive: true });
  const t0 = Date.now();
  await esbuild.build({
    entryPoints: entries.map((e) => path.join(root, 'src', `${e}.js`)),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify,
    sourcemap: false,
    outdir: dist,
    entryNames: '[name]',
    logLevel: 'warning',
    legalComments: 'none',
  });
  fs.cpSync(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });
  // The artifact host won't serve .glb, so every model also ships as base64
  // text, which src/core/loadglb.js decodes.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(dist, 'assets'))) {
    if (f.endsWith('.glb')) fs.writeFileSync(`${f}.txt`, fs.readFileSync(f).toString('base64'));
  }
  for (const f of fs.readdirSync(path.join(root, 'web'))) {
    fs.copyFileSync(path.join(root, 'web', f), path.join(dist, f));
  }
  return Date.now() - t0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev');
  const extra = process.argv.filter((a) => a.startsWith('--entry=')).map((a) => a.slice(8));
  const ms = await build({ minify: !dev, entries: ['main', 'homes', ...extra] });
  console.log(`built dist/ in ${ms}ms`);
}
