/**
 * Procedural humanoid generation.
 *
 * Bodies are lofted from parametric cross-section rings and skinned to a
 * generated skeleton, so joints deform smoothly instead of reading as a
 * segmented toy. Heads are a deformable parametric skull plus separate
 * feature meshes (nose, lips, brows, ears, eyes) — sculpting a nose out of a
 * sphere never looks as good as modelling one and placing it.
 *
 * Nothing here is hand-authored art: every character is a seeded parameter
 * set, which is what makes an unlimited cast affordable.
 */

import * as THREE from 'three';
import {
  skinMaterial, clothMaterial, hairMaterial, eyeWhiteMaterial,
  irisMaterial, darkMaterial, fabricMaterial,
} from './materials.js';

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/** [name, parent, world rest position] — bind pose is a relaxed A-pose. */
const BONE_TABLE = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.950, 0]],
  ['spine', 'hips', [0, 1.100, 0.005]],
  ['chest', 'spine', [0, 1.280, 0.005]],
  ['neck', 'chest', [0, 1.475, -0.008]],
  ['head', 'neck', [0, 1.565, 0]],
  ['jaw', 'head', [0, 1.622, -0.028]],

  ['clavL', 'chest', [0.045, 1.415, 0]],
  ['upperArmL', 'clavL', [0.175, 1.395, 0]],
  ['foreArmL', 'upperArmL', [0.232, 1.128, 0]],
  ['handL', 'foreArmL', [0.272, 0.885, 0]],
  ['handEndL', 'handL', [0.290, 0.782, 0.005]],

  ['clavR', 'chest', [-0.045, 1.415, 0]],
  ['upperArmR', 'clavR', [-0.175, 1.395, 0]],
  ['foreArmR', 'upperArmR', [-0.232, 1.128, 0]],
  ['handR', 'foreArmR', [-0.272, 0.885, 0]],
  ['handEndR', 'handR', [-0.290, 0.782, 0.005]],

  ['thighL', 'hips', [0.095, 0.905, 0]],
  ['shinL', 'thighL', [0.103, 0.515, 0.005]],
  ['footL', 'shinL', [0.105, 0.085, -0.012]],
  ['toeL', 'footL', [0.105, 0.032, 0.112]],

  ['thighR', 'hips', [-0.095, 0.905, 0]],
  ['shinR', 'thighR', [-0.103, 0.515, 0.005]],
  ['footR', 'shinR', [-0.105, 0.085, -0.012]],
  ['toeR', 'footR', [-0.105, 0.032, 0.112]],
];

const BONE_INDEX = new Map(BONE_TABLE.map(([name], i) => [name, i]));

/** Bone segments used for skin weighting: bone position -> mean child position. */
function buildBoneSegments() {
  const pos = new Map(BONE_TABLE.map(([name, , p]) => [name, new THREE.Vector3(...p)]));
  const children = new Map(BONE_TABLE.map(([name]) => [name, []]));
  for (const [name, parent] of BONE_TABLE) if (parent) children.get(parent).push(name);

  const segments = new Map();
  for (const [name, , p] of BONE_TABLE) {
    const a = new THREE.Vector3(...p);
    const kids = children.get(name);
    let b;
    if (kids.length) {
      b = new THREE.Vector3();
      kids.forEach((k) => b.add(pos.get(k)));
      b.multiplyScalar(1 / kids.length);
    } else {
      b = a.clone().add(new THREE.Vector3(0, -0.05, 0));
    }
    segments.set(name, { a, b });
  }
  return segments;
}

const BONE_SEGMENTS = buildBoneSegments();

const _sv = new THREE.Vector3();
const _sw = new THREE.Vector3();

function distanceToSegment(p, a, b) {
  _sv.subVectors(b, a);
  const lenSq = _sv.lengthSq();
  if (lenSq < 1e-9) return p.distanceTo(a);
  const t = THREE.MathUtils.clamp(_sw.subVectors(p, a).dot(_sv) / lenSq, 0, 1);
  return p.distanceTo(_sw.copy(a).addScaledVector(_sv, t));
}

// ---------------------------------------------------------------------------
// Geometry accumulator
// ---------------------------------------------------------------------------

/**
 * Collects positions/normals/uvs/skin data across many primitives so a whole
 * body lands in one draw call.
 */
