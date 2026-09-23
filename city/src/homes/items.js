// Furniture that has been bought and placed: its meshes, what you bump
// into, where you can sit, and what it does (a TV that shows something, a
// lamp that lights the room, a stereo that plays). Unlike the city, where
// everything is merged once and never moves, every piece here can be moved,
// turned or sold, so each owns its colliders, seats and effects and can
// take them all back.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BY_ID, prepared } from './catalog.js';
import { FY, WT } from './house.js';
import { makeSeat } from '../game/seats.js';
import { drawTV } from '../game/hooks.js';

let nextUid = 1;

const rotXZ = (x, z, rot) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x * c + z * s, -x * s + z * c];
};

// Oriented rectangles in the ground plane: {x, z, hx, hz, rot}.
export function obbOverlap(a, b, pad = 0) {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const t of axes) {
    const ux = Math.cos(t), uz = -Math.sin(t);
    const proj = (r) => Math.abs(r.hx * (Math.cos(r.rot) * ux - Math.sin(r.rot) * uz)) + Math.abs(r.hz * (Math.sin(r.rot) * ux + Math.cos(r.rot) * uz));
    const d = Math.abs(dx * ux + dz * uz);
    if (d >= proj(a) + proj(b) + pad) return false;
  }
  return true;
}

export class Items {
  constructor(game, home) {
    this.game = game;
    this.home = home;            // { house, lot, models }
    this.list = [];
    this.byUid = new Map();
    this.changed = null;          // callback: nav grid and saves listen
    this.batchMeshes = [];
    this.batchDirty = true;
  }

  get house() { return this.home.house; }
  get lot() { return this.home.lot; }

  // ------------------------------------------------------------ queries

  footprint(entry, x, z, rot, prep = prepared(entry, this.home.models)) {
    const [ox, oz] = rotXZ(prep.fp.cx, prep.fp.cz, rot);
    return { x: x + ox, z: z + oz, hx: prep.fp.hx, hz: prep.fp.hz, rot };
  }

  // The highest table, counter or shelf top under a point.
  surfaceAt(x, z, ignore = null) {
    let best = null;
    for (const it of this.list) {
      const top = it.entry.top;
      if (!top || it === ignore || it.wall) continue;
      const [lx, lz] = rotXZ(x - it.x, z - it.z, -it.rot);
      if (Math.abs(lx) < top.hx && Math.abs(lz) < top.hz) {
        const y = it.y + top.y;
        if (!best || y > best.y) best = { item: it, y };
      }
    }
    return best;
  }

  // Nearest wall face in front of a point, for paintings and clocks.
  wallFaceAt(x, z, reach = 0.9) {
    let best = null;
    for (const run of this.house.runs) {
      for (const side of ['n', 'p']) {
        const sg = side === 'p' ? 1 : -1;
        const face = run.c + sg * WT / 2;
        const along = run.axis === 'x' ? x : z;
        const across = run.axis === 'x' ? z : x;
        const d = (across - face) * sg;
        if (d < -0.05 || d > reach || along < run.a || along > run.b) continue;
        if (!best || d < best.d) best = { run, side, sg, d, along, face };
      }
    }
    return best;
  }

  // Snap a wall item onto the face nearest (x,z). Returns placement or null.
  snapToWall(entry, x, z) {
    const f = this.wallFaceAt(x, z);
    if (!f) return null;
    const prep = prepared(entry, this.home.models);
    const hw = prep.fp.hx;
    const lo = f.run.a + hw + 0.05, hi = f.run.b - hw - 0.05;
    if (lo > hi) return null;
    const along = Math.min(hi, Math.max(lo, Math.round(f.along * 4) / 4));
    const off = f.face + f.sg * (-prep.bb.min.z + 0.004);
    const rot = f.run.axis === 'x' ? (f.sg > 0 ? 0 : Math.PI) : (f.sg > 0 ? Math.PI / 2 : -Math.PI / 2);
    const [px, pz] = f.run.axis === 'x' ? [along, off] : [off, along];
    return { x: px, z: pz, rot, y: FY + (entry.mount ?? 1.5), run: f.run, side: f.side };
  }

