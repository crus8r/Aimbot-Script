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
  const builders = new Map();
  const grips = [];
  const options = new Map();
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
    // `build` is usually a bare name and sometimes an arrow that fixes an
    // argument — roundTable is buildTable with `round` on — and either way the
    // function it ends at is the one whose parameters decide what is honoured.
    const build = (fields.get('build') ?? '').trim();
    const arrow = /=>\s*([A-Za-z_$][\w$]*)\s*\(/.exec(build);
    const fn = /^[A-Za-z_$][\w$]*$/.test(build) ? build : (arrow && arrow[1]);
    if (!fn) throw new Error(`src/props.js: PROPS.${key}.build is ${build || 'missing'}, which is neither a builder name nor an arrow calling one`);
    builders.set(key, fn);
    // An authored grip, not a tag: `attachToHand` falls back to a default
    // offset for everything else, which is why a type can be tagged 'held'
    // and still have no `hold` block.
    if (fields.has('hold')) grips.push(key);
    // The registry states which of the format's options each type honours, and
    // this is read rather than inferred because the honest answer is a
    // judgement — `colour` on a bookshelf means the carcass and not the books,
    // and no signature says so. It is asserted against the signature below.
    const declared = literal(fields.get('options') ?? '');
    if (!Array.isArray(declared)) throw new Error(`src/props.js: PROPS.${key} declares no options list; an entry with no answer would read as "honours nothing", which is a claim rather than a gap`);
    options.set(key, declared);
  }
  return { names: rows.map((r) => r.key), meta, builders, grips, options };
}

/**
 * The `def`/`function` spans of a source file, by name, as raw-source offsets.
 *
 * Attribution is the point: `ob['ph_grip'] = ...` means nothing until you know
 * which builder wrote it. Boundaries come from a blanked copy so a `def` quoted
 * in a docstring cannot open a phantom function, and the offsets index the raw
 * text because the things looked up inside a body — `'ph_grip'`, a colour — are
 * string literals that blanking has erased.
 */
function bodies(rel, lang) {
  const raw = read(rel);
  const heads = [...blank(raw, lang).matchAll(
    lang === 'py' ? /^def ([A-Za-z_]\w*)\s*\(/gm : /^function ([A-Za-z_$][\w$]*)\s*\(/gm,
  )];
  const out = new Map();
  heads.forEach((m, i) => {
    out.set(m[1], raw.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : raw.length));
  });
  return out;
}

/**
 * Every `make_*` parameter list in ph_assets, by type name.
 *
 * build_prop forwards a prop entry's option only when `inspect.signature` says
 * the builder declares a parameter of that name, so the signature IS the option
 * list for the film. An option no builder declares is dropped; an option this
 * builder alone declares is honoured for this type alone. Neither fact is
 * written down anywhere else.
 */
function blenderSignatures(defined) {
  const src = blank(read('blender/ph_assets.py'), 'py');
  const out = new Map();
  for (const m of src.matchAll(/^def (make_[A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/gm)) {
    out.set(m[1].slice(5), m[2].split(',').map((p) => p.split('=')[0].trim()).filter(Boolean));
  }
  // A signature broken across lines would not match `[^)]*` and would silently
  // read as a builder that takes no options at all.
  const missed = defined.filter((n) => !out.has(n));
  if (missed.length) throw new Error(`blender/ph_assets.py: could not read the parameter list of make_${missed.join(', make_')} — a multi-line signature, which this scan cannot follow`);
  return out;
}

/** The names bound by a `function f({ a, b } = {})` options pattern. */
function destructured(src, open) {
  const keys = [];
  let depth = 0;
  let piece = '';
  const flush = () => {
    const m = /^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)/.exec(piece);
    if (m) keys.push(m[1]);
    piece = '';
  };
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '[' || c === '(') { depth++; if (depth > 1) piece += c; continue; }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) { flush(); return keys; }
      piece += c;
      continue;
    }
    if (depth === 1 && c === ',') { flush(); continue; }
    piece += c;
  }
  throw new Error('unterminated destructuring pattern');
}

/**
 * The option names each browser builder can actually take, by type.
 *
 * `createProp` hands the scene file's `options` straight to `def.build(opts)`,
 * so the destructuring pattern is what the preview will really honour. The
 * registry's own `options` list is the claim; this is the check on it. A type
 * that advertises `colour` to a builder with no `colour` parameter renders the
 * default and says nothing, which is the failure this whole file exists to
 * stop.
 */
function browserSignatures(builders) {
  const blanked = blank(read('src/props.js'), 'js');
  const out = new Map();
  for (const [type, fn] of builders) {
    const m = new RegExp(`^function ${fn}\\s*\\(`, 'm').exec(blanked);
    if (!m) throw new Error(`src/props.js: PROPS.${type}.build names ${fn}, which is not a top-level function here`);
    const open = blanked.indexOf('{', m.index);
    const close = blanked.indexOf(')', m.index);
    if (open < 0 || open > close) throw new Error(`src/props.js: ${fn} takes no destructured options object; this scan cannot tell what it honours`);
    out.set(type, destructured(blanked, open));
  }
  return out;
}

