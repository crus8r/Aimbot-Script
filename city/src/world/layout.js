// The city plan: where roads, blocks, lots and landmarks are. Pure data —
// the builders, the minimap, the pedestrian graph and traffic all read it.
//
//   west (downtown towers)  ->  east (art-deco hotels, Ocean Drive, beach, sea)
//   +X is east, +Z is south. Ground is y=0 on roads, 0.15 on sidewalks.
import { rng } from './textures.js';

export const ROAD_W = 12;          // curb to curb
export const HALF_ROAD = ROAD_W / 2;
export const CURB_H = 0.15;
export const WALK_W = 4.5;         // sidewalk width inside each block
export const LANE_OFF = 1.9;       // lane centre from road centre (right-hand traffic)
export const XS = [-190, -114, -38, 38, 114, 190];
export const ZS = [-152, -76, 0, 76, 152];
export const BEACH = { promenade0: 196, promenade1: 206, sandEnd: 276, water: -0.35, pierZ: 0, pierEnd: 330, deckY: 1.35 };
export const BOUNDS = { x0: -201, x1: 258, z0: -163, z1: 163 };

export function beachHeight(x) {
  if (x <= BEACH.promenade1) return CURB_H;
  const t = Math.min(1, (x - BEACH.promenade1) / (BEACH.sandEnd - BEACH.promenade1));
  // Gentle convex slope: a dry upper beach, then down to the waterline.
  return CURB_H + 0.15 * Math.sin(t * Math.PI * 0.5) * (1 - t) - 1.1 * t * t;
}

export function blockRect(i, j) {
  return { x0: XS[i] + HALF_ROAD, x1: XS[i + 1] - HALF_ROAD, z0: ZS[j] + HALF_ROAD, z1: ZS[j + 1] - HALF_ROAD };
}

// Named places. `interior` lots get furnished rooms at street level.
export const INTERIORS = {
  diner: { block: [4, 1], name: 'Sunny Side Diner' },
  store: { block: [3, 1], name: '24/7 Quik Stop' },
  apartment: { block: [3, 1], name: 'Apartment 1A' },
  bar: { block: [3, 2], name: 'Neon Lounge' },
  boutique: { block: [3, 2], name: 'Maison Solana' },
  office: { block: [2, 2], name: 'Solana Media' },
};

const DECO = ['#f4c7c3', '#bfe3d0', '#fbe3a4', '#cfe0f5', '#e3d4f2', '#f9d6b4', '#f5f1e8', '#9fd8d8'];
const DECO_TRIM = ['#ffffff', '#2a9d8f', '#ff7a59', '#34506b', '#e76f8a'];
const MID = ['#e9dcc5', '#d8c3a5', '#c8775a', '#b8b8b0', '#e2cfb4', '#a8b8a0'];
const GLASS = ['#4f7f9e', '#5e8f88', '#3f5f7f', '#6d8fa8', '#476a6a'];
const HOTEL_NAMES = ['HOTEL SOLANA', 'THE PALMS', 'OCEAN VIEW', 'CORAL REEF', 'FLAMINGO', 'SEA BREEZE', 'THE COLONY', 'LA PLAYA', 'STARLITE', 'BLUE MOON', 'PARADISE', 'SUNSET INN'];
const SHOP_NAMES = ['CAFE', 'BAKERY', 'PHARMACY', 'BOOKS', 'FLOWERS', 'SURF SHOP', 'PIZZA', 'LAUNDRY', 'TACOS', 'SUSHI', 'GELATO', 'RECORDS', 'BARBER', 'NAILS', 'DELI', 'TATTOO', 'HARDWARE', 'VINTAGE'];
const SHOP_SIGNS = ['#2a9d8f', '#e76f51', '#264653', '#8338ec', '#d62828', '#1d3557', '#6a994e', '#bc6c25'];

