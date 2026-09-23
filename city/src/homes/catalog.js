// The buy catalogue. Almost everything here is furniture the city already
// had (world/furniture.js, world/props.js, the Khronos models); new pieces
// are the ones a home and a yard need that a city didn't: a shower, table
// lamps, hedges, fences, a grill, a pool.
//
// An entry: { id, name, cat, price, place, make() -> def, ... }
//   place: floor | wall | surface   (surface items also stand on the floor)
//   def:   { parts, cols, seats, hooks } as in furniture.js, or
//          { model: key, cols, seats } for a loaded model
//   top:   { y, hx, hz } a surface other things can stand on
//   flat:  true for rugs and decking: others may overlap them
//   use:   extra actions keyed in sims/actions.js
import * as THREE from 'three';
import { F } from '../world/furniture.js';
import { PROPS } from '../world/props.js';
import { box, mat4, partsByMaterial } from '../world/build.js';
import { M, std, glowMat } from '../world/materials.js';

const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const P = (geo, material, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) => ({ geo, material, m: mat4(x, y, z, ry, 1, 1, 1, rx, rz) });

export const CATEGORIES = [
  { id: 'seating', name: 'Seating', icon: '🛋' },
  { id: 'surfaces', name: 'Tables', icon: '🪑' },
  { id: 'beds', name: 'Beds', icon: '🛏' },
  { id: 'kitchen', name: 'Kitchen', icon: '🍳' },
  { id: 'bath', name: 'Bath', icon: '🛁' },
  { id: 'fun', name: 'Fun', icon: '📺' },
  { id: 'lighting', name: 'Lights', icon: '💡' },
  { id: 'decor', name: 'Decor', icon: '🖼' },
  { id: 'outdoor', name: 'Yard', icon: '🌳' },
];

// New builders -----------------------------------------------------------

