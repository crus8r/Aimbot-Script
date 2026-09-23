// Cars: built from side profiles (a lower body and a glass cabin, extruded
// with rounded edges), drawn as instances so thirty cars cost a handful of
// draw calls, and driven with a simple arcade model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Profiles are (x along the car, y up), x=0 at the car's centre, front +x.
// Wheel centres and radius let the outline cut wheel arches. seat is the
// driver's seat: [offset along the car, seat-surface height above ground].
export const VARIANTS = {
  sedan: { L: 4.6, W: 1.82, wheelbase: 2.75, r: 0.34, body: [[-2.3, 0.28], [-2.36, 0.55], [-2.25, 0.86], [-1.55, 0.95], [0.95, 0.98], [2.22, 0.82], [2.36, 0.58], [2.3, 0.28]], cabin: [[-1.6, 0.94], [-1.12, 1.4], [0.18, 1.42], [0.92, 0.97]], seat: [-0.25, 0.55] },
  hatch: { L: 4.1, W: 1.76, wheelbase: 2.5, r: 0.32, body: [[-2.02, 0.28], [-2.08, 0.6], [-2.0, 0.92], [0.8, 0.98], [1.95, 0.8], [2.08, 0.56], [2.02, 0.28]], cabin: [[-2.0, 0.92], [-1.8, 1.44], [0.05, 1.46], [0.82, 0.97]], seat: [-0.35, 0.55] },
  suv: { L: 4.8, W: 1.95, wheelbase: 2.85, r: 0.4, body: [[-2.38, 0.36], [-2.42, 0.72], [-2.35, 1.08], [1.0, 1.12], [2.3, 0.98], [2.44, 0.7], [2.38, 0.36]], cabin: [[-2.34, 1.07], [-2.2, 1.76], [0.35, 1.78], [1.05, 1.1]], seat: [-0.3, 0.78] },
  van: { L: 5.1, W: 2.0, wheelbase: 3.1, r: 0.38, body: [[-2.55, 0.34], [-2.58, 1.9], [0.6, 1.95], [1.9, 1.15], [2.52, 0.95], [2.58, 0.6], [2.55, 0.34]], cabin: [[0.45, 1.93], [0.62, 1.94], [1.86, 1.18], [1.7, 1.12]], seat: [1.05, 0.82] },
  pickup: { L: 5.2, W: 1.95, wheelbase: 3.2, r: 0.4, body: [[-2.6, 0.36], [-2.62, 1.05], [-0.5, 1.05], [-0.5, 1.08], [1.2, 1.12], [2.45, 0.98], [2.6, 0.7], [2.55, 0.36]], cabin: [[-0.5, 1.07], [-0.38, 1.78], [0.55, 1.8], [1.22, 1.1]], seat: [0.15, 0.78] },
};

const PAINT = ['#f2f2f0', '#e8e4dc', '#1c1f24', '#8a9099', '#b8bec6', '#9b1c24', '#1f4f8a', '#2a7a7a', '#f4b6c2', '#8fd3c8', '#e9c46a', '#3a5a40', '#5a3a6a', '#d9612b'];

function profileShape(pts, arches) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  // Bottom edge back to the start, cutting round the wheels.
  const y0 = pts[0][1];
  const arcs = [...arches].sort((a, b) => b[0] - a[0]);
  for (const [cx, r] of arcs) {
    s.lineTo(cx + r + 0.06, y0);
    s.absarc(cx, y0 - 0.02, r + 0.06, 0, Math.PI, false);
  }
  s.lineTo(pts[0][0], y0);
  return s;
}

function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  // Extrude runs along +z; the car's length is x. Turn so the front is +z.
  g.rotateY(-Math.PI / 2);
  return g;
}

