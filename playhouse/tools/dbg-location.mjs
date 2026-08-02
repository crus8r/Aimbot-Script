/**
 * Location-matching probe.
 *
 * Stages a tiny script whose heading is deliberately mistyped ("INT. OUTSIFR BY
 * A TREE") and reports which archetype the stage builder actually chose, so the
 * matching rules can be judged against real output rather than a reading of the
 * source. Extra headings are staged alongside it as controls.
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CASES = [
  ['INT. OUTSIFR BY A TREE', 'the user\'s heading, verbatim'],
  ['EXT. OUTSIDE BY A TREE', 'same words, correct prefix + spelling'],
  ['INT. OUTSIDE BY A TREE', 'typo fixed, prefix still wrong'],
  ['EXT. THE ORCHARD - DAY', 'the archetype this script wants'],
  ['EXT. APPLE TREE - DAY', 'nature noun only'],
];

const SCRIPT = (heading) => `Title: Probe

${heading}

MARA stands under the branches.

MARA
An apple.

She walks around JON and picks up the apple.

A shot of it rolling to the ground.

JON
Mind the roots.
`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`UNCAUGHT: ${e.message}`));

await page.goto(`file://${path.join(root, 'dist/playhouse.html')}`, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('boot')?.classList.contains('gone'),
  { timeout: 90000 },
);

for (const [heading, note] of CASES) {
  const out = await page.evaluate((src) => {
    const script = window.playhouse.stageScript(src);
    window.playhouse.production.seek(0);
    window.playhouse.production.update(1 / 60, 0);
    const stage = window.playhouse.production.stage;
    const scene = script.scenes[0];
    return {
      parsed: {
        location: scene.location,
        interior: scene.interior,
        timeOfDay: scene.timeOfDay,
      },
      archKey: stage.userData.arch.key,
      exterior: !!stage.userData.arch.exterior,
      bounds: stage.userData.bounds,
      mood: stage.userData.mood.name,
      props: [...new Set(stage.userData.props.map((p) => p.userData.propName))].sort(),
      beats: scene.beats.map((b) => ({
        type: b.type,
        text: (b.text || '').slice(0, 48),
        keys: Object.keys(b).sort().join(','),
      })),
      shots: window.playhouse.production.plan.shots.map((s) => `${s.size}${s.ots ? '/OTS' : ''} ${s.subject || '-'}`),
    };
  }, SCRIPT(heading));

  console.log(`\n${heading}   (${note})`);
  console.log(`  parsed       location=${JSON.stringify(out.parsed.location)} interior=${out.parsed.interior} time=${out.parsed.timeOfDay}`);
  console.log(`  arch.key     ${out.archKey}${out.exterior ? ' (exterior)' : ' (interior)'}`);
  console.log(`  bounds       ${JSON.stringify(out.bounds)}`);
  console.log(`  mood         ${out.mood}`);
  console.log(`  props        ${out.props.join(', ')}`);
  console.log(`  beats        ${out.beats.map((b) => `${b.type}:"${b.text}"`).join(' | ')}`);
  console.log(`  beat fields  ${out.beats.find((b) => b.type === 'action')?.keys || '(none)'}`);
  console.log(`  shots        ${out.shots.join('  ')}`);
}

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}
console.log('\nok\n');