const N = {
  shower() {
    const tile = M.tiles('#e8f0f4', '#c8d6de', 6, 'plain'), white = std('#f4f4f2', { rough: 0.2, key: 'porcelain' });
    return {
      parts: [
        P(box(0.95, 0.08, 0.95), white, 0, 0.04, 0),
        P(box(0.95, 2.1, 0.05), tile, 0, 1.05, -0.45),
        P(box(0.03, 2.0, 0.9), M.glass(), -0.46, 1.08, 0), P(box(0.03, 2.0, 0.9), M.glass(), 0.46, 1.08, 0),
        P(box(0.04, 2.05, 0.04), M.chrome(), -0.46, 1.05, 0.45), P(box(0.04, 2.05, 0.04), M.chrome(), 0.46, 1.05, 0.45),
        P(cyl(0.015, 0.015, 0.35, 6), M.chrome(), 0, 1.95, -0.3, 0, Math.PI / 2 - 0.4),
        P(cyl(0.09, 0.07, 0.03, 12), M.chrome(), 0, 1.98, -0.15),
        P(box(0.08, 0.14, 0.04), M.chrome(), 0.2, 1.1, -0.41),
      ],
      cols: [{ x: 0, z: -0.45, hx: 0.48, hz: 0.04, h: 2.1 }, { x: -0.46, z: 0, hx: 0.03, hz: 0.47, h: 2.1 }, { x: 0.46, z: 0, hx: 0.03, hz: 0.47, h: 2.1 }],
      hooks: [{ kind: 'shower', x: 0, y: 1.9, z: 0 }],
      footprint: { hx: 0.48, hz: 0.48 },
    };
  },

  tableLamp({ shade = '#f2e6cc', base = '#d8c8a8' } = {}) {
    return {
      parts: [P(cyl(0.07, 0.09, 0.26, 12), std(base, { rough: 0.4, key: 'lampbase' }), 0, 0.13, 0), P(cyl(0.1, 0.16, 0.2, 16), std(shade, { rough: 0.9, key: 'shade', emissive: '#ffcc88', ei: 0.4 }), 0, 0.36, 0)],
      hooks: [{ kind: 'lamp', x: 0, y: 0.36, z: 0, small: true }],
      footprint: { hx: 0.16, hz: 0.16 },
    };
  },

  gardenLamp() {
    return {
      parts: [P(cyl(0.05, 0.06, 1.5, 8), M.darkMetal(), 0, 0.75, 0), P(box(0.22, 0.28, 0.22), M.glass(), 0, 1.62, 0), P(box(0.12, 0.2, 0.12), glowMat('#ffd9a0', 3, 0.05), 0, 1.62, 0), P(new THREE.ConeGeometry(0.2, 0.14, 4), M.darkMetal(), 0, 1.83, 0, Math.PI / 4)],
      cols: [{ x: 0, z: 0, hx: 0.08, hz: 0.08, h: 1.8 }],
      hooks: [{ kind: 'lamp', x: 0, y: 1.62, z: 0, night: true }],
    };
  },

  endTable() {
    const w = M.wood('#8a5a36');
    return { parts: [P(box(0.5, 0.04, 0.5), w, 0, 0.53, 0), ...[[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]].map(([x, z]) => P(box(0.04, 0.53, 0.04), w, x, 0.265, z)), P(box(0.44, 0.02, 0.44), w, 0, 0.18, 0)], cols: [{ x: 0, z: 0, hx: 0.25, hz: 0.25, h: 0.55 }] };
  },

  hedge({ w = 2, h = 1.1 } = {}) {
    const parts = [P(box(w, h, 0.7, { tile: 1 }), M.leaves(), 0, h / 2, 0)];
    for (let i = 0; i < Math.round(w * 2); i++) parts.push(P(new THREE.IcosahedronGeometry(0.28, 1), M.leaves(), -w / 2 + 0.25 + i * (w - 0.5) / Math.max(1, Math.round(w * 2) - 1), h - 0.02, ((i * 7) % 3 - 1) * 0.12));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.35, h }] };
  },

  fence({ w = 2, color = '#f4f2ea' } = {}) {
    const p = std(color, { rough: 0.7, key: 'fence' });
    const parts = [P(box(w, 0.07, 0.04), p, 0, 0.35, 0), P(box(w, 0.07, 0.04), p, 0, 0.8, 0)];
    for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) parts.push(P(box(0.09, 1.15, 0.09), p, x, 0.575, 0));
    const n = Math.round(w / 0.16);
    for (let i = 0; i < n; i++) parts.push(P(box(0.08, 0.95, 0.025), p, -w / 2 + 0.12 + i * ((w - 0.24) / (n - 1)), 0.5, 0.03), P(new THREE.ConeGeometry(0.057, 0.08, 4), p, -w / 2 + 0.12 + i * ((w - 0.24) / (n - 1)), 1.01, 0.03, Math.PI / 4));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.06, h: 1.1 }] };
  },

  flowerBed({ w = 1.6, colors = ['#e63946', '#ffd166', '#f4a3c0', '#ffffff'] } = {}) {
    const parts = [P(box(w, 0.18, 0.6), std('#6e5a44', { rough: 1, key: 'soil' }), 0, 0.09, 0), P(box(w + 0.08, 0.22, 0.05), M.wood('#8a6a4a'), 0, 0.11, 0.3), P(box(w + 0.08, 0.22, 0.05), M.wood('#8a6a4a'), 0, 0.11, -0.3)];
    const n = Math.round(w * 6);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.1 + (i * (w - 0.2)) / (n - 1), z = ((i * 5) % 3 - 1) * 0.16;
      parts.push(P(new THREE.IcosahedronGeometry(0.1, 0), M.leaves(), x, 0.3, z));
      parts.push(P(new THREE.IcosahedronGeometry(0.055, 0), std(colors[i % colors.length], { rough: 0.7, key: 'petal' }), x + 0.03, 0.42 + (i % 3) * 0.04, z + 0.02));
    }
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.3, h: 0.4 }], use: 'water' };
  },

  grill() {
    const black = std('#1c1d20', { rough: 0.4, metal: 0.5, key: 'grill' });
    return {
      parts: [
        P(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), black, 0, 0.82, 0),
        P(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), black, 0, 0.86, -0.02, 0, -0.25),
        P(cyl(0.02, 0.02, 0.8, 6), M.metal(), 0.2, 0.4, 0.12, 0, 0.15, -0.2), P(cyl(0.02, 0.02, 0.8, 6), M.metal(), -0.2, 0.4, 0.12, 0, 0.15, 0.2), P(cyl(0.02, 0.02, 0.8, 6), M.metal(), 0, 0.4, -0.22, 0, -0.25),
        P(box(0.12, 0.03, 0.03), M.chrome(), 0, 1.16, 0.12),
      ],
      cols: [{ x: 0, z: 0, hx: 0.3, hz: 0.3, h: 1.1 }],
      hooks: [{ kind: 'grill', x: 0, y: 0.9, z: 0.25 }],
    };
  },

  pool({ w = 3.5, l = 7 } = {}) {
    const coping = std('#e8e2d4', { rough: 0.8, key: 'coping' });
    const parts = [
      P(box(w, 0.02, l), M.tiles('#62c6ea', '#4fb0d6', 10, 'plain'), 0, 0.02, 0),
      P(box(w - 0.1, 0.02, l - 0.1), std('#46b7e4', { rough: 0.05, key: 'poolsurf', transparent: true, opacity: 0.55 }), 0, 0.045, 0),
      P(box(w + 0.6, 0.07, 0.3), coping, 0, 0.035, l / 2 + 0.15), P(box(w + 0.6, 0.07, 0.3), coping, 0, 0.035, -l / 2 - 0.15),
      P(box(0.3, 0.07, l), coping, w / 2 + 0.15, 0.035, 0), P(box(0.3, 0.07, l), coping, -w / 2 - 0.15, 0.035, 0),
    ];
    for (const x of [-0.25, 0.25]) parts.push(P(new THREE.TorusGeometry(0.2, 0.02, 6, 12, Math.PI), M.chrome(), x, 0.1, l / 2 - 0.05, Math.PI / 2, 0, 0));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: l / 2, h: 0.5 }], footprint: { hx: w / 2 + 0.3, hz: l / 2 + 0.3 } };
  },

  mailbox({ color = '#2b3a55' } = {}) {
    return {
      parts: [P(box(0.08, 1.05, 0.08), M.wood('#6b4a30'), 0, 0.52, 0), P(box(0.22, 0.24, 0.45), std(color, { rough: 0.4, metal: 0.4, key: 'mailbox' }), 0, 1.15, 0), P(box(0.02, 0.18, 0.05), std('#d62828', { rough: 0.5, key: 'flag' }), 0.12, 1.25, -0.1)],
      cols: [{ x: 0, z: 0, hx: 0.12, hz: 0.23, h: 1.3 }],
      hooks: [{ kind: 'mail', x: 0, y: 1.1, z: 0.3 }],
    };
  },

  deck({ w = 2, d = 2, stone = false } = {}) {
    const m = stone ? M.tiles('#c9bfae', '#b4a994', 3, 'plain') : M.planks('#a57a52');
    return { parts: [P(box(w, 0.05, d, { tile: stone ? 1.5 : 1 }), m, 0, 0.025, 0)], walk: { hx: w / 2, hz: d / 2, h: 0.05 } };
  },

  shelfUnit() {
    const w = M.wood('#d8c3a5');
    const parts = [P(box(0.9, 0.03, 0.3), w, 0, 0.02, 0), P(box(0.9, 0.03, 0.3), w, 0, 0.55, 0), P(box(0.9, 0.03, 0.3), w, 0, 1.08, 0), P(box(0.03, 1.1, 0.3), w, -0.435, 0.55, 0), P(box(0.03, 1.1, 0.3), w, 0.435, 0.55, 0)];
    const cols = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653'];
    for (let i = 0; i < 5; i++) parts.push(P(box(0.05, 0.22, 0.2), std(cols[i % 4], { rough: 0.7, key: 'book' }), -0.3 + i * 0.06, 0.16, 0));
    parts.push(P(cyl(0.07, 0.05, 0.14, 10), std('#c8775a', { rough: 0.8, key: 'pot' }), 0.25, 0.64, 0), P(new THREE.IcosahedronGeometry(0.1, 0), M.leaves(), 0.25, 0.77, 0));
    return { parts, cols: [{ x: 0, z: 0, hx: 0.45, hz: 0.15, h: 1.1 }] };
  },

  clock() {
    return { parts: [P(cyl(0.2, 0.2, 0.04, 24), std('#f6f4ef', { rough: 0.5, key: 'clockface' }), 0, 0, 0, 0, Math.PI / 2), P(new THREE.TorusGeometry(0.2, 0.02, 6, 24), M.darkMetal(), 0, 0, 0.02), P(box(0.015, 0.14, 0.01), M.darkMetal(), 0, 0.05, 0.03), P(box(0.1, 0.015, 0.01), M.darkMetal(), 0.04, 0, 0.03)] };
  },
};