// Each lot: { x0,x1,z0,z1, face:'n'|'s'|'e'|'w', style, h, wall, trim, glass, shop, name?, interior? }
export function makePlan(seed = 7) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const lots = [];
  const special = [];            // park, parking, court
  const add = (l) => { lots.push(l); return l; };
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const b = blockRect(i, j);
    const x0 = b.x0 + WALK_W, x1 = b.x1 - WALK_W, z0 = b.z0 + WALK_W, z1 = b.z1 - WALK_W;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const key = `${i},${j}`;
    if (key === '2,1') { special.push({ kind: 'park', ...b }); continue; }
    if (key === '1,2') { special.push({ kind: 'parking', ...b }); continue; }
    if (key === '0,1') {
      special.push({ kind: 'court', x0: b.x0, x1: b.x1, z0: mz, z1: b.z1 });
      add({ x0, x1, z0, z1: mz - 2, face: 'n', style: 'glass', h: 40 + r() * 30, wall: '#9aa4ad', trim: '#c8d0d8', glass: pick(GLASS), shop: 'LOBBY' });
      continue;
    }
    if (i === 4) {
      // Beachfront: hotels facing Ocean Drive, smaller buildings behind.
      const n = 3;
      const w = (z1 - z0) / n;
      for (let k = 0; k < n; k++) {
        const lz0 = z0 + k * w, lz1 = lz0 + w;
        if (key === '4,1' && k === 2) {
          add({ x0: x1 - 14, x1: x1, z0: lz0 + 1, z1: lz1, face: 'e', interior: 'diner', h: 5.2, wall: '#e8e4dc', trim: '#e63946', style: 'deco' });
          add({ x0: mx - 2, x1: x1 - 16, z0: lz0 + 1, z1: lz1, face: 'e', style: 'deco', h: 13 + r() * 5, wall: pick(DECO), trim: pick(DECO_TRIM), glass: '#5f8fa0', shop: pick(SHOP_NAMES) });
        } else {
          add({ x0: mx - 2, x1: x1, z0: lz0 + (k ? 0.5 : 0), z1: lz1 - (k < n - 1 ? 0.5 : 0), face: 'e', style: 'deco', hotel: pick(HOTEL_NAMES), h: 14 + Math.floor(r() * 4) * 3.4, wall: pick(DECO), trim: pick(DECO_TRIM), glass: '#5f8fa0', shop: pick(['CAFE', 'SURF SHOP', 'GELATO', 'LOBBY']) });
        }
      }
      add({ x0, x1: mx - 4, z0, z1: mz - 1, face: 'w', style: 'apart', h: 10 + r() * 8, wall: pick(DECO), trim: '#ffffff', glass: '#5f8fa0', shop: pick(SHOP_NAMES) });
      add({ x0, x1: mx - 4, z0: mz + 1, z1, face: 'w', style: 'apart', h: 10 + r() * 8, wall: pick(DECO), trim: '#ffffff', glass: '#5f8fa0', shop: pick(SHOP_NAMES) });
      continue;
    }
    if (i === 0 || (i === 1 && j !== 2)) {
      // Downtown: one tower per half-block.
      const tall = i === 1 ? 50 : 70;
      add({ x0, x1, z0, z1: mz - 3, face: 'n', style: 'glass', h: tall + r() * 45, wall: '#9aa4ad', trim: '#c8d0d8', glass: pick(GLASS), shop: 'LOBBY' });
      add({ x0, x1, z0: mz + 3, z1, face: 's', style: r() < 0.5 ? 'glass' : 'apart', h: 30 + r() * 35, wall: pick(MID), trim: '#c8d0d8', glass: pick(GLASS), shop: pick(SHOP_NAMES) });
      continue;
    }
    // Mixed blocks: four corner lots.
    const quads = [
      { x0, x1: mx - 1, z0, z1: mz - 1, face: 'n' },
      { x0: mx + 1, x1, z0, z1: mz - 1, face: 'e' },
      { x0, x1: mx - 1, z0: mz + 1, z1, face: 'w' },
      { x0: mx + 1, x1, z0: mz + 1, z1, face: 's' },
    ];
    quads.forEach((q, k) => {
      let interior = null;
      if (key === '3,1' && k === 3) interior = 'store';
      if (key === '3,1' && k === 1) interior = 'apartment';
      if (key === '3,2' && k === 0) interior = 'bar';
      if (key === '3,2' && k === 1) interior = 'boutique';
      if (key === '2,2' && k === 0) interior = 'office';
      const style = pick(['apart', 'apart', 'brick', 'deco']);
      add({ ...q, style, interior, h: interior ? 9 + r() * 10 : 9 + r() * 16, wall: style === 'brick' ? '#9a5040' : style === 'deco' ? pick(DECO) : pick(MID), trim: style === 'deco' ? pick(DECO_TRIM) : '#f0ebe0', glass: '#4f6f80', shop: pick(SHOP_NAMES) });
    });
  }
  for (const l of lots) { l.signColor = pick(SHOP_SIGNS); l.seed = Math.floor(r() * 1e6); }
  return { lots, special, seed };
}
