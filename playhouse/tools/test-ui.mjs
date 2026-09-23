/**
 * End-to-end UI tests for the two user-facing flows that were reported broken:
 *
 *   A. Script staging — typing persists across tab switches, "Stage it" stages
 *      the CURRENT text, parse results are reported honestly (0-beat refusal,
 *      0-character warning), and the script survives a reload via localStorage.
 *   B. Avatar import — the Cast panel picker offers .fbx, a progress state
 *      shows during the load, the import report appears after, the avatar
 *      persists to IndexedDB and restores at boot, and Remove reverts to the
 *      procedural body.
 *
 * Everything goes through the real DOM (tab clicks, textarea input events,
 * setInputFiles on the panel's own <input type=file>), never through
 * production.* shortcuts.
 *
 *   node tools/build.mjs && node tools/test-ui.mjs
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist/playhouse.html');
const fixture = path.join(root, 'test/fixtures/Remy.fbx');
if (!fs.existsSync(dist)) { console.error('build first: node tools/build.mjs'); process.exit(1); }
if (!fs.existsSync(fixture)) { console.error(`missing fixture: ${fixture}`); process.exit(1); }

const IGNORABLE = /WebGL.*deprecated|SwiftShader|Automatic fallback|GroupMarkerNotSet/i;
const url = `file://${dist}`;

// ---------------------------------------------------------------------------
// Scripts under test
// ---------------------------------------------------------------------------

const NEW_SCRIPT = `Title: The Test of Tabs

INT. THE REHEARSAL ROOM - DAY

A bare room. Two chairs face each other.

ODA
The words we type should not vanish.

BRETT
Then stage them and see.

EXT. THE COURTYARD - NIGHT

ODA
Still here after the tab came back.
`;

const ZERO_BEAT = `INT. NOWHERE - DAY
`;

const ACTION_ONLY = `Title: Silent Piece

INT. AN EMPTY HALL - NIGHT

Dust settles over the floorboards.

A door opens somewhere far away.
`;

const DRAFT = `Title: Draft After Reload

INT. THE ARCHIVE - DAY

VESS
Nothing typed here should be lost.
`;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** Software GL at full rate starves the main thread; calm it before probing. */
async function boot(page) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'),
    { timeout: 120000 });
  await page.evaluate(() => {
    window.playhouse.production.pause();
    window.playhouse.engine.renderer.setPixelRatio(0.5);
    window.playhouse.engine.postEnabled = false;
  });
}

const clickTab = (page, panel) => page.evaluate(
  (p) => document.querySelector(`.tab[data-panel="${p}"]`).click(), panel);

const clickButton = (page, label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('#sheetBody button')]
    .find((x) => x.textContent.trim() === t);
  if (!b) throw new Error(`no "${t}" button in the sheet`);
  b.click();
}, label);

