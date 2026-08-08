/**
 * GENERATED FILE — do not edit. Run `node tools/vocabulary.mjs` to refresh.
 *
 * What each renderer can actually build, read out of the renderers themselves.
 * validateScene checks a scene file against this, and the LLM system prompt is
 * written from it, so neither can drift from what will really render.
 *
 * A name in BROWSER_* but not BLENDER_* previews and is missing from the film;
 * a name in BLENDER_* but not BROWSER_* renders and is missing from the
 * preview. Both are worth saying and neither is fatal.
 */

/** Scene-file prop types ph_assets can build (`make_<type>`). */
export const BLENDER_PROPS = [
  'tree', 'drone', 'ball', 'bucket', 'parasol', 'slab', 'rod', 'orb', 'crate', 'barrel', 'cup',
  'bottle', 'table', 'stool', 'chair', 'rug', 'portrait', 'window', 'door', 'bookshelf',
  'rifle',
];

/** Scene-file prop types the browser PROPS registry can build. */
export const BROWSER_PROPS = [
  'drone', 'rifle', 'oilLamp', 'grandfatherClock', 'candle', 'chandelier', 'fireplace',
  'chair', 'stool', 'armchair', 'table', 'roundTable', 'bed', 'bookshelf', 'wardrobe', 'trunk',
  'barrel', 'crate', 'rug', 'portrait', 'window', 'door', 'cup', 'bottle', 'tree', 'well',
  'apple', 'basket', 'fence', 'lantern',
];

/** Poses ph_assets.POSES can strike. */
export const BLENDER_POSES = [
  'idle', 'idleAlt', 'listen', 'talk', 'talkBoth', 'sing', 'singBig', 'point', 'cast',
  'castOne', 'reach', 'afraid', 'angry', 'tender', 'resolute', 'sad', 'joyful', 'wonder',
  'run', 'handsUp', 'aim', 'flinch', 'bow', 'kneel', 'sit',
];

/** Poses anim.js POSES can strike. */
export const BROWSER_POSES = [
  'idle', 'idleAlt', 'listen', 'talk', 'talkBoth', 'sing', 'singBig', 'point', 'cast',
  'castOne', 'reach', 'afraid', 'angry', 'tender', 'resolute', 'sad', 'joyful', 'wonder',
  'run', 'handsUp', 'aim', 'flinch', 'bow', 'kneel', 'sit',
];

/** vfx abilities, from ABILITY_DEFAULTS. */
export const ABILITIES = [
  'light', 'fire', 'frost', 'telekinesis', 'heal', 'teleport', 'shield', 'illusion', 'shadow',
  'wind',
];

/**
 * Per-type facts from the browser registry: `size` is [w, h, d] in metres,
 * `tags` say what a type is for — 'held'/'handheld' means it is built to be
 * carried, 'hero' means it holds up in close-up.
 */
export const PROP_META = {
  drone: { size: [0.55, 0.3, 0.55], category: 'vehicle', tags: ['air'] },
  rifle: { size: [0.1, 0.2, 0.7], category: 'handheld', tags: ['held'] },
  oilLamp: { size: [0.13, 0.37, 0.13], category: 'light', tags: ['table', 'hero'] },
  grandfatherClock: { size: [0.58, 2.2, 0.36], category: 'furniture', tags: ['wall', 'hero'] },
  candle: { size: [0.09, 0.24, 0.09], category: 'light', tags: ['table'] },
  chandelier: { size: [0.7, 0.7, 0.7], category: 'light', tags: ['ceiling'] },
  fireplace: { size: [2.1, 1.55, 0.5], category: 'light', tags: ['wall'] },
  chair: { size: [0.5, 1, 0.5], category: 'seat', tags: ['floor'] },
  stool: { size: [0.4, 0.48, 0.4], category: 'seat', tags: ['floor'] },
  armchair: { size: [0.78, 0.95, 0.74], category: 'seat', tags: ['floor'] },
  table: { size: [1.4, 0.8, 0.8], category: 'surface', tags: ['floor'] },
  roundTable: { size: [0.95, 0.8, 0.95], category: 'surface', tags: ['floor'] },
  bed: { size: [1.5, 1.1, 2.1], category: 'furniture', tags: ['wall'] },
  bookshelf: { size: [1, 1.95, 0.32], category: 'furniture', tags: ['wall'] },
  wardrobe: { size: [1.2, 2.15, 0.6], category: 'furniture', tags: ['wall'] },
  trunk: { size: [0.9, 0.62, 0.5], category: 'furniture', tags: ['floor', 'wall'] },
  barrel: { size: [0.6, 0.82, 0.6], category: 'clutter', tags: ['floor'] },
  crate: { size: [0.54, 0.54, 0.54], category: 'clutter', tags: ['floor'] },
  rug: { size: [2.6, 0.01, 1.8], category: 'floor', tags: ['floor'] },
  portrait: { size: [0.62, 0.82, 0.06], category: 'decor', tags: ['wall'] },
  window: { size: [1.24, 1.58, 0.14], category: 'decor', tags: ['wall'] },
  door: { size: [1.06, 2.22, 0.12], category: 'structure', tags: ['wall'] },
  cup: { size: [0.08, 0.08, 0.08], category: 'clutter', tags: ['table'] },
  bottle: { size: [0.09, 0.29, 0.09], category: 'clutter', tags: ['table'] },
  tree: { size: [2.4, 4.2, 2.4], category: 'nature', tags: ['exterior'] },
  well: { size: [1.7, 2.1, 0.8], category: 'nature', tags: ['exterior'] },
  apple: { size: [0.08, 0.1, 0.08], category: 'clutter', tags: ['table', 'hero', 'handheld'] },
  basket: { size: [0.42, 0.42, 0.42], category: 'clutter', tags: ['floor', 'handheld'] },
  fence: { size: [2.4, 1.05, 0.12], category: 'structure', tags: ['exterior'] },
  lantern: { size: [0.12, 0.29, 0.12], category: 'light', tags: ['table', 'hero', 'handheld'] },
};
