/**
 * Timeline-anchored director notes.
 *
 * The user pauses playback and types a plain instruction — "wider", "closer on
 * Miren", "make the camera shake", "she carries the lantern". We parse that
 * into a small structured directive, pin it to the timeline, and let the
 * playback layer overlay it on the procedural director's shot list.
 *
 * Scope rules, because "from this moment" means different things:
 *  - camera notes belong to the SHOT containing their timestamp — they season
 *    one shot, they don't re-grade the whole film;
 *  - prop notes persist "until changed" — a hand holds the apple from the note
 *    forward until a later note releases it or replaces it.
 *
 * This module is deliberately dependency-light (director.js only) so it can be
 * unit-tested in plain node without a browser or a renderer.
 */

import { SHOT_SIZES } from './director.js';

/** Tightest -> widest. Derived from SHOT_SIZES so the two never drift. */
export const SHOT_LADDER = Object.keys(SHOT_SIZES);

/** Camera moves the solver understands (mirrors director.js MOVES). */
export const NOTE_MOVES = ['static', 'push', 'pull', 'dolly', 'crane', 'handheld', 'orbit'];

const MAX_HISTORY = 50;
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that must never be mistaken for a cast member or a prop. Mostly the
 * note vocabulary itself plus common function words — fuzzy matching would
 * otherwise happily read "camera" as a character called Cam.
 */
const STOP = new Set((
  'the a an and or but on in at to of for with into onto over under from until then when ' +
  'make sure they them their theyre she her hers he him his its this that those these it ' +
  'camera shot shots here now please again more less little bit lot much way really very just ' +
  'keep stay hold holds holding held put puts down drop drops drooping pick picks take takes ' +
  'carry carries carrying give gives hand hands zoom zooms out closer wider close wide tight ' +
  'tighter looser nearer angle low high eye level push pull dolly orbit crane static handheld ' +
  'shake shaky shaking wobble longer shorter linger lingers cut cuts scene frame lens still ' +
  'slow slowly slower fast faster quick quicker snappy around back away get got let breathe ' +
  'dont move moving movement track tracking boom jib rise sweep swoop circle arc spin rotate ' +
  'extreme extremely medium full body head shoulders establishing master cowboy some what who'
).split(/\s+/));

/** Nouns that follow hold/drop verbs without being props ("hold this shot"). */
const NON_PROP = new Set((
  'shot shots it that this those these camera frame framing position still pace angle low ' +
  'high level here there moment take cut scene down back up out on in longer shorter tight ' +
  'wide held everything nothing shake shakes shaking shaky wobble wobbling jitter movement ' +
  'motion moving'
).split(/\s+/));

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[n];
}

/** Forgiving single-token comparison: exact, prefix (close lengths), or edit distance. */
function nameMatches(word, name) {
  if (word === name) return true;
  if (word.length >= 3 && name.length >= 3) {
    if (name.startsWith(word) && name.length - word.length <= 2) return true;
    if (word.startsWith(name) && word.length - name.length <= 2) return true;
  }
  const maxEd = name.length >= 6 ? 2 : name.length >= 4 ? 1 : 0;
  return maxEd > 0 && word.length >= 3 && levenshtein(word, name) <= maxEd;
}

/**
 * Fuzzy-match free text against the cast list. Returns the canonical cast
 * name (original casing) or null. Scored so an exact full-name hit beats a
 * token hit which beats a typo-distance hit.
 */
