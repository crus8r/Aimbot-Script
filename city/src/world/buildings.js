// Building exteriors from the plan's lots: a shopfront storey, window-bay
// facades above, ledges and cornices by style, parapet and roof clutter,
// hotel neon. Enterable lots get their ground floor from interiors.js.
import * as THREE from 'three';
import { box, plane, mat4 } from './build.js';
import { M, std, facadeMat, shopMat, neonMat, glowMat } from './materials.js';
import { CURB_H } from './layout.js';
import { rng, shade } from './textures.js';

export const GF = 4.4;          // ground-floor height (shopfronts)
const FLOOR = 3.4;
const BAY = 3;

// A vertical wall quad from (ax,az) to (bx,bz), facing `n` (outward).
export function wallQuad(ax, az, bx, bz, y0, y1, n, { u0 = 0, v0 = 0, tu = 1, tv = 1 } = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  const g = new THREE.BufferGeometry();
  const pos = [ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az];
  const uv = [u0, v0, u0 + len / tu, v0, u0 + len / tu, v0 + (y1 - y0) / tv, u0, v0 + (y1 - y0) / tv];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([...n, ...n, ...n, ...n], 3));
  // Winding must agree with the normal or the face culls away.
  const e1 = new THREE.Vector3(bx - ax, 0, bz - az), e2 = new THREE.Vector3(bx - ax, y1 - y0, bz - az);
  const cross = e1.clone().cross(e2);
  const facing = cross.x * n[0] + cross.y * n[1] + cross.z * n[2];
  g.setIndex(facing > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}

// The four sides of a footprint, each with its outward normal. The first
// entry is always the front (the `face` side).
export function sides(x0, x1, z0, z1, face) {
  const all = {
    n: { a: [x1, z0], b: [x0, z0], n: [0, 0, -1], len: x1 - x0 },
    s: { a: [x0, z1], b: [x1, z1], n: [0, 0, 1], len: x1 - x0 },
    e: { a: [x1, z1], b: [x1, z0], n: [1, 0, 0], len: z1 - z0 },
    w: { a: [x0, z0], b: [x0, z1], n: [-1, 0, 0], len: z1 - z0 },
  };
  const order = [face, ...['n', 's', 'e', 'w'].filter((k) => k !== face)];
  return order.map((k) => ({ key: k, ...all[k] }));
}

