// Furniture catalogue. Each builder returns, in furniture-local space
// (front = +Z, floor = y 0):
//   parts: [{geo, material, m}]      what it looks like
//   cols:  [{x,z,hx,hz,h,y0}]         what you bump into
//   seats: [{x,z,heading,h,kind,opts,loop}]
//   hooks: [{x,y,z,kind,...}]         interaction points (tv, lamp, fridge...)
// Dimensions are real-world: a dining chair seat is 46cm, a bar stool 75cm,
// a counter 92cm. That is what lets one sit clip land on all of them.
import * as THREE from 'three';
import { box, mat4 } from './build.js';
import { M, std, glowMat } from './materials.js';

const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const P = (geo, material, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) => ({ geo, material, m: mat4(x, y, z, ry, 1, 1, 1, rx, rz) });

export const F = {
  chair({ wood = '#6b4a30', seat = null } = {}) {
    const w = M.wood(wood), s = seat ? M.fabric(seat) : w;
    const parts = [P(box(0.44, 0.05, 0.42), s, 0, 0.44, 0)];
    for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) parts.push(P(box(0.04, 0.44, 0.04), w, x, 0.22, z));
    parts.push(P(box(0.44, 0.42, 0.04), w, 0, 0.68, -0.2));
    return { parts, cols: [{ x: 0, z: 0, hx: 0.22, hz: 0.22, h: 0.9 }], seats: [{ x: 0, z: 0.02, heading: 0, h: 0.47, kind: 'chair' }] };
  },

  stool({ top = '#c1272d', h = 0.76 } = {}) {
    const parts = [
      P(cyl(0.2, 0.2, 0.08, 16), std(top, { rough: 0.35, key: 'vinyl' }), 0, h - 0.04, 0),
      P(cyl(0.035, 0.035, h - 0.08, 8), M.chrome(), 0, (h - 0.08) / 2, 0),
      P(cyl(0.2, 0.22, 0.03, 16), M.chrome(), 0, 0.015, 0),
      P(new THREE.TorusGeometry(0.17, 0.012, 6, 16), M.chrome(), 0, 0.28, 0, 0, Math.PI / 2),
    ];
    return { parts, cols: [{ x: 0, z: 0, hx: 0.18, hz: 0.18, h }], seats: [{ x: 0, z: 0, heading: 0, h: h + 0.02, kind: 'stool' }] };
  },

  tableRound({ top = '#f2efe8', r = 0.45, h = 0.75 } = {}) {
    return {
      parts: [P(cyl(r, r, 0.04, 24), std(top, { rough: 0.3, key: 'tabletop' }), 0, h, 0), P(cyl(0.04, 0.04, h, 8), M.chrome(), 0, h / 2, 0), P(cyl(0.25, 0.28, 0.03, 16), M.chrome(), 0, 0.015, 0)],
      cols: [{ x: 0, z: 0, hx: r * 0.8, hz: r * 0.8, h }],
    };
  },

  tableRect({ w = 1.2, d = 0.75, h = 0.75, wood = '#8a5a36' } = {}) {
    const m = M.wood(wood);
    const parts = [P(box(w, 0.04, d), m, 0, h, 0)];
    for (const [x, z] of [[-w / 2 + 0.05, -d / 2 + 0.05], [w / 2 - 0.05, -d / 2 + 0.05], [-w / 2 + 0.05, d / 2 - 0.05], [w / 2 - 0.05, d / 2 - 0.05]]) parts.push(P(box(0.05, h, 0.05), m, x, h / 2, z));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: d / 2, h }] };
  },

  // A diner booth: table between two benches facing each other along X.
  booth({ vinyl = '#b22234', w = 1.1 } = {}) {
    const v = std(vinyl, { rough: 0.35, key: 'boothvinyl' }), t = std('#f2e8d8', { rough: 0.25, key: 'formica' });
    const parts = [
      P(box(0.75, 0.04, w), t, 0, 0.75, 0), P(box(0.08, 0.72, 0.3), M.chrome(), 0, 0.36, 0),
    ];
    const seats = [];
    for (const s of [-1, 1]) {
      parts.push(P(box(0.5, 0.18, w), v, s * 0.78, 0.37, 0));
      parts.push(P(box(0.5, 0.3, w), M.darkMetal(), s * 0.78, 0.14, 0));
      parts.push(P(box(0.14, 0.7, w), v, s * 1.02, 0.8, 0));
      seats.push({ x: s * 0.72, z: -w / 4, heading: s > 0 ? -Math.PI / 2 : Math.PI / 2, h: 0.47, kind: 'chair', opts: { hands: 'table' } });
      seats.push({ x: s * 0.72, z: w / 4, heading: s > 0 ? -Math.PI / 2 : Math.PI / 2, h: 0.47, kind: 'chair', opts: { hands: 'table' } });
    }
    return { parts, cols: [{ x: 0, z: 0, hx: 1.1, hz: w / 2, h: 1.15 }], seats };
  },

  counter({ w = 4, d = 0.7, h = 0.95, front = '#b22234', top = '#e8e4dc' } = {}) {
    return {
      parts: [P(box(w, 0.05, d + 0.1), std(top, { rough: 0.25, key: 'ctop' }), 0, h, 0.05), P(box(w, h - 0.05, d), std(front, { rough: 0.5, key: 'cfront' }), 0, (h - 0.05) / 2, 0), P(box(w, 0.06, 0.02), M.chrome(), 0, h - 0.25, d / 2 + 0.01)],
      cols: [{ x: 0, z: 0, hx: w / 2, hz: d / 2 + 0.05, h }],
    };
  },

  sofa({ w = 2.1, color = '#3f5e8c' } = {}) {
    const f = M.fabric(color);
    const parts = [
      P(box(w, 0.22, 0.85), f, 0, 0.25, 0), P(box(w, 0.5, 0.2), f, 0, 0.6, -0.33),
      P(box(0.18, 0.35, 0.85), f, -w / 2 + 0.09, 0.45, 0), P(box(0.18, 0.35, 0.85), f, w / 2 - 0.09, 0.45, 0),
    ];
    for (let i = 0; i < Math.round(w / 0.7); i++) parts.push(P(box(w / Math.round(w / 0.7) - 0.04, 0.1, 0.62), f, -w / 2 + 0.18 + (i + 0.5) * ((w - 0.36) / Math.round(w / 0.7)), 0.41, 0.08));
    const seats = [];
    const n = Math.max(2, Math.floor((w - 0.36) / 0.6));
    for (let i = 0; i < n; i++) seats.push({ x: -((w - 0.36) / 2) + ((i + 0.5) * (w - 0.36)) / n, z: 0.05, heading: 0, h: 0.44, kind: 'sofa', opts: { lean: -10, hands: 'thighs' } });
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.43, h: 0.85 }], seats };
  },

  coffeeTable() {
    const w = M.wood('#5a3a22');
    return { parts: [P(box(1.1, 0.05, 0.6), w, 0, 0.42, 0), P(box(1.0, 0.03, 0.5), w, 0, 0.12, 0), ...[[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]].map(([x, z]) => P(box(0.05, 0.42, 0.05), w, x, 0.21, z))], cols: [{ x: 0, z: 0, hx: 0.55, hz: 0.3, h: 0.45 }] };
  },

  tv() {
    const parts = [
      P(box(1.6, 0.5, 0.45), M.wood('#3a2a1e'), 0, 0.25, 0),
      P(box(1.3, 0.76, 0.05), M.darkMetal(), 0, 0.98, 0),
      P(box(0.3, 0.05, 0.2), M.darkMetal(), 0, 0.52, 0),
    ];
    return { parts, cols: [{ x: 0, z: 0, hx: 0.8, hz: 0.23, h: 1.4 }], hooks: [{ kind: 'tv', x: 0, y: 0.98, z: 0.03, w: 1.22, h: 0.68 }] };
  },

  floorLamp({ shade = '#f2e6cc' } = {}) {
    return {
      parts: [P(cyl(0.16, 0.18, 0.03), M.darkMetal(), 0, 0.015, 0), P(cyl(0.015, 0.015, 1.55), M.darkMetal(), 0, 0.78, 0), P(cyl(0.16, 0.24, 0.3, 16), std(shade, { rough: 0.9, key: 'shade', emissive: '#ffcc88', ei: 0.4 }), 0, 1.6, 0)],
      cols: [{ x: 0, z: 0, hx: 0.12, hz: 0.12, h: 1.7 }],
      hooks: [{ kind: 'lamp', x: 0, y: 1.55, z: 0 }],
    };
  },

  pendant({ color = '#e63946' } = {}) {
    return { parts: [P(cyl(0.006, 0.006, 0.8, 4), M.darkMetal(), 0, -0.4, 0), P(new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(color, { rough: 0.3, metal: 0.4, key: 'pend', side: THREE.DoubleSide }), 0, -0.95, 0), P(new THREE.SphereGeometry(0.08, 8, 6), glowMat('#fff0d0', 3, 1), 0, -0.98, 0)] };
  },

  bed({ w = 1.6, l = 2.05, sheet = '#e8e4f0', blanket = '#3f5e8c' } = {}) {
    const wood = M.wood('#6b4a30');
    const parts = [
      P(box(w + 0.08, 0.3, l + 0.06), wood, 0, 0.15, 0),
      P(box(w, 0.22, l), std(sheet, { rough: 0.9, key: 'sheet' }), 0, 0.41, 0),
      P(box(w + 0.02, 0.06, l * 0.62), M.fabric(blanket), 0, 0.53, l * 0.19),
      P(box(w + 0.1, 1.0, 0.08), wood, 0, 0.5, -l / 2 - 0.02),
    ];
    for (const s of w > 1.2 ? [-1, 1] : [0]) parts.push(P(box(0.55, 0.12, 0.35), std('#f5f2ea', { rough: 0.95, key: 'pillow' }), s * w * 0.25, 0.58, -l / 2 + 0.28));
    // Sit on the right-hand edge (+X) facing out, near the pillow end so lying
    // down lands the head on the pillow. See clips.js BED_IN.
    // Only the right edge: lie_down swings the head to the character's left,
    // which from the left edge would put it at the foot of the bed.
    const seats = [{ x: w / 2 - 0.12, z: -l / 2 + 0.95, heading: Math.PI / 2, h: 0.52, kind: 'bed' }];
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2 + 0.04, hz: l / 2 + 0.03, h: 0.55 }], seats };
  },

  nightstand() {
    const w = M.wood('#6b4a30');
    return { parts: [P(box(0.45, 0.5, 0.4), w, 0, 0.25, 0), P(cyl(0.07, 0.09, 0.25, 10), std('#d8c8a8', { rough: 0.5, key: 'lampbase' }), 0, 0.62, 0), P(cyl(0.1, 0.15, 0.2, 14), std('#f2e6cc', { rough: 0.9, key: 'shade', emissive: '#ffcc88', ei: 0.4 }), 0, 0.84, 0)], cols: [{ x: 0, z: 0, hx: 0.23, hz: 0.2, h: 0.5 }], hooks: [{ kind: 'lamp', x: 0, y: 0.84, z: 0, small: true }] };
  },

  wardrobe() {
    const w = M.wood('#8a6a4a');
    return { parts: [P(box(1.6, 2.1, 0.6), w, 0, 1.05, 0), P(box(0.02, 1.9, 0.02), M.darkMetal(), 0, 1.05, 0.31), P(box(0.04, 0.2, 0.03), M.chrome(), -0.08, 1.1, 0.31), P(box(0.04, 0.2, 0.03), M.chrome(), 0.08, 1.1, 0.31)], cols: [{ x: 0, z: 0, hx: 0.8, hz: 0.3, h: 2.1 }], hooks: [{ kind: 'wardrobe', x: 0, y: 1, z: 0.4 }] };
  },

  bookshelf() {
    const w = M.wood('#6b4a30');
    const parts = [P(box(1.2, 2.0, 0.35), w, 0, 1.0, -0.02)];
    const cols = ['#8c2f39', '#2b3a55', '#2f6b4f', '#d4a33a', '#5c4a72', '#e8e4dc', '#c75b39'];
    for (let s = 0; s < 4; s++) {
      let x = -0.55;
      let k = s * 3;
      while (x < 0.5) {
        const bw = 0.03 + ((k * 37) % 5) * 0.012, bh = 0.2 + ((k * 13) % 4) * 0.03;
        parts.push(P(box(bw, bh, 0.24), std(cols[k % cols.length], { rough: 0.7, key: 'book' }), x + bw / 2, 0.12 + s * 0.48 + bh / 2, 0.02));
        x += bw + 0.005; k++;
      }
      parts.push(P(box(1.14, 0.03, 0.3), w, 0, 0.1 + s * 0.48, 0.02));
    }
    return { parts, cols: [{ x: 0, z: 0, hx: 0.6, hz: 0.2, h: 2 }] };
  },

  plant({ s = 1 } = {}) {
    const parts = [P(cyl(0.2 * s, 0.15 * s, 0.4 * s, 12), std('#c8775a', { rough: 0.8, key: 'pot' }), 0, 0.2 * s, 0)];
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05;
      parts.push(P(new THREE.IcosahedronGeometry(0.22 * s, 0), M.leaves(), Math.cos(a) * 0.14 * s, (0.55 + (i % 3) * 0.2) * s, Math.sin(a) * 0.14 * s));
    }
    return { parts, cols: [{ x: 0, z: 0, hx: 0.2 * s, hz: 0.2 * s, h: 1 * s }] };
  },

  rug({ w = 2.4, d = 1.7, color = '#8c3b24' } = {}) {
    return { parts: [P(box(w, 0.01, d), M.carpet(color), 0, 0.005, 0)] };
  },

  kitchen({ w = 3.0 } = {}) {
    const cab = std('#e8e4dc', { rough: 0.5, key: 'cab' }), top = std('#3a3a3a', { rough: 0.3, key: 'granite' });
    const parts = [P(box(w, 0.88, 0.6), cab, 0, 0.44, 0), P(box(w, 0.04, 0.64), top, 0, 0.9, 0.02), P(box(w, 0.7, 0.35), cab, 0, 1.85, -0.12)];
    // Sink and hob.
    parts.push(P(box(0.6, 0.02, 0.42), M.chrome(), -w / 4, 0.925, 0.02));
    parts.push(P(cyl(0.015, 0.015, 0.3), M.chrome(), -w / 4, 1.05, -0.2));
    parts.push(P(box(0.6, 0.02, 0.5), std('#111', { rough: 0.2, key: 'hob' }), w / 4, 0.925, 0.02));
    for (const [x, z] of [[-0.13, -0.12], [0.13, -0.12], [-0.13, 0.12], [0.13, 0.12]]) parts.push(P(new THREE.TorusGeometry(0.07, 0.008, 4, 16), M.darkMetal(), w / 4 + x, 0.94, 0.02 + z, 0, Math.PI / 2));
    for (let i = 0; i < Math.floor(w / 0.6); i++) parts.push(P(box(0.02, 0.1, 0.02), M.chrome(), -w / 2 + 0.3 + i * 0.6, 0.72, 0.31));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.32, h: 0.95 }], hooks: [{ kind: 'sink', x: -w / 4, y: 0.95, z: 0.5 }, { kind: 'stove', x: w / 4, y: 0.95, z: 0.5 }] };
  },

  fridge() {
    const white = std('#eeeeea', { rough: 0.3, metal: 0.1, key: 'fridge' });
    return { parts: [P(box(0.75, 1.8, 0.7), white, 0, 0.9, 0), P(box(0.02, 0.4, 0.04), M.chrome(), 0.3, 1.2, 0.36), P(box(0.72, 0.01, 0.02), M.darkMetal(), 0, 1.2, 0.35)], cols: [{ x: 0, z: 0, hx: 0.38, hz: 0.35, h: 1.8 }], hooks: [{ kind: 'fridge', x: 0, y: 1.1, z: 0.45 }] };
  },

  drinkFridge({ w = 2.4 } = {}) {
    const parts = [P(box(w, 2.1, 0.7), M.darkMetal(), 0, 1.05, 0), P(box(w - 0.1, 1.8, 0.02), glowMat('#e8f6ff', 1.3, 0.8), 0, 1.1, 0.36)];
    const cols = ['#d62828', '#f77f00', '#2a9d8f', '#1d3557', '#8338ec', '#fcbf49'];
    for (let s = 0; s < 5; s++) for (let i = 0; i < Math.floor(w / 0.14); i++) parts.push(P(cyl(0.033, 0.033, 0.12, 6), std(cols[(i + s * 2) % cols.length], { rough: 0.3, metal: 0.5, key: 'can' }), -w / 2 + 0.1 + i * 0.14, 0.4 + s * 0.36, 0.2));
    for (let i = 1; i < Math.round(w / 0.8); i++) parts.push(P(box(0.04, 1.9, 0.04), M.chrome(), -w / 2 + i * (w / Math.round(w / 0.8)), 1.1, 0.37));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.35, h: 2.1 }], hooks: [{ kind: 'fridge', x: 0, y: 1.1, z: 0.55, drinks: true }] };
  },

  shelf({ w = 3, double = true } = {}) {
    const frame = std('#dfe3e6', { rough: 0.4, metal: 0.3, key: 'shelfm' });
    const d = double ? 0.9 : 0.45;
    const parts = [P(box(w, 1.55, 0.06), frame, 0, 0.78, 0)];
    const cols = ['#e63946', '#f1c40f', '#2a9d8f', '#1d3557', '#ff7a59', '#8338ec', '#6a994e', '#ffffff'];
    for (const side of double ? [-1, 1] : [1]) {
      for (let s = 0; s < 4; s++) {
        parts.push(P(box(w, 0.03, 0.4), frame, 0, 0.12 + s * 0.4, side * 0.23));
        let x = -w / 2 + 0.05, k = s * 5 + (side > 0 ? 0 : 3);
        while (x < w / 2 - 0.15) {
          const bw = 0.12 + (k % 3) * 0.05, bh = 0.16 + (k % 4) * 0.04;
          parts.push(P(box(bw, bh, 0.25), std(cols[(k * 7) % cols.length], { rough: 0.6, key: 'prod' }), x + bw / 2, 0.135 + s * 0.4 + bh / 2, side * 0.23));
          x += bw + 0.02; k++;
        }
      }
    }
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: d / 2, h: 1.6 }] };
  },

  register() {
    return { parts: [P(box(0.4, 0.15, 0.35), M.darkMetal(), 0, 0.075, 0), P(box(0.35, 0.22, 0.03), glowMat('#6fe3a8', 1, 1), 0, 0.3, -0.05, 0, -0.3)], hooks: [{ kind: 'register', x: 0, y: 0.2, z: 0.4 }] };
  },

  jukebox() {
    const parts = [
      P(box(0.9, 1.3, 0.6), M.wood('#7a2a2a'), 0, 0.65, 0),
      P(new THREE.CylinderGeometry(0.45, 0.45, 0.6, 20, 1, false, 0, Math.PI), M.wood('#7a2a2a'), 0, 1.3, 0, Math.PI / 2, 0, Math.PI / 2),
      P(box(0.7, 0.5, 0.02), glowMat('#ffb347', 2.2, 0.8), 0, 0.95, 0.31),
      P(box(0.08, 1.2, 0.02), glowMat('#ff4fa0', 2.5, 0.8), -0.4, 0.8, 0.31),
      P(box(0.08, 1.2, 0.02), glowMat('#3ff0ff', 2.5, 0.8), 0.4, 0.8, 0.31),
    ];
    return { parts, cols: [{ x: 0, z: 0, hx: 0.45, hz: 0.3, h: 1.7 }], hooks: [{ kind: 'jukebox', x: 0, y: 1, z: 0.5 }] };
  },

  piano() {
    const black = std('#111214', { rough: 0.15, metal: 0.1, key: 'piano' });
    const parts = [
      P(box(1.5, 1.2, 0.6), black, 0, 0.75, -0.1), P(box(1.5, 0.08, 0.3), black, 0, 0.72, 0.3),
      P(box(1.3, 0.03, 0.16), std('#f4f1ea', { rough: 0.3, key: 'keys' }), 0, 0.77, 0.3),
      P(box(0.08, 0.72, 0.5), black, -0.71, 0.36, 0.2), P(box(0.08, 0.72, 0.5), black, 0.71, 0.36, 0.2),
      P(box(0.9, 0.06, 0.38), black, 0, 0.48, 0.95), P(box(0.06, 0.48, 0.3), black, -0.4, 0.24, 0.95), P(box(0.06, 0.48, 0.3), black, 0.4, 0.24, 0.95),
    ];
    for (let i = 0; i < 18; i++) parts.push(P(box(0.025, 0.02, 0.09), black, -0.6 + i * 0.072, 0.795, 0.27));
    return { parts, cols: [{ x: 0, z: -0.05, hx: 0.78, hz: 0.45, h: 1.35 }, { x: 0, z: 0.95, hx: 0.45, hz: 0.19, h: 0.5 }], seats: [{ x: 0, z: 0.98, heading: Math.PI, h: 0.5, kind: 'piano', loop: 'piano', opts: { h: 0.5 } }] };
  },

  desk({ w = 1.5 } = {}) {
    const top = M.wood('#b08a60'), leg = M.darkMetal();
    const parts = [P(box(w, 0.04, 0.75), top, 0, 0.74, 0), P(box(0.04, 0.72, 0.7), leg, -w / 2 + 0.05, 0.36, 0), P(box(0.04, 0.72, 0.7), leg, w / 2 - 0.05, 0.36, 0), P(box(w - 0.1, 0.4, 0.02), leg, 0, 0.5, -0.33)];
    // Monitor and keyboard.
    parts.push(P(box(0.6, 0.36, 0.03), M.darkMetal(), 0, 1.02, -0.18), P(box(0.56, 0.32, 0.01), M.screen(), 0, 1.02, -0.163), P(box(0.05, 0.2, 0.05), M.darkMetal(), 0, 0.84, -0.2), P(box(0.45, 0.02, 0.15), std('#2a2d31', { rough: 0.5, key: 'kbd' }), 0, 0.77, 0.05));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.38, h: 0.76 }] };
  },

  officeChair() {
    const f = M.fabric('#2a2d31');
    return {
      parts: [P(box(0.48, 0.08, 0.46), f, 0, 0.48, 0), P(box(0.46, 0.55, 0.06), f, 0, 0.82, -0.22, 0, -0.1), P(cyl(0.03, 0.03, 0.4, 8), M.chrome(), 0, 0.26, 0), P(cyl(0.28, 0.28, 0.04, 5), M.darkMetal(), 0, 0.06, 0)],
      cols: [{ x: 0, z: 0, hx: 0.25, hz: 0.25, h: 1 }],
      seats: [{ x: 0, z: 0.02, heading: 0, h: 0.5, kind: 'desk', loop: 'type', opts: { h: 0.5, desk: 0.26 } }],
    };
  },

  waterCooler() {
    return { parts: [P(box(0.35, 1.0, 0.35), std('#eeeeea', { rough: 0.4, key: 'cooler' }), 0, 0.5, 0), P(cyl(0.14, 0.14, 0.45, 14), std('#7fb8e0', { rough: 0.05, key: 'jug', transparent: true, opacity: 0.6 }), 0, 1.23, 0)], cols: [{ x: 0, z: 0, hx: 0.18, hz: 0.18, h: 1.45 }], hooks: [{ kind: 'drink', x: 0, y: 0.9, z: 0.35 }] };
  },

  whiteboard() {
    return { parts: [P(box(2.0, 1.1, 0.03), std('#fafafa', { rough: 0.2, key: 'wb' }), 0, 1.5, 0), P(box(2.06, 0.05, 0.08), M.metal(), 0, 0.93, 0.03)] };
  },

  rack({ w = 1.4 } = {}) {
    const parts = [P(box(w, 0.03, 0.03), M.chrome(), 0, 1.55, 0), P(cyl(0.015, 0.015, 1.55, 6), M.chrome(), -w / 2, 0.78, 0), P(cyl(0.015, 0.015, 1.55, 6), M.chrome(), w / 2, 0.78, 0), P(box(0.5, 0.03, 0.4), M.chrome(), -w / 2, 0.02, 0), P(box(0.5, 0.03, 0.4), M.chrome(), w / 2, 0.02, 0)];
    const cols = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#f4a261', '#ffffff', '#8338ec', '#222'];
    for (let i = 0; i < Math.floor(w / 0.1); i++) parts.push(P(box(0.05, 0.75, 0.42), M.fabric(cols[(i * 5) % cols.length]), -w / 2 + 0.1 + i * 0.1, 1.15, 0));
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2 + 0.05, hz: 0.25, h: 1.6 }] };
  },

  mirror() {
    return { parts: [P(box(0.9, 1.9, 0.05), M.wood('#d4a33a'), 0, 1.1, 0), P(box(0.8, 1.8, 0.01), std('#dfe8ee', { rough: 0.02, metal: 1, key: 'mirror' }), 0, 1.1, 0.03)], cols: [{ x: 0, z: 0, hx: 0.45, hz: 0.05, h: 2 }], hooks: [{ kind: 'wardrobe', x: 0, y: 1.1, z: 0.6 }] };
  },

  toilet() {
    const p = std('#f4f4f2', { rough: 0.2, key: 'porcelain' });
    return { parts: [P(box(0.38, 0.4, 0.5), p, 0, 0.2, 0.05), P(box(0.42, 0.05, 0.5), p, 0, 0.42, 0.08), P(box(0.42, 0.38, 0.18), p, 0, 0.62, -0.2)], cols: [{ x: 0, z: 0, hx: 0.22, hz: 0.3, h: 0.8 }], seats: [{ x: 0, z: 0.1, heading: 0, h: 0.44, kind: 'toilet' }] };
  },

  tub() {
    const p = std('#f4f4f2', { rough: 0.2, key: 'porcelain' });
    return { parts: [P(box(0.8, 0.55, 1.7), p, 0, 0.275, 0), P(box(0.64, 0.02, 1.5), std('#9fd0e0', { rough: 0.05, key: 'tubwater' }), 0, 0.5, 0)], cols: [{ x: 0, z: 0, hx: 0.4, hz: 0.85, h: 0.55 }] };
  },

  basin() {
    const p = std('#f4f4f2', { rough: 0.2, key: 'porcelain' });
    return { parts: [P(box(0.55, 0.15, 0.42), p, 0, 0.85, 0), P(cyl(0.06, 0.08, 0.78, 8), p, 0, 0.39, -0.05), P(box(0.5, 0.7, 0.02), std('#dfe8ee', { rough: 0.02, metal: 1, key: 'mirror' }), 0, 1.5, -0.2)], cols: [{ x: 0, z: 0, hx: 0.28, hz: 0.21, h: 0.95 }], hooks: [{ kind: 'sink', x: 0, y: 0.9, z: 0.45 }] };
  },

  poolTable() {
    return { parts: [P(box(2.5, 0.12, 1.4), M.wood('#5a3a22'), 0, 0.78, 0), P(box(2.3, 0.02, 1.2), std('#1f6b3a', { rough: 0.9, key: 'felt' }), 0, 0.845, 0), ...[[-1.1, -0.55], [1.1, -0.55], [-1.1, 0.55], [1.1, 0.55]].map(([x, z]) => P(box(0.12, 0.75, 0.12), M.wood('#5a3a22'), x, 0.37, z)), ...[['#ffffff', 0.6, 0], ['#d62828', -0.5, 0.1], ['#f1c40f', -0.6, -0.1], ['#1d3557', -0.7, 0.05], ['#111', -0.62, 0.2]].map(([c, x, z]) => P(new THREE.SphereGeometry(0.028, 8, 6), std(c, { rough: 0.2, key: 'ball' }), x, 0.88, z))], cols: [{ x: 0, z: 0, hx: 1.25, hz: 0.7, h: 0.85 }] };
  },

  bottles({ w = 3 } = {}) {
    const parts = [P(box(w, 2.2, 0.35), M.wood('#2a1a14'), 0, 1.1, -0.05)];
    const glowCols = ['#ffb347', '#7fffd4', '#ff4fa0', '#c3a6ff', '#fff4c0'];
    for (let s = 0; s < 3; s++) {
      parts.push(P(box(w - 0.1, 0.03, 0.3), glowMat('#ff66cc', 1.4, 0.5), 0, 1.05 + s * 0.4, 0.05));
      for (let i = 0; i < Math.floor(w / 0.12); i++) {
        const c = glowCols[(i + s) % glowCols.length];
        parts.push(P(cyl(0.035, 0.04, 0.26 + (i % 3) * 0.04, 8), std(c, { rough: 0.05, metal: 0.1, key: 'bottle', emissive: c, ei: 0.35 }), -w / 2 + 0.1 + i * 0.12, 1.2 + s * 0.4, 0.07));
      }
    }
    return { parts, cols: [{ x: 0, z: 0, hx: w / 2, hz: 0.2, h: 2.2 }] };
  },

  micStand() {
    return { parts: [P(cyl(0.12, 0.14, 0.03), M.darkMetal(), 0, 0.015, 0), P(cyl(0.012, 0.012, 1.5, 6), M.darkMetal(), 0, 0.75, 0), P(new THREE.SphereGeometry(0.04, 8, 6), M.metal(), 0, 1.52, 0.02)], cols: [{ x: 0, z: 0, hx: 0.1, hz: 0.1, h: 1.5 }] };
  },

  atm() {
    return { parts: [P(box(0.7, 1.6, 0.6), M.metal(), 0, 0.8, 0), P(box(0.4, 0.3, 0.02), glowMat('#7fd3ff', 1.2, 1), 0, 1.25, 0.31)], cols: [{ x: 0, z: 0, hx: 0.35, hz: 0.3, h: 1.6 }], hooks: [{ kind: 'use', x: 0, y: 1.2, z: 0.6, label: 'Use ATM' }] };
  },

  painting({ w = 1.2, h = 0.8, seed = 1 } = {}) {
    const palette = [['#264653', '#e9c46a'], ['#e76f51', '#2a9d8f'], ['#8338ec', '#ffbe0b'], ['#1d3557', '#f1faee']][seed % 4];
    return { parts: [P(box(w + 0.08, h + 0.08, 0.04), M.wood('#d4a33a'), 0, 0, 0), P(box(w, h * 0.5, 0.01), std(palette[0], { rough: 0.8, key: 'paint1' }), 0, h * 0.25, 0.025), P(box(w, h * 0.5, 0.01), std(palette[1], { rough: 0.8, key: 'paint2' }), 0, -h * 0.25, 0.025)] };
  },
};
