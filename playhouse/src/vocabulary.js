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
  'drone', 'rifle', 'tree', 'ball', 'bucket', 'parasol', 'slab', 'rod', 'orb', 'oilLamp',
  'grandfatherClock', 'candle', 'chandelier', 'fireplace', 'chair', 'stool', 'armchair',
  'table', 'roundTable', 'bed', 'bookshelf', 'wardrobe', 'trunk', 'barrel', 'crate', 'rug',
  'portrait', 'window', 'door', 'cup', 'bottle', 'well', 'apple', 'basket', 'fence', 'lantern',
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
 * Per-type facts: `size` is [w, h, d] in metres, `tags` say what a type is for
 * — 'held'/'handheld' means it is built to be carried, 'hero' means it holds up
 * in close-up. Read from the browser registry, and from ph_assets.PROP_META for
 * the types only Blender builds.
 */
export const PROP_META = {
  drone: { size: [0.55, 0.3, 0.55], category: 'vehicle', tags: ['air'] },
  rifle: { size: [0.1, 0.2, 0.7], category: 'handheld', tags: ['held'] },
  tree: { size: [2.4, 4.2, 2.4], category: 'nature', tags: ['exterior'] },
  ball: { size: [0.34, 0.34, 0.34], category: 'clutter', tags: ['floor', 'exterior'] },
  bucket: { size: [0.23, 0.27, 0.23], category: 'clutter', tags: ['floor', 'exterior'] },
  parasol: { size: [1.91, 2.01, 1.91], category: 'structure', tags: ['floor', 'exterior'] },
  slab: { size: [0.3, 0.2, 0.04], category: 'clutter', tags: ['floor', 'handheld'] },
  rod: { size: [0.12, 0.25, 0.12], category: 'clutter', tags: ['floor', 'handheld'] },
  orb: { size: [0.24, 0.24, 0.24], category: 'clutter', tags: ['floor', 'handheld'] },
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
  well: { size: [1.7, 2.1, 0.8], category: 'nature', tags: ['exterior'] },
  apple: { size: [0.08, 0.1, 0.08], category: 'clutter', tags: ['table', 'hero', 'handheld'] },
  basket: { size: [0.42, 0.42, 0.42], category: 'clutter', tags: ['floor', 'handheld'] },
  fence: { size: [2.4, 1.05, 0.12], category: 'structure', tags: ['exterior'] },
  lantern: { size: [0.12, 0.29, 0.12], category: 'light', tags: ['table', 'hero', 'handheld'] },
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
export const UNMEASURED_PROPS = [];

/**
 * Natural words for a type, from the same table propsMentioned reads.
 *
 * A better repair suggestion than edit distance for the mistake that actually
 * happens, which is not a typo: a model asked for a prop writes the English
 * word. "gun" is five edits from "rifle" and nothing recovers it but this.
 */
export const PROP_SYNONYMS = {
  drone: ['drone', 'drones', 'quadcopter', 'uav'],
  rifle: ['rifle', 'rifles', 'gun', 'guns', 'weapon', 'weapons', 'carbine'],
  oilLamp: ['oil lamp', 'lamp', 'oil-lamp'],
  lantern: ['lantern', 'carry lantern', 'hand lantern'],
  grandfatherClock: ['grandfather clock', 'longcase clock', 'clock', 'grandfather'],
  candle: ['candle', 'candles', 'taper'],
  fireplace: ['fireplace', 'hearth', 'fire place', 'mantel', 'mantelpiece'],
  chair: ['chair', 'seat'],
  armchair: ['armchair', 'wing chair'],
  stool: ['stool'],
  table: ['table', 'desk', 'writing desk'],
  roundTable: ['round table', 'tea table'],
  bed: ['bed', 'bedstead'],
  bookshelf: ['bookshelf', 'bookcase', 'shelves', 'books'],
  wardrobe: ['wardrobe', 'armoire', 'cupboard'],
  trunk: ['trunk', 'chest'],
  barrel: ['barrel', 'cask'],
  crate: ['crate', 'box'],
  rug: ['rug', 'carpet'],
  portrait: ['portrait', 'painting', 'picture'],
  window: ['window', 'casement'],
  door: ['door', 'doorway'],
  cup: ['cup', 'teacup', 'mug'],
  bottle: ['bottle', 'flask', 'decanter'],
  tree: ['tree', 'trees', 'oak', 'birch', 'branches', 'boughs', 'orchard'],
  ball: ['ball', 'balls', 'beachball', 'beach ball', 'football'],
  bucket: ['bucket', 'buckets', 'pail', 'pails', 'sandcastle bucket'],
  parasol: ['parasol', 'parasols', 'umbrella', 'umbrellas', 'sunshade', 'beach umbrella'],
  well: ['well'],
  chandelier: ['chandelier'],
  apple: ['apple', 'apples'],
  basket: ['basket', 'hamper'],
  fence: ['fence', 'gate', 'stile'],
  slab: ['slab', 'board', 'plank', 'panel', 'headstone'],
  rod: ['rod', 'post', 'pole', 'bollard'],
  orb: ['orb', 'boulder'],
};

// ---------------------------------------------------------------------------
// Grammar — the shape of the format, not just its names
// ---------------------------------------------------------------------------

/** The whole of `options`, from the Blender builders' own signatures. */
export const OPTION_KEYS = ['colour', 'size'];

/**
 * Which types actually honour each option, per renderer.
 *
 * Read from ph_assets' `inspect.signature` and from the browser registry's own
 * `options` list, because those are the two things that really decide it. An
 * option in `blender` and not `browser` is honoured in the film and dropped in
 * the preview, which is the one thing a director must be told before they spend
 * a session tuning a colour half the pipeline never shows them.
 */
export const OPTION_SUPPORT = {
  colour: {
    blender: [
      'slab', 'rod', 'orb', 'crate', 'barrel', 'cup', 'bottle', 'table', 'stool', 'chair',
      'rug', 'portrait', 'window', 'door', 'bookshelf',
    ],
    browser: [
      'slab', 'rod', 'orb', 'oilLamp', 'grandfatherClock', 'candle', 'chandelier',
      'fireplace', 'chair', 'stool', 'armchair', 'table', 'roundTable', 'bed', 'bookshelf',
      'wardrobe', 'trunk', 'barrel', 'crate', 'rug', 'portrait', 'window', 'door', 'cup',
      'bottle', 'well', 'apple', 'basket', 'fence', 'lantern',
    ],
  },
  size: { blender: ['slab', 'rod', 'orb'], browser: ['slab', 'rod', 'orb'] },
};

/**
 * Types with an authored grip, per renderer: where a hand actually goes.
 *
 * Not the same as the 'held'/'handheld' tags, which say what a type is *for*.
 * Anything else is parented to the hand at its own origin.
 */
export const HOLDABLE = {
  blender: ['slab', 'rod', 'orb', 'cup', 'bottle', 'rifle'],
  browser: ['slab', 'rod', 'orb', 'apple', 'basket', 'lantern'],
};

/** Units and axes: declared, and pinned to the source lines that make them true. */
export const CONVENTIONS = {
  distance: 'metres',
  angle: 'radians',
  time: 'seconds; shot durations are authored and start times are derived',
  axes: 'three.js world space: y is up, the ground is the x/z plane',
  groundPoint: 'a two-element [x, z] is accepted wherever a point is; the missing component is the ground',
  size: '[width, height, depth] in metres, height on y',
  heading: '0 faces +z, and the angle increases toward +x',
  blender: 'the Blender renderer is z-up and converts on the way in; a scene file never uses Blender axes',
};

/** What each field type in the grammar means, in the words a prompt should use. */
export const FIELD_TYPES = {
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
  pose: 'one of idle, idleAlt, listen, talk, talkBoth, sing, singBig, point, cast, castOne, reach, afraid, angry, tender, resolute, sad, joyful, wonder, run, handsUp, aim, flinch, bow, kneel, sit',
  ability: 'one of light, fire, frost, telekinesis, heal, teleport, shield, illusion, shadow, wind',
  hand: '"L" or "R"',
  side: '1 or -1: which side of the line of action to shoot from',
  shotSize: 'one of ECU, CU, MCU, MS, MWS, WS, EWS',
  move: 'one of static, push, pull, dolly, crane, handheld, orbit, track',
  height: 'one of low, eye, high',
  mood: 'one of NIGHT, DAY, DUSK, DAWN, STORM',
  groundKind: 'one of grass, dirt, cobble, stone, plank, sand',
  fade: '"in" or "out"',
  options: 'build options: colour, size',
  propList: 'an array of environment.props entries',
  camera: 'a camera block',
  actionList: 'an array of actions',
  caption: 'a caption block',
  spec: 'an object of appearance fields for the character builder',
  text: 'a string',
  flag: 'true or false',
  number: 'a number',
};

/**
 * The shape of every node in the format.
 *
 * `required` must be present; `optional` may be; `oneOf.fields` is a group at
 * least one of which has to be present, at `oneOf.level`; `needs` records a
 * field that only means anything alongside another; `only` records a field one
 * renderer reads and the other does not. Every line of it is put to
 * validateScene by the generator, so it cannot describe a format the validator
 * does not enforce.
 */
export const SCENE_GRAMMAR = {
  environment: {
    what: 'the set: its ground, its weather, and everything standing on it',
    required: {},
    optional: {
      preset: 'text',
      ground: 'groundKind',
      size: 'extent',
      mood: 'mood',
      fog: 'number',
      sky: 'text',
      props: 'propList',
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
      id: 'name',
      camera: 'camera',
      actions: 'actionList',
      caption: 'caption',
      fade: 'fade',
      note: 'text',
    },
  },
  camera: {
    what: 'where the lens goes and what it is on',
    required: {},
    optional: {
      size: 'shotSize',
      subject: 'id',
      secondary: 'id',
      move: 'move',
      height: 'height',
      side: 'side',
      ots: 'flag',
      at: 'point',
      lookAt: 'point',
      lens: 'lens',
    },
    needs: { ots: ['secondary'] },
    only: { lens: 'read by the Blender render only; the browser preview ignores it' },
  },
  caption: {
    what: 'the line printed under the shot',
    required: { text: 'text' },
    optional: { speaker: 'castId' },
    only: {
      text: 'drawn over the browser preview only; the Blender render carries it in the manifest but burns no text into the image',
      speaker: 'drawn over the browser preview only; the Blender render carries it in the manifest but burns no text into the image',
    },
  },
};

/** The same, per action verb, in the order VERBS declares them. */
export const ACTION_GRAMMAR = {
  move: {
    what: 'walk or run to a position',
    required: { actor: 'castId', to: 'point' },
    optional: { speed: 'speed', facing: 'radians', pose: 'pose' },
  },
  pose: { what: 'adopt a named pose', required: { actor: 'castId', pose: 'pose' }, optional: {} },
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
    only: { '*': 'plays in the browser preview only; the Blender render has no effect system' },
  },
  prop: {
    what: 'move, lift or turn a placed prop',
    required: { actor: 'propId' },
    oneOf: { fields: { to: 'point', hover: 'metres', rot: 'radians' }, level: 'warning' },
    optional: {},
  },
};
