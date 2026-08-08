/**
 * Render a scene file to a contact sheet of frames.
 *
 * Simulation runs continuously at a fixed timestep so movement accumulates
 * properly — a character walking twelve metres needs the seconds to do it, and
 * seeking straight to a shot would show them still standing at the start line.
 * Frames are only rasterised at the capture points, which is what keeps this
 * affordable under a software renderer.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sceneArg = process.argv[2] || 'scenes/forest-stop.mjs';
const outDir = path.join(root, 'shots', path.basename(sceneArg, path.extname(sceneArg)));
fs.mkdirSync(outDir, { recursive: true });

const mod = await import(pathToFileURL(path.resolve(root, sceneArg)).href);
const scene = mod.default;

const { normaliseScene, validateScene } = await import(pathToFileURL(path.join(root, 'src/scenefile.js')).href);
const check = validateScene(scene);
if (!check.ok) {
  console.error('  scene invalid:\n   ' + check.errors.join('\n   '));
  process.exit(1);
}
// This tool renders the *preview*, so a warning here is usually "the Blender
// half will not have this" — worth saying before someone judges the film by
// these frames, and never a reason to stop.
for (const w of check.warnings) console.error(`  warning: ${w}`);
const norm = normaliseScene(scene);
console.log(`\n  ${norm.title} — ${norm.shots.length} shots, ${norm.duration.toFixed(1)}s, ` +
  `${norm.environment.props.length} props, cast ${norm.cast.map((c) => c.id).join('/')}`);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(`file://${path.join(root, 'dist/playhouse.html')}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 45000 });

  // Hide the interface: this is about the picture, not the chrome.
  await page.evaluate(() => {
    document.getElementById('chrome')?.classList.add('hidden');
    const p = window.playhouse.production;
    window.__update = p.update.bind(p);
    p.update = () => {};
  });

  const report = await page.evaluate((s) => {
    const p = window.playhouse.production;
    p.update = window.__update;
    const norm2 = p.loadScene(s);
    p.pause();
    window.__t = 0;
    return { shots: norm2.shots.map((x) => ({ id: x.id, start: x.start, duration: x.duration })) };
  }, JSON.parse(JSON.stringify(scene)));

  // Capture two thirds of the way through each shot: past the cut, before the
  // next one, and after any move has had time to read.
  const captures = report.shots.map((s, i) => ({
    index: i, id: s.id, at: s.start + s.duration * 0.66,
  }));

  for (const cap of captures) {
    const info = await page.evaluate((target) => {
      const p = window.playhouse.production;
      const eng = window.playhouse.engine;
      const step = 1 / 30;
      // Advance from wherever we are to the capture point.
      while (window.__t < target - 1e-6) {
        const dt = Math.min(step, target - window.__t);
        window.__t += dt;
        p.time = window.__t;
        p.update(dt, window.__t);
      }
      eng.fade = Math.max(eng.fade, 0.85); // don't grade a fade into a black plate
      eng.render(window.__t);
      return { slate: p.slate, t: +window.__t.toFixed(2) };
    }, cap.at);

    await page.waitForTimeout(140);
    const file = path.join(outDir, `${String(cap.index).padStart(2, '0')}-${cap.id}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${String(cap.index).padStart(2, '0')}  t=${String(info.t).padStart(5)}s  ${info.slate}`);
  }
} finally {
  await browser.close();
}

const real = errors.filter((e) => !/SwiftShader|WebGL.*deprecated|GroupMarker|ReadPixels/i.test(e));
if (real.length) {
  console.error(`\n  ${real.length} error(s):`);
  [...new Set(real)].slice(0, 6).forEach((e) => console.error(`   ${e.slice(0, 300)}`));
  process.exit(1);
}
console.log(`\n  frames in shots/${path.basename(outDir)}/\n`);
