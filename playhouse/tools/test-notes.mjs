/**
 * Plain-node tests for src/notes.js: the phrase table, NoteStack scoping,
 * undo/redo, serialisation and applyNotes. No browser, no renderer.
 *
 *   node tools/test-notes.mjs
 */

import { parseNote, applyNotes, NoteStack, SHOT_LADDER } from '../src/notes.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) { pass++; return; }
  fail++;
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

function subset(actual, expected) {
  for (const [k, v] of Object.entries(expected)) {
    if (JSON.stringify(actual?.[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

const CAST = ['Miren', 'Corval', 'Lady Ashe'];

// ---------------------------------------------------------------------------
// 1. Phrase table
// ---------------------------------------------------------------------------

const TABLE = [
  // -- shot size: relative steps
  ['zoom out a little', { kind: 'camera', sizeStep: 1 }],
  ['wider', { kind: 'camera', sizeStep: 1 }],
  ['zoom way out', { kind: 'camera', sizeStep: 2 }],
  ['tighter', { kind: 'camera', sizeStep: -1 }],
  ['much closer', { kind: 'camera', sizeStep: -2 }],
  ['closer on Miren', { kind: 'camera', sizeStep: -1, subject: 'Miren' }],
  // -- shot size: absolute ladder
  ['extreme close up', { kind: 'camera', size: 'ECU' }],
  ['close-up', { kind: 'camera', size: 'CU' }],
  ['medium close up', { kind: 'camera', size: 'MCU' }],
  ['medium shot', { kind: 'camera', size: 'MS' }],
  ['cowboy shot', { kind: 'camera', size: 'MWS' }],
  ['go wide', { kind: 'camera', size: 'WS' }],
  ['extreme wide shot', { kind: 'camera', size: 'EWS' }],
  // -- moves
  ['push in slowly', { kind: 'camera', move: 'push' }],
  ['pull back', { kind: 'camera', move: 'pull' }],
  ['make the camera shake', { kind: 'camera', move: 'handheld' }],
  ['handheld', { kind: 'camera', move: 'handheld' }],
  ['static camera', { kind: 'camera', move: 'static' }],
  ['lock it off', { kind: 'camera', move: 'static' }],
  ['stop the shaking', { kind: 'camera', move: 'static' }],
  ['no more shaking', { kind: 'camera', move: 'static' }],
  ['orbit around them', { kind: 'camera', move: 'orbit' }],
  ['crane up', { kind: 'camera', move: 'crane' }],
  ['tracking shot', { kind: 'camera', move: 'dolly' }],
  // -- height
  ['low angle', { kind: 'camera', height: 'low' }],
  ['high angle', { kind: 'camera', height: 'high' }],
  ['from below', { kind: 'camera', height: 'low' }],
  ["bird's eye view", { kind: 'camera', height: 'high' }],
  ['eye level', { kind: 'camera', height: 'eye' }],
  // -- subject
  ['cut to Corval', { kind: 'camera', subject: 'Corval', cut: true }],
  ['on lady ashe', { kind: 'camera', subject: 'Lady Ashe' }],
  ['stay on Mirren', { kind: 'camera', subject: 'Miren' }], // typo tolerated
  // -- duration
  ['hold this shot longer', { kind: 'camera', durationScale: 1.5 }],
  ['linger here', { kind: 'camera', durationScale: 1.5 }],
  ['much longer', { kind: 'camera', durationScale: 2 }],
  ['shorter', { kind: 'camera', durationScale: 0.65 }],
  ['pick up the pace', { kind: 'camera', durationScale: 0.65 }],
  // -- combos land in one directive
  ['push in and hold it longer', { kind: 'camera', move: 'push', durationScale: 1.5 }],
  ['low angle, closer', { kind: 'camera', height: 'low', sizeStep: -1 }],
  // -- props
  ["make sure they're holding an apple here", { kind: 'prop', prop: 'apple', action: 'hold' }],
  ['put down the apple', { kind: 'prop', prop: 'apple', action: 'release' }],
  ['she carries the lantern', { kind: 'prop', prop: 'lantern', action: 'hold' }],
  ['Miren picks up the oil lamp', { kind: 'prop', prop: 'oil lamp', action: 'hold', character: 'Miren' }],
  ['drop the sword', { kind: 'prop', prop: 'sword', action: 'release' }],
  ['put the cup down', { kind: 'prop', prop: 'cup', action: 'release' }],
  ['hand Corval the bottle', { kind: 'prop', prop: 'bottle', action: 'hold', character: 'Corval' }],
  ['put it down', { kind: 'prop', prop: null, action: 'release' }],
];

for (const [phrase, expected] of TABLE) {
  const got = parseNote(phrase, CAST);
  check(`parse "${phrase}"`, subset(got, expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

// Unparseable text errors instead of guessing.
check('parse gibberish errors', !!parseNote('blorp the fizzle', CAST).error);
check('parse empty errors', !!parseNote('', CAST).error);

// ---------------------------------------------------------------------------
// 2. NoteStack: prop scope (until-changed), undo/redo of the countermand
// ---------------------------------------------------------------------------

{
  const stack = new NoteStack();
  const hold = stack.addNote(10, 0, "make sure they're holding an apple here", CAST);
  check('addNote returns note', !!hold.id && hold.directive.action === 'hold');

  const at40 = stack.notesAt(40);
  check('prop note at t=10 active at t=40', at40.some((n) => n.id === hold.id));
  check('prop note not active before its time', !stack.notesAt(5).some((n) => n.id === hold.id));

  const release = stack.addNote(30, 0, 'put down the apple', CAST);
  check('release parses', release.directive?.action === 'release');
  const after = stack.notesAt(40);
  check('hold gone after release at t=30', !after.some((n) => n.id === hold.id));
  check('release note reported at t=40', after.some((n) => n.id === release.id));
  check('hold still active between t=10 and t=30', stack.notesAt(20).some((n) => n.id === hold.id));

  // undo removes the last note (the release), redo restores it.
  const undone = stack.undo();
  check('undo returns the release note', undone?.id === release.id);
  check('after undo the hold is back at t=40', stack.notesAt(40).some((n) => n.id === hold.id));
  const redone = stack.redo();
  check('redo returns the release note', redone?.id === release.id);
  check('after redo the hold is gone again', !stack.notesAt(40).some((n) => n.id === hold.id));

  // wildcard release empties every hand.
  stack.addNote(50, 0, 'put it down', CAST);
  const at60 = stack.notesAt(60);
  check('wildcard release clears named props', !at60.some((n) => n.directive.action === 'hold'));

  // disabled notes are ignored.
  stack.toggle(hold.id);
  check('disabled note absent', !stack.notesAt(20).some((n) => n.id === hold.id));
  stack.undo(); // undo the toggle
  check('undo restores enabled flag', stack.notesAt(20).some((n) => n.id === hold.id));
}

// ---------------------------------------------------------------------------
// 3. NoteStack: camera scope is the shot containing the note's time
// ---------------------------------------------------------------------------

{
  const shots = [
    { start: 0, duration: 5, size: 'WS', move: 'crane', height: 'high', subject: 'Miren', secondary: 'Corval' },
    { start: 5, duration: 4, size: 'MS', move: 'static', height: 'eye', subject: 'Miren', secondary: 'Corval' },
    { start: 9, duration: 3, size: 'MCU', move: 'push', height: 'eye', subject: 'Corval', secondary: 'Miren' },
  ];
  const stack = new NoteStack();
  const note = stack.addNote(6, 0, 'closer', CAST);
  check('camera note active inside its shot', stack.notesAt(8, shots).some((n) => n.id === note.id));
  check('camera note inactive in an earlier shot', !stack.notesAt(2, shots).some((n) => n.id === note.id));
  check('camera note inactive in a later shot', !stack.notesAt(10, shots).some((n) => n.id === note.id));

  // remove + undo round-trip.
  const removed = stack.remove(note.id);
  check('remove returns the note', removed?.id === note.id);
  check('removed note gone', stack.list().length === 0);
  stack.undo();
  check('undo restores removed note', stack.list().length === 1);

  // addNote with garbage stores nothing and doesn't pollute history.
  const before = stack.list().length;
  const err = stack.addNote(7, 0, 'blorp the fizzle', CAST);
  check('bad note returns error', !!err.error);
  check('bad note stored nothing', stack.list().length === before);
}

// ---------------------------------------------------------------------------
// 4. NoteStack: history is bounded at 50
// ---------------------------------------------------------------------------

{
  const stack = new NoteStack();
  for (let i = 0; i < 55; i++) stack.addNote(i, 0, 'wider', CAST);
  let undos = 0;
  while (stack.undo()) undos++;
  check('undo bounded at 50', undos === 50, `undid ${undos}`);
  check('oldest 5 adds survive history cap', stack.list().length === 5);
  let redos = 0;
  while (stack.redo()) redos++;
  check('redo restores the undone 50', redos === 50 && stack.list().length === 55,
    `redid ${redos}, ${stack.list().length} notes`);
}

// ---------------------------------------------------------------------------
// 5. toJSON / fromJSON
// ---------------------------------------------------------------------------

{
  const stack = new NoteStack();
  stack.addNote(10, 0, 'she carries the lantern', CAST);
  const b = stack.addNote(12, 0, 'low angle', CAST);
  stack.toggle(b.id);
  const revived = NoteStack.fromJSON(JSON.parse(JSON.stringify(stack.toJSON())));
  check('fromJSON keeps notes', revived.list().length === 2);
  check('fromJSON keeps enabled flags', revived.list().find((n) => n.id === b.id)?.enabled === false);
  check('fromJSON keeps directives', revived.notesAt(20).some((n) => n.directive.prop === 'lantern'));
  const c = revived.addNote(14, 0, 'wider', CAST);
  check('fromJSON ids continue past old ones', c.id > b.id);
}

// ---------------------------------------------------------------------------
// 6. applyNotes
// ---------------------------------------------------------------------------

{
  const shot = {
    id: '1.0', scene: 0, start: 0, duration: 4, size: 'MS', move: 'static',
    height: 'eye', subject: 'Miren', secondary: 'Corval', ots: true, side: 1,
  };
  const frozen = JSON.stringify(shot);

  const a = applyNotes(shot, [parseNote('closer on Corval', CAST)]);
  check('relative step walks ladder from shot size', a.size === 'MCU', `got ${a.size}`);
  check('subject swaps with secondary', a.subject === 'Corval' && a.secondary === 'Miren');
  check('subject change drops OTS', a.ots === false);
  check('applyNotes never mutates input', JSON.stringify(shot) === frozen);

  const b = applyNotes(shot, [parseNote('extreme close up', CAST)]);
  check('absolute size applies', b.size === 'ECU');

  const c = applyNotes({ ...shot, size: 'EWS' }, [parseNote('wider', CAST)]);
  check('step clamps at wide end', c.size === 'EWS');
  const d = applyNotes({ ...shot, size: 'CU' }, [parseNote('much closer', CAST)]);
  check('step clamps at tight end', d.size === 'ECU');

  const e = applyNotes(shot, [parseNote('hold this shot longer', CAST)]);
  check('duration scales', Math.abs(e.duration - 6) < 1e-9, `got ${e.duration}`);

  const f = applyNotes(shot, [parseNote('put down the apple', CAST)]);
  check('prop directives leave the shot alone', f.size === 'MS' && f.duration === 4 && !f.noted);

  // Later directives win: two size notes in one shot.
  const g = applyNotes(shot, [parseNote('wide shot', CAST), parseNote('closer', CAST)]);
  check('directives apply in order, later wins', g.size === 'MWS', `got ${g.size}`);

  // Whole note objects work too, and disabled ones are skipped.
  const stack = new NoteStack();
  stack.addNote(1, 0, 'make the camera shake', CAST);
  const h = applyNotes(shot, stack.notesAt(2));
  check('applyNotes accepts note objects', h.move === 'handheld');

  check('ladder matches director sizes', SHOT_LADDER.join(',') === 'ECU,CU,MCU,MS,MWS,WS,EWS');
}

// ---------------------------------------------------------------------------

console.log(`test-notes: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
