/**
 * Stage construction: rooms and exteriors inferred from a scene heading,
 * dressed with props, and lit for the time of day.
 *
 * Rooms are a single inverted box with per-face materials — cheap, and a
 * back-faced shell means a camera pulled outside the set still sees in rather
 * than hitting a wall.
 *
 * Surfaces use generated canvas textures. Flat colour reads as "untextured
 * prototype" instantly; plank grain and plaster mottle do more for perceived
 * quality per byte than almost anything else available here.
 */

import * as THREE from 'three';
import { createProp, propsMentioned } from './props.js';
import { woodMaterial } from './materials.js';

// ---------------------------------------------------------------------------
// Procedural surface textures
// ---------------------------------------------------------------------------

const texCache = new Map();
function cachedTexture(key, make) {
  if (!texCache.has(key)) {
    const t = make();
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(key, t);
  }
  return texCache.get(key);
}

function plankTexture(base = '#6b4a2c', dark = '#4a3018') {
  return cachedTexture(`plank:${base}:${dark}`, () => {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = base;
    x.fillRect(0, 0, S, S);
    const planks = 6;
    const ph = S / planks;
    for (let i = 0; i < planks; i++) {
      const shade = 0.86 + Math.random() * 0.28;
      const col = new THREE.Color(base).multiplyScalar(shade);
      x.fillStyle = `#${col.getHexString()}`;
      x.fillRect(0, i * ph, S, ph - 1);
      // Grain.
      for (let g = 0; g < 26; g++) {
        x.strokeStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.06})`;
        x.lineWidth = 0.5 + Math.random() * 1.4;
        x.beginPath();
        const gy = i * ph + Math.random() * ph;
        x.moveTo(0, gy);
        for (let px = 0; px < S; px += 32) {
          x.lineTo(px, gy + Math.sin(px * 0.02 + g) * 1.8);
        }
        x.stroke();
      }
      // Board seam.
      x.strokeStyle = dark;
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(0, i * ph);
      x.lineTo(S, i * ph);
      x.stroke();
      // End joints.
      const jx = Math.random() * S;
      x.beginPath();
      x.moveTo(jx, i * ph);
      x.lineTo(jx, (i + 1) * ph);
      x.stroke();
    }
    return new THREE.CanvasTexture(c);
  });
}

function plasterTexture(base = '#b8a894') {
  return cachedTexture(`plaster:${base}`, () => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = base;
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const a = Math.random() * 0.05;
      x.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      const r = Math.random() * 5 + 1;
      x.beginPath();
      x.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
      x.fill();
    }
    return new THREE.CanvasTexture(c);
  });
}

function stoneTexture(base = '#6e675c') {
  return cachedTexture(`stone:${base}`, () => {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#3a352e';
    x.fillRect(0, 0, S, S);
    const rows = 7;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      let px = (r % 2) * -60;
      while (px < S) {
        const w = 60 + Math.random() * 60;
        const shade = 0.72 + Math.random() * 0.42;
        const col = new THREE.Color('#7a7264').multiplyScalar(shade);
        x.fillStyle = `#${col.getHexString()}`;
        x.fillRect(px + 2, r * rh + 2, w - 4, rh - 4);
        px += w;
      }
    }
    for (let i = 0; i < 1400; i++) {
      x.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      x.fillRect(Math.random() * S, Math.random() * S, 3, 3);
    }
    return new THREE.CanvasTexture(c);
  });
}

function grassTexture() {
  return cachedTexture('grass', () => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#3e5230';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 5000; i++) {
      const g = 0.6 + Math.random() * 0.7;
      const col = new THREE.Color('#4a6238').multiplyScalar(g);
      x.strokeStyle = `#${col.getHexString()}`;
      x.lineWidth = 1;
      const px = Math.random() * S;
      const py = Math.random() * S;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + (Math.random() - 0.5) * 3, py - 2 - Math.random() * 3);
      x.stroke();
    }
    return new THREE.CanvasTexture(c);
  });
}

function cobbleTexture() {
  return cachedTexture('cobble', () => {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#2e2a26';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const shade = 0.6 + Math.random() * 0.6;
      const col = new THREE.Color('#5e564c').multiplyScalar(shade);
      x.fillStyle = `#${col.getHexString()}`;
      x.beginPath();
      x.ellipse(Math.random() * S, Math.random() * S, 12 + Math.random() * 12, 10 + Math.random() * 10,
        Math.random() * Math.PI, 0, Math.PI * 2);
      x.fill();
    }
    return new THREE.CanvasTexture(c);
  });
}

// ---------------------------------------------------------------------------
// Location archetypes
// ---------------------------------------------------------------------------

/**
 * Each archetype declares room size, surfacing, and a dressing list.
 * `dressing` entries: [propName, placement, count]
 */
