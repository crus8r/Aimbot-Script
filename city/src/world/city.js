// Port Solana: assembles the plan into a world — streets, buildings, street
// furniture, park, beach, pier, sea — and registers what can be sat on,
// bumped into, and lit.
import * as THREE from 'three';
import { Batcher, Instancer, box, plane, mat4, WORLD_U } from './build.js';
import { M, std, glowMat, facadeMat, neonMat } from './materials.js';
import { makePlan, XS, ZS, HALF_ROAD, CURB_H, WALK_W, BEACH, BOUNDS, blockRect, beachHeight } from './layout.js';
import { buildRoads } from './roads.js';
import { buildBuilding, wallQuad } from './buildings.js';
import { buildBeach, buildOcean, shoreline } from './nature.js';
import { PROPS, builtParts, seatToWorld, colliderToWorld } from './props.js';
import { LightPool } from './lights.js';
import { rng } from './textures.js';
import { makeSeat, seatInteraction } from '../game/seats.js';

export class World {
  constructor(game) {
    this.game = game;
    this.plan = makePlan(7);
    this.B = new Batcher(game.scene);
    this.I = new Instancer(game.scene);
    this.lights = new LightPool(game.scene, game.quality === 'low' ? 4 : 12);
    this.seats = [];
    this.doors = [];
    this.rooms = [];
    this.spots = { benches: [], beach: [], view: [], shop: [] };
    this.r = rng(99);
    for (const name of Object.keys(PROPS)) {
      const parts = builtParts(name);
      // Small street clutter doesn't need to cast shadows.
      const small = ['towel', 'hydrant', 'meter', 'newsbox', 'cone', 'trash'].includes(name);
      this.I.define(name, parts.map((p) => ({ geo: p.geo, material: p.material, shadow: !small })));
    }
  }

  // Place a catalogue prop: instance, collider, seats, light.
  prop(name, x, z, rot = 0, { y = CURB_H, batch = false, scale = 1 } = {}) {
    const def = PROPS[name];
    const m = mat4(x, y, z, rot, scale, scale, scale);
    if (batch) for (const p of builtParts(name)) this.B.add(p.geo.clone(), p.material, m);
    else this.I.place(name, m);
    if (def.collider) this.game.physics.add({ ...colliderToWorld(def.collider, x, y, z, rot), tag: name, noCam: def.collider.h < 1.2 || name.startsWith('palm') || name.startsWith('tree') || name === 'lamp' });
    for (const w of def.walls || []) this.game.physics.add({ ...colliderToWorld(w, x, y, z, rot), tag: name });
    for (const s of def.seats || []) {
      const ws = seatToWorld(s, x, y, z, rot);
      this.addSeat(makeSeat({ x: ws.x, y, z: ws.z, heading: ws.heading, h: ws.h, kind: ws.kind, loop: ws.loop, opts: ws.opts }), name);
    }
    if (def.light) {
      const c = Math.cos(rot), s = Math.sin(rot);
      this.lights.add({ pos: new THREE.Vector3(x + def.light.x * c + def.light.z * s, y + def.light.y, z - def.light.x * s + def.light.z * c), night: true, intensity: 45, range: 20 });
    }
  }

  addSeat(seat, where = '') {
    seat.where = where;
    this.seats.push(seat);
    this.game.interactions.add(seatInteraction(seat, this.game));
    return seat;
  }

  build() {
    const g = this.game;
    g.physics.groundFn = (x) => (x > BEACH.promenade1 ? beachHeight(x) : 0);
    buildRoads(g, this.B);
    for (const lot of this.plan.lots) {
      if (lot.interior && this.interiorBuilder) this.interiorBuilder(this, lot);
      else buildBuilding(g, this.B, lot);
    }
    this.streetFurniture();
    for (const s of this.plan.special) {
      if (s.kind === 'park') this.park(s);
      if (s.kind === 'parking') this.parking(s);
      if (s.kind === 'court') this.court(s);
    }
    this.beachfront();
    this.pier();
    this.backdrop();
    this.bounds();
    this.B.flush();
    this.I.flush();
  }