// Geometry per variant: body, cabin glass, lights, wheel (one), and a dark
// driver shape so traffic isn't driven by ghosts.
export function buildVariant(name) {
  const v = VARIANTS[name];
  const hw = v.wheelbase / 2;
  const arches = [[hw, v.r], [-hw, v.r]];
  const body = extrude(profileShape(v.body, arches), v.W, 0.07);
  const cab = new THREE.Shape();
  cab.moveTo(v.cabin[0][0], v.cabin[0][1]);
  for (let i = 1; i < v.cabin.length; i++) cab.lineTo(v.cabin[i][0], v.cabin[i][1]);
  cab.closePath();
  const glass = extrude(cab, v.W - 0.2, 0.05);
  // Roof panel over the glass so it reads as painted metal, not a bubble.
  const roofPts = v.cabin.slice(1, 3);
  const roof = new THREE.BoxGeometry(v.W - 0.26, 0.05, Math.abs(roofPts[1][0] - roofPts[0][0]) + 0.1);
  roof.translate(0, Math.max(roofPts[0][1], roofPts[1][1]) + 0.02, (roofPts[0][0] + roofPts[1][0]) / 2);
  const paint = mergeGeometries([body, roof].map((g) => g.index ? g.toNonIndexed() : g).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
  const frontX = Math.max(...v.body.map((p) => p[0])), backX = Math.min(...v.body.map((p) => p[0]));
  const lightY = v.body.find((p) => p[0] === frontX)[1] + 0.12;
  const head = [], tail = [];
  for (const s of [-1, 1]) {
    const h = new THREE.BoxGeometry(0.34, 0.12, 0.06); h.translate(s * (v.W / 2 - 0.3), lightY, frontX + 0.01); head.push(h);
    const t = new THREE.BoxGeometry(0.34, 0.12, 0.06); t.translate(s * (v.W / 2 - 0.28), lightY + 0.1, backX - 0.01); tail.push(t);
  }
  const wheel = new THREE.CylinderGeometry(v.r, v.r, 0.24, 18);
  wheel.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(v.r * 0.62, v.r * 0.62, 0.25, 12);
  rim.rotateZ(Math.PI / 2);
  const driver = new THREE.CapsuleGeometry(0.2, 0.35, 4, 8);
  // Left-hand drive: the driver sits on the car's left (+X).
  driver.translate(v.W / 4 - 0.08, v.seat[1] + 0.35, v.seat[0] - 0.1);
  const dh = new THREE.SphereGeometry(0.12, 8, 6); dh.translate(v.W / 4 - 0.08, v.seat[1] + 0.8, v.seat[0] - 0.05);
  const wheels = [[hw, 1], [hw, -1], [-hw, 1], [-hw, -1]].map(([z, s]) => new THREE.Vector3(s * (v.W / 2 - 0.16), v.r, z));
  return {
    paint, glass, head: mergeGeometries(head), tail: mergeGeometries(tail), wheel, rim,
    driver: mergeGeometries([driver.toNonIndexed(), dh.toNonIndexed()].map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })),
    wheels, spec: v,
  };
}

// All cars of all variants, as instanced meshes with a slot per car.
export class CarRenderer {
  constructor(scene, capacity = 24) {
    this.scene = scene;
    this.capacity = capacity;
    this.kinds = {};
    const paint = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshStandardMaterial({ color: '#1a2630', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.78, depthWrite: true });
    const rubber = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.9 });
    const alloy = new THREE.MeshStandardMaterial({ color: '#c8ccd0', roughness: 0.3, metalness: 0.9 });
    this.headMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff4d0', emissiveIntensity: 0.3, roughness: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#5a0a0a', emissive: '#ff1a1a', emissiveIntensity: 0.4, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.9 });
    for (const name of Object.keys(VARIANTS)) {
      const g = buildVariant(name);
      const mk = (geo, mat, n = capacity, shadow = true) => {
        const m = new THREE.InstancedMesh(geo, mat, n);
        m.count = 0;
        m.castShadow = shadow; m.receiveShadow = true;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
        return m;
      };
      this.kinds[name] = {
        g,
        paint: mk(g.paint, paint), glass: mk(g.glass, glass, capacity, false), head: mk(g.head, this.headMat, capacity, false), tail: mk(g.tail, this.tailMat, capacity, false),
        driver: mk(g.driver, dark, capacity, false),
        wheel: mk(g.wheel, rubber, capacity * 4), rim: mk(g.rim, alloy, capacity * 4, false),
        used: 0,
      };
    }
    this._m = new THREE.Matrix4();
    this._w = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  alloc(kind, color) {
    const k = this.kinds[kind];
    const slot = k.used++;
    for (const part of ['paint', 'glass', 'head', 'tail', 'driver']) k[part].count = k.used;
    k.wheel.count = k.used * 4; k.rim.count = k.used * 4;
    k.paint.setColorAt(slot, new THREE.Color(color || PAINT[Math.floor(Math.random() * PAINT.length)]));
    k.paint.instanceColor.needsUpdate = true;
    return { kind, slot };
  }

  // Write one car's transforms: body, glass, lights, driver, four wheels.
  write(car) {
    if (car.slot === undefined) return;
    const k = this.kinds[car.kind];
    const m = this._m.compose(car.object.position, car.object.quaternion, new THREE.Vector3(1, 1, 1));
    for (const part of ['paint', 'glass', 'head', 'tail']) k[part].setMatrixAt(car.slot, m);
    k.driver.setMatrixAt(car.slot, car.showDriver ? m : new THREE.Matrix4().makeScale(0, 0, 0));
    car.wheelSpin = (car.wheelSpin || 0) + 0;
    k.g.wheels.forEach((w, i) => {
      const steer = i < 2 ? car.steer * 0.55 : 0;
      this._e.set(car.wheelSpin, steer, 0, 'YXZ');
      this._q.setFromEuler(this._e);
      this._w.compose(w, this._q, new THREE.Vector3(1, 1, 1));
      this._w.premultiply(m);
      k.wheel.setMatrixAt(car.slot * 4 + i, this._w);
      k.rim.setMatrixAt(car.slot * 4 + i, this._w);
    });
    for (const part of ['paint', 'glass', 'head', 'tail', 'driver', 'wheel', 'rim']) k[part].instanceMatrix.needsUpdate = true;
  }

  setNight(n) {
    this.headMat.emissiveIntensity = 0.3 + n * 3;
    this.tailMat.emissiveIntensity = 0.4 + n * 1.6;
  }
}