const ARCHETYPES = {
  parlour: {
    match: ['parlour', 'parlor', 'drawing room', 'sitting room', 'living room', 'front room'],
    size: [7.4, 3.3, 6.2],
    floor: 'plank', wall: 'plaster', wallColour: '#8d7a63', floorColour: '#6b4a2c',
    dressing: [
      ['fireplace', 'wall-back', 1], ['grandfatherClock', 'wall-left', 1],
      ['armchair', 'floor-flank', 2], ['roundTable', 'floor-side', 1],
      ['oilLamp', 'on-surface', 1], ['rug', 'floor-centre', 1],
      ['portrait', 'wall-hang', 2], ['bookshelf', 'wall-right', 1],
      ['candle', 'on-surface', 1], ['window', 'wall-hang-right', 1],
    ],
  },
  hall: {
    match: ['hall', 'great hall', 'ballroom', 'banquet'],
    size: [12.5, 5.6, 9.0],
    floor: 'stone', wall: 'stone', wallColour: '#6e675c', floorColour: '#5e564c',
    dressing: [
      ['chandelier', 'ceiling', 2], ['table', 'floor-centre', 1],
      ['chair', 'floor-flank', 4], ['portrait', 'wall-hang', 3],
      ['grandfatherClock', 'wall-left', 1], ['candle', 'on-surface', 3],
      ['oilLamp', 'on-surface', 1],
    ],
  },
  bedroom: {
    match: ['bedroom', 'bedchamber', 'chamber', 'nursery'],
    size: [6.2, 3.0, 5.6],
    floor: 'plank', wall: 'plaster', wallColour: '#9a8a76', floorColour: '#7a5636',
    dressing: [
      ['bed', 'wall-back', 1], ['wardrobe', 'wall-left', 1],
      ['trunk', 'floor-side', 1], ['roundTable', 'floor-side', 1],
      ['oilLamp', 'on-surface', 1], ['window', 'wall-hang-right', 1],
      ['rug', 'floor-centre', 1], ['candle', 'on-surface', 1],
    ],
  },
  kitchen: {
    match: ['kitchen', 'scullery', 'pantry'],
    size: [6.6, 3.0, 5.6],
    floor: 'stone', wall: 'plaster', wallColour: '#a09079', floorColour: '#6a6258',
    dressing: [
      ['fireplace', 'wall-back', 1], ['table', 'floor-centre', 1],
      ['stool', 'floor-flank', 3], ['barrel', 'floor-corner', 2],
      ['crate', 'floor-corner', 2], ['oilLamp', 'on-surface', 1],
      ['cup', 'on-surface', 2], ['bottle', 'on-surface', 1],
    ],
  },
  library: {
    match: ['library', 'study', 'office', 'workshop'],
    size: [7.0, 3.7, 6.0],
    floor: 'plank', wall: 'plaster', wallColour: '#7d6b56', floorColour: '#5a3a20',
    dressing: [
      ['bookshelf', 'wall-back', 3], ['bookshelf', 'wall-left', 2],
      ['table', 'floor-centre', 1], ['chair', 'floor-side', 2],
      ['oilLamp', 'on-surface', 1], ['grandfatherClock', 'wall-right', 1],
      ['rug', 'floor-centre', 1], ['candle', 'on-surface', 1],
    ],
  },
  attic: {
    match: ['attic', 'loft', 'garret'],
    size: [7.0, 2.5, 5.2],
    floor: 'plank', wall: 'plank', wallColour: '#5a4028', floorColour: '#6a4a2c',
    dressing: [
      ['trunk', 'floor-corner', 3], ['crate', 'floor-corner', 4],
      ['oilLamp', 'floor-side', 1], ['portrait', 'wall-hang', 1],
      ['barrel', 'floor-corner', 1],
    ],
  },
  cellar: {
    match: ['cellar', 'basement', 'crypt', 'vault', 'dungeon'],
    size: [6.4, 2.7, 5.4],
    floor: 'stone', wall: 'stone', wallColour: '#4e483f', floorColour: '#4a443c',
    dressing: [
      ['barrel', 'floor-corner', 4], ['crate', 'floor-corner', 3],
      ['oilLamp', 'floor-side', 1], ['candle', 'floor-side', 2],
    ],
  },
  cottage: {
    match: ['cottage', 'hut', 'cabin', 'home', 'house', 'room', 'interior'],
    size: [6.6, 2.9, 5.8],
    floor: 'plank', wall: 'plaster', wallColour: '#9d8a70', floorColour: '#6b4a2c',
    dressing: [
      ['fireplace', 'wall-back', 1], ['table', 'floor-centre', 1],
      ['chair', 'floor-flank', 2], ['grandfatherClock', 'wall-left', 1],
      ['oilLamp', 'on-surface', 1], ['rug', 'floor-centre', 1],
      ['bookshelf', 'wall-right', 1], ['window', 'wall-hang-right', 1],
      ['candle', 'on-surface', 1],
    ],
  },
  theatre: {
    match: ['stage', 'theatre', 'theater', 'proscenium', 'empty stage'],
    size: [11.0, 6.0, 8.0],
    floor: 'plank', wall: 'plaster', wallColour: '#241c22', floorColour: '#4a3524',
    dressing: [['oilLamp', 'floor-side', 2]],
    drapes: true,
  },
  // Declared before `forest` on purpose: both list the bare 'tree' keyword and
  // ties break on declaration order, so "BY A TREE" lands under fruit trees.
  orchard: {
    match: ['orchard', 'orchards', 'apple', 'apples', 'apple tree', 'apple trees',
      'fruit tree', 'fruit trees', 'apple grove', 'pear tree', 'plum tree',
      'cherry tree', 'tree', 'trees'],
    exterior: true, size: [28, 0, 28], ground: 'grass',
    dressing: [
      ['tree', 'rows', 8, { fruit: '#a8231f' }],
      ['fence', 'perimeter', 10],
      ['basket', 'floor-centre', 1, { apples: 3 }],
      ['crate', 'scatter', 2],
      ['barrel', 'scatter', 1],
    ],
  },
  forest: {
    match: ['forest', 'wood', 'woods', 'glade', 'grove', 'clearing', 'tree', 'trees'],
    exterior: true, size: [26, 0, 26], ground: 'grass',
    dressing: [['tree', 'scatter', 9]],
  },
  village: {
    match: ['village', 'street', 'square', 'market', 'town', 'road', 'lane', 'courtyard'],
    exterior: true, size: [26, 0, 26], ground: 'cobble',
    dressing: [['well', 'floor-side', 1], ['barrel', 'scatter', 3], ['crate', 'scatter', 3], ['tree', 'scatter', 2]],
  },
  field: {
    match: ['field', 'meadow', 'hill', 'moor', 'garden', 'exterior'],
    exterior: true, size: [30, 0, 30], ground: 'grass',
    dressing: [['tree', 'scatter', 4]],
  },
};

