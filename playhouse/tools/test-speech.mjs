/**
 * Headless test for src/speech.js.
 *
 * Real voices do not exist under swiftshader (voicesAtBoot: 0, confirmed), so
 * a deterministic fake window.speechSynthesis is installed via addInitScript
 * BEFORE boot. The SpeechDirector is driven directly through a bundled global
 * (window.__sd) — nothing is wired into the app, matching the pre-integration
 * state of main.js.
 *
 * Asserts: voice-list race resolution, deterministic + distinct assignment
 * (stable across reloads), gesture gating, lyric/suppressed/disabled gating,
 * one speak per beat even for multi-piece beats, slot overrun -> bounded
 * `holding` stall, boundary-driven and synthetic mouth envelopes, watchdog
 * recovery when onend never fires, and empty-voice-list survival.
 */

import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distFile = path.join(root, 'dist/playhouse.html');
if (!fs.existsSync(distFile)) {
  console.error('dist/playhouse.html missing — run: node tools/build.mjs');
  process.exit(1);
}
const fileUrl = `file://${distFile}`;

// Bundle speech.js (no imports, so this is trivial) as an IIFE global the
// init script can construct a director from before the app boots.
const speechBundle = (await esbuild.build({
  entryPoints: [path.join(root, 'src/speech.js')],
  bundle: true,
  format: 'iife',
  globalName: 'PlayhouseSpeech',
  write: false,
  logLevel: 'silent',
})).outputFiles[0].text;

// ---------------------------------------------------------------------------
// Fake speechSynthesis — runs in the page at document start
// ---------------------------------------------------------------------------

function installFakeSynth(cfg) {
  const log = { speaks: [], cancels: 0, boundaries: 0, starts: 0 };
  window.__tts = log;

  const allVoices = [
    { name: 'Aria', lang: 'en-US', localService: true, voiceURI: 'fake:aria', default: true },
    { name: 'Brook', lang: 'en-GB', localService: true, voiceURI: 'fake:brook', default: false },
    { name: 'Cedar', lang: 'en-AU', localService: true, voiceURI: 'fake:cedar', default: false },
    { name: 'Dove', lang: 'en-US', localService: false, voiceURI: 'fake:dove', default: false },
    { name: 'Ember', lang: 'de-DE', localService: true, voiceURI: 'fake:ember', default: false },
    { name: 'Flint', lang: 'en-US', localService: true, voiceURI: 'fake:flint', default: false },
  ];
  let listed = [];
  const listeners = new Map();
  const live = [];

  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => listed.slice(),
    addEventListener(type, fn, opts) {
      const arr = listeners.get(type) || [];
      arr.push({ fn, once: !!(opts && opts.once) });
      listeners.set(type, arr);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((l) => l.fn !== fn));
    },
    dispatch(type) {
      for (const l of (listeners.get(type) || []).slice()) {
        if (l.once) synth.removeEventListener(type, l.fn);
        try { l.fn({ type }); } catch { /* listener error is the module's bug */ }
      }
      if (typeof synth['on' + type] === 'function') {
        try { synth['on' + type]({ type }); } catch { /* ditto */ }
      }
    },
    speak(u) {
      log.speaks.push({
        text: u.text,
        voiceURI: u.voice ? u.voice.voiceURI : null,
        pitch: u.pitch,
        rate: u.rate,
        volume: u.volume,
      });
      const entry = { u, timers: [], cancelled: false };
      live.push(entry);
      synth.speaking = true;
      const msPerChar = cfg.msPerChar || 25;
      const dur = Math.max(120, (u.text.length * msPerChar) / (u.rate || 1));
      entry.timers.push(setTimeout(() => {
        if (entry.cancelled) return;
        log.starts++;
        if (u.onstart) u.onstart({});
      }, 15));
      if (!cfg.noBoundaries) {
        const re = /\S+/g;
        const words = [];
        let m;
        while ((m = re.exec(u.text))) words.push({ i: m.index, w: m[0] });
        words.forEach((w, k) => {
          const at = 25 + (dur - 50) * (k / Math.max(1, words.length));
          entry.timers.push(setTimeout(() => {
            if (entry.cancelled) return;
            log.boundaries++;
            if (u.onboundary) {
              u.onboundary({ name: 'word', charIndex: w.i, charLength: w.w.length, elapsedTime: at / 1000 });
            }
          }, at));
        });
      }
      if (!cfg.suppressEnd) {
        entry.timers.push(setTimeout(() => {
          if (entry.cancelled) return;
          synth.speaking = false;
          if (u.onend) u.onend({});
        }, dur));
      }
    },
    cancel() {
      log.cancels++;
      for (const e of live) { e.cancelled = true; e.timers.forEach(clearTimeout); }
      live.length = 0;
      synth.speaking = false;
      // Deliberately does NOT fire onend — models iOS's worst case, which the
      // module must survive on its own.
    },
    pause() { synth.paused = true; },
    resume() { synth.paused = false; },
  };

  // Plain assignment silently fails: window.speechSynthesis is a readonly
  // accessor on the Window interface. defineProperty shadows it reliably.
  Object.defineProperty(window, 'speechSynthesis', { value: synth, writable: true, configurable: true });
  const FakeUtterance = function SpeechSynthesisUtterance(text) {
    this.text = text == null ? '' : String(text);
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.lang = '';
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onboundary = null;
  };
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, writable: true, configurable: true });

  if (!cfg.emptyVoices) {
    // Empty on first call, then populated + voiceschanged — the confirmed
    // Chrome quirk the module's resolveVoices race exists for.
    setTimeout(() => {
      listed = allVoices;
      synth.dispatch('voiceschanged');
    }, cfg.voicesDelay || 250);
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** page.evaluate with an outer timeout so a hung page can never hang the run. */
function ev(page, fn, arg, ms = 40000) {
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`evaluate timed out after ${ms}ms`)), ms)),
  ]);
}

