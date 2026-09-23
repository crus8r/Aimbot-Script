// Enterable ground floors. A Room is laid out in its own frame — front wall
// at +Z facing the street, x across the shopfront — then mapped onto the
// lot. Walls get real openings (door, display windows), so the camera and
// the characters can see and walk in without a loading screen.
import * as THREE from 'three';
import { box, plane, mat4 } from './build.js';
import { M, std, glowMat, neonMat, nightLit, wallT } from './materials.js';
import { CURB_H } from './layout.js';
import { buildBuilding, GF } from './buildings.js';
import { F } from './furniture.js';
import { makeSeat } from '../game/seats.js';
import { rng } from './textures.js';

const FACE_YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };

export class Room {
  constructor(world, lot, W, D, { ceiling = 3.4, name } = {}) {
    this.world = world;
    this.game = world.game;
    this.B = world.B;
    this.lot = lot;
    this.W = W; this.D = D;
    this.ceil = ceiling;
    this.name = name;
    this.yaw = FACE_YAW[lot.face];
    const n = { s: [0, 1], e: [1, 0], n: [0, -1], w: [-1, 0] }[lot.face];
    const fx = lot.face === 'e' ? lot.x1 : lot.face === 'w' ? lot.x0 : (lot.x0 + lot.x1) / 2;
    const fz = lot.face === 's' ? lot.z1 : lot.face === 'n' ? lot.z0 : (lot.z0 + lot.z1) / 2;
    this.cx = fx - n[0] * D / 2;
    this.cz = fz - n[1] * D / 2;
    this.y = CURB_H;
    this.c = Math.cos(this.yaw); this.s = Math.sin(this.yaw);
    this.hooks = [];
    this.doors = [];
    this.lightSpots = [];
  }

  // Local (x,z) -> world (x,z).
  w(lx, lz) { return [this.cx + lx * this.c + lz * this.s, this.cz - lx * this.s + lz * this.c]; }
  m(lx, ly, lz, rot = 0) { const [x, z] = this.w(lx, lz); return mat4(x, this.y + ly, z, this.yaw + rot); }

  inside(x, z, pad = 0) {
    const dx = x - this.cx, dz = z - this.cz;
    const lx = dx * this.c - dz * this.s, lz = dx * this.s + dz * this.c;
    return Math.abs(lx) < this.W / 2 + pad && Math.abs(lz) < this.D / 2 + pad;
  }

  box(lx, ly, lz, w, h, d, material, { rot = 0, collide = false, noCam = false, tile = 1, shadow = true } = {}) {
    this.B.add(box(w, h, d, { tile }), material, this.m(lx, ly + h / 2, lz, rot), { shadow });
    if (collide) {
      const [x, z] = this.w(lx, lz);
      this.game.physics.add({ x, z, hx: w / 2, hz: d / 2, rot: this.yaw + rot, y0: this.y + ly, y1: this.y + ly + h, tag: 'wall', noCam });
    }
  }

  // Straight wall from (ax,az) to (bx,bz) along a local axis, with openings
  // [{at, width, bottom, top, glass}] measured along the wall from `a`.
  wall(ax, az, bx, bz, { material, openings = [], t = 0.2, h = this.ceil, outer = null } = {}) {
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const along = Math.abs(ux) > 0.5;
    const seg = (s0, s1, y0, y1, mat, col = true) => {
      if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
      const mid = (s0 + s1) / 2;
      const lx = ax + ux * mid, lz = az + uz * mid;
      this.box(lx, y0, lz, along ? s1 - s0 : t, y1 - y0, along ? t : s1 - s0, mat, { collide: col, tile: 2 });
    };
    const ops = [...openings].sort((a, b) => a.at - b.at);
    let s = 0;
    for (const o of ops) {
      const o0 = o.at - o.width / 2, o1 = o.at + o.width / 2;
      seg(s, o0, 0, h, material);
      seg(o0, o1, o.top, h, material, false);
      if (o.bottom > 0) seg(o0, o1, 0, o.bottom, material);
      if (o.glass) {
        const mid = o.at, lx = ax + ux * mid, lz = az + uz * mid;
        this.B.add(box(along ? o.width : 0.02, o.top - o.bottom, along ? 0.02 : o.width), M.glass(), this.m(lx, (o.bottom + o.top) / 2, lz), { shadow: false });
        const [x, z] = this.w(lx, lz);
        this.game.physics.add({ x, z, hx: (along ? o.width : 0.1) / 2, hz: (along ? 0.1 : o.width) / 2, rot: this.yaw, y0: this.y, y1: this.y + o.top, tag: 'glass', noCam: true });
        // Mullions.
        const nm = Math.max(1, Math.round(o.width / 1.6));
        for (let k = 1; k < nm; k++) {
          const ms = o0 + (k * o.width) / nm;
          this.box(ax + ux * ms, o.bottom, az + uz * ms, along ? 0.06 : 0.08, o.top - o.bottom, along ? 0.08 : 0.06, M.darkMetal());
        }
      }
      s = o1;
    }
    seg(s, len, 0, h, material);
  }

