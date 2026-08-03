/**
 * Archetype-matching regression table.
 *
 * Pure Node — imports chooseArchetype/parseHeading directly, since keyword
 * matching never touches the DOM or the renderer. Every heading runs through
 * the real parseHeading -> chooseArchetype pipeline and is asserted against
 * an expected archetype key and exterior flag.
 *
 * Run: node tools/dbg-archetypes.mjs   (exits non-zero on any mismatch)
 */

import { chooseArchetype } from '../src/stage.js';
import { parseHeading } from '../src/parser.js';

// [heading, expected archetype key, expected exterior flag]
const CASES = [
  // --- Every pre-existing archetype still resolves -------------------------
  ['INT. THE PARLOUR - NIGHT', 'parlour', false],
  ['INT. DRAWING ROOM - DAY', 'parlour', false],
  ['INT. GREAT HALL - NIGHT', 'hall', false],
  ['INT. THE BALLROOM - NIGHT', 'hall', false],
  ['INT. HER BEDCHAMBER - NIGHT', 'bedroom', false],
  ['INT. THE NURSERY - DAY', 'bedroom', false],
  ['INT. KITCHEN - MORNING', 'kitchen', false],
  ['INT. THE SCULLERY - DAY', 'kitchen', false],
  ['INT. THE LIBRARY - NIGHT', 'library', false],
  ['INT. HIS STUDY - NIGHT', 'library', false],
  ['INT. THE ATTIC - NIGHT', 'attic', false],
  ['INT. THE CRYPT - NIGHT', 'cellar', false],
  ['INT. A SMALL COTTAGE - NIGHT', 'cottage', false],
  ['INT. EMPTY STAGE - NIGHT', 'theatre', false],
  ['EXT. THE FOREST - DAY', 'forest', true],
  ['EXT. A CLEARING IN THE WOODS - DAY', 'forest', true],
  ['EXT. VILLAGE SQUARE - DAY', 'village', true],
  ['EXT. THE STREET - NIGHT', 'village', true],
  ['EXT. THE MEADOW - DAY', 'field', true],
  ['EXT. GARDEN PATH - DAWN', 'field', true],

  // --- The new orchard -----------------------------------------------------
  ['EXT. THE ORCHARD - DAY', 'orchard', true],
  ['EXT. APPLE TREE - DAY', 'orchard', true],
  ['EXT. CHERRY TREE ON THE HILL - DAY', 'orchard', true],
  ['EXT. OUTSIDE BY A TREE', 'orchard', true],

  // --- Typo tolerance ------------------------------------------------------
  ['INT. OUTSIFR BY A TREE', 'orchard', true], // the user's heading, verbatim
  ['INT. OUTSIDE BY A TREE', 'orchard', true], // typo fixed, prefix still wrong
  ['INT. WINE CELAR - NIGHT', 'cellar', false], // celar -> cellar, distance 1
  ['EXT. THE FORREST - DAY', 'forest', true], // forrest -> forest, distance 1

  // --- Guard rails ---------------------------------------------------------
  ['EXT. SHALLOW POND - DAY', 'field', true], // old substring matcher hit 'hall' here
  ['EXT. RIVERBANK - DAY', 'field', true], // no keyword: exterior default is now field
  ['INT. SOMEWHERE - CONTINUOUS', 'cottage', false], // no keyword: interior default unchanged
  ['INT. THE KITCHEN GARDEN - DAY', 'kitchen', false], // nature word must not relocate a real room
];

let failures = 0;
console.log('heading'.padEnd(38) + 'expected'.padEnd(18) + 'got');
for (const [heading, wantKey, wantExterior] of CASES) {
  const { location, interior } = parseHeading(heading);
  const arch = chooseArchetype(location, interior);
  const gotExterior = !!arch.exterior;
  const ok = arch.key === wantKey && gotExterior === wantExterior;
  if (!ok) failures += 1;
  const tag = (k, ext) => `${k} (${ext ? 'ext' : 'int'})`;
  console.log(
    heading.padEnd(38)
    + tag(wantKey, wantExterior).padEnd(18)
    + tag(arch.key, gotExterior)
    + (ok ? '' : '   <-- MISMATCH'),
  );
}

// Prose reinforcement: an unmatchable heading whose action lines talk about
// branches and roots must resolve outdoors even under an INT. prefix.
{
  const arch = chooseArchetype('MYSTERY PLACE', true, {
    prose: 'She stands under the branches. Mind the roots.',
  });
  const ok = arch.key === 'field' && !!arch.exterior;
  if (!ok) failures += 1;
  console.log(
    'INT. MYSTERY PLACE + tree prose'.padEnd(38)
    + 'field (ext)'.padEnd(18)
    + `${arch.key} (${arch.exterior ? 'ext' : 'int'})`
    + (ok ? '' : '   <-- MISMATCH'),
  );
}

if (failures) {
  console.error(`\n${failures} mismatch(es) out of ${CASES.length + 1} cases`);
  process.exit(1);
}
console.log(`\nok — ${CASES.length + 1} headings matched`);