class MeshBuilder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
    this.skinIndex = [];
    this.skinWeight = [];
  }

  get vertexCount() { return this.pos.length / 3; }

  /** Push a vertex, resolving skin weights against the allowed bone set. */
  vertex(p, u, v, allowed) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    const scored = allowed.map((name) => {
      const seg = BONE_SEGMENTS.get(name);
      const d = distanceToSegment(p, seg.a, seg.b);
      return { i: BONE_INDEX.get(name), w: 1 / Math.pow(d + 0.010, 4.0) };
    });
    scored.sort((x, y) => y.w - x.w);
    const top = scored.slice(0, 4);
    let sum = 0;
    top.forEach((t) => { sum += t.w; });
    for (let i = 0; i < 4; i++) {
      this.skinIndex.push(top[i] ? top[i].i : 0);
      this.skinWeight.push(top[i] ? top[i].w / sum : 0);
    }
    return this.vertexCount - 1;
  }

  /** Push a vertex bound rigidly to a single bone (heads, props on bodies). */
  rigidVertex(p, u, v, boneName, blend) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    if (blend) {
      const total = blend.reduce((s, b) => s + b.w, 0) || 1;
      for (let i = 0; i < 4; i++) {
        const b = blend[i];
        this.skinIndex.push(b ? BONE_INDEX.get(b.bone) : 0);
        this.skinWeight.push(b ? b.w / total : 0);
      }
    } else {
      this.skinIndex.push(BONE_INDEX.get(boneName), 0, 0, 0);
      this.skinWeight.push(1, 0, 0, 0);
    }
    return this.vertexCount - 1;
  }

  face(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /**
   * Stitch a sequence of equal-length vertex rings into a tube surface.
   * @param {number[][]} rings arrays of vertex indices
   */
  stitch(rings, closed = true) {
    for (let r = 0; r < rings.length - 1; r++) {
      const lo = rings[r];
      const hi = rings[r + 1];
      const n = lo.length;
      const limit = closed ? n : n - 1;
      for (let i = 0; i < limit; i++) {
        const j = (i + 1) % n;
        this.quad(lo[i], lo[j], hi[j], hi[i]);
      }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Body construction
// ---------------------------------------------------------------------------

const BODY_SEGMENTS = 18;

/** Superelliptical cross-section; e<1 fills the corners out toward a ribcage. */
function ringPoint(ring, i, segments) {
  const a = (i / segments) * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = ring.e ?? 0.88;
  const x = ring.rx * Math.sign(c) * Math.pow(Math.abs(c), e);
  let z = ring.rz * Math.sign(s) * Math.pow(Math.abs(s), e);
  if (z < 0) z *= ring.backFlat ?? 0.94;
  return new THREE.Vector3((ring.x ?? 0) + x, ring.y, (ring.z ?? 0) + z);
}

/** Torso profile, modulated by build parameters. */
function torsoRings(p) {
  const { shoulder, waist, hip, chest, bust } = p;
  return [
    { y: 0.845, rx: 0.126 * hip, rz: 0.094 * chest, e: 0.92 },
    { y: 0.905, rx: 0.146 * hip, rz: 0.106 * chest, e: 0.90 },
    { y: 0.975, rx: 0.138 * hip, rz: 0.100 * chest, e: 0.88 },
    { y: 1.045, rx: 0.119 * waist, rz: 0.090 * chest, e: 0.86 },
    { y: 1.115, rx: 0.128 * waist, rz: 0.097 * chest, e: 0.86 },
    { y: 1.190, rx: 0.147, rz: 0.106 * chest * bust, e: 0.88, z: 0.004 * (bust - 1) },
    { y: 1.265, rx: 0.159 * shoulder, rz: 0.110 * chest * bust, e: 0.90, z: 0.006 * (bust - 1) },
    { y: 1.340, rx: 0.168 * shoulder, rz: 0.112 * chest, e: 0.92 },
    { y: 1.400, rx: 0.163 * shoulder, rz: 0.106 * chest, e: 0.94 },
    { y: 1.445, rx: 0.112 * shoulder, rz: 0.088, e: 0.96 },
    { y: 1.482, rx: 0.0545, rz: 0.053, e: 1.0 }, // neck: narrower than the jaw
    { y: 1.528, rx: 0.049, rz: 0.048, e: 1.0 },
    { y: 1.556, rx: 0.044, rz: 0.043, e: 1.0 }, // tucks up inside the skull
  ];
}

const TORSO_BONES = ['hips', 'spine', 'chest', 'neck', 'clavL', 'clavR'];

function addTorso(mb, p) {
  const rings = torsoRings(p);
  const built = rings.map((ring, r) => {
    const ids = [];
    for (let i = 0; i < BODY_SEGMENTS; i++) {
      ids.push(mb.vertex(ringPoint(ring, i, BODY_SEGMENTS), i / BODY_SEGMENTS, r / rings.length, TORSO_BONES));
    }
    return ids;
  });
  mb.stitch(built);

  // Cap the pelvis so the crotch isn't an open hole between the leg tubes.
  const bottom = rings[0];
  const centre = mb.vertex(new THREE.Vector3(0, bottom.y - 0.03, 0), 0.5, 0, TORSO_BONES);
  for (let i = 0; i < BODY_SEGMENTS; i++) {
    const j = (i + 1) % BODY_SEGMENTS;
    mb.face(built[0][j], built[0][i], centre);
  }
}

/**
 * Sweep a tube along a polyline with per-sample radii.
 * @param {THREE.Vector3[]} path
 * @param {number[]} radii matching `path`
 */
function addTube(mb, path, radii, allowed, opts = {}) {
  const segments = opts.segments ?? 14;
  const squash = opts.squash ?? 1;
  const rings = [];
  for (let s = 0; s < path.length; s++) {
    const p = path[s];
    const dir = new THREE.Vector3()
      .subVectors(path[Math.min(s + 1, path.length - 1)], path[Math.max(s - 1, 0)])
      .normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0);
    const ref = Math.abs(dir.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(dir, ref).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();

    const ids = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const v = p.clone()
        .addScaledVector(right, Math.cos(a) * radii[s])
        .addScaledVector(up, Math.sin(a) * radii[s] * squash);
      ids.push(mb.vertex(v, i / segments, s / path.length, allowed));
    }
    rings.push(ids);
  }
  mb.stitch(rings);
  return rings;
}

function capRing(mb, ring, centre, allowed, flip = false) {
  const c = mb.vertex(centre, 0.5, 0.5, allowed);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (flip) mb.face(ring[i], ring[j], c);
    else mb.face(ring[j], ring[i], c);
  }
}

function lerpV(a, b, t) { return a.clone().lerp(b, t); }

/** Sample a bone chain into a smooth polyline. */
function chain(names, samplesPerSegment = 3) {
  const pts = names.map((n) => BONE_SEGMENTS.get(n).a.clone());
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let s = 0; s < samplesPerSegment; s++) {
      out.push(lerpV(pts[i], pts[i + 1], s / samplesPerSegment));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function addArm(mb, side, p) {
  const S = side === 'L' ? 1 : -1;
  const path = chain([`clav${side}`, `upperArm${side}`, `foreArm${side}`, `hand${side}`], 3);
  const thick = p.limb;
  const radii = [
    0.052 * thick, 0.056 * thick, 0.053 * thick,
    0.049 * thick, 0.046 * thick, 0.043 * thick,
    0.040 * thick, 0.036 * thick, 0.032 * thick,
    0.029 * thick,
  ];
  const allowed = [`clav${side}`, `upperArm${side}`, `foreArm${side}`, `hand${side}`, 'chest'];
  const rings = addTube(mb, path, radii.slice(0, path.length), allowed, { segments: 12 });

  // Shoulder cap blends the deltoid into the torso.
  const shoulderTop = BONE_SEGMENTS.get(`upperArm${side}`).a.clone().add(new THREE.Vector3(-0.01 * S, 0.03, 0));
  capRing(mb, rings[0], shoulderTop, allowed, side === 'R');

  // Hand: a flattened paddle with a thumb nub. Reads correctly from a medium
  // shot inward, which is as close as hands ever get in this system.
  const wrist = BONE_SEGMENTS.get(`hand${side}`).a.clone();
  const tip = BONE_SEGMENTS.get(`handEnd${side}`).a.clone();
  const handPath = [wrist, lerpV(wrist, tip, 0.45), lerpV(wrist, tip, 0.8), tip];
  const handRadii = [0.030 * thick, 0.038 * thick, 0.036 * thick, 0.022 * thick];
  const handRings = addTube(mb, handPath, handRadii, [`hand${side}`, `foreArm${side}`], { segments: 10, squash: 0.48 });
  capRing(mb, handRings[handRings.length - 1], tip, [`hand${side}`], side === 'R');
}

function addLeg(mb, side, p) {
  const path = chain([`thigh${side}`, `shin${side}`, `foot${side}`], 3);
  const thick = p.limb;
  const radii = [
    0.092 * thick, 0.086 * thick, 0.078 * thick,
    0.070 * thick, 0.064 * thick, 0.058 * thick,
    0.048 * thick, 0.040 * thick, 0.036 * thick,
    0.034 * thick,
  ];
  const allowed = ['hips', `thigh${side}`, `shin${side}`, `foot${side}`];
  addTube(mb, path, radii.slice(0, path.length), allowed, { segments: 12 });
}

/** Shoes rather than bare feet: cheaper, and they read better at any distance. */
function addShoe(mb, side) {
  const ankle = BONE_SEGMENTS.get(`foot${side}`).a.clone();
  const toe = BONE_SEGMENTS.get(`toe${side}`).a.clone().add(new THREE.Vector3(0, -0.005, 0.045));
  const path = [
    ankle.clone().add(new THREE.Vector3(0, 0.03, -0.045)),
    ankle.clone().add(new THREE.Vector3(0, 0.005, -0.02)),
    lerpV(ankle, toe, 0.45).setY(0.030),
    lerpV(ankle, toe, 0.8).setY(0.028),
    toe.clone().setY(0.026),
  ];
  const radii = [0.040, 0.048, 0.052, 0.048, 0.030];
  const allowed = [`foot${side}`, `toe${side}`];
  const rings = addTube(mb, path, radii, allowed, { segments: 10, squash: 0.62 });
  capRing(mb, rings[0], path[0].clone().add(new THREE.Vector3(0, 0.01, -0.01)), allowed, side === 'R');
  capRing(mb, rings[rings.length - 1], toe.clone().setY(0.026), allowed, side !== 'R');
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

// A multiple of 4 puts a vertex column exactly on the face midline (u=0.25),
// so nose/philtrum shading is symmetric instead of creased between two
// columns. 32x24 keeps rows ~12mm apart through the mouth band, which limits
// how tall the stretched skin cell at the jaw split can get when it opens.
const HEAD_U = 32;
const HEAD_V = 24;

/** Localised displacements that turn an ellipsoid into a skull. */
function skullPokes(f) {
  return [
    // brow ridge
    { c: new THREE.Vector3(0.030, 0.024, 0.070), r: 0.042, amt: 0.0075 * f.brow, dir: new THREE.Vector3(0, 0, 1) },
    { c: new THREE.Vector3(-0.030, 0.024, 0.070), r: 0.042, amt: 0.0075 * f.brow, dir: new THREE.Vector3(0, 0, 1) },
    // eye sockets — shallow: the eyeballs sit proud now, deep sockets ate them
    { c: new THREE.Vector3(0.031, 0.006, 0.076), r: 0.028, amt: -0.007, dir: new THREE.Vector3(0, 0, 1) },
    { c: new THREE.Vector3(-0.031, 0.006, 0.076), r: 0.028, amt: -0.007, dir: new THREE.Vector3(0, 0, 1) },
    // cheekbones
    { c: new THREE.Vector3(0.056, -0.016, 0.050), r: 0.038, amt: 0.0055 * f.cheek, dir: null },
    { c: new THREE.Vector3(-0.056, -0.016, 0.050), r: 0.038, amt: 0.0055 * f.cheek, dir: null },
    // temples
    { c: new THREE.Vector3(0.070, 0.042, 0.038), r: 0.036, amt: -0.005, dir: null },
    { c: new THREE.Vector3(-0.070, 0.042, 0.038), r: 0.036, amt: -0.005, dir: null },
    // chin ball — broad and subtle; a small strong poke read as a pointed chin
    { c: new THREE.Vector3(0, -0.090, 0.046), r: 0.042, amt: 0.0085 * f.chin, dir: new THREE.Vector3(0, -0.2, 1).normalize() },
    // philtrum hollow between nose base and upper lip
    { c: new THREE.Vector3(0, -0.048, 0.064), r: 0.013, amt: -0.0028, dir: new THREE.Vector3(0, 0, 1) },
    // mouth pocket: recess the lip bands sit proud of. Kept small and shallow
    // enough that the lip bands fully cover its rim — a deep wide pocket left
    // a shadowed crease peeking out under the lower lip.
    { c: new THREE.Vector3(0, -0.066, 0.052), r: 0.018, amt: -0.009, dir: new THREE.Vector3(0, 0, 1) },
    // occiput
    { c: new THREE.Vector3(0, 0.020, -0.088), r: 0.060, amt: 0.008, dir: new THREE.Vector3(0, 0, -1) },
  ];
}

/**
 * Parametric skull surface in head-bone local space.
 * @returns {THREE.Vector3}
 */
function skullPoint(u, v, f, inflate = 0) {
  const theta = u * Math.PI * 2;
  const phi = v * Math.PI;
  const n = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );

  const r = 0.093 + inflate;
  const p = new THREE.Vector3(n.x * r * 0.86 * f.width, n.y * r * 1.01, n.z * r * 0.95);

  // Longer lower face: on a pure ellipsoid the chin crowds the mouth and the
  // cranium dominates, which is most of what read as "bulbous".
  if (p.y < 0) p.y *= 1.10;

  // Jaw taper: narrow and pull back below the cheekbones.
  if (p.y < 0) {
    const t = THREE.MathUtils.clamp(-p.y / 0.108, 0, 1);
    const k = 1 - 0.34 * Math.pow(t, 1.35) * f.jaw;
    p.x *= k;
    p.z *= p.z > 0 ? 1 - 0.14 * Math.pow(t, 1.6) : k;
  }
  // Slight forehead recline. The z/0.045 ramp fades the shift out near the
  // z=0 plane: applied as a hard step it tore a visible crack across the
  // crown (and the hair cap, which samples this same surface).
  if (p.y > 0.03 && p.z > 0) p.z -= (p.y - 0.03) * 0.22 * Math.min(1, p.z / 0.045);

  for (const poke of skullPokes(f)) {
    const d = p.distanceTo(poke.c);
    if (d > poke.r) continue;
    const w = Math.pow(Math.cos((d / poke.r) * Math.PI * 0.5), 2);
    const dir = poke.dir || p.clone().normalize();
    p.addScaledVector(dir, poke.amt * w);
  }

  p.y += 0.062;
  p.z -= 0.004;
  return p;
}

/**
 * Weight blend that lets the lower face hinge on the jaw bone. The band is
 * anchored just below the lip seam (final-frame y ≈ -0.006): everything from
 * the upper lip up stays on the head, the chin swings fully with the jaw.
 */
function jawBlend(p) {
  const yLocal = p.y - 0.062;
  // Sharp split right at the lip seam so an opening jaw parts the mouth
  // instead of stretching a skin membrane across it; wider (softer) band out
  // on the cheeks so the jawline shears smoothly.
  const band = 0.008 + Math.min(1, Math.abs(p.x) / 0.05) * 0.018;
  const w = THREE.MathUtils.clamp((-0.066 - yLocal) / band, 0, 1);
  const front = THREE.MathUtils.clamp((p.z + 0.02) / 0.05, 0, 1);
  const jaw = w * front * 0.95;
  return jaw < 0.02
    ? [{ bone: 'head', w: 1 }]
    : [{ bone: 'jaw', w: jaw }, { bone: 'head', w: 1 - jaw }];
}

/**
 * Head geometry is authored in head-bone-local space (skull centre sits at
 * y = +0.062) and shifted into bind space on write, so the skinning transform
 * `boneWorld * boneInverse * v` lands it correctly.
 */
const HEAD_ORIGIN = new THREE.Vector3(0, 1.565, 0);

function headVertex(mb, local, u, v) {
  return mb.rigidVertex(local.clone().add(HEAD_ORIGIN), u, v, null, jawBlend(local));
}

/** Head vertex with an explicit bone blend — used where the automatic jaw
 * band would smear across a feature that must split cleanly (the lips). */
function headVertexBlend(mb, local, u, v, blend) {
  return mb.rigidVertex(local.clone().add(HEAD_ORIGIN), u, v, null, blend);
}

function addHead(mb, f) {
  const grid = [];
  for (let vi = 0; vi <= HEAD_V; vi++) {
    const row = [];
    if (vi === 0) {
      // Weld the crown to one vertex: per-column pole duplicates average to
      // inconsistent normals and render as a dark pinch on the scalp.
      const id = headVertex(mb, skullPoint(0, 0, f), 0.5, 0);
      for (let ui = 0; ui < HEAD_U; ui++) row.push(id);
    } else {
      for (let ui = 0; ui < HEAD_U; ui++) {
        const p = skullPoint(ui / HEAD_U, vi / HEAD_V, f);
        row.push(headVertex(mb, p, ui / HEAD_U, vi / HEAD_V));
      }
    }
    grid.push(row);
  }
  mb.stitch(grid);
  return grid;
}

/**
 * Nose as its own lofted wedge — far more controllable than poking a sphere.
 * The final ring collapses to a point so no end cap (and no winding risk).
 */
function addNose(mb, f) {
  const bridgeY = 0.066;
  const tipY = 0.024; // nose root at eye level, tip ~40% of eye-to-chin
  const steps = 7;
  const seg = 8;
  const rings = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const closing = s === steps ? 0.22 : 1; // round the tip off, not to a point
    const y = THREE.MathUtils.lerp(bridgeY, tipY, t);
    const width = THREE.MathUtils.lerp(0.0095, 0.0155 * f.nose, Math.pow(t, 1.5)) * closing;
    const depth = THREE.MathUtils.lerp(0.005, 0.016 * f.nose, Math.pow(t, 1.2));
    const baseZ = 0.073 - t * 0.005;
    const ids = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const p = new THREE.Vector3(
        Math.cos(a) * width,
        y - Math.abs(Math.sin(a)) * 0.0045 * closing,
        baseZ + (Math.sin(a) * 0.5 + 0.5) * depth,
      );
      ids.push(headVertex(mb, p, i / seg, t));
    }
    rings.push(ids);
  }
  mb.stitch(rings);
}

