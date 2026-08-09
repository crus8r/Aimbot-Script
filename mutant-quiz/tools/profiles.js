/* tools/profiles.js — run hand-written score vectors through the real engine.
 *
 * Used to sanity-check the fusion table against awkward category pairings —
 * combinations a normal playthrough rarely produces, where "what do these two
 * even have in common" is a genuine question. Prints the shortlist, the
 * elemental bias, the deterministic skeleton and the real tier.
 *
 *   node tools/profiles.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ console, Math, JSON, Object, Array, Number, String, isFinite });
['categories.js', 'questions.js', 'engine.js', 'synergy.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), ctx, { filename: f });
});
const { Engine, Synergy, CATEGORY_BY_KEY, ELEMENT_BY_KEY } = ctx;

const PROFILES = [
  {
    name: 'The night mechanic',
    vibe: 'Fixes things by feel and distrusts instruments. Competitive in a way she keeps out of her voice. Has never once been caught out by a machine failing.',
    cats: { tech: 28, beastial: 22, luck: 12, bio: 9, psychic: 7, energy: 5, time: 4, elemental: 3, esoteric: 2, reality: 1 },
    subs: { metal: 6 }
  },
  {
    name: 'The one who keeps almost dying',
    vibe: 'Quiet, faintly apologetic, has survived an implausible number of accidents. Does not talk about any of them and changes the subject well.',
    cats: { luck: 14, bio: 11, esoteric: 8, psychic: 6, beastial: 5, time: 4, tech: 2, elemental: 2, energy: 1, reality: 1 },
    subs: {}
  },
  {
    name: 'The performer who is not there',
    vibe: 'Magnetic on a stage and strangely absent off it. Friends describe evenings with him warmly and cannot recall what he actually said.',
    cats: { energy: 38, esoteric: 24, elemental: 18, psychic: 12, bio: 8, time: 6, luck: 4, beastial: 3, tech: 2, reality: 2 },
    subs: { water: 11, sound: 4 }
  },
  {
    name: 'The gardener with the long memory',
    vibe: 'Tends things on timescales other people find unreasonable. Remembers exactly what stood where before the road went in.',
    cats: { elemental: 30, time: 24, psychic: 22, bio: 11, esoteric: 7, tech: 6, beastial: 4, energy: 3, luck: 2, reality: 3 },
    subs: { plant: 13, earth: 7 }
  },
  {
    name: 'The one on the night shift',
    vibe: 'Works alone in a building full of cameras. Startles badly and hates that about himself. Nobody on the day shift knows his name.',
    cats: { esoteric: 15, tech: 12, beastial: 9, bio: 6, psychic: 5, time: 3, luck: 2, energy: 2, elemental: 1, reality: 0 },
    subs: { metal: 3 }
  }
];

PROFILES.forEach((p, i) => {
  const prof = Engine.derive(Engine.bundle(p.cats, p.subs, {}));
  const seed = Synergy.compose(prof);
  const top = prof.shortlist;

  console.log('\n' + '═'.repeat(78));
  console.log((i + 1) + '. ' + p.name.toUpperCase());
  console.log('   ' + p.vibe);
  console.log('─'.repeat(78));
  console.log('   ranking   ' + top.map((r, n) =>
    ['1st', '2nd', '3rd'][n] + ' ' + CATEGORY_BY_KEY[r.key].name + ' ' + r.value).join('  ·  '));
  if (prof.element) {
    console.log('   bias      ' + ELEMENT_BY_KEY[prof.element].name + ' +' + prof.subs[prof.element]);
  }
  if (prof.dropped.length) {
    console.log('   dropped   ' + prof.dropped.map((d) =>
      CATEGORY_BY_KEY[d.key].name + ' ' + d.value).join(', '));
  }
  console.log('   pair      ' + Synergy.pairKey(top[0].key, top[1].key));
  console.log('   skeleton  ' + seed.name + ' — ' + seed.line);
  if (seed.modifier) console.log('   modifier  ' + seed.modifier);
  console.log('   strength  ' + top[0].value + '/' + Math.round(prof.tier.ceiling) +
    ' = ' + Math.round(prof.tier.strength * 100) + '%');
  console.log('   TIER      ' + prof.tier.name.toUpperCase());
});
console.log('');
