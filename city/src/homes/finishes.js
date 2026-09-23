// Wall paints, floorings, sidings and roofs: the swatches build mode offers.
// Each has an id (what a saved lot stores), a name, a swatch colour for the
// UI, and a material made on first use and shared by every surface using it.
import * as THREE from 'three';
import { M, std } from '../world/materials.js';
import { rng } from '../world/textures.js';

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

function canvasTex(size, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Clapboard siding: horizontal boards with a shadow under each lap. One
// texture tile is a metre, boards 16cm.
function siding(color) {
  return once(`siding:${color}`, () => {
    const map = canvasTex(256, (x, s) => {
      const r = rng(41);
      x.fillStyle = color; x.fillRect(0, 0, s, s);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const y = (i * s) / n;
        const g = x.createLinearGradient(0, y, 0, y + s / n);
        g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.12, 'rgba(0,0,0,0.05)'); g.addColorStop(0.85, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
        x.fillStyle = g; x.fillRect(0, y, s, s / n);
      }
      for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`; x.fillRect(r() * s, r() * s, 1 + r() * 6, 1); }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
  });
}

// Roof shingles: staggered rows, a little colour noise per tab.
function shingles(color) {
  return once(`shingle:${color}`, () => {
    const base = new THREE.Color(color);
    const map = canvasTex(256, (x, s) => {
      const r = rng(43);
      const rows = 8, cols = 6, h = s / rows, w = s / cols;
      for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
        const c = base.clone().offsetHSL(0, 0, (r() - 0.5) * 0.08);
        x.fillStyle = `#${c.getHexString()}`;
        const ox = (j % 2) * w / 2;
        x.fillRect(i * w + ox + 1, j * h, w - 2, h);
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(i * w + ox, j * h + h - 3, w, 3);
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.9, side: THREE.DoubleSide });
  });
}