// ---------------------------------------------------------------------------
// Forgiving location matching
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'by', 'at', 'in', 'on', 'near', 'under',
  'and', 'to', 'from', 'with', 'some',
]);

/**
 * Words that testify the writer meant outdoors/indoors regardless of the
 * INT./EXT. prefix — a mistyped "INT. OUTSIDE BY A TREE" is far more common
 * than a screenplay that genuinely stages a tree inside a parlour.
 */
const EXTERIOR_SIGNALS = new Set([
  'outside', 'outdoors', 'outdoor', 'tree', 'trees', 'apple', 'apples',
  'orchard', 'garden', 'field', 'meadow', 'hill', 'hillside', 'river',
  'stream', 'brook', 'lake', 'pond', 'sky', 'forest', 'wood', 'woods',
  'grove', 'beach', 'shore', 'mountain', 'cliff', 'path', 'road', 'lane',
  'street', 'yard', 'courtyard', 'grass', 'farm', 'moor', 'bridge',
  'branches', 'roots',
]);
const INTERIOR_SIGNALS = new Set([
  'room', 'indoors', 'inside', 'parlour', 'parlor', 'hall', 'hallway',
  'corridor', 'kitchen', 'chamber', 'bedroom', 'library', 'study', 'attic',
  'cellar', 'basement', 'landing',
]);

