// Pose solver: turns a pose *description* into bone rotations for any Rig.
//
// This is the "code the movement" half of the project. A pose is written in
// the terms a director or animator would use — thighs forward, feet on the
// floor 40cm ahead, right hand at the ear, lean back 10 degrees — and the
// solver works out quaternions per rig. Because the description is in
// meters and directions rather than per-rig angles, one authored sit works
// for a 1.68m woman on a bar stool and a 1.80m man on a sofa.
//
// Space: canonical (see rig.js): +Z forward, +X character's left, +Y up,
// origin on the floor between the feet.
//
// Spec fields (all optional):
//   hips:  { pos:[x,y,z] meters offset from standing, rot:[pitch,yaw,roll] deg }
//   rot:   { Bone:[pitch,yaw,roll] }  relative to parent (spine, neck, head)
//   abs:   { Bone:[pitch,yaw,roll] }  absolute; ignores parent (keep feet flat)
//   aim:   { Bone:[x,y,z] }           bone points this way in world
//   twist: { Bone:deg }                spin about the bone's own axis after aim
//   ik:    { LeftLeg|RightLeg|LeftArm|RightArm: { target:[x,y,z], pole:[x,y,z] } }
//   hand:  { left:{curl, thumb, spread}, right:{...} }  0..1 finger curl
// pitch>0 bends forward, yaw>0 turns to the character's left, roll>0 leans left.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const _e = new THREE.Euler();
const IDENT = new THREE.Quaternion();

export function eulerQ(v) {
  if (!v) return new THREE.Quaternion();
  _e.set(v[0] * DEG, v[1] * DEG, -v[2] * DEG, 'YXZ');
  return new THREE.Quaternion().setFromEuler(_e);
}

const CHAINS = {
  LeftLeg: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'],
  RightLeg: ['RightUpLeg', 'RightLeg', 'RightFoot'],
  LeftArm: ['LeftArm', 'LeftForeArm', 'LeftHand'],
  RightArm: ['RightArm', 'RightForeArm', 'RightHand'],
};
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

// Per-rig solver state: the rig's rest pose bent to the reference T-pose,
// and bone lengths. Built once per rig.
export class PoseSolver {
  constructor(rig, ref) {
    this.rig = rig;
    this.aligned = new Map();     // aligned rest world quaternion
    this.alignQ = new Map();      // rotation from rest to aligned rest
    this.offset = new Map();      // child offset from parent in aligned rest (model units)
    for (const n of rig.order) {
      const d = rig.restDir(n);
      const dr = ref && ref.bones.has(n) ? ref.restDir(n) : null;
      const a = d && dr ? new THREE.Quaternion().setFromUnitVectors(d, dr) : new THREE.Quaternion();
      this.alignQ.set(n, a);
      this.aligned.set(n, a.clone().multiply(rig.restQ.get(n)));
    }
    // Aligned rest positions via FK from the hips.
    this.alignedP = new Map();
    for (const n of rig.order) {
      const p = rig.parentOf.get(n);
      if (!p) { this.alignedP.set(n, rig.restP.get(n).clone()); continue; }
      // Rotation that took the parent from rest to aligned rest, accumulated.
      const acc = this.accAlign(p);
      const off = rig.restP.get(n).clone().sub(rig.restP.get(p)).applyQuaternion(acc);
      this.offset.set(n, off);
      this.alignedP.set(n, this.alignedP.get(p).clone().add(off));
    }
    this.u = 1 / rig.scale;       // model units per meter
    // Body measurements in meters, so specs can say "foot one thigh-length
    // ahead" and fit every body.
    const m = (n) => this.alignedP.get(n).clone().multiplyScalar(rig.scale);
    const len = (a, b) => m(a).distanceTo(m(b));
    const has = (n) => rig.bones.has(n);
    this.M = {
      hipH: m('Hips').y,
      legX: Math.abs(m('LeftUpLeg').x),
      hipJointH: m('LeftUpLeg').y,
      thigh: len('LeftUpLeg', 'LeftLeg'),
      shin: len('LeftLeg', 'LeftFoot'),
      ankle: m('LeftFoot').y,
      chestH: m('Spine2').y,
      neckH: m('Neck').y,
      headH: m('Head').y,
      shoulderH: m('LeftArm').y,
      shoulderX: Math.abs(m('LeftArm').x),
      upperArm: len('LeftArm', 'LeftForeArm'),
      foreArm: len('LeftForeArm', 'LeftHand'),
      hand: has('LeftHandMiddle1') ? len('LeftHand', 'LeftHandMiddle1') + 0.06 : 0.09,
      height: rig.height,
    };
  }