function stone(color) {
  return once(`stone:${color}`, () => {
    const map = canvasTex(256, (x, s) => {
      const r = rng(47);
      x.fillStyle = color; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 26; i++) {
        const c = new THREE.Color(color).offsetHSL(0, 0, (r() - 0.5) * 0.1);
        x.fillStyle = `#${c.getHexString()}`;
        const px = r() * s, py = r() * s, rw = 20 + r() * 30, rh = 16 + r() * 24;
        x.beginPath(); x.ellipse(px, py, rw, rh, r() * 3, 0, 7); x.fill();
        x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2; x.stroke();
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
  });
}

const paint = (color) => once(`paint:${color}`, () => std(color, { rough: 0.9, key: 'wallpaint' }));

// Interior wall finishes.
export const PAINTS = {
  cream: { name: 'Cream', swatch: '#efe6d6', mat: () => paint('#efe6d6') },
  white: { name: 'Gallery White', swatch: '#f6f4ef', mat: () => paint('#f6f4ef') },
  sage: { name: 'Sage', swatch: '#b9c7a8', mat: () => paint('#b9c7a8') },
  sky: { name: 'Sky', swatch: '#b8d3e6', mat: () => paint('#b8d3e6') },
  blush: { name: 'Blush', swatch: '#f2c9c0', mat: () => paint('#f2c9c0') },
  butter: { name: 'Butter', swatch: '#f4e2a1', mat: () => paint('#f4e2a1') },
  terracotta: { name: 'Terracotta', swatch: '#d08a6a', mat: () => paint('#d08a6a') },
  navy: { name: 'Navy', swatch: '#2f4260', mat: () => paint('#2f4260') },
  charcoal: { name: 'Charcoal', swatch: '#3d3f44', mat: () => paint('#3d3f44') },
  stripe: { name: 'Striped Paper', swatch: '#e9dcc8', mat: () => M.wallpaper('#f3e6cf', '#e3cfae') },
  mint: { name: 'Mint Paper', swatch: '#cfe8dc', mat: () => M.wallpaper('#d9efe4', '#c2dfd1') },
  rose: { name: 'Rose Paper', swatch: '#f0d0d8', mat: () => M.wallpaper('#f6dde3', '#e8c1cb') },
  tile: { name: 'Bath Tile', swatch: '#dfe8ee', mat: () => M.tiles('#e8f0f4', '#c8d6de', 6, 'plain') },
  subway: { name: 'Subway Tile', swatch: '#f4f4f2', mat: () => M.tiles('#fbfbf8', '#dcdcd8', 5, 'plain') },
  wood: { name: 'Wood Panel', swatch: '#9a6a42', mat: () => M.planks('#a8744a') },
};

// Exterior sidings (also offered for interior walls, as feature walls).
export const SIDINGS = {
  sidingBlue: { name: 'Harbour Blue', swatch: '#9fc2d8', mat: () => siding('#a9c9dd') },
  sidingCream: { name: 'Cream Siding', swatch: '#efe3c8', mat: () => siding('#f1e6cc') },
  sidingSage: { name: 'Sage Siding', swatch: '#b7c9a4', mat: () => siding('#bccdaa') },
  sidingWhite: { name: 'White Siding', swatch: '#f5f5f0', mat: () => siding('#f7f7f2') },
  stuccoSand: { name: 'Sand Stucco', swatch: '#e7d3b0', mat: () => M.plaster('#e7d3b0') },
  stuccoTeal: { name: 'Lagoon Stucco', swatch: '#8fd0c8', mat: () => M.plaster('#9bd6ce') },
  stuccoPink: { name: 'Flamingo Stucco', swatch: '#f4b9b2', mat: () => M.plaster('#f4bfb8') },
  brick: { name: 'Red Brick', swatch: '#a4553d', mat: () => M.tiles('#a95a40', '#8e4632', 5, 'plain') },
};

export const WALLS = { ...PAINTS, ...SIDINGS };

export const FLOORS = {
  oak: { name: 'Oak Planks', swatch: '#b08a60', mat: () => M.planks('#b48d62'), tile: 2 },
  walnut: { name: 'Walnut Planks', swatch: '#6e4a30', mat: () => M.planks('#76503a'), tile: 2 },
  ash: { name: 'Pale Ash', swatch: '#d8c3a5', mat: () => M.planks('#dcc8aa'), tile: 2 },
  check: { name: 'Checker Tile', swatch: '#1f2326', mat: () => M.tiles('#f2efe8', '#1f2326', 8, 'check'), tile: 2.4 },
  white: { name: 'White Tile', swatch: '#f4f4f2', mat: () => M.tiles('#f4f4f2', '#dcdcd8', 6, 'plain'), tile: 2.4 },
  blue: { name: 'Pool Tile', swatch: '#9fc8dc', mat: () => M.tiles('#a8d0e2', '#8ab8cc', 8, 'plain'), tile: 1.6 },
  terracotta: { name: 'Terracotta', swatch: '#c8775a', mat: () => M.tiles('#c97a5c', '#b86a4e', 4, 'plain'), tile: 2 },
  sage: { name: 'Sage Tile', swatch: '#a7b99a', mat: () => M.tiles('#aabd9c', '#95a888', 4, 'check'), tile: 2 },
  carpetBeige: { name: 'Beige Carpet', swatch: '#c9b79c', mat: () => M.carpet('#c9b79c'), tile: 2 },
  carpetBlue: { name: 'Blue Carpet', swatch: '#4d6a8c', mat: () => M.carpet('#4d6a8c'), tile: 2 },
  carpetRose: { name: 'Rose Carpet', swatch: '#b87d8a', mat: () => M.carpet('#b87d8a'), tile: 2 },
  carpetGreen: { name: 'Moss Carpet', swatch: '#6b7f4e', mat: () => M.carpet('#6b7f4e'), tile: 2 },
  concrete: { name: 'Polished Concrete', swatch: '#a9a7a2', mat: () => std('#b0aea8', { rough: 0.55, key: 'concretefloor' }), tile: 2 },
};

export const ROOFS = {
  slate: { name: 'Slate', mat: () => shingles('#4a5260') },
  terracotta: { name: 'Terracotta', mat: () => shingles('#b55a3a') },
  cedar: { name: 'Cedar', mat: () => shingles('#7a5a44') },
  sage: { name: 'Sage', mat: () => shingles('#5f7358') },
};

export const GROUND = {
  path: () => stone('#bdb3a3'),
  drive: () => std('#b5b1aa', { rough: 0.9, key: 'drive', map: undefined }),
  deck: () => M.planks('#a57a52'),
  foundation: () => std('#a39a8e', { rough: 0.95, key: 'foundation' }),
  trim: () => std('#f7f5ef', { rough: 0.6, key: 'trim' }),
  trimDark: () => std('#3a3d42', { rough: 0.6, key: 'trimdark' }),
};

export function wallMat(id) { return (WALLS[id] || PAINTS.cream).mat(); }
export function floorMat(id) { return (FLOORS[id] || FLOORS.oak).mat(); }
export function floorTile(id) { return (FLOORS[id] || FLOORS.oak).tile; }
export function roofMat(id) { return (ROOFS[id] || ROOFS.slate).mat(); }
