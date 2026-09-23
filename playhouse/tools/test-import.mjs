/**
 * Round-trips a .glb through the avatar importer and retargeter.
 *
 * Uses the procedural fixture by default; pass a path to test a real avatar
 * (e.g. `node tools/test-import.mjs avatars/MIREN.glb`).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(root, 'test/fixtures/procedural.glb');

if (!fs.existsSync(fixture)) { console.error(`  no such file: ${fixture}`); process.exit(1); }
const bytes = Array.from(fs.readFileSync(fixture));
const shots = path.join(root, 'shots/import');
fs.mkdirSync(shots, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errors = [];
p.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(1, 5).join('\n')}`));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await p.goto(`file://${path.join(root, 'dist/playhouse.html')}`, { waitUntil: 'load' });
await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 25000 });

console.log(`\n  importing ${path.basename(fixture)} (${(bytes.length / 1024 / 1024).toFixed(1)} MB) as MIREN…`);
const report = await p.evaluate(async (data) => {
  const buffer = new Uint8Array(data).buffer;
  try {
    return await window.playhouse.production.setAvatar('MIREN', buffer, 'test.glb');
  } catch (e) {
    return { error: e.message, stack: e.stack };
  }
}, bytes);

console.log('  ' + JSON.stringify(report, null, 2).replace(/\n/g, '\n  '));

if (!report.error) {
  // Drive it through a few beats so retargeting actually runs.
  for (const [i, t] of [3, 12, 22, 40].entries()) {
    await p.evaluate((time) => {
      const prod = window.playhouse.production;
      prod.pause(); prod.seek(time);
      for (let k = 0; k < 30; k++) prod.update(1 / 60, time + k / 60);
      window.playhouse.engine.render(time);
    }, t);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(shots, `import-${i}.png`) });
  }
  // A neutral look at the imported body, away from mood lighting.
  await p.evaluate(() => {
    const { engine, production } = window.playhouse;
    const c = production.cast.get('MIREN');
    engine.camera.position.set(c.position.x + 0.1, 1.35, c.position.z + 2.6);
    engine.camera.lookAt(c.position.x, 0.95, c.position.z);
    engine.camera.fov = 40; engine.camera.updateProjectionMatrix();
    engine.postEnabled = false;
    engine.renderer.setRenderTarget(null);
    engine.renderer.render(engine.scene, engine.camera);
  });
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(shots, 'import-body.png') });
}

await b.close();

const ignorable = /WebGL.*deprecated|SwiftShader|Automatic fallback/i;
const real = errors.filter((e) => !ignorable.test(e));
if (report.error) { console.error(`\n  ✗ import failed: ${report.error}\n${report.stack || ''}`); process.exit(1); }
if (real.length) {
  console.error(`\n  ✗ ${real.length} error(s):`);
  [...new Set(real)].forEach((e) => console.error(`   ${e.slice(0, 600)}`));
  process.exit(1);
}
console.log(`\n  ✓ import clean — frames in shots/import/\n`);