// --- Mouth -----------------------------------------------------------------
// The mouth line sits between nose tip (y 0.024) and chin bottom (y ~-0.046),
// well below the nose with a philtrum gap — the old torus loft hovered right
// under the nostrils and read as a moustache blob.
const MOUTH_SEAM_Y = -0.006;

/** Approximate face-surface depth along the mouth column (before pokes). */
function mouthBaseZ(y) { return 0.0565 + (y - MOUTH_SEAM_Y) * 0.50; }

/**
 * Closed mouth as two separate lip bands lofted over the face surface: the
 * upper band rides the head bone, the lower band rides the jaw, so
 * `bones.jaw.rotation.x` parts them cleanly. Relief is a few millimetres —
 * lips are surface detail, not a bolted-on shape.
 */
function addMouth(mb, f) {
  const W = 0.026 * f.mouth;
  const cols = 13;
  const curv = 8.6; // cheek curvature: z falls off as curv·x² across the mouth

  // rows: [y, relief, widthFactor, seal]; negative relief tucks a border row
  // under the skull surface so the band edge disappears into the skin. seal=1
  // keeps full relief at the corners: the two rows flanking the lip seam must
  // stay proud there or a dark slit of recessed skull shows at each corner.
  const upperRows = [
    [0.0135, -0.0012, 0.86],
    [0.0070, 0.0036, 0.97],
    [0.0016, 0.0052, 1.00],
    [-0.0052, 0.0020, 0.97, 1],
  ];
  const lowerRows = [
    [-0.0066, 0.0020, 0.94, 1],
    [-0.0100, 0.0056, 0.90],
    [-0.0150, 0.0042, 0.82],
    [-0.0210, -0.0012, 0.66],
  ]; // lower band rides the jaw at the same weight the chin skin does

  const loft = (rows, blend) => {
    const rings = rows.map(([y, d, wf, seal], r) => {
      const ids = [];
      for (let i = 0; i < cols; i++) {
        const t = (i / (cols - 1)) * 2 - 1;
        const x = t * W * wf;
        const fade = d > 0 && !seal ? Math.pow(Math.cos(t * Math.PI * 0.5), 0.6) : 1;
        // Side columns bury into the cheek: the bands are open sheets, and a
        // free edge hovering at skin level opened a slit that showed the dark
        // mouth cavity as a tick at each corner.
        const tuck = 0.0034 * THREE.MathUtils.smoothstep(Math.abs(t), 0.80, 1.0);
        const p = new THREE.Vector3(
          x,
          y + 0.0014 * t * t, // corners rise a touch — a flat slit reads grim
          mouthBaseZ(y) - curv * x * x + d * fade - tuck,
        );
        ids.push(headVertexBlend(mb, p, i / (cols - 1), r / rows.length, blend));
      }
      return ids;
    });
    mb.stitch(rings, false);
  };

  loft(upperRows, [{ bone: 'head', w: 1 }]);
  loft(lowerRows, [{ bone: 'jaw', w: 0.95 }, { bone: 'head', w: 0.05 }]);
}