  // World rotation (rest -> aligned rest) that bone n has, i.e. aligned*inv(rest).
  accAlign(n) {
    return this.aligned.get(n).clone().multiply(this.rig.restQ.get(n).clone().invert());
  }

  alignedDir(n) {
    const c = this.rig.childOf.get(n);
    if (!c) return null;
    return this.offset.get(c).clone().normalize();
  }

  // Solve a spec into { q: Map(bone -> local quaternion), hips: Vector3 local position }.
  solve(spec) {
    const rig = this.rig;
    const D = new Map();
    const W = new Map();
    const P = new Map();
    const out = new Map();
    const aim = { ...(spec.aim || {}) };
    const twist = spec.twist || {};
    const ik = spec.ik || {};
    const ikBones = new Set();
    for (const k of Object.keys(ik)) for (const b of CHAINS[k] || []) ikBones.add(b);
    const hipsOff = spec.hips?.pos ? new THREE.Vector3(...spec.hips.pos).multiplyScalar(this.u) : new THREE.Vector3();

    for (const n of rig.order) {
      const p = rig.parentOf.get(n);
      const Dp = p ? D.get(p) : IDENT;
      let Dn;
      if (!p) {
        Dn = eulerQ(spec.hips?.rot);
      } else if (spec.abs && spec.abs[n]) {
        Dn = eulerQ(spec.abs[n]);
      } else if (spec.rot && spec.rot[n]) {
        Dn = Dp.clone().multiply(eulerQ(spec.rot[n]));
      } else {
        Dn = Dp.clone();
      }
      // Position of this joint now that the parent is placed.
      if (!p && spec.hips?.at) P.set(n, new THREE.Vector3(...spec.hips.at).multiplyScalar(this.u));
      else if (!p) P.set(n, this.alignedP.get(n).clone().add(hipsOff));
      else P.set(n, P.get(p).clone().add(this.offset.get(n).clone().applyQuaternion(Dp)));

      // IK: when we reach the first bone of a chain, turn the target into aims.
      for (const [k, chain] of Object.entries(CHAINS)) {
        if (chain[0] !== n || !ik[k]) continue;
        const [a, b, c] = chain;
        const L1 = this.offset.get(b).length();
        const L2 = this.offset.get(c).length();
        const root = P.get(n);
        const target = new THREE.Vector3(...ik[k].target).multiplyScalar(this.u);
        const toT = target.clone().sub(root);
        let d = toT.length();
        const dir = toT.normalize();
        d = Math.min(Math.max(d, Math.abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4);
        const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const pole = new THREE.Vector3(...(ik[k].pole || [0, 0, 1]));
        pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
        const knee = root.clone().add(dir.clone().multiplyScalar(L1 * cosA)).add(pole.multiplyScalar(L1 * sinA));
        const end = root.clone().add(dir.clone().multiplyScalar(d));
        aim[a] = knee.clone().sub(root).normalize().toArray();
        aim[b] = end.clone().sub(knee).normalize().toArray();
      }

      if (aim[n] && !(spec.abs && spec.abs[n])) {
        const cur = this.alignedDir(n);
        if (cur) {
          cur.applyQuaternion(Dn);
          const tgt = new THREE.Vector3(...aim[n]).normalize();
          Dn = new THREE.Quaternion().setFromUnitVectors(cur, tgt).multiply(Dn);
          if (twist[n]) Dn = new THREE.Quaternion().setFromAxisAngle(tgt, twist[n] * DEG).multiply(Dn);
        }
      }
      D.set(n, Dn);
      W.set(n, Dn.clone().multiply(this.aligned.get(n)));
    }

    // Fingers: curl about the hand's own "palm" axis in the aligned rest frame.
    if (spec.hand) this.applyHands(spec.hand, D, W);

    for (const n of rig.order) {
      const p = rig.parentOf.get(n);
      const pw = p ? W.get(p) : rig.hipsParentQ;
      out.set(n, pw.clone().invert().multiply(W.get(n)));
    }
    const hp = P.get('Hips').clone().applyMatrix4(rig.hipsParentInv);
    return { q: out, hips: hp, P };
  }

  applyHands(hand, D, W) {
    const rig = this.rig;
    for (const side of ['Left', 'Right']) {
      const h = hand[side.toLowerCase()];
      if (!h) continue;
      const sgn = side === 'Left' ? -1 : 1;     // left hand points +X; curl toward -Y
      const curl = h.curl ?? 0.3;
      const spread = h.spread ?? 0;
      for (let fi = 0; fi < FINGERS.length; fi++) {
        const f = FINGERS[fi];
        const fc = Array.isArray(curl) ? curl[fi] : curl;
        for (let j = 1; j <= 3; j++) {
          const n = `${side}Hand${f}${j}`;
          if (!rig.bones.has(n)) continue;
          const p = rig.parentOf.get(n);
          let q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sgn * fc * (j === 1 ? 70 : 85) * DEG);
          if (j === 1 && spread) q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sgn * spread * (fi - 1.5) * 8 * DEG).multiply(q);
          const Dn = D.get(p).clone().multiply(q);
          D.set(n, Dn);
          W.set(n, Dn.clone().multiply(this.aligned.get(n)));
          this.propagate(n, D, W);
        }
      }
      const tc = h.thumb ?? 0.2;
      for (let j = 1; j <= 3; j++) {
        const n = `${side}HandThumb${j}`;
        if (!rig.bones.has(n)) continue;
        const p = rig.parentOf.get(n);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sgn * tc * 35 * DEG);
        const Dn = D.get(p).clone().multiply(q);
        D.set(n, Dn);
        W.set(n, Dn.clone().multiply(this.aligned.get(n)));
        this.propagate(n, D, W);
      }
    }
  }

  // Children of n that were not set explicitly follow n rigidly.
  propagate(n, D, W) {
    const b = this.rig.bones.get(n);
    for (const k of b.children) {
      if (!k.isBone) continue;
      const kn = k.name.replace(/^mixamorig[:_]?/, '');
      if (/Hand(Index|Middle|Ring|Pinky|Thumb)[123]$/.test(kn)) continue;
      D.set(kn, D.get(n).clone());
      W.set(kn, D.get(kn).clone().multiply(this.aligned.get(kn)));
      this.propagate(kn, D, W);
    }
  }
}

