// Traffic: a lane network over the street grid, signals that cycle, AI cars
// that follow lanes, keep their distance and stop for red lights and for
// people in the road; parked cars at the curbs; and any car can be driven.
import * as THREE from 'three';
import { XS, ZS, HALF_ROAD, LANE_OFF, CURB_H } from '../world/layout.js';
import { setSignals } from '../world/roads.js';
import { CarRenderer, Car, VARIANTS, drive } from './vehicles.js';
import { approach } from './interact.js';
import { rng } from '../world/textures.js';
import { loadGLB } from '../core/loadglb.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collapse a model's meshes into one mesh per material, in `base`'s frame.
// The Ferrari arrives as 90 meshes: 90 draw calls (and 90 more for shadows)
// for one car. Merged, it is about 17.
function mergeByMaterial(root, base, skip) {
  base.updateMatrixWorld(true);
  const inv = base.matrixWorld.clone().invert();
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || (skip && skip(o))) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of groups) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = true;
    out.add(m);
  }
  return out;
}

const STOP = HALF_ROAD + 3.5;          // stop line distance from the intersection centre
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const RIGHT_OF = { n: 'e', e: 's', s: 'w', w: 'n' };
const _v = new THREE.Vector3();

class Segment {
  constructor(kind, p0, p1, p2 = null) {
    this.kind = kind;            // 'lane' | 'conn'
    this.p0 = p0; this.p1 = p1; this.p2 = p2;
    this.curve = p2 ? new THREE.QuadraticBezierCurve3(p0, p1, p2) : new THREE.LineCurve3(p0, p1);
    this.len = this.curve.getLength();
    this.next = [];
    this.cars = new Set();
  }
  at(s, out) { return this.curve.getPointAt(Math.min(1, Math.max(0, s / this.len)), out); }
  tangent(s, out) { return this.curve.getTangentAt(Math.min(1, Math.max(0, s / this.len)), out); }
}