/**
 * Hairline dark tube along the lip seam. Parented to the head bone: when the
 * jaw drops it stays with the upper lip and vanishes against the cavity.
 */
function buildMouthSeam(f) {
  const W = 0.0235 * f.mouth;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * 2 - 1;
    const x = t * W;
    // Forward offset tapers to slightly NEGATIVE at the corners so the tube
    // tips bury into the cheek: held proud, they rendered as dark corner dots
    // where the lip-band relief fades out.
    pts.push(new THREE.Vector3(
      x,
      MOUTH_SEAM_Y + 0.0014 * t * t,
      mouthBaseZ(MOUTH_SEAM_Y) - 8.6 * x * x - 0.0006 + 0.0032 * Math.cos(t * Math.PI * 0.5),
    ));
  }
  // Thin: the seam is a shadow line in the lip crease, not a drawn-on mouth.
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0008, 5),
    darkMaterial('#3a2024'),
  );
  return tube;
}

/** Ears never deform, so they ride the head bone as separate meshes. */
function buildEars(f, skin) {
  const group = new THREE.Group();
  for (const S of [1, -1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 10), skinMaterial(skin));
    ear.scale.set(0.34, 1.32, 0.86);
    ear.position.set(S * 0.072 * f.width, 0.050, -0.014);
    ear.rotation.z = S * -0.12;
    ear.rotation.y = S * 0.22;
    ear.castShadow = true;
    group.add(ear);
  }
  return group;
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

