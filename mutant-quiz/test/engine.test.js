/* Headless checks for the scoring engine.
 * Loads the browser files into a plain VM context — no DOM required. */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ console, Math, JSON, Object, Array, Number, String, isFinite });
['categories.js', 'questions.js', 'engine.js', 'synergy.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), ctx, { filename: f });
});

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (detail !== undefined ? '  → ' + detail : ''));
  }
}
function section(name) { console.log('\n' + name); }

const { Engine, Synergy, QUESTIONS, QUESTIONS_BY_ID, CATEGORY_KEYS, TUNING, QUESTION_SETS } = ctx;

function fresh() { return { answers: {} }; }
function pick(state, qid, oid) { Engine.toggleOption(state, qid, oid); }

/* ── 1. data integrity ─────────────────────────────────────────────── */

section('Question bank');

check('60 questions', QUESTIONS.length === 60, QUESTIONS.length);
check('6 sets of 10', QUESTION_SETS.every((s) => QUESTIONS.filter((q) => q.set === s.n).length === 10));

const ids = new Set();
let dupId = null;
QUESTIONS.forEach((q) => { if (ids.has(q.id)) dupId = q.id; ids.add(q.id); });
check('unique question ids', dupId === null, dupId);

let badWeight = null, badOptId = null;
QUESTIONS.forEach((q) => {
  const seen = new Set();
  q.options.forEach((o) => {
    if (seen.has(o.id)) badOptId = q.id + '.' + o.id;
    seen.add(o.id);
    Object.keys(o.w || {}).forEach((k) => {
      if (CATEGORY_KEYS.indexOf(k) === -1) badWeight = q.id + ' → ' + k;
    });
    Object.keys(o.sub || {}).forEach((k) => {
      if (ctx.ELEMENT_KEYS.indexOf(k) === -1) badWeight = q.id + ' → sub ' + k;
    });
  });
});
check('all weight keys are real categories', badWeight === null, badWeight);
check('unique option ids per question', badOptId === null, badOptId);

let everyCatReachable = CATEGORY_KEYS.every((k) =>
  QUESTIONS.some((q) => q.options.some((o) => (o.w || {})[k] > 0)));
check('every category is reachable', everyCatReachable);

/* ── 2. scoring is a pure recompute ────────────────────────────────── */

section('Scoring');

let s = fresh();
pick(s, 'q1', 'a');                      // beastial +2, bio +1
check('single answer scores', Engine.profile(s).scores.beastial === 2);

pick(s, 'q1', 'a');                      // click again → deselect
check('re-clicking clears the answer', Engine.profile(s).scores.beastial === 0);

pick(s, 'q1', 'a');
pick(s, 'q1', 'c');                      // single-select: c replaces a
let p = Engine.profile(s);
check('changing answer replaces, never stacks',
  p.scores.beastial === 0 && p.scores.psychic === 2, JSON.stringify({ b: p.scores.beastial, p: p.scores.psychic }));

// Hammering the same option only ever toggles it. It can never accumulate.
let spam = fresh();
for (let i = 0; i < 51; i++) pick(spam, 'q4', 'c');
check('51 clicks == 1 click (selected)', Engine.profile(spam).scores.psychic === 2, Engine.profile(spam).scores.psychic);
pick(spam, 'q4', 'c');
check('52 clicks == 0 clicks (cleared)', Engine.profile(spam).scores.psychic === 0, Engine.profile(spam).scores.psychic);

// Multi-select respects its cap and drops the oldest.
let multi = fresh();
['a', 'b', 'c'].forEach((o) => pick(multi, 'q53', o));   // max 2
check('multi-select caps at max', multi.answers.q53.selected.length === 2);
check('oldest choice falls off', multi.answers.q53.selected.join() === 'b,c', multi.answers.q53.selected.join());

/* ── 3. free-text clamping ─────────────────────────────────────────── */

section('Free-text ("other") clamping');

let w = Engine.sanitiseOtherWeights({ psychic: 99, time: -50, elemental: 3, bio: 1, tech: 1, notacategory: 5 });
check('drops unknown categories', w.notacategory === undefined);
check('clamps per-category magnitude',
  Object.keys(w).every((k) => Math.abs(w[k]) <= TUNING.OTHER_MAX_PER_CATEGORY), JSON.stringify(w));
check('caps category count',
  Object.keys(w).length <= TUNING.OTHER_MAX_CATEGORIES, Object.keys(w).length);
let total = Object.keys(w).reduce((a, k) => a + Math.abs(w[k]), 0);
check('caps total magnitude', total <= TUNING.OTHER_MAX_TOTAL_MAGNITUDE, total);

let ot = fresh();
Engine.setOther(ot, 'q1', { text: 'x', weights: { psychic: 2 } });
check('other contributes', Engine.profile(ot).scores.psychic === 2);
Engine.setOther(ot, 'q1', { text: 'y', weights: { psychic: 1 } });
check('editing other replaces, never adds', Engine.profile(ot).scores.psychic === 1);
Engine.setOther(ot, 'q1', null);
check('clearing other removes its contribution', Engine.profile(ot).scores.psychic === 0);

/* ── 4. reality gate ───────────────────────────────────────────────── */

section('Reality gate');

let low = fresh();
pick(low, 'q38', 'a');    // time +2, reality +2
pick(low, 'q60', 'e');    // time +2, reality +2
let lp = Engine.profile(low);
check('reality below gate is dropped from the shortlist',
  lp.realityScore === 4 && !lp.shortlist.some((r) => r.key === 'reality'), lp.realityScore);