export function buildBuilding(game, B, lot, { skipGround = false, noCollider = false } = {}) {
  const r = rng(lot.seed || 1);
  const { x0, x1, z0, z1, h } = lot;
  const base = CURB_H;
  const top = base + Math.max(h, GF + 0.2);
  const style = lot.style;
  const wallM = M.plaster(lot.wall);
  const fac = facadeMat(style, lot.wall, lot.trim, lot.glass || '#4f6f80');
  const trimM = std(lot.trim, { rough: 0.7, key: 'trim' });
  const uOff = Math.floor(r() * 40), vOff = Math.floor(r() * 40);
  const faces = sides(x0, x1, z0, z1, lot.face);
  const tower = style === 'glass' && h > 45;
  // Glass towers: a podium, then an inset shaft.
  const inset = tower ? 3 : 0;
  const podiumTop = tower ? base + GF + FLOOR * 3 : top;

  for (let k = 0; k < faces.length; k++) {
    const f = faces[k];
    const [ax, az] = f.a, [bx, bz] = f.b;
    // Ground floor.
    if (!skipGround) {
      if (k === 0 && lot.shop) {
        B.add(wallQuad(ax, az, bx, bz, base, base + GF, f.n, { tu: 9, tv: GF }), shopMat(shade(lot.wall, -0.05), lot.trim, lot.signColor, lot.shop));
      } else {
        B.add(wallQuad(ax, az, bx, bz, base, base + GF, f.n, { tu: 3, tv: 3 }), wallM);
      }
    }
    // Upper storeys (podium part).
    if (podiumTop > base + GF + 0.1) {
      // A sliver above a one-storey building is parapet, not a floor of windows.
      const plain = podiumTop - (base + GF) < 2.5;
      B.add(wallQuad(ax, az, bx, bz, base + GF, podiumTop, f.n, plain ? { tu: 3, tv: 3 } : { u0: uOff + k * 7, v0: vOff, tu: BAY, tv: FLOOR }), plain ? wallM : fac);
    }
  }

  // Tower shaft.
  if (tower) {
    const ts = sides(x0 + inset, x1 - inset, z0 + inset, z1 - inset, lot.face);
    ts.forEach((f, k) => {
      B.add(wallQuad(f.a[0], f.a[1], f.b[0], f.b[1], podiumTop, top, f.n, { u0: uOff + k * 5, v0: vOff + 3, tu: BAY, tv: FLOOR }), fac);
    });
    roof(B, x0 + inset, x1 - inset, z0 + inset, z1 - inset, top, trimM, r, 'tower');
    roof(B, x0, x1, z0, z1, podiumTop, trimM, r, 'podium');
  } else {
    roof(B, x0, x1, z0, z1, top, trimM, r, style);
  }

  // Ledges: a canopy over the shopfront, floor bands by style.
  const front = faces[0];
  const along = front.key === 'n' || front.key === 's';
  const fn = front.n;
  const fx = front.key === 'e' ? x1 : front.key === 'w' ? x0 : (x0 + x1) / 2;
  const fz = front.key === 's' ? z1 : front.key === 'n' ? z0 : (z0 + z1) / 2;
  if (!skipGround) {
    const cw = along ? x1 - x0 : z1 - z0;
    B.add(box(along ? cw : 1.1, 0.18, along ? 1.1 : cw), trimM, mat4(fx + fn[0] * 0.55, base + GF - 0.1, fz + fn[2] * 0.55));
  }
  if (style === 'deco' || style === 'apart') {
    const every = style === 'deco' ? 1 : 1;
    for (let y = base + GF + FLOOR * every; y < top - 0.5; y += FLOOR * every) {
      for (const f of faces) {
        const isX = f.key === 'e' || f.key === 'w';
        const len = f.len + 0.3;
        const px = f.key === 'e' ? x1 : f.key === 'w' ? x0 : (x0 + x1) / 2;
        const pz = f.key === 's' ? z1 : f.key === 'n' ? z0 : (z0 + z1) / 2;
        const depth = style === 'deco' ? 0.22 : 0.12;
        B.add(box(isX ? depth : len, 0.14, isX ? len : depth), style === 'deco' ? trimM : M.plaster(shade(lot.wall, -0.1)), mat4(px + f.n[0] * depth / 2, y, pz + f.n[2] * depth / 2), { shadow: false });
      }
    }
  }

  // Deco hotels: a central fin rising above the roof, and the name in neon.
  if (lot.hotel) {
    const fw = 1.4, fd = 0.9, fh = top - base - GF + 3.5;
    B.add(box(along ? fw : fd, fh, along ? fd : fw, { tile: 2 }), trimM, mat4(fx + fn[0] * fd / 2, base + GF + fh / 2, fz + fn[2] * fd / 2));
    const neon = neonMat(lot.hotel, lot.trim === '#ffffff' ? '#ff4fa0' : lot.trim === '#2a9d8f' ? '#3ff0ff' : '#ffd23f');
    const len = Math.min((along ? x1 - x0 : z1 - z0) * 0.8, 16);
    const sg = new THREE.PlaneGeometry(len, len / 4);
    const yaw = Math.atan2(fn[0], fn[2]);
    B.add(sg, neon, mat4(fx + fn[0] * 0.3, top + len / 8 + 0.3, fz + fn[2] * 0.3, yaw), { shadow: false });
    // Sign frame.
    B.add(box(along ? len : 0.1, 0.1, along ? 0.1 : len), M.darkMetal(), mat4(fx, top + 0.25, fz));
    // Vertical blade sign on the fin.
    const blade = neonMat(lot.hotel.split(' ').pop(), '#3ff0ff');
    const bg = new THREE.PlaneGeometry(fh * 0.5, 1.0);
    bg.rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) {
      const side = along ? [s * (fw / 2 + 0.02), 0] : [0, s * (fw / 2 + 0.02)];
      B.add(bg.clone(), blade, mat4(fx + fn[0] * (fd - 0.3) + side[0], base + GF + fh * 0.55, fz + fn[2] * (fd - 0.3) + side[1], yaw + s * Math.PI / 2), { shadow: false });
    }
  }

  // Awning over the door on smaller shops.
  if (!skipGround && lot.shop && !lot.hotel && r() < 0.7 && style !== 'glass') {
    const aw = new THREE.PlaneGeometry(4.2, 1.8);
    aw.rotateX(-Math.PI / 2 + 0.45);
    const yaw = Math.atan2(fn[0], fn[2]);
    const cols = [['#e8e4dc', lot.signColor], ['#e8e4dc', '#2a9d8f'], ['#f2d0a4', '#c75b39']][Math.floor(r() * 3)];
    const doorAlong = along ? fx + (x1 - x0) * 0.18 : fx;
    const doorAlongZ = along ? fz : fz + (z1 - z0) * 0.18;
    B.add(aw, M.stripes(cols[0], cols[1], 8), mat4(doorAlong + fn[0] * 0.95, base + 3.2, doorAlongZ + fn[2] * 0.95, yaw));
  }

  if (!noCollider) game.physics.add({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y0: 0, y1: top, tag: 'building', ref: lot });
  return { top };
}