  // Why an item can't go here, or null if it can.
  whyNot(entry, x, z, rot, y, { ignore = null, wall = null } = {}) {
    const prep = prepared(entry, this.home.models);
    if (!prep) return 'Still loading';
    const fp = this.footprint(entry, x, z, rot, prep);
    const L = this.lot;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const [ox, oz] = rotXZ(a * fp.hx, b * fp.hz, rot);
      return [fp.x + ox, fp.z + oz];
    });
    for (const [cx, cz] of corners) if (Math.abs(cx) > L.w / 2 + 0.02 || Math.abs(cz) > L.d / 2 + 0.02) return 'Outside the lot';
    const skip = (it) => it === ignore || (ignore && it.parent === ignore);
    if (entry.place === 'wall') {
      if (!wall) return 'Needs a wall';
      const [s0, s1] = wall.run.axis === 'x' ? [fp.x - fp.hx, fp.x + fp.hx] : [fp.z - fp.hx, fp.z + fp.hx];
      const top = y + prep.bb.max.y, bot = y + prep.bb.min.y;
      for (const o of wall.run.openings) {
        if (s1 > o.at - o.w / 2 - 0.05 && s0 < o.at + o.w / 2 + 0.05 && top > FY + o.bottom && bot < FY + o.top) return 'In the way of a door or window';
      }
      for (const it of this.list) {
        if (skip(it) || !it.wall || it.wallRun !== wall.run || it.wallSide !== wall.side) continue;
        if (obbOverlap(fp, this.footprint(it.entry, it.x, it.z, it.rot), -0.01) && top > it.y + it.prep.bb.min.y && bot < it.y + it.prep.bb.max.y) return 'Overlaps something on the wall';
      }
      return null;
    }
    const house = this.house;
    const surface = y > house.floorY(x, z) + 0.2;
    if (!surface) {
      // One floor under the whole footprint: not half on the foundation.
      const ins = corners.map(([cx, cz]) => house.covers(cx, cz, 0.08));
      if (ins.some((v) => v !== ins[0])) return 'Straddles the house wall';
      if (entry.outdoor && ins[0]) return 'That goes outside';
      for (const run of house.runs) {
        const s0 = run.a - Math.max(0, run.e0), s1 = run.b + Math.max(0, run.e1);
        const wallBox = run.axis === 'x' ? { x: (s0 + s1) / 2, z: run.c, hx: (s1 - s0) / 2, hz: WT / 2, rot: 0 } : { x: run.c, z: (s0 + s1) / 2, hx: WT / 2, hz: (s1 - s0) / 2, rot: 0 };
        if (obbOverlap(fp, wallBox, -0.005)) return 'Runs into a wall';
        for (const o of run.openings) {
          if (o.kind === 'window' || entry.flat) continue;
          // Keep doorways clear, and a step in front of them on both sides.
          const door = run.axis === 'x' ? { x: o.at, z: run.c, hx: o.w / 2, hz: 0.55, rot: 0 } : { x: run.c, z: o.at, hx: 0.55, hz: o.w / 2, rot: 0 };
          if (obbOverlap(fp, door)) return 'Blocks a doorway';
        }
      }
      if (!entry.flat) {
        for (const it of this.list) {
          if (skip(it) || it.wall || it.entry.flat || it.parent) continue;
          // Chairs and stools tuck under tables and counters.
          if ((entry.tuck && it.entry.top) || (it.entry.tuck && entry.top)) continue;
          if (obbOverlap(fp, this.footprint(it.entry, it.x, it.z, it.rot), -0.01)) return `Bumps into the ${it.entry.name.toLowerCase()}`;
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------ changes

  // opts: { y, wall: {run, side}, uid, parent }
  place(id, x, z, rot, opts = {}) {
    const entry = BY_ID[id];
    if (!entry) { console.warn(`no catalogue item ${id}`); return null; }
    const prep = prepared(entry, this.home.models);
    if (!prep) { console.warn(`item ${id} not ready`); return null; }
    const uid = opts.uid || nextUid++;
    nextUid = Math.max(nextUid, uid + 1);
    let y = opts.y;
    let parent = null;
    if (y === undefined) {
      const s = entry.place === 'surface' ? this.surfaceAt(x, z) : null;
      if (s) { y = s.y; parent = s.item; } else y = this.house.floorY(x, z);
    } else if (opts.parent) parent = this.byUid.get(opts.parent) || null;
    else if (entry.place === 'surface' && y > this.house.floorY(x, z) + 0.2) parent = this.surfaceAt(x, z)?.item || null;
    const it = { uid, id, entry, prep, x, z, rot, y, parent, cols: [], seats: [], hooks: [], fx: [] };
    if (entry.place === 'wall') {
      const w = opts.wall || this.snapToWall(entry, x, z);
      it.wall = true;
      it.wallRun = w?.run || null; it.wallSide = w?.side || null;
    }
    it.group = this.buildGroup(it);
    this.game.scene.add(it.group);
    this.attach(it);
    this.list.push(it);
    this.byUid.set(uid, it);
    this.batchDirty = true;
    return it;
  }

  buildGroup(it) {
    const g = new THREE.Group();
    g.name = `item:${it.id}`;
    g.userData.item = it;
    const { prep } = it;
    // The body is drawn by the merged batch, not by itself: it stays in the
    // scene, invisible, so clicks still find the piece they land on.
    const body = new THREE.Group();
    body.visible = false;
    if (prep.proto) body.add(prep.proto.clone());
    else for (const p of prep.parts) body.add(new THREE.Mesh(p.geo, p.material));
    g.add(body);
    it.body = body;
    g.traverse((o) => { if (o.isMesh) o.userData.item = it; });
    this.pose(it, g);
    return g;
  }

  pose(it, g = it.group) {
    g.position.set(this.lot.cx + it.x, it.y, this.lot.cz + it.z);
    g.rotation.y = it.rot;
    g.updateMatrixWorld(true);
  }

  // World-space colliders, seats and working parts.
  attach(it) {
    const { def } = it.prep;
    const P = this.game.physics;
    const W = (lx, lz) => { const [ox, oz] = rotXZ(lx, lz, it.rot); return [this.lot.cx + it.x + ox, this.lot.cz + it.z + oz]; };
    if (!it.wall && !it.parent) {
      for (const c of def.cols || []) {
        const [wx, wz] = W(c.x || 0, c.z || 0);
        it.cols.push(P.add({ x: wx, z: wz, hx: c.hx, hz: c.hz, rot: it.rot, y0: it.y + (c.y0 || 0), y1: it.y + c.h, tag: 'furniture', ref: it }));
      }
      if (def.walk) {
        const [wx, wz] = W(0, 0);
        it.cols.push(P.add({ x: wx, z: wz, hx: def.walk.hx, hz: def.walk.hz, rot: it.rot, y0: it.y, y1: it.y + def.walk.h, walk: true, tag: 'deck', ref: it }));
      }
    }
    for (const s of def.seats || []) {
      const [wx, wz] = W(s.x, s.z);
      const seat = makeSeat({ x: wx, y: it.y, z: wz, heading: s.heading + it.rot, h: s.h, kind: s.kind, loop: s.loop, opts: s.opts });
      seat.item = it;
      it.seats.push(seat);
    }
    for (const h of def.hooks || []) {
      const [wx, wz] = W(h.x, h.z);
      const hook = { ...h, pos: new THREE.Vector3(wx, it.y + h.y, wz), yaw: it.rot, item: it };
      it.hooks.push(hook);
      const make = FX[h.kind];
      if (make) it.fx.push(make(this.game, it, hook));
    }
  }

  detach(it) {
    for (const c of it.cols) this.game.physics.remove(c);
    it.cols = [];
    for (const s of it.seats) s.removed = true;
    it.seats = [];
    for (const f of it.fx) f.dispose?.();
    it.fx = [];
    it.hooks = [];
  }

  children(it) { return this.list.filter((c) => c.parent === it); }

  // Move (and turn) an item; things standing on it come along.
  move(it, x, z, rot, opts = {}) {
    const kids = this.children(it);
    const dRot = rot - it.rot;
    for (const k of kids) {
      const [lx, lz] = rotXZ(k.x - it.x, k.z - it.z, -it.rot);
      const [nx, nz] = rotXZ(lx, lz, rot);
      k.x = x + nx; k.z = z + nz; k.rot += dRot;
    }
    const oldY = it.y;
    this.detach(it);
    it.x = x; it.z = z; it.rot = rot;
    if (opts.y !== undefined) {
      it.y = opts.y;
      if (it.entry.place === 'surface') it.parent = it.y > this.house.floorY(x, z) + 0.2 ? this.surfaceAt(x, z, it)?.item || null : null;
    } else if (it.entry.place === 'surface') {
      const s = this.surfaceAt(x, z, it);
      it.y = s ? s.y : this.house.floorY(x, z);
      it.parent = s ? s.item : null;
    } else it.y = this.house.floorY(x, z);
    if (it.wall && opts.wall) { it.wallRun = opts.wall.run; it.wallSide = opts.wall.side; }
    this.pose(it);
    this.attach(it);
    for (const k of kids) {
      this.detach(k);
      k.y += it.y - oldY;
      this.pose(k);
      this.attach(k);
    }
    this.batchDirty = true;
    this.changed?.('move', it);
  }

  remove(it, { quiet = false } = {}) {
    for (const k of this.children(it)) this.remove(k, { quiet: true });
    this.detach(it);
    it.group.removeFromParent();
    this.list = this.list.filter((x) => x !== it);
    this.byUid.delete(it.uid);
    it.removed = true;
    this.batchDirty = true;
    if (!quiet) this.changed?.('remove', it);
  }

  clear({ keepOutdoor = false } = {}) {
    for (const it of [...this.list]) {
      if (it.removed) continue;
      if (keepOutdoor && !this.house.covers(it.x, it.z)) continue;
      this.remove(it, { quiet: true });
    }
    this.changed?.('clear');
  }

  seats() { return this.list.flatMap((i) => i.seats); }
  hooks() { return this.list.flatMap((i) => i.hooks); }

  // Hide an item (and what stands on it) while it's being carried.
  setHidden(it, hidden) {
    for (const x of [it, ...this.children(it)]) { x.hidden = hidden; x.group.visible = !hidden; }
    this.batchDirty = true;
  }

  update(dt) {
    for (const it of this.list) for (const f of it.fx) f.update?.(dt);
    if (this.batchDirty) this.rebuildBatch();
  }

  // Trees between the camera and the house are cut away, like the walls:
  // a palm crown in the foreground otherwise hides half the lot.
  updateOcclusion(camPos, target, viewDir) {
    const key = `${Math.round(camPos.x)}:${Math.round(camPos.z)}:${Math.round(target.x)}:${Math.round(target.z)}`;
    if (key === this._occKey) return;
    this._occKey = key;
    const tall = camPos.y - target.y < Math.hypot(camPos.x - target.x, camPos.z - target.z) * 3.5;
    for (const it of this.list) {
      if (!(it.prep.height > 2.6) || it.wall || this.house.covers(it.x, it.z)) continue;
      const dx = it.group.position.x - target.x, dz = it.group.position.z - target.z;
      const along = dx * viewDir.x + dz * viewDir.z;
      const lateral = Math.abs(dx * viewDir.z - dz * viewDir.x);
      const cut = tall && along > 1.5 && lateral < 9 && Math.hypot(dx, dz) < 30;
      if (!!it.cut !== cut) { it.cut = cut; this.batchDirty = true; }
    }
  }

  // All placed furniture, merged into one mesh per material (and shadow
  // flag). Measured: a furnished family house was ~1040 draw calls with a
  // mesh per piece per material; merged, a few hundred fewer. Rebuilt only
  // when something is placed, moved or sold.
  rebuildBatch() {
    this.batchDirty = false;
    for (const m of this.batchMeshes) { m.geometry.dispose(); m.removeFromParent(); }
    this.batchMeshes = [];
    const buckets = new Map();
    for (const it of this.list) {
      if (it.hidden || it.cut) continue;
      it.group.updateMatrixWorld(true);
      const shadow = !it.entry.flat;
      it.body.traverse((o) => {
        if (!o.isMesh) return;
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
        g.applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        g.morphAttributes = {};
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const key = `${mats[0].uuid}|${shadow}`;
        if (!buckets.has(key)) buckets.set(key, { material: mats[0], shadow, geos: [] });
        buckets.get(key).geos.push(g);
      });
    }
    for (const b of buckets.values()) {
      const geo = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.material);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.raycast = () => {};
      mesh.name = 'furniture-batch';
      this.game.scene.add(mesh);
      this.batchMeshes.push(mesh);
    }
  }

  dispose() {
    for (const m of this.batchMeshes) { m.geometry.dispose(); m.removeFromParent(); }
    this.batchMeshes = [];
  }

  // ------------------------------------------------------------ saving

  serialize() {
    return this.list.map((it) => {
      const o = { uid: it.uid, id: it.id, x: +it.x.toFixed(3), z: +it.z.toFixed(3), rot: +it.rot.toFixed(4), y: +it.y.toFixed(3) };
      if (it.parent) o.parent = it.parent.uid;
      if (it.wall && it.wallRun) o.wall = { run: it.wallRun.key, side: it.wallSide };
      return o;
    });
  }

  // Bring the placed items in line with a saved list (undo, redo, loading),
  // touching only what differs.
  load(saved) {
    const want = new Map(saved.map((s) => [s.uid, s]));
    const same = (it, s) => it.id === s.id && Math.abs(it.x - s.x) < 1e-3 && Math.abs(it.z - s.z) < 1e-3 && Math.abs(it.rot - s.rot) < 1e-3 && Math.abs(it.y - s.y) < 1e-3;
    for (const it of [...this.list]) {
      const s = want.get(it.uid);
      if (!s || !same(it, s)) this.remove(it, { quiet: true });
    }
    // Parents before children.
    const order = [...saved].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
    for (const s of order) {
      if (this.byUid.has(s.uid)) continue;
      const wall = s.wall ? this.wallFromKey(s.wall) : undefined;
      this.place(s.id, s.x, s.z, s.rot, { y: s.y, uid: s.uid, parent: s.parent, wall });
    }
    this.changed?.('load');
  }

  wallFromKey(w) {
    const run = this.house.runs.find((r) => r.key === w.run);
    return run ? { run, side: w.side } : null;
  }
}

// ---------------------------------------------------------------- effects

const FX = {
  tv(game, it, h) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 144;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: '#050608', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0, roughness: 0.2 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(h.w, h.h), mat);
    screen.position.set(h.x, h.y, h.z + 0.03);
    screen.userData.item = it;
    it.group.add(screen);
    const tv = { on: false, channel: 0, t: 0, acc: 0, ticker: 'SUNNY LANE NEWS  ·  NEIGHBOURHOOD BAKE SALE SATURDAY  ·  POOL SEASON OPENS  ·  LOST CAT FOUND ON THE ROOF AGAIN  ·  ' };
    it.tv = tv;
    const draw = () => { tv.t += 0.2; drawTV(c.getContext('2d'), tv); tex.needsUpdate = true; };
    return {
      update(dt) {
        mat.emissiveIntensity = tv.on ? 1.1 : 0;
        if (tv.on) { tv.acc += dt; if (tv.acc > 0.1) { tv.acc = 0; draw(); } }
      },
      dispose() { tex.dispose(); mat.dispose(); screen.geometry.dispose(); screen.removeFromParent(); },
    };
  },

  lamp(game, it, h) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(h.small ? 0.05 : 0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe0a8' }));
    glow.position.set(h.x, h.y, h.z);
    it.group.add(glow);
    const pool = game.lights;
    const spot = pool.add({ pos: h.pos.clone().add(new THREE.Vector3(0, 0.12, 0)), color: '#ffcf90', intensity: h.small ? 3 : 6, range: 6, priority: 3, night: true });
    it.lamp = spot;
    return {
      update() { glow.visible = spot.on; },
      dispose() { pool.spots = pool.spots.filter((s) => s !== spot); pool._t = 0; glow.geometry.dispose(); glow.removeFromParent(); },
    };
  },

  jukebox(game, it, h) {
    const src = game.audio?.jukebox(h.pos, { on: false });
    it.music = src;
    return { dispose() { if (src) game.audio.remove(src); } };
  },
};
