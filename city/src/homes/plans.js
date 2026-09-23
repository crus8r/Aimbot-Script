// The preset houses. Coordinates are lot-local metres: x across the lot,
// z from the back fence (-14) to the pavement (+14); the street is at +z.
// Rooms are rectangles; walls, corners and faces come from house.js.
//
// items: [catalogId, x, z, facing, extra]. Facing is where the item's front
// points: S toward the street, N toward the back, E and W along the street.
// Wall items name their wall's inside face; surface items stand on whatever
// is under them (items.js finds the table).

const S = 0, E = Math.PI / 2, N = Math.PI, W = -Math.PI / 2;
const row = (id, xs, z, f) => xs.map((x) => [id, x, z, f]);

export const LOT = { w: 26, d: 28 };

export const PLANS = {
  cottage: {
    name: 'Starter Cottage',
    blurb: 'Two rooms, a porch and a big back yard. Room to grow.',
    exterior: 'sidingBlue', roof: 'cedar', pitch: 0.55,
    rooms: [
      { id: 'living', name: 'Living Room', rect: [-5, 1.5, 1, 6], floor: 'walnut', wall: 'sage' },
      { id: 'kitchen', name: 'Kitchen', rect: [-5, -2, 1, 1.5], floor: 'terracotta', wall: 'butter' },
      { id: 'bedroom', name: 'Bedroom', rect: [1, 1.5, 5, 6], floor: 'carpetRose', wall: 'blush' },
      { id: 'bath', name: 'Bathroom', rect: [1, -2, 5, 1.5], floor: 'white', wall: 'tile' },
    ],
    open: [['living', 'kitchen']],
    openings: [
      { kind: 'front', x: -2, z: 6, color: '#2f6b4f' },
      { x: -4, z: 6, w: 1.2 }, { x: 0, z: 6, w: 1.0 }, { x: 3, z: 6, w: 1.6 },
      { x: -5, z: 3.75, w: 1.2 }, { x: -5, z: -0.25, w: 1.0 },
      { x: -2.3, z: -2, w: 1.2 }, { x: 5, z: -0.25, w: 0.8, bottom: 1.3 },
      { kind: 'door', x: 1, z: 2.5 }, { kind: 'door', x: 1, z: 0.5, w: 0.8 },
      { kind: 'door', x: -4.2, z: -2 },
    ],
    yard: { path: [[-2.6, 6.1, -1.4, 14]], patio: [[-5.6, -4.2, -2.8, -2.1]] },
    spawn: [-2, 8.5],
    items: [
      // Living room
      ['tv', 0.69, 4.4, W], ['sofa_green', -3.4, 4.4, E], ['coffee_table', -2.1, 4.4, E], ['rug_sand', -2.1, 4.4, E],
      ['floor_lamp', -4.55, 5.55, S], ['plant', -4.55, 2.0, S], ['painting_4', -4.9, 5.1, E, { wall: true }],
      ['vase', -2.1, 4.4, S],
      // Kitchen
      ['kitchen_run', -0.32, -1.58, S], ['fridge', -3.3, -1.57, S], ['table_round', -2.6, 0.3, S],
      ['chair_wood', -3.35, 0.3, E], ['chair_wood', -1.85, 0.3, W], ['clock', -4.9, 0.8, E, { wall: true }],
      // Bedroom
      ['bed_double', 3.2, 2.64, S], ['nightstand', 4.55, 1.85, S], ['wardrobe', 1.4, 5.1, E], ['rug_purple', 3.0, 4.6, S],
      ['painting_1', 4.9, 4.7, W, { wall: true }],
      // Bathroom
      ['shower', 4.44, -1.44, S], ['toilet', 3.1, -1.62, S], ['basin', 4.71, 0.7, W],
      // Front yard
      ['flower_bed', -4, 6.5, S], ['flower_bed_blue', 0, 6.5, S], ['flower_bed', 3, 6.5, S],
      ['mailbox', -3.4, 13.3, S], ['tree_1', -9, 9.5, S], ['tree_2', 8.5, 10, S],
      ...row('fence', [-12, -10, -8, -6], 13.6, S), ...row('fence', [2, 4, 6, 8, 10, 12], 13.6, S),
      ['hedge_short', -4.5, 13.6, S], ['hedge_short', 0.5, 13.6, S],
      ['garden_lamp', -3.2, 10, S], ['garden_lamp', -0.8, 12.5, S],
      // Back yard
      ['picnic', 1, -7.5, S], ['grill', -3.5, -6.5, S], ['tree_0', 8, -8.5, S], ['tree_2', -9, -9, S],
      ['bench', 5, -5.5, N], ['flower_bed_blue', -9, -3, E],
      ...row('hedge', [-12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12], -13.4, S),
    ],
  },

  family: {
    name: 'Family House',
    blurb: 'Open-plan living and kitchen, three bedrooms, a pool out back.',
    exterior: 'sidingCream', roof: 'slate', pitch: 0.5,
    rooms: [
      { id: 'living', name: 'Living Room', rect: [-7, -0.5, 1, 6], floor: 'oak', wall: 'cream' },
      { id: 'kitchen', name: 'Kitchen', rect: [1, -0.5, 7, 6], floor: 'check', wall: 'butter' },
      { id: 'kids', name: 'Kids Room', rect: [-7, -5, -2.5, -0.5], floor: 'carpetBlue', wall: 'sky' },
      { id: 'bath', name: 'Bathroom', rect: [-2.5, -5, 0.5, -0.5], floor: 'white', wall: 'tile' },
      { id: 'master', name: 'Main Bedroom', rect: [0.5, -5, 7, -0.5], floor: 'ash', wall: 'sage' },
    ],
    open: [['living', 'kitchen']],
    openings: [
      { kind: 'front', x: -3, z: 6, color: '#7a2e2a' },
      { x: -5.6, z: 6, w: 1.6 }, { x: -0.6, z: 6, w: 1.6 }, { x: 4, z: 6, w: 2.0 },
      { x: -7, z: 2.75, w: 1.6 }, { x: 7, z: 3.5, w: 1.6 },
      { kind: 'door', x: 7, z: 1.2 },
      { kind: 'door', x: -3.3, z: -0.5 }, { kind: 'door', x: -1, z: -0.5, w: 0.8 }, { kind: 'door', x: 2.2, z: -0.5 },
      { x: -4.75, z: -5, w: 1.4 }, { x: -1, z: -5, w: 0.8, bottom: 1.3 }, { x: 5.9, z: -5, w: 1.4 },
      { x: -7, z: -2.75, w: 1.2 },
    ],
    yard: { path: [[-3.6, 6.1, -2.4, 14]], drive: [[8.2, 0, 12, 14]], patio: [[7.1, 0.3, 8.2, 2.1]] },
    spawn: [-3, 8.5],
    items: [
      // Living room
      ['tv', -5.5, -0.15, S], ['sofa_blue', -5.5, 3.3, N], ['coffee_table', -5.5, 1.9, S], ['rug_red', -5.5, 2.1, S],
      ['armchair', -3.2, 1.9, W], ['end_table', -3.95, 3.45, S], ['table_lamp', -3.95, 3.45, S],
      ['bookshelf', -6.72, 0.55, E], ['floor_lamp', -6.6, 4.4, S], ['plant_big', -6.55, 5.55, S],
      ['painting_1', -6.9, 4.9, E, { wall: true }], ['boombox', -5.1, 1.9, S],
      // Kitchen and dining
      ['kitchen_run', 5.7, -0.1, S], ['fridge', 3.95, -0.07, S], ['island', 4.8, 2.2, S],
      ['stool', 4.2, 2.95, N], ['stool', 4.8, 2.95, N], ['stool', 5.4, 2.95, N],
      ['table_dining', 2.6, 4.4, S], ['chair_red', 2.25, 3.65, S], ['chair_red', 2.95, 3.65, S], ['chair_red', 2.25, 5.15, N], ['chair_red', 2.95, 5.15, N],
      ['vase', 2.6, 4.4, S], ['plant', 6.5, 5.5, S], ['clock', 6.9, 5.1, W, { wall: true }],
      // Kids room
      ['bed_kids', -6.0, -3.96, S], ['nightstand', -5.0, -4.7, S], ['shelf_unit', -3.2, -4.75, S], ['rug_purple', -4.4, -2.5, S],
      ['plant_small', -3.0, -4.75, S], ['painting_4', -2.6, -2.6, W, { wall: true }], ['desk', -5.0, -1.0, N], ['office_chair', -5.0, -1.8, S],
      // Bathroom
      ['tub', -1.98, -4.05, S], ['toilet', -0.3, -4.6, S], ['basin', 0.21, -2.4, W],
      // Main bedroom
      ['bed_double', 3.6, -3.86, S], ['nightstand', 2.35, -4.7, S], ['nightstand', 4.85, -4.7, S],
      ['wardrobe', 6.6, -2.6, W], ['mirror', 0.66, -2.2, E], ['rug_sand', 3.6, -2.0, S], ['plant', 6.5, -1.0, S],
      ['painting_2', 3.6, -4.9, S, { wall: true }],
      // Front yard
      ['flower_bed', -5.6, 6.5, S], ['flower_bed_blue', -0.6, 6.5, S], ['flower_bed', 4.0, 6.5, S],
      ['mailbox', -4.3, 12.0, S], ['tree_0', -10, 9.5, S], ['tree_2', 4.5, 10.5, S],
      ...row('fence', [-12, -10, -8, -6], 13.6, S), ...row('fence', [0, 2, 4, 6], 13.6, S),
      ['hedge_short', -4.5, 13.6, S], ['hedge_short', -1.5, 13.6, S],
      ['garden_lamp', -2.2, 9, S], ['garden_lamp', -3.8, 12, S],
      // Back yard
      ['pool', -8.4, -9.5, E], ['lounger', -3.8, -9.8, S], ['lounger', -2.6, -9.8, S], ['umbrella', -3.2, -11.6, S],
      ['patio', 3, -8.5, S], ['patio', 5, -8.5, S], ['picnic', 4, -8.5, S], ['grill', 6.6, -6.2, W],
      ['tree_1', 10.5, -10.5, S], ['tree_2', -10.5, -2.5, S], ['flower_bed_blue', 3.8, -5.6, S],
      ...row('fence', [-12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12], -13.6, S),
      ['garden_lamp', 1.4, -6.5, S],
    ],
  },

  bungalow: {
    name: 'Beach Bungalow',
    blurb: 'Stucco, terracotta and palms, with a courtyard and a pool.',
    exterior: 'stuccoTeal', roof: 'terracotta', pitch: 0.42,
    rooms: [
      { id: 'great', name: 'Great Room', rect: [-7, 0.5, -1, 6.5], floor: 'ash', wall: 'white' },
      { id: 'kitchen', name: 'Kitchen', rect: [-1, 0.5, 2, 6.5], floor: 'sage', wall: 'white' },
      { id: 'master', name: 'Bedroom', rect: [2, 1.5, 7, 6.5], floor: 'oak', wall: 'sky' },
      { id: 'bath', name: 'Bathroom', rect: [2, -2, 7, 1.5], floor: 'blue', wall: 'subway' },
      { id: 'study', name: 'Study', rect: [-7, -3.5, -2.5, 0.5], floor: 'carpetGreen', wall: 'stripe' },
    ],
    open: [['great', 'kitchen']],
    roofs: [[-7, 0.5, 7, 6.5], [-7, -3.5, -2.5, 0.5], [2, -2, 7, 1.5]],
    openings: [
      { kind: 'front', x: -3, z: 6.5, color: '#f4f1ea' },
      { x: -5.5, z: 6.5, w: 2.0 }, { x: 0.5, z: 6.5, w: 1.6 }, { x: 4.5, z: 6.5, w: 2.0 },
      { x: 7, z: 4, w: 1.4 }, { x: 7, z: -0.25, w: 0.8, bottom: 1.3 }, { x: 4.5, z: -2, w: 1.0, bottom: 1.2 },
      { x: 2, z: -0.8, w: 0.8, bottom: 1.3 }, { x: -7, z: 3.5, w: 1.4 },
      { x: -7, z: -1.5, w: 1.4 }, { x: -4.75, z: -3.5, w: 1.4 }, { x: -2.5, z: -1.5, w: 1.2 },
      { kind: 'door', x: 2, z: 3 }, { kind: 'door', x: 4.5, z: 1.5 }, { kind: 'door', x: -5.8, z: 0.5 },
      { kind: 'door', x: -1.9, z: 0.5 },
    ],
    yard: { path: [[-3.6, 6.6, -2.4, 14]], sand: [[-12.5, 7.5, -6, 12.5]] },
    spawn: [-3, 9],
    items: [
      // Great room
      ['tv', -3.9, 0.81, S], ['velvet_sofa', -3.9, 3.8, N], ['coffee_table', -3.9, 2.4, S], ['rug_blue', -3.9, 2.5, S],
      ['armchair', -6.3, 2.3, E], ['floor_lamp', -6.6, 1.0, S], ['piano', -6.42, 5.3, E], ['plant_big', -1.5, 6.0, S],
      ['lantern', -3.9, 2.4, S], ['painting_1', -6.9, 1.6, E, { wall: true }],
      // Kitchen
      ['kitchen_run', 0.7, 0.9, S], ['fridge', 1.57, 4.3, W], ['table_round', 0.1, 3.4, S],
      ['chair_sage', -0.65, 3.4, E], ['chair_sage', 0.85, 3.4, W], ['vase', 0.1, 3.4, S],
      // Study
      ['desk', -4.75, -3.04, S], ['office_chair', -4.75, -2.25, N], ['bookshelf', -6.72, -2.8, E],
      ['loveseat', -3.01, -1.5, W], ['rug_purple', -4.6, -1.2, S], ['plant', -6.55, 0.05, S],
      // Bedroom
      ['bed_rose', 6.0, 5.35, N], ['nightstand', 4.9, 6.15, N], ['wardrobe', 2.4, 5.4, E], ['rug_red', 4.3, 3.6, S],
      ['plant', 6.55, 1.95, S],
      // Bathroom
      ['tub', 3.2, -1.52, E], ['toilet', 6.55, 0.8, W], ['basin', 5.6, -1.71, S],
      // Courtyard and pool
      ['patio', -1.4, -0.6, S], ['patio', 0.6, -0.6, S], ['patio', -1.4, -2.6, S], ['patio', 0.6, -2.6, S],
      ['table_round', -0.4, -1.6, S], ['chair_wood', -1.15, -1.6, E], ['chair_wood', 0.35, -1.6, W],
      ['pool', -0.4, -8.4, E], ['lounger', -3.2, -5.2, S], ['lounger', -1.9, -5.2, S], ['lounger', 1.9, -5.2, S], ['umbrella', 0.6, -5.4, S],
      ['palm_0', -10.5, -6, S], ['palm_1', 9.5, -9, S], ['palm_0', -10, 10, S], ['palm_1', 10, 9.5, S], ['palm_0', 9.8, -1.5, S],
      ['grill', 5, -5, S], ['flower_bed', -5.5, 7.0, S], ['flower_bed_blue', 0.5, 7.0, S], ['flower_bed', 4.5, 7.0, S],
      ['mailbox', -4.3, 13.3, S], ['garden_lamp', -2.2, 9.5, S], ['garden_lamp', -3.8, 12.5, S], ['bench', -9, 12, S],
      ...row('hedge', [-12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12], -13.4, S),
    ],
  },
};

