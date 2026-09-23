/**
 * Verify the generated jaw on a model that ships no blendshapes.
 *
 * Loads an avatar, reports what was synthesised, then renders the face at
 * jaw-closed and jaw-open so the deformation can be judged rather than assumed.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || 'test/fixtures/Remy.fbx';
const abs = path.resolve(root, file);
if (!fs.existsSync(abs)) { console.error(`  no such file: ${abs}`); process.exit(1); }

const out = path.join(root, 'shots/jaw');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`file://${path.join(root, 'dist/playhouse.html')}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 30000 });

const bytes = fs.readFileSync(abs);
console.log(`\n  importing ${path.basename(abs)} (${(bytes.length / 1048576).toFixed(1)} MB)…`);

const report = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const p = window.playhouse.production;
  p.pause();
  window.__realUpdate = p.update.bind(p);
  const name = p.script.characters[0].name;
  const rep = await p.setAvatar(name, buf.buffer, 'test');
  return { name, rep };
}, bytes.toString('base64'));

console.log('  ' + JSON.stringify(report.rep, null, 2).replace(/\n/g, '\n  '));

// Frame the head, then render closed vs open.
for (const [label, influence] of [['closed', 0], ['open', 1], ['half', 0.5]]) {
  await page.evaluate(({ name, influence }) => {
    const p = window.playhouse.production;
    const eng = window.playhouse.engine;
    p.update = window.__realUpdate;
    const THREE = window.playhouse.THREE;
    const rig = p.cast.get(name);

    p.seek(2);
    for (let k = 0; k < 30; k++) p.update(1 / 60, 2 + k / 60);
    // Freeze the frame loop so it cannot overwrite the camera or the morphs.
    p.update = () => {};

    // Drive every generated jaw morph directly.
    let driven = 0;
    rig.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary && 'jawOpen' in o.morphTargetDictionary) {
        o.morphTargetInfluences[o.morphTargetDictionary.jawOpen] = influence;
        driven++;
      }
    });
    window.__driven = driven;

    // Neutral bright light so geometry is what's judged, not the mood.
    if (!window.__studio) {
      const studio = new THREE.Group();
      studio.add(new THREE.HemisphereLight('#ffffff', '#606060', 2.4));
      const k = new THREE.DirectionalLight('#fff4e6', 2.6);
      k.position.set(-2, 3, 4);
      studio.add(k);
      const r2 = new THREE.DirectionalLight('#cfe0ff', 1.2);
      r2.position.set(3, 2, -3);
      studio.add(r2);
      eng.scene.add(studio);
      window.__studio = studio;
    }

    const head = rig.userData.bones.head;
    head.updateWorldMatrix(true, false);
    const hp = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
    const fwd = new THREE.Vector3(Math.sin(rig.rotation.y), 0, Math.cos(rig.rotation.y));
    eng.camera.position.copy(hp).addScaledVector(fwd, 0.62).add(new THREE.Vector3(0, 0.05, 0));
    eng.camera.fov = 34;
    eng.camera.updateProjectionMatrix();
    eng.camera.lookAt(hp.clone().add(new THREE.Vector3(0, 0.015, 0)));
    eng.fade = 1;
    eng.render(2);
  }, { name: report.name, influence });

  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `jaw-${label}.png`) });
  console.log(`  ✓ jaw-${label}.png`);
}

const driven = await page.evaluate(() => window.__driven);
console.log(`\n  meshes driven: ${driven}`);

await browser.close();
const real = errors.filter((e) => !/SwiftShader|WebGL.*deprecated|GroupMarker/i.test(e));
if (real.length) {
  console.error(`\n  ✗ ${real.length} error(s):`);
  [...new Set(real)].slice(0, 6).forEach((e) => console.error(`   ${e.slice(0, 400)}`));
  process.exit(1);
}
console.log('  ✓ clean\n');