function matchCast(text, castNames) {
  if (!castNames || !castNames.length) return null;
  const words = norm(text).split(/[^a-z0-9'-]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  const grams = [...words];
  for (let i = 0; i < words.length - 1; i++) grams.push(`${words[i]} ${words[i + 1]}`);
  let best = null;
  let bestScore = 0;
  for (const cast of castNames) {
    const name = norm(cast);
    if (!name) continue;
    const parts = name.split(' ');
    for (const g of grams) {
      let score = 0;
      if (g === name) score = 4;
      else if (parts.includes(g)) score = 3;
      else if (nameMatches(g, name)) score = 2;
      else if (parts.some((p) => p.length >= 3 && nameMatches(g, p))) score = 1;
      if (score > bestScore) { bestScore = score; best = cast; }
    }
  }
  return best;
}

/** Strip articles/filler off a captured prop phrase; '' means "not a prop". */
function cleanPropText(raw) {
  let t = norm(raw).replace(/[.!?,;:]+$/, '');
  t = t.replace(/^(?:on\s+to\s+|onto\s+|up\s+|to\s+)/, '');
  t = t.replace(/^(?:the|a|an|his|her|their|its|some|that|this)\s+/, '');
  for (let i = 0; i < 2; i++) {
    t = t.replace(/\s+(?:here|now|please|again|for now|from now on|in this scene|right now)$/, '');
  }
  t = t.trim();
  const head = t.split(/\s+/)[0] || '';
  if (!head || NON_PROP.has(head)) return '';
  return t;
}

/** Normalise a prop phrase for countermand comparison ("the apples" == "apple"). */
function propKey(prop) {
  if (!prop) return '*';
  return norm(prop)
    .replace(/^(?:the|a|an|his|her|their)\s+/, '')
    .replace(/s$/, '');
}

// ---------------------------------------------------------------------------
// parseNote
// ---------------------------------------------------------------------------

// Absolute shot sizes, most specific first so "medium close up" never reads
// as "medium" and "extreme wide" never reads as "wide".
const SIZE_RULES = [
  [/(?:extreme|extremely|big)\s+close\s*-?\s*up|\becu\b|\bchoker\b/, 'ECU'],
  [/medium\s+close\s*-?\s*up|\bmcu\b|head\s+and\s+shoulders/, 'MCU'],
  [/close\s*-?\s*up|\bcu\b|\btight\s+(?:on|shot)\b/, 'CU'],
  [/medium\s+wide|\bmws\b|\bcowboy\b|knees\s+up/, 'MWS'],
  [/(?:extreme|extremely|very|super)\s+wide|\bews\b/, 'EWS'],
  [/wide\s+shot|\bws\b|\bwide\b|full\s+(?:shot|body|figure|length)|head\s+to\s+toe|\bestablishing\b|\bmaster\s+shot\b/, 'WS'],
  [/medium\s+shot|\bmedium\b|mid\s*-?\s*shot|waist\s+up|\bms\b/, 'MS'],
];

// Camera moves, checked in order; first hit wins. "dolly in/out" are really
// push/pull, so they're claimed by those rules before plain "dolly".
const MOVE_RULES = [
  ['static', /\b(?:no|stop|without|kill|quit|less)\b.{0,15}\bshak/],
  ['handheld', /\bhand\s*-?\s*held\b|\bshak(?:e|y|es|ing)\b|\bwobbl|\bjitter|\bdocumentary\b|\bv[eé]rit[eé]\b/],
  ['static', /\bstatic\b|\block(?:ed|s)?(?:\s+(?:off|down|it))?\b|\btripod\b|\bsteady\b|\bstill\s+camera\b|\bcamera\s+still\b|\bstop\s+moving\b|\bno\s+(?:more\s+)?(?:movement|motion)\b|\bfreeze\b|\bhold\s+still\b|\bdon'?t\s+move\b|\bkeep\s+(?:it|the\s+camera)\s+still\b/],
  ['push', /\bpush(?:es|ing)?(?:\s+in)?\b|\bcreep(?:s|ing)?\s+in\b|\bdolly\s+in\b/],
  ['pull', /\bpull(?:s|ing)?(?:\s+(?:out|back|away|off))?\b|\bdolly\s+(?:out|back)\b|\bretreat(?:s|ing)?\b|\bdrift(?:s)?\s+(?:back|away)\b/],
  ['orbit', /\borbit(?:s|ing)?\b|\bcircl(?:e|es|ing)\b|\barc(?:s|ing)?\b|\brevolv|\bspin(?:s|ning)?\s+around\b|\brotate(?:s)?\s+around\b|\bgo\s+around\b|\baround\s+(?:them|him|her)\b/],
  ['crane', /\bcrane(?:s)?\b|\bboom(?:s)?\b|\bjib\b|\brise(?:s)?\b|\bswoop|\bsweep(?:s|ing)?\b/],
  ['dolly', /\bdolly\b|\btrack(?:s|ing)?\b|\btruck(?:s)?\b|\bslide(?:s)?\b|\blateral\b/],
];

const HEIGHT_RULES = [
  ['low', /\blow\s+(?:angle|shot)\b|\bfrom\s+below\b|\bworm'?s?\s*-?\s*eye\b|\blook(?:ing)?\s+up\s+at\b|\bangle\s+up\b|^low$/],
  ['high', /\bhigh\s+(?:angle|shot)\b|\bfrom\s+above\b|\bbird'?s?\s*-?\s*eye\b|\boverhead\b|\btop\s*-?\s*down\b|\blook(?:ing)?\s+down\b|\bangle\s+down\b|^high$/],
  ['eye', /\beye\s*-?\s*level\b|\beye\s+height\b|\bneutral\s+angle\b|\blevel\s+with\b/],
];

const CLOSER_RE = /\bcloser\b|\btighter\b|\bnearer\b|\bzoom\w*\s+(?:\w+\s+){0,2}in\b|\bpunch(?:es|ing)?\s+in\b|\bgo\s+in\b|\bmove\s+in\b/;
const WIDER_RE = /\bwider\b|\blooser\b|\bzoom\w*\s+(?:\w+\s+){0,2}(?:out|back)\b|\bfurther\s+(?:back|away|out)\b|\bback\s+(?:off|up|out)\b|\bopen\s+(?:it\s+)?up\b|\bgive\s+(?:them|him|her|it)\s+(?:some\s+)?room\b/;
const INTENSIFIER_RE = /\bmuch\b|\bway\b|\ba\s+lot\b|\breally\b|\bfar\b|\btwice\b|\bsignificantly\b/;
const DIMINISHER_RE = /\ba\s+(?:little|bit|touch|hair|tad)\b|\bslightly\b|\bsubtly\b/;

const LONGER_RE = /\blonger\b|\blinger(?:s|ing)?\b|\bhold\s+(?:this|the|that|it|here)\b|\blet\s+it\s+breathe\b|\bdon'?t\s+cut\b|\bstay\s+(?:here|on\s+this)\b|\bslower\s+cut/;
const SHORTER_RE = /\bshorter\b|\bquicker\b|\bfaster\b|\bsnapp(?:y|ier)\b|\btrim\s+(?:it|this)\b|\bcut\s+(?:sooner|earlier)\b|\bpick\s+up\s+the\s+pace\b|\bbrisker\b|\bbrief(?:er)?\b/;

const CUT_RE = /\bcut(?:s|ting)?\s+(?:over\s+)?to\b|\bsmash\s+cut\b/;

// Prop grammar. Release before hold so "take away the lamp" isn't a grab.
const WILDCARD_RELEASE_RE = /\bempty\s+hands?\b|\bhands?\s+(?:empty|free)\b|\bdrops?\s+everything\b/;
const RELEASE_VERB_RE = /\b(?:puts?\s+down|putting\s+down|sets?\s+down|setting\s+down|drops?|dropping|discards?|stows?|loses?|ditch(?:es)?|gets?\s+rid\s+of|takes?\s+away|no\s+more)\b\s*(.*)$/;
const RELEASE_WRAP_RE = /\b(?:puts?|sets?|lays?)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|their\s+|it\s*|that\s+|everything\s*)?([\w' -]*?)\s*(?:down|away|back)\b/;
const GIVE_RE = /\b(?:gives?|hands?|passes?)\s+([a-z][\w'-]*)\s+(?:the|a|an|his|her|their)\s+(.+)$/;
const HOLD_VERB_RE = /\b(?:holds?|holding|carr(?:y|ies|ying)|picks?\s+up|picked\s+up|grabs?|grabbing|takes?|wields?|clutch(?:es)?|brandish(?:es)?|hands?|gives?)\b\s+(.+)$/;

/** Build a prop directive, splitting a trailing "... to <name>" into character. */
function propDirective(action, rawProp, beforeText, castNames) {
  let prop = rawProp;
  let character = beforeText ? matchCast(beforeText, castNames) : null;
  const toWhom = /\s+to\s+([\w' -]+)$/.exec(prop || '');
  if (toWhom) {
    const who = matchCast(toWhom[1], castNames);
    if (who) { character = character || who; prop = prop.slice(0, toWhom.index); }
  }
  const cleaned = cleanPropText(prop);
  if (!cleaned) return null;
  return { kind: 'prop', prop: cleaned, action, character: character || null };
}

/**
 * Parse one plain-language director note into a directive.
 *
 * Returns either
 *   { kind: 'camera', size?, sizeStep?, move?, height?, subject?, cut?, durationScale? }
 * where `size` is a SHOT_SIZES key, `sizeStep` walks SHOT_LADDER (+1 = wider,
 * -1 = closer), `move` is a NOTE_MOVES entry, `height` is low/high/eye,
 * `subject` is a canonical cast name and `durationScale` multiplies the shot
 * length; or
 *   { kind: 'prop', prop, action: 'hold'|'release', character }
 * where `prop` is free text for the integrator to resolve against the prop
 * registry and a release with prop === null means "empty the hands"; or
 *   { error: reason } when nothing in the text could be read as a direction.
 *
 * @param {string} text
 * @param {string[]} [castNames]
 */
export function parseNote(text, castNames = []) {
  const t = norm(text);
  if (!t) return { error: 'Empty note' };

  // --- Props first: "hold" and "drop" belong to hands before they belong
  // to shot duration, and the object blacklist sends "hold this shot" back
  // to the camera rules below.
  if (WILDCARD_RELEASE_RE.test(t)) {
    return { kind: 'prop', prop: null, action: 'release', character: matchCast(t, castNames) };
  }
  let m = RELEASE_VERB_RE.exec(t);
  if (m) {
    const d = propDirective('release', m[1], t.slice(0, m.index), castNames);
    if (d) return d;
  }
  m = RELEASE_WRAP_RE.exec(t);
  if (m) {
    if (!m[1] || !m[1].trim()) {
      // "put it down" / "set that down" — release whatever is held.
      return { kind: 'prop', prop: null, action: 'release', character: matchCast(t.slice(0, m.index), castNames) };
    }
    const d = propDirective('release', m[1], t.slice(0, m.index), castNames);
    if (d) return d;
  }
  m = GIVE_RE.exec(t);
  if (m) {
    const who = matchCast(m[1], castNames);
    const d = propDirective('hold', m[2], '', castNames);
    if (d) return { ...d, character: who || d.character };
  }
  m = HOLD_VERB_RE.exec(t);
  if (m) {
    const d = propDirective('hold', m[1], t.slice(0, m.index), castNames);
    if (d) return d;
  }

  // --- Camera: accumulate every field the text mentions into one directive,
  // so "low angle, closer on Miren" lands as a single coherent note.
  const dir = { kind: 'camera' };
  let matched = false;

  for (const [re, size] of SIZE_RULES) {
    if (re.test(t)) { dir.size = size; matched = true; break; }
  }
  if (!dir.size) {
    const steps = INTENSIFIER_RE.test(t) ? 2 : 1;
    if (CLOSER_RE.test(t)) { dir.sizeStep = -steps; matched = true; }
    else if (WIDER_RE.test(t)) { dir.sizeStep = steps; matched = true; }
  }

  for (const [move, re] of MOVE_RULES) {
    if (re.test(t)) { dir.move = move; matched = true; break; }
  }

  for (const [height, re] of HEIGHT_RULES) {
    if (re.test(t)) { dir.height = height; matched = true; break; }
  }

  if (LONGER_RE.test(t)) {
    dir.durationScale = INTENSIFIER_RE.test(t) ? 2.0 : DIMINISHER_RE.test(t) ? 1.25 : 1.5;
    matched = true;
  } else if (SHORTER_RE.test(t)) {
    dir.durationScale = INTENSIFIER_RE.test(t) ? 0.5 : DIMINISHER_RE.test(t) ? 0.8 : 0.65;
    matched = true;
  }

  const subject = matchCast(t, castNames);
  if (subject) { dir.subject = subject; matched = true; }
  if (CUT_RE.test(t)) { dir.cut = true; matched = true; }

  if (!matched) {
    return { error: `Couldn't read a direction in "${String(text).trim()}"` };
  }
  return dir;
}

// ---------------------------------------------------------------------------
// applyNotes
// ---------------------------------------------------------------------------

/**
 * Overlay camera directives on a director.js shot. Returns a modified copy —
 * the original shot list stays pristine so disabling a note is free.
 *
 * Directives apply in array order, later wins, so callers should pass notes
 * time-sorted (notesAt already does). Prop directives are ignored here; the
 * production layer owns hands. Accepts raw directives or whole note objects.
 *
 * @param {object} shot from director.direct
 * @param {Array<object>|object} directives
 * @returns {object} new shot
 */
export function applyNotes(shot, directives) {
  const out = { ...shot };
  const list = Array.isArray(directives) ? directives : (directives ? [directives] : []);
  let durScale = 1;
  let touched = false;

  for (const item of list) {
    const d = item && item.directive ? item.directive : item;
    if (!d || d.error || d.kind !== 'camera') continue;
    if (item && item.enabled === false) continue;

    if (d.size && SHOT_LADDER.includes(d.size)) { out.size = d.size; touched = true; }
    if (d.sizeStep) {
      // Relative steps walk the ladder from wherever the shot currently sits,
      // so "wider" after "closer" lands back where it started.
      const i = SHOT_LADDER.indexOf(out.size);
      const base = i === -1 ? SHOT_LADDER.indexOf('MS') : i;
      const next = Math.max(0, Math.min(SHOT_LADDER.length - 1, base + d.sizeStep));
      out.size = SHOT_LADDER[next];
      touched = true;
    }
    if (d.move && NOTE_MOVES.includes(d.move)) { out.move = d.move; touched = true; }
    if (d.height === 'low' || d.height === 'high' || d.height === 'eye') {
      out.height = d.height;
      touched = true;
    }
    if (d.subject) {
      // Reframing on a new subject: keep the old subject in frame as the
      // secondary if they swapped, and drop OTS — its geometry assumed the
      // old speaker/listener pair.
      if (out.secondary === d.subject) out.secondary = out.subject;
      out.subject = d.subject;
      out.ots = false;
      touched = true;
    }
    if (d.durationScale) { durScale *= d.durationScale; touched = true; }
  }

  if (durScale !== 1) out.duration = shot.duration * durScale;
  if (touched) out.noted = true;
  return out;
}

// ---------------------------------------------------------------------------
// NoteStack
// ---------------------------------------------------------------------------

/** Same containment semantics as director.shotAt: last shot starting <= time. */
function shotIndexAt(shots, time) {
  if (!shots || !shots.length) return -1;
  let lo = 0;
  let hi = shots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (shots[mid].start <= time) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * The ordered collection of notes plus bounded undo/redo.
 *
 * History entries store the affected note by reference, so undoing an add and
 * redoing it round-trips the identical object (ids stay stable for the UI).
 */
export class NoteStack {
  constructor() {
    /** @type {Array<object>} time-sorted notes */
    this.notes = [];
    this._undo = [];
    this._redo = [];
    this._id = 1;
  }

  _sort() {
    this.notes.sort((a, b) => (a.time - b.time) || (a.id - b.id));
  }

  /** Record an action; a fresh action invalidates the redo branch. */
  _record(action) {
    this._undo.push(action);
    if (this._undo.length > MAX_HISTORY) this._undo.shift();
    this._redo.length = 0;
  }

  /**
   * Parse and pin a note. Returns the stored note, or { error } (and stores
   * nothing) when the text couldn't be read.
   * @param {number} time seconds on the production timeline
   * @param {number|null} sceneIndex scene the user was watching (UI metadata)
   * @param {string} text
   * @param {string[]} [castNames]
   */
  addNote(time, sceneIndex, text, castNames = []) {
    const directive = parseNote(text, castNames);
    if (directive.error) return { error: directive.error };
    const note = {
      id: this._id++,
      time: Number(time) || 0,
      sceneIndex: sceneIndex ?? null,
      text: String(text),
      directive,
      enabled: true,
    };
    this.notes.push(note);
    this._sort();
    this._record({ op: 'add', note });
    return note;
  }

  /** Remove by id. Returns the removed note or null. */
  remove(id) {
    const i = this.notes.findIndex((n) => n.id === id);
    if (i === -1) return null;
    const [note] = this.notes.splice(i, 1);
    this._record({ op: 'remove', note });
    return note;
  }

  /** Flip a note's enabled flag without losing it. Returns the note or null. */
  toggle(id) {
    const note = this.notes.find((n) => n.id === id);
    if (!note) return null;
    note.enabled = !note.enabled;
    this._record({ op: 'toggle', note });
    return note;
  }

  /** Reverse the most recent add/remove/toggle. Returns the affected note or null. */
  undo() {
    const action = this._undo.pop();
    if (!action) return null;
    if (action.op === 'add') {
      this.notes = this.notes.filter((n) => n !== action.note);
    } else if (action.op === 'remove') {
      this.notes.push(action.note);
      this._sort();
    } else {
      action.note.enabled = !action.note.enabled;
    }
    this._redo.push(action);
    if (this._redo.length > MAX_HISTORY) this._redo.shift();
    return action.note;
  }

  /** Re-apply the most recently undone action. Returns the affected note or null. */
  redo() {
    const action = this._redo.pop();
    if (!action) return null;
    if (action.op === 'add') {
      this.notes.push(action.note);
      this._sort();
    } else if (action.op === 'remove') {
      this.notes = this.notes.filter((n) => n !== action.note);
    } else {
      action.note.enabled = !action.note.enabled;
    }
    // Straight onto the undo stack — NOT via _record, which would wipe the
    // remaining redo branch mid-redo-chain.
    this._undo.push(action);
    if (this._undo.length > MAX_HISTORY) this._undo.shift();
    return action.note;
  }

  /** All notes, time-sorted, enabled or not (the UI shows disabled ones dimmed). */
  list() {
    return this.notes.slice();
  }

  /**
   * Notes in force at a timeline moment.
   *
   * Camera notes: active only while playback is inside the shot containing the
   * note's own timestamp — pass the director's shot list to resolve that.
   * Without `shots` we degrade to "every camera note at or before `time`",
   * which applyNotes' later-wins ordering keeps sane.
   *
   * Prop notes persist until changed: for each prop the latest note at or
   * before `time` wins, and a bare release (prop null) empties every hand.
   * Returned release notes tell the integrator to keep hands empty.
   *
   * @param {number} time
   * @param {Array<object>|null} [shots] from director.direct
   * @returns {Array<object>} active notes, time-sorted
   */
  notesAt(time, shots = null) {
    const active = [];
    const qShot = shots ? shotIndexAt(shots, time) : -1;

    for (const n of this.notes) {
      if (!n.enabled || n.directive.kind !== 'camera') continue;
      if (shots && shots.length) {
        if (qShot !== -1 && shotIndexAt(shots, n.time) === qShot) active.push(n);
      } else if (n.time <= time + EPS) {
        active.push(n);
      }
    }

    const hands = new Map(); // propKey -> latest note (this.notes is time-sorted)
    for (const n of this.notes) {
      if (!n.enabled || n.directive.kind !== 'prop' || n.time > time + EPS) continue;
      const d = n.directive;
      if (d.action === 'release' && !d.prop) {
        hands.clear();
        hands.set('*', n);
      } else {
        hands.set(propKey(d.prop), n);
      }
    }
    active.push(...hands.values());

    active.sort((a, b) => (a.time - b.time) || (a.id - b.id));
    return active;
  }

  /** Plain-data snapshot for persistence alongside the script. */
  toJSON() {
    return {
      version: 1,
      nextId: this._id,
      notes: this.notes.map((n) => ({ ...n, directive: { ...n.directive } })),
    };
  }

  /**
   * Rebuild from a toJSON snapshot. History does not survive serialisation —
   * undo is a session affordance, not document state.
   * @param {object} data
   * @returns {NoteStack}
   */
  static fromJSON(data) {
    const stack = new NoteStack();
    if (data && Array.isArray(data.notes)) {
      stack.notes = data.notes
        .filter((n) => n && n.directive && !n.directive.error)
        .map((n) => ({
          id: n.id,
          time: Number(n.time) || 0,
          sceneIndex: n.sceneIndex ?? null,
          text: String(n.text || ''),
          directive: { ...n.directive },
          enabled: n.enabled !== false,
        }));
      stack._sort();
    }
    const maxId = stack.notes.reduce((m, n) => Math.max(m, n.id || 0), 0);
    stack._id = Math.max(Number(data?.nextId) || 1, maxId + 1);
    return stack;
  }
}
