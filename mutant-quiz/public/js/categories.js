/* categories.js — the hidden scoring axes.
 * Everything in this file is data. No LLM ever decides these values;
 * it only ever reads the totals the engine produces.
 */

var CATEGORIES = [
  {
    key: 'psychic',
    name: 'Psychic',
    short: 'PSI',
    blurb: 'Telepathy, empathy, telekinesis, precognition, illusion.',
    traits: 'introverted, analytical, deeply empathetic'
  },
  {
    key: 'time',
    name: 'Temporal',
    short: 'TMP',
    blurb: 'Time dilation, super-speed, foresight, loops, teleportation.',
    traits: 'impatient, urgent, anxious about timing'
  },
  {
    key: 'elemental',
    name: 'Elemental',
    short: 'ELM',
    blurb: 'Fire, water, earth, air, storm, sound, growth, magnetism.',
    traits: 'passionate, attuned to place and weather'
  },
  {
    key: 'beastial',
    name: 'Beastial',
    short: 'BST',
    blurb: 'Animal instinct, strength, speed, senses, regeneration, ferocity.',
    traits: 'impulsive, physical, survival-oriented'
  },
  {
    key: 'bio',
    name: 'Biological',
    short: 'BIO',
    blurb: 'Shapeshifting, durability, size, regrowth, self-alteration.',
    traits: 'adaptive, self-transforming, malleable self-image'
  },
  {
    key: 'energy',
    name: 'Energy',
    short: 'NRG',
    blurb: 'Projection, light, radiation, kinetic force, spectacle.',
    traits: 'expressive, charismatic, performative'
  },
  {
    key: 'luck',
    name: 'Probability',
    short: 'LCK',
    blurb: 'Fortune, misfortune fields, improbable outcomes.',
    traits: 'risk-taker, gambler, spontaneous'
  },
  {
    key: 'tech',
    name: 'Technological',
    short: 'TEC',
    blurb: 'Technopathy, invention, augmentation, systems.',
    traits: 'inventive, analytical, methodical'
  },
  {
    key: 'esoteric',
    name: 'Esoteric',
    short: 'ESO',
    blurb: 'Astral projection, chi, spirit, venom, the uncanny.',
    traits: 'private, dissociative, drawn to the strange'
  },
  {
    key: 'reality',
    name: 'Reality',
    short: 'RLT',
    blurb: 'Rewriting what is true. Gated — requires overwhelming alignment.',
    traits: 'unbound, regretful, hungry for a different world'
  }
];

/* Elemental sub-affinities. These never produce a category on their own —
 * they only decide what flavour an Elemental result takes. */
var ELEMENTS = [
  { key: 'fire',  name: 'Fire' },
  { key: 'water', name: 'Water' },
  { key: 'earth', name: 'Earth' },
  { key: 'air',   name: 'Air' },
  { key: 'sound', name: 'Sound' },
  { key: 'storm', name: 'Storm' },
  { key: 'plant', name: 'Growth' },
  { key: 'metal', name: 'Metal' }
];

var CATEGORY_KEYS = CATEGORIES.map(function (c) { return c.key; });
var ELEMENT_KEYS = ELEMENTS.map(function (e) { return e.key; });

var CATEGORY_BY_KEY = {};
CATEGORIES.forEach(function (c) { CATEGORY_BY_KEY[c.key] = c; });

var ELEMENT_BY_KEY = {};
ELEMENTS.forEach(function (e) { ELEMENT_BY_KEY[e.key] = e; });

/* Tuning constants. Changing these changes outcomes globally. */
var TUNING = {
  /* Reality is only allowed to participate in a fusion once it clears this. */
  REALITY_GATE: 8,

  /* Tier is read from STRENGTH, not from raw points.
   *
   * strength = your top category score ÷ the most that category could possibly
   * score across all sixty questions.
   *
   * Raw totals are useless here: every completed quiz banks roughly the same
   * number of points, so a player answering at random out-scores a focused
   * player who left half the quiz blank. Normalising against the achievable
   * maximum makes categories comparable to each other, and makes an unfinished
   * or scattered quiz read as the weak manifestation it is.
   *
   * Thresholds are set from test/calibrate.js, which sweeps simulated players
   * from perfectly self-serving down to pure noise. A *completed* quiz answered
   * at random floors at ~0.34, so that is where Delta starts and the ladder is
   * spread across the band above it. Epsilon is therefore not a judgement on
   * the person — it means the sequence was left unfinished. */
  TIERS: [
    { key: 'alpha',   name: 'Alpha',   min: 0.80 },
    { key: 'beta',    name: 'Beta',    min: 0.62 },
    { key: 'gamma',   name: 'Gamma',   min: 0.48 },
    { key: 'delta',   name: 'Delta',   min: 0.34 },
    { key: 'epsilon', name: 'Epsilon', min: -999 }
  ],
  /* Omega additionally needs the reality gate open and Alpha-grade focus. */
  OMEGA_STRENGTH: 0.80,
  /* Hard ceiling on what a single free-text answer may contribute. */
  OTHER_MAX_PER_CATEGORY: 2,
  OTHER_MAX_CATEGORIES: 3,
  OTHER_MAX_TOTAL_MAGNITUDE: 4
};

var TIER_NOTES = {
  omega:   'No defined upper limit. Vanishingly rare; the quiz gates hard against this.',
  alpha:   'Front-rank. A defining, world-relevant ability with a real ceiling.',
  beta:    'Formidable and specialised. Wins fights it chooses.',
  gamma:   'Genuinely useful, tightly scoped. Situational by design.',
  delta:   'Subtle. Easy to underestimate, hard to weaponise.',
  epsilon: 'Barely manifested. The X-gene is awake but has not decided what it is.'
};
