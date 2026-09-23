// A Rig is a loaded humanoid model described in one shared "canonical" space:
// feet on y=0, facing +Z, character's left toward +X. Every animation in the
// game is transferred between rigs through that space.
//
// Why not play a clip on any model with matching bone names? Because it was
// tried first: the Soldier walk played on Michelle, HVGirl and the Ready Player
// Me avatar turned them upside down. Mixamo exports put different rotations
// on the armature node, so equal local quaternions mean different postures.
// Some rigs also rest in an A-pose and some in a T-pose. So motion is moved as
// a world-space rotation away from rest, after first bending the target's rest
// pose to match the source's (see `align` below).
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export const canonicalName = (name) => name.replace(/^mixamorig[:_]?/, '');

// The bone a bone "points at". Bones with several children need a choice;
// these are the ones whose direction reads as the limb's direction.
const PRIMARY_CHILD = {
  Hips: 'Spine', Spine2: 'Neck', Neck: 'Head',
  LeftHand: 'LeftHandMiddle1', RightHand: 'RightHandMiddle1',
  LeftShoulder: 'LeftArm', RightShoulder: 'RightArm',
};

export class Rig {
  constructor(name, gltf, { height = 1.75 } = {}) {
    this.name = name;
    this.gltf = gltf;
    this.template = gltf.scene;
    this.template.updateMatrixWorld(true);
    this.bones = new Map();          // canonical name -> Bone (in template)
    this.order = [];                  // canonical names, parents before children
    this.template.traverse((o) => {
      if (o.isBone) {
        const n = canonicalName(o.name);
        if (!this.bones.has(n)) { this.bones.set(n, o); this.order.push(n); }
      }
    });
    if (!this.bones.has('Hips')) throw new Error(`rig ${name}: no Hips bone`);
    this.prefix = this.bones.get('Hips').name.slice(0, -'Hips'.length);

    const rootInv = new THREE.Matrix4().copy(this.template.matrixWorld).invert();
    const modelPos = (b) => _v.setFromMatrixPosition(_m.multiplyMatrices(rootInv, b.matrixWorld)).clone();

    // Facing from the hips: forward = left x up.
    const l = modelPos(this.bones.get('LeftUpLeg'));
    const r = modelPos(this.bones.get('RightUpLeg'));
    const left = l.sub(r).setY(0).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, new THREE.Vector3(0, 1, 0)).normalize();
    this.yaw = Math.atan2(fwd.x, fwd.z);                       // model-space facing
    this.toCanon = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);

    // Rest data in canonical space.
    this.restQ = new Map();
    this.restP = new Map();
    const box = new THREE.Box3();
    this.template.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) box.expandByObject(o); });
    // Box is in world space of the template; template sits at identity so it is model space.
    this.minY = box.min.y;
    for (const [n, b] of this.bones) {
      _m.multiplyMatrices(rootInv, b.matrixWorld);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      _m.decompose(p, q, s);
      p.y -= this.minY;
      this.restP.set(n, p.applyQuaternion(this.toCanon));
      this.restQ.set(n, this.toCanon.clone().multiply(q));
    }
    this.rawHeight = box.max.y - box.min.y;
    this.scale = height / this.rawHeight;
    this.height = height;

    // The hips' parent chain (Armature nodes etc.) is never animated; its
    // canonical world transform is what hip positions are expressed against.
    const hips = this.bones.get('Hips');
    _m.multiplyMatrices(rootInv, hips.parent.matrixWorld);
    // canon = R(toCanon) * T(0, -minY, 0) * model
    this.hipsParentMatrixCanon = new THREE.Matrix4().makeRotationFromQuaternion(this.toCanon)
      .multiply(new THREE.Matrix4().makeTranslation(0, -this.minY, 0)).multiply(_m);
    this.hipsParentInv = this.hipsParentMatrixCanon.clone().invert();
    const pq = new THREE.Quaternion();
    this.hipsParentMatrixCanon.decompose(new THREE.Vector3(), pq, new THREE.Vector3());
    this.hipsParentQ = pq;

    this.restLocal = new Map();
    for (const [n, b] of this.bones) this.restLocal.set(n, b.quaternion.clone());
    this.restHipsLocalPos = hips.position.clone();

    this.parentOf = new Map();
    for (const [n, b] of this.bones) {
      this.parentOf.set(n, b.parent && b.parent.isBone ? canonicalName(b.parent.name) : null);
    }
    this.childOf = new Map();
    for (const n of this.order) {
      const b = this.bones.get(n);
      const pref = PRIMARY_CHILD[n];
      let c = pref && this.bones.has(pref) ? pref : null;
      if (!c) {
        const kids = b.children.filter((k) => k.isBone);
        if (kids.length === 1) c = canonicalName(kids[0].name);
      }
      this.childOf.set(n, c);
    }
    this.legLength = this.restP.get('Hips').y;
    this.skinned = [];
    this.template.traverse((o) => { if (o.isSkinnedMesh) this.skinned.push(o); });
  }

  restDir(n) {
    const c = this.childOf.get(n);
    if (!c) return null;
    return this.restP.get(c).clone().sub(this.restP.get(n)).normalize();
  }

  trackName(n, prop) { return `${this.bones.get(n).name}.${prop}`; }
}