check('dropped categories are reported', lp.dropped.some((d) => d.key === 'reality'));

let high = fresh();
['q32:d', 'q38:a', 'q39:b', 'q43:b', 'q47:c', 'q50:d', 'q55:c', 'q59:d', 'q60:e'].forEach((pair) => {
  const [q, o] = pair.split(':');
  pick(high, q, o);
});
pick(high, 'q53', 'i');   // reality +3
let hp = Engine.profile(high);
check('deliberate alignment can open the gate',
  hp.realityScore >= TUNING.REALITY_GATE, hp.realityScore);
check('gate open ⇒ reality allowed', hp.realityAllowed === true);

let refuse = fresh();
pick(refuse, 'q53', 'i');   // +3
pick(refuse, 'q54', 'i');   // -4
check('refusing reality outright drives it negative',
  Engine.profile(refuse).scores.reality === -1, Engine.profile(refuse).scores.reality);

/* ── 5. fusion output ──────────────────────────────────────────────── */

section('Fusion');

// Every ordered pair of categories must resolve to a written entry.
let missing = [];
CATEGORY_KEYS.forEach((a) => CATEGORY_KEYS.forEach((b) => {
  if (a === b) return;
  if (!Synergy.PAIRS[Synergy.pairKey(a, b)]) missing.push(a + '|' + b);
}));
check('all 45 category pairs have a fusion', missing.length === 0, missing.slice(0, 5).join(', '));
check('every category has a single-axis fallback',
  CATEGORY_KEYS.every((k) => Synergy.SINGLES[k] && Synergy.MODIFIERS[k]));

// The user's worked example: temporal first, psychic second, elemental third
// with a sound bias, should derive precognition expressed through sound.
let caseA = fresh();
[['q19', 'a'], ['q16', 'a'], ['q13', 'c'], ['q17', 'c'], ['q37', 'a'], ['q53', 'b'],
 ['q44', 'b'], ['q57', 'c'], ['q23', 'a'], ['q55', 'a'], ['q47', 'c'],
 ['q11', 'a'], ['q20', 'a'], ['q12', 'a'], ['q49', 'b'], ['q46', 'c'], ['q43', 'd'],
 ['q24', 'd'], ['q18', 'b'], ['q10', 'a'], ['q51', 'e'], ['q58', 'c'], ['q56', 'e'], ['q14', 'a']
].forEach((x) => pick(caseA, x[0], x[1]));

let ap = Engine.profile(caseA);
let af = Synergy.compose(ap);
check('case A tops out temporal', ap.shortlist[0].key === 'time', ap.shortlist.map(r => r.key + ':' + r.value).join(' '));
check('case A elemental bias resolves to sound', ap.element === 'sound', ap.element);
check('case A fuses to precognition', af.name === 'Precognition', af.name);
check('case A fusion mentions sound', /sound/.test(af.line + ' ' + (af.modifier || '')), af.line + ' | ' + af.modifier);
console.log('       → ' + af.name + ': ' + af.line + (af.modifier ? '; ' + af.modifier : ''));
console.log('       → tier ' + ap.tier.name);

// Anxiety-driven temporal + psychic: same top pair, no elemental third.
let caseB = fresh();
[['q17', 'c'], ['q16', 'a'], ['q3', 'c'], ['q7', 'd'], ['q53', 'b'], ['q53', 'a'],
 ['q59', 'a'], ['q42', 'b'], ['q46', 'a'], ['q20', 'a'], ['q11', 'a'], ['q49', 'b']
].forEach((x) => pick(caseB, x[0], x[1]));
let bp = Engine.profile(caseB);
let bf = Synergy.compose(bp);
check('case B is a temporal/psychic fusion',
  ['time', 'psychic'].indexOf(bp.shortlist[0].key) !== -1 &&
  ['time', 'psychic'].indexOf(bp.shortlist[1].key) !== -1,
  bp.shortlist.map(r => r.key + ':' + r.value).join(' '));
check('case B stays below Alpha', ['gamma', 'delta', 'beta', 'epsilon'].indexOf(bp.tier.key) !== -1, bp.tier.key);
console.log('       → ' + bf.name + ': ' + bf.line + (bf.modifier ? '; ' + bf.modifier : ''));
console.log('       → tier ' + bp.tier.name);

// Empty quiz must not throw.
let empty = Synergy.compose(Engine.profile(fresh()));
check('empty state produces a safe result', empty.name === 'Dormant');

/* ── 6. tiering ────────────────────────────────────────────────────── */

section('Tiering');

let maxed = fresh();
QUESTIONS.forEach((q) => {
  let best = null, bestV = -99;
  q.options.forEach((o) => {
    const v = (o.w || {}).psychic || 0;
    if (v > bestV) { bestV = v; best = o; }
  });
  if (bestV > 0) pick(maxed, q.id, best.id);
});
let mp = Engine.profile(maxed);
check('a fully committed build reaches Alpha', mp.tier.key === 'alpha',
  mp.tier.key + ' top1=' + mp.shortlist[0].value);
check('committed build without reality never reaches Omega', mp.tier.key !== 'omega');
console.log('       → psychic-max build: top1=' + mp.shortlist[0].value +
  ' total=+' + mp.totalPositive + ' tier=' + mp.tier.name);

let oneAnswer = fresh();
pick(oneAnswer, 'q1', 'a');
check('a single answer lands at the bottom tier',
  Engine.profile(oneAnswer).tier.key === 'epsilon', Engine.profile(oneAnswer).tier.key);

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
