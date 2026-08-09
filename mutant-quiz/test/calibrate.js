/* Tier calibration. Simulates archetypal players and reports where they land,
 * so the thresholds in categories.js are set against real distributions rather
 * than guesses. Run: node test/calibrate.js */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ console, Math, JSON, Object, Array, Number, String, isFinite });
['categories.js', 'questions.js', 'engine.js', 'synergy.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), ctx, { filename: f });
});
const { Engine, Synergy, QUESTIONS, CATEGORY_KEYS, CATEGORY_BY_KEY } = ctx;

/* Deterministic PRNG so runs are comparable. */
let seed = 1234567;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function choice(arr) { return arr[Math.floor(rnd() * arr.length)]; }

/* A player with `bias` toward some categories picks the option that best serves
 * them `fidelity` of the time, and answers at random otherwise. */
function play(bias, fidelity) {
  const state = { answers: {} };
  QUESTIONS.forEach((q) => {
    const max = q.max || 1;
    let picks;
    if (rnd() < fidelity) {
      const scored = q.options.map((o) => {
        let v = 0;
        bias.forEach((b) => { v += (o.w || {})[b] || 0; });
        return { o, v };
      }).sort((a, b) => b.v - a.v);
      picks = scored.slice(0, max).filter((x, i) => i === 0 || x.v > 0).map((x) => x.o);
      if (scored[0].v <= 0) picks = [choice(q.options)];
    } else {
      picks = [choice(q.options)];
    }
    picks.forEach((o) => Engine.toggleOption(state, q.id, o.id));
  });
  return Engine.profile(state);
}

const RUNS = 40;
const tierCounts = {};

function run(label, bias, fidelity, tally) {
  let t1 = 0, str = 0;
  const tiers = {};
  let sampleFusion = '';
  for (let i = 0; i < RUNS; i++) {
    const p = play(bias, fidelity);
    t1 += p.shortlist.length ? p.shortlist[0].value : 0;
    str += p.tier.strength;
    tiers[p.tier.name] = (tiers[p.tier.name] || 0) + 1;
    if (tally) tierCounts[p.tier.name] = (tierCounts[p.tier.name] || 0) + 1;
    if (i === 0) {
      const f = Synergy.compose(p);
      sampleFusion = f.name + ' (' + p.shortlist.map((r) => CATEGORY_BY_KEY[r.key].short).join('+') + ')';
    }
  }
  const spread = Object.keys(tiers).sort((x, y) => tiers[y] - tiers[x])
    .map((k) => k + '×' + tiers[k]).join(' ');
  console.log(
    label.padEnd(30) +
    String(Math.round(t1 / RUNS)).padStart(4) + '  ' +
    (str / RUNS).toFixed(2).padStart(8) + '  ' +
    spread.padEnd(26) + sampleFusion
  );
  return str / RUNS;
}

/* How consistently a player picks the option that favours their theme.
 * 1.00 is a deliberate min-maxer; ~0.30 is somebody answering honestly with
 * only a mild lean; 0.00 is noise. */
console.log('FIDELITY SWEEP — how consistently the player serves their own theme');
console.log('player                          top1  strength  tier');
console.log('-'.repeat(104));
[['psychic'], ['elemental'], ['tech'], ['beastial', 'bio']].forEach((bias) => {
  [1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.0].forEach((f) => {
    run(bias.join('+') + ' @ ' + f.toFixed(2), bias, f, false);
  });
  console.log('');
});

console.log('ARCHETYPES');
console.log('player                          top1  strength  tier');
console.log('-'.repeat(104));
const ARCHETYPES = [
  { name: 'min-maxer, single axis',   bias: ['psychic'],          fidelity: 1.0  },
  { name: 'min-maxer, two axes',      bias: ['psychic', 'time'],  fidelity: 0.95 },
  { name: 'strong consistent theme',  bias: ['elemental'],        fidelity: 0.70 },
  { name: 'clear lean',               bias: ['beastial', 'bio'],  fidelity: 0.55 },
  { name: 'honest, mild lean',        bias: ['tech'],             fidelity: 0.35 },
  { name: 'honest, no theme',         bias: ['energy'],           fidelity: 0.20 },
  { name: 'answers at random',        bias: [],                   fidelity: 0.0  },
  { name: 'reality-seeker',           bias: ['reality', 'time'],  fidelity: 0.95 }
];
ARCHETYPES.forEach((a) => run(a.name, a.bias, a.fidelity, true));

console.log('\noverall tier distribution across ' + (ARCHETYPES.length * RUNS) + ' simulated players:');
Object.keys(tierCounts).sort((a, b) => tierCounts[b] - tierCounts[a]).forEach((k) => {
  const n = tierCounts[k];
  const pct = Math.round(100 * n / (ARCHETYPES.length * RUNS));
  console.log('  ' + k.padEnd(9) + String(n).padStart(4) + '  ' + '█'.repeat(Math.round(pct / 2)) + ' ' + pct + '%');
});