const tokenise = (s) => String(s).toLowerCase()
  .replace(/[^a-z0-9' ]+/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

/**
 * Typo repair only ever targets this curated vocabulary — repairing against
 * arbitrary English would manufacture matches out of noise.
 */
const FUZZY_VOCAB = [...new Set([
  ...Object.values(ARCHETYPES).flatMap((a) => a.match.flatMap((m) => m.split(' '))),
  ...EXTERIOR_SIGNALS,
  ...INTERIOR_SIGNALS,
])];
const VOCAB_SET = new Set(FUZZY_VOCAB);

/** Damerau-Levenshtein: substitutions, indels, and adjacent transpositions. */
function editDistance(a, b) {
  const al = a.length;
  const bl = b.length;
  const d = [];
  for (let i = 0; i <= al; i++) d[i] = [i];
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  return d[al][bl];
}

/**
 * Map a token onto the nearest vocabulary word within a length-scaled edit
 * budget. The 3-character prefix guard is what keeps a distance-2 budget from
 * producing garbage on 7-letter words ("outsifr" -> "outside" passes, a random
 * word does not).
 */
function canonicalise(token) {
  if (STOPWORDS.has(token) || VOCAB_SET.has(token)) return { word: token, repaired: false };
  const budget = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
  if (!budget) return { word: token, repaired: false };
  let best = null;
  let bestD = budget + 1;
  const prefix = token.slice(0, 3);
  for (const w of FUZZY_VOCAB) {
    if (Math.abs(w.length - token.length) > budget) continue;
    if (w.slice(0, 3) !== prefix) continue;
    const dist = editDistance(token, w);
    if (dist < bestD) { bestD = dist; best = w; }
  }
  return best ? { word: best, repaired: true } : { word: token, repaired: false };
}

/**
 * Pick a location archetype for a heading.
 *
 * Token-based (no substring hits like 'hall' inside "SHALLOW"), typo-tolerant
 * via `canonicalise`, and signal-scored: nature words anywhere in the heading
 * override a mistyped INT. prefix. Action prose, when supplied, reinforces the
 * interior/exterior call at quarter weight but never picks the archetype — a
 * chair in the dialogue must not relocate the scene to a parlour.
 *
 * @param {string} location heading body, e.g. "OUTSIFR BY A TREE"
 * @param {boolean} interior from the INT./EXT. prefix
 * @param {object} [extras] `{ prose }` joined action/lyric text of the scene
 */
function chooseArchetype(location, interior, { prose = '' } = {}) {
  const canon = tokenise(location).map(canonicalise);
  const words = canon.map((c) => c.word);

  // --- Interior/exterior evidence ----------------------------------------
  let extHits = 0;
  let intHits = 0;
  for (const c of canon) {
    if (EXTERIOR_SIGNALS.has(c.word)) extHits += 1;
    else if (INTERIOR_SIGNALS.has(c.word)) intHits += 1;
  }
  for (const t of tokenise(prose)) {
    if (EXTERIOR_SIGNALS.has(t)) extHits += 0.25;
    else if (INTERIOR_SIGNALS.has(t)) intHits += 0.25;
  }
  let exterior = !interior;
  // Strictly greater: "KITCHEN GARDEN" (1 ext, 1 int) must stay a kitchen,
  // while "OUTSIFR BY A TREE" (2 ext, 0 int) overrides its mistyped INT.
  if (extHits > 0 && extHits > intHits) exterior = true;
  else if (intHits > 0 && extHits === 0) exterior = false;

  // --- Score archetypes ----------------------------------------------------
  let bestKey = null;
  let bestScore = 0;
  let bestPhrase = 0;
  for (const [key, arch] of Object.entries(ARCHETYPES)) {
    let score = 0;
    let phraseLen = 0;
    for (const m of arch.match) {
      const parts = m.split(' ');
      if (parts.length > 1) {
        // Multi-word keywords must appear as a contiguous token run.
        for (let i = 0; i + parts.length <= words.length; i++) {
          if (parts.every((p, j) => words[i + j] === p)) {
            score += 3 * parts.length;
            phraseLen = Math.max(phraseLen, parts.length);
            break;
          }
        }
      } else {
        // Exact token match beats one that needed typo repair.
        let gain = 0;
        for (let i = 0; i < words.length && gain < 2; i++) {
          if (words[i] === m) gain = canon[i].repaired ? Math.max(gain, 1) : 2;
        }
        score += gain;
      }
    }
    if (!score) continue;
    // Soft penalty rather than a hard filter: an unambiguous name still wins
    // even when the resolved side disagrees ("INT. THE KITCHEN GARDEN").
    if (!!arch.exterior !== exterior) score *= 0.25;
    if (score > bestScore || (score === bestScore && phraseLen > bestPhrase)) {
      bestKey = key;
      bestScore = score;
      bestPhrase = phraseLen;
    }
  }
  if (bestKey) return { key: bestKey, ...ARCHETYPES[bestKey] };

  // No keyword at all: a neutral green field is the honest outdoor default —
  // the old `village` fallback put cobbles and a well under every stray tree.
  const fallback = exterior ? 'field' : 'cottage';
  return { key: fallback, ...ARCHETYPES[fallback] };
}

// ---------------------------------------------------------------------------
// Lighting moods
// ---------------------------------------------------------------------------

/**
 * Time-of-day lighting. Key/fill/rim is the workhorse three-point setup;
 * the rim is what stops characters merging into the background.
 */
const MOODS = {
  NIGHT: {
    key: { colour: '#ffd0a0', intensity: 0.95, dir: [-3, 5, 4] },
    fill: { colour: '#5a7aae', intensity: 0.55, dir: [4, 3, 2] },
    rim: { colour: '#a8c4f0', intensity: 1.9, dir: [1, 4, -6] },
    ambient: { colour: '#3a4668', intensity: 0.80 },
    background: '#0d1220', fog: [0.016, '#0d1220'], exposure: 1.35,
  },
  DAY: {
    key: { colour: '#fff2dc', intensity: 2.5, dir: [-4, 7, 5] },
    fill: { colour: '#a8c8f0', intensity: 0.65, dir: [5, 3, 2] },
    rim: { colour: '#ffffff', intensity: 1.1, dir: [2, 5, -6] },
    ambient: { colour: '#93aacb', intensity: 0.75 },
    background: '#9fc0dd', fog: [0.006, '#b8cfe4'], exposure: 1.0,
  },
  DUSK: {
    key: { colour: '#ff9f5e', intensity: 1.7, dir: [-6, 2.4, 3] },
    fill: { colour: '#6a7eb8', intensity: 0.62, dir: [4, 3, 2] },
    rim: { colour: '#ffb27a', intensity: 1.9, dir: [-5, 2, -5] },
    ambient: { colour: '#5a5480', intensity: 0.72 },
    background: '#2e2740', fog: [0.012, '#3a2f42'], exposure: 1.08,
  },
  DAWN: {
    key: { colour: '#ffd9c0', intensity: 1.9, dir: [5, 2.6, 4] },
    fill: { colour: '#8aa4d8', intensity: 0.75, dir: [-4, 3, 2] },
    rim: { colour: '#ffc9a8', intensity: 1.8, dir: [3, 3, -6] },
    ambient: { colour: '#6a7090', intensity: 0.90 },
    background: '#3c4562', fog: [0.010, '#4a5170'], exposure: 1.05,
  },
  STORM: {
    key: { colour: '#c8d4e8', intensity: 0.85, dir: [-3, 6, 4] },
    fill: { colour: '#5a6478', intensity: 0.40, dir: [4, 3, 2] },
    rim: { colour: '#dce6f8', intensity: 1.2, dir: [1, 4, -6] },
    ambient: { colour: '#3a4252', intensity: 0.48 },
    background: '#1e242e', fog: [0.018, '#242b36'], exposure: 1.10,
  },
};

function moodFor(timeOfDay, interior) {
  const t = String(timeOfDay).toUpperCase();
  let key = 'DAY';
  if (/NIGHT|MIDNIGHT|LATE/.test(t)) key = 'NIGHT';
  else if (/DUSK|EVENING|SUNSET|TWILIGHT/.test(t)) key = 'DUSK';
  else if (/DAWN|MORNING|SUNRISE/.test(t)) key = 'DAWN';
  else if (/STORM|RAIN|THUNDER/.test(t)) key = 'STORM';
  const mood = JSON.parse(JSON.stringify(MOODS[key]));
  if (interior) {
    // Interiors get less sky and more bounce, so practicals can carry the scene.
    // Interiors lose the sky but gain bounce, and practicals carry the room.
    mood.key.intensity *= 0.80;
    mood.fill.intensity *= 0.95;
    mood.ambient.intensity *= 1.15;
    mood.fog = null;
  }
  mood.name = key;
  return mood;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Placement slots keep the centre of the room clear so blocking has somewhere
 * to live, and keep the +Z wall free because that's where cameras sit.
 */
function placementPosition(kind, arch, index, count, size, rng) {
  const [W, H, D] = arch.size;
  const hw = W / 2;
  const hd = D / 2;
  const [pw, ph, pd] = size;
  const spread = (i, n, span) => (n <= 1 ? 0 : (i / (n - 1) - 0.5) * span);

  switch (kind) {
    case 'wall-back':
      return { pos: [spread(index, count, W * 0.5), 0, -hd + pd / 2 + 0.06], rot: 0 };
    case 'wall-left':
      return { pos: [-hw + pd / 2 + 0.06, 0, spread(index, count, D * 0.45) - 0.4], rot: Math.PI / 2 };
    case 'wall-right':
      return { pos: [hw - pd / 2 - 0.06, 0, spread(index, count, D * 0.45) - 0.4], rot: -Math.PI / 2 };
    case 'wall-hang':
      return { pos: [spread(index, count, W * 0.55), 1.65, -hd + 0.09], rot: 0, wall: true };
    case 'wall-hang-right':
      return { pos: [hw - 0.10, 1.55, spread(index, count, D * 0.3) - 0.3], rot: -Math.PI / 2, wall: true };
    case 'floor-centre':
      return { pos: [0, 0, -0.2], rot: 0 };
    case 'floor-flank': {
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      return {
        pos: [side * (1.5 + row * 0.75), 0, -0.25 + row * 0.5],
        rot: side * -0.9 + (rng() - 0.5) * 0.2,
      };
    }
    case 'floor-side': {
      const side = index % 2 === 0 ? 1 : -1;
      return { pos: [side * (hw - 1.35), 0, 0.55 - index * 0.35], rot: side * -0.6 };
    }
    case 'floor-corner': {
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      const [cx, cz] = corners[index % 4];
      const ring = Math.floor(index / 4) * 0.55;
      return {
        pos: [cx * (hw - 0.55 - ring), 0, cz * (hd - 0.55 - ring)],
        rot: rng() * Math.PI * 2,
      };
    }
    case 'ceiling':
      return { pos: [spread(index, count, W * 0.4), H - 0.75, -0.3], rot: 0 };
    case 'scatter': {
      // Poisson-ish ring scatter that avoids the acting area.
      const a = (index / count) * Math.PI * 2 + rng() * 0.6;
      const r = 5.5 + rng() * (Math.min(W, D) / 2 - 6.5);
      return { pos: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: rng() * Math.PI * 2 };
    }
    case 'rows': {
      // A jittered grid: rows are what make planting read as cultivated
      // rather than wild woodland.
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      let x = (cols <= 1 ? 0 : (index % cols) / (cols - 1) - 0.5) * W * 0.62 + (rng() - 0.5) * 0.5;
      let z = (rows <= 1 ? 0 : Math.floor(index / cols) / (rows - 1) - 0.5) * D * 0.62 + (rng() - 0.5) * 0.5;
      // Keep the acting area clear, but push intruders outward along their own
      // radius instead of dropping them — the row count stays honest.
      const r = Math.hypot(x, z);
      if (r < 4.5) {
        if (r < 1e-3) { x = 4.5; z = 0; } else { x *= 4.5 / r; z *= 4.5 / r; }
      }
      return { pos: [x, 0, z], rot: rng() * Math.PI * 2 };
    }
    case 'perimeter': {
      // Panels are built along local +X; align each with the ring's tangent
      // so the run faces inward.
      const a = (index / count) * Math.PI * 2;
      return {
        pos: [Math.cos(a) * (W / 2 - 0.6), 0, Math.sin(a) * (D / 2 - 0.6)],
        rot: -a - Math.PI / 2,
      };
    }
    default:
      return { pos: [0, 0, 0], rot: 0 };
  }
}

/** Deterministic RNG so a given scene always dresses identically. */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function surfaceMaterial(kind, colour, repeat) {
  let map;
  if (kind === 'plank') map = plankTexture(colour);
  else if (kind === 'stone') map = stoneTexture();
  else if (kind === 'grass') map = grassTexture();
  else if (kind === 'cobble') map = cobbleTexture();
  else map = plasterTexture(colour);

  const m = map.clone();
  m.needsUpdate = true;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  m.repeat.set(repeat[0], repeat[1]);
  return new THREE.MeshStandardMaterial({
    map: m,
    color: new THREE.Color(colour).lerp(new THREE.Color('#ffffff'), 0.35),
    roughness: kind === 'stone' ? 0.95 : 0.82,
    metalness: 0,
    side: THREE.BackSide,
  });
}

/**
 * Build a dressed, lit stage for a parsed scene.
 * @param {object} scene from parseScript
 * @param {object} [options] `{ extraProps: string[] }`
 * @returns {THREE.Group} with userData: { arch, mood, lights, marks, animated }
 */
export function buildStage(scene, options = {}) {
  // Action/lyric prose reinforces the interior/exterior call — "under the
  // branches" is evidence even when the heading itself is mistyped.
  const prose = (scene.beats || [])
    .filter((b) => b.type === 'action' || b.type === 'lyric')
    .map((b) => b.text || '')
    .join(' ');
  const arch = chooseArchetype(scene.location, scene.interior, { prose });
  const mood = moodFor(scene.timeOfDay, !arch.exterior);
  const rng = makeRng(hash(scene.heading || scene.location || 'stage'));
  const group = new THREE.Group();
  group.name = `stage:${scene.location}`;
  const animated = [];
  const [W, H, D] = arch.size;

  // --- Shell --------------------------------------------------------------
  if (arch.exterior) {
    const groundMat = surfaceMaterial(arch.ground, arch.ground === 'grass' ? '#4a6238' : '#5e564c', [W / 3, D / 3]);
    groundMat.side = THREE.FrontSide;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);
  } else {
    const wallMat = surfaceMaterial(arch.wall, arch.wallColour, [W / 2.4, H / 2.4]);
    const wallMatSide = surfaceMaterial(arch.wall, arch.wallColour, [D / 2.4, H / 2.4]);
    const floorMat = surfaceMaterial(arch.floor, arch.floorColour, [W / 1.6, D / 1.6]);
    const ceilMat = surfaceMaterial('plaster', '#6a6058', [W / 3, D / 3]);

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, D),
      [wallMatSide, wallMatSide, ceilMat, floorMat, wallMat, wallMat],
    );
    shell.position.y = H / 2;
    shell.receiveShadow = true;
    group.add(shell);

    // Skirting and picture rail give the walls a sense of scale.
    const trim = woodMaterial('#3a2a1c', 0.7);
    const addTrim = (w, h, d, x, y, z) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trim);
      t.position.set(x, y, z);
      t.receiveShadow = true;
      group.add(t);
    };
    addTrim(W, 0.14, 0.05, 0, 0.07, -D / 2 + 0.03);
    addTrim(0.05, 0.14, D, -W / 2 + 0.03, 0.07, 0);
    addTrim(0.05, 0.14, D, W / 2 - 0.03, 0.07, 0);
    addTrim(W, 0.06, 0.04, 0, H - 0.55, -D / 2 + 0.03);

    if (arch.drapes) {
      const drapeMat = new THREE.MeshStandardMaterial({ color: '#5a1420', roughness: 0.95, side: THREE.DoubleSide });
      for (const s of [-1, 1]) {
        const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, H, 12, 1, true, 0, Math.PI), drapeMat);
        drape.position.set(s * (W / 2 - 0.7), H / 2, D / 2 - 1.2);
        drape.rotation.y = s > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
        group.add(drape);
      }
    }
  }

  // --- Dressing -----------------------------------------------------------
  const surfaces = [];
  const placed = [];
  const requested = [...(arch.dressing || [])];

  // Props the script explicitly calls for get added if not already present.
  for (const name of options.extraProps || []) {
    if (!requested.some(([n]) => n === name)) {
      requested.push([name, arch.exterior ? 'scatter' : 'floor-side', 1]);
    }
  }

  for (const [name, kind, count, opts] of requested) {
    for (let i = 0; i < count; i++) {
      if (kind === 'on-surface') continue; // handled after surfaces exist
      const def = createProp(name, opts || {});
      if (!def) continue;
      const { pos, rot } = placementPosition(kind, arch, i, count, def.userData.size, rng);
      def.position.set(pos[0], pos[1], pos[2]);
      def.rotation.y = rot;
      if (def.userData.ceilingMounted) def.position.y = H - 0.75;
      group.add(def);
      placed.push(def);
      if (def.userData.update) animated.push(def);
      if (def.userData.surfaceHeight) {
        surfaces.push({ object: def, height: def.userData.surfaceHeight });
      }
      if (name === 'grandfatherClock') group.userData.clock = def;
    }
  }

  // Tabletop dressing, now that tables exist.
  for (const [name, kind, count, opts] of requested) {
    if (kind !== 'on-surface') continue;
    for (let i = 0; i < count; i++) {
      const def = createProp(name, opts || {});
      if (!def) continue;
      const surface = surfaces[i % Math.max(1, surfaces.length)];
      if (surface) {
        const spread = surfaces.length ? 0.28 : 0;
        def.position.set(
          surface.object.position.x + (rng() - 0.5) * spread * 2,
          surface.height,
          surface.object.position.z + (rng() - 0.5) * spread,
        );
      } else {
        def.position.set((rng() - 0.5) * 2, 0.76, -1.2);
      }
      def.rotation.y = rng() * Math.PI * 2;
      group.add(def);
      placed.push(def);
      if (def.userData.update) animated.push(def);
      if (name === 'oilLamp') group.userData.oilLamp = def;
    }
  }

  // --- Lighting -----------------------------------------------------------
  const lights = new THREE.Group();
  const mk = (cfg, shadow) => {
    const l = new THREE.DirectionalLight(cfg.colour, cfg.intensity);
    l.position.set(cfg.dir[0], cfg.dir[1], cfg.dir[2]).multiplyScalar(1.6);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      const span = Math.max(W, D) * 0.62;
      l.shadow.camera.left = -span;
      l.shadow.camera.right = span;
      l.shadow.camera.top = span;
      l.shadow.camera.bottom = -span;
      l.shadow.camera.near = 0.5;
      l.shadow.camera.far = 40;
      l.shadow.bias = -0.0016;
      l.shadow.normalBias = 0.022;
    }
    return l;
  };
  const key = mk(mood.key, true);
  lights.add(key, mk(mood.fill, false), mk(mood.rim, false));
  lights.add(new THREE.HemisphereLight(mood.ambient.colour, '#1a1410', mood.ambient.intensity));
  group.add(lights);

  // --- Blocking marks -----------------------------------------------------
  // A shallow arc facing +Z (camera side) — the theatrical default, and it
  // keeps faces toward the lens without anyone masking anyone else.
  const marks = [];
  const markCount = 7;
  for (let i = 0; i < markCount; i++) {
    const t = markCount === 1 ? 0.5 : i / (markCount - 1);
    const a = (t - 0.5) * Math.PI * 0.62;
    const r = arch.exterior ? 2.6 : Math.min(W, D) * 0.22 + 0.9;
    // Characters are modelled facing +Z, and cameras live downstage at +Z, so
    // a facing near 0 keeps faces toward the lens; the small counter-rotation
    // angles each mark back toward centre.
    marks.push({
      position: new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r * 0.55 - 0.5),
      facing: -a * 0.4,
    });
  }

  group.userData = {
    ...group.userData,
    arch,
    mood,
    lights,
    marks,
    animated,
    props: placed,
    surfaces,
    bounds: { width: W, height: H, depth: D, exterior: !!arch.exterior },
  };
  return group;
}

