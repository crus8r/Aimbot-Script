/**
 * The seam between the JS authoring side and the Python rendering side.
 *
 * A scene file is authored as an ES module because that is what makes helpers
 * like `scatter()` possible — a director should write "thirteen trees in a
 * ring", not thirteen literal positions. But Blender cannot import an .mjs, and
 * duplicating `normaliseScene` in Python would guarantee the two halves drift
 * apart the first time a default changes.
 *
 * So there is exactly one normaliser, it lives in src/scenefile.js, and this
 * script is how its output reaches Python: import, validate, normalise, write.
 * Everything downstream of here reads plain JSON with every default already
 * filled in and every shot start already computed.
 *
 * Usage:
 *   node tools/scene-to-json.mjs <scene.mjs> [out.json]
 *   node tools/scene-to-json.mjs scenes/forest-stop.mjs -      # stdout
 *
 * Exit status is 1 on a validation failure, so a build step can chain on it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2).filter((a) => a !== '--');
if (!args.length || args[0] === '-h' || args[0] === '--help') {
  console.error('usage: node tools/scene-to-json.mjs <scene.mjs> [out.json|-]');
  process.exit(args.length ? 0 : 2);
}

const sceneArg = args[0];
const scenePath = path.resolve(root, sceneArg);
if (!fs.existsSync(scenePath)) {
  console.error(`scene file not found: ${scenePath}`);
  process.exit(2);
}

const name = path.basename(scenePath, path.extname(scenePath));
// Default beside the frames it will produce, so a scene and its render live
// together and `--shot` re-renders land in the obvious place.
const outArg = args[1] ?? path.join('build', `${name}.json`);
const toStdout = outArg === '-';
const outPath = toStdout ? null : path.resolve(root, outArg);

const { normaliseScene, validateScene, serialiseScene, describeScene } =
  await import(pathToFileURL(path.join(root, 'src/scenefile.js')).href);

const mod = await import(pathToFileURL(scenePath).href);
const scene = mod.default ?? mod.scene;
if (!scene) {
  console.error(`${sceneArg} has no default export`);
  process.exit(2);
}

const check = validateScene(scene);
for (const w of check.warnings) console.error(`  warning: ${w}`);
if (!check.ok) {
  console.error(`  ${sceneArg} is invalid:\n   ${check.errors.join('\n   ')}`);
  process.exit(1);
}

const norm = normaliseScene(scene);
// Record where this came from. When a render looks wrong the first question is
// always "which scene file made it", and a JSON blob on disk cannot answer that
// unless it says so itself.
norm.source = path.relative(root, scenePath);
norm.generatedBy = 'tools/scene-to-json.mjs';

const json = serialiseScene(norm);

/** Show a path relative to the project when it is inside it, absolute when not. */
const show = (p) => {
  const rel = path.relative(root, p);
  return rel.startsWith('..') ? p : rel;
};

if (toStdout) {
  process.stdout.write(`${json}\n`);
} else {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${json}\n`);
  const d = describeScene(scene);
  console.log(
    `  ${d.title} -> ${show(outPath)}\n` +
    `  ${d.shots} shots, ${d.duration}s, ${d.props} props ` +
    `(${d.propKinds.join('/')}), cast ${d.cast.join('/')}, ` +
    `${d.mood} over ${d.ground}`,
  );
}