  floor(material, tile = 1) {
    this.B.add(plane(this.W, this.D, { tile }), material, this.m(0, 0.012, 0), { shadow: false });
  }

  ceiling(material) {
    const g = plane(this.W, this.D, { tile: 2 });
    g.rotateX(Math.PI);
    this.B.add(g, material, this.m(0, this.ceil, 0));
  }

  // Place a furniture item; registers its colliders, seats and hooks.
  put(def, lx, lz, rot = 0, { ly = 0 } = {}) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const loc = (x, z) => [lx + x * c + z * s, lz - x * s + z * c];
    // Furniture sits under a ceiling that already shades it from the sun,
    // and room lights cast no shadows: casting would only cost a draw each.
    for (const p of def.parts) {
      const g = p.geo.clone();
      if (p.m) g.applyMatrix4(p.m);
      this.B.add(g, p.material, this.m(lx, ly, lz, rot), { shadow: false });
    }
    for (const col of def.cols || []) {
      const [x, z] = loc(col.x, col.z);
      const [wx, wz] = this.w(x, z);
      this.game.physics.add({ x: wx, z: wz, hx: col.hx, hz: col.hz, rot: this.yaw + rot, y0: this.y + ly + (col.y0 || 0), y1: this.y + ly + col.h, tag: 'furniture', noCam: col.h < 1.4 });
    }
    for (const st of def.seats || []) {
      const [x, z] = loc(st.x, st.z);
      const [wx, wz] = this.w(x, z);
      const seat = makeSeat({ x: wx, y: this.y + ly, z: wz, heading: this.yaw + rot + st.heading, h: st.h, kind: st.kind, loop: st.loop, opts: st.opts });
      seat.room = this;
      this.world.addSeat(seat, this.name);
    }
    for (const hk of def.hooks || []) {
      const [x, z] = loc(hk.x, hk.z);
      const [wx, wz] = this.w(x, z);
      this.hooks.push({ ...hk, pos: new THREE.Vector3(wx, this.y + ly + hk.y, wz), yaw: this.yaw + rot, room: this, local: { x: lx, z: lz, rot } });
    }
    return def;
  }

  light(lx, ly, lz, { color = '#ffe2b8', intensity = 14, range = 11 } = {}) {
    const [x, z] = this.w(lx, lz);
    const spot = this.world.lights.add({ pos: new THREE.Vector3(x, this.y + ly, z), color, intensity, range, priority: 4, room: this });
    this.lightSpots.push(spot);
    return spot;
  }

  door(at, width = 1.1, { glass = true, color = '#2a2d31' } = {}) {
    // Front wall is at z = D/2; `at` is local x of the door centre.
    const hinge = new THREE.Group();
    const [hx, hz] = this.w(at - width / 2, this.D / 2);
    hinge.position.set(hx, this.y, hz);
    hinge.rotation.y = this.yaw;
    const leaf = new THREE.Mesh(box(width - 0.04, 2.25, 0.05), glass ? M.glass() : M.wood(color));
    leaf.position.set(width / 2, 1.125, 0);
    hinge.add(leaf);
    const frame = new THREE.Mesh(box(width, 0.08, 0.07), M.darkMetal());
    frame.position.set(width / 2, 2.24, 0); hinge.add(frame);
    const handle = new THREE.Mesh(box(0.04, 0.3, 0.08), M.chrome());
    handle.position.set(width - 0.12, 1.05, 0.05); hinge.add(handle);
    if (glass) {
      for (const [y, h] of [[0.04, 0.08], [2.2, 0.08]]) { const r = new THREE.Mesh(box(width - 0.04, h, 0.06), M.darkMetal()); r.position.set(width / 2, y, 0); hinge.add(r); }
      for (const x of [0.03, width - 0.07]) { const r = new THREE.Mesh(box(0.06, 2.25, 0.06), M.darkMetal()); r.position.set(x, 1.125, 0); hinge.add(r); }
    }
    this.game.scene.add(hinge);
    const [cx, cz] = this.w(at, this.D / 2);
    // Doors block the camera too: otherwise, a step inside, the boom swings
    // back out through the doorway and the door shuts in front of the lens.
    const col = this.game.physics.add({ x: cx, z: cz, hx: width / 2, hz: 0.06, rot: this.yaw, y0: this.y, y1: this.y + 2.3, tag: 'door' });
    const d = { hinge, col, open: 0, pos: new THREE.Vector3(cx, this.y, cz), room: this };
    this.doors.push(d);
    this.world.doors.push(d);
    return d;
  }

  // Door and display windows in the street wall, walls elsewhere, exterior
  // skin, upper storeys and a sign.
  shell({ wallIn, wallOut, doorAt = 0, windows = [], sign, signColor = '#ff4fa0', signBg = null, back = true }) {
    const { W, D } = this;
    const h = this.ceil;
    const fo = [{ at: W / 2 + doorAt, width: 1.2, bottom: 0, top: 2.3 }];
    for (const [a, b] of windows) fo.push({ at: W / 2 + (a + b) / 2, width: b - a, bottom: 0.55, top: Math.min(h - 0.4, 2.9), glass: true });
    // Front (street) wall: interior face and exterior face are one slab.
    this.wall(-W / 2, D / 2, W / 2, D / 2, { material: wallOut, openings: fo, t: 0.25 });
    this.wall(-W / 2, -D / 2, W / 2, -D / 2, { material: wallIn, t: 0.2 });
    this.wall(-W / 2, -D / 2, -W / 2, D / 2, { material: wallIn, t: 0.2 });
    this.wall(W / 2, -D / 2, W / 2, D / 2, { material: wallIn, t: 0.2 });
    // Above the interior ceiling to the first floor: exterior band.
    const band = GF - h;
    if (band > 0.05) this.box(0, h, D / 2, W, band, 0.25, wallOut, { tile: 2 });
    this.door(doorAt);
    if (sign) {
      const g = new THREE.PlaneGeometry(Math.min(W * 0.6, 7), Math.min(W * 0.6, 7) / 4);
      this.B.add(g, neonMat(sign, signColor, signBg ? { bg: signBg } : {}), this.m(doorAt * 0.3, GF - 0.9, D / 2 + 0.2), { shadow: false });
    }
    const [ex, ez] = this.w(doorAt, D / 2 + 1.2);
    const [ix, iz] = this.w(doorAt, D / 2 - 1.5);
    this.entrance = new THREE.Vector3(ex, this.y, ez);
    this.inside1 = new THREE.Vector3(ix, this.y, iz);
  }

  // Everything of the lot outside this room: solid, with plain exterior.
  fillLot() {
    const lot = this.lot;
    const [ax, az] = this.w(-this.W / 2, -this.D / 2);
    const [bx, bz] = this.w(this.W / 2, this.D / 2);
    const rx0 = Math.min(ax, bx), rx1 = Math.max(ax, bx), rz0 = Math.min(az, bz), rz1 = Math.max(az, bz);
    const rects = [
      [lot.x0, rx0, lot.z0, lot.z1], [rx1, lot.x1, lot.z0, lot.z1],
      [rx0, rx1, lot.z0, rz0], [rx0, rx1, rz1, lot.z1],
    ];
    const outer = wallT(lot.wall);
    for (const [x0, x1, z0, z1] of rects) {
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
      this.B.add(box(x1 - x0, GF, z1 - z0, { tile: 3 }), outer, mat4((x0 + x1) / 2, CURB_H + GF / 2, (z0 + z1) / 2));
      this.game.physics.add({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y0: 0, y1: CURB_H + GF, tag: 'building' });
    }
    // Upper storeys and the slab between them and the room.
    buildBuilding(this.game, this.B, lot, { skipGround: true, noCollider: true });
    this.game.physics.add({ x: (lot.x0 + lot.x1) / 2, z: (lot.z0 + lot.z1) / 2, hx: (lot.x1 - lot.x0) / 2, hz: (lot.z1 - lot.z0) / 2, y0: CURB_H + this.ceil, y1: CURB_H + Math.max(lot.h, GF + 0.2), tag: 'building' });
    this.B.add(box(lot.x1 - lot.x0, 0.3, lot.z1 - lot.z0), wallT(lot.wall), mat4((lot.x0 + lot.x1) / 2, CURB_H + GF - 0.15, (lot.z0 + lot.z1) / 2));
  }
}