const HAIR_STYLES = ['short', 'crop', 'bob', 'long', 'ponytail', 'bun', 'curly', 'bald'];

/** Forehead hairline height (centred-frame y) per style. */
const HAIRLINE_FRONT = {
  short: 0.050, crop: 0.054, bob: 0.044, long: 0.046,
  ponytail: 0.048, bun: 0.048, curly: 0.046,
};

/**
 * Hairline height (centred-frame y) as a function of depth along the head.
 * High across the forehead, dipping to just above the ear, then sliding down
 * the back to the nape — the believable path a real hairline takes.
 */
function hairlineAt(z, front) {
  const nape = THREE.MathUtils.lerp(-0.055, 0.022, THREE.MathUtils.smoothstep(z, -0.060, -0.028));
  return THREE.MathUtils.lerp(nape, front, THREE.MathUtils.smoothstep(z, -0.024, 0.048));
}

/**
 * Hair cap: the inflated skull surface clipped to the hairline. Columns are
 * clamped to the exact crossing (found by bisection) instead of dropping
 * whole vertices, so the edge is a smooth curve, not a staircase; the shell
 * inflation also fades to nothing at the edge so the rim tucks onto the scalp.
 */
function buildHairCap(style, f, mat) {
  const front = HAIRLINE_FRONT[style];
  const crossing = [];
  for (let ui = 0; ui < HEAD_U; ui++) {
    let lo = 0; let hi = 1;
    for (let it = 0; it < 16; it++) {
      const mid = (lo + hi) / 2;
      const p = skullPoint(ui / HEAD_U, mid, f, 0.0075);
      if ((p.y - 0.062) - hairlineAt(p.z, front) > 0) lo = mid; else hi = mid;
    }
    crossing.push((lo + hi) / 2);
  }

  const pos = [];
  const idx = [];
  const grid = [];
  for (let vi = 0; vi <= HEAD_V; vi++) {
    const row = [];
    if (vi === 0) {
      // Single welded crown vertex (see addHead): avoids a normal pinch.
      const p = skullPoint(0, 0, f, 0.008);
      const id = pos.push(p.x, p.y, p.z) / 3 - 1;
      for (let ui = 0; ui < HEAD_U; ui++) row.push(id);
    } else {
      for (let ui = 0; ui < HEAD_U; ui++) {
        const v = Math.min(vi / HEAD_V, crossing[ui]);
        const edge = THREE.MathUtils.clamp((crossing[ui] - v) / 0.12, 0, 1);
        const p = skullPoint(ui / HEAD_U, v, f, 0.0015 + edge * 0.0065);
        row.push(pos.push(p.x, p.y, p.z) / 3 - 1);
      }
    }
    grid.push(row);
  }
  for (let vi = 0; vi < HEAD_V; vi++) {
    for (let ui = 0; ui < HEAD_U; ui++) {
      const uj = (ui + 1) % HEAD_U;
      idx.push(grid[vi][ui], grid[vi][uj], grid[vi + 1][uj]);
      idx.push(grid[vi][ui], grid[vi + 1][uj], grid[vi + 1][ui]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const cap = new THREE.Mesh(g, mat);
  cap.castShadow = true;
  return cap;
}

/**
 * Falling hair for long/bob: an open shell swept around the BACK arc of the
 * head only (edges land behind the ears), hugging the skull then dropping.
 * Never a closed cylinder — that is what used to wrap across the face.
 */
function buildCurtain(style, f, mat) {
  const w = f.width;
  // rows: [y, rx, rz, z centre]
  const rows = style === 'long'
    ? [
      [0.080, 0.082, 0.088, -0.002],
      [0.048, 0.090, 0.096, -0.005],
      [0.008, 0.089, 0.093, -0.008],
      [-0.038, 0.081, 0.082, -0.010],
      [-0.088, 0.073, 0.070, -0.012],
      [-0.138, 0.068, 0.060, -0.012],
      [-0.182, 0.066, 0.054, -0.010],
    ]
    : [
      [0.080, 0.083, 0.089, -0.002],
      [0.048, 0.091, 0.097, -0.005],
      [0.008, 0.090, 0.094, -0.007],
      [-0.030, 0.086, 0.088, -0.008],
      [-0.058, 0.088, 0.090, -0.008], // bob tips flare out slightly
    ];
  const K = 14;
  const aMin = Math.PI * (115 / 180);
  const aMax = Math.PI * (245 / 180);
  const pos = [];
  const idx = [];
  for (let r = 0; r < rows.length; r++) {
    const [y, rx, rz, zc] = rows[r];
    for (let i = 0; i < K; i++) {
      const a = THREE.MathUtils.lerp(aMin, aMax, i / (K - 1));
      pos.push(Math.sin(a) * rx * w, y, zc + Math.cos(a) * rz);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < K - 1; i++) {
      const a = r * K + i;
      idx.push(a, a + 1, a + K + 1, a, a + K + 1, a + K);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const sheetMat = mat.clone();
  sheetMat.side = THREE.DoubleSide; // visible from front over the shoulders
  const curtain = new THREE.Mesh(g, sheetMat);
  curtain.castShadow = true;
  return curtain;
}

function buildHair(style, f, colour) {
  if (style === 'bald') return null;
  const group = new THREE.Group();
  const mat = hairMaterial(colour);

  group.add(buildHairCap(style, f, mat));

  if (style === 'long' || style === 'bob') group.add(buildCurtain(style, f, mat));
  if (style === 'ponytail') {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.030, 0.18, 4, 10), mat);
    tail.position.set(0, -0.020, -0.096);
    tail.rotation.x = -0.42;
    tail.castShadow = true;
    group.add(tail);
  }
  if (style === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), mat);
    bun.position.set(0, 0.078, -0.086);
    bun.castShadow = true;
    group.add(bun);
  }
  if (style === 'curly') {
    // Curls scattered over the hair-bearing scalp only — placing them on a
    // plain ring used to march them straight across the forehead.
    const front = HAIRLINE_FRONT.curly;
    for (let i = 0; i < 26; i++) {
      const u = (i * 0.6180339887) % 1;
      const v = 0.05 + 0.40 * ((i * 0.4172) % 1);
      const p = skullPoint(u, v, f, 0.010);
      if ((p.y - 0.062) < hairlineAt(p.z, front) + 0.004) continue;
      const curl = new THREE.Mesh(
        new THREE.SphereGeometry(0.023 + 0.009 * ((i * 0.731) % 1), 8, 7), mat,
      );
      curl.position.copy(p);
      curl.castShadow = true;
      group.add(curl);
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// Eyes
// ---------------------------------------------------------------------------

function buildEyes(f, eyeColour) {
  const group = new THREE.Group();
  const eyes = [];
  for (const S of [1, -1]) {
    const eye = new THREE.Group();
    // Slightly proud of the (shallow) socket: recessed eyes vanish at range.
    eye.position.set(S * 0.031 * f.width, 0.068, 0.0655);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 16, 12), eyeWhiteMaterial());
    // Strongly flattened front-to-back: a full sphere bulged past the lids
    // and read bug-eyed from three-quarter and profile angles.
    ball.scale.set(0.94, 1, 0.72);
    eye.add(ball);

    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.0068, 16), irisMaterial(eyeColour));
    iris.position.z = 0.0104; // just proud of the flattened ball front
    eye.add(iris);

    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.0030, 12), darkMaterial('#08060a'));
    pupil.position.z = 0.0108;
    eye.add(pupil);

    // Upper lid as a rotatable shell, so blinks are a single euler tweak.
    // anim.js drives blinks as rotation.x = -0.30 + closed * 1.35, so -0.30
    // must remain the "open" rest angle.
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.0148, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
      skinMaterial(f.skin),
    );
    lid.rotation.x = -0.30;
    eye.add(lid);

    const lower = new THREE.Mesh(
      new THREE.SphereGeometry(0.0145, 16, 8, 0, Math.PI * 2, Math.PI * 0.65, Math.PI * 0.35),
      skinMaterial(f.skin),
    );
    lower.rotation.x = 0.10;
    eye.add(lower);

    group.add(eye);
    eyes.push({ root: eye, lid, iris });
  }
  return { group, eyes };
}