/**
 * The nominal size of the three generic dressing primitives.
 *
 * `_dims(size, default)` unpacks its default as `w, h, d` — the same order and
 * the same metres a scene file writes — so the default is a declared size, not
 * a number scraped out of the middle of a mesh. Measured in Blender across 24
 * seeds, `make_slab` and `make_rod` come out at exactly these figures and
 * `make_orb` 1% under, the dents eating the difference.
 */
function blenderDimsDefaults(defBodies) {
  const out = new Map();
  for (const [name, body] of defBodies) {
    if (!name.startsWith('make_')) continue;
    const m = /_dims\(\s*size\s*,\s*\(([^)]*)\)\s*\)/.exec(body);
    if (!m) continue;
    const nums = m[1].split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
    if (nums.length !== 3) throw new Error(`blender/ph_assets.py: ${name} calls _dims with a default this scan cannot read: (${m[1]})`);
    out.set(name.slice(5), nums);
  }
  return out;
}

/**
 * Prop metadata ph_assets declares for types the browser has never heard of.
 *
 * Returns null when the table does not exist, which is a finding rather than a
 * failure and is reported as one below. Six types build only in Blender, and
 * their extents are emergent — a blob's amplitude, a canopy's scallop, a
 * seeded taper — so unlike `_dims` there is nothing in the source to read.
 * They can be had only by building the mesh and measuring it, which needs
 * Blender, which this generator deliberately does not require. So the numbers
 * are declared where the asset is, once, by whoever ran the measurement.
 */