// ---------------------------------------------------------------------------

const LAYOUTS = {
  diner(room) {
    const { W, D } = room;
    room.floor(M.tiles('#f2efe8', '#1f2326', 8, 'check'), 2);
    room.ceiling(M.plaster('#f5efe4'));
    room.shell({ wallIn: M.wallpaper('#f3e6cf', '#eed9b8'), wallOut: M.plaster('#e8e4dc'), doorAt: W / 2 - 2, windows: [[-W / 2 + 0.6, -1.4], [-1.0, W / 2 - 3.2]], sign: 'DINER', signColor: '#ff3b3b' });
    // Red stripe band outside, the diner look.
    room.box(0, 2.95, D / 2 + 0.14, W, 0.35, 0.04, std('#e63946', { rough: 0.4, key: 'dinerred' }));
    room.box(0, 3.35, D / 2 + 0.14, W, 0.08, 0.05, M.chrome());
    // Counter along the back, stools in front of it.
    room.put(F.counter({ w: 9, front: '#b22234' }), -1.5, -D / 2 + 2.4);
    for (let i = 0; i < 8; i++) room.put(F.stool({ h: 0.76 }), -5.4 + i * 1.1, -D / 2 + 3.3, Math.PI);
    room.put(F.counter({ w: 9, front: '#e8e4dc', top: '#9aa0a6', h: 0.9, d: 0.6 }), -1.5, -D / 2 + 0.45, Math.PI);
    room.box(-1.5, 1.4, -D / 2 + 0.2, 9, 0.9, 0.3, M.chrome());
    room.box(-1.5, 2.4, -D / 2 + 0.12, 5, 0.7, 0.04, glowMat('#fff6e0', 0.6, 1));
    room.put(F.fridge(), W / 2 - 1.2, -D / 2 + 0.5);
    // Booths along the windows.
    for (let i = 0; i < 4; i++) room.put(F.booth({ vinyl: '#b22234' }), -W / 2 + 1.4 + i * 2.35, D / 2 - 1.35, Math.PI / 2);
    // Tables in the middle.
    for (const [x, z] of [[-3.5, 0.6], [0.5, 0.6]]) {
      room.put(F.tableRound(), x, z);
      room.put(F.chair({ seat: '#b22234' }), x, z + 0.75, Math.PI);
      room.put(F.chair({ seat: '#b22234' }), x - 0.75, z, Math.PI / 2);
      room.put(F.chair({ seat: '#b22234' }), x + 0.75, z, -Math.PI / 2);
    }
    room.put(F.jukebox(), W / 2 - 0.8, 0.8, -Math.PI / 2);
    room.put(F.plant(), W / 2 - 0.6, D / 2 - 0.6);
    for (let i = 0; i < 4; i++) room.put(F.pendant(), -5 + i * 2.4, -D / 2 + 3.0, 0, { ly: room.ceil });
    for (let i = 0; i < 4; i++) room.put(F.pendant({ color: '#2a9d8f' }), -W / 2 + 1.4 + i * 2.35, D / 2 - 1.35, 0, { ly: room.ceil });
    room.put(F.painting({ seed: 1 }), 4.5, -D / 2 + 0.12, 0, { ly: 2.4 });
    room.light(-3, 2.8, -1); room.light(2.5, 2.8, -1); room.light(-2, 2.8, D / 2 - 1.5);
    room.staff = [{ x: -1.5, z: -D / 2 + 1.5, heading: 0, role: 'waitress' }, { x: 2.5, z: -D / 2 + 1.4, heading: 0, role: 'cook' }];
  },

  store(room) {
    const { W, D } = room;
    room.floor(M.tiles('#f4f4f2', '#dcdcd8', 6, 'plain'), 2.4);
    room.ceiling(M.plaster('#f8f8f6'));
    room.shell({ wallIn: M.plaster('#f0ede6'), wallOut: M.plaster('#2b3a55'), doorAt: -W / 2 + 2.2, windows: [[-W / 2 + 3.2, W / 2 - 0.6]], sign: '24/7 QUIK STOP', signColor: '#3ff0ff', signBg: '#d62828' });
    for (let k = 0; k < 3; k++) room.put(F.shelf({ w: 5.5 }), -1 + k * 0, -D / 2 + 3.6 + k * 2.1, 0);
    room.put(F.shelf({ w: 4, double: false }), -W / 2 + 0.3, 0, Math.PI / 2);
    room.put(F.drinkFridge({ w: 7 }), 1.5, -D / 2 + 0.4);
    room.put(F.counter({ w: 3.2, front: '#2b3a55', top: '#dcdcd8' }), W / 2 - 2.4, D / 2 - 2.8, Math.PI);
    room.put(F.register(), W / 2 - 2.4, D / 2 - 2.75, Math.PI, { ly: 0.95 });
    room.put(F.atm(), W / 2 - 0.5, D / 2 - 5.5, -Math.PI / 2);
    room.put(F.plant({ s: 0.8 }), -W / 2 + 0.6, D / 2 - 0.6);
    for (const [x, z] of [[-4, -2], [2, -2], [-4, 2], [2, 2]]) room.box(x, room.ceil - 0.06, z, 3, 0.05, 0.4, glowMat('#ffffff', 2, 1), { shadow: false });
    room.light(-3, 3.2, -1, { color: '#f4f8ff', intensity: 16 }); room.light(3, 3.2, 1, { color: '#f4f8ff', intensity: 16 });
    room.staff = [{ x: W / 2 - 2.4, z: D / 2 - 2.0, heading: Math.PI, role: 'clerk' }];
  },

  apartment(room) {
    const { W, D } = room;
    room.floor(M.planks('#b08a60'), 2);
    room.ceiling(M.plaster('#f7f3ec'));
    const inWall = M.plaster('#efe6d6');
    room.shell({ wallIn: inWall, wallOut: M.plaster(room.lot.wall), doorAt: -W / 2 + 1.6, windows: [[-W / 2 + 3, 1.2], [3.4, W / 2 - 0.6]], sign: 'APT 1A', signColor: '#ffd23f', signBg: '#1d3557' });
    // Back strip (5m): bathroom on the left, bedroom on the right.
    const px = -W / 2 + 4.2, pz = -D / 2 + 5;
    room.wall(px, -D / 2, px, pz, { material: inWall });
    room.wall(-W / 2, pz, W / 2, pz, { material: inWall, openings: [{ at: 2.1, width: 1.0, bottom: 0, top: 2.2 }, { at: W / 2 + px + 1.4, width: 1.1, bottom: 0, top: 2.2 }] });
    // Living room, front right.
    room.put(F.rug({ w: 3.2, d: 2.4, color: '#8c3b24' }), 3.8, D / 2 - 3.2);
    room.put(F.sofa({ w: 2.3, color: '#3f5e8c' }), 3.8, D / 2 - 1.5, Math.PI);
    room.put(F.coffeeTable(), 3.8, D / 2 - 2.9);
    room.put(F.tv(), 3.8, pz + 0.35);
    room.put(F.floorLamp(), W / 2 - 0.5, D / 2 - 0.6);
    room.put(F.bookshelf(), W / 2 - 0.3, pz + 1.6, -Math.PI / 2);
    room.put(F.plant(), 1.4, D / 2 - 0.6);
    room.armchairSpot = { x: 1.6, z: D / 2 - 3.1, rot: Math.PI / 2 };
    // Kitchen along the left wall, dining table beside it.
    room.put(F.kitchen({ w: 3.4 }), -W / 2 + 0.35, pz + 2.8, Math.PI / 2);
    room.put(F.fridge(), -W / 2 + 0.42, pz + 0.55, Math.PI / 2);
    room.put(F.tableRect({ w: 1.4, d: 0.85 }), -W / 2 + 3.4, D / 2 - 2.2);
    for (const [dx, dz, r] of [[-0.45, -0.7, 0], [0.45, -0.7, 0], [-0.45, 0.7, Math.PI], [0.45, 0.7, Math.PI]]) room.put(F.chair({ seat: '#d9c7a0' }), -W / 2 + 3.4 + dx, D / 2 - 2.2 + dz, r);
    room.put(F.painting({ seed: 2 }), 0.2, pz + 0.12, 0, { ly: 1.8 });
    // Bedroom.
    const bx = 3.2, bz = -D / 2 + 1.13;
    room.put(F.bed({ w: 1.6 }), bx, bz);
    room.put(F.nightstand(), bx + 1.15, -D / 2 + 0.35);
    room.put(F.nightstand(), bx - 1.15, -D / 2 + 0.35);
    room.put(F.wardrobe(), W / 2 - 1.0, -D / 2 + 0.35);
    room.put(F.rug({ w: 1.8, d: 1.2, color: '#5c4a72' }), bx + 2.2, bz + 0.9);
    room.put(F.painting({ seed: 3, w: 1.6, h: 0.7 }), bx, -D / 2 + 0.12, 0, { ly: 1.6 });
    // Bathroom.
    room.box(-W / 2 + 2.1, 0.005, -D / 2 + 2.5, 4.2, 0.01, 5, M.tiles('#dfe8ee', '#c8d6de', 6, 'plain'), { shadow: false });
    room.put(F.tub(), -W / 2 + 0.5, -D / 2 + 0.95);
    room.put(F.toilet(), -W / 2 + 2.2, -D / 2 + 0.4);
    room.put(F.basin(), -W / 2 + 3.4, -D / 2 + 0.3);
    room.light(3.8, 2.7, D / 2 - 2.8, { intensity: 10 }); room.light(-W / 2 + 3, 2.7, D / 2 - 2.5, { intensity: 9 });
    room.light(bx + 1, 2.7, -D / 2 + 2.4, { intensity: 7 }); room.light(-W / 2 + 2.1, 2.7, -D / 2 + 2.4, { intensity: 6, color: '#eef6ff' });
    room.residents = true;
  },

  bar(room) {
    const { W, D } = room;
    room.floor(M.planks('#4a3024'), 2);
    room.ceiling(std('#1a1420', { rough: 0.9, key: 'barceil' }));
    const inWall = std('#2a1f33', { rough: 0.8, key: 'barwall' });
    room.shell({ wallIn: inWall, wallOut: M.plaster('#2a1f33'), doorAt: W / 2 - 1.8, windows: [[-W / 2 + 0.8, -2.5]], sign: 'NEON LOUNGE', signColor: '#ff4fa0' });
    // Bar along the left wall, bottles behind it.
    room.put(F.bottles({ w: 6 }), -W / 2 + 0.25, -1, Math.PI / 2);
    room.put(F.counter({ w: 6, front: '#3a2a4a', top: '#1a1a1a' }), -W / 2 + 2.0, -1, Math.PI / 2);
    for (let i = 0; i < 6; i++) room.put(F.stool({ top: '#8338ec' }), -W / 2 + 2.9, -3.4 + i * 0.95, -Math.PI / 2);
    // Stage and piano at the back right.
    room.box(W / 2 - 3, 0, -D / 2 + 2, 6, 0.3, 4, M.planks('#2a1a14'), { collide: false });
    room.game.physics.add({ ...stageCol(room, W / 2 - 3, -D / 2 + 2, 6, 4), walk: true, solid: false });
    room.put(F.piano(), W / 2 - 4.3, -D / 2 + 1.1, 0, { ly: 0.3 });
    room.put(F.micStand(), W / 2 - 1.6, -D / 2 + 2.6, 0, { ly: 0.3 });
    // Dance floor.
    room.danceFloor = { x: 1.2, z: 0.8, w: 5, d: 4 };
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const c = ['#ff4fa0', '#3ff0ff', '#8338ec', '#ffd23f'][(i + j) % 4];
      room.box(1.2 - 2 + i, 0.003, 0.8 - 1.5 + j, 0.96, 0.01, 0.96, glowMat(c, 0.9, 0.9), { shadow: false });
    }
    room.put(F.jukebox(), W / 2 - 0.6, 3, -Math.PI / 2);
    room.put(F.poolTable(), -2.2, D / 2 - 2.2);
    room.put(F.sofa({ w: 2.2, color: '#5a1f3a' }), 3.8, D / 2 - 0.7, Math.PI);
    for (const [x, z] of [[1.0, D / 2 - 1.6], [-4.4, -4.8]]) { room.put(F.tableRound({ top: '#1a1a1a', r: 0.35, h: 1.05 }), x, z); }
    room.box(0, room.ceil - 0.1, D / 2 - 0.2, W - 1, 0.05, 0.05, glowMat('#ff4fa0', 3, 1), { shadow: false });
    room.box(-W / 2 + 0.15, room.ceil - 0.1, 0, 0.05, 0.05, D - 1, glowMat('#3ff0ff', 3, 1), { shadow: false });
    room.light(-W / 2 + 2.5, 3, -1, { color: '#ff66cc', intensity: 12 });
    room.light(1.2, 3.2, 0.8, { color: '#8a6aff', intensity: 14 });
    room.light(W / 2 - 3, 3.2, -D / 2 + 2, { color: '#ffb070', intensity: 12 });
    room.staff = [{ x: -W / 2 + 1.1, z: -1, heading: Math.PI / 2, role: 'bartender' }];
  },

  boutique(room) {
    const { W, D } = room;
    room.floor(M.planks('#d8c3a5'), 2);
    room.ceiling(M.plaster('#ffffff'));
    room.shell({ wallIn: M.plaster('#fbf8f2'), wallOut: M.plaster('#f4c7c3'), doorAt: 0, windows: [[-W / 2 + 0.6, -1.2], [1.2, W / 2 - 0.6]], sign: 'Maison Solana', signColor: '#1d3557', signBg: '#f4f1ea' });
    for (const [x, z, r] of [[-4, -1.5, 0], [-4, 1.2, 0], [2.5, -2.2, 0]]) room.put(F.rack({ w: 1.6 }), x, z, r);
    room.put(F.rack({ w: 3 }), 0, -D / 2 + 0.5);
    room.put(F.mirror(), W / 2 - 0.2, 0.5, -Math.PI / 2);
    room.put(F.mirror(), -W / 2 + 0.2, -D / 2 + 2.5, Math.PI / 2);
    room.put(F.counter({ w: 2.2, front: '#f4c7c3', top: '#ffffff' }), W / 2 - 2.2, -D / 2 + 1.4);
    room.put(F.plant(), W / 2 - 0.6, D / 2 - 0.7);
    // Seats only: the velvet sofa model (models.js) is what you see here.
    const sofa = F.sofa({ w: 2.2, color: '#e3d4f2' });
    sofa.parts = [];
    room.put(sofa, 1.5, D / 2 - 1.2, Math.PI);
    room.mannequins = [[-1.6, D / 2 - 1.2, Math.PI], [3.2, D / 2 - 1.2, Math.PI], [-W / 2 + 1, -D / 2 + 1, Math.PI / 4]];
    for (const [x, z] of room.mannequins) room.box(x, 0, z, 0.8, 0.2, 0.8, M.plaster('#ffffff'), { collide: true });
    room.light(-2, 3, 0, { color: '#fff6ea', intensity: 12 }); room.light(3, 3, 0, { color: '#fff6ea', intensity: 12 });
    room.staff = [{ x: W / 2 - 2.2, z: -D / 2 + 0.6, heading: 0, role: 'clerk' }];
  },

  office(room) {
    const { W, D } = room;
    room.floor(M.carpet('#5a6470'), 2);
    room.ceiling(M.plaster('#f4f4f2'));
    room.shell({ wallIn: M.plaster('#e8ebee'), wallOut: M.plaster('#9aa4ad'), doorAt: -W / 2 + 2, windows: [[-W / 2 + 3, W / 2 - 0.6]], sign: 'SOLANA MEDIA', signColor: '#ffffff', signBg: '#264653' });
    // Reception.
    room.put(F.counter({ w: 2.4, front: '#264653', top: '#e8e4dc', h: 1.05 }), -W / 2 + 3.4, D / 2 - 3.2, 0);
    room.put(F.sofa({ w: 2.0, color: '#6d8fa8' }), -W / 2 + 1.2, D / 2 - 5.2, Math.PI / 2);
    // Desks in two rows.
    for (let row = 0; row < 2; row++) for (let k = 0; k < 3; k++) {
      const x = -1 + k * 2.4, z = -D / 2 + 2.2 + row * 3;
      room.put(F.desk(), x, z, Math.PI);
      room.put(F.officeChair(), x, z - 0.8, 0);
    }
    room.put(F.tableRect({ w: 2.4, d: 1.1, wood: '#d8c3a5' }), W / 2 - 2.4, D / 2 - 2.6);
    for (const [dx, dz, r] of [[-0.7, -0.9, 0], [0.7, -0.9, 0], [-0.7, 0.9, Math.PI], [0.7, 0.9, Math.PI]]) room.put(F.chair({ wood: '#2a2d31', seat: '#2a2d31' }), W / 2 - 2.4 + dx, D / 2 - 2.6 + dz, r);
    room.put(F.whiteboard(), W / 2 - 0.12, D / 2 - 2.6, -Math.PI / 2);
    room.put(F.waterCooler(), W / 2 - 0.5, -D / 2 + 0.6, -Math.PI / 2);
    for (const [x, z] of [[-W / 2 + 0.6, -D / 2 + 0.6], [W / 2 - 0.6, 0.2]]) room.put(F.plant({ s: 1.2 }), x, z);
    for (const [x, z] of [[-1, -3], [3.8, -3], [-1, 1], [3.8, 1]]) room.box(x, room.ceil - 0.06, z, 2.4, 0.05, 0.6, glowMat('#ffffff', 1.8, 1), { shadow: false });
    room.light(0, 3, -2, { color: '#f4f8ff', intensity: 12 }); room.light(4, 3, 2, { color: '#f4f8ff', intensity: 12 });
    room.staff = [{ x: -W / 2 + 3.4, z: D / 2 - 3.9, heading: Math.PI, role: 'receptionist' }];
  },
};