const pageErrors = [];
async function newTestPage(browser, cfg) {
  const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(`UNCAUGHT: ${e.message}`));
  await page.addInitScript(installFakeSynth, cfg);
  await page.addInitScript({
    content: `${speechBundle}\nwindow.__sd = PlayhouseSpeech.createSpeechDirector();`,
  });
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('boot')?.classList.contains('gone'),
    { timeout: 40000 },
  );
  // Software rendering starves timers; make the frame nearly free (the rAF
  // loop cannot be stopped) so the fake's scheduled onstart/onboundary/onend
  // events — and the test's own sleeps — land close to on time. The HTML
  // controls are laid out independently of the canvas, so clicks still work.
  try {
    await ev(page, () => {
      const e = window.playhouse.engine;
      e.postEnabled = false;
      e.renderer.setPixelRatio(1);
      e.setSize(64, 48);
    }, null, 10000);
  } catch { /* purely an optimisation */ }
  return page;
}

const planSnapshot = async (page) => ev(page, async () => {
  const p = window.playhouse.production;
  const sd = window.__sd;
  await sd.assignVoices(p.script.characters, p.specs);
  const out = {};
  for (const c of p.script.characters) {
    const e = sd.planFor(c.name);
    out[c.name] = e ? { uri: e.voiceURI, pitch: +e.pitch.toFixed(4), rate: e.rate } : null;
  }
  return out;
});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});