// One car. Kinematic when on a lane (AI), dynamic when driven.
export class Car {
  constructor(renderer, kind, color, { noSlot = false } = {}) {
    this.renderer = renderer;
    this.kind = kind;
    // Model-backed cars (the Ferrari) draw themselves and take no slot.
    this.slot = noSlot ? undefined : renderer.alloc(kind, color).slot;
    this.spec = VARIANTS[kind];
    this.object = new THREE.Object3D();
    this.heading = 0;
    this.speed = 0;               // signed, along heading
    this.lateral = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.showDriver = true;
    this.mode = 'parked';         // parked | ai | player
    this.box = null;
  }

  place(x, y, z, heading) {
    this.object.position.set(x, y, z);
    this.heading = heading;
    this.object.rotation.set(0, heading, 0);
    this.object.updateMatrix();
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  sync(dt) {
    this.object.rotation.set(0, this.heading, 0);
    this.wheelSpin += (this.speed * dt) / this.spec.r;
    this.renderer.write(this);
  }

  // Driver's door, outside the car on its left (+X local is the car's left).
  doorPoint(out = new THREE.Vector3()) {
    const f = this.forward();
    const left = new THREE.Vector3(f.z, 0, -f.x);
    return out.copy(this.object.position).addScaledVector(left, this.spec.W / 2 + 0.55).addScaledVector(f, this.spec.seat[0]);
  }

  // The driver's root: on the car floor under the pelvis, for the drive
  // pose (authored with a 32cm seat above its root).
  seatPoint(out = new THREE.Vector3()) {
    const f = this.forward();
    const left = new THREE.Vector3(f.z, 0, -f.x);
    return out.copy(this.object.position).addScaledVector(left, this.spec.W / 4 - 0.08).addScaledVector(f, this.spec.seat[0] - 0.15).setY(this.object.position.y + this.spec.seat[1] - 0.32);
  }
}

// Arcade handling for the player's car.
export function drive(car, input, dt) {
  const up = input.down('KeyW', 'ArrowUp'), down = input.down('KeyS', 'ArrowDown');
  const left = input.down('KeyA'), right = input.down('KeyD');
  const hand = input.down('Space');
  const s = car.speed;
  let acc = 0;
  if (up) acc = s < 0 ? 14 : 7.5 * (1 - Math.max(0, s) / 34);
  if (down) acc = s > 0.5 ? -13 : -5 * (1 + Math.min(0, s) / 7);
  if (!up && !down) acc = -Math.sign(s) * Math.min(Math.abs(s) / dt, 2.2);
  if (hand) acc -= Math.sign(s) * Math.min(Math.abs(s) / dt, 9);
  car.speed += acc * dt;
  if (Math.abs(car.speed) < 0.05 && !up && !down) car.speed = 0;
  // Steering: full lock at walking pace, less at speed.
  const want = (left ? 1 : 0) - (right ? 1 : 0);
  car.steer += (want - car.steer) * Math.min(1, dt * 5);
  const lock = 0.6 / (1 + Math.abs(car.speed) / 14);
  const yawRate = (car.speed / car.spec.wheelbase) * Math.tan(car.steer * lock);
  car.heading += yawRate * dt;
  // Slide: some of the turn becomes sideways drift, more with the handbrake.
  const grip = hand ? 1.4 : 7;
  car.lateral += (-yawRate * Math.abs(car.speed) * 0.035 - car.lateral) * Math.min(1, dt * grip);
  const f = car.forward();
  const l = new THREE.Vector3(f.z, 0, -f.x);
  car.object.position.addScaledVector(f, car.speed * dt).addScaledVector(l, car.lateral * dt);
}