// Props from the city catalogue, as furniture defs.
const prop = (name, extra = {}) => () => {
  const d = PROPS[name];
  const cols = d.collider ? [{ x: 0, z: 0, ...d.collider }] : (d.walls || []);
  return { parts: d.parts(), cols, seats: d.seats || [], ...extra };
};

// Model-backed items borrow their collision and seats from the procedural
// twin they replace.
const sofaSeats = (w) => F.sofa({ w }).seats;

export const CATALOG = [
  // Seating
  { id: 'chair_wood', tuck: true, name: 'Farmhouse Chair', cat: 'seating', price: 80, make: () => F.chair() },
  { id: 'chair_red', tuck: true, name: 'Diner Chair', cat: 'seating', price: 95, make: () => F.chair({ seat: '#b22234' }) },
  { id: 'chair_sage', tuck: true, name: 'Cushioned Chair', cat: 'seating', price: 110, make: () => F.chair({ wood: '#d8c3a5', seat: '#8fae8b' }) },
  { id: 'stool', tuck: true, name: 'Bar Stool', cat: 'seating', price: 120, make: () => F.stool() },
  { id: 'office_chair', tuck: true, name: 'Office Chair', cat: 'seating', price: 150, make: () => F.officeChair() },
  { id: 'sofa_blue', name: 'Harbour Sofa', cat: 'seating', price: 650, make: () => F.sofa({ w: 2.1, color: '#3f5e8c' }) },
  { id: 'sofa_rust', name: 'Canyon Sofa', cat: 'seating', price: 700, make: () => F.sofa({ w: 2.3, color: '#b5653e' }) },
  { id: 'sofa_green', name: 'Fern Sofa', cat: 'seating', price: 680, make: () => F.sofa({ w: 2.1, color: '#4f6b4a' }) },
  { id: 'loveseat', name: 'Plum Loveseat', cat: 'seating', price: 420, make: () => F.sofa({ w: 1.5, color: '#8c6d9c' }) },
  { id: 'velvet_sofa', name: 'Velvet Sofa', cat: 'seating', price: 1200, make: () => ({ model: 'sofa', cols: [{ x: 0, z: 0, hx: 1.1, hz: 0.43, h: 0.85 }], seats: sofaSeats(2.2) }) },
  { id: 'armchair', name: 'Damask Armchair', cat: 'seating', price: 480, make: () => ({ model: 'armchair', cols: [{ x: 0, z: 0, hx: 0.4, hz: 0.4, h: 1.0 }], seats: [{ x: 0, z: 0.06, heading: 0, h: 0.45, kind: 'sofa', opts: { lean: -8 } }] }) },
  { id: 'bench', name: 'Park Bench', cat: 'seating', price: 300, make: prop('bench'), outdoor: true },

  // Tables and surfaces
  { id: 'table_dining', name: 'Dining Table', cat: 'surfaces', price: 300, make: () => F.tableRect({ w: 1.4, d: 0.85 }), top: { y: 0.77, hx: 0.7, hz: 0.42 } },
  { id: 'table_long', name: 'Harvest Table', cat: 'surfaces', price: 420, make: () => F.tableRect({ w: 2.0, d: 0.9, wood: '#6b4a30' }), top: { y: 0.77, hx: 1.0, hz: 0.45 } },
  { id: 'table_round', name: 'Café Table', cat: 'surfaces', price: 180, make: () => F.tableRound(), top: { y: 0.77, hx: 0.32, hz: 0.32 } },
  { id: 'coffee_table', name: 'Coffee Table', cat: 'surfaces', price: 160, make: () => F.coffeeTable(), top: { y: 0.445, hx: 0.55, hz: 0.3 } },
  { id: 'end_table', name: 'End Table', cat: 'surfaces', price: 70, make: () => N.endTable(), top: { y: 0.55, hx: 0.25, hz: 0.25 } },
  { id: 'desk', name: 'Desk with Computer', cat: 'surfaces', price: 600, make: () => F.desk(), use: 'computer' },
  { id: 'nightstand', name: 'Nightstand & Lamp', cat: 'surfaces', price: 90, make: () => F.nightstand() },
  { id: 'island', name: 'Kitchen Island', cat: 'surfaces', price: 380, make: () => F.counter({ w: 1.8, d: 0.7, front: '#e8e4dc', top: '#3a3a3a' }), top: { y: 0.975, hx: 0.9, hz: 0.4 } },
  { id: 'shelf_unit', name: 'Open Shelves', cat: 'surfaces', price: 140, make: () => N.shelfUnit(), top: { y: 1.1, hx: 0.45, hz: 0.15 } },

  // Beds
  { id: 'bed_double', name: 'Double Bed', cat: 'beds', price: 700, make: () => F.bed({ w: 1.6 }) },
  { id: 'bed_rose', name: 'Rose Double Bed', cat: 'beds', price: 720, make: () => F.bed({ w: 1.6, blanket: '#b87d8a' }) },
  { id: 'bed_single', name: 'Single Bed', cat: 'beds', price: 350, make: () => F.bed({ w: 1.0, blanket: '#2f6b4f' }) },
  { id: 'bed_kids', name: 'Sunshine Bed', cat: 'beds', price: 300, make: () => F.bed({ w: 1.0, l: 1.85, blanket: '#e9c46a' }) },

  // Kitchen
  { id: 'kitchen_run', name: 'Kitchen Counter', cat: 'kitchen', price: 900, make: () => F.kitchen({ w: 2.4 }), top: { y: 0.92, hx: 1.2, hz: 0.3 } },
  { id: 'kitchen_long', name: 'Chef Kitchen', cat: 'kitchen', price: 1200, make: () => F.kitchen({ w: 3.2 }), top: { y: 0.92, hx: 1.6, hz: 0.3 } },
  { id: 'fridge', name: 'Fridge', cat: 'kitchen', price: 600, make: () => F.fridge() },
  { id: 'drink_fridge', name: 'Drinks Cooler', cat: 'kitchen', price: 800, make: () => F.drinkFridge({ w: 1.2 }) },
  { id: 'water_cooler', name: 'Water Cooler', cat: 'kitchen', price: 120, make: () => F.waterCooler() },
  { id: 'bottle', name: 'Water Bottle', cat: 'kitchen', price: 5, place: 'surface', make: () => ({ model: 'bottle', footprint: { hx: 0.05, hz: 0.05 } }) },

  // Bathroom
  { id: 'toilet', name: 'Toilet', cat: 'bath', price: 300, make: () => F.toilet() },
  { id: 'tub', name: 'Bathtub', cat: 'bath', price: 650, make: () => F.tub(), use: 'bath' },
  { id: 'basin', name: 'Pedestal Sink', cat: 'bath', price: 250, make: () => F.basin() },
  { id: 'shower', name: 'Shower Stall', cat: 'bath', price: 500, make: () => N.shower() },

  // Fun
  { id: 'tv', name: 'TV & Stand', cat: 'fun', price: 500, make: () => F.tv() },
  { id: 'jukebox', name: 'Jukebox', cat: 'fun', price: 1500, make: () => F.jukebox() },
  { id: 'piano', name: 'Upright Piano', cat: 'fun', price: 2000, make: () => F.piano() },
  { id: 'boombox', name: 'Boombox', cat: 'fun', price: 90, place: 'surface', make: () => ({ model: 'boombox', hooks: [{ kind: 'jukebox', x: 0, y: 0.15, z: 0.1 }], footprint: { hx: 0.25, hz: 0.1 } }) },
  { id: 'pool_table', name: 'Pool Table', cat: 'fun', price: 1100, make: () => F.poolTable(), use: 'pool' },
  { id: 'bookshelf', name: 'Bookshelf', cat: 'fun', price: 350, make: () => F.bookshelf(), use: 'books' },

  // Lighting
  { id: 'floor_lamp', name: 'Floor Lamp', cat: 'lighting', price: 120, make: () => F.floorLamp() },
  { id: 'table_lamp', name: 'Table Lamp', cat: 'lighting', price: 60, place: 'surface', make: () => N.tableLamp() },
  { id: 'table_lamp_blue', name: 'Blue Table Lamp', cat: 'lighting', price: 65, place: 'surface', make: () => N.tableLamp({ base: '#3f5e8c', shade: '#f6f0e0' }) },
  { id: 'lantern', name: 'Lantern', cat: 'lighting', price: 80, place: 'surface', make: () => ({ model: 'lantern', hooks: [{ kind: 'lamp', x: 0, y: 0.25, z: 0, small: true }], footprint: { hx: 0.12, hz: 0.12 } }) },
  { id: 'garden_lamp', name: 'Garden Lamp', cat: 'lighting', price: 150, make: () => N.gardenLamp(), outdoor: true },

  // Decor
  { id: 'rug_red', name: 'Persian Rug', cat: 'decor', price: 200, make: () => F.rug({ w: 2.4, d: 1.7, color: '#8c3b24' }), flat: true },
  { id: 'rug_blue', name: 'Ocean Rug', cat: 'decor', price: 260, make: () => F.rug({ w: 3.0, d: 2.0, color: '#3f5e8c' }), flat: true },
  { id: 'rug_purple', name: 'Plum Runner', cat: 'decor', price: 120, make: () => F.rug({ w: 1.8, d: 1.2, color: '#5c4a72' }), flat: true },
  { id: 'rug_sand', name: 'Jute Rug', cat: 'decor', price: 150, make: () => F.rug({ w: 2.0, d: 1.4, color: '#c9b28a' }), flat: true },
  { id: 'painting_1', name: 'Harbour Abstract', cat: 'decor', price: 180, place: 'wall', mount: 1.55, make: () => F.painting({ seed: 0 }) },
  { id: 'painting_2', name: 'Sunset Blocks', cat: 'decor', price: 220, place: 'wall', mount: 1.55, make: () => F.painting({ seed: 1 }) },
  { id: 'painting_3', name: 'Violet Hour', cat: 'decor', price: 260, place: 'wall', mount: 1.55, make: () => F.painting({ seed: 2, w: 1.6, h: 0.7 }) },
  { id: 'painting_4', name: 'Night Swim', cat: 'decor', price: 300, place: 'wall', mount: 1.55, make: () => F.painting({ seed: 3, w: 0.8, h: 1.0 }) },
  { id: 'clock', name: 'Wall Clock', cat: 'decor', price: 45, place: 'wall', mount: 1.9, make: () => N.clock() },
  { id: 'whiteboard', name: 'Whiteboard', cat: 'decor', price: 90, place: 'wall', mount: 0, make: () => F.whiteboard() },
  { id: 'mirror', name: 'Standing Mirror', cat: 'decor', price: 200, make: () => F.mirror() },
  { id: 'wardrobe', name: 'Wardrobe', cat: 'decor', price: 500, make: () => F.wardrobe() },
  { id: 'plant', name: 'Potted Plant', cat: 'decor', price: 60, make: () => F.plant() },
  { id: 'plant_big', name: 'Big Fiddle Leaf', cat: 'decor', price: 90, make: () => F.plant({ s: 1.3 }) },
  { id: 'plant_small', name: 'Little Succulent', cat: 'decor', price: 25, place: 'surface', make: () => F.plant({ s: 0.45 }) },
  { id: 'vase', name: 'Vase of Flowers', cat: 'decor', price: 70, place: 'surface', make: () => ({ model: 'vase', footprint: { hx: 0.12, hz: 0.12 } }) },

  // Outdoor
  { id: 'tree_0', name: 'Oak Tree', cat: 'outdoor', price: 250, make: prop('tree0'), outdoor: true },
  { id: 'tree_1', name: 'Maple Tree', cat: 'outdoor', price: 250, make: prop('tree1'), outdoor: true },
  { id: 'tree_2', name: 'Linden Tree', cat: 'outdoor', price: 250, make: prop('tree2'), outdoor: true },
  { id: 'palm_0', name: 'Palm Tree', cat: 'outdoor', price: 300, make: prop('palm0'), outdoor: true },
  { id: 'palm_1', name: 'Tall Palm', cat: 'outdoor', price: 340, make: prop('palm1'), outdoor: true },
  { id: 'hedge', name: 'Boxwood Hedge', cat: 'outdoor', price: 80, make: () => N.hedge() },
  { id: 'hedge_short', name: 'Short Hedge', cat: 'outdoor', price: 45, make: () => N.hedge({ w: 1, h: 0.8 }) },
  { id: 'fence', name: 'Picket Fence', cat: 'outdoor', price: 40, make: () => N.fence() },
  { id: 'flower_bed', name: 'Flower Bed', cat: 'outdoor', price: 60, make: () => N.flowerBed() },
  { id: 'flower_bed_blue', name: 'Blue Flower Bed', cat: 'outdoor', price: 60, make: () => N.flowerBed({ colors: ['#6a8dff', '#ffffff', '#b6a3ff', '#ffd166'] }) },
  { id: 'planter', name: 'Stone Planter', cat: 'outdoor', price: 120, make: prop('planter'), outdoor: true },
  { id: 'picnic', name: 'Picnic Table', cat: 'outdoor', price: 350, make: prop('picnic'), outdoor: true },
  { id: 'lounger', name: 'Sun Lounger', cat: 'outdoor', price: 200, make: prop('lounger', { seats: [{ x: 0.3, z: -0.1, heading: Math.PI / 2, h: 0.4, kind: 'lounger' }] }), outdoor: true },
  { id: 'umbrella', name: 'Patio Umbrella', cat: 'outdoor', price: 150, make: prop('umbrella'), outdoor: true },
  { id: 'grill', name: 'Kettle Grill', cat: 'outdoor', price: 250, make: () => N.grill() },
  { id: 'pool', name: 'Swimming Pool', cat: 'outdoor', price: 3000, make: () => N.pool() },
  { id: 'mailbox', name: 'Mailbox', cat: 'outdoor', price: 50, make: () => N.mailbox() },
  { id: 'trash', name: 'Trash Can', cat: 'outdoor', price: 40, make: prop('trash'), outdoor: true },
  { id: 'deck', name: 'Wood Deck 2×2', cat: 'outdoor', price: 100, make: () => N.deck(), flat: true },
  { id: 'patio', name: 'Stone Patio 2×2', cat: 'outdoor', price: 90, make: () => N.deck({ stone: true }), flat: true },
];

