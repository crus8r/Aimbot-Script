/**
 * Headless test for src/score.js.
 *
 * Two halves, because there are two very different claims to check.
 *
 * CUE SELECTION runs in plain node. It is pure text in, cue name out, so it
 * needs no browser and it is the half that can be *wrong* rather than merely
 * broken — a scene scored cheerful under a gun is the failure mode that
 * matters, and it is asserted directly.
 *
 * SYNTHESIS runs in Chromium against an OfflineAudioContext, which renders
 * faster than real time and hands back the actual samples. That matters: the
 * only honest way to know a Web Audio graph makes sound is to look at the
 * sound. "It did not throw" is not evidence — a graph with a disconnected
 * node, a gain stuck at zero, or an exponential ramp to a true zero all throw
 * nothing and all render pure silence.
 *
 * What this cannot check is whether the music is any *good*. Nothing
 * automated can. It checks that it exists, that it is in range, that it stops
 * when told, and that ducking measurably reduces level.
 */

import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// 1. Cue selection
// ---------------------------------------------------------------------------

const { cueFor, cueSheet, Score } = await import(
  pathToFileURL(path.join(root, 'src/score.js')).href);

console.log('\n  cue selection');

const CASES = [
  // [text, mood, expected cue, why it is in the list]
  ['A man runs through the forest. Drones drop into the path. He stops.',
   'DUSK', 'danger', 'the scene the whole project started from'],
  ['She sprints down the corridor, leaps, crashes through the door.',
   null, 'action', 'chase language must not read as mere threat'],
  ['They laugh together on the porch and pour the lemonade.',
   'DAY', 'warm', "the user's own lemonade example"],
  ['He sits alone at the grave. Gone. He weeps.',
   null, 'grief', 'grief must beat calm despite "sits"'],
  ['The lamp glows. Stars wheel overhead, vast and impossible.',
   'DAWN', 'wonder', 'magic language'],
  ['INT. ROOM. A table. A chair.',
   null, 'neutral', 'no evidence must produce no opinion, not a guess'],
];

for (const [text, mood, expected, why] of CASES) {
  const { cue, scores } = cueFor(text, mood);
  check(`${JSON.stringify(text.slice(0, 42))}… -> ${cue}`,
        cue === expected,
        cue === expected ? `(${why})` : `expected ${expected}, scores ${JSON.stringify(scores)}`);
}

// The failure this table exists to prevent.
const armed = cueFor('The guard raises the rifle. A light glows on the barrel.', 'NIGHT');
check('one hopeful word does not disarm a threatening scene',
      armed.cue === 'danger' || armed.cue === 'tense', `got ${armed.cue}`);

// Determinism: same input, same cue, every time.
check('cue selection is deterministic',
      new Set(Array.from({ length: 20 }, () =>
        cueFor(CASES[0][0], CASES[0][1]).cue)).size === 1);

console.log('\n  cue sheet');
const scene = {
  environment: { mood: 'DUSK' },
  shots: [
    { id: 'establish', start: 0, camera: { size: 'EWS' }, caption: 'The wood, empty.' },
    { id: 'travel', start: 3, camera: { size: 'MS' }, caption: 'He runs.',
      actions: [{ do: 'move' }] },
    { id: 'blockade', start: 6, camera: { size: 'WS' }, caption: 'Drones drop into the path.' },
    { id: 'held', start: 9, camera: { size: 'CU' }, caption: 'A guard aims the rifle.' },
    { id: 'quiet', start: 12, camera: { size: 'MS' }, music: 'grief', caption: 'x' },
  ],
};
const sheet = cueSheet(scene);
check('one entry per shot', sheet.length === scene.shots.length);
check('an explicit `music` field always wins',
      sheet[4].cue === 'grief', `got ${sheet[4].cue}`);
check('threat is scored as threat',
      ['danger', 'tense', 'action'].includes(sheet[2].cue), `got ${sheet[2].cue}`);
check('a close-up scores hotter than a wide',
      sheet[3].intensity > sheet[0].intensity,
      `CU ${sheet[3].intensity.toFixed(2)} vs EWS ${sheet[0].intensity.toFixed(2)}`);
check('intensity stays in range',
      sheet.every((s) => s.intensity >= 0 && s.intensity <= 1));

// ---------------------------------------------------------------------------
// 2. Synthesis, rendered offline in a real browser
// ---------------------------------------------------------------------------

const bundle = (await esbuild.build({
  entryPoints: [path.join(root, 'src/score.js')],
  bundle: true,
  format: 'iife',
  globalName: 'PlayhouseScore',
  write: false,
  logLevel: 'silent',
})).outputFiles[0].text;

console.log('\n  synthesis');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle });

  const result = await page.evaluate(async () => {
    const { Score } = window.PlayhouseScore;

    // Render eight seconds at 24 kHz. Long enough for several bars of a slow
    // cue, short enough to render in well under a second.
    async function render(configure, seconds = 8) {
      const ctx = new OfflineAudioContext(2, 24000 * seconds, 24000);
      const score = new Score(ctx);
      score.init(ctx);
      configure(score);
      score.start();
      // OfflineAudioContext has no wall clock and never runs a setTimeout, so
      // the whole performance has to be laid down before rendering begins.
      score.pump(seconds);
      const buffer = await ctx.startRendering();
      const data = buffer.getChannelData(0);
      let peak = 0;
      let sum = 0;
      let nonZero = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
        sum += v * v;
        if (v > 1e-4) nonZero += 1;
      }
      return {
        peak,
        rms: Math.sqrt(sum / data.length),
        coverage: nonZero / data.length,
        length: data.length,
      };
    }

    // The private #schedule method is unreachable from outside the class, so
    // the offline path drives the public surface and lets `start()`'s own
    // first schedule plus a longer lookahead cover the window.
    const quiet = await render((s) => { s.setCue('calm'); s.setIntensity(0.3); });
    const loud = await render((s) => { s.setCue('action'); s.setIntensity(1.0); });
    const ducked = await render((s) => {
      s.setCue('action'); s.setIntensity(1.0); s.duck(true);
    });
    const off = await render((s) => { s.setEnabled(false); });
    return { quiet, loud, ducked, off };
  });

  const { quiet, loud, ducked, off } = result;
  check('a cue renders audible signal',
        loud.peak > 0.005, `peak ${loud.peak.toExponential(2)}`);
  check('signal is continuous, not one click',
        loud.coverage > 0.5, `${(loud.coverage * 100).toFixed(1)}% of samples`);
  check('nothing clips',
        loud.peak <= 1.0, `peak ${loud.peak.toFixed(3)}`);
  check('an intense cue is louder than a calm one',
        loud.rms > quiet.rms, `${loud.rms.toExponential(2)} vs ${quiet.rms.toExponential(2)}`);
  check('ducking measurably lowers the bus',
        ducked.rms < loud.rms * 0.85,
        `${ducked.rms.toExponential(2)} vs ${loud.rms.toExponential(2)}`);
  check('disabled renders silence',
        off.peak < 1e-3, `peak ${off.peak.toExponential(2)}`);
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(failures ? `\n  ${failures} failure(s)\n` : '\n  all green\n');
process.exit(failures ? 1 : 0);