  // Lamps, trees and furniture along every block's curb.
  streetFurniture() {
    const r = this.r;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const b = blockRect(i, j);
      const special = this.plan.special.find((s) => s.kind === 'park' && s.x0 === b.x0 && s.z0 === b.z0);
      const edges = [
        { x0: b.x0, z0: b.z0, dx: 1, dz: 0, len: b.x1 - b.x0, out: [0, -1], street: `z${ZS[j]}` },
        { x0: b.x0, z0: b.z1, dx: 1, dz: 0, len: b.x1 - b.x0, out: [0, 1], street: `z${ZS[j + 1]}` },
        { x0: b.x0, z0: b.z0, dx: 0, dz: 1, len: b.z1 - b.z0, out: [-1, 0], street: `x${XS[i]}` },
        { x0: b.x1, z0: b.z0, dx: 0, dz: 1, len: b.z1 - b.z0, out: [1, 0], street: `x${XS[i + 1]}` },
      ];
      for (const e of edges) {
        const ocean = e.street === `x${XS[5]}`;
        const palms = ocean || e.street === 'z0' || r() < 0.3;
        const inset = 1.0;
        const rotOut = Math.atan2(e.out[0], e.out[1]);
        for (let t = 9; t < e.len - 8; t += 12) {
          const x = e.x0 + e.dx * t - e.out[0] * inset;
          const z = e.z0 + e.dz * t - e.out[1] * inset;
          const k = Math.round((t - 9) / 12);
          if (k % 2 === 0) this.prop('lamp', x, z, rotOut);
          else if (palms) this.prop(`palm${Math.floor(r() * 4)}`, x, z, r() * Math.PI * 2, { scale: 0.9 + r() * 0.3 });
          else this.prop(`tree${Math.floor(r() * 3)}`, x, z, r() * Math.PI * 2, { scale: 0.9 + r() * 0.25 });
          // Furniture between the trees, facing the street.
          if (k % 2 === 1 && !special) {
            const u = r();
            const fx = x + e.dx * 5, fz = z + e.dz * 5;
            if (u < 0.28) { this.prop('bench', fx - e.out[0] * 0.8, fz - e.out[1] * 0.8, rotOut); }
            else if (u < 0.42) this.prop('trash', fx, fz);
            else if (u < 0.5) this.prop('hydrant', fx, fz);
            else if (u < 0.58) this.prop('newsbox', fx - e.out[0] * 0.3, fz - e.out[1] * 0.3, rotOut);
            else if (u < 0.66 && !ocean) this.prop('meter', fx + e.out[0] * 0.4, fz + e.out[1] * 0.4, rotOut);
            else if (u < 0.7) this.prop('vending', fx - e.out[0] * 1.8, fz - e.out[1] * 1.8, rotOut + Math.PI);
          }
        }
      }
    }
    // Bus stops on the main street and Ocean Drive.
    this.prop('busstop', 70, 7.3, 0);
    this.prop('busstop', 150, -7.3, Math.PI);
    this.prop('busstop', 183.2, 40, -Math.PI / 2);
    this.prop('phonebooth', 120.5, 8.2, Math.PI);
  }

  park(s) {
    const { x0, x1, z0, z1 } = s;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const inner = { x0: x0 + WALK_W, x1: x1 - WALK_W, z0: z0 + WALK_W, z1: z1 - WALK_W };
    const w = inner.x1 - inner.x0, d = inner.z1 - inner.z0;
    // Lawn slightly above the pavement; paths cut through it.
    this.B.add(plane(w, d, { tile: 5 }), M.grass(), mat4(cx, CURB_H + 0.02, cz), { shadow: false });
    const path = M.promenade();
    this.B.add(plane(w, 4, { tile: 4 }), path, mat4(cx, CURB_H + 0.035, cz), { shadow: false });
    this.B.add(plane(4, d, { tile: 4 }), path, mat4(cx, CURB_H + 0.035, cz), { shadow: false });
    // Fountain.
    const stone = M.plaster('#d9d0c0');
    const basin = new THREE.CylinderGeometry(4.2, 4.4, 0.6, 32);
    this.B.add(basin, stone, mat4(cx, CURB_H + 0.3, cz));
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.9, 32), std('#3a8fa0', { rough: 0.05, metal: 0.2, key: 'fwater' }));
    water.rotation.x = -Math.PI / 2; water.position.set(cx, CURB_H + 0.52, cz);
    this.game.scene.add(water);
    this.B.add(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 12), stone, mat4(cx, CURB_H + 1.4, cz));
    this.B.add(new THREE.CylinderGeometry(1.4, 0.3, 0.3, 20), stone, mat4(cx, CURB_H + 2.5, cz));
    this.fountain = { x: cx, z: cz, y: CURB_H + 2.6 };
    this.game.physics.add({ x: cx, z: cz, hx: 4.2, hz: 4.2, rot: 0, y0: 0, y1: CURB_H + 0.6, tag: 'fountain' });
    // Octagon-ish collider approximated by a rotated second box.
    this.game.physics.add({ x: cx, z: cz, hx: 4.2, hz: 4.2, rot: Math.PI / 4, y0: 0, y1: CURB_H + 0.6, tag: 'fountain' });
    // Sit on the fountain's rim.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const rx = cx + Math.sin(a) * 4.55, rz = cz + Math.cos(a) * 4.55;
      this.addSeat(makeSeat({ x: rx, y: CURB_H, z: rz, heading: a, h: 0.6, kind: 'bench' }), 'fountain');
    }
    // Benches facing the fountain, trees around the lawns, lamps on paths.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = cx + Math.sin(a) * 9, bz = cz + Math.cos(a) * 9;
      this.prop('bench', bx, bz, a + Math.PI, { y: CURB_H });
    }
    const r = this.r;
    for (let k = 0; k < 26; k++) {
      const x = inner.x0 + 3 + r() * (w - 6), z = inner.z0 + 3 + r() * (d - 6);
      if (Math.abs(x - cx) < 5 || Math.abs(z - cz) < 5) continue;
      if (Math.hypot(x - cx, z - cz) < 13) continue;
      if (r() < 0.2) this.prop('picnic', x, z, r() * Math.PI);
      else this.prop(`tree${Math.floor(r() * 3)}`, x, z, r() * 6, { scale: 1 + r() * 0.5 });
    }
    for (const [dx, dz] of [[0, -18], [0, 18], [-18, 0], [18, 0]]) this.prop('lamp', cx + dx + 2.6, cz + dz + 2.6, Math.PI / 2);
    this.spots.view.push({ x: cx, z: cz, r: 12, kind: 'plaza' });
  }

  parking(s) {
    const { x0, x1, z0, z1 } = s;
    const inner = { x0: x0 + WALK_W, x1: x1 - WALK_W, z0: z0 + WALK_W, z1: z1 - WALK_W };
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.B.add(plane(inner.x1 - inner.x0, inner.z1 - inner.z0, { tile: 8 }), M.asphalt(), mat4(cx, CURB_H + 0.01, cz), { shadow: false });
    const white = M.paint();
    this.parkingStalls = [];
    for (const row of [-14, -4, 6, 16]) {
      for (let k = -10; k <= 10; k++) {
        const x = cx + k * 2.6;
        this.B.add(plane(0.1, 5), white, mat4(x - 1.3, CURB_H + 0.02, cz + row), { shadow: false });
        this.parkingStalls.push({ x, z: cz + row, heading: row < 0 ? 0 : Math.PI, y: CURB_H });
      }
    }
    this.prop('lamp', cx - 14, cz + 1, 0);
    this.prop('lamp', cx + 14, cz + 1, Math.PI);
  }

  court(s) {
    const { x0, x1, z0, z1 } = s;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2 + 2;
    const w = 30, d = 17;
    this.B.add(plane(w, d, { tile: 4 }), std('#3a7a8c', { rough: 0.6, key: 'court' }), mat4(cx, CURB_H + 0.02, cz), { shadow: false });
    this.B.add(plane(w - 2, d - 2), std('#c46a3a', { rough: 0.6, key: 'court2' }), mat4(cx, CURB_H + 0.025, cz), { shadow: false });
    const white = M.paint();
    for (const x of [cx - 14, cx + 14]) this.B.add(plane(0.08, d - 2), white, mat4(x, CURB_H + 0.03, cz), { shadow: false });
    this.B.add(plane(0.08, d - 2), white, mat4(cx, CURB_H + 0.03, cz), { shadow: false });
    for (const side of [-1, 1]) {
      const hx = cx + side * 13.2;
      this.B.add(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), M.darkMetal(), mat4(hx + side * 1, CURB_H + 1.7, cz));
      this.B.add(box(0.06, 1.05, 1.8), std('#f2f2f2', { rough: 0.4, key: 'backboard' }), mat4(hx + side * 0.2, CURB_H + 3.3, cz));
      this.B.add(new THREE.TorusGeometry(0.23, 0.02, 6, 16), std('#ff5a1a', { rough: 0.4, metal: 0.5, key: 'rim' }), mat4(hx - side * 0.1, CURB_H + 3.05, cz, 0, 1, 1, 1, Math.PI / 2));
      this.game.physics.add({ x: hx + side * 1, z: cz, hx: 0.1, hz: 0.1, y0: 0, y1: 3.5, tag: 'hoop' });
    }
    this.spots.view.push({ x: cx, z: cz, r: 8, kind: 'court' });
  }

  beachfront() {
    const g = this.game;
    buildBeach(g);
    const r = this.r;
    // Palms and lamps along the promenade, benches looking out to sea.
    for (let z = -196; z <= 196; z += 12) {
      const k = Math.round(z / 12);
      if (Math.abs(z) < 5) continue;
      if (k % 2 === 0) this.prop('lamp', BEACH.promenade0 + 1, z, Math.PI / 2);
      else this.prop(`palm${Math.floor(r() * 4)}`, BEACH.promenade1 - 1.2, z, r() * 6, { scale: 1 + r() * 0.35 });
      if (k % 3 === 0) this.prop('bench', BEACH.promenade1 - 2.6, z + 5, Math.PI / 2);
    }
    // Beach life: umbrellas with loungers and towels, a lifeguard tower.
    const shore = shoreline();
    for (let z = -180; z <= 180; z += 14 + r() * 8) {
      if (Math.abs(z) < 8) continue;
      const x = BEACH.promenade1 + 12 + r() * (shore - BEACH.promenade1 - 22);
      const y = beachHeight(x);
      this.prop('umbrella', x, z, 0, { y: y - 0.05 });
      if (r() < 0.8) {
        const lx = x + 0.9, lz = z + (r() - 0.5) * 0.6;
        const rot = Math.PI / 2 + (r() - 0.5) * 0.3;   // feet toward the sea
        this.prop('lounger', lx, lz, rot, { y: beachHeight(lx) });
        // Lie on a lounger: sit on its side facing along -F, then lie back
        // with the head at the raised end. See Actor.lieDown for the frame.
        const L = [Math.sin(rot), Math.cos(rot)], F = [Math.cos(rot), -Math.sin(rot)];
        const seat = makeSeat({ x: lx - 0.15 * L[0] + 0.32 * F[0], y: beachHeight(lx), z: lz - 0.15 * L[1] + 0.32 * F[1], heading: rot + Math.PI / 2, h: 0.36, kind: 'lounger' });
        this.addSeat(seat, 'lounger');
      }
      if (r() < 0.6) {
        const tx = x - 1.3, tz = z + 1.5;
        this.prop('towel', tx, tz, r() * 0.4, { y: beachHeight(tx) + 0.01 });
        this.spots.beach.push({ x: tx, z: tz, y: beachHeight(tx), heading: Math.PI / 2 });
      }
    }
    this.prop('lifeguard', BEACH.promenade1 + 24, -60, Math.PI / 2, { y: beachHeight(BEACH.promenade1 + 24) });
    this.prop('lifeguard', BEACH.promenade1 + 24, 90, Math.PI / 2, { y: beachHeight(BEACH.promenade1 + 24) });
    this.sea = buildOcean(g, this.waterNormals);
    this.game.updaters.push((dt) => { WORLD_U.time.value += dt; });
  }

  pier() {
    const g = this.game;
    const x0 = BEACH.promenade1 + 1.8, x1 = BEACH.pierEnd, zc = BEACH.pierZ;
    const w = 6, y = BEACH.deckY;
    const deck = M.planks('#a57a52');
    this.B.add(box(x1 - x0, 0.25, w, { tile: 2 }), deck, mat4((x0 + x1) / 2, y - 0.125, zc));
    g.physics.add({ x: (x0 + x1) / 2, z: zc, hx: (x1 - x0) / 2, hz: w / 2, y0: y - 0.3, y1: y, walk: true, solid: false, tag: 'pier' });
    // Steps up from the promenade.
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const sy = CURB_H + (i + 1) * (y - CURB_H) / steps;
      const sx = BEACH.promenade1 - 0.3 + i * 0.35;
      this.B.add(box(0.35, sy, w, { tile: 1 }), deck, mat4(sx, sy / 2, zc));
      g.physics.add({ x: sx, z: zc, hx: 0.175, hz: w / 2, y0: 0, y1: sy, walk: true, tag: 'step', noCam: true });
    }
    for (let x = x0 + 2; x < x1; x += 6) {
      for (const s of [-1, 1]) {
        const py = beachHeight(x);
        this.B.add(new THREE.CylinderGeometry(0.22, 0.25, y - py + 1.5, 8), M.wood('#5a4230'), mat4(x, (y + py - 1.5) / 2, zc + s * (w / 2 - 0.2)));
        // Railings.
        this.B.add(box(6, 0.08, 0.08), M.wood('#e8e0d0'), mat4(x + 3, y + 1.0, zc + s * (w / 2 - 0.05)));
        this.B.add(box(0.1, 1.05, 0.1), M.wood('#e8e0d0'), mat4(x, y + 0.52, zc + s * (w / 2 - 0.05)));
      }
      g.physics.add({ x: x + 3, z: zc + w / 2 - 0.05, hx: 3.05, hz: 0.08, y0: y, y1: y + 1.1, tag: 'rail', noCam: true });
      g.physics.add({ x: x + 3, z: zc - w / 2 + 0.05, hx: 3.05, hz: 0.08, y0: y, y1: y + 1.1, tag: 'rail', noCam: true });
      if (Math.round((x - x0) / 6) % 3 === 0) {
        this.prop('lamp', x, zc - w / 2 + 0.5, 0, { y });
        this.prop('bench', x + 3, zc + w / 2 - 0.9, Math.PI, { y });
      }
    }
    g.physics.add({ x: x1, z: zc, hx: 0.1, hz: w / 2, y0: y, y1: y + 1.1, tag: 'rail' });
    // A bait shack at the end.
    const sx = x1 - 6;
    this.B.add(box(5, 3, 4), M.planks('#7fb8c8'), mat4(sx, y + 1.5, zc - 0.8));
    this.B.add(box(5.6, 0.2, 4.6), std('#e76f51', { rough: 0.7, key: 'shackroof' }), mat4(sx, y + 3.1, zc - 0.8));
    const sign = new THREE.PlaneGeometry(3.6, 0.9);
    this.B.add(sign, neonMat('BAIT & TACKLE', '#ffd23f', { bg: '#1d3557', font: 'bold 64px Georgia, serif' }), mat4(sx - 2.52, y + 2.4, zc - 0.8, -Math.PI / 2));
    g.physics.add({ x: sx, z: zc - 0.8, hx: 2.5, hz: 2, y0: y, y1: y + 3.2, tag: 'shack' });
    this.spots.view.push({ x: x1 - 1.5, z: zc + 1.5, y, r: 1.5, kind: 'pierend', heading: Math.PI / 2 });
  }

  // Filler buildings beyond the ring road, so the city doesn't end in a void.
  backdrop() {
    const r = this.r;
    const band = (x0, x1, z0, z1, alongX, face) => {
      let p = alongX ? x0 : z0;
      const end = alongX ? x1 : z1;
      while (p < end - 4) {
        const w = Math.min(end - p, 14 + r() * 16);
        const lot = alongX
          ? { x0: p, x1: p + w, z0, z1, face }
          : { x0, x1, z0: p, z1: p + w, face };
        const style = r() < 0.4 ? 'glass' : r() < 0.6 ? 'brick' : 'apart';
        Object.assign(lot, { style, h: 12 + r() * (style === 'glass' ? 60 : 22), wall: ['#e2cfb4', '#c8775a', '#b8b8b0', '#d8c3a5', '#f4c7c3', '#cfe0f5'][Math.floor(r() * 6)], trim: '#e8e0d0', glass: '#4f6f80', shop: ['DELI', 'CAFE', 'MARKET', 'BANK', 'HOTEL', 'GYM'][Math.floor(r() * 6)], signColor: '#264653', seed: Math.floor(r() * 1e6) });
        buildBuilding(this.game, this.B, lot);
        p += w + 0.2;
      }
    };
    const W = XS[0] - HALF_ROAD - WALK_W;       // west sidewalk edge
    const N = ZS[0] - HALF_ROAD - WALK_W;
    const S = ZS[4] + HALF_ROAD + WALK_W;
    band(W - 34, W - 0.5, N - 34, S + 34, false, 'e');
    band(W - 0.5, BEACH.promenade0 - 0.5, N - 30, N - 0.5, true, 's');
    band(W - 0.5, BEACH.promenade0 - 0.5, S + 0.5, S + 30, true, 'n');
  }

  bounds() {
    const P = this.game.physics;
    P.add({ x: BOUNDS.x1, z: 0, hx: 0.5, hz: 400, y0: -5, y1: 30, tag: 'bound', noCam: true });
    for (const s of [-1, 1]) {
      P.add({ x: 230, z: s * 199, hx: 40, hz: 0.5, y0: -5, y1: 30, tag: 'bound', noCam: true });
      // Rock groynes mark where the beach ends.
      for (let k = 0; k < 12; k++) {
        const x = BEACH.promenade0 + k * 5.5;
        const rock = new THREE.DodecahedronGeometry(1.6 + this.r() * 1.2, 0);
        this.B.add(rock, std('#6f6a62', { rough: 0.95, key: 'rock' }), mat4(x, beachHeight(x) + 0.4, s * (199 + this.r() * 2), this.r() * 6, 1.2, 0.8, 1.1));
      }
    }
  }
}

