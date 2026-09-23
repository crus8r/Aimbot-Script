// A house, drawn the way people sketch floor plans: rooms as rectangles on a
// half-metre grid. Walls are derived, not drawn. Every edge where two
// different rooms meet (or a room meets the outdoors) becomes a wall *run*;
// each run has two sides, and each side belongs to the room it faces, so
// painting "the bedroom" paints exactly the bedroom's side of every wall.
//
// Walls are built as a core (the thickness, in trim colour: its top and the
// reveals of doors and windows) plus one thin face per side carrying that
// side's paint. The faces sit 1cm proud of the core so they never z-fight.
// Each run is built twice, full height and cut down, so the cutaway view
// is a visibility flip, not a rebuild.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box } from '../world/build.js';
import { M } from '../world/materials.js';
import { wallMat, floorMat, floorTile, roofMat, GROUND } from './finishes.js';

export const FY = 0.25;          // floor level: the house sits on a foundation
export const WH = 2.8;           // wall height
export const WT = 0.16;          // wall thickness
export const LOW = 0.34;         // cut-down wall height
const EPS = 1e-4;
const TRIM = 0.07;               // door and window casing width

const pairKey = (a, b) => [a, b].sort().join('|');

// Normalise a plan opening: kind door | front | arch | window.
export function openingSpec(o) {
  const kind = o.kind || 'window';
  if (kind === 'window') return { ...o, kind, w: o.w || 1.2, bottom: o.bottom ?? 0.85, top: o.top ?? 2.15 };
  if (kind === 'arch') return { ...o, kind, w: o.w || 1.4, bottom: 0, top: o.top ?? 2.3 };
  return { ...o, kind, w: o.w || (kind === 'front' ? 1.0 : 0.9), bottom: 0, top: o.top ?? 2.15 };
}

export class House {
  // lot: { id, cx, cz, w, d }. plan: see plans.js. state: saved edits.
  constructor(game, lot, plan, state = {}) {
    this.game = game;
    this.lot = lot;
    this.plan = plan;
    this.group = new THREE.Group();
    this.group.name = `house:${lot.id}`;
    this.group.position.set(lot.cx, 0, lot.cz);
    game.scene.add(this.group);
    this.rooms = plan.rooms.map((r) => ({ id: r.id, name: r.name, x0: r.rect[0], z0: r.rect[1], x1: r.rect[2], z1: r.rect[3], wall: r.wall, floor: r.floor, outdoor: !!r.outdoor }));
    this.open = new Set((plan.open || []).map(([a, b]) => pairKey(a, b)));
    this.openings = (state.openings || plan.openings).map(openingSpec);
    this.paint = { ...(state.paint || {}) };
    this.floors = { ...(state.floors || {}) };
    this.exterior = state.exterior || plan.exterior;
    this.roofId = state.roof || plan.roof;
    this.mode = 'cutaway';
    this.roofOn = false;
    this.doors = [];
    this.colliders = [];
    this.pickables = [];           // wall faces and floors, for the paint tools
    this.computeRuns();
    this.build();
  }

  // Lot-local <-> world.
  toWorld(x, z) { return [x + this.lot.cx, z + this.lot.cz]; }
  toLocal(x, z) { return [x - this.lot.cx, z - this.lot.cz]; }

  roomAt(x, z) {
    for (const r of this.rooms) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r;
    return null;
  }

  // Inside the footprint (including under the walls' outer halves)?
  covers(x, z, pad = WT / 2) {
    for (const r of this.rooms) if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return true;
    return false;
  }

  floorY(x, z) { return this.covers(x, z) ? FY : 0; }

