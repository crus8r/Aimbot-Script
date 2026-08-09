/**
 * Integration tests for the wired-up subsystems, through the real app:
 *
 *   A. Speech wiring — the play button arms TTS and dialogue beats speak
 *      through production.onBeatChange with the character's assigned voice;
 *      the speaker's Animator hands mouth ownership to the external envelope.
 *   B. Notes wiring — a note typed into the "+ Note" panel overlays the live
 *      shot (slate + camera), persists to localStorage per script, disables /
 *      deletes / undoes through the panel's own controls, and a prop note
 *      puts a freshly built prop into a character's hand.
 *   C. Staging beats — orbit walks an arc, hold parents the named prop to the
 *      hand, the insert beat cuts to a prop close-up, and a seek across beats
 *      returns the prop to its home position.
 *
 * A deterministic fake speechSynthesis is installed before boot (swiftshader
 * Chromium ships zero voices, confirmed in diag-audio.json).
 *
 *   node tools/build.mjs && node tools/test-wiring.mjs
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist/playhouse.html');
if (!fs.existsSync(dist)) { console.error('build first: node tools/build.mjs'); process.exit(1); }
const url = `file://${dist}`;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** page.evaluate with an outer timeout so a hung page can never hang the run. */
function ev(page, fn, arg, ms = 45000) {
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`evaluate timed out after ${ms}ms`)), ms)),
  ]);
}

// Minimal deterministic fake synth: voices exist immediately, utterances end
// on a timer, boundaries fire per word.
function installFakeSynth() {
  const log = { speaks: [], cancels: 0 };
  window.__tts = log;
  const voices = ['Aria', 'Brook', 'Cedar', 'Flint'].map((name, i) => ({
    name, lang: 'en-US', localService: true, voiceURI: `fake:${name.toLowerCase()}`, default: i === 0,
  }));
  const live = [];
  const synth = {
    speaking: false,
    paused: false,
    getVoices: () => voices.slice(),
    addEventListener() {}, removeEventListener() {},
    speak(u) {
      log.speaks.push({ text: u.text, voiceURI: u.voice?.voiceURI ?? null, volume: u.volume, pitch: u.pitch, rate: u.rate });
      const entry = { u, timers: [], cancelled: false };
      live.push(entry);
      synth.speaking = true;
      const dur = Math.max(150, (u.text.length * 22) / (u.rate || 1));
      entry.timers.push(setTimeout(() => { if (!entry.cancelled) u.onstart?.({}); }, 10));
      const words = [...u.text.matchAll(/\S+/g)];
      words.forEach((m, k) => entry.timers.push(setTimeout(() => {
        if (!entry.cancelled) u.onboundary?.({ name: 'word', charIndex: m.index, charLength: m[0].length });
      }, 20 + (dur - 40) * (k / Math.max(1, words.length)))));
      entry.timers.push(setTimeout(() => {
        if (entry.cancelled) return;
        synth.speaking = false;
        u.onend?.({});
      }, dur));
    },
    cancel() {
      log.cancels++;
      for (const e of live) { e.cancelled = true; e.timers.forEach(clearTimeout); }
      live.length = 0;
      synth.speaking = false;
    },
    pause() { synth.paused = true; },
    resume() { synth.paused = false; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, writable: true, configurable: true });
  const U = function SpeechSynthesisUtterance(text) {
    this.text = String(text ?? '');
    this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; this.lang = '';
    this.onstart = null; this.onend = null; this.onerror = null; this.onboundary = null;
  };
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: U, writable: true, configurable: true });
}

const STAGING_SCRIPT = `Title: Wiring Probe

EXT. THE ORCHARD - DAY

MARA stands under the branches. She walks around JON and picks up the apple.

MARA
Look at this one, still cold from the night air.

JON
Every branch gave more than the one before it.

She drops it.

A shot of it rolling to the ground.

JON
Leave it be.
`;

const pageErrors = [];