export async function buildCity(game) {
  const tl = new THREE.TextureLoader();
  const waterNormals = await tl.loadAsync('assets/textures/waternormals.jpg');
  const world = new World(game);
  world.waterNormals = waterNormals;
  game.world = world;
  try {
    const { buildInterior } = await import('./interiors.js');
    world.interiorBuilder = buildInterior;
  } catch (e) {
    console.warn('interiors unavailable', e);
  }
  world.build();
  const { updateDoors } = await import('./interiors.js');
  game.updaters.push((dt, gm) => {
    WORLD_U.night.value = gm.day.night;
    updateDoors(world, gm.actors, dt);
    world.lights.update(dt, gm.camera.position, gm.day.night);
  });
  const spawnModel = game.params.get('model') || 'man';
  const player = game.addActor(spawnModel, { top: '#f2efe8', bottom: '#2b3a55', shoes: '#3a2a22', hat: true, beard: true, skin: '#e0b89a', hair: '#3b2a1e' }, { name: 'You' });
  player.place(200.5, CURB_H, -16, Math.PI);
  game.setPlayer(player);
  game.follow.yaw = 0;
  game.follow.pitch = 0.18;
  // People, fixtures, and the interface.
  const { Crowd } = await import('../game/npcs.js');
  const { registerHooks } = await import('../game/hooks.js');
  registerHooks(game);
  const people = game.params.has('nopeople') ? 0 : Number(game.params.get('people') || 1);
  game.crowd = new Crowd(game);
  game.crowd.spawn({ scale: people });
  const { HUD } = await import('../ui/hud.js');
  if (document.getElementById('hud')) game.hud = new HUD(game);
  try {
    const { Traffic } = await import('../game/traffic.js');
    game.traffic = new Traffic(game);
    await game.traffic.init();
  } catch (e) { console.warn('traffic unavailable', e); }
  return world;
}