// Bakes `clip` (authored for `src`) into a clip for `dst`.
export function retargetClip(clip, src, dst, { fps = 30, name = clip.name } = {}) {
  const shared = dst.order.filter((n) => src.bones.has(n));
  // Rest alignment: rotate each target rest orientation so its bone points
  // where the source's rest bone points (A-pose target vs T-pose source).
  const alignedRest = new Map();
  for (const n of dst.order) {
    const dt = dst.restDir(n), ds = src.bones.has(n) ? src.restDir(n) : null;
    const a = dt && ds ? new THREE.Quaternion().setFromUnitVectors(dt, ds) : new THREE.Quaternion();
    alignedRest.set(n, a.multiply(dst.restQ.get(n)));
  }
  const srcRestInv = new Map();
  for (const n of shared) srcRestInv.set(n, src.restQ.get(n).clone().invert());

  // Drive the source template with a private mixer.
  const mixer = new THREE.AnimationMixer(src.template);
  const action = mixer.clipAction(clip);
  action.play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const qv = new Map(dst.order.map((n) => [n, new Float32Array(frames * 4)]));
  const pv = new Float32Array(frames * 3);
  const hasHipPos = clip.tracks.some((t) => /Hips\.position$/.test(t.name));
  const rootInv = new THREE.Matrix4();
  const world = new Map();
  const srcAnimQ = new Map();
  const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
  const hipScale = dst.legLength / src.legLength;

  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps);
    times[f] = t;
    mixer.setTime(t);
    src.template.updateMatrixWorld(true);
    rootInv.copy(src.template.matrixWorld).invert();
    let srcHipsPos = null;
    for (const n of shared) {
      _m.multiplyMatrices(rootInv, src.bones.get(n).matrixWorld);
      const q = new THREE.Quaternion();
      _m.decompose(tmpP, q, tmpS);
      srcAnimQ.set(n, src.toCanon.clone().multiply(q));
      if (n === 'Hips') { tmpP.y -= src.minY; srcHipsPos = tmpP.clone().applyQuaternion(src.toCanon); }
    }
    for (const n of dst.order) {
      let w;
      if (srcAnimQ.has(n)) {
        w = srcAnimQ.get(n).clone().multiply(srcRestInv.get(n)).multiply(alignedRest.get(n));
      } else {
        const p = dst.parentOf.get(n);
        w = (p ? world.get(p) : dst.hipsParentQ).clone().multiply(dst.restLocal.get(n));
      }
      world.set(n, w);
      const p = dst.parentOf.get(n);
      const pw = p ? world.get(p) : dst.hipsParentQ;
      _q.copy(pw).invert().multiply(w);
      _q.toArray(qv.get(n), f * 4);
    }
    // Hips translation: the source's offset from its rest, scaled by leg length.
    const tp = dst.restP.get('Hips').clone();
    if (hasHipPos && srcHipsPos) tp.add(srcHipsPos.sub(src.restP.get('Hips')).multiplyScalar(hipScale));
    tp.applyMatrix4(dst.hipsParentInv);
    tp.toArray(pv, f * 3);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(src.template);
  resetPose(src);

  const tracks = [];
  for (const n of dst.order) {
    const arr = qv.get(n);
    if (isConstant(arr, 4)) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(dst.trackName(n, 'quaternion'), times, arr));
  }
  tracks.push(new THREE.VectorKeyframeTrack(dst.trackName('Hips', 'position'), times, pv));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

function isConstant(arr, stride) {
  for (let i = stride; i < arr.length; i++) if (Math.abs(arr[i] - arr[i % stride]) > 1e-5) return false;
  return true;
}

export function resetPose(rig) {
  for (const [n, b] of rig.bones) b.quaternion.copy(rig.restLocal.get(n));
  rig.bones.get('Hips').position.copy(rig.restHipsLocalPos);
  rig.template.updateMatrixWorld(true);
}
