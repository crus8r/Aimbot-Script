/** Build and screenshot the figure inspector from several angles. */
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'shots/figure');
fs.mkdirSync(out, { recursive: true });

const r = await esbuild.build({
  entryPoints: [path.join(root, 'src/debug-figure.js')],
  bundle: true, format: 'iife', minify: false, target: ['es2021'],
  write: false, logLevel: 'warning',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(path.join(root, 'dist/figure.html'),
  `<!doctype html><meta charset=utf-8><title>figure</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#6a6e78}canvas{display:block;width:100%;height:100%}</style>
<canvas id=view></canvas><script>${js}</script>`);

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:900,height:900}, deviceScaleFactor:1.5 });
p.on('pageerror', e => console.log('[ERR]', e.message));
await p.goto(`file://${path.join(root,'dist/figure.html')}`, { waitUntil:'load' });
await p.waitForTimeout(1500);

const views = process.argv[2] ? [process.argv[2]] : ['lineup','front','side','back','face','faceQuarter','faceSide','torso','legs'];
for (const v of views) {
  await p.evaluate((view) => { window.figure.setView(view); window.figure.step(20); }, v);
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(out, `${v}.png`) });
  console.log('  ✓', v);
}
await b.close();