function blenderDeclaredMeta() {
  const src = read('blender/ph_assets.py');
  const header = /^PROP_META = \{/m.exec(src);
  if (!header) return null;
  const out = {};
  for (const { key, value } of entries(src, src.indexOf('{', header.index), 'py')) {
    const fields = new Map(entries(value, value.indexOf('{'), 'py').map((f) => [f.key.replace(/^['"]|['"]$/g, ''), f.value]));
    const size = (fields.get('size') ?? '').trim().replace(/^[([]|[)\]]$/g, '')
      .split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
    out[key] = {
      size: size.length === 3 ? size : null,
      category: literal(fields.get('category') ?? ''),
      tags: literal(fields.get('tags') ?? ''),
    };
  }
  return out;
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
const {
  names: BROWSER_PROPS, meta: PROP_META, builders, grips: BROWSER_GRIPS,
  options: BROWSER_OPTIONS,
} = browserProps();
const BLENDER_POSES = keysOf('blender/ph_assets.py', /^POSES = \{/m, 'py');
const BROWSER_POSES = keysOf('src/anim.js', /^export const POSES = \{/m, 'js');
const ABILITIES = keysOf('src/vfx.js', /^export const ABILITY_DEFAULTS = \{/m, 'js');

// ---------------------------------------------------------------------------
// Grammar: what a scene file may say about each of those names
// ---------------------------------------------------------------------------

/**
 * Natural words a director might reach for, per type, from props.js.
 *
 * Exported because it is a far better repair suggestion than edit distance: a
 * model that writes "gun" has not made a typo, it has used English, and no
 * amount of Levenshtein turns "gun" into "rifle". propsMentioned reads the same
 * table to find props in prose, so the two agree by construction.
 */
const PROP_SYNONYMS = Object.fromEntries(
  blockEntries('src/props.js', /^const PROP_KEYWORDS = \{/m, 'js').map(({ key, value }) => {
    const words = literal(value);
    if (!Array.isArray(words) || !words.length) throw new Error(`src/props.js: PROP_KEYWORDS.${key} is ${value}, expected a non-empty array of words`);
    return [key, words];
  }),
);

const assetBodies = bodies('blender/ph_assets.py', 'py');
const BLENDER_SIGNATURES = blenderSignatures(defined);
const BROWSER_SIGNATURES = browserSignatures(builders);
const BLENDER_DIMS = blenderDimsDefaults(assetBodies);
const BLENDER_META = blenderDeclaredMeta();

/** Types whose Blender builder authors the point a hand should hold it by. */
const BLENDER_GRIPS = BLENDER_PROPS.filter(
  (t) => /\['ph_grip'\]\s*=/.test(assetBodies.get(`make_${t}`) ?? ''),
);

// The registry's per-type `options` is a judgement about what tinting a type
// should mean; the destructuring is what the builder will actually accept. A
// gap between them is a promise the preview cannot keep.
for (const [type, declared] of BROWSER_OPTIONS) {
  const takes = BROWSER_SIGNATURES.get(type) ?? [];
  const unhonoured = declared.filter((k) => !takes.includes(k));
  if (unhonoured.length) throw new Error(`src/props.js: PROPS.${type} offers ${unhonoured.join(', ')} but ${builders.get(type)} declares no such parameter, so the preview would drop it and render the default`);
}

/**
 * Which types honour `options.colour` and `options.size`, per renderer.
 *
 * The film answers from `inspect.signature` and the preview from its registry,
 * because those are the two things that actually decide it. Where they differ,
 * an option is honoured in one renderer and dropped in the other, and a
 * director who is not told that spends an afternoon tuning a colour half the
 * pipeline never shows them.
 */
const optionSupport = (key) => ({
  blender: BLENDER_PROPS.filter((t) => (BLENDER_SIGNATURES.get(t) ?? []).includes(key)),
  browser: BROWSER_PROPS.filter((t) => (BROWSER_OPTIONS.get(t) ?? []).includes(key)),
});

/**
 * The whole option vocabulary a scene file may use.
 *
 * Derived rather than listed: it is every non-structural parameter the Blender
 * builders declare. `seed` and `scale` are excluded because build_prop supplies
 * them itself from the prop's id and its `scale` field — a scene file naming
 * either in `options` is confusing two levels of the format, not choosing an
 * option. The Blender side is the reference here because it is the side that
 * agrees with itself: the browser builders declare thirty-odd bespoke names
 * (`wood`, `brass`, `linen`) that no scene file has ever been allowed to use.
 */
const STRUCTURAL = ['seed', 'scale'];
const OPTION_KEYS = [...new Set(
  BLENDER_PROPS.flatMap((t) => BLENDER_SIGNATURES.get(t) ?? []),
)].filter((p) => !STRUCTURAL.includes(p)).sort();

const OPTION_SUPPORT = Object.fromEntries(OPTION_KEYS.map((k) => [k, optionSupport(k)]));

/** Option names the preview offers that the format does not let anyone write. */
const BROWSER_ONLY_OPTIONS = [...new Set(
  [...BROWSER_OPTIONS.values()].flat(),
)].filter((k) => !OPTION_KEYS.includes(k)).sort();

// The two renderers' idea of how big a type is, side by side. `_dims` publishes
// the same three numbers in the same order as the registry's `size`, so for the
// three resizable primitives the comparison is direct — and a preview that
// blocks a shot against a 30 cm slab while the film builds a 50 cm one puts the
// actor's hand in the wrong place in exactly one of them.
for (const [type, dims] of BLENDER_DIMS) {
  const browser = PROP_META[type]?.size;
  if (!browser) continue;
  if (dims.some((n, i) => Math.abs(n - browser[i]) > 0.02)) {
    throw new Error(`${type}: the browser registry says ${JSON.stringify(browser)} and make_${type} defaults to ${JSON.stringify(dims)} — the same scene would block against two different objects`);
  }
}

const FILM_ONLY_TYPES = BLENDER_PROPS.filter((t) => !BROWSER_PROPS.includes(t));

/**
 * Fold ph_assets' declared metadata in beside the browser registry's.
 *
 * PROP_META is the half of the vocabulary the validator reasons *with* — how
 * big a thing is, whether a hand can close on it — so a film-only type with no
 * entry is not a cosmetic gap: it is the validator declining to answer, and a
 * system prompt unable to say what a parasol is. Entries are all-or-nothing on
 * purpose. A size with no tags would make `checkHeldProp` read `undefined.some`
 * and a category-less entry would print "is undefined (1.9 x 2 x 1.9 m)", so a
 * type is either fully described or honestly listed as undescribed.
 */
const UNMEASURED_PROPS = [];
for (const type of FILM_ONLY_TYPES) {
  const m = BLENDER_META?.[type];
  const complete = m && Array.isArray(m.size) && m.size.length === 3 && m.category
    && Array.isArray(m.tags) && m.tags.length;
  if (!complete) { UNMEASURED_PROPS.push(type); continue; }
  // The one cross-check available without Blender. `_dims` publishes the same
  // three numbers in the same order for the three primitives that take a
  // `size`, so a declared size that contradicts the builder's own default is a
  // table someone edited without re-measuring.
  const dims = BLENDER_DIMS.get(type);
  if (dims && dims.some((n, i) => Math.abs(n - m.size[i]) > 0.02)) {
    throw new Error(`blender/ph_assets.py: PROP_META['${type}'].size is ${JSON.stringify(m.size)} but make_${type} builds _dims(size, ${JSON.stringify(dims)}) by default — one of the two is stale`);
  }
  PROP_META[type] = { size: m.size, category: m.category, tags: m.tags };
}

const declaredExtra = Object.keys(BLENDER_META ?? {}).filter((t) => !FILM_ONLY_TYPES.includes(t));
if (declaredExtra.length) {
  throw new Error(`blender/ph_assets.py: PROP_META declares ${declaredExtra.join(', ')}, which props.js also describes — two tables for one type is how they diverge; the browser registry is the source for anything it builds`);
}

/**
 * Types built to be carried, per renderer, from the grip each one authors.
 *
 * `tags` says what a type is *for*; this says whether anyone worked out where
 * the hand goes. They disagree — the browser tags `rifle` as 'held' and gives
 * it no `hold` block, so it rides the default offset — and the disagreement is
 * worth publishing rather than smoothing over.
 */
const HOLDABLE = { blender: BLENDER_GRIPS, browser: BROWSER_GRIPS };

/**
 * The closed sets scenefile.js declares, spelt out for anyone reading this.
 *
 * Read from that file rather than restated here, so the field descriptions
 * below always list exactly what validateScene will accept. A prompt written
 * from this file then needs nothing else to say what a shot size is.
 */
const ENUMS = Object.fromEntries(['SIZES', 'MOVES', 'HEIGHTS', 'MOODS', 'GROUNDS', 'HANDS']
  .map((n) => [n, stringList('src/scenefile.js', new RegExp(`^const ${n} = \\[`, 'm'), 'js')]));

// SIZES calls itself a mirror of director.js SHOT_SIZES, and a mirror nobody
// checks is just a copy. A size the format offers and the camera solver has
// never heard of falls back to MS: the shot the director asked for is not the
// shot they get, and nothing says so.
const solverSizes = blockEntries('src/director.js', /^export const SHOT_SIZES = \{/m, 'js').map((r) => r.key);
if (ENUMS.SIZES.join() !== solverSizes.join()) {
  throw new Error(`src/scenefile.js SIZES is ${ENUMS.SIZES.join(', ')} but src/director.js SHOT_SIZES is ${solverSizes.join(', ')} — the format and the camera solver disagree about what sizes exist`);
}

/** An anchored fact about a source file, or a death naming what changed. */
function mustContain(rel, needle, claim) {
  if (!read(rel).includes(needle)) {
    throw new Error(`${rel} no longer contains ${JSON.stringify(needle)}, so the generated claim "${claim}" is no longer supported by the source — re-derive it or delete it`);
  }
}
function mustNotContain(rel, re, claim) {
  if (re.test(read(rel))) {
    throw new Error(`${rel} now matches ${re}, so the generated claim "${claim}" has stopped being true`);
  }
}

/**
 * Units and axes: the half of the grammar that is a convention, not a list.
 *
 * Nothing here can be counted out of a registry, so each line is written down
 * and then pinned to the line of source that makes it true. A convention that
 * drifts is worse than one that is merely undocumented, because a prompt goes
 * on stating it with total confidence, and a scene laid out on the wrong axis
 * validates perfectly and renders a room on its side.
 */
const CONVENTIONS = {
  distance: 'metres',
  angle: 'radians',
  time: 'seconds; shot durations are authored and start times are derived',
  axes: 'three.js world space: y is up, the ground is the x/z plane',
  groundPoint: 'a two-element [x, z] is accepted wherever a point is; the missing component is the ground',
  size: '[width, height, depth] in metres, height on y',
  heading: '0 faces +z, and the angle increases toward +x',
  blender: 'the Blender renderer is z-up and converts on the way in; a scene file never uses Blender axes',
};

mustContain('blender/render_scene.py', 'return Vector((v[0], -v[2], v[1]))', CONVENTIONS.axes);
mustContain('blender/render_scene.py', 'return facing + math.pi', CONVENTIONS.heading);
mustContain('blender/ph_assets.py', 'w, h, d = default if size is None else size', CONVENTIONS.size);
mustContain('blender/ph_assets.py', 'return (abs(float(w)), abs(float(d)), abs(float(h)))', CONVENTIONS.size);
mustContain('src/scenefile.js', 'c.at.length === 2 ? [c.at[0], 0, c.at[1]] : c.at', CONVENTIONS.groundPoint);

// The three fields one renderer reads and the other does not. Each is a claim
// the generated grammar makes in so many words, so each is pinned to the line
// that makes it true and to the absence that makes it a divergence.
const FILM_ONLY = 'read by the Blender render only; the browser preview ignores it';
const PREVIEW_ONLY = 'plays in the browser preview only; the Blender render has no effect system';
const CAPTION_ONLY = 'drawn over the browser preview only; the Blender render carries it in the manifest but burns no text into the image';
mustContain('blender/render_scene.py', '"lens": cam.get("lens")', FILM_ONLY);
mustNotContain('src/production.js', /camera\.lens|cam\.lens/, FILM_ONLY);
mustContain('src/production.js', 'colour: a.colour', PREVIEW_ONLY);
mustNotContain('blender/render_scene.py', /action(\[|\.get\()["']colour/, PREVIEW_ONLY);
mustContain('src/main.js', 'ui.caption.textContent = text', CAPTION_ONLY);
mustNotContain('blender/render_scene.py', /text_add|['"]FONT['"]/, CAPTION_ONLY);

/**
 * What each field type means, in the words a prompt should use.
 *
 * The grammar below names a type per field rather than describing each field
 * twice, which is also what lets the probe harness synthesise a plausible value
 * for every field it checks: one table serves the reader and the test.
 */
const FIELD_TYPES = {
  id: 'a cast id or a prop id — the two share one namespace',
  castId: 'a cast id',
  propId: 'a prop id from environment.props',
  propRef: 'a prop id from environment.props, or a bare prop type to conjure one',
  propType: 'a prop type',
  name: 'a unique identifier other entries refer to',
  point: '[x, y, z] in metres, or [x, z] for a point on the ground',
  extent: '[width, depth] in metres',
  metres: 'a height above the ground in metres',
  radians: 'a heading in radians',
  seconds: 'a duration in seconds, greater than zero',
  speed: 'metres per second, greater than zero; above 2.2 becomes a run',
  unit: 'a number from 0 to 1',
  scalar: 'a positive multiplier',
  colour: 'a "#rrggbb" string',
  lens: 'vertical field of view in degrees',
  pose: `one of ${[...new Set([...BROWSER_POSES, ...BLENDER_POSES])].join(', ')}`,
  ability: `one of ${ABILITIES.join(', ')}`,
  hand: '"L" or "R"',
  side: '1 or -1: which side of the line of action to shoot from',
  shotSize: `one of ${ENUMS.SIZES.join(', ')}`,
  move: `one of ${ENUMS.MOVES.join(', ')}`,
  height: `one of ${ENUMS.HEIGHTS.join(', ')}`,
  mood: `one of ${ENUMS.MOODS.join(', ')}`,
  groundKind: `one of ${ENUMS.GROUNDS.join(', ')}`,
  fade: '"in" or "out"',
  options: `build options: ${OPTION_KEYS.join(', ')}`,
  propList: 'an array of environment.props entries',
  camera: 'a camera block',
  actionList: 'an array of actions',
  caption: 'a caption block',
  spec: "an object of appearance fields for the character builder",
  text: 'a string',
  flag: 'true or false',
  number: 'a number',
};

/**
 * The shape of every node in the format: required fields, optional ones, and
 * the groups where at least one member has to be present.
 *
 * This is the one table here that is written rather than read, because the
 * knowledge lives in the *control flow* of validateScene and no honest scan
 * recovers it. So it is not trusted: every line is put to the validator below,
 * by building a scene that omits exactly one field and insisting the validator
 * objects — or includes exactly one and insisting it does not. A field that
 * stops being required, or a new one that starts, fails this generator instead
 * of quietly reaching a prompt.
 */
const SCENE_GRAMMAR = {
  environment: {
    what: 'the set: its ground, its weather, and everything standing on it',
    required: {},
    optional: {
      preset: 'text', ground: 'groundKind', size: 'extent', mood: 'mood',
      fog: 'number', sky: 'text', props: 'propList',
    },
  },
  prop: {
    what: 'one entry of environment.props: a placed object with an id actions can name',
    required: { id: 'name', type: 'propType', at: 'point' },
    optional: { rot: 'radians', scale: 'scalar', options: 'options' },
  },
  cast: {
    what: 'one entry of cast: a person, and where they start',
    required: { id: 'name' },
    optional: { name: 'text', spec: 'spec', at: 'point', facing: 'radians' },
  },
  shot: {
    what: 'one entry of shots: a camera, a stretch of time, and what happens in it',
    required: { duration: 'seconds' },
    optional: {
      id: 'name', camera: 'camera', actions: 'actionList',
      caption: 'caption', fade: 'fade', note: 'text',
    },
  },
  camera: {
    what: 'where the lens goes and what it is on',
    required: {},
    optional: {
      size: 'shotSize', subject: 'id', secondary: 'id', move: 'move',
      height: 'height', side: 'side', ots: 'flag', at: 'point',
      lookAt: 'point', lens: 'lens',
    },
    needs: { ots: ['secondary'] },
    only: { lens: FILM_ONLY },
  },
  caption: {
    what: 'the line printed under the shot',
    required: { text: 'text' },
    optional: { speaker: 'castId' },
    only: { text: CAPTION_ONLY, speaker: CAPTION_ONLY },
  },
};

/**
 * Per-verb grammar for shots[].actions, in the order VERBS declares them.
 *
 * `do` is not listed: the key is the verb. `actor` is, because which kind of id
 * it takes is half of what a verb means — `prop` moves a placed prop and `move`
 * walks a person, and writing one where the other belongs is the mistake this
 * says out loud.
 */
const ACTION_GRAMMAR = {
  move: {
    what: 'walk or run to a position',
    required: { actor: 'castId', to: 'point' },
    optional: { speed: 'speed', facing: 'radians', pose: 'pose' },
  },
  pose: {
    what: 'adopt a named pose',
    required: { actor: 'castId', pose: 'pose' },
    optional: {},
  },
  look: {
    what: 'aim head and eyes at somebody, something, or a point',
    required: { actor: 'castId' },
    oneOf: { fields: { target: 'id', at: 'point' }, level: 'error' },
    optional: { weight: 'unit' },
  },
  hold: {
    what: 'put a prop in a hand, placing one if the scene file never did',
    required: { actor: 'castId', prop: 'propRef' },
    optional: { hand: 'hand', options: 'options' },
  },
  release: {
    what: 'let go; with no prop named, let go of everything',
    required: { actor: 'castId' },
    optional: { prop: 'propRef' },
  },
  face: {
    what: 'turn the body to a heading, or toward a target',
    required: { actor: 'castId' },
    oneOf: { fields: { to: 'radians', target: 'id' }, level: 'error' },
    optional: {},
  },
  vfx: {
    what: 'fire a magic ability',
    required: { actor: 'id' },
    optional: { ability: 'ability', target: 'id', colour: 'colour' },
    only: { '*': PREVIEW_ONLY },
  },
  prop: {
    what: 'move, lift or turn a placed prop',
    required: { actor: 'propId' },
    oneOf: { fields: { to: 'point', hover: 'metres', rot: 'radians' }, level: 'warning' },
    optional: {},
  },
};

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

/** Every string literal at the top level of an array, comments skipped. */
function stringList(rel, headerRe, lang) {
  const src = read(rel);
  const m = headerRe.exec(src);
  if (!m) throw new Error(`${rel}: no match for ${headerRe} — the declaration was renamed or moved, and this generator must be updated to follow it`);
  const L = LANGS[lang];
  const out = [];
  let depth = 0;
  for (let i = src.indexOf('[', m.index); i < src.length; i++) {
    const inert = inertAt(src, i, L);
    if (inert) {
      if (inert.text !== null && depth === 1) out.push(inert.text);
      i = inert.end - 1;
      continue;
    }
    const c = src[i];
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') { depth--; if (depth === 0) return out; }
  }
  throw new Error(`${rel}: unterminated array after ${headerRe}`);
}

// The verb list is declared in scenefile.js and the grammar is declared here,
// which is one table too many; this is what stops them being two. A verb added
// to the format with no grammar written for it fails the generator rather than
// reaching a prompt as a name with no fields.
const declaredVerbs = stringList('src/scenefile.js', /^const VERBS = \[/m, 'js');
const grammarVerbs = Object.keys(ACTION_GRAMMAR);
if (declaredVerbs.join() !== grammarVerbs.join()) {
  throw new Error(`ACTION_GRAMMAR covers ${grammarVerbs.join(', ')} but src/scenefile.js VERBS is ${declaredVerbs.join(', ')} — same verbs, same order, or a prompt will describe a format the validator does not accept`);
}

for (const [node, g] of [...Object.entries(SCENE_GRAMMAR), ...Object.entries(ACTION_GRAMMAR)]) {
  const fields = { ...g.required, ...g.optional, ...(g.oneOf?.fields ?? {}) };
  for (const [field, type] of Object.entries(fields)) {
    if (!FIELD_TYPES[type]) throw new Error(`${node}.${field} is typed "${type}", which FIELD_TYPES does not describe`);
  }
  for (const field of Object.keys(g.only ?? {})) {
    if (field !== '*' && !fields[field]) throw new Error(`${node}.only names ${field}, which is not a field of ${node}`);
  }
  for (const [field, needed] of Object.entries(g.needs ?? {})) {
    if (!fields[field]) throw new Error(`${node}.needs names ${field}, which is not a field of ${node}`);
    for (const n of needed) if (!fields[n]) throw new Error(`${node}.needs[${field}] names ${n}, which is not a field of ${node}`);
  }
}

// A synonym for a type that no longer exists suggests a repair the validator
// will reject on the next round trip, which is the one thing a suggestion must
// never do.
const strandedSynonyms = Object.keys(PROP_SYNONYMS).filter((t) => !BROWSER_PROPS.includes(t));
if (strandedSynonyms.length) {
  throw new Error(`src/props.js: PROP_KEYWORDS maps prose to ${strandedSynonyms.join(', ')}, which the PROPS registry no longer builds`);
}
if (!OPTION_KEYS.length) throw new Error('no build options found in any ph_assets signature — the signature scan is broken, not the renderer');

// PROP_META is the half of the vocabulary the validator reasons *with* rather
// than merely checks against, so a missing field there is a silent wrong
// answer later ("no, a wardrobe is not a held prop") instead of a crash.
for (const name of Object.keys(PROP_META)) {
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

const metaLines = Object.keys(PROP_META).map((name) => {
  const m = PROP_META[name];
  return `  ${/^[A-Za-z_]\w*$/.test(name) ? name : `'${name}'`}: { size: [${m.size.join(', ')}], category: '${m.category}', tags: [${list(m.tags)}] },`;
}).join('\n');

/**
 * A JS literal for a plain value, two spaces per level.
 *
 * The grammar is nested and the generated file is read by people, so it is
 * emitted as source rather than as one long JSON line. Strings are single
 * quoted to match the rest of the file; anything with a quote in it would break
 * that, so it is escaped rather than hoped about.
 */
function js(value, indent = '') {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (value === null || typeof value !== 'object') return String(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const parts = value.map((v) => js(v));
    const flat = `[${parts.join(', ')}]`;
    if (flat.length + indent.length <= 92 && !flat.includes('\n')) return flat;
    // A list of thirty type names one per line is unreadable; fill the width
    // instead, and keep one-per-line for anything with structure in it.
    if (parts.every((p) => !p.includes('\n') && p.length < 30)) {
      const lines = [];
      for (const p of parts) {
        if (!lines.length || `${lines[lines.length - 1]} ${p},`.length + inner.length > 92) lines.push(`${p},`);
        else lines[lines.length - 1] += ` ${p},`;
      }
      return `[\n${lines.map((l) => `${inner}${l}`).join('\n')}\n${indent}]`;
    }
    return `[\n${value.map((v) => `${inner}${js(v, inner)},`).join('\n')}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
  const flat = `{ ${keys.map((k) => `${key(k)}: ${js(value[k])}`).join(', ')} }`;
  if (flat.length + indent.length <= 92 && !flat.includes('\n')) return flat;
  return `{\n${keys.map((k) => `${inner}${key(k)}: ${js(value[k], inner)},`).join('\n')}\n${indent}}`;
}

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
 * Per-type facts: \`size\` is [w, h, d] in metres, \`tags\` say what a type is for
 * — 'held'/'handheld' means it is built to be carried, 'hero' means it holds up
 * in close-up. Read from the browser registry, and from ph_assets.PROP_META for
 * the types only Blender builds.
 */
export const PROP_META = {
${metaLines}
};

/**
 * Types ph_assets builds that nothing describes, so nothing can reason about.
 *
 * Their extents are emergent — a blob's amplitude, a scalloped canopy, a seeded
 * taper — so there is no number in the source to read and no honest way to
 * invent one. They are had by building the mesh in Blender and measuring it,
 * then declaring the result in ph_assets.PROP_META, which this file reads. Until
 * then the validator will not guess whether a hand can close on one.
 */
export const UNMEASURED_PROPS = ${js(UNMEASURED_PROPS)};

/**
 * Natural words for a type, from the same table propsMentioned reads.
 *
 * A better repair suggestion than edit distance for the mistake that actually
 * happens, which is not a typo: a model asked for a prop writes the English
 * word. "gun" is five edits from "rifle" and nothing recovers it but this.
 */
export const PROP_SYNONYMS = ${js(PROP_SYNONYMS)};

// ---------------------------------------------------------------------------
// Grammar — the shape of the format, not just its names
// ---------------------------------------------------------------------------

/** The whole of \`options\`, from the Blender builders' own signatures. */
export const OPTION_KEYS = ${js(OPTION_KEYS)};

/**
 * Which types actually honour each option, per renderer.
 *
 * Read from ph_assets' \`inspect.signature\` and from the browser registry's own
 * \`options\` list, because those are the two things that really decide it. An
 * option in \`blender\` and not \`browser\` is honoured in the film and dropped in
 * the preview, which is the one thing a director must be told before they spend
 * a session tuning a colour half the pipeline never shows them.
 */
export const OPTION_SUPPORT = ${js(OPTION_SUPPORT, '')};

/**
 * Types with an authored grip, per renderer: where a hand actually goes.
 *
 * Not the same as the 'held'/'handheld' tags, which say what a type is *for*.
 * Anything else is parented to the hand at its own origin.
 */
export const HOLDABLE = ${js(HOLDABLE, '')};

/** Units and axes: declared, and pinned to the source lines that make them true. */
export const CONVENTIONS = ${js(CONVENTIONS, '')};

/** What each field type in the grammar means, in the words a prompt should use. */
export const FIELD_TYPES = ${js(FIELD_TYPES, '')};

/**
 * The shape of every node in the format.
 *
 * \`required\` must be present; \`optional\` may be; \`oneOf.fields\` is a group at
 * least one of which has to be present, at \`oneOf.level\`; \`needs\` records a
 * field that only means anything alongside another; \`only\` records a field one
 * renderer reads and the other does not. Every line of it is put to
 * validateScene by the generator, so it cannot describe a format the validator
 * does not enforce.
 */
export const SCENE_GRAMMAR = ${js(SCENE_GRAMMAR, '')};

/** The same, per action verb, in the order VERBS declares them. */
export const ACTION_GRAMMAR = ${js(ACTION_GRAMMAR, '')};
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

  options (from the ph_assets signatures): ${OPTION_KEYS.join(', ')}
${OPTION_KEYS.map((k) => {
    const { blender, browser } = OPTION_SUPPORT[k];
    // Only types BOTH renderers build can disagree; one the other has never
    // heard of is already reported as missing above.
    const both = BLENDER_PROPS.filter((t) => BROWSER_PROPS.includes(t));
    const filmOnly = only(blender, browser).filter((t) => both.includes(t));
    const previewOnly = only(browser, blender).filter((t) => both.includes(t));
    return `    ${k.padEnd(7)} film ${String(blender.length).padStart(2)}  preview ${String(browser.length).padStart(2)}`
      + `   of the ${both.length} types both build, honoured by the film alone: ${filmOnly.join(' ') || 'none'}; by the preview alone: ${previewOnly.join(' ') || 'none'}`;
  }).join('\n')}
  option names the preview offers that no scene file may write: ${BROWSER_ONLY_OPTIONS.join(' ') || 'none'}

  grips authored — film:    ${HOLDABLE.blender.join(' ') || 'none'}
  grips authored — preview: ${HOLDABLE.browser.join(' ') || 'none'}

  PROP_META      ${String(Object.keys(PROP_META).length).padStart(3)}   (${BROWSER_PROPS.length} from the browser registry, ${Object.keys(PROP_META).length - BROWSER_PROPS.length} declared in ph_assets)
  PROP_SYNONYMS  ${String(Object.keys(PROP_SYNONYMS).length).padStart(3)}   ${Object.values(PROP_SYNONYMS).flat().length} words; no synonyms for: ${only([...new Set([...BROWSER_PROPS, ...BLENDER_PROPS])], Object.keys(PROP_SYNONYMS)).join(' ') || 'none'}
`);

if (UNMEASURED_PROPS.length) {
  console.log(`  ${UNMEASURED_PROPS.length} film-only type(s) with no size, category or tags: ${UNMEASURED_PROPS.join(' ')}
    Nothing in ph_assets states how big these are and their meshes are seeded,
    so the numbers exist only once Blender has built one. Measure them and
    declare the result as PROP_META in blender/ph_assets.py; this generator
    reads it, cross-checks any type that also has a _dims default, and folds it
    into src/vocabulary.js. Until then the validator cannot say whether an
    actor can carry one, and a system prompt cannot describe them at all.
`);
}

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

// ---------------------------------------------------------------------------
// Putting the grammar to the validator
// ---------------------------------------------------------------------------

/**
 * A plausible value per field type, and the smallest scene that is still valid.
 *
 * Every probe below is this scene with one field added or taken away, so the
 * only thing that can make a probe fail is the field it is about.
 */
const SAMPLE = {
  id: 'A', castId: 'A', propId: 'p1', propRef: 'cup', propType: 'crate',
  name: 'X', point: [1, 0, 2], extent: [20, 20], metres: 1.4, radians: 0.6,
  seconds: 2, speed: 1.2, unit: 0.5, scalar: 1.2, colour: '#ff8800',
  lens: 35, pose: 'idle', ability: 'light', hand: 'R', side: -1,
  shotSize: 'MS', move: 'push', height: 'eye', mood: 'DUSK',
  groundKind: 'grass', fade: 'in', options: { colour: '#ff8800' },
  propList: [{ id: 'p1', type: 'crate', at: [0, 0, 0] }],
  camera: { subject: 'A' }, actionList: [], caption: { text: 'a line' },
  spec: { height: 1.0 }, text: 'a line', flag: true, number: 0.2,
};

const base = () => ({
  version: 1,
  environment: { props: [{ id: 'p1', type: 'crate', at: [0, 0, 0] }] },
  cast: [{ id: 'A' }, { id: 'B' }],
  shots: [{ duration: 2, camera: { subject: 'A' }, actions: [] }],
});

/** Where each node lives, so a probe can hand the validator a whole scene. */
const NODE_SCENE = {
  environment: (f) => { const s = base(); s.environment = f; return s; },
  prop: (f) => { const s = base(); s.environment.props = [f]; return s; },
  cast: (f) => { const s = base(); s.cast = [f, { id: 'A' }, { id: 'B' }]; return s; },
  shot: (f) => { const s = base(); s.shots = [f]; return s; },
  camera: (f) => { const s = base(); s.shots[0].camera = f; return s; },
  caption: (f) => { const s = base(); s.shots[0].caption = f; return s; },
};
for (const verb of Object.keys(ACTION_GRAMMAR)) {
  NODE_SCENE[`do:${verb}`] = (f) => {
    const s = base();
    s.shots[0].actions = [{ do: verb, ...f }];
    return s;
  };
}

const { validateScene } = await import('../src/scenefile.js');
const failures = [];
let probes = 0;

/** Run one probe: `want` is 'clean', or a list of names the report must mention. */
function probe(node, what, fields, want, level = 'error') {
  probes++;
  const { errors, warnings } = validateScene(NODE_SCENE[node](fields));
  const list = level === 'error' ? errors : warnings;
  if (want === 'clean') {
    if (errors.length) failures.push(`${node}: ${what} should validate, but: ${errors.join(' | ')}`);
    return;
  }
  const hit = list.some((m) => want.some((f) => m.includes(`.${f}`) || m.includes(` ${f}`)));
  if (!hit) {
    failures.push(`${node}: ${what} — the grammar says ${want.join('/')} is not optional, but validateScene raised no ${level} naming it${list.length ? `; it said: ${list.join(' | ')}` : ''}`);
  }
}

const value = (type) => {
  if (!(type in SAMPLE)) throw new Error(`no sample value for field type "${type}"`);
  return SAMPLE[type];
};
const fill = (map) => Object.fromEntries(Object.entries(map).map(([f, t]) => [f, value(t)]));

for (const [node, g] of [
  ...Object.entries(SCENE_GRAMMAR),
  ...Object.entries(ACTION_GRAMMAR).map(([v, x]) => [`do:${v}`, x]),
]) {
  const needs = g.needs ?? {};
  const oneOf = Object.keys(g.oneOf?.fields ?? {});
  // The minimal node: everything required, plus one member of each either/or
  // group, plus whatever that member cannot be written without.
  const first = oneOf.length ? { [oneOf[0]]: value(g.oneOf.fields[oneOf[0]]) } : {};
  const support = Object.fromEntries((needs[oneOf[0]] ?? []).map((n) => [n, value({ ...g.required, ...g.optional }[n])]));
  const minimal = { ...fill(g.required), ...first, ...support };

  probe(node, 'a node with everything on it', { ...minimal, ...fill(g.optional), ...fill(g.oneOf?.fields ?? {}) }, 'clean');
  probe(node, 'a node with only its required fields', minimal, 'clean');

  for (const field of Object.keys(g.required)) {
    const without = { ...minimal };
    delete without[field];
    probe(node, `${field} left out`, without, [field]);
  }
  for (const [field, type] of Object.entries(g.optional)) {
    const extra = Object.fromEntries((needs[field] ?? []).map((n) => [n, value({ ...g.required, ...g.optional }[n])]));
    probe(node, `${field} on its own`, { ...minimal, ...extra, [field]: value(type) }, 'clean');
  }
  if (oneOf.length) {
    const none = { ...minimal };
    for (const f of oneOf) delete none[f];
    probe(node, `none of ${oneOf.join('/')}`, none, oneOf, g.oneOf.level);
  }
  for (const [field, needed] of Object.entries(needs)) {
    const alone = { ...minimal, [field]: value({ ...g.required, ...g.optional }[field]) };
    for (const n of needed) delete alone[n];
    probe(node, `${field} without ${needed.join('/')}`, alone, needed);
  }
}

console.log(`  grammar: ${probes} probes over ${Object.keys(SCENE_GRAMMAR).length} nodes and ${Object.keys(ACTION_GRAMMAR).length} verbs — ${failures.length ? `${failures.length} FAILED` : 'all agree with validateScene'}\n`);
if (failures.length) {
  for (const f of failures) console.error(`    ! ${f}`);
  console.error('\n  The grammar in this generator and the rules in validateScene have parted company. Fix whichever is wrong; do not publish a grammar the validator does not enforce.');
  process.exitCode = 1;
}