/**
 * Brows as strips sampled directly off the inflated skull surface, so they sit
 * a fixed ~3.5mm proud of the skin whatever the parameter pokes (brow ridge,
 * temples, f.width) do underneath. The previous analytic arc landed BEHIND the
 * poked surface for most face seeds and rendered as clipped slivers.
 */
function buildBrows(f, colour) {
  const group = new THREE.Group();
  // Brows read as hair shadow, not glossy hair: darken and roughen the colour,
  // or bright hair (red, blonde) turns them into warpaint streaks.
  const mat = hairMaterial(colour).clone();
  mat.color = mat.color.clone().lerp(new THREE.Color('#221510'), 0.5);
  mat.roughness = 0.8;
  mat.metalness = 0;
  mat.side = THREE.DoubleSide;
  const N = 9;
  const V_PER_M = 1 / (Math.PI * 0.096); // metres of arc -> skull v units
  for (const S of [1, -1]) {
    const pos = [];
    const idx = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      // Sweep from beside the nose bridge out over the eye's outer corner.
      const theta = THREE.MathUtils.lerp(1.40, 0.86, t);
      const u = (S > 0 ? theta : Math.PI - theta) / (Math.PI * 2);
      // Arch peaks about two-thirds out; the tail drops slightly below the head.
      const v = 0.414 - 0.013 * Math.sin(Math.min(1, t * 1.15) * Math.PI)
        + 0.030 * Math.max(0, t - 0.70);
      const dv = (0.0028 - 0.0013 * t) * V_PER_M; // tapers toward the tail
      const top = skullPoint(u, v - dv, f, 0.0035);
      const bot = skullPoint(u, v + dv, f, 0.0035);
      pos.push(top.x, top.y, top.z, bot.x, bot.y, bot.z);
    }
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, mat));
  }
  return group;
}

// ---------------------------------------------------------------------------
// Clothing
// ---------------------------------------------------------------------------

const OUTFITS = ['tunic', 'gown', 'robe', 'coat', 'workwear', 'finery'];