export const BY_ID = Object.fromEntries(CATALOG.map((e) => [e.id, e]));

// Build-once data for an entry: merged geometry, footprint, height.
export function prepared(entry, models) {
  if (entry._prep) return entry._prep;
  const def = entry.make();
  let parts = null;
  let proto = null;
  if (def.model) {
    const m = models?.[def.model];
    if (!m) return null;
    proto = m.proto;
  } else {
    parts = partsByMaterial(def.parts);
  }
  // Footprint: explicit, else the colliders' extent, else the geometry's.
  let fp = def.footprint;
  if (!fp && def.cols?.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of def.cols) { x0 = Math.min(x0, (c.x || 0) - c.hx); x1 = Math.max(x1, (c.x || 0) + c.hx); z0 = Math.min(z0, (c.z || 0) - c.hz); z1 = Math.max(z1, (c.z || 0) + c.hz); }
    fp = { hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  }
  const bb = new THREE.Box3();
  if (parts) for (const p of parts) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); }
  else bb.setFromObject(proto);
  if (!fp) fp = { hx: Math.max(0.05, (bb.max.x - bb.min.x) / 2), hz: Math.max(0.03, (bb.max.z - bb.min.z) / 2), cx: (bb.max.x + bb.min.x) / 2, cz: (bb.max.z + bb.min.z) / 2 };
  fp.cx = fp.cx || 0; fp.cz = fp.cz || 0;
  entry._prep = { def, parts, proto, fp, height: bb.max.y, bb };
  return entry._prep;
}