// ---------------------------------------------------------------------------
// Explicit stages (scene files)
// ---------------------------------------------------------------------------

const GROUND_COLOUR = {
  grass: '#4a6238', dirt: '#6a5238', cobble: '#5e564c',
  stone: '#6e675c', plank: '#6b4a2c',
};

/**
 * Build a stage from an explicit layout rather than from a scene heading.
 *
 * The archetype path guesses a room from prose; this one is told. Both produce
 * the same userData contract so the camera, blocking and note systems cannot
 * tell them apart - which is the point: an authored scene and an inferred one
 * are the same kind of thing downstream.
 *
 * @param {object} env normalised `scene.environment`
 * @returns {THREE.Group}
 */
export function buildExplicitStage(env) {
  const group = new THREE.Group();
  group.name = `stage:${env.preset || 'custom'}`;
  const animated = [];
  const placed = [];
  const byId = new Map();
  const [W, D] = env.size || [30, 30];
  const mood = moodFor(env.mood || 'DAY', false);
  if (env.fog !== undefined) {
    mood.fog = env.fog > 0 ? [env.fog, mood.fog ? mood.fog[1] : mood.background] : null;
  }

  const kind = env.ground || 'grass';
  const groundMat = surfaceMaterial(kind, GROUND_COLOUR[kind] || '#4a6238', [W / 3, D / 3]);
  groundMat.side = THREE.FrontSide;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  for (const p of env.props || []) {
    const obj = createProp(p.type, p.options || {});
    if (!obj) continue;
    obj.position.set(p.at[0], p.at[1], p.at[2]);
    obj.rotation.y = p.rot || 0;
    if (p.scale && p.scale !== 1) obj.scale.setScalar(p.scale);
    // Hovering props keep their own idea of "home" so their bob is relative to
    // where the director put them, not to the ground.
    obj.userData.setHoverHeight?.(p.at[1]);
    obj.userData.sceneId = p.id;
    group.add(obj);
    placed.push(obj);
    byId.set(p.id, obj);
    if (obj.userData.update) animated.push(obj);
  }

  const lights = new THREE.Group();
  const mk = (cfg, shadow) => {
    const l = new THREE.DirectionalLight(cfg.colour, cfg.intensity);
    l.position.set(cfg.dir[0], cfg.dir[1], cfg.dir[2]).multiplyScalar(1.6);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      const span = Math.max(W, D) * 0.45;
      l.shadow.camera.left = -span;
      l.shadow.camera.right = span;
      l.shadow.camera.top = span;
      l.shadow.camera.bottom = -span;
      l.shadow.camera.near = 0.5;
      l.shadow.camera.far = 90;
      l.shadow.bias = -0.0016;
      l.shadow.normalBias = 0.022;
    }
    return l;
  };
  lights.add(mk(mood.key, true), mk(mood.fill, false), mk(mood.rim, false));
  lights.add(new THREE.HemisphereLight(mood.ambient.colour, '#1a1410', mood.ambient.intensity));
  group.add(lights);

  // A shallow downstage arc, used only if something asks for a mark the scene
  // file did not supply.
  const marks = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const a = (t - 0.5) * Math.PI * 0.62;
    marks.push({ position: new THREE.Vector3(Math.sin(a) * 3.0, 0, Math.cos(a) * 1.8 - 0.5), facing: -a * 0.4 });
  }

  group.userData = {
    arch: { key: env.preset || 'custom', exterior: true },
    mood,
    lights,
    marks,
    animated,
    props: placed,
    byId,
    surfaces: [],
    bounds: { width: W, height: 24, depth: D, exterior: true },
    explicit: true,
  };
  return group;
}

/** Scan a scene's heading and prose for props the archetype didn't provide. */
export function propsForScene(scene) {
  const found = new Set();
  // The heading counts too — "BY A TREE" is a request for a tree even when no
  // action line repeats the word.
  propsMentioned(scene.heading || scene.location || '').forEach((p) => found.add(p));
  for (const beat of scene.beats) {
    if (beat.type !== 'action' && beat.type !== 'lyric') continue;
    propsMentioned(beat.text || '').forEach((p) => found.add(p));
  }
  return [...found];
}

export { ARCHETYPES, MOODS, chooseArchetype, moodFor };