async function boot(page) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'),
    { timeout: 120000 });
  // Software GL starves timers at full size; make frames nearly free.
  await ev(page, () => {
    const e = window.playhouse.engine;
    e.postEnabled = false;
    e.renderer.setPixelRatio(1);
    e.setSize(96, 64);
  });
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

try {
  const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(`UNCAUGHT: ${e.message}`));
  await page.addInitScript(installFakeSynth);
  await boot(page);

  // =========================================================================
  console.log('\n== A: speech wiring through the app ==');
  // =========================================================================
  try {
    const before = await ev(page, () => ({
      speaks: window.__tts.speaks.filter((s) => s.volume > 0).length,
      unlocked: window.playhouse.speech.unlocked,
      enabled: window.playhouse.speech.enabled,
    }));
    check('speak-dialogue defaults ON', before.enabled === true);
    check('nothing audible before a gesture', before.speaks === 0 && !before.unlocked,
      JSON.stringify(before));

    // Pause (the boot autoplay is running), then a trusted play click arms TTS.
    await ev(page, () => window.playhouse.production.pause());
    await page.click('#btnPlay');
    const armed = await ev(page, async () => {
      const p = window.playhouse.production;
      const sp = window.playhouse.speech;
      // Jump to just before MIREN's first line and let the rAF loop drive.
      const shot = p.plan.shots.find((s) => s.beat?.type === 'dialogue');
      p.seek(shot.start + 0.05);
      const t0 = performance.now();
      while (performance.now() - t0 < 12000) {
        const audible = window.__tts.speaks.filter((s) => s.volume > 0);
        if (audible.length && sp.speaking) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const audible = window.__tts.speaks.filter((s) => s.volume > 0);
      const name = sp.character;
      const animator = name ? p.animators.get(name) : null;
      return {
        unlocked: sp.unlocked,
        playing: p.playing,
        audible: audible.map((s) => ({ text: s.text.slice(0, 24), uri: s.voiceURI })),
        speakingChar: name,
        beatChar: p.currentBeat?.character,
        externalMouth: animator ? animator.externalMouth : null,
        assignedUri: name ? (sp.planFor(name)?.voiceURI ?? null) : null,
      };
    }, null, 30000);
    check('play click arms the engine', armed.unlocked === true && armed.playing === true);
    check('the current dialogue beat is spoken', armed.audible.length >= 1,
      JSON.stringify(armed));
    check('speaker matches the beat', !!armed.speakingChar && armed.speakingChar === armed.beatChar,
      JSON.stringify(armed));
    check('line uses the character\'s assigned voice',
      armed.audible.length >= 1 && armed.audible[armed.audible.length - 1].uri === armed.assignedUri,
      JSON.stringify(armed));
    check('external envelope owns the speaker\'s mouth', armed.externalMouth === true);

    const paused = await (async () => {
      await page.click('#btnPlay'); // pause
      return ev(page, () => ({
        cancels: window.__tts.cancels,
        speaking: window.playhouse.speech.speaking,
        playing: window.playhouse.production.playing,
      }));
    })();
    check('pause cancels the live line', paused.playing === false && paused.speaking === false);

    const distinct = await ev(page, () => {
      const sp = window.playhouse.speech;
      return { m: sp.planFor('MIREN')?.voiceURI, c: sp.planFor('CORVAL')?.voiceURI };
    });
    check('MIREN and CORVAL cast different voices', distinct.m && distinct.c && distinct.m !== distinct.c,
      JSON.stringify(distinct));
  } catch (e) { check('A speech wiring', false, e.message); }

  // =========================================================================
  console.log('\n== B: notes through the "+ Note" panel ==');
  // =========================================================================
  try {
    // Restart playback, then tap + Note: it must pause and open the sheet.
    await page.click('#btnPlay');
    await page.click('#btnNote');
    const opened = await ev(page, () => ({
      playing: window.playhouse.production.playing,
      open: document.getElementById('sheet').classList.contains('open'),
      title: document.getElementById('sheetTitle').textContent,
      hasInput: !!document.querySelector('#sheetBody input[type=text]'),
    }));
    check('+ Note pauses playback and opens the sheet',
      !opened.playing && opened.open && opened.hasInput, JSON.stringify(opened));

    // Park on a dialogue shot, type a note, watch the echo, add it.
    const echo = await ev(page, () => {
      const p = window.playhouse.production;
      const shot = p.plan.shots.find((s) => s.beat?.type === 'dialogue');
      p.seek(shot.start + 0.05);
      p.update(1 / 60, 0);
      const input = document.querySelector('#sheetBody input[type=text]');
      input.value = 'much wider, low angle, make it shake';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const hints = [...document.querySelectorAll('#sheetBody .hint')].map((h) => h.textContent);
      return hints.find((h) => h.startsWith('Reads as:')) || '';
    });
    check('live echo shows the parsed interpretation',
      /wider → shot size \+2/.test(echo) && /handheld/.test(echo) && /low angle/.test(echo),
      `echo="${echo}"`);

    const applied = await ev(page, () => {
      const p = window.playhouse.production;
      const before = { slate: p.slate };
      const add = [...document.querySelectorAll('#sheetBody button')].find((b) => b.textContent === 'Add');
      add.click();
      for (let k = 0; k < 3; k++) p.update(1 / 60, k / 60);
      return {
        before: before.slate,
        after: p.slate,
        stored: Object.keys(localStorage).some((k) => k.startsWith('playhouse.notes.')),
        listed: [...document.querySelectorAll('#sheetBody .lyricrow')].length,
        error: [...document.querySelectorAll('#sheetBody .hint')].map((h) => h.textContent)
          .find((h) => /Couldn't read/.test(h)) || null,
      };
    });
    check('note overlays the live shot (slate shows it)',
      /handheld/.test(applied.after) && /low/.test(applied.after), JSON.stringify(applied));
    check('note persisted to localStorage', applied.stored === true);
    check('note appears in the panel list', applied.listed === 1);

    const gibberish = await ev(page, () => {
      const input = document.querySelector('#sheetBody input[type=text]');
      input.value = 'purple monkey dishwasher';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const hints = [...document.querySelectorAll('#sheetBody .hint')].map((h) => h.textContent);
      return hints.find((h) => /Couldn't read a direction/.test(h)) || '';
    });
    check('unparseable note reports an honest error', gibberish.length > 0, `echo="${gibberish}"`);

    const toggled = await ev(page, () => {
      const p = window.playhouse.production;
      const off = [...document.querySelectorAll('#sheetBody .lyricrow button')].find((b) => b.textContent === 'On');
      off.click();
      for (let k = 0; k < 3; k++) p.update(1 / 60, k / 60);
      const slateOff = p.slate;
      const on = [...document.querySelectorAll('#sheetBody .lyricrow button')].find((b) => b.textContent === 'Off');
      on.click();
      for (let k = 0; k < 3; k++) p.update(1 / 60, k / 60);
      return { slateOff, slateOn: p.slate };
    });
    check('disabling the note restores the pristine shot',
      !/handheld/.test(toggled.slateOff) && /handheld/.test(toggled.slateOn), JSON.stringify(toggled));

    const undone = await ev(page, () => {
      const p = window.playhouse.production;
      const del = [...document.querySelectorAll('#sheetBody .lyricrow button')].find((b) => b.textContent === '✕');
      del.click();
      const afterDelete = [...document.querySelectorAll('#sheetBody .lyricrow')].length;
      const undo = [...document.querySelectorAll('#sheetBody button')].find((b) => b.textContent === 'Undo');
      undo.click();
      const afterUndo = [...document.querySelectorAll('#sheetBody .lyricrow')].length;
      for (let k = 0; k < 3; k++) p.update(1 / 60, k / 60);
      return { afterDelete, afterUndo, slate: p.slate };
    });
    check('delete then Undo round-trips the note',
      undone.afterDelete === 0 && undone.afterUndo === 1 && /handheld/.test(undone.slate),
      JSON.stringify(undone));

    // Prop note: no lantern in the parlour — it should be built and held.
    const propNote = await ev(page, () => {
      const p = window.playhouse.production;
      const input = document.querySelector('#sheetBody input[type=text]');
      input.value = 'MIREN carries the lantern';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const add = [...document.querySelectorAll('#sheetBody button')].find((b) => b.textContent === 'Add');
      add.click();
      for (let k = 0; k < 8; k++) p.update(1 / 60, k / 60);
      const prop = (p.stage.userData.props || []).find((x) => x.userData.propName === 'lantern');
      const miren = p.cast.get('MIREN');
      let inHand = false;
      prop?.traverseAncestors?.((a) => { if (a === miren) inHand = true; });
      return { built: !!prop, heldByMiren: prop?.userData.heldBy === miren, inHand };
    });
    check('prop note builds the lantern and puts it in MIREN\'s hand',
      propNote.built && propNote.heldByMiren && propNote.inHand, JSON.stringify(propNote));

    const released = await ev(page, () => {
      const p = window.playhouse.production;
      const input = document.querySelector('#sheetBody input[type=text]');
      // Seek forward a touch so the release note lands after the hold note.
      p.seek(p.time + 0.6);
      p.update(1 / 60, 0);
      input.value = 'she puts the lantern down';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const add = [...document.querySelectorAll('#sheetBody button')].find((b) => b.textContent === 'Add');
      add.click();
      for (let k = 0; k < 8; k++) p.update(1 / 60, k / 60);
      const prop = (p.stage.userData.props || []).find((x) => x.userData.propName === 'lantern');
      return { stillHeld: !!prop?.userData.heldBy, y: prop ? +prop.position.y.toFixed(3) : null };
    });
    check('release note empties the hand and settles the prop',
      released.stillHeld === false && released.y === 0, JSON.stringify(released));

    // Reload: notes for this script come back from localStorage.
    await boot(page);
    const revived = await ev(page, () => ({
      notes: window.playhouse.production.notes.list().map((n) => n.text),
    }));
    check('notes survive a reload (per-script persistence)',
      revived.notes.length === 3 && revived.notes.includes('much wider, low angle, make it shake'),
      JSON.stringify(revived));
  } catch (e) { check('B notes wiring', false, e.message); }

  // =========================================================================
  console.log('\n== C: staging beats in production ==');
  // =========================================================================
  try {
    const staged = await ev(page, (script) => {
      const p = window.playhouse.production;
      window.playhouse.stageScript(script);
      p.pause();
      return {
        shots: p.plan.shots.map((s) => ({ id: s.id, insert: !!s.insert, prop: s.subjectProp || null })),
        staging: p.script.scenes[0].beats
          .filter((b) => b.type === 'action')
          .map((b) => b.staging.map((e) => e.kind)),
      };
    }, STAGING_SCRIPT);
    check('plan contains the prop insert shot', staged.shots.some((s) => s.insert && s.prop === 'apple'),
      JSON.stringify(staged.shots));
    check('beats carry orbit/hold/release staging',
      // Third action beat is the insert line — staging stays empty there.
      JSON.stringify(staged.staging) === JSON.stringify([['orbit', 'hold'], ['release'], []]),
      JSON.stringify(staged.staging));

    const walk = await ev(page, () => {
      const p = window.playhouse.production;
      // Enter the first action beat: orbit + hold fire.
      p.seek(2.7);
      p.update(1 / 60, 0);
      const mara = p.cast.get('MARA');
      const jon = p.cast.get('JON');
      const mover = p.movers.get('MARA');
      const d0 = mara.position.distanceTo(jon.position);
      const start = mara.position.clone();
      // Walk the arc: distance to JON should stay roughly constant while
      // MARA actually travels.
      let minD = Infinity;
      let maxD = 0;
      for (let k = 0; k < 360; k++) {
        p.update(1 / 30, k / 30);
        const d = mara.position.distanceTo(jon.position);
        minD = Math.min(minD, d);
        maxD = Math.max(maxD, d);
      }
      const travelled = mara.position.distanceTo(start);
      const apple = (p.stage.userData.props || []).find((x) => x.userData.propName === 'apple');
      let inHand = false;
      apple?.traverseAncestors?.((a) => { if (a === mara) inHand = true; });
      const scale = apple ? apple.getWorldScale(new window.playhouse.THREE.Vector3()).y : 0;
      return {
        d0: +d0.toFixed(2),
        minD: +minD.toFixed(2),
        maxD: +maxD.toFixed(2),
        travelled: +travelled.toFixed(2),
        pathLeft: mover.path.length,
        appleHeld: apple?.userData.heldBy === mara,
        inHand,
        worldScale: +scale.toFixed(2),
      };
    });
    check('orbit walks a real arc (travels, radius bounded)',
      walk.travelled > 0.8 && walk.minD > 0.55 && walk.maxD < 3.2, JSON.stringify(walk));
    check('hold parents the apple to MARA\'s hand at world scale ~1',
      walk.appleHeld && walk.inHand && walk.worldScale > 0.8 && walk.worldScale < 1.25,
      JSON.stringify(walk));

    const insert = await ev(page, () => {
      const p = window.playhouse.production;
      const shot = p.plan.shots.find((s) => s.insert);
      p.seek(shot.start + 0.1);
      for (let k = 0; k < 6; k++) p.update(1 / 60, k / 60);
      const apple = (p.stage.userData.props || []).find((x) => x.userData.propName === 'apple');
      const world = apple.getWorldPosition(new window.playhouse.THREE.Vector3());
      const cam = window.playhouse.engine.camera;
      const dist = cam.position.distanceTo(world);
      // Is the apple roughly centre-frame?
      const ndc = world.clone().project(cam);
      return {
        slate: p.slate,
        dist: +dist.toFixed(2),
        ndc: { x: +ndc.x.toFixed(2), y: +ndc.y.toFixed(2) },
        stillHeld: !!apple.userData.heldBy,
      };
    });
    check('insert shot frames the apple up close',
      /INSERT/.test(insert.slate) && insert.dist < 1.4
        && Math.abs(insert.ndc.x) < 0.45 && Math.abs(insert.ndc.y) < 0.45,
      JSON.stringify(insert));
    check('apple is not riding a hand at the insert', insert.stillHeld === false,
      JSON.stringify(insert));

    const reset = await ev(page, () => {
      const p = window.playhouse.production;
      // Cross back before the hold beat: the apple must be back at its home.
      p.seek(0.1);
      p.update(1 / 60, 0);
      const apple = (p.stage.userData.props || []).find((x) => x.userData.propName === 'apple');
      return { held: !!apple.userData.heldBy, parentIsStage: apple.parent === p.stage };
    });
    check('seeking back re-homes the prop', reset.held === false && reset.parentIsStage === true,
      JSON.stringify(reset));
  } catch (e) { check('C staging wiring', false, e.message); }

  await page.close();
} catch (e) {
  failed++;
  console.error(`  FAIL  harness aborted — ${e.message}`);
} finally {
  await browser.close();
}

const IGNORABLE = /WebGL.*deprecated|SwiftShader|Automatic fallback|GroupMarkerNotSet|Slow network/i;
const real = [...new Set(pageErrors)].filter((e) => !IGNORABLE.test(e));
if (real.length) {
  failed += real.length;
  console.error(`\n  ${real.length} page error(s):`);
  real.forEach((e) => console.error(`   ${e.slice(0, 300)}`));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
