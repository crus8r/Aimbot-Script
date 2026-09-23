/** Render a procedural character to a .glb fixture for import round-trip tests. */
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await esbuild.build({
  entryPoints: [path.join(root, 'src/debug-export.js')],
  bundle: true, format: 'iife', target: ['es2021'], write: false, logLevel: 'warning',
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/export.html'),
  `<!doctype html><meta charset=utf-8><script>${r.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`);

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', e => { console.error('[ERR]', e.message); });
await p.goto(`file://${path.join(root,'dist/export.html')}`, { waitUntil:'load' });
const bytes = await p.evaluate(() => window.exportTestAvatar('MIREN'));
await b.close();

const out = path.join(root, 'test/fixtures');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'procedural.glb'), Buffer.from(bytes));
console.log(`  wrote test/fixtures/procedural.glb (${(bytes.length/1024).toFixed(0)} kB)`);