const snapshot = (page) => page.evaluate(() => {
  const body = document.getElementById('sheetBody');
  return {
    title: window.playhouse.production.script?.meta.title,
    sheetOpen: document.getElementById('sheet').classList.contains('open'),
    toast: document.getElementById('toast').textContent,
    textarea: body.querySelector('textarea')?.value ?? null,
    hints: [...body.querySelectorAll('.hint')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
    buttons: [...body.querySelectorAll('button')].map((b) => ({
      text: b.textContent.trim(), disabled: b.disabled,
    })),
    accepts: [...body.querySelectorAll('input[type=file]')].map((i) => i.accept),
    avatars: [...window.playhouse.production.avatars.keys()],
    characters: window.playhouse.production.script?.characters.map((c) => c.name) ?? [],
  };
});

/** Set the Script textarea like a user would: focus + value + input event. */
async function fillScript(page, text) {
  try {
    await page.fill('#sheetBody textarea', text, { timeout: 15000 });
  } catch {
    // Actionability can time out under software rendering; same DOM path by hand.
    await page.evaluate((t) => {
      const ta = document.querySelector('#sheetBody textarea');
      ta.focus();
      ta.value = t;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  }
}

async function until(page, timeoutMs, fn, arg = null, everyMs = 400) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await page.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await page.waitForTimeout(everyMs);
  }
}

const idbKeys = () => new Promise((resolve) => {
  try {
    const req = indexedDB.open('playhouse', 1);
    req.onerror = () => resolve({ err: String(req.error) });
    req.onsuccess = () => {
      const db = req.result;
      if (![...db.objectStoreNames].includes('avatars')) { db.close(); resolve({ keys: [] }); return; }
      const tx = db.transaction('avatars', 'readonly');
      const k = tx.objectStore('avatars').getAllKeys();
      tx.oncomplete = () => { const keys = k.result; db.close(); resolve({ keys }); };
      tx.onerror = () => { db.close(); resolve({ err: String(tx.error) }); };
    };
    setTimeout(() => resolve({ err: 'idb probe timed out' }), 20000);
  } catch (e) { resolve({ err: e.message }); }
});

function collectErrors(page, sink) {
  page.on('pageerror', (e) => sink.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') sink.push(`[console.error] ${m.text()}`); });
}

// ---------------------------------------------------------------------------
// Flow A — script staging (desktop)
// ---------------------------------------------------------------------------

async function flowStaging(browser) {
  console.log('\n== Flow A: script staging (desktop 1280x720) ==');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);
  try {
    await boot(page);
    let s = await snapshot(page);
    check('boots the sample on first run', s.title === "The Lamplighter's Hour", `title=${s.title}`);

    await clickTab(page, 'script');
    s = await snapshot(page);
    check('Script panel shows the current text', s.textarea?.startsWith("Title: The Lamplighter's Hour"),
      `starts "${(s.textarea || '').slice(0, 40)}"`);

    // 1. Typing survives a round trip through another tab.
    await fillScript(page, NEW_SCRIPT);
    await clickTab(page, 'cast');
    await page.waitForTimeout(300);
    await clickTab(page, 'script');
    s = await snapshot(page);
    check('typed script survives switching tabs and back', s.textarea === NEW_SCRIPT,
      `textarea starts "${(s.textarea || '').slice(0, 40)}"`);

    // 2. Stage it stages the CURRENT text and reports counts.
    await clickButton(page, 'Stage it');
    s = await snapshot(page);
    check('Stage it stages the current text', s.title === 'The Test of Tabs', `title=${s.title}`);
    check('summary toast reports scene and cast counts',
      /2 scenes, 2 speaking parts, \d+ beats?, \d+ shots?/.test(s.toast), `toast="${s.toast}"`);
    check('sheet closes after a clean staging', !s.sheetOpen);
    await page.evaluate(() => window.playhouse.production.pause());

    await clickTab(page, 'script');
    s = await snapshot(page);
    const status = s.hints.find((h) => h.startsWith('Staged'));
    check('status line survives the panel re-render',
      !!status && status.includes('The Test of Tabs') && status.includes('ODA') && status.includes('BRETT'),
      `status="${status}"`);

    // Desktop picker offers every supported format, including .fbx.
    await clickTab(page, 'cast');
    s = await snapshot(page);
    check('desktop picker accepts .glb,.gltf,.vrm,.fbx',
      s.accepts.length === 2 && s.accepts.every((a) => a === '.glb,.gltf,.vrm,.fbx,model/gltf-binary'),
      `accepts=${JSON.stringify(s.accepts)}`);

    // 3. A script with nothing stageable is refused, loudly, without
    //    tearing down the working production.
    await clickTab(page, 'script');
    await fillScript(page, ZERO_BEAT);
    await clickButton(page, 'Stage it');
    s = await snapshot(page);
    const refusal = s.hints.find((h) => h.startsWith('Nothing staged'));
    check('0-beat script is refused with a visible reason',
      !!refusal && refusal.includes('Found 1 scene heading'), `status="${refusal}"`);
    check('refusal keeps the previous production', s.title === 'The Test of Tabs', `title=${s.title}`);
    check('refusal keeps the sheet open', s.sheetOpen);

    // 4. Action-only scripts stage but warn about 0 speaking parts.
    await fillScript(page, ACTION_ONLY);
    await clickButton(page, 'Stage it');
    s = await snapshot(page);
    check('action-only script stages', s.title === 'Silent Piece', `title=${s.title}`);
    const warning = s.hints.find((h) => /no speaking parts/.test(h));
    check('0-character staging shows a visible warning', !!warning, `hints=${JSON.stringify(s.hints)}`);
    await page.evaluate(() => window.playhouse.production.pause());

    // 5. Staged text is in localStorage.
    let stored = await page.evaluate(() => localStorage.getItem('playhouse.script'));
    check('staged script is persisted to localStorage', stored?.startsWith('Title: Silent Piece'),
      `stored starts "${(stored || '').slice(0, 30)}"`);

    // 6. Un-staged typing persists too (debounced), and a reload returns to it.
    await fillScript(page, DRAFT);
    await page.waitForTimeout(900);
    stored = await page.evaluate(() => localStorage.getItem('playhouse.script'));
    check('un-staged typing is persisted after the debounce', stored === DRAFT,
      `stored starts "${(stored || '').slice(0, 30)}"`);

    await boot(page); // reload
    s = await snapshot(page);
    check('reload stages the saved draft', s.title === 'Draft After Reload', `title=${s.title}`);
    await clickTab(page, 'script');
    s = await snapshot(page);
    check('reload puts the draft back in the editor', s.textarea === DRAFT,
      `textarea starts "${(s.textarea || '').slice(0, 40)}"`);

    const real = [...new Set(errors)].filter((e) => !IGNORABLE.test(e));
    check('no console/page errors in flow A', real.length === 0, real.slice(0, 3).join(' | '));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// Flow B — avatar import (phone-shaped)
// ---------------------------------------------------------------------------

async function flowImport(browser) {
  console.log('\n== Flow B: avatar import (mobile 390x844, touch) ==');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);
  try {
    await boot(page);

    await clickTab(page, 'cast');
    let s = await snapshot(page);
    const touchInfo = await page.evaluate(() => ({
      maxTouchPoints: navigator.maxTouchPoints,
      coarse: matchMedia('(any-pointer: coarse)').matches,
    }));
    console.log(`  (touch heuristics: ${JSON.stringify(touchInfo)})`);
    check('touch-device picker is unfiltered (strict OS pickers)',
      s.accepts.length === 2 && s.accepts.every((a) => a === ''),
      `accepts=${JSON.stringify(s.accepts)}`);

    const target = s.characters[0];
    console.log(`  (importing Remy.fbx for ${target})`);

    // Feed the panel's own input; change fires and importAvatarFor runs.
    await page.locator('#sheetBody input[type=file]').first().setInputFiles(fixture, { timeout: 20000 });

    // Watch the whole import: progress state first, then the report.
    let sawLoadingToast = false;
    let sawBusyButton = false;
    let sawBusyHint = false;
    let final = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      s = await snapshot(page);
      if (/^Loading Remy\.fbx/.test(s.toast)) sawLoadingToast = true;
      if (s.buttons.some((b) => b.text === 'Loading…' && b.disabled)) sawBusyButton = true;
      if (s.hints.some((h) => h.includes('Loading Remy.fbx'))) sawBusyHint = true;
      if (/retargeted/.test(s.toast) || /Could not load/.test(s.toast)) { final = s; break; }
      await page.waitForTimeout(250);
    }
    check('progress toast shows during the load', sawLoadingToast);
    check('card shows a disabled Loading state during the load', sawBusyButton && sawBusyHint,
      `button=${sawBusyButton} hint=${sawBusyHint}`);
    check('import completes with a report toast', !!final && /retargeted/.test(final.toast),
      `toast="${(final || s).toast}"`);
    if (final) {
      check('report counts bones matched', /\d+\/21 bones retargeted/.test(final.toast),
        `toast="${final.toast}"`);
      check('report says whether a jaw was generated',
        /jaw generated across \d+ mesh|visemes found|no visemes/.test(final.toast),
        `toast="${final.toast}"`);
      console.log(`  (report toast: "${final.toast}")`);
    }
    s = await until(page, 15000, () => {
      const body = document.getElementById('sheetBody');
      const labels = [...body.querySelectorAll('button')].map((b) => b.textContent.trim());
      return labels.includes('Replace avatar') && labels.includes('Remove');
    }) ? await snapshot(page) : s;
    check('avatar applied through the UI path', s.avatars.includes(target),
      `avatars=${JSON.stringify(s.avatars)}`);
    check('panel offers Replace and Remove after import',
      s.buttons.some((b) => b.text === 'Replace avatar') && s.buttons.some((b) => b.text === 'Remove'),
      `buttons=${JSON.stringify(s.buttons.map((b) => b.text))}`);

    let idb = await page.evaluate(idbKeys);
    check('avatar persisted to IndexedDB', !idb.err && idb.keys.includes(target),
      JSON.stringify(idb));

    // Restore at boot.
    await boot(page); // reload, same context = same storage
    const restored = await until(page, 60000,
      (n) => window.playhouse.production.avatars.has(n), target, 500);
    check('avatar restores from IndexedDB at boot', !!restored);

    // Remove reverts to the procedural body and clears storage.
    await clickTab(page, 'cast');
    await page.waitForTimeout(300);
    await clickButton(page, 'Remove');
    const reverted = await until(page, 20000, (n) => {
      const labels = [...document.querySelectorAll('#sheetBody button')].map((b) => b.textContent.trim());
      return labels.includes('Import avatar') && !window.playhouse.production.avatars.has(n);
    }, target, 400);
    check('Remove reverts to the procedural body', !!reverted);
    idb = await page.evaluate(idbKeys);
    check('Remove clears the stored avatar', !idb.err && !idb.keys.includes(target),
      JSON.stringify(idb));

    const real = [...new Set(errors)].filter((e) => !IGNORABLE.test(e));
    check('no console/page errors in flow B', real.length === 0, real.slice(0, 3).join(' | '));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

try {
  await flowStaging(browser);
  await flowImport(browser);
} catch (e) {
  failed++;
  console.error(`  FAIL  harness aborted — ${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