// A blend of two specs, resolved by solving both and slerping the results.
// Used for transitions, where the two ends may constrain different bones.
export const blend = (a, b, w) => ({ __blend: [a, b, w] });

function solveAny(solver, s) {
  if (!s.__blend) return solver.solve(s);
  const [a, b, w] = s.__blend;
  if (w <= 0) return solveAny(solver, a);
  if (w >= 1) return solveAny(solver, b);
  const A = solveAny(solver, a), B = solveAny(solver, b);
  const q = new Map();
  for (const [n, qa] of A.q) q.set(n, qa.clone().slerp(B.q.get(n), w));
  return { q, hips: A.hips.clone().lerp(B.hips, w) };
}

// Samples fn(t) -> spec into an AnimationClip for this solver's rig.
export function bakeClip(solver, name, duration, fn, fps = 30) {
  const rig = solver.rig;
  const frames = Math.max(2, Math.round(duration * fps) + 1);
  const times = new Float32Array(frames);
  const qv = new Map(rig.order.map((n) => [n, new Float32Array(frames * 4)]));
  const pv = new Float32Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * duration;
    times[f] = t;
    const r = solveAny(solver, fn(t, t / duration, solver.M));
    for (const n of rig.order) r.q.get(n).toArray(qv.get(n), f * 4);
    r.hips.toArray(pv, f * 3);
  }
  const tracks = [];
  for (const n of rig.order) tracks.push(new THREE.QuaternionKeyframeTrack(rig.trackName(n, 'quaternion'), times, qv.get(n)));
  tracks.push(new THREE.VectorKeyframeTrack(rig.trackName('Hips', 'position'), times, pv));
  return new THREE.AnimationClip(name, duration, tracks);
}

// Easing helpers for authored motion.
export const ease = {
  inOut: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  out: (x) => 1 - (1 - x) * (1 - x),
  in: (x) => x * x,
  smooth: (x) => x * x * (3 - 2 * x),
};
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
// Maps t in [a,b] to [0,1] with smoothstep.
export const seg = (t, a, b) => ease.smooth(clamp01((t - a) / (b - a)));