// The street: three lots side by side, each with its preset house.
export const LOTS = [
  { id: 'A', plan: 'cottage', cx: -28, cz: 0, address: '12 Sunny Lane' },
  { id: 'B', plan: 'family', cx: 0, cz: 0, address: '14 Sunny Lane' },
  { id: 'C', plan: 'bungalow', cx: 28, cz: 0, address: '16 Sunny Lane' },
].map((l) => ({ ...l, w: LOT.w, d: LOT.d }));

// Who lives here to begin with. Voices are the four speech presets.
export const HOUSEHOLD = [
  { name: 'Maya', model: 'michelle', voice: 'woman', look: { pantsHue: 0.58, topHue: 0.02 }, needs: { hunger: 62, energy: 70, bladder: 80, hygiene: 75, fun: 38, social: 55 } },
  { name: 'Theo', model: 'man', voice: 'man', look: { top: '#3f5e8c', bottom: '#d9c7a0', shoes: '#3a2a22', skin: '#c89878', hair: '#1c1714', hat: false, beard: true }, needs: { hunger: 45, energy: 58, bladder: 70, hygiene: 60, fun: 70, social: 40 } },
  { name: 'Ruby', model: 'girl', voice: 'girl', look: { top: '#f2b8c6', bottom: '#2b3a55', shoes: '#e8e4dc', skin: '#e0b89a', hair: '#8c3b24' }, needs: { hunger: 70, energy: 85, bladder: 60, hygiene: 80, fun: 30, social: 65 } },
];
