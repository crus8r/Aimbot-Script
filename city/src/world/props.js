// The prop catalogue: named things, built from primitives, with their
// collision and their seats. Named types rather than raw shapes on purpose —
// a "bench" knows it seats two at 45cm; a grey box knows nothing.
import * as THREE from 'three';
import { box, mat4, partsByMaterial } from './build.js';
import { M, std, glowMat, nightLit } from './materials.js';
import { palmParts, treeParts } from './nature.js';

const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);

// Each entry: parts() -> [{geo, material, m}], collider {hx,hz,h} or null,
// seats: [{x,z,heading,h,kind}] in prop-local space (prop faces +Z).
export const PROPS = {
  lamp: {
    parts: () => {
      const pole = M.darkMetal();
      return [
        { geo: cyl(0.07, 0.11, 6.6, 8), material: pole, m: mat4(0, 3.3, 0) },
        { geo: cyl(0.16, 0.2, 0.5, 8), material: pole, m: mat4(0, 0.25, 0) },
        { geo: box(0.08, 0.08, 1.5), material: pole, m: mat4(0, 6.5, 0.7) },
        { geo: box(0.36, 0.14, 0.62), material: pole, m: mat4(0, 6.45, 1.35) },
        { geo: box(0.3, 0.03, 0.54), material: M.lampGlow(), m: mat4(0, 6.37, 1.35) },
      ];
    },
    collider: { hx: 0.14, hz: 0.14, h: 6.6 },
    light: { x: 0, y: 6.2, z: 1.35 },
  },
  bench: {
    parts: () => {
      const wood = M.wood('#9a6a42'), iron = M.darkMetal();
      const p = [];
      for (let i = 0; i < 4; i++) p.push({ geo: box(1.8, 0.04, 0.1), material: wood, m: mat4(0, 0.44, -0.18 + i * 0.12) });
      for (let i = 0; i < 3; i++) p.push({ geo: box(1.8, 0.1, 0.035), material: wood, m: mat4(0, 0.6 + i * 0.13, -0.25, 0, 1, 1, 1, -0.2) });
      for (const x of [-0.8, 0.8]) {
        p.push({ geo: box(0.06, 0.44, 0.5), material: iron, m: mat4(x, 0.22, -0.02) });
        p.push({ geo: box(0.06, 0.5, 0.06), material: iron, m: mat4(x, 0.7, -0.27, 0, 1, 1, 1, -0.2) });
        p.push({ geo: box(0.06, 0.05, 0.45), material: iron, m: mat4(x, 0.64, 0.0) });
      }
      return p;
    },
    collider: { hx: 0.9, hz: 0.28, h: 0.9 },
    seats: [{ x: -0.45, z: 0.02, heading: 0, h: 0.45, kind: 'bench' }, { x: 0.45, z: 0.02, heading: 0, h: 0.45, kind: 'bench' }],
  },
  trash: {
    parts: () => [
      { geo: cyl(0.28, 0.25, 0.9, 12), material: std('#2f5a3a', { rough: 0.5, metal: 0.4, key: 'bin' }), m: mat4(0, 0.45, 0) },
      { geo: cyl(0.3, 0.3, 0.06, 12), material: M.darkMetal(), m: mat4(0, 0.92, 0) },
    ],
    collider: { hx: 0.3, hz: 0.3, h: 1 },
  },
  hydrant: {
    parts: () => {
      const red = std('#c1272d', { rough: 0.45, metal: 0.3, key: 'hydrant' });
      return [
        { geo: cyl(0.13, 0.15, 0.6, 10), material: red, m: mat4(0, 0.3, 0) },
        { geo: new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), material: red, m: mat4(0, 0.6, 0) },
        { geo: cyl(0.05, 0.05, 0.42, 8), material: red, m: mat4(0, 0.4, 0, 0, 1, 1, 1, 0, Math.PI / 2) },
        { geo: cyl(0.18, 0.18, 0.05, 10), material: red, m: mat4(0, 0.05, 0) },
      ];
    },
    collider: { hx: 0.2, hz: 0.2, h: 0.7 },
  },
  newsbox: {
    parts: () => [
      { geo: box(0.5, 0.9, 0.45), material: std('#1d5fa8', { rough: 0.4, metal: 0.2, key: 'newsbox' }), m: mat4(0, 0.45, 0) },
      { geo: box(0.4, 0.3, 0.02), material: std('#dfe6ea', { rough: 0.2, key: 'newswin' }), m: mat4(0, 0.7, 0.23) },
    ],
    collider: { hx: 0.26, hz: 0.24, h: 0.9 },
  },
  meter: {
    parts: () => [
      { geo: cyl(0.03, 0.03, 1.1, 6), material: M.darkMetal(), m: mat4(0, 0.55, 0) },
      { geo: box(0.16, 0.3, 0.12), material: M.metal(), m: mat4(0, 1.2, 0) },
      { geo: box(0.1, 0.08, 0.02), material: glowMat('#ff4040', 1.4, 0.6), m: mat4(0, 1.26, 0.06) },
    ],
    collider: { hx: 0.08, hz: 0.08, h: 1.3 },
  },
  planter: {
    parts: () => {
      const p = [{ geo: box(1.2, 0.5, 1.2), material: M.plaster('#bdb5a6'), m: mat4(0, 0.25, 0) }];
      for (let i = 0; i < 4; i++) p.push({ geo: new THREE.IcosahedronGeometry(0.38, 1), material: M.leaves(), m: mat4((i % 2 - 0.5) * 0.45, 0.72, (Math.floor(i / 2) - 0.5) * 0.45) });
      return p;
    },
    collider: { hx: 0.6, hz: 0.6, h: 0.5 },
    seats: [{ x: 0, z: 0.72, heading: 0, h: 0.5, kind: 'bench' }],
  },
  busstop: {
    parts: () => {
      const frame = M.metal(), glass = M.glass();
      const p = [
        { geo: box(3.6, 0.1, 1.5), material: frame, m: mat4(0, 2.55, 0) },
        { geo: box(3.6, 2.2, 0.03), material: glass, m: mat4(0, 1.4, -0.7) },
        { geo: box(0.03, 2.2, 1.2), material: glass, m: mat4(-1.78, 1.4, -0.1) },
        { geo: box(1.2, 1.8, 0.06), material: glowMat('#fff3d6', 0.8, 0.35), m: mat4(1.2, 1.3, -0.66) },
        { geo: box(2.2, 0.06, 0.4), material: M.wood('#8a5a36'), m: mat4(-0.4, 0.46, -0.45) },
        { geo: box(0.08, 0.46, 0.3), material: frame, m: mat4(-1.3, 0.23, -0.45) },
        { geo: box(0.08, 0.46, 0.3), material: frame, m: mat4(0.5, 0.23, -0.45) },
      ];
      for (const x of [-1.75, 1.75]) for (const z of [-0.7, 0.65]) p.push({ geo: box(0.07, 2.5, 0.07), material: frame, m: mat4(x, 1.25, z) });
      return p;
    },
    collider: null,
    walls: [{ x: 0, z: -0.7, hx: 1.8, hz: 0.06, h: 2.5 }, { x: -1.78, z: -0.1, hx: 0.06, hz: 0.6, h: 2.5 }],
    seats: [{ x: -1.1, z: -0.4, heading: 0, h: 0.48, kind: 'bench' }, { x: -0.3, z: -0.4, heading: 0, h: 0.48, kind: 'bench' }, { x: 0.4, z: -0.4, heading: 0, h: 0.48, kind: 'bench' }],
  },
  phonebooth: {
    parts: () => [
      { geo: box(0.9, 2.3, 0.9), material: M.glass(), m: mat4(0, 1.2, 0) },
      { geo: box(0.95, 0.15, 0.95), material: std('#b01e24', { rough: 0.5, key: 'booth' }), m: mat4(0, 2.4, 0) },
      { geo: box(0.3, 0.45, 0.15), material: M.metal(), m: mat4(0, 1.45, -0.35) },
    ],
    collider: null,
    walls: [{ x: 0, z: -0.43, hx: 0.45, hz: 0.04, h: 2.4 }, { x: -0.43, z: 0, hx: 0.04, hz: 0.45, h: 2.4 }, { x: 0.43, z: 0, hx: 0.04, hz: 0.45, h: 2.4 }],
  },
  vending: {
    parts: () => [
      { geo: box(0.95, 1.9, 0.8), material: std('#c21f32', { rough: 0.4, metal: 0.2, key: 'vend' }), m: mat4(0, 0.95, 0) },
      { geo: box(0.6, 1.3, 0.02), material: glowMat('#fff0e0', 1.6, 0.5), m: mat4(-0.1, 1.15, 0.41) },
      { geo: box(0.2, 0.5, 0.02), material: M.darkMetal(), m: mat4(0.33, 1.2, 0.41) },
    ],
    collider: { hx: 0.48, hz: 0.4, h: 1.9 },
  },
  umbrella: {
    parts: () => {
      const cone = new THREE.ConeGeometry(1.35, 0.55, 12, 1, true);
      return [
        { geo: cyl(0.03, 0.03, 2.4, 6), material: M.chrome(), m: mat4(0, 1.2, 0) },
        { geo: cone, material: M.stripes('#f4f1ea', '#e76f51', 12), m: mat4(0, 2.35, 0) },
      ];
    },
    collider: { hx: 0.05, hz: 0.05, h: 2.4 },
  },
  lounger: {
    parts: () => {
      const f = M.fabric('#2a9d8f'), frame = M.chrome();
      return [
        { geo: box(0.62, 0.06, 1.25), material: f, m: mat4(0, 0.34, 0.25) },
        { geo: box(0.62, 0.06, 0.75), material: f, m: mat4(0, 0.58, -0.62, 0, 1, 1, 1, 0.75) },
        { geo: box(0.04, 0.34, 0.04), material: frame, m: mat4(-0.28, 0.17, 0.8) },
        { geo: box(0.04, 0.34, 0.04), material: frame, m: mat4(0.28, 0.17, 0.8) },
        { geo: box(0.04, 0.34, 0.04), material: frame, m: mat4(-0.28, 0.17, -0.3) },
        { geo: box(0.04, 0.34, 0.04), material: frame, m: mat4(0.28, 0.17, -0.3) },
      ];
    },
    collider: { hx: 0.32, hz: 0.9, h: 0.4 },
  },
  towel: {
    parts: () => [{ geo: box(0.9, 0.01, 1.8), material: M.stripes('#ffd166', '#ef476f', 6), m: mat4(0, 0.005, 0) }],
    collider: null,
  },
  lifeguard: {
    parts: () => {
      const wood = M.planks('#d9cfb8'), red = std('#d62828', { rough: 0.6, key: 'lgred' });
      const p = [
        { geo: box(2.6, 2.2, 2.4), material: std('#7fd1c9', { rough: 0.7, key: 'lgcab' }), m: mat4(0, 3.3, 0) },
        { geo: box(3.0, 0.2, 2.8), material: red, m: mat4(0, 4.5, 0) },
        { geo: box(3.2, 0.15, 3.6), material: wood, m: mat4(0, 2.15, 0.4) },
        { geo: box(1.6, 0.5, 0.05), material: std('#1a3a4a', { rough: 0.1, key: 'lgwin' }), m: mat4(0, 3.6, 1.21) },
      ];
      for (const x of [-1.3, 1.3]) for (const z of [-1.1, 1.1]) p.push({ geo: box(0.18, 2.2, 0.18), material: wood, m: mat4(x, 1.1, z) });
      for (let i = 0; i < 8; i++) p.push({ geo: box(0.9, 0.06, 0.25), material: wood, m: mat4(0, 0.25 * i + 0.1, 2.2 + (7 - i) * 0.25 * 0.0 + 2.0 - i * 0.25) });
      return p;
    },
    collider: { hx: 1.4, hz: 1.2, h: 4.6 },
  },
  cone: {
    parts: () => [
      { geo: new THREE.ConeGeometry(0.17, 0.7, 12), material: std('#ff6a1a', { rough: 0.5, key: 'cone' }), m: mat4(0, 0.37, 0) },
      { geo: box(0.42, 0.04, 0.42), material: std('#ff6a1a', { rough: 0.5, key: 'cone' }), m: mat4(0, 0.02, 0) },
    ],
    collider: { hx: 0.2, hz: 0.2, h: 0.7 },
  },
  picnic: {
    parts: () => {
      const w = M.wood('#9a7048');
      return [
        { geo: box(1.8, 0.05, 0.8), material: w, m: mat4(0, 0.74, 0) },
        { geo: box(1.8, 0.05, 0.3), material: w, m: mat4(0, 0.45, 0.62) },
        { geo: box(1.8, 0.05, 0.3), material: w, m: mat4(0, 0.45, -0.62) },
        { geo: box(0.06, 0.8, 1.5), material: w, m: mat4(-0.7, 0.38, 0) },
        { geo: box(0.06, 0.8, 1.5), material: w, m: mat4(0.7, 0.38, 0) },
      ];
    },
    collider: { hx: 0.9, hz: 0.8, h: 0.78 },
    seats: [{ x: -0.4, z: 0.66, heading: Math.PI, h: 0.47, kind: 'bench', loop: 'sit', opts: { hands: 'table' } }, { x: 0.4, z: -0.66, heading: 0, h: 0.47, kind: 'bench', opts: { hands: 'table' } }],
  },
};

// Palm and tree variants join the catalogue once built.
for (let v = 0; v < 4; v++) PROPS[`palm${v}`] = { parts: () => palmParts(100 + v, 7 + v * 1.3), collider: { hx: 0.25, hz: 0.25, h: 5 }, instancedParts: true };
for (let v = 0; v < 3; v++) PROPS[`tree${v}`] = { parts: () => treeParts(200 + v), collider: { hx: 0.25, hz: 0.25, h: 3 }, instancedParts: true };

// Converts a local seat into world space for a prop at (x,y,z,rot).
export function seatToWorld(s, x, y, z, rot) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return { ...s, x: x + s.x * c + s.z * sn, z: z - s.x * sn + s.z * c, y, heading: s.heading + rot };
}

export function colliderToWorld(cdef, x, y, z, rot) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return { x: x + (cdef.x || 0) * c + (cdef.z || 0) * sn, z: z - (cdef.x || 0) * sn + (cdef.z || 0) * c, hx: cdef.hx, hz: cdef.hz, rot, y0: y, y1: y + cdef.h };
}

export function builtParts(name) {
  const def = PROPS[name];
  if (!def._built) def._built = partsByMaterial(def.parts());
  return def._built;
}
