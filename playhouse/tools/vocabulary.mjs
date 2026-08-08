#!/usr/bin/env node
/**
 * Generate src/vocabulary.js — the names the two renderers actually implement.
 *
 *   node tools/vocabulary.mjs          write src/vocabulary.js and report
 *   node tools/vocabulary.mjs --check  fail if the committed file is stale
 *
 * The scene file is validated against a vocabulary, and a vocabulary written
 * by hand goes stale the first time somebody adds an asset. Every name here is
 * therefore read out of the renderer that implements it, so the only way to
 * teach the validator a new prop is to write the prop.
 *
 * The parsing is regex-and-brace-matching over the source text, which deserves
 * a defence. The Blender half is Python, and this is a Node script that has to
 * run on a machine with no Blender and no Python on it — importing ph_assets
 * would mean shelling out to an interpreter that need not exist, and importing
 * it *into Blender* would mean a headless bpy launch to read eight names. The
 * browser half could be imported for real, but props.js pulls in three.js and
 * builds WebGL materials at module scope; reading it as text costs nothing and
 * keeps both halves symmetrical.
 *
 * What a text scan buys in portability it can lose in silence: a regex that
 * quietly matches nothing produces an empty vocabulary and a validator that
 * accepts everything. So every extraction is anchored, every block header must
 * be found or the run dies, and the counts are floor-checked below.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------------------------------------------------------------------------
// A very small source scanner
// ---------------------------------------------------------------------------

// Enough of each language to find the parts that are not code. A JS regex
// literal is the known gap — none of the four blocks read here contains one,
// and a stray brace inside one would fail the identifier and duplicate checks
// below rather than pass quietly.
const LANGS = {
  js: { line: '//', block: ['/*', '*/'], quotes: ['"', "'", '`'], triple: false },
  py: { line: '#', block: null, quotes: ['"', "'"], triple: true },
};

/**
 * If `i` starts a comment or a string literal, describe it; otherwise null.
 *
 * Everything else in this file is brace counting, and brace counting is only
 * honest if it can tell a `{` in the code from a `{` in a docstring.
 */
function inertAt(src, i, L) {
  if (L.block && src.startsWith(L.block[0], i)) {
    const end = src.indexOf(L.block[1], i + L.block[0].length);
    return { end: end < 0 ? src.length : end + L.block[1].length, text: null };
  }
  if (src.startsWith(L.line, i)) {
    const nl = src.indexOf('\n', i);
    return { end: nl < 0 ? src.length : nl, text: null };
  }
  const q = L.quotes.find((c) => src[i] === c);
  if (!q) return null;
  const close = L.triple && src.startsWith(q.repeat(3), i) ? q.repeat(3) : q;
  let j = i + close.length;
  for (; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src.startsWith(close, j)) break;
  }
  return { end: Math.min(src.length, j + close.length), text: src.slice(i + close.length, j) };
}

/** Replace comments and string bodies with spaces, keeping every offset. */
function blank(src, lang) {
  const L = LANGS[lang];
  const out = src.split('');
  for (let i = 0; i < src.length; i++) {
    const inert = inertAt(src, i, L);
    if (!inert) continue;
    for (let k = i; k < inert.end; k++) if (out[k] !== '\n') out[k] = ' ';
    i = inert.end - 1;
  }
  return out.join('');
}

/**
 * Split the object/dict literal opening at `open` into its top-level entries.
 *
 * Returns `[{ key, value }]` with `value` as raw source text, so a caller can
 * pick a nested field out of it without this needing to understand JS or
 * Python values. Bare keys (`drone:`) and quoted ones (`'idle':`) both work,
 * which is what lets one scanner read the browser registry and the Blender
 * pose table.
 */
function entries(src, open, lang) {
  const L = LANGS[lang];
  const out = [];
  let depth = 0;
  let quotedKey = null;   // a string literal seen at top level, awaiting its ':'
  let ident = '';
  let key = null;
  let valueStart = -1;

  const flush = (end) => {
    if (key !== null && valueStart >= 0) out.push({ key, value: src.slice(valueStart, end).trim() });
    key = null; valueStart = -1; quotedKey = null; ident = '';
  };

  for (let i = open; i < src.length; i++) {
    const inert = inertAt(src, i, L);
    if (inert) {
      if (inert.text !== null && depth === 1) quotedKey = inert.text;
      ident = '';
      i = inert.end - 1;
      continue;
    }
    const c = src[i];
    // One counter for all three bracket kinds: an array or a call in a value
    // must not let its commas split the entry it belongs to.
    if (c === '{' || c === '[' || c === '(') { depth++; ident = ''; continue; }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      ident = '';
      if (depth === 0) { flush(i); return out; }
      continue;
    }
    if (depth !== 1) continue;
    if (/[A-Za-z0-9_$]/.test(c)) { ident += c; continue; }
    if (c === ':') {
      const name = quotedKey ?? (ident || null);
      if (name !== null) { key = name; valueStart = i + 1; }
      quotedKey = null; ident = '';
      continue;
    }
    if (c === ',') { flush(i); continue; }
    ident = '';
  }
  throw new Error('unterminated literal — the source is not what this generator expects');
}

/** Find an anchored block header and hand its entries back, or die saying so. */
function blockEntries(rel, headerRe, lang) {
  const src = read(rel);
  const m = headerRe.exec(src);
  if (!m) throw new Error(`${rel}: no match for ${headerRe} — the declaration was renamed or moved, and this generator must be updated to follow it`);
  const open = src.indexOf('{', m.index);
  if (open < 0) throw new Error(`${rel}: ${headerRe} matched but no '{' follows it`);
  return entries(src, open, lang);
}

/**
 * Parse a JS/Python literal simple enough to be JSON once requoted.
 *
 * Null on anything richer, which is not a swallowed failure: the only callers
 * feed it registry fields whose shape the checks below assert, so a value this
 * cannot read is reported there as the field it belongs to, with its text.
 */
function literal(text) {
  try {
    return JSON.parse(text.replace(/'/g, '"').replace(/,\s*([\]}])/g, '$1'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The two renderers
// ---------------------------------------------------------------------------

/**
 * Blender prop types: every `make_*` in ph_assets that is not scaffolding.
 *
 * build_prop resolves a scene-file type by `getattr(ph_assets, f"make_{kind}")`
 * with no allowlist, so the module's own function list *is* the prop list —
 * and the exclusion follows from the same fact rather than from a table of
 * names here. A builder render_scene calls by name (make_ground for the floor,
 * make_character for the cast) is fixed scaffolding that the pipeline invokes
 * itself; a scene file naming it as a prop type would get a floor mesh, not a
 * prop. Everything else in the module is reachable only through build_prop,
 * which is the definition of a prop type. Add make_gazebo and it appears here
 * with no edit to this file; add a make_sky that render_scene calls for the
 * backdrop and it drops out for the same reason.
 *
 * The call sites are read from a comment- and docstring-blanked copy, because
 * ph_assets.make_tree is *mentioned* in build_prop's docstring as the worked
 * example, and a prose mention must not exclude a real prop.
 */
function blenderProps() {
  const assets = read('blender/ph_assets.py');
  const defined = [...blank(assets, 'py').matchAll(/^def make_([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]);
  const calledDirectly = new Set(
    [...blank(read('blender/render_scene.py'), 'py')
      .matchAll(/\bph_assets\.make_([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]),
  );
  const props = defined.filter((name) => !calledDirectly.has(name));
  return { props, defined, scaffolding: defined.filter((n) => calledDirectly.has(n)) };
}

/** Browser prop types and their metadata, from the PROPS registry. */
function browserProps() {
  const rows = blockEntries('src/props.js', /^export const PROPS = \{/m, 'js');
  const meta = {};
  for (const { key, value } of rows) {
    const open = value.indexOf('{');
    if (open !== 0) throw new Error(`src/props.js: PROPS.${key} is not an object literal`);
    // Split the entry into its own fields rather than regexing its whole text.
    // `hold` carries a nested object of its own, and a first-match regex would
    // happily read a field out of that instead.
    const fields = new Map(entries(value, open, 'js').map((f) => [f.key, f.value]));
    meta[key] = {
      size: literal(fields.get('size') ?? ''),
      category: literal(fields.get('category') ?? ''),
      tags: literal(fields.get('tags') ?? ''),
    };
  }
  return { names: rows.map((r) => r.key), meta };
}

const keysOf = (rel, headerRe, lang) => blockEntries(rel, headerRe, lang).map((r) => r.key);

/**
 * Bone-by-bone comparison of the two pose tables.
 *
 * Matching NAMES is not the same as matching poses. Both tables can list
 * `kneel` and describe different postures, and that has already happened
 * twice: `handsUp` diverged deliberately (straight arms read as a touchdown
 * signal, so Blender folds the elbows), and `kneel` diverges because the two
 * rigs have different thigh-to-shin ratios and each has to touch its own
 * floor. Neither is a bug. What would be a bug is a THIRD divergence nobody
 * meant, appearing because someone edited one table and not the other — and
 * with names-only reporting that is invisible.
 *
 * So this reports every value-level difference. The expected ones are listed
 * below and printed as expected; anything else is printed as a warning. The
 * point is not to forbid divergence but to make it a decision on the record.
 */
const EXPECTED_POSE_DIVERGENCE = {
  handsUp: 'Blender folds the elbows; straight arms read as a touchdown signal',
  kneel: 'each rig needs its own angles to put both legs on its own floor',
};

function poseDivergence() {
  const py = new Map(blockEntries('blender/ph_assets.py', /^POSES = \{/m, 'py')
    .map((r) => [r.key, r.value]));
  const js = new Map(blockEntries('src/anim.js', /^export const POSES = \{/m, 'js')
    .map((r) => [r.key, r.value]));

  // Compare as {bone: [x,y,z]} maps so formatting, ordering, trailing commas
  // and tuple-vs-array never register as a difference — only numbers do.
  //
  // Not `literal()`: that is JSON.parse underneath, and a Python euler is
  // written `(-4, 0, 6)`, which is not JSON. It returned null for every bone
  // on the Blender side, so the first version of this reported all 25 poses
  // as divergent — an alarm that fires on everything is the same as no alarm.
  const triple = (text) => {
    const nums = text.trim().replace(/^[([]|[)\]]$/g, '').split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n));
    return nums.length === 3 ? nums : null;
  };
  const bones = (text, lang) => {
    const out = new Map();
    for (const f of entries(text, text.indexOf('{'), lang)) {
      const v = triple(f.value);
      if (v) out.set(f.key.replace(/^['"]|['"]$/g, ''), v);
    }
    return out;
  };

  const differing = [];
  for (const name of py.keys()) {
    if (!js.has(name)) continue;
    const a = bones(py.get(name), 'py');
    const b = bones(js.get(name), 'js');
    const names = new Set([...a.keys(), ...b.keys()]);
    const bad = [...names].filter((bone) => {
      const x = a.get(bone);
      const y = b.get(bone);
      if (!x || !y) return true;
      return x.some((n, i) => Math.abs(n - y[i]) > 1e-9);
    });
    if (bad.length) differing.push({ name, bones: bad });
  }
  return differing;
}

const { props: BLENDER_PROPS, defined, scaffolding } = blenderProps();
const { names: BROWSER_PROPS, meta: PROP_META } = browserProps();
const BLENDER_POSES = keysOf('blender/ph_assets.py', /^POSES = \{/m, 'py');
const BROWSER_POSES = keysOf('src/anim.js', /^export const POSES = \{/m, 'js');
const ABILITIES = keysOf('src/vfx.js', /^export const ABILITY_DEFAULTS = \{/m, 'js');

// ---------------------------------------------------------------------------
// Sanity
// ---------------------------------------------------------------------------

// Floors, not exact counts: assets are being added to both renderers and a
// count baked in here would have to be edited by everyone who adds a prop,
// which is how a check gets deleted. These sit well under today's numbers and
// well over zero, so they catch the failure that actually happens — a regex
// that stops matching and silently yields nothing.
const FLOORS = {
  BLENDER_PROPS: 5, BROWSER_PROPS: 20, BLENDER_POSES: 5, BROWSER_POSES: 20, ABILITIES: 6,
};

const sets = { BLENDER_PROPS, BROWSER_PROPS, BLENDER_POSES, BROWSER_POSES, ABILITIES };
for (const [name, list] of Object.entries(sets)) {
  if (list.length < FLOORS[name]) {
    throw new Error(`${name}: found ${list.length} (${list.join(', ') || 'nothing'}), expected at least ${FLOORS[name]} — the extraction is broken, not the renderer`);
  }
  const odd = list.filter((n) => !/^[A-Za-z_]\w*$/.test(n));
  if (odd.length) throw new Error(`${name}: ${odd.join(', ')} are not identifiers — the scanner mis-read the block`);
  const dupes = list.filter((n, i) => list.indexOf(n) !== i);
  if (dupes.length) throw new Error(`${name}: ${dupes.join(', ')} appear twice — nested keys leaked into the top level`);
}

// PROP_META is the half of the vocabulary the validator reasons *with* rather
// than merely checks against, so a missing field there is a silent wrong
// answer later ("no, a wardrobe is not a held prop") instead of a crash.
for (const name of BROWSER_PROPS) {
  const m = PROP_META[name];
  if (!Array.isArray(m.size) || m.size.length !== 3 || m.size.some((v) => typeof v !== 'number')) {
    throw new Error(`PROP_META.${name}.size is ${JSON.stringify(m.size)}, expected three numbers`);
  }
  if (!m.category) throw new Error(`PROP_META.${name} has no category`);
  if (!Array.isArray(m.tags) || !m.tags.length) throw new Error(`PROP_META.${name} has no tags`);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

/** Wrap a long array literal at a readable width, indented one level. */
function wrapped(xs) {
  const lines = [];
  let line = '';
  for (const x of xs) {
    const piece = `'${x}',`;
    if (line && line.length + piece.length > 92) { lines.push(line.trimEnd()); line = ''; }
    line += `${line ? ' ' : ''}${piece}`;
  }
  if (line) lines.push(line.trimEnd());
  return lines.map((l) => `  ${l}`).join('\n');
}

const metaLines = BROWSER_PROPS.map((name) => {
  const m = PROP_META[name];
  return `  ${/^[A-Za-z_]\w*$/.test(name) ? name : `'${name}'`}: { size: [${m.size.join(', ')}], category: '${m.category}', tags: [${list(m.tags)}] },`;
}).join('\n');

const out = `/**
 * GENERATED FILE — do not edit. Run \`node tools/vocabulary.mjs\` to refresh.
 *
 * What each renderer can actually build, read out of the renderers themselves.
 * validateScene checks a scene file against this, and the LLM system prompt is
 * written from it, so neither can drift from what will really render.
 *
 * A name in BROWSER_* but not BLENDER_* previews and is missing from the film;
 * a name in BLENDER_* but not BROWSER_* renders and is missing from the
 * preview. Both are worth saying and neither is fatal.
 */

/** Scene-file prop types ph_assets can build (\`make_<type>\`). */
export const BLENDER_PROPS = [
${wrapped(BLENDER_PROPS)}
];

/** Scene-file prop types the browser PROPS registry can build. */
export const BROWSER_PROPS = [
${wrapped(BROWSER_PROPS)}
];

/** Poses ph_assets.POSES can strike. */
export const BLENDER_POSES = [
${wrapped(BLENDER_POSES)}
];

/** Poses anim.js POSES can strike. */
export const BROWSER_POSES = [
${wrapped(BROWSER_POSES)}
];

/** vfx abilities, from ABILITY_DEFAULTS. */
export const ABILITIES = [
${wrapped(ABILITIES)}
];

/**
 * Per-type facts from the browser registry: \`size\` is [w, h, d] in metres,
 * \`tags\` say what a type is for — 'held'/'handheld' means it is built to be
 * carried, 'hero' means it holds up in close-up.
 */
export const PROP_META = {
${metaLines}
};
`;

const target = path.join(root, 'src/vocabulary.js');
const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (existing !== out) {
    console.error('  src/vocabulary.js is stale — run `node tools/vocabulary.mjs`');
    process.exit(1);
  }
  console.log('  src/vocabulary.js is up to date');
} else {
  fs.writeFileSync(target, out);
  console.log(`\n  src/vocabulary.js ${existing === out ? 'unchanged' : 'written'}`);
}

const only = (a, b) => a.filter((x) => !b.includes(x));
console.log(`
  BLENDER_PROPS  ${String(BLENDER_PROPS.length).padStart(3)}   ${BLENDER_PROPS.join(' ')}
  BROWSER_PROPS  ${String(BROWSER_PROPS.length).padStart(3)}
  BLENDER_POSES  ${String(BLENDER_POSES.length).padStart(3)}
  BROWSER_POSES  ${String(BROWSER_POSES.length).padStart(3)}
  ABILITIES      ${String(ABILITIES.length).padStart(3)}   ${ABILITIES.join(' ')}

  scaffolding excluded (called by name in render_scene.py): ${scaffolding.join(', ') || 'none'} — of ${defined.length} make_* found

  browser only, missing from the film:    ${only(BROWSER_PROPS, BLENDER_PROPS).join(' ') || 'none'}
  Blender only, missing from the preview: ${only(BLENDER_PROPS, BROWSER_PROPS).join(' ') || 'none'}
  poses browser only:                     ${only(BROWSER_POSES, BLENDER_POSES).join(' ') || 'none'}
  poses Blender only:                     ${only(BLENDER_POSES, BROWSER_POSES).join(' ') || 'none'}
`);

const divergent = poseDivergence();
if (divergent.length) {
  console.log('  poses whose NUMBERS differ between the renderers:');
  for (const { name, bones } of divergent) {
    const why = EXPECTED_POSE_DIVERGENCE[name];
    console.log(`    ${why ? '·' : '!'} ${name.padEnd(10)} ${bones.join(' ')}`);
    console.log(`      ${why ? `expected: ${why}` : 'UNEXPECTED — one table was edited and the other was not'}`);
  }
  console.log('');
}
// An unexpected divergence fails --check, because it means the two renderers
// have quietly stopped agreeing about what a pose is and no test would catch
// it: both files parse, both validate, and the same scene renders two
// different performances.
const unexpected = divergent.filter((d) => !EXPECTED_POSE_DIVERGENCE[d.name]);
if (process.argv.includes('--check') && unexpected.length) {
  console.error(`  ${unexpected.length} unexpected pose divergence(s); ` +
    'reconcile the tables, or record the reason in EXPECTED_POSE_DIVERGENCE.');
  process.exitCode = 1;
}