  computeRuns() {
    const X = [...new Set(this.rooms.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
    const Z = [...new Set(this.rooms.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
    const runs = [];
    const scan = (axis, lines, stops) => {
      for (const c of lines) {
        let cur = null;
        for (let i = 0; i < stops.length - 1; i++) {
          const a = stops[i], b = stops[i + 1], m = (a + b) / 2;
          const neg = axis === 'x' ? this.roomAt(m, c - 0.01) : this.roomAt(c - 0.01, m);
          const pos = axis === 'x' ? this.roomAt(m, c + 0.01) : this.roomAt(c + 0.01, m);
          const wall = neg !== pos && !(neg && pos && this.open.has(pairKey(neg.id, pos.id)));
          if (!wall) { cur = null; continue; }
          if (cur && cur.neg === neg && cur.pos === pos && Math.abs(cur.b - a) < EPS) cur.b = b;
          else { cur = { axis, c, a, b, neg, pos }; runs.push(cur); }
        }
      }
    };
    scan('x', Z, X);
    scan('z', X, Z);
    // Corners: runs along x own every junction square; runs along z stop at
    // the face of whatever x-run they meet. Nothing overlaps, so nothing
    // flickers, and an L-corner is closed.
    const on = (r, t) => r.a - EPS <= t && t <= r.b + EPS;
    const touchesZ = (x, z) => runs.some((r) => r.axis === 'z' && Math.abs(r.c - x) < EPS && on(r, z));
    const touchesX = (x, z) => runs.some((r) => r.axis === 'x' && Math.abs(r.c - z) < EPS && on(r, x));
    const continuesX = (run, x) => runs.some((r) => r !== run && r.axis === 'x' && Math.abs(r.c - run.c) < EPS && (Math.abs(r.a - x) < EPS || Math.abs(r.b - x) < EPS));
    for (const r of runs) {
      if (r.axis === 'x') {
        r.e0 = touchesZ(r.a, r.c) && !continuesX(r, r.a) ? WT / 2 : 0;
        r.e1 = touchesZ(r.b, r.c) && !continuesX(r, r.b) ? WT / 2 : 0;
      } else {
        r.e0 = touchesX(r.c, r.a) ? -WT / 2 : 0;
        r.e1 = touchesX(r.c, r.b) ? -WT / 2 : 0;
      }
      r.key = `${r.axis}:${r.c}:${r.a}:${r.b}`;
      r.exterior = !r.neg || !r.pos;
      r.lowered = false;
    }
    this.runs = runs;
    this.assignOpenings();
  }

  // Which run (and where along it) an opening at (x,z) belongs to.
  runAt(x, z, tol = 0.05) {
    for (const r of this.runs) {
      if (r.axis === 'x' && Math.abs(z - r.c) < tol && x > r.a && x < r.b) return [r, x];
      if (r.axis === 'z' && Math.abs(x - r.c) < tol && z > r.a && z < r.b) return [r, z];
    }
    return [null, 0];
  }

  assignOpenings() {
    for (const r of this.runs) r.openings = [];
    for (const o of this.openings) {
      const [r, at] = this.runAt(o.x, o.z);
      if (!r) { o.orphan = true; continue; }
      o.orphan = false;
      o.run = r; o.at = at;
      r.openings.push(o);
    }
  }

  sideKey(run, side) { return `${run.key}|${side}`; }
  sideOwner(run, side) { return side === 'n' ? run.neg : run.pos; }
  sideFinish(run, side) {
    const owner = this.sideOwner(run, side);
    return this.paint[this.sideKey(run, side)] || (owner ? owner.wall : this.exterior);
  }
  roomFloor(room) { return this.floors[room.id] || room.floor; }

  // ------------------------------------------------------------ building

  build() {
    this.buildFloors();
    for (const r of this.runs) this.buildRun(r);
    this.buildRoof();
    this.rebuildWalls();
  }

  buildFloors() {
    const g = this.game;
    const found = [];
    this.floorMeshes = [];
    for (const room of this.rooms) {
      const w = room.x1 - room.x0, d = room.z1 - room.z0;
      const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
      const id = this.roomFloor(room);
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      metricUV(geo, 'y', floorTile(id), { x: cx, z: cz });
      const mesh = new THREE.Mesh(geo, floorMat(id));
      mesh.position.set(cx, FY + 0.003, cz);
      mesh.receiveShadow = true;
      mesh.userData = { kind: 'floor', room };
      this.group.add(mesh);
      this.floorMeshes.push(mesh);
      this.pickables.push(mesh);
      const f = box(w + WT, FY, d + WT);
      f.translate(cx, FY / 2, cz);
      found.push(f);
      const [wx, wz] = this.toWorld(cx, cz);
      this.colliders.push(g.physics.add({ x: wx, z: wz, hx: (w + WT) / 2, hz: (d + WT) / 2, y0: 0, y1: FY, walk: true, tag: 'floor' }));
    }
    const fm = new THREE.Mesh(mergeGeometries(found.map((x) => x.toNonIndexed())), GROUND.foundation());
    fm.receiveShadow = true; fm.castShadow = true;
    this.group.add(fm);
    this.foundation = fm;
  }

  setFloor(room, id) {
    if (id) this.floors[room.id] = id; else delete this.floors[room.id];
    const mesh = this.floorMeshes.find((m) => m.userData.room === room);
    const fid = this.roomFloor(room);
    mesh.material = floorMat(fid);
    metricUV(mesh.geometry, 'y', floorTile(fid), mesh.position);
  }

  // Solid rectangles of a run at height h, in (along, up) coordinates.
  rects(run, h) {
    const s0 = run.a - run.e0, s1 = run.b + run.e1;
    const ops = run.openings.filter((o) => o.bottom < h - 0.05)
      .map((o) => ({ a: o.at - o.w / 2, b: o.at + o.w / 2, y0: o.bottom, y1: Math.min(o.top, h) }))
      .sort((p, q) => p.a - q.a);
    const out = [];
    let s = s0;
    for (const o of ops) {
      if (o.a > s + EPS) out.push([s, o.a, 0, h]);
      if (o.y0 > EPS) out.push([o.a, o.b, 0, o.y0]);
      if (o.y1 < h - EPS) out.push([o.a, o.b, o.y1, h]);
      s = o.b;
    }
    if (s1 > s + EPS) out.push([s, s1, 0, h]);
    return out;
  }

  // Local position of (along s, up y, across off) on a run.
  at(run, s, y, off = 0) { return run.axis === 'x' ? new THREE.Vector3(s, FY + y, run.c + off) : new THREE.Vector3(run.c + off, FY + y, s); }

  buildRun(run) {
    this.disposeRun(run);
    // Both versions stay in the scene, invisible, for picking; what you see
    // is the merged wall batch (rebuildWalls) plus the door leaves.
    run.dyn = new THREE.Group();
    run.full = this.runMeshes(run, WH);
    run.low = this.runMeshes(run, LOW);
    run.full.visible = false;
    run.low.visible = false;
    this.group.add(run.full, run.low, run.dyn);
    run.cols = [];
    for (const [s0, s1, y0, y1] of this.rects(run, WH)) {
      if (y0 > 1.0) continue;                 // above a door: nothing to bump into
      const c = this.at(run, (s0 + s1) / 2, 0);
      const [wx, wz] = this.toWorld(c.x, c.z);
      const len = (s1 - s0) / 2;
      run.cols.push(this.game.physics.add({ x: wx, z: wz, hx: run.axis === 'x' ? len : WT / 2, hz: run.axis === 'x' ? WT / 2 : len, y0: FY + y0, y1: FY + y1, tag: 'wall', ref: run }));
    }
    this.applyLowered(run);
  }

  runMeshes(run, h) {
    const g = new THREE.Group();
    const X = run.axis === 'x';
    const core = [], faces = { n: [], p: [] };
    for (const [s0, s1, y0, y1] of this.rects(run, h)) {
      const len = s1 - s0, hh = y1 - y0;
      const c = this.at(run, (s0 + s1) / 2, (y0 + y1) / 2);
      const b = box(X ? len : WT - 0.02, hh, X ? WT - 0.02 : len);
      b.translate(c.x, c.y, c.z);
      core.push(b);
      for (const side of ['n', 'p']) {
        const sg = side === 'p' ? 1 : -1;
        const f = new THREE.PlaneGeometry(len, hh);
        if (X) f.rotateY(side === 'p' ? 0 : Math.PI);
        else f.rotateY(side === 'p' ? Math.PI / 2 : -Math.PI / 2);
        const fc = this.at(run, (s0 + s1) / 2, (y0 + y1) / 2, sg * WT / 2);
        f.translate(fc.x, fc.y, fc.z);
        faces[side].push(f);
      }
    }
    // Casings around doors and windows, on both faces.
    for (const o of run.openings) {
      if (o.bottom >= h - 0.05) continue;
      const top = Math.min(o.top, h);
      for (const sg of [-1, 1]) {
        const off = sg * (WT / 2 + 0.012);
        for (const e of [-1, 1]) {
          const c = this.at(run, o.at + e * (o.w / 2 + TRIM / 2), (o.bottom + top) / 2, off);
          const b = box(X ? TRIM : 0.03, top - o.bottom + (o.top <= h ? TRIM : 0), X ? 0.03 : TRIM);
          b.translate(c.x, c.y + (o.top <= h ? TRIM / 2 : 0), c.z);
          core.push(b);
        }
        if (o.top <= h) {
          const c = this.at(run, o.at, o.top + TRIM / 2, off);
          const b = box(X ? o.w + TRIM * 2 : 0.03, TRIM, X ? 0.03 : o.w + TRIM * 2);
          b.translate(c.x, c.y, c.z);
          core.push(b);
        }
        if (o.kind === 'window') {
          const c = this.at(run, o.at, o.bottom - 0.025, sg * (WT / 2 + 0.04));
          const b = box(X ? o.w + TRIM * 2 : 0.1, 0.05, X ? 0.1 : o.w + TRIM * 2);
          b.translate(c.x, c.y, c.z);
          core.push(b);
        }
      }
    }
    const low = h !== WH;
    const coreMesh = new THREE.Mesh(mergeGeometries(core.map((x) => x.toNonIndexed())), GROUND.trim());
    coreMesh.castShadow = true; coreMesh.receiveShadow = true;
    coreMesh.userData = { kind: 'wallcore', run, low };
    g.add(coreMesh);
    for (const side of ['n', 'p']) {
      if (!faces[side].length) continue;
      const geo = mergeGeometries(faces[side]);
      metricUV(geo, X ? 'z' : 'x');
      const m = new THREE.Mesh(geo, wallMat(this.sideFinish(run, side)));
      m.receiveShadow = true; m.castShadow = true;
      m.userData = { kind: 'wall', run, side, low };
      g.add(m);
      this.pickables.push(m);
      if (h === WH) run[`face_${side}`] = m; else run[`lowface_${side}`] = m;
    }
    if (h === WH) {
      for (const o of run.openings) {
        if (o.kind === 'window') g.add(this.windowMesh(run, o));
        if (o.kind === 'door' || o.kind === 'front') run.dyn.add(this.doorLeaf(run, o));
      }
    }
    return g;
  }

  windowMesh(run, o) {
    const X = run.axis === 'x';
    const g = new THREE.Group();
    const c = this.at(run, o.at, (o.bottom + o.top) / 2);
    const glass = new THREE.Mesh(box(X ? o.w : 0.02, o.top - o.bottom, X ? 0.02 : o.w), M.glass());
    glass.position.copy(c);
    g.add(glass);
    // Mullion and transom: reads as a window from any distance.
    const t = GROUND.trim();
    const mul = new THREE.Mesh(box(X ? 0.05 : 0.06, o.top - o.bottom, X ? 0.06 : 0.05), t);
    mul.position.copy(c);
    const tr = new THREE.Mesh(box(X ? o.w : 0.06, 0.05, X ? 0.06 : o.w), t);
    tr.position.copy(c); tr.position.y = FY + o.bottom + (o.top - o.bottom) * 0.62;
    g.add(mul, tr);
    return g;
  }

  doorLeaf(run, o) {
    const X = run.axis === 'x';
    const hinge = new THREE.Group();
    const h0 = this.at(run, o.at - o.w / 2, 0);
    hinge.position.copy(h0);
    const base = X ? 0 : -Math.PI / 2;
    hinge.rotation.y = base;
    const front = o.kind === 'front';
    const leafMat = front ? M.wood(o.color || '#7a2e2a') : GROUND.trim();
    const leaf = new THREE.Mesh(box(o.w - 0.03, o.top - 0.02, 0.045), leafMat);
    leaf.position.set(o.w / 2, (o.top - 0.02) / 2, 0);
    leaf.castShadow = true;
    hinge.add(leaf);
    for (const z of [-0.035, 0.035]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.chrome());
      knob.position.set(o.w - 0.1, 1.0, z);
      hinge.add(knob);
    }
    if (front) {
      const pane = new THREE.Mesh(box(0.3, 0.5, 0.05), M.glass());
      pane.position.set(o.w / 2, 1.55, 0);
      hinge.add(pane);
    }
    // Which way it swings: into the house for outside doors, else to +n.
    const swing = run.exterior ? (run.pos ? 1 : -1) : 1;
    const wp = this.at(run, o.at, 0);
    const [wx, wz] = this.toWorld(wp.x, wp.z);
    const d = { hinge, base, swing, X, open: 0, pos: new THREE.Vector3(wx, FY, wz), o };
    this.doors = this.doors.filter((x) => x.o !== o);
    this.doors.push(d);
    return hinge;
  }

  disposeRun(run) {
    for (const k of ['full', 'low', 'dyn']) {
      const g = run[k];
      if (!g) continue;
      g.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); this.pickables = this.pickables.filter((p) => p !== m); } });
      g.removeFromParent();
      run[k] = null;
    }
    for (const c of run.cols || []) this.game.physics.remove(c);
    run.cols = [];
    this.doors = this.doors.filter((d) => d.o.run !== run);
  }

  // A hip roof per roof rectangle, over the eaves by 45cm.
  buildRoof() {
    const rects = this.plan.roofs || [this.bounds()];
    const geos = [];
    const fascia = [];
    const ov = 0.45, pitch = this.plan.pitch || 0.5;
    for (const [a0, b0, a1, b1] of rects) {
      const x0 = a0 - ov, z0 = b0 - ov, x1 = a1 + ov, z1 = b1 + ov;
      const W = x1 - x0, D = z1 - z0, y = FY + WH;
      const rise = Math.min(W, D) / 2 * pitch;
      const alongX = W >= D;
      const half = Math.min(W, D) / 2;
      const zc = (z0 + z1) / 2, xc = (x0 + x1) / 2;
      const R0 = alongX ? [x0 + half, y + rise, zc] : [xc, y + rise, z0 + half];
      const R1 = alongX ? [x1 - half, y + rise, zc] : [xc, y + rise, z1 - half];
      const A = [x0, y, z0], B = [x1, y, z0], C = [x1, y, z1], Dd = [x0, y, z1];
      const tris = alongX
        ? [[Dd, C, R1], [Dd, R1, R0], [B, A, R0], [B, R0, R1], [A, Dd, R0], [C, B, R1]]
        : [[A, Dd, R1], [A, R1, R0], [C, B, R0], [C, R0, R1], [B, A, R0], [Dd, C, R1]];
      const pos = [];
      for (const t of tris) for (const p of t) pos.push(...p);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      // UVs: along the eave, and up the slope.
      const uv = [];
      const n = g.attributes.normal;
      for (let i = 0; i < pos.length / 3; i++) {
        const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        const nx = n.getX(i), nz = n.getZ(i);
        const u = Math.abs(nx) > Math.abs(nz) ? pz : px;
        const v = (py - y) / Math.max(0.2, Math.sqrt(1 - Math.min(0.99, n.getY(i) ** 2))) * 0.5;
        uv.push(u * 0.9, v + (Math.abs(nx) > Math.abs(nz) ? px : pz) * 0.02);
      }
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geos.push(g);
      // Fascia board round the eaves.
      for (const [bx, bz, bw, bd] of [[xc, z0, W, 0.06], [xc, z1, W, 0.06], [x0, zc, 0.06, D], [x1, zc, 0.06, D]]) {
        const f = box(bw, 0.2, bd);
        f.translate(bx, y - 0.08, bz);
        fascia.push(f.toNonIndexed());
      }
    }
    const roof = new THREE.Group();
    const rm = new THREE.Mesh(mergeGeometries(geos), roofMat(this.roofId));
    rm.castShadow = true; rm.receiveShadow = true;
    roof.add(rm, new THREE.Mesh(mergeGeometries(fascia), GROUND.trim()));
    roof.visible = this.roofOn;
    this.roof = roof;
    this.group.add(roof);
  }

  bounds() {
    return [Math.min(...this.rooms.map((r) => r.x0)), Math.min(...this.rooms.map((r) => r.z0)), Math.max(...this.rooms.map((r) => r.x1)), Math.max(...this.rooms.map((r) => r.z1))];
  }

  setRoof(on) {
    this.roofOn = on;
    this.roof.visible = on;
    this._camKey = null;
  }

  setRoofStyle(id) {
    this.roofId = id;
    this.roof.children[0].material = roofMat(id);
  }

  // ------------------------------------------------------------ editing

  paintSide(run, side, id) {
    this.paint[this.sideKey(run, side)] = id;
    this.refreshSide(run, side);
  }

  // Every side facing a room (or, for null, every outside face).
  paintRoom(room, id) {
    if (!room) this.exterior = id;
    for (const r of this.runs) for (const s of ['n', 'p']) {
      if (this.sideOwner(r, s) !== room) continue;
      if (room) this.paint[this.sideKey(r, s)] = id; else delete this.paint[this.sideKey(r, s)];
      this.refreshSide(r, s);
    }
  }

  refreshSide(run, side) {
    const m = wallMat(this.sideFinish(run, side));
    if (run[`face_${side}`]) run[`face_${side}`].material = m;
    if (run[`lowface_${side}`]) run[`lowface_${side}`].material = m;
    this.wallsDirty = true;
  }

  // Add a door or window where (x,z) falls on a wall. Returns why not, or null.
  canOpen(x, z, kind, w) {
    const [run, at] = this.runAt(x, z, WT);
    if (!run) return { why: 'Not on a wall' };
    const spec = openingSpec({ kind, w });
    const lo = run.a + spec.w / 2 + 0.12, hi = run.b - spec.w / 2 - 0.12;
    if (lo > hi) return { why: 'Wall too short' };
    const s = Math.round(Math.min(hi, Math.max(lo, at)) * 4) / 4;
    for (const o of run.openings) if (Math.abs(o.at - s) < (o.w + spec.w) / 2 + 0.2) return { why: 'Too close to another opening', run, at: s };
    if (kind === 'window' && !run.exterior) return { why: 'Windows go on outside walls', run, at: s };
    return { run, at: s, spec };
  }

  addOpening(x, z, kind, w) {
    const c = this.canOpen(x, z, kind, w);
    if (c.why) return c.why;
    const X = c.run.axis === 'x';
    const o = openingSpec({ kind, w, x: X ? c.at : c.run.c, z: X ? c.run.c : c.at });
    this.openings.push(o);
    this.assignOpenings();
    this.buildRun(c.run);
    this.changed?.();
    return null;
  }

  removeOpening(o) {
    this.openings = this.openings.filter((x) => x !== o);
    const run = o.run;
    this.assignOpenings();
    if (run) this.buildRun(run);
    this.changed?.();
  }

  // Nearest opening to a lot-local point, within r.
  openingNear(x, z, r = 0.8) {
    let best = null, bd = r;
    for (const o of this.openings) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ------------------------------------------------------------ per frame

  // Cutaway: a wall comes down when it stands between the camera and a room.
  setMode(mode) { this.mode = mode; this._camKey = null; }

  updateView(camPos, viewDir) {
    const [cx, cz] = this.toLocal(camPos.x, camPos.z);
    const key = `${this.mode}:${this.roofOn}:${Math.round(cx * 2)}:${Math.round(cz * 2)}`;
    if (key === this._camKey) { if (this.wallsDirty) this.rebuildWalls(); return; }
    this._camKey = key;
    for (const r of this.runs) {
      let low = false;
      if (this.roofOn || this.mode === 'up') low = false;
      else if (this.mode === 'down') low = true;
      else {
        const camSide = r.axis === 'x' ? cz - r.c : cx - r.c;
        const behind = camSide > 0 ? r.neg : r.pos;
        const facing = Math.abs(r.axis === 'x' ? viewDir.z : viewDir.x);
        low = !!behind && facing > 0.3;
      }
      if (low !== r.lowered) { r.lowered = low; this.applyLowered(r); }
    }
    if (this.wallsDirty) this.rebuildWalls();
  }

  applyLowered(r) {
    if (r.dyn) r.dyn.visible = !r.lowered;
    this.wallsDirty = true;
  }

  // Every visible wall, merged into one mesh per finish. Measured: 40-odd
  // runs drew ~240 calls (faces, cores, shadows); merged, about 20. Rebuilt
  // when the cutaway changes or a wall is painted, not per frame.
  rebuildWalls() {
    this.wallsDirty = false;
    for (const m of this.wallBatch || []) { m.geometry.dispose(); m.removeFromParent(); }
    this.wallBatch = [];
    const buckets = new Map();
    for (const r of this.runs) {
      const src = r.lowered ? r.low : r.full;
      if (!src) continue;
      src.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        if (o.matrixAutoUpdate) { o.updateMatrix(); g.applyMatrix4(o.matrix); }
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const key = o.material.uuid;
        if (!buckets.has(key)) buckets.set(key, { material: o.material, geos: [] });
        buckets.get(key).geos.push(g);
      });
    }
    for (const b of buckets.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(b.geos), b.material);
      for (const g of b.geos) g.dispose();
      mesh.castShadow = !b.material.transparent;
      mesh.receiveShadow = true;
      mesh.raycast = () => {};
      this.group.add(mesh);
      this.wallBatch.push(mesh);
    }
  }

  updateDoors(dt, actors) {
    for (const d of this.doors) {
      let near = false;
      for (const a of actors) {
        const p = a.object.position;
        if (Math.abs(p.x - d.pos.x) < 1.3 && Math.abs(p.z - d.pos.z) < 1.3) { near = true; break; }
      }
      d.open += ((near ? 1 : 0) - d.open) * Math.min(1, dt * 6);
      d.hinge.rotation.y = d.base + (d.X ? -1 : 1) * d.swing * d.open * 1.45;
    }
  }

  // Bring the house in line with a saved state (undo, redo).
  applyState(st) {
    const openings = JSON.stringify(st.openings);
    if (openings !== JSON.stringify(this.state().openings)) {
      this.openings = st.openings.map(openingSpec);
      this.assignOpenings();
      for (const r of this.runs) this.buildRun(r);
    }
    this.paint = { ...st.paint };
    this.exterior = st.exterior;
    for (const r of this.runs) for (const s of ['n', 'p']) this.refreshSide(r, s);
    this.floors = { ...st.floors };
    for (const room of this.rooms) this.setFloor(room, this.floors[room.id]);
    if (st.roof && st.roof !== this.roofId) this.setRoofStyle(st.roof);
  }

  // ------------------------------------------------------------ lifecycle

  state() {
    return {
      openings: this.openings.map(({ x, z, kind, w, bottom, top, color }) => ({ x, z, kind, w, bottom, top, color })),
      paint: { ...this.paint }, floors: { ...this.floors }, exterior: this.exterior, roof: this.roofId,
    };
  }

  dispose() {
    for (const r of this.runs) this.disposeRun(r);
    for (const c of this.colliders) this.game.physics.remove(c);
    this.group.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    this.group.removeFromParent();
  }

  // A house you are not editing: walls up, roof on, merged per material
  // so a whole neighbour costs a handful of draw calls.
  freeze() {
    this.setMode('up');
    this.setRoof(true);
    for (const r of this.runs) { r.lowered = false; this.applyLowered(r); }
    this.rebuildWalls();
    for (const d of this.doors) d.hinge.rotation.y = d.base;
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const byMat = new Map();
    this.group.traverseVisible((m) => {
      if (!m.isMesh) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      byMat.get(m.material).push(g);
    });
    const old = [...this.group.children];
    for (const c of old) { c.traverse((m) => { if (m.isMesh) m.geometry.dispose(); }); c.removeFromParent(); }
    for (const [mat, geos] of byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.doors = [];
    this.pickables = [];
    this.frozen = true;
  }
}

// Metric UVs from positions: `drop` is the axis the surface faces along
// (y for floors; for walls, the across axis), so textures tile per metre.
function metricUV(geo, drop, tile = 1, origin = null) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const ox = origin ? origin.x : 0, oz = origin ? origin.z : 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + ox, y = p.getY(i), z = p.getZ(i) + oz;
    let u, v;
    if (drop === 'y') { u = x; v = -z; }
    else if (drop === 'z') { u = x; v = y; }
    else { u = z; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