function roof(B, x0, x1, z0, z1, top, trimM, r, style) {
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  B.add(plane(w, d, { tile: 3 }), M.roof(), mat4(cx, top, cz), { shadow: false });
  const ph = style === 'tower' ? 1.2 : style === 'deco' ? 1.0 : 0.7, pt = 0.3;
  const pm = style === 'deco' || style === 'podium' || style === 'tower' ? trimM : M.plaster('#cfc8bb');
  B.add(box(w, ph, pt), pm, mat4(cx, top + ph / 2, z0 + pt / 2));
  B.add(box(w, ph, pt), pm, mat4(cx, top + ph / 2, z1 - pt / 2));
  B.add(box(pt, ph, d - pt * 2), pm, mat4(x0 + pt / 2, top + ph / 2, cz));
  B.add(box(pt, ph, d - pt * 2), pm, mat4(x1 - pt / 2, top + ph / 2, cz));
  // Clutter: AC units, a water tank, a stair head.
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const ax = x0 + 2 + r() * (w - 4), az = z0 + 2 + r() * (d - 4);
    B.add(box(1.6, 1.0, 1.1), M.metal(), mat4(ax, top + 0.5, az, r() * Math.PI));
  }
  if (style === 'apart' || style === 'brick') {
    if (r() < 0.6) {
      const tx = x0 + 3 + r() * (w - 6), tz = z0 + 3 + r() * (d - 6);
      B.add(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 12), M.wood('#6b4a30'), mat4(tx, top + 2.4, tz));
      B.add(new THREE.ConeGeometry(1.2, 0.7, 12), M.darkMetal(), mat4(tx, top + 3.85, tz));
      for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) B.add(box(0.12, 1.3, 0.12), M.darkMetal(), mat4(tx + dx, top + 0.65, tz + dz));
    }
  }
  if (style === 'tower') {
    B.add(box(Math.min(8, w * 0.4), 3.5, Math.min(8, d * 0.4)), M.metal(), mat4(cx, top + 1.75, cz));
    if (r() < 0.5) {
      B.add(new THREE.CylinderGeometry(0.15, 0.25, 12, 6), M.metal(), mat4(cx, top + 9.5, cz));
      B.add(new THREE.SphereGeometry(0.35, 8, 6), glowMat('#ff2a1a', 6, 0.6), mat4(cx, top + 15.6, cz), { shadow: false });
    }
  }
}
