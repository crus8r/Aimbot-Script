/**
 * Headless smoke test.
 *
 * Loads the built bundle in Chromium with WebGL, fails on any console error or
 * uncaught exception, then seeks through the whole production capturing frames
 * so the output can be eyeballed rather than merely "not crashed".
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });

const viewport = process.argv.includes('--desktop')
  ? { width: 1280, height: 720 }
  : { width: 390, height: 844 }; // iPhone-ish, since mobile is the target

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});

const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });

const errors = [];
const warnings = [];
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error') errors.push(text);
  else if (m.type() === 'warning') warnings.push(text);
});
page.on('pageerror', (e) => errors.push(`UNCAUGHT: ${e.message}\n${e.stack || ''}`));

const file = `file://${path.join(root, 'dist/playhouse.html')}`;
await page.goto(file, { waitUntil: 'load' });

// Wait for the boot overlay to clear, i.e. the first frame rendered.
await page.waitForFunction(
  () => document.getElementById('boot')?.classList.contains('gone'),
  { timeout: 25000 },
).catch(async () => {
  const msg = await page.locator('#bootMsg').innerText().catch(() => '(no message)');
  errors.push(`Boot never completed. Overlay said: ${msg}`);
});

const report = await page.evaluate(() => {
  const p = window.playhouse?.production;
  if (!p) return { ok: false, reason: 'window.playhouse missing' };
  return {
    ok: true,
    title: p.script?.meta?.title,
    scenes: p.script?.scenes?.length,
    characters: p.script?.characters?.map((c) => c.name),
    shots: p.plan?.shots?.length,
    duration: +(p.plan?.duration ?? 0).toFixed(2),
    triangles: window.playhouse.engine.renderer.info.render.triangles,
    programs: window.playhouse.engine.renderer.info.programs?.length,
  };
});

console.log('\n  Production:', JSON.stringify(report, null, 2).replace(/\n/g, '\n  '));

// Step through the piece and capture frames.
const duration = report.duration || 20;
const stops = 10;
for (let i = 0; i < stops; i++) {
  const t = (i / (stops - 1)) * Math.max(0, duration - 0.15);
  await page.evaluate((time) => {
    const p = window.playhouse.production;
    p.pause();
    p.seek(time);
    // Advance a few frames so blends, poses and the camera settle.
    for (let k = 0; k < 12; k++) p.update(1 / 60, time + k / 60);
    window.playhouse.engine.render(time);
  }, t);
  await page.waitForTimeout(120);
  const slate = await page.locator('#slate').innerText().catch(() => '');
  const caption = await page.locator('#caption').innerText().catch(() => '');
  await page.screenshot({ path: path.join(shots, `frame-${String(i).padStart(2, '0')}.png`) });
  console.log(`  t=${t.toFixed(1).padStart(5)}s  ${slate.padEnd(34)} ${caption.slice(0, 46)}`);
}

// Exercise the panels — most runtime breakage hides in UI construction.
for (const panel of ['script', 'cast', 'audio', 'look']) {
  await page.click(`.tab[data-panel="${panel}"]`);
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(shots, `panel-${panel}.png`) });
  await page.click('#btnCloseSheet').catch(() => {});
  await page.waitForTimeout(120);
}

// Let it actually run for a few seconds to catch per-frame errors.
await page.evaluate(() => { window.playhouse.production.seek(0); window.playhouse.production.play(); });
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(shots, 'live.png') });

const fps = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const start = performance.now();
  const tick = () => {
    frames++;
    if (performance.now() - start < 2000) requestAnimationFrame(tick);
    else resolve(Math.round((frames * 1000) / (performance.now() - start)));
  };
  requestAnimationFrame(tick);
}));
console.log(`\n  ~${fps} fps (software rasteriser; real devices will be far higher)`);

await browser.close();

const ignorable = /WebGL.*deprecated|Automatic fallback|SwiftShader|GroupMarkerNotSet|Slow network/i;
const real = errors.filter((e) => !ignorable.test(e));

if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s):`);
  [...new Set(warnings)].slice(0, 8).forEach((w) => console.log(`   · ${w.slice(0, 160)}`));
}

if (real.length) {
  console.error(`\n  ✗ ${real.length} error(s):\n`);
  [...new Set(real)].forEach((e) => console.error(`   ${e.slice(0, 700)}\n`));
  process.exit(1);
}
console.log(`\n  ✓ no errors — frames in shots/\n`);