try {
  // =========================================================================
  // Page A — normal fake voices (arriving late, with boundaries and ends)
  // =========================================================================
  console.log('\nScenario A: voices arrive 250ms after boot');
  const page = await newTestPage(browser, { voicesDelay: 250, msPerChar: 25 });

  // --- A1: the voiceschanged/poll race resolves for a director constructed
  // at document start, before any voice existed.
  try {
    const r = await ev(page, async () => {
      const sd = window.__sd;
      await sd.resolveVoices();
      return { supported: sd.supported, ready: sd.ready, uiVoices: sd.voices.length };
    });
    check('director constructed pre-voices becomes ready', r.supported && r.ready);
    check('voices getter exposes the full list for the UI', r.uiVoices === 6, `got ${r.uiVoices}`);
  } catch (e) { check('A1 voice race', false, e.message); }

  // --- A2: deterministic, distinct, language-filtered assignment.
  let plan1 = null;
  try {
    plan1 = await planSnapshot(page);
    const en = ['fake:aria', 'fake:brook', 'fake:cedar', 'fake:flint', 'fake:dove'];
    check('MIREN and CORVAL get different voices',
      plan1.MIREN && plan1.CORVAL && plan1.MIREN.uri !== plan1.CORVAL.uri,
      JSON.stringify(plan1));
    check('assignment stays in the en pool (never de-DE)',
      en.includes(plan1.MIREN?.uri) && en.includes(plan1.CORVAL?.uri), JSON.stringify(plan1));
    check('pitches deterministic and clamped',
      [plan1.MIREN, plan1.CORVAL].every((e) => e && e.pitch >= 0.6 && e.pitch <= 1.5));
  } catch (e) { check('A2 assignment', false, e.message); }

  // --- A3: same assignment across a full reload (fresh director + fresh fake).
  try {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => document.getElementById('boot')?.classList.contains('gone'),
      { timeout: 40000 },
    );
    const plan2 = await planSnapshot(page);
    check('assignment identical across reloads',
      JSON.stringify(plan1) === JSON.stringify(plan2),
      `${JSON.stringify(plan1)} vs ${JSON.stringify(plan2)}`);
  } catch (e) { check('A3 determinism across reloads', false, e.message); }

  // --- A4: gesture gating. Nothing speaks before unlock(); a real trusted
  // click that calls unlock() (the integrator's one line) arms it.
  try {
    const g1 = await ev(page, async () => {
      const sd = window.__sd;
      const p = window.playhouse.production;
      const beat = p.script.scenes[0].beats.find((b) => b.type === 'dialogue');
      const before = window.__tts.speaks.length;
      const r = await sd.speakBeat(beat, p.specs.get(beat.character), { slotSeconds: 3 });
      // Simulate the integrator: unlock as the FIRST act of the play gesture.
      document.getElementById('btnPlay').addEventListener('click', () => sd.unlock(), { once: true });
      return { r, spoke: window.__tts.speaks.length - before, unlocked: sd.unlocked };
    });
    check('no speak before a gesture', g1.r === false && g1.spoke === 0 && !g1.unlocked);

    await page.click('#btnPlay'); // trusted gesture
    const g2 = await ev(page, async () => {
      const sd = window.__sd;
      const p = window.playhouse.production;
      const log = window.__tts;
      const primers = log.speaks.filter((s) => s.volume === 0).length;
      const beat = p.script.scenes[0].beats.find((b) => b.type === 'dialogue');
      const before = log.speaks.filter((s) => s.volume > 0).length;
      const done = await Promise.race([
        sd.speakBeat(beat, p.specs.get(beat.character), { slotSeconds: 3.5 }),
        new Promise((res) => setTimeout(() => res('hung'), 10000)),
      ]);
      const spoke = log.speaks.filter((s) => s.volume > 0).length - before;
      return { unlocked: sd.unlocked, primers, spoke, done };
    });
    check('gesture arms the engine (silent primer sent)', g2.unlocked && g2.primers >= 1);
    check('exactly one audible speak per speakBeat, promise resolves true on end',
      g2.spoke === 1 && g2.done === true, JSON.stringify(g2));
  } catch (e) { check('A4 gesture gating', false, e.message); }

  // --- A5: lyric / suppressed / disabled gating.
  try {
    const l = await ev(page, async () => {
      const sd = window.__sd;
      const p = window.playhouse.production;
      const log = window.__tts;
      let lyric = null;
      for (const s of p.script.scenes) for (const b of s.beats) if (!lyric && b.type === 'lyric') lyric = b;
      const spec = p.specs.get(lyric.character);
      const n0 = log.speaks.length;
      const rDefault = await sd.speakBeat(lyric, spec, { slotSeconds: 2 });
      const defaultSpoke = log.speaks.length - n0;
      const pending = sd.speakBeat(lyric, spec, { slotSeconds: 2, singLyrics: true });
      const singSpoke = log.speaks.length - n0 - defaultSpoke;
      sd.cancel();
      const rSing = await Promise.race([pending, new Promise((res) => setTimeout(() => res('hung'), 5000))]);
      sd.suppressed = true;
      const n1 = log.speaks.length;
      const rSup = await sd.speakBeat(lyric, spec, { slotSeconds: 2, singLyrics: true });
      const supSpoke = log.speaks.length - n1;
      sd.suppressed = false;
      sd.enabled = false;
      const rDis = await sd.speakBeat(lyric, spec, { slotSeconds: 2, singLyrics: true });
      sd.enabled = true;
      return { rDefault, defaultSpoke, singSpoke, rSing, rSup, supSpoke, rDis };
    });
    check('lyric beats silent by default', l.rDefault === false && l.defaultSpoke === 0);
    check('opts.singLyrics speaks the lyric; cancel resolves the promise false',
      l.singSpoke === 1 && l.rSing === false, JSON.stringify(l));
    check('silent while a recording is master (suppressed)', l.rSup === false && l.supSpoke === 0);
    check('silent while disabled', l.rDis === false);
  } catch (e) { check('A5 gating', false, e.message); }

  // --- A6: one speak per BEAT even when the director splits it into pieces.
  try {
    const b = await ev(page, async () => {
      const p = window.playhouse.production;
      const sd = window.__sd;
      const log = window.__tts;
      const long = ('the lamp answers slowly and the whole house listens while ').repeat(4) + 'it burns';
      window.playhouse.stageScript(
        'Title: Speak Once\n\nINT. TEST ROOM - NIGHT\n\n'
        + `MIREN\n${long}\n\n`
        + 'CORVAL\nShort reply here tonight.\n\n'
        + 'MIREN\n(singing)\n~ A lyric line that stays silent by default\n\n'
        + 'CORVAL\nFinal line spoken now.\n',
      );
      await sd.assignVoices(p.script.characters, p.specs);
      p.pause();
      const longBeat = p.script.scenes[0].beats.find((x) => x.type === 'dialogue');
      const pieces = p.plan.shots.filter((s) => s.beat === longBeat).length;
      const n0 = log.speaks.length;
      const perBeat = {};
      p.onBeatChange = (beat) => {
        if (!beat) return;
        const slot = Math.max(0.8, (beat.duration || 1.5) / (p.pace ?? 1));
        const n = log.speaks.length;
        sd.speakBeat(beat, p.specs.get(beat.character), { slotSeconds: slot });
        if (log.speaks.length > n) perBeat[beat.id] = (perBeat[beat.id] || 0) + (log.speaks.length - n);
      };
      for (let t = 0; t < p.duration + 0.2; t += 0.15) p.update(0.15, t, t);
      p.onBeatChange = null;
      sd.cancel();
      const dialogueBeats = p.script.scenes[0].beats.filter((x) => x.type === 'dialogue').length;
      return { pieces, perBeat, longId: longBeat.id, total: log.speaks.length - n0, dialogueBeats };
    });
    check('long beat subdivided into multiple shots', b.pieces >= 2, `pieces=${b.pieces}`);
    check('multi-piece beat spoken exactly once', b.perBeat[b.longId] === 1, JSON.stringify(b.perBeat));
    check('every dialogue beat once, lyric skipped',
      b.total === b.dialogueBeats && Object.values(b.perBeat).every((n) => n === 1),
      JSON.stringify(b));
  } catch (e) { check('A6 once per beat', false, e.message); }

  // --- A7: overrun -> bounded `holding` stall; boundary-driven envelope moves.
  try {
    // A6 just staged a new scene; let swiftshader finish compiling its shaders
    // so multi-second frames don't distort the wall clock mid-test. Best-effort:
    // shader compiles can block the page's main thread past any rAF/timer, so
    // a settle timeout must not fail A7 outright — it only risks slower frames.
    try {
      await ev(page, () => new Promise((res) => {
        let last = performance.now();
        let calm = 0;
        const t0 = last;
        const tick = () => {
          const now = performance.now();
          calm = now - last < 150 ? calm + 1 : 0;
          last = now;
          if (calm >= 3 || now - t0 > 10000) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), null, 40000);
    } catch { /* settle is an optimisation, never a verdict */ }
    const s = await ev(page, async () => {
      const sd = window.__sd;
      const p = window.playhouse.production;
      const log = window.__tts;
      const beat = {
        id: 'stall', type: 'dialogue', character: 'MIREN',
        text: ('hold '.repeat(120)).trim(), emotion: 'neutral', intensity: 0.5, duration: 10,
      };
      const wall0 = performance.now();
      const done = sd.speakBeat(beat, p.specs.get('MIREN'), { slotSeconds: 1.0 });
      const cancels0 = log.cancels;
      // Short sleeps, larger dt: under software rendering wall time runs a few
      // times faster than this loop, and the module's wall-clock backstop
      // (slot*2.5 + 4 seconds) must not fire before virtual hold expiry.
      let vt = 0;
      let holdStart = null;
      let releaseAt = null;
      let maxLevel = 0;
      for (let i = 0; i < 45 && releaseAt === null; i++) {
        await new Promise((r) => setTimeout(r, 40));
        sd.update(0.15);
        vt += 0.15;
        maxLevel = Math.max(maxLevel, sd.level());
        if (sd.holding && holdStart === null) holdStart = vt;
        if (holdStart !== null && !sd.holding) releaseAt = vt;
      }
      const engineSpeaking = window.speechSynthesis.speaking;
      const cancelsDelta = log.cancels - cancels0;
      const sdSpeaking = sd.speaking;
      const wallMs = Math.round(performance.now() - wall0);
      sd.cancel();
      const doneVal = await Promise.race([done, new Promise((r) => setTimeout(() => r('hung'), 5000))]);
      return {
        holdStart, releaseAt, maxLevel: +maxLevel.toFixed(3),
        engineSpeaking, cancelsDelta, sdSpeaking, wallMs, doneVal,
      };
    }, null, 40000);
    check('holding begins when the slot expires',
      s.holdStart !== null && s.holdStart > 0.9 && s.holdStart < 1.5, JSON.stringify(s));
    check('holding releases within the hold budget (0.6s + slack)',
      s.releaseAt !== null && s.releaseAt - s.holdStart <= 0.9, JSON.stringify(s));
    // The module must never cut the engine off at slot/hold expiry — the line
    // plays on (only cancel/watchdog may stop it, and neither fired here).
    check('utterance keeps speaking past the hold (plan stays authoritative)',
      s.engineSpeaking === true && s.cancelsDelta === 0, JSON.stringify(s));
    check('boundary events drove the mouth envelope', s.maxLevel > 0.1, `max=${s.maxLevel}`);
    check('cancel resolves the promise (false)', s.doneVal === false);
  } catch (e) { check('A7 stall', false, e.message); }

  // --- A8: per-character voice overrides.
  try {
    const o = await ev(page, () => {
      const sd = window.__sd;
      const before = sd.voiceFor('MIREN')?.voiceURI;
      sd.setVoiceOverride('MIREN', 'fake:ember'); // any voice, even out-of-pool
      const over = sd.planFor('MIREN')?.voiceURI;
      sd.setVoiceOverride('MIREN', null);
      const back = sd.voiceFor('MIREN')?.voiceURI;
      return { before, over, back };
    });
    check('setVoiceOverride pins any listed voice', o.over === 'fake:ember', JSON.stringify(o));
    check('clearing the override restores the hashed pick', o.back === o.before, JSON.stringify(o));
  } catch (e) { check('A8 overrides', false, e.message); }

  await page.close();

  // =========================================================================
  // Page B — onend never fires, no boundary events (worst-case iOS)
  // =========================================================================
  console.log('\nScenario B: onend suppressed, no boundaries — watchdog + synthetic mouth');
  const pageB = await newTestPage(browser, { suppressEnd: true, noBoundaries: true, voicesDelay: 50 });
  try {
    const w = await ev(pageB, async () => {
      const sd = window.__sd;
      const p = window.playhouse.production;
      const log = window.__tts;
      await sd.assignVoices(p.script.characters, p.specs);
      sd.unlock();
      const beat = p.script.scenes[0].beats.find((x) => x.type === 'dialogue');
      let resolved = 'pending';
      const startsBefore = log.starts;
      const done = sd.speakBeat(beat, p.specs.get(beat.character), { slotSeconds: 1 });
      done.then((v) => { resolved = v; });
      // Wait until the fake's onstart actually lands (timers lag under
      // software rendering) so the synthetic-envelope path can arm.
      for (let i = 0; i < 40 && log.starts === startsBefore; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      let maxLevel = 0;
      let steps = 0;
      // Watchdog budget: 1 * 2.5 + 3 = 5.5s, stepped virtually.
      for (let i = 0; i < 70 && sd.speaking; i++) { sd.update(0.1); steps++; maxLevel = Math.max(maxLevel, sd.level()); }
      await Promise.resolve(); // flush the promise callback
      const n0 = log.speaks.length;
      sd.speakBeat(beat, p.specs.get(beat.character), { slotSeconds: 1 }); // recovery
      const recovered = log.speaks.length === n0 + 1;
      sd.cancel();
      return { resolved, speaking: sd.speaking, holding: sd.holding, steps, maxLevel: +maxLevel.toFixed(3), recovered };
    });
    check('watchdog reaps a stuck utterance (no deadlock)',
      w.speaking === false && w.resolved === false && w.steps <= 60, JSON.stringify(w));
    check('holding cleared after the watchdog', w.holding === false);
    check('synthetic envelope ran with zero boundary events', w.maxLevel > 0.05, `max=${w.maxLevel}`);
    check('speech recovers after the watchdog (next line speaks)', w.recovered === true);
  } catch (e) { check('B watchdog', false, e.message); }
  await pageB.close();

  // =========================================================================
  // Page C — getVoices() returns [] forever (some Android WebViews)
  // =========================================================================
  console.log('\nScenario C: empty voice list forever');
  const pageC = await newTestPage(browser, { emptyVoices: true, msPerChar: 10 });
  try {
    const c = await ev(pageC, async () => {
      const sd = window.__sd;
      const p = window.playhouse.production;
      const log = window.__tts;
      await sd.assignVoices(p.script.characters, p.specs); // settles via the 2.5s timeout
      sd.unlock();
      const beat = p.script.scenes[0].beats.find((x) => x.type === 'dialogue');
      const done = await Promise.race([
        sd.speakBeat(beat, p.specs.get(beat.character), { slotSeconds: 3.5 }),
        new Promise((res) => setTimeout(() => res('hung'), 10000)),
      ]);
      const audible = log.speaks.filter((s) => s.volume > 0);
      return {
        ready: sd.ready,
        uiVoices: sd.voices.length,
        voiceMiren: sd.voiceFor('MIREN'),
        pitchMiren: sd.planFor('MIREN')?.pitch,
        pitchCorval: sd.planFor('CORVAL')?.pitch,
        done,
        spoke: audible.length,
        uri: audible[0] ? audible[0].voiceURI : 'none',
        playing: p.playing,
      };
    }, null, 25000);
    check('resolves ready with zero voices', c.ready === true && c.uiVoices === 0);
    check('app still boots and plays', c.playing === true);
    check('speaks with the system default voice (voice null)',
      c.done === true && c.spoke === 1 && c.uri === null, JSON.stringify(c));
    check('characters differentiated by pitch alone',
      typeof c.pitchMiren === 'number' && c.pitchMiren !== c.pitchCorval,
      `${c.pitchMiren} vs ${c.pitchCorval}`);
  } catch (e) { check('C empty voices', false, e.message); }
  await pageC.close();
} finally {
  await browser.close();
}

const ignorable = /WebGL.*deprecated|Automatic fallback|SwiftShader|GroupMarkerNotSet|Slow network/i;
const real = pageErrors.filter((e) => !ignorable.test(e));
if (real.length) {
  failures += real.length;
  console.error(`\n  ✗ ${real.length} page error(s):`);
  [...new Set(real)].forEach((e) => console.error(`   ${e.slice(0, 400)}`));
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nAll speech tests passed\n');
process.exit(failures ? 1 : 0);