export class Traffic {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.lanes = [];
    this.inters = new Map();
    this.r = rng(777);
    this.phaseT = 0;
    this.phase = { ns: 'green', ew: 'red', walkNS: false, walkEW: true };
  }

  async init() {
    const g = this.game;
    this.renderer = new CarRenderer(g.scene, 48);
    this.buildLanes();
    const want = g.params.has('nocars') ? 0 : Number(g.params.get('cars') || 22);
    this.spawnAI(want);
    this.spawnParked();
    await this.spawnHero();
    g.vehiclePrompt = (p) => this.prompt(p);
    g.updaters.push((dt) => this.update(dt));
    addEventListener('keydown', (e) => { if (e.code === 'KeyF' && !g.input.typing && g.input.enabled) this.toggleVehicle(); });
  }

  inter(i, j) {
    const k = `${i},${j}`;
    if (!this.inters.has(k)) {
      const signalled = i > 0 && i < XS.length - 1 && j > 0 && j < ZS.length - 1;
      this.inters.set(k, { i, j, x: XS[i], z: ZS[j], signalled, in: [], out: [], busy: new Set() });
    }
    return this.inters.get(k);
  }

  buildLanes() {
    const y = 0.02;
    const V = (x, z) => new THREE.Vector3(x, y, z);
    // North-south roads.
    for (let i = 0; i < XS.length; i++) for (let j = 0; j < ZS.length - 1; j++) {
      const x = XS[i];
      const a = this.inter(i, j), b = this.inter(i, j + 1);
      const nb = new Segment('lane', V(x + LANE_OFF, ZS[j + 1] - STOP), V(x + LANE_OFF, ZS[j] + STOP));
      nb.dir = 'n'; nb.road = 'ns'; nb.end = a; b.out.push(nb); a.in.push(nb);
      const sb = new Segment('lane', V(x - LANE_OFF, ZS[j] + STOP), V(x - LANE_OFF, ZS[j + 1] - STOP));
      sb.dir = 's'; sb.road = 'ns'; sb.end = b; a.out.push(sb); b.in.push(sb);
      this.lanes.push(nb, sb);
    }
    // East-west roads.
    for (let j = 0; j < ZS.length; j++) for (let i = 0; i < XS.length - 1; i++) {
      const z = ZS[j];
      const a = this.inter(i, j), b = this.inter(i + 1, j);
      const eb = new Segment('lane', V(XS[i] + STOP, z + LANE_OFF), V(XS[i + 1] - STOP, z + LANE_OFF));
      eb.dir = 'e'; eb.road = 'ew'; eb.end = b; a.out.push(eb); b.in.push(eb);
      const wb = new Segment('lane', V(XS[i + 1] - STOP, z - LANE_OFF), V(XS[i] + STOP, z - LANE_OFF));
      wb.dir = 'w'; wb.road = 'ew'; wb.end = a; b.out.push(wb); a.in.push(wb);
      this.lanes.push(eb, wb);
    }
    // Connectors through each intersection.
    for (const I of this.inters.values()) {
      for (const lin of I.in) {
        for (const lout of I.out) {
          if (lout.dir === OPP[lin.dir]) continue;
          const left = lout.dir !== lin.dir && lout.dir !== RIGHT_OF[lin.dir];
          // No unprotected lefts across oncoming traffic at signals.
          if (left && I.signalled) continue;
          const p0 = lin.p1, p2 = lout.p0;
          let p1;
          if (lout.dir === lin.dir) p1 = p0.clone().lerp(p2, 0.5);
          else {
            // Corner of the two lane lines.
            const d = DIRS[lin.dir];
            p1 = d[0] !== 0 ? new THREE.Vector3(p2.x, y, p0.z) : new THREE.Vector3(p0.x, y, p2.z);
          }
          const c = new Segment('conn', p0.clone(), p1, p2.clone());
          c.inter = I; c.from = lin; c.to = lout; c.turn = lout.dir === lin.dir ? 'straight' : left ? 'left' : 'right';
          c.next = [lout];
          lin.next.push(c);
        }
      }
    }
  }

  spawnAI(n) {
    const kinds = ['sedan', 'sedan', 'hatch', 'suv', 'van', 'pickup', 'sedan', 'hatch'];
    const taken = [];
    for (let k = 0; k < n; k++) {
      const lane = this.lanes[Math.floor(this.r() * this.lanes.length)];
      const s = 4 + this.r() * Math.max(1, lane.len - 8);
      const p = lane.at(s, new THREE.Vector3());
      if (taken.some((q) => q.distanceTo(p) < 12)) { k--; if (taken.length > 400) break; continue; }
      taken.push(p);
      const kind = kinds[Math.floor(this.r() * kinds.length)];
      const car = new Car(this.renderer, kind, k % 7 === 0 ? '#f2c230' : undefined);
      car.mode = 'ai';
      car.seg = lane; car.s = s; lane.cars.add(car);
      car.cruise = 9 + this.r() * 4;
      this.pickNext(car);
      this.placeOnSeg(car);
      car.box = this.game.physics.add({ x: p.x, z: p.z, hx: car.spec.W / 2, hz: car.spec.L / 2, rot: car.heading, y0: 0, y1: 1.6, tag: 'car', ref: car, noCam: true });
      this.cars.push(car);
    }
  }

  spawnParked() {
    const P = HALF_ROAD - 1.25;       // parking lane centre from road centre
    let count = 0;
    const kinds = ['sedan', 'hatch', 'suv', 'sedan', 'pickup', 'van'];
    const park = (x, z, heading) => {
      const kind = kinds[Math.floor(this.r() * kinds.length)];
      if (this.renderer.kinds[kind].used >= this.renderer.capacity - 4) return;
      const car = new Car(this.renderer, kind);
      car.mode = 'parked';
      car.showDriver = false;
      car.place(x, 0.02, z, heading);
      car.sync(0);
      car.box = this.game.physics.add({ x, z, hx: car.spec.W / 2, hz: car.spec.L / 2, rot: heading, y0: 0, y1: 1.6, tag: 'car', ref: car, noCam: true });
      this.cars.push(car);
      count++;
    };
    // Kerbside on some streets, both sides, away from intersections.
    const kerb = (p) => this.r() < p;
    for (let i = 0; i < XS.length; i++) for (let j = 0; j < ZS.length - 1; j++) {
      if (kerb(0.7)) continue;
      for (const side of [-1, 1]) {
        for (let z = ZS[j] + 16; z < ZS[j + 1] - 16; z += 7 + this.r() * 6) {
          if (kerb(0.6)) continue;
          park(XS[i] + side * P, z, side > 0 ? Math.PI : 0);
        }
      }
    }
    for (let j = 0; j < ZS.length; j++) for (let i = 0; i < XS.length - 1; i++) {
      if (kerb(0.72)) continue;
      for (const side of [-1, 1]) {
        for (let x = XS[i] + 16; x < XS[i + 1] - 16; x += 7 + this.r() * 6) {
          if (kerb(0.6)) continue;
          park(x, ZS[j] + side * P, side > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
    }
    for (const st of this.game.world.parkingStalls || []) {
      if (kerb(0.65)) continue;
      park(st.x, st.z + (st.heading ? 0 : 0), st.heading);
    }
    this.parkedCount = count;
  }

  // The Ferrari: parked on Ocean Drive where the player starts.
  async spawnHero() {
    const g = this.game;
    try {
      const gltf = await loadGLB(g.loader, 'assets/models/ferrari.glb');
      const model = gltf.scene;
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        if (o.material.name === 'Body_Color') { o.material = o.material.clone(); o.material.color.set('#ff2a6a'); o.material.metalness = 0.6; o.material.roughness = 0.25; }
      });
      const box = new THREE.Box3().setFromObject(model);
      model.updateMatrixWorld(true);
      const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((n) => model.getObjectByName(n)).filter(Boolean);
      const inWheel = (o) => wheels.some((w) => { let p = o; while (p) { if (p === w) return true; p = p.parent; } return false; });
      const merged = mergeByMaterial(model, model, inWheel);
      const pivots = wheels.map((w) => {
        const pivot = new THREE.Group();
        const rel = new THREE.Matrix4().multiplyMatrices(model.matrixWorld.clone().invert(), w.matrixWorld);
        rel.decompose(pivot.position, pivot.quaternion, pivot.scale);
        pivot.add(mergeByMaterial(w, w));
        merged.add(pivot);
        return pivot;
      });
      const car = new Car(this.renderer, 'sedan', null, { noSlot: true });
      car.hero = merged;
      car.heroWheels = pivots;
      car.spec = { ...VARIANTS.sedan, L: box.max.z - box.min.z, W: box.max.x - box.min.x, seat: [-0.4, 0.3], r: 0.34 };
      car.showDriver = false;
      car.mode = 'parked';
      car.sync = function sync(dt) {
        this.object.rotation.set(0, this.heading, 0);
        this.hero.position.copy(this.object.position);
        this.hero.rotation.y = this.heading;
        this.wheelSpin += (this.speed * dt) / this.spec.r;
        for (const w of this.heroWheels) { w.rotation.order = 'YXZ'; w.rotation.x = this.wheelSpin; }
      };
      g.scene.add(merged);
      const x = 190 + HALF_ROAD - 1.25, z = -24;
      car.place(x, 0.02, z, Math.PI);
      car.sync(0);
      car.box = g.physics.add({ x, z, hx: car.spec.W / 2, hz: car.spec.L / 2, rot: Math.PI, y0: 0, y1: 1.3, tag: 'car', ref: car, noCam: true });
      this.cars.push(car);
      this.hero = car;
    } catch (e) { console.warn('hero car failed to load', e); }
  }

  pickNext(car) {
    const opts = car.seg.next;
    car.nextSeg = opts.length ? opts[Math.floor(this.r() * opts.length)] : null;
  }

  placeOnSeg(car) {
    const p = car.seg.at(car.s, _v);
    car.object.position.copy(p);
    const t = car.seg.tangent(car.s, new THREE.Vector3());
    car.heading = Math.atan2(t.x, t.z);
  }

  canCross(road) {
    // Pedestrians cross a north-south road while east-west traffic has green.
    return road === 'ns' ? this.phase.walkNS : this.phase.walkEW;
  }

  updateSignals(dt) {
    this.phaseT += dt;
    const C = [['ns', 'green', 14], ['ns', 'yellow', 3], ['all', 'red', 2], ['ew', 'green', 14], ['ew', 'yellow', 3], ['all', 'red', 2]];
    const total = C.reduce((a, c) => a + c[2], 0);
    let t = this.phaseT % total, k = 0;
    while (t > C[k][2]) { t -= C[k][2]; k++; }
    const [road, col] = C[k];
    const ph = { ns: 'red', ew: 'red' };
    if (road !== 'all') ph[road] = col;
    ph.walkNS = ph.ew === 'green' && t < 11;
    ph.walkEW = ph.ns === 'green' && t < 11;
    this.phase = ph;
    setSignals(ph);
  }

  update(dt) {
    const g = this.game;
    this.updateSignals(dt);
    this.renderer.setNight(g.day.night);
    for (const car of this.cars) {
      if (car.mode === 'ai') this.aiStep(car, dt);
      else if (car.mode === 'player') this.playerStep(car, dt);
      else continue;
      car.sync(dt);
      if (car.box) g.physics.update(car.box, car.object.position.x, car.object.position.z, car.heading);
    }
    // Keep the driver in the seat.
    const p = g.player;
    if (p?.vehicle) {
      const sp = p.vehicle.seatPoint(_v);
      p.object.position.copy(sp);
      p.heading = p.vehicle.heading;
      p.object.rotation.y = p.heading;
    }
    this.engineSound(p?.vehicle);
  }

  aiStep(car, dt) {
    const seg = car.seg;
    let target = seg.kind === 'conn' ? (seg.turn === 'straight' ? car.cruise : 5.5) : car.cruise;
    // Car ahead on this segment or the next.
    let gap = Infinity;
    for (const o of seg.cars) if (o !== car && o.s > car.s) gap = Math.min(gap, o.s - car.s);
    if (gap === Infinity && car.nextSeg) for (const o of car.nextSeg.cars) gap = Math.min(gap, seg.len - car.s + o.s);
    // Anything else in front: the player's car, people in the road.
    const f = car.forward(_v);
    const px = car.object.position.x, pz = car.object.position.z;
    const obstacle = (x, z, halfW = 1.2) => {
      const dx = x - px, dz = z - pz;
      const ahead = dx * f.x + dz * f.z;
      const lat = Math.abs(-dx * f.z + dz * f.x);
      if (ahead > 0 && ahead < 16 && lat < halfW + car.spec.W / 2) gap = Math.min(gap, ahead - car.spec.L / 2);
    };
    for (const a of this.game.actors) {
      if (a.state === 'driving' || !a.grounded || a.object.position.y > 0.1) continue;
      obstacle(a.object.position.x, a.object.position.z, 0.3);
    }
    for (const o of this.cars) if (o !== car && (o.mode === 'player' || (o.mode === 'parked' && Math.abs(o.speed) < 0.1 && o.wasDriven))) obstacle(o.object.position.x, o.object.position.z, 1.1);
    if (gap < 20) target = Math.min(target, Math.max(0, (gap - 5.5) * 0.9));
    // Signals and busy junctions at the end of a lane.
    if (seg.kind === 'lane') {
      const toEnd = seg.len - car.s;
      let hold = false;
      if (seg.end.signalled) {
        const light = this.phase[seg.road];
        if (light === 'red' || (light === 'yellow' && toEnd > 9)) hold = true;
      } else if (car.nextSeg && toEnd < 8) {
        for (const o of seg.end.busy) if (o !== car && o.seg.from !== seg && o.seg.from.road !== seg.road) hold = true;
      }
      if (hold) target = Math.min(target, Math.max(0, (toEnd - 1.2) * 0.8));
    }
    if (gap < 8 && car.speed < 0.5) {
      car.blocked = (car.blocked || 0) + dt;
      if (car.blocked > 2.5 && !car.honked) { car.honked = true; this.honk(car); }
    } else { car.blocked = 0; car.honked = false; }
    const acc = target > car.speed ? 3.2 : 8;
    car.speed += Math.max(-acc * dt, Math.min(acc * dt, target - car.speed));
    if (car.speed < 0) car.speed = 0;
    car.s += car.speed * dt;
    while (car.s >= car.seg.len) {
      const next = car.nextSeg;
      if (!next) { car.s = car.seg.len; car.speed = 0; break; }
      car.s -= car.seg.len;
      car.seg.cars.delete(car);
      if (car.seg.kind === 'conn') car.seg.inter.busy.delete(car);
      car.seg = next;
      next.cars.add(car);
      if (next.kind === 'conn') next.inter.busy.add(car);
      this.pickNext(car);
    }
    this.placeOnSeg(car);
    car.steer = car.seg.kind === 'conn' && car.seg.turn !== 'straight' ? (car.seg.turn === 'left' ? 0.6 : -0.6) : 0;
  }

  playerStep(car, dt) {
    const g = this.game;
    drive(car, g.input, dt);
    this.collideCar(car, dt);
    this.hitPeople(car);
  }

  // Oriented-box pushes against everything solid near the car.
  collideCar(car, dt) {
    const g = this.game;
    const P = g.physics;
    const c = car.object.position;
    const A = { x: c.x, z: c.z, hx: car.spec.W / 2, hz: car.spec.L / 2, c: Math.cos(car.heading), s: Math.sin(car.heading) };
    for (const b of P.near(c.x, c.z, 6, [])) {
      if (!b.solid || b.disabled || b === car.box || b.walk) continue;
      if (b.y1 < 0.35 || b.y0 > 1.4) continue;
      const mtv = obbOverlap(A, b);
      if (!mtv) continue;
      c.x += mtv[0]; c.z += mtv[1];
      A.x = c.x; A.z = c.z;
      const n = new THREE.Vector2(mtv[0], mtv[1]).normalize();
      const f = car.forward();
      const into = -(f.x * n.x + f.z * n.y);
      const impact = Math.abs(car.speed) * Math.max(0, into * Math.sign(car.speed || 1));
      if (impact > 0.5) {
        car.speed *= into > 0.7 ? -0.25 : 0.6;
        if (impact > 6 && (!this._bumpT || g.time - this._bumpT > 0.5)) { this._bumpT = g.time; g.audio?.blip(90, 0.25, 0.4); g.follow.shake = Math.min(1, impact / 15); }
      }
      if (b.tag === 'car' && b.ref?.mode === 'ai') { b.ref.speed = 0; if (!b.ref.honked) { b.ref.honked = true; this.honk(b.ref); } }
    }
  }

  hitPeople(car) {
    if (Math.abs(car.speed) < 2.5) return;
    const g = this.game;
    const c = car.object.position;
    const A = { x: c.x, z: c.z, hx: car.spec.W / 2 + 0.25, hz: car.spec.L / 2 + 0.25, c: Math.cos(car.heading), s: Math.sin(car.heading) };
    for (const npc of g.crowd?.npcs || []) {
      const a = npc.actor;
      if (a.state !== 'free' || a.knocked) continue;
      const p = a.object.position;
      if (Math.abs(p.x - c.x) > 4 || Math.abs(p.z - c.z) > 4) continue;
      const dx = p.x - A.x, dz = p.z - A.z;
      const lx = dx * A.c - dz * A.s, lz = dx * A.s + dz * A.c;
      if (Math.abs(lx) < A.hx && Math.abs(lz) < A.hz) npc.knockedBy?.(car);
    }
  }

  honk(car) {
    const g = this.game;
    if (!g.audio?.ctx || car.object.position.distanceTo(g.camera.position) > 40) return;
    g.audio.blip(415, 0.35, 0.18);
    g.later(0.42, () => g.audio.blip(415, 0.25, 0.18));
  }

  engineSound(car) {
    const au = this.game.audio;
    if (!au?.ctx) return;
    if (car && !this.engine) {
      const o = au.ctx.createOscillator(); o.type = 'sawtooth';
      const f = au.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const gn = au.ctx.createGain(); gn.gain.value = 0;
      o.connect(f); f.connect(gn); gn.connect(au.master); o.start();
      this.engine = { o, f, gn };
    }
    if (!this.engine) return;
    const t = au.ctx.currentTime;
    const sp = car ? Math.abs(car.speed) : 0;
    this.engine.o.frequency.setTargetAtTime(38 + sp * 4.5 + (sp % 9) * 1.5, t, 0.1);
    this.engine.gn.gain.setTargetAtTime(car ? 0.05 + Math.min(0.06, sp * 0.004) : 0, t, 0.2);
  }

  // ------------------------------------------------------------ getting in
  nearestCar(p, maxD = 2.6) {
    let best = null, bd = maxD;
    for (const car of this.cars) {
      if (car.mode === 'player') continue;
      const d = car.doorPoint(_v).distanceTo(p.object.position);
      const dc = car.object.position.distanceTo(p.object.position);
      if (Math.min(d, dc - 1.2) < bd) { bd = Math.min(d, dc - 1.2); best = car; }
    }
    return best;
  }

  prompt(p) {
    if (p.state !== 'free') return null;
    const car = this.nearestCar(p);
    if (!car) return null;
    return { kind: 'car', car, keyLabel: 'F', label: () => (car === this.hero ? 'F: Drive your car' : car.mode === 'ai' ? 'F: Take this car' : 'F: Get in'), act: () => this.enter(p, car) };
  }

  toggleVehicle() {
    const p = this.game.player;
    if (!p) return;
    if (p.vehicle) this.exit(p);
    else { const car = this.nearestCar(p); if (car) this.enter(p, car); }
  }

  enter(p, car) {
    if (p.state !== 'free' || p.busy) return;
    const door = car.doorPoint(new THREE.Vector3());
    door.y = p.object.position.y;
    const wasAI = car.mode === 'ai';
    if (wasAI) { car.stolenSpeed = car.speed; car.speed = 0; car.mode = 'held'; }
    approach(p, door, car.heading + Math.PI / 2 * 0 + 0, () => {
      if (wasAI) {
        car.seg?.cars.delete(car);
        if (car.seg?.kind === 'conn') car.seg.inter.busy.delete(car);
        car.seg = null;
        this.ejectDriver(car);
      }
      car.mode = 'player';
      car.showDriver = false;
      car.speed = 0; car.lateral = 0;
      p.state = 'driving';
      p.vehicle = car;
      car.driver = p;
      p.velocity.set(0, 0, 0);
      p.playFull('drive', { opts: { h: 0.32 }, instant: true });
      car.box.disabled = false;
      this.game.follow.distTarget = Math.max(this.game.follow.distTarget, 6.5);
      this.game.audio?.blip(200, 0.12, 0.2);
    }, { speed: 2.4 });
  }

  // Whoever was driving climbs out and has something to say about it.
  ejectDriver(car) {
    const g = this.game;
    if (!g.crowd) return;
    const npc = g.crowd.add(g.crowd.randomModel(), 'walker');
    const door = car.doorPoint(new THREE.Vector3());
    const f = car.forward();
    npc.actor.place(door.x + f.z * 0.6, CURB_H * 0 + 0.02, door.z - f.x * 0.6, car.heading + Math.PI / 2);
    npc.actor.lookAt(g.player);
    g.speech.say(npc.actor, ['Hey! That is my car!', 'Are you kidding me?', 'Somebody call the cops!'][Math.floor(Math.random() * 3)], { priority: 2 });
    npc.state = 'react'; npc.timer = 2.5; npc.resume = 'idle';
    npc.faceTo = Math.atan2(g.player.object.position.x - door.x, g.player.object.position.z - door.z);
  }

  exit(p) {
    const car = p.vehicle;
    if (!car) return;
    if (Math.abs(car.speed) > 3) { car.speed *= 0.5; return; }
    car.speed = 0;
    // Driver's side, or the passenger side if the driver's is blocked.
    let out = car.doorPoint(new THREE.Vector3());
    const blocked = (q) => this.game.physics.near(q.x, q.z, 1, []).some((b) => b.solid && !b.disabled && b !== car.box && b.y1 > 0.5 && this.game.physics.local(b, q.x, q.z).every((v, i) => Math.abs(v) < (i ? b.hz : b.hx) + 0.3));
    if (blocked(out)) {
      const f = car.forward();
      out = car.object.position.clone().addScaledVector(new THREE.Vector3(-f.z, 0, f.x), car.spec.W / 2 + 0.55);
    }
    p.vehicle = null;
    car.driver = null;
    car.mode = 'parked';
    car.wasDriven = true;
    p.state = 'free';
    p.stopFull(0.2);
    p.full.forEach((e) => { e.weight = 0; });
    p.place(out.x, this.game.physics.groundAt(out.x, out.z, 2), out.z, car.heading + Math.PI / 2);
    p.grounded = true;
    this.game.audio?.blip(160, 0.12, 0.2);
  }
}

// 2D separating-axis test between the car box A {x,z,hx,hz,c,s} and a
// physics box B. Returns the push [dx,dz] to move A out, or null.
function obbOverlap(A, B) {
  const axes = [[A.c, -A.s], [A.s, A.c], [B.c, -B.s], [B.s, B.c]];
  const dx = A.x - B.x, dz = A.z - B.z;
  let best = Infinity, bn = null;
  for (const [ax, az] of axes) {
    const ra = A.hx * Math.abs(A.c * ax - A.s * az) + A.hz * Math.abs(A.s * ax + A.c * az);
    const rb = B.hx * Math.abs(B.c * ax - B.s * az) + B.hz * Math.abs(B.s * ax + B.c * az);
    const d = dx * ax + dz * az;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; bn = [ax * Math.sign(d || 1), az * Math.sign(d || 1)]; }
  }
  return [bn[0] * best, bn[1] * best];
}