function stageCol(room, lx, lz, w, d) {
  const [x, z] = room.w(lx, lz);
  return { x, z, hx: w / 2, hz: d / 2, rot: room.yaw, y0: room.y, y1: room.y + 0.3, tag: 'stage', noCam: true };
}

const SIZES = {
  diner: [17, 12.4, 3.6], store: [16, 12, 3.8], apartment: [16, 12.5, 3.1], bar: [18, 13, 4.1], boutique: [14, 11, 3.8], office: [18, 13, 3.4],
};

export function buildInterior(world, lot) {
  world.doors = world.doors || [];
  world.rooms = world.rooms || [];
  const along = lot.face === 'n' || lot.face === 's' ? lot.x1 - lot.x0 : lot.z1 - lot.z0;
  const deep = lot.face === 'n' || lot.face === 's' ? lot.z1 - lot.z0 : lot.x1 - lot.x0;
  const [w0, d0, ceil] = SIZES[lot.interior];
  const W = Math.min(w0, along - 0.2), D = Math.min(d0, deep - 0.2);
  const room = new Room(world, lot, W, D, { ceiling: ceil, name: lot.interior });
  room.kind = lot.interior;
  LAYOUTS[lot.interior](room);
  room.fillLot();
  world.rooms.push(room);
}

// Doors swing open for anyone near them.
export function updateDoors(world, actors, dt) {
  for (const d of world.doors || []) {
    let near = false;
    for (const a of actors) {
      if (a.state === 'driving') continue;
      const p = a.object.position;
      if (Math.abs(p.x - d.pos.x) < 2.2 && Math.abs(p.z - d.pos.z) < 2.2 && Math.abs(p.y - d.pos.y) < 1.5) { near = true; break; }
    }
    const target = near ? 1 : 0;
    d.open += (target - d.open) * Math.min(1, dt * 5);
    d.hinge.rotation.y = d.room.yaw - d.open * 1.45;
    d.col.disabled = d.open > 0.25;
  }
}