/** Build a skinned garment shell from cross-section rings. */
function skinnedShell(rings, segments, allowed, material, doubleSide = false) {
  const mb = new MeshBuilder();
  const grid = rings.map((ring, r) => {
    const ids = [];
    for (let i = 0; i < segments; i++) {
      ids.push(mb.vertex(ringPoint(ring, i, segments), i / segments, r / rings.length, allowed));
    }
    return ids;
  });
  mb.stitch(grid);
  let mat = material;
  if (doubleSide) { mat = material.clone(); mat.side = THREE.DoubleSide; }
  const mesh = new THREE.SkinnedMesh(mb.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Garments are skinned to the same skeleton as the body. Parenting them to a
 * single bone each is cheaper, but they visibly detach at the waist and
 * shoulders the moment a character turns or bends — which is constantly.
 */
function buildClothing(p) {
  const meshes = [];
  const { outfit } = p;
  const base = torsoRings(p);
  const pad = 0.014;

  const bodice = base
    .filter((r) => r.y >= 0.94 && r.y <= 1.45)
    .map((r) => ({ ...r, rx: r.rx + pad, rz: r.rz + pad }));
  meshes.push(skinnedShell(bodice, BODY_SEGMENTS, TORSO_BONES, clothMaterial(outfit.primary)));

  const flowing = outfit.type === 'gown' || outfit.type === 'robe' || outfit.type === 'finery';
  if (flowing) {
    const skirtLen = outfit.type === 'robe' ? 0.80 : 0.70;
    const flare = outfit.type === 'finery' ? 0.30 : 0.22;
    const rings = [];
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      rings.push({
        y: 0.98 - t * skirtLen,
        rx: 0.150 + t * flare,
        rz: 0.122 + t * flare * 0.86,
        e: 0.95,
      });
    }
    meshes.push(skinnedShell(
      rings, 22, ['hips', 'spine', 'thighL', 'thighR'],
      clothMaterial(outfit.secondary), true,
    ));
  } else {
    for (const side of ['L', 'R']) {
      const path = chain([`thigh${side}`, `shin${side}`], 3);
      const rings = path.map((pt, i) => {
        const t = i / Math.max(1, path.length - 1);
        const r = (0.100 - t * 0.036) * p.limb + pad;
        return { y: pt.y, x: pt.x, rx: r, rz: r, e: 0.95 };
      });
      meshes.push(skinnedShell(
        rings, 12, ['hips', `thigh${side}`, `shin${side}`],
        clothMaterial(outfit.secondary),
      ));
    }
  }

  if (outfit.type === 'coat') {
    const panels = [];
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      panels.push({ y: 1.04 - t * 0.50, rx: 0.190 + t * 0.055, rz: 0.156 + t * 0.045, e: 0.95 });
    }
    meshes.push(skinnedShell(
      panels, 20, ['hips', 'spine', 'chest'],
      clothMaterial(outfit.accent, { rough: 0.78 }), true,
    ));
  }

  // Sleeves ride the arm chain, so they bend at the elbow with the limb.
  const mb = new MeshBuilder();
  const short = outfit.type === 'workwear';
  const wide = outfit.type === 'robe';
  for (const side of ['L', 'R']) {
    const full = chain([`clav${side}`, `upperArm${side}`, `foreArm${side}`, `hand${side}`], 3);
    const path = short
      ? full.slice(0, Math.max(3, Math.ceil(full.length * 0.5)))
      : full.slice(0, full.length - 1);
    const radii = path.map((_, i) => {
      const t = i / Math.max(1, path.length - 1);
      const arm = 0.056 - t * 0.020;
      return (arm + (wide ? Math.pow(t, 1.6) * 0.060 : 0)) * p.limb + 0.012;
    });
    addTube(mb, path, radii, [
      `clav${side}`, `upperArm${side}`, `foreArm${side}`, `hand${side}`, 'chest',
    ], { segments: 12 });
  }
  const sleeveMat = clothMaterial(outfit.primary).clone();
  sleeveMat.side = THREE.DoubleSide;
  const sleeves = new THREE.SkinnedMesh(mb.build(), sleeveMat);
  sleeves.castShadow = true;
  sleeves.frustumCulled = false;
  meshes.push(sleeves);

  return meshes;
}

// ---------------------------------------------------------------------------
// Presets & casting
// ---------------------------------------------------------------------------

export const SKIN_TONES = [
  '#f2d3bc', '#e9c4a4', '#d9a985', '#c68a63', '#a9714b',
  '#8a5a3b', '#6d452c', '#57351f', '#f7ddc8', '#cf9a72',
];
export const HAIR_COLOURS = [
  '#2b1c14', '#4a2f1e', '#6b4423', '#8a6134', '#b8894a',
  '#d8b47a', '#a83f2a', '#7a2418', '#1b1b1f', '#9a9aa2', '#e2e0dc',
];
export const EYE_COLOURS = ['#3a2a1c', '#4a3a28', '#2f4f4f', '#3b6b8c', '#6b8e4e', '#5a3a2a', '#7a7f88'];

const BUILDS = {
  slim: { shoulder: 0.94, waist: 0.88, hip: 0.94, chest: 0.92, limb: 0.90 },
  average: { shoulder: 1.0, waist: 1.0, hip: 1.0, chest: 1.0, limb: 1.0 },
  sturdy: { shoulder: 1.10, waist: 1.16, hip: 1.10, chest: 1.10, limb: 1.12 },
  willowy: { shoulder: 0.92, waist: 0.84, hip: 1.0, chest: 0.94, limb: 0.92 },
  broad: { shoulder: 1.16, waist: 1.06, hip: 1.02, chest: 1.12, limb: 1.10 },
};

export const OUTFIT_PALETTES = [
  { primary: '#3d5a7a', secondary: '#26374a', accent: '#c9a227' },
  { primary: '#7a3d4a', secondary: '#4a2630', accent: '#d9c08a' },
  { primary: '#4a6b4a', secondary: '#2e402e', accent: '#b8894a' },
  { primary: '#6b5a3d', secondary: '#3f3527', accent: '#e0d5b8' },
  { primary: '#5a4a7a', secondary: '#342b4a', accent: '#c9b7e8' },
  { primary: '#8a6a3d', secondary: '#4f3d22', accent: '#f0dfa8' },
  { primary: '#2f4f5a', secondary: '#1d323a', accent: '#9fd0d8' },
  { primary: '#7a5a4a', secondary: '#4a362c', accent: '#dcb894' },
];

export const MAGIC_COLOURS = {
  light: '#ffe9a8', fire: '#ff7a2a', frost: '#8fd8ff', telekinesis: '#c9a8ff',
  heal: '#a8ffc4', teleport: '#d0a8ff', shield: '#8fc4ff', illusion: '#ff9ede',
  shadow: '#7a5fa8', wind: '#d8f0e8',
};

/** Deterministic 32-bit hash so a given character name always casts the same. */
function hashName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(list, seed) { return list[seed % list.length]; }

/**
 * Turn a character name into a full appearance spec.
 * Callers may override any field from the UI.
 */
export function castCharacter(name, overrides = {}, ordinal = 0) {
  const h = hashName(name.toUpperCase()) + ordinal * 2654435761;
  const buildNames = Object.keys(BUILDS);
  const buildName = overrides.build || pick(buildNames, (h >>> 3));
  const palette = OUTFIT_PALETTES[(h >>> 11) % OUTFIT_PALETTES.length];
  const outfitType = overrides.outfitType || pick(OUTFITS, (h >>> 17));

  return {
    name,
    height: overrides.height ?? THREE.MathUtils.lerp(0.93, 1.07, ((h >>> 5) % 100) / 100),
    build: buildName,
    skin: overrides.skin || pick(SKIN_TONES, (h >>> 7)),
    hairColour: overrides.hairColour || pick(HAIR_COLOURS, (h >>> 13)),
    hairStyle: overrides.hairStyle || pick(HAIR_STYLES.slice(0, 7), (h >>> 19)),
    eyeColour: overrides.eyeColour || pick(EYE_COLOURS, (h >>> 23)),
    outfit: {
      type: outfitType,
      primary: overrides.primary || palette.primary,
      secondary: overrides.secondary || palette.secondary,
      accent: overrides.accent || palette.accent,
    },
    face: {
      width: THREE.MathUtils.lerp(0.94, 1.06, ((h >>> 2) % 100) / 100),
      jaw: THREE.MathUtils.lerp(0.82, 1.18, ((h >>> 9) % 100) / 100),
      brow: THREE.MathUtils.lerp(0.6, 1.4, ((h >>> 15) % 100) / 100),
      cheek: THREE.MathUtils.lerp(0.7, 1.3, ((h >>> 21) % 100) / 100),
      chin: THREE.MathUtils.lerp(0.7, 1.3, ((h >>> 25) % 100) / 100),
      nose: THREE.MathUtils.lerp(0.82, 1.22, ((h >>> 27) % 100) / 100),
      mouth: THREE.MathUtils.lerp(0.86, 1.16, ((h >>> 4) % 100) / 100),
    },
    magic: overrides.magic ?? null,
  };
}

