/**
 * Reproduce the phone report: "imported a Mixamo .fbx from the Cast panel and
 * nothing happened".
 *
 * Drives the real UI — opens the Cast tab, clicks the character's import
 * button, answers the file chooser with test/fixtures/Remy.fbx — rather than
 * calling production.setAvatar directly, because the UI path is what is
 * suspect. Runs the flow from file:// and from http:// so origin-scoped
 * behaviour (IndexedDB) is distinguishable from app logic.
 *
 * Software rendering is the only GL here, so the render target is pinned to
 * 1x: at a phone's real DPR a single frame takes seconds and starves the
 * microtask queue, which masquerades as "IndexedDB hangs".
 *
 *   node tools/dbg-import.mjs
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'test/fixtures/Remy.fbx');
const dist = path.join(root, 'dist/playhouse.html');
const shots = path.join(root, 'shots/dbg-import');
if (!fs.existsSync(fixture)) { console.error(`no such fixture: ${fixture}`); process.exit(1); }
if (!fs.existsSync(dist)) { console.error('build dist first: node tools/build.mjs'); process.exit(1); }
fs.mkdirSync(shots, { recursive: true });

const IGNORABLE = /WebGL.*deprecated|SwiftShader|Automatic fallback|GroupMarkerNotSet/i;

const html = fs.readFileSync(dist);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const httpUrl = `http://127.0.0.1:${server.address().port}/playhouse.html`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const idbSnapshot = () => new Promise((resolve) => {
  const trace = [];
  let done = false;
  const finish = (o) => { if (!done) { done = true; resolve({ ...o, trace }); } };
  let req;
  try { req = indexedDB.open('playhouse', 1); } catch (e) { finish({ ok: false, err: `open threw ${e.name}: ${e.message}` }); return; }
  req.onupgradeneeded = () => trace.push('upgradeneeded');
  req.onblocked = () => { trace.push('blocked'); finish({ ok: false, err: 'open blocked' }); };
  req.onerror = () => finish({ ok: false, err: `open error ${req.error?.name}: ${req.error?.message}` });
  req.onsuccess = () => {
    trace.push('open ok');
    const db = req.result;
    const stores = [...db.objectStoreNames];
    if (!stores.includes('avatars')) { db.close(); finish({ ok: true, stores, keys: [] }); return; }
    const tx = db.transaction('avatars', 'readonly');
    const k = tx.objectStore('avatars').getAllKeys();
    const v = tx.objectStore('avatars').getAll();
    tx.oncomplete = () => {
      db.close();
      finish({
        ok: true,
        stores,
        keys: k.result,
        sizes: v.result.map((r) => r?.buffer?.byteLength ?? -1),
        filenames: v.result.map((r) => r?.filename),
      });
    };
    tx.onerror = () => { db.close(); finish({ ok: true, stores, err: `tx ${tx.error?.name}: ${tx.error?.message}` }); };
  };
  setTimeout(() => finish({ ok: false, err: 'never settled in 25s' }), 25000);
});

const results = [];
for (const url of [`file://${dist}`, httpUrl]) {
  try {
    results.push(await run(url));
  } catch (e) {
    console.error(`  !! run aborted: ${e.message}`);
    results.push({ origin: url, q1: 'aborted', q2: 'aborted', q3: 'aborted', q4: 'aborted' });
  }
}

await browser.close();
server.close();

console.log('\n\n================ SUMMARY ================');
for (const r of results) {
  console.log(`\n  ${r.origin}`);
  console.log(`   1 import control : ${r.q1}`);
  console.log(`   2 boot restore   : ${r.q2}`);
  console.log(`   3 setAvatar (UI) : ${r.q3}`);
  console.log(`   4 idb persistence: ${r.q4}`);
}
console.log('');

// ---------------------------------------------------------------------------

function uiState() {
  const body = document.getElementById('sheetBody');
  const p = window.playhouse.production;
  return {
    toast: document.getElementById('toast').textContent,
    avatars: [...p.avatars.keys()],
    avatarFiles: [...p.avatarFiles.keys()],
    buttons: [...body.querySelectorAll('button')].map((b) => b.textContent.trim()),
    status: [...body.querySelectorAll('.hint')].map((h) => h.textContent.trim().slice(0, 90)),
    cast: [...p.cast.entries()].map(([n, g]) => {
      let sk = 0; let me = 0;
      g.traverse((o) => { if (o.isSkinnedMesh) sk++; else if (o.isMesh) me++; });
      return `${n} skinned=${sk} mesh=${me} inScene=${!!g.parent}`;
    }),
  };
}

async function run(url) {
  const origin = url.startsWith('file:') ? 'file' : 'http';
  console.log(`\n\n======================================================`);
  console.log(`  ORIGIN ${origin}  ${url}`);
  console.log(`======================================================`);

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n      ${(e.stack || '').split('\n').slice(1, 4).join('\n      ')}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 120000 });
  // Keep the main thread available: software GL at full rate starves everything.
  await page.evaluate(() => {
    window.playhouse.production.pause();
    window.playhouse.engine.renderer.setPixelRatio(0.5);
    window.playhouse.engine.postEnabled = false;
  });
  console.log('  booted');

  // ---- Q2: does the boot-time restore path work at all? --------------------
  const idb0 = await page.evaluate(idbSnapshot);
  console.log(`  idb at boot: ${JSON.stringify(idb0)}`);

  // ---- Q1: does the Cast panel render an import control? -------------------
  await page.evaluate(() => document.querySelector('.tab[data-panel="cast"]').click());
  await page.waitForTimeout(600);

  const panel = await page.evaluate(() => {
    const body = document.getElementById('sheetBody');
    const inputs = [...body.querySelectorAll('input[type=file]')];
    return {
      sheetOpen: document.getElementById('sheet').classList.contains('open'),
      cards: body.querySelectorAll('.card').length,
      fileInputs: inputs.length,
      accepts: inputs.map((i) => i.accept),
      inputDisplay: inputs.map((i) => getComputedStyle(i).display),
      buttons: [...body.querySelectorAll('button')].map((b) => b.textContent.trim()),
      characters: window.playhouse.production.script.characters.map((c) => c.name),
      intro: body.querySelector('.hint')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
    };
  });
  console.log(`  cast panel: ${JSON.stringify(panel, null, 2).replace(/\n/g, '\n  ')}`);

  const target = panel.characters[0];
  const acceptTokens = (panel.accepts[0] || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  const acceptsFbx = acceptTokens.length === 0
    || acceptTokens.some((t) => t === '.fbx' || t === '*/*' || t === 'application/octet-stream');
  console.log(`  accept="${panel.accepts[0]}" -> a .fbx is offerable by the OS picker: ${acceptsFbx}`);

  // ---- Q3: drive the real UI ----------------------------------------------
  await page.evaluate(() => {
    window.__ph = { change: 0, files: null };
    const input = document.querySelector('#sheetBody input[type=file]');
    input.addEventListener('change', () => {
      window.__ph.change++;
      window.__ph.files = [...(input.files || [])].map((f) => `${f.name} ${f.size}`);
    }, true);
  });

  let chooserSeen = false;
  page.on('filechooser', async (chooser) => { chooserSeen = true; await chooser.setFiles(fixture); });

  const importBtn = page.locator('#sheetBody button', { hasText: /Import avatar|Replace avatar/ }).first();
  console.log(`  import button visible: ${await importBtn.isVisible().catch(() => false)}`);

  const t0 = Date.now();
  await importBtn.click({ timeout: 60000 });

  // Watch for the whole of importAvatarFor, not just setAvatar: the success
  // toast and the panel refresh both come after the persistence await.
  const seen = [];
  let hadAvatar = 0;
  let sawSuccessToast = 0;
  let sawPanelRefresh = 0;
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(uiState);
    if (s.toast && seen[seen.length - 1]?.text !== s.toast) {
      seen.push({ t: +((Date.now() - t0) / 1000).toFixed(1), text: s.toast });
    }
    if (!hadAvatar && s.avatars.includes(target)) hadAvatar = (Date.now() - t0) / 1000;
    if (!sawSuccessToast && /retargeted/.test(s.toast)) sawSuccessToast = (Date.now() - t0) / 1000;
    if (!sawPanelRefresh && s.buttons.includes('Replace avatar')) sawPanelRefresh = (Date.now() - t0) / 1000;
    if (/Could not load/i.test(s.toast)) break;
    if (sawSuccessToast && sawPanelRefresh) break;
    await page.waitForTimeout(500);
  }
  const state = await page.evaluate(uiState);
  console.log(`  file chooser opened: ${chooserSeen}`);
  console.log(`  change event on input: ${JSON.stringify(await page.evaluate(() => window.__ph))}`);
  console.log(`  toasts: ${JSON.stringify(seen)}`);
  console.log(`  production.avatars @ ${hadAvatar || 'never'}s : ${JSON.stringify(state.avatars)}`);
  console.log(`  success toast     @ ${sawSuccessToast || 'NEVER'}s`);
  console.log(`  panel refreshed   @ ${sawPanelRefresh || 'NEVER'}s  buttons=${JSON.stringify(state.buttons)}`);
  console.log(`  cast: ${JSON.stringify(state.cast)}`);
  if (state.avatars.includes(target)) {
    const rep = await page.evaluate((n) => window.playhouse.production.avatars.get(n)?.report, target);
    console.log(`  report: kind=${rep.kind} retargeted=${rep.retargeted}/21 scale=${rep.appliedScale} visemes=${rep.visemes}`);
  }

  // Look at it: the complaint was visual.
  await page.evaluate((n) => {
    const { engine, production } = window.playhouse;
    const c = production.cast.get(n);
    if (!c) return;
    engine.camera.position.set(c.position.x + 0.2, 1.4, c.position.z + 3.0);
    engine.camera.lookAt(c.position.x, 0.95, c.position.z);
    engine.camera.fov = 42; engine.camera.updateProjectionMatrix();
    engine.renderer.setPixelRatio(1);
    engine.renderer.setRenderTarget(null);
    engine.renderer.render(engine.scene, engine.camera);
  }, target);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, `${origin}-after-import.png`) });

  // Control: same bytes, non-UI path, only if the UI path did not land.
  let directOk = null;
  if (!state.avatars.includes(target)) {
    const b64 = fs.readFileSync(fixture).toString('base64');
    directOk = await page.evaluate(async ({ b, name }) => {
      const bin = atob(b);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      try {
        const r = await window.playhouse.production.setAvatar(name, buf.buffer, 'Remy.fbx');
        return { ok: true, kind: r.kind, retargeted: r.retargeted };
      } catch (e) { return { ok: false, err: `${e.name}: ${e.message}` }; }
    }, { b: b64, name: target });
    console.log(`  control (direct setAvatar): ${JSON.stringify(directOk)}`);
  }

  // ---- Q4: did it persist, and does a reload bring it back? ---------------
  const idb1 = await page.evaluate(idbSnapshot);
  console.log(`  idb after import: ${JSON.stringify(idb1)}`);

  console.log('  reloading…');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 120000 });
  await page.evaluate(() => {
    window.playhouse.production.pause();
    window.playhouse.engine.renderer.setPixelRatio(0.5);
    window.playhouse.engine.postEnabled = false;
  });
  let restored = [];
  let restoreAt = 0;
  const t1 = Date.now();
  for (let i = 0; i < 240; i++) {
    restored = await page.evaluate(() => [...window.playhouse.production.avatars.keys()]);
    if (restored.length) { restoreAt = (Date.now() - t1) / 1000; break; }
    await page.waitForTimeout(500);
  }
  const afterReload = await page.evaluate(uiState);
  console.log(`  after reload avatars=${JSON.stringify(restored)} @ ${restoreAt || 'NEVER'}s`);
  console.log(`  after reload cast: ${JSON.stringify(afterReload.cast)}`);
  await page.screenshot({ path: path.join(shots, `${origin}-after-reload.png`) });

  const real = [...new Set(errors)].filter((e) => !IGNORABLE.test(e));
  console.log(`\n  console/page errors (${real.length}):`);
  real.forEach((e) => console.log(`    ${e.slice(0, 900)}`));

  await ctx.close();

  return {
    origin: url,
    q1: `${panel.fileInputs} input(s) wired, chooser opened=${chooserSeen}, `
      + `accept="${panel.accepts[0]}" offers .fbx=${acceptsFbx}`,
    q2: `idb readable=${idb0.ok}${idb0.err ? ` (${idb0.err})` : ''}`,
    q3: state.avatars.includes(target)
      ? `applied @${hadAvatar.toFixed(1)}s; success toast=${sawSuccessToast || 'NEVER'}; panel refresh=${sawPanelRefresh || 'NEVER'}`
      : `FAILED (direct path: ${JSON.stringify(directOk)})`,
    q4: `stored keys=${JSON.stringify(idb1.keys)} sizes=${JSON.stringify(idb1.sizes)}; `
      + `after reload=${JSON.stringify(restored)} @${restoreAt || 'NEVER'}s`,
  };
}
