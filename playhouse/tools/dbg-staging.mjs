/**
 * Reproduce the report: "edited the script in the Script panel, pressed the
 * button, and nothing happened — the demo just replayed."
 *
 * Drives the real UI rather than calling stageScript() directly, because the
 * panel is what is suspect. Part A presses "Stage it" straight after editing.
 * Part B does the same edit but closes and reopens the sheet in between, the
 * way someone does when they glance at the stage mid-compose.
 *
 * Throwaway — delete once the panel keeps its own text.
 *
 *   node tools/dbg-staging.mjs
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Exactly as supplied: no trailing newline after the last line of dialogue.
const USER_SCRIPT = `Title: The Lamplighter's Hour
Author: a Playhouse demo

INT. OUTSIFR BY A TREE

The scene begins with MIREN pulling an apple from the tree and inspecting it, walking around Corval slowly

MIREN
(quietly)
You said the light would hold until midnight.

CORVAL
I said it would hold. I never said for whom.

Miren lifts her hand and the apple flares, throwing gold across the sky.

MIREN
(singing)
~ Every hour I have counted here
~ Every hour I have kept
~ And the glass has held the flame so near
~ While the whole great house slept

CORVAL
(hard)
Then stop counting.

The apple falls from Miren's hand. A shot of it rolling to the ground.

MIREN
~ I will not be the one who lets it go
~ I will not be the dark!

[[shield: MIREN]]

CORVAL
You were always going to be.

CUT TO:

INT. THE STAIRWELL - NIGHT

MIREN
(afraid)
Corval? The lamp is still there`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const consoleErrors = [];
const pageErrors = [];

/** @returns {Promise<import('playwright').Page>} a booted app */
async function boot(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${viewport.width}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`[${viewport.width}] ${e.message}\n${e.stack || ''}`));
  await page.goto(`file://${path.join(root, 'dist/playhouse.html')}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('boot')?.classList.contains('gone'),
    { timeout: 90000 },
  );
  return page;
}

const readback = (page) => page.evaluate(() => ({
  title: window.playhouse.production.script.meta.title,
  scenes: window.playhouse.production.script.scenes.map((s) => ({
    heading: s.heading, location: s.location, beats: s.beats.length, characters: s.characters,
  })),
  shots: window.playhouse.production.plan.shots.length,
}));

const textarea = (page) => page.locator('#sheetBody textarea');
const stageBtn = (page) => page.locator('#sheetBody .btn.primary');

// ---------------------------------------------------------------------------
// A. Edit, then press the button immediately.
// ---------------------------------------------------------------------------

let page = await boot({ width: 390, height: 844 });
console.log('\n===== A. edit -> Stage it =====');
console.log('before:', JSON.stringify(await readback(page), null, 2));

await page.click('.tab[data-panel="script"]');
await page.waitForTimeout(400);
await page.evaluate((text) => {
  const ta = document.querySelector('#sheetBody textarea');
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, USER_SCRIPT);
console.log(`"Stage it" buttons found: ${await stageBtn(page).count()}`);
await stageBtn(page).click();
await page.waitForTimeout(1200);

console.log('toast:', JSON.stringify(await page.locator('#toast').innerText()));
console.log('after:', JSON.stringify(await readback(page), null, 2));
await page.close();

// ---------------------------------------------------------------------------
// B. Edit, close and reopen the sheet, then press the button.
// ---------------------------------------------------------------------------

page = await boot({ width: 390, height: 844 });
console.log('\n===== B. edit -> close sheet -> reopen -> Stage it =====');

await page.click('.tab[data-panel="script"]');
await page.waitForTimeout(400);
await textarea(page).fill(USER_SCRIPT);
console.log('typed, textarea holds the new script:', (await textarea(page).inputValue()).includes('OUTSIFR'));

await page.click('#btnCloseSheet');
await page.waitForTimeout(400);
await page.click('.tab[data-panel="script"]');
await page.waitForTimeout(400);
console.log('after reopen, textarea still holds it:', (await textarea(page).inputValue()).includes('OUTSIFR'));
console.log('textarea now starts:', JSON.stringify((await textarea(page).inputValue()).slice(0, 56)));

await stageBtn(page).click();
await page.waitForTimeout(1200);
console.log('toast:', JSON.stringify(await page.locator('#toast').innerText()));
console.log('after:', JSON.stringify(await readback(page), null, 2));
await page.close();

// ---------------------------------------------------------------------------
// C. Desktop: same loss via the tab, which stays reachable beside the panel.
// ---------------------------------------------------------------------------

page = await boot({ width: 1280, height: 720 });
console.log('\n===== C. desktop: edit -> peek at Cast -> back to Script -> Stage it =====');

await page.click('.tab[data-panel="script"]');
await page.waitForTimeout(400);
await textarea(page).fill(USER_SCRIPT);
await page.click('#btnCloseSheet');
await page.waitForTimeout(300);
await page.click('.tab[data-panel="cast"]');
await page.waitForTimeout(400);
await page.click('#btnCloseSheet');
await page.waitForTimeout(300);
await page.click('.tab[data-panel="script"]');
await page.waitForTimeout(400);
console.log('after Cast round-trip, textarea still holds it:',
  (await textarea(page).inputValue()).includes('OUTSIFR'));

await stageBtn(page).click();
await page.waitForTimeout(1000);
console.log('toast:', JSON.stringify(await page.locator('#toast').innerText()));
console.log('after:', JSON.stringify(await readback(page), null, 2));
await page.close();

console.log('\n===== CONSOLE ERRORS =====');
console.log(consoleErrors.length ? consoleErrors.join('\n---\n') : '(none)');
console.log('===== PAGE ERRORS =====');
console.log(pageErrors.length ? pageErrors.join('\n---\n') : '(none)');

await browser.close();