export { HAIR_STYLES, OUTFITS, BUILDS };

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build a rigged character from an appearance spec.
 * @returns {THREE.Group} with `.bones`, `.skeleton`, `.parts`, `.spec`
 */
export function createCharacter(spec, options = {}) {
  const build = BUILDS[spec.build] || BUILDS.average;
  const p = { ...build, bust: spec.bust ?? 1.0, outfit: spec.outfit, limb: build.limb };
  const f = { ...spec.face, skin: spec.skin };

  // --- Bones --------------------------------------------------------------
  const bones = BONE_TABLE.map(([name, , pos]) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(...pos);
    return bone;
  });
  BONE_TABLE.forEach(([name, parent], i) => {
    if (parent === null) return;
    const parentIdx = BONE_INDEX.get(parent);
    // Positions in the table are world-space; convert to parent-relative.
    bones[i].position.sub(new THREE.Vector3(...BONE_TABLE[parentIdx][2]));
    bones[parentIdx].add(bones[i]);
  });
  const rootBone = bones[0];
  const boneLookup = Object.fromEntries(bones.map((b) => [b.name, b]));

  // A control rig is the skeleton alone: the animation system drives it and a
  // retargeter copies the result onto an imported avatar. No meshes needed.
  if (options.bonesOnly) {
    const rig = new THREE.Group();
    rig.name = spec.name;
    rig.add(rootBone);
    rig.scale.setScalar(spec.height ?? 1);
    rig.userData = {
      spec,
      bones: boneLookup,
      skeleton: null,
      eyes: [],
      body: null,
      hair: null,
      jaw: boneLookup.jaw,
      controlRig: true,
      height: 1.75 * (spec.height ?? 1),
      eyeHeight: 1.63 * (spec.height ?? 1),
      chestHeight: 1.30 * (spec.height ?? 1),
    };
    return rig;
  }

  // --- Body mesh ----------------------------------------------------------
  const mb = new MeshBuilder();
  addTorso(mb, p);
  addArm(mb, 'L', p);
  addArm(mb, 'R', p);
  addLeg(mb, 'L', p);
  addLeg(mb, 'R', p);
  addHead(mb, f);
  addNose(mb, f);
  addMouth(mb, f);

  const bodyGeo = mb.build();
  const body = new THREE.SkinnedMesh(bodyGeo, skinMaterial(spec.skin));
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false; // posed bones routinely exceed the bind bounds

  // --- Shoes (skinned, so they follow the feet) ---------------------------
  const shoeMB = new MeshBuilder();
  addShoe(shoeMB, 'L');
  addShoe(shoeMB, 'R');
  const shoes = new THREE.SkinnedMesh(shoeMB.build(), fabricMaterial(spec.outfit.secondary, 0.55));
  shoes.castShadow = true;
  shoes.frustumCulled = false;

  // --- Assemble -----------------------------------------------------------
  const group = new THREE.Group();
  group.name = spec.name;
  group.add(rootBone);
  group.add(body);
  group.add(shoes);

  const clothing = buildClothing(p);
  clothing.forEach((mesh) => group.add(mesh));

  rootBone.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  body.bind(skeleton);
  shoes.bind(skeleton);
  clothing.forEach((mesh) => mesh.bind(skeleton));

  const boneMap = Object.fromEntries(bones.map((b) => [b.name, b]));

  // Head furniture rides the head bone directly.
  const head = boneMap.head;
  const { group: eyeGroup, eyes } = buildEyes(f, spec.eyeColour);
  head.add(eyeGroup);

  const brows = buildBrows(f, spec.hairColour);
  head.add(brows);

  const hair = buildHair(spec.hairStyle, f, spec.hairColour);
  if (hair) head.add(hair);

  head.add(buildEars(f, spec.skin));

  // The closed-mouth seam line, and a dark cavity behind the lips so an open
  // mouth reads as open.
  head.add(buildMouthSeam(f));
  // Wide and tall enough to fill the whole opening when the jaw drops (a
  // narrow cavity let the stretched skin membrane show around a small dark
  // oval), yet still tucked behind the closed lip bands at rest. Width tracks
  // f.mouth so it cannot poke through the cheek beside a narrow mouth.
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), darkMaterial('#2a1218'));
  cavity.position.set(0, -0.007, 0.042);
  // 0.92: the cheek curls back faster than the lip-band parabola suggests, so
  // a cavity as wide as the mouth pierced it beside each corner (dark ticks).
  cavity.scale.set(0.92 * f.mouth, 0.60, 0.45);
  head.add(cavity);

  // Scale last: bind matrices are computed at unit scale above.
  group.scale.setScalar(spec.height ?? 1);

  group.userData = {
    spec,
    bones: boneMap,
    skeleton,
    eyes,
    body,
    hair,
    jaw: boneMap.jaw,
    height: 1.75 * (spec.height ?? 1),
    eyeHeight: 1.63 * (spec.height ?? 1),
    chestHeight: 1.30 * (spec.height ?? 1),
  };

  return group;
}

/** Approximate world-space head position, for camera aiming. */
export function headPosition(character, target = new THREE.Vector3()) {
  const head = character.userData.bones.head;
  head.updateWorldMatrix(true, false);
  const s = character.userData.spec.height ?? 1;
  return target.setFromMatrixPosition(head.matrixWorld).add(new THREE.Vector3(0, 0.068 * s, 0));
}

/** Approximate world-space chest position. */
export function chestPosition(character, target = new THREE.Vector3()) {
  const chest = character.userData.bones.chest;
  chest.updateWorldMatrix(true, false);
  return target.setFromMatrixPosition(chest.matrixWorld);
}
