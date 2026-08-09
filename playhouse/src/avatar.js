/**
 * Avatar import and retargeting.
 *
 * Loads `.glb` (Ready Player Me, Mixamo, generic glTF) and `.vrm` (VRoid)
 * characters and drives them from the same procedural control rig that drives
 * the built-in humanoids. Nothing upstream changes: the director, blocking,
 * pose library, walk cycle, look-at and cue system all keep working, because
 * they talk to the control rig and never to the mesh.
 *
 * Retargeting is done in world space per bone:
 *
 *   delta        = srcWorldNow · srcWorldBind⁻¹
 *   tgtWorldWant = delta · tgtWorldBind
 *   tgtLocal     = tgtParentWorldNow⁻¹ · tgtWorldWant
 *
 * which is bind-pose agnostic — an imported T-pose drives correctly from an
 * A-pose control rig, and differing bone axis conventions come out in the wash.
 * Bones are processed parents-first so each parent's world matrix is current
 * by the time its children read it.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// ---------------------------------------------------------------------------
// Bone naming
// ---------------------------------------------------------------------------

/** Control-rig bone -> candidate names, normalised (lowercase, no separators). */
const BONE_ALIASES = {
  hips: ['hips', 'pelvis', 'hip', 'bip01pelvis', 'root'],
  spine: ['spine', 'spine1', 'spine01', 'abdomen'],
  chest: ['chest', 'spine2', 'spine02', 'upperchest', 'spine3', 'spine03'],
  neck: ['neck', 'neck01', 'neck1'],
  head: ['head', 'head01'],

  clavL: ['leftshoulder', 'shoulderl', 'clavl', 'claviclel', 'lshoulder', 'lcollar'],
  upperArmL: ['leftarm', 'leftupperarm', 'upperarml', 'arml', 'lupperarm', 'lshldr'],
  foreArmL: ['leftforearm', 'leftlowerarm', 'lowerarml', 'forearml', 'lforearm'],
  handL: ['lefthand', 'handl', 'lhand'],

  clavR: ['rightshoulder', 'shoulderr', 'clavr', 'clavicler', 'rshoulder', 'rcollar'],
  upperArmR: ['rightarm', 'rightupperarm', 'upperarmr', 'armr', 'rupperarm', 'rshldr'],
  foreArmR: ['rightforearm', 'rightlowerarm', 'lowerarmr', 'forearmr', 'rforearm'],
  handR: ['righthand', 'handr', 'rhand'],

  thighL: ['leftupleg', 'leftupperleg', 'thighl', 'uplegl', 'lthigh', 'lhip'],
  shinL: ['leftleg', 'leftlowerleg', 'calfl', 'shinl', 'legl', 'lshin'],
  footL: ['leftfoot', 'footl', 'lfoot'],
  toeL: ['lefttoebase', 'lefttoes', 'toebasel', 'toel', 'balll', 'ltoe'],

  thighR: ['rightupleg', 'rightupperleg', 'thighr', 'uplegr', 'rthigh', 'rhip'],
  shinR: ['rightleg', 'rightlowerleg', 'calfr', 'shinr', 'legr', 'rshin'],
  footR: ['rightfoot', 'footr', 'rfoot'],
  toeR: ['righttoebase', 'righttoes', 'toebaser', 'toer', 'ballr', 'rtoe'],
};

/** VRM humanoid bone names map cleanly, so prefer them when present. */
const VRM_MAP = {
  hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
  clavL: 'leftShoulder', upperArmL: 'leftUpperArm', foreArmL: 'leftLowerArm', handL: 'leftHand',
  clavR: 'rightShoulder', upperArmR: 'rightUpperArm', foreArmR: 'rightLowerArm', handR: 'rightHand',
  thighL: 'leftUpperLeg', shinL: 'leftLowerLeg', footL: 'leftFoot', toeL: 'leftToes',
  thighR: 'rightUpperLeg', shinR: 'rightLowerLeg', footR: 'rightFoot', toeR: 'rightToes',
};

/** Parents before children — retargeting depends on this order. */
const RETARGET_ORDER = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'foreArmL', 'handL',
  'clavR', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'toeL',
  'thighR', 'shinR', 'footR', 'toeR',
];

function normaliseName(name) {
  return String(name)
    .toLowerCase()
    .replace(/^mixamorig[:_]?/, '')
    .replace(/^(bip01|bip|armature|root)[\s_:.-]*/, '')
    .replace(/[\s_:.\-|]/g, '');
}

/**
 * Match an imported skeleton's bones to control-rig slots.
 * Exact alias hits win; a containment pass catches the long tail.
 */
export function mapBones(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  if (!bones.length) {
    // Some exporters emit plain Object3D hierarchies rather than Bones.
    root.traverse((o) => { if (o !== root && o.children.length >= 0 && o.type === 'Object3D') bones.push(o); });
  }

  const byNorm = new Map();
  for (const b of bones) {
    const n = normaliseName(b.name);
    if (!byNorm.has(n)) byNorm.set(n, b);
  }

  const mapping = {};
  const taken = new Set();

  for (const [slot, aliases] of Object.entries(BONE_ALIASES)) {
    for (const alias of aliases) {
      const hit = byNorm.get(alias);
      if (hit && !taken.has(hit)) { mapping[slot] = hit; taken.add(hit); break; }
    }
  }

  // Containment fallback for anything still unmatched.
  for (const [slot, aliases] of Object.entries(BONE_ALIASES)) {
    if (mapping[slot]) continue;
    for (const alias of aliases) {
      const hit = bones.find((b) => !taken.has(b) && normaliseName(b.name).includes(alias));
      if (hit) { mapping[slot] = hit; taken.add(hit); break; }
    }
  }

  return mapping;
}

function mapVrmBones(vrm) {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  const mapping = {};
  for (const [slot, vrmName] of Object.entries(VRM_MAP)) {
    const node = humanoid.getRawBoneNode?.(vrmName) || humanoid.getBoneNode?.(vrmName);
    if (node) mapping[slot] = node;
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Expressions (visemes, blinks, emotion)
// ---------------------------------------------------------------------------

/** Preference lists — first available wins, across ARKit / Oculus / VRM sets. */
const MORPH_SLOTS = {
  mouthOpen: ['jawOpen', 'viseme_aa', 'mouthOpen', 'aa', 'A', 'vrc.v_aa', 'JawOpen'],
  mouthWide: ['viseme_I', 'mouthSmile', 'ih', 'I', 'mouthStretchLeft'],
  mouthRound: ['viseme_O', 'mouthFunnel', 'oh', 'O', 'mouthPucker'],
  mouthClosed: ['viseme_PP', 'mouthClose', 'mouthPress', 'PP'],
  blinkL: ['eyeBlinkLeft', 'eyeBlink_L', 'blinkLeft', 'blink_l', 'Blink_L'],
  blinkR: ['eyeBlinkRight', 'eyeBlink_R', 'blinkRight', 'blink_r', 'Blink_R'],
  smile: ['mouthSmile', 'mouthSmileLeft', 'happy', 'joy'],
  frown: ['mouthFrownLeft', 'sad', 'sorrow'],
  browUp: ['browInnerUp', 'browOuterUpLeft', 'surprised'],
  browDown: ['browDownLeft', 'angry'],
};

/**
 * Drives whatever expression system the imported model actually has:
 * VRM expression manager if present, otherwise raw morph targets.
 */
export class ExpressionDriver {
  constructor(root, vrm = null) {
    this.vrm = vrm;
    this.meshes = [];
    this.slots = {};
    this.values = {};

    root.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary && o.morphTargetInfluences) {
        this.meshes.push(o);
      }
    });

    const available = new Set();
    this.meshes.forEach((m) => Object.keys(m.morphTargetDictionary).forEach((k) => available.add(k)));
    if (vrm?.expressionManager) {
      (vrm.expressionManager.expressions || []).forEach((e) => available.add(e.expressionName || e.name));
    }
    this.available = [...available];

    for (const [slot, candidates] of Object.entries(MORPH_SLOTS)) {
      const hit = candidates.find((c) => available.has(c))
        || candidates.find((c) => this.available.find((a) => a.toLowerCase() === c.toLowerCase()));
      if (hit) {
        this.slots[slot] = this.available.find((a) => a.toLowerCase() === hit.toLowerCase()) || hit;
      }
    }
  }

  get hasVisemes() { return !!(this.slots.mouthOpen); }

  set(slot, value) {
    const name = this.slots[slot];
    if (!name) return;
    this.values[slot] = value;
    const v = THREE.MathUtils.clamp(value, 0, 1);

    if (this.vrm?.expressionManager) {
      const applied = this.vrm.expressionManager.setValue?.(name, v);
      if (applied !== undefined) return;
    }
    for (const mesh of this.meshes) {
      const i = mesh.morphTargetDictionary[name];
      if (i !== undefined) mesh.morphTargetInfluences[i] = v;
    }
  }

  /**
   * Turn a single 0..1 amplitude into something that reads as speech.
   * Real phoneme alignment needs an acoustic model; blending open/wide/round
   * on a slow drift is a convincing stand-in at conversational distance.
   */
  speak(amount, elapsed) {
    const open = THREE.MathUtils.clamp(amount, 0, 1);
    this.set('mouthOpen', open * 0.85);
    const drift = Math.sin(elapsed * 3.1) * 0.5 + 0.5;
    this.set('mouthWide', open * drift * 0.45);
    this.set('mouthRound', open * (1 - drift) * 0.40);
  }

  blink(amount) {
    this.set('blinkL', amount);
    this.set('blinkR', amount);
  }

  emotion(name, weight = 1) {
    this.set('smile', 0); this.set('frown', 0);
    this.set('browUp', 0); this.set('browDown', 0);
    if (name === 'joyful' || name === 'tender') this.set('smile', 0.7 * weight);
    else if (name === 'sad') { this.set('frown', 0.75 * weight); this.set('browUp', 0.4 * weight); }
    else if (name === 'angry') this.set('browDown', 0.8 * weight);
    else if (name === 'afraid' || name === 'wonder') this.set('browUp', 0.7 * weight);
  }

  update(vrmDelta) {
    if (this.vrm?.expressionManager?.update) this.vrm.expressionManager.update(vrmDelta);
  }
}

// ---------------------------------------------------------------------------
// Retargeting
// ---------------------------------------------------------------------------

const _q1 = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _hipOffset = new THREE.Vector3();

function worldQuaternion(object, target) {
  object.matrixWorld.decompose(_pos, target, _scl);
  return target;
}

/**
 * Copies motion from a control rig onto an imported skeleton every frame.
 */

/**
 * Measure the limb orientation an imported rig was authored in.
 *
 * Retargeting transfers rotation *deltas from a reference pose*, so both rigs
 * must agree on what that reference is. Imports arrive in a T-pose (Mixamo),
 * an A-pose (many DCC exports) or something in between; rather than assume,
 * measure the arms and place the control rig in the same posture before the
 * deltas are captured. Otherwise the difference between the two rest poses is
 * silently baked in and every imported character stands with its arms out.
 *
 * @param {object} mapping control-rig slot -> imported bone
 * @returns {{armL: number, armR: number}} radians of abduction from hanging straight down
 */
export function measureRestPose(mapping) {
  const angleOf = (a, b, sign) => {
    if (!a || !b) return null;
    a.updateWorldMatrix(true, false);
    b.updateWorldMatrix(true, false);
    const pa = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
    const pb = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const d = pb.sub(pa);
    if (d.lengthSq() < 1e-9) return null;
    d.normalize();
    // 0 = hanging straight down, +pi/2 = horizontal and outward.
    return Math.atan2(sign * d.x, -d.y);
  };
  return {
    armL: angleOf(mapping.upperArmL, mapping.foreArmL, 1),
    armR: angleOf(mapping.upperArmR, mapping.foreArmR, -1),
  };
}

export class Retargeter {
  constructor(sourceBones, targetMapping, options = {}) {
    this.pairs = [];
    this.scale = options.scale ?? 1;
    this.hipsPair = null;

    // Both rigs must be in their rest pose when this runs.
    for (const slot of RETARGET_ORDER) {
      const src = sourceBones[slot];
      const tgt = targetMapping[slot];
      if (!src || !tgt) continue;

      src.updateWorldMatrix(true, false);
      tgt.updateWorldMatrix(true, false);

      const pair = {
        slot,
        src,
        tgt,
        srcBindWorldInv: worldQuaternion(src, new THREE.Quaternion()).invert(),
        tgtBindWorld: worldQuaternion(tgt, new THREE.Quaternion()),
        srcBindLocalPos: src.position.clone(),
        tgtBindLocalPos: tgt.position.clone(),
      };
      this.pairs.push(pair);
      if (slot === 'hips') this.hipsPair = pair;
    }

    this.matched = this.pairs.map((p) => p.slot);
    this.missing = RETARGET_ORDER.filter((s) => !this.matched.includes(s));
  }

  /** @param {THREE.Object3D} sourceRoot the control rig's root bone */
  apply(sourceRoot) {
    sourceRoot.updateWorldMatrix(true, true);

    for (const pair of this.pairs) {
      // World-space delta from the control rig's bind pose.
      worldQuaternion(pair.src, _q1);
      _q1.multiply(pair.srcBindWorldInv);
      // Where that puts the target bone in world space.
      _q1.multiply(pair.tgtBindWorld);

      const parent = pair.tgt.parent;
      if (parent) {
        worldQuaternion(parent, _qp).invert();
        pair.tgt.quaternion.copy(_qp).multiply(_q1);
      } else {
        pair.tgt.quaternion.copy(_q1);
      }

      // Carry the control rig's hip bob and stride through.
      if (pair === this.hipsPair) {
        _hipOffset.subVectors(pair.src.position, pair.srcBindLocalPos);
        pair.tgt.position.copy(pair.tgtBindLocalPos).addScaledVector(_hipOffset, this.scale);
      }

      // Parents-first ordering means our parent is already current.
      pair.tgt.updateMatrixWorld(false);
    }
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let loaderPromise = null;

/** VRM support is loaded lazily — most imports are plain glTF. */
async function getVrmPlugin() {
  if (!loaderPromise) {
    loaderPromise = import('@pixiv/three-vrm')
      .then((m) => m)
      .catch(() => null);
  }
  return loaderPromise;
}

/** Measure a model's standing height from its rendered geometry. */
function measureHeight(root) {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let found = false;
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (found) box.union(tmp); else { box.copy(tmp); found = true; }
  });
  return found ? box.max.y - box.min.y : 0;
}

/** FBX binaries announce themselves; ASCII FBX starts with a comment banner. */
function isFbx(buffer) {
  const head = new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength));
  const text = String.fromCharCode(...head);
  return text.startsWith('Kaydara FBX Binary') || text.includes('FBX 7') || text.includes('; FBX');
}

/**
 * Load an avatar from an ArrayBuffer.
 *
 * @param {ArrayBuffer} buffer contents of a .glb, .vrm or .fbx
 * @param {object} [options] `{ targetHeight }` in metres
 * @returns {Promise<{root, mapping, expressions, vrm, height, report}>}
 */
export async function loadAvatar(buffer, options = {}) {
  const targetHeight = options.targetHeight ?? 1.75;
  let root;
  let vrm = null;
  let format = 'glb';

  if (isFbx(buffer)) {
    // Mixamo and most DCC exports. Units are usually centimetres, which the
    // height normalisation below absorbs without special-casing.
    format = 'fbx';
    root = new FBXLoader().parse(buffer, '');
  } else {
    const loader = new GLTFLoader();
    // VRM files are glTF with extensions; register the plugin when available.
    const vrmModule = await getVrmPlugin();
    if (vrmModule?.VRMLoaderPlugin) {
      loader.register((parser) => new vrmModule.VRMLoaderPlugin(parser));
    }
    const gltf = await loader.parseAsync(buffer, '');
    vrm = gltf.userData?.vrm || null;
    format = vrm ? 'vrm' : 'glb';
    root = vrm?.scene || gltf.scene;

    if (vrm && vrmModule?.VRMUtils) {
      vrmModule.VRMUtils.rotateVRM0?.(vrm);
      try { vrmModule.VRMUtils.removeUnnecessaryJoints?.(root); } catch { /* optional */ }
    }
  }

  // Imported clips would fight the control rig for the same bones.
  root.animations = [];
  root.updateMatrixWorld(true);

  const mapping = (vrm && mapVrmBones(vrm)) || mapBones(root);

  // Normalise scale so imported people stand the right height on my stages.
  const measured = measureHeight(root);
  const scale = measured > 0.2 ? targetHeight / measured : 1;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);

  // Sit the feet on the floor.
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);

  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    // Imported materials are often authored for a different pipeline.
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      if (!m) return;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      // FBX arrives as MeshPhongMaterial; convert so it lights like everything
      // else in the scene and picks up the environment probe.
      if (m.isMeshPhongMaterial) {
        const std = new THREE.MeshStandardMaterial({
          name: m.name,
          map: m.map || null,
          normalMap: m.normalMap || null,
          alphaMap: m.alphaMap || null,
          color: m.color ? m.color.clone() : new THREE.Color('#ffffff'),
          transparent: m.transparent,
          opacity: m.opacity,
          alphaTest: m.alphaMap ? 0.35 : 0,
          side: m.side,
          roughness: m.shininess !== undefined
            ? THREE.MathUtils.clamp(1 - Math.sqrt(Math.max(0, m.shininess) / 100), 0.25, 0.95)
            : 0.7,
          metalness: 0.0,
        });
        if (Array.isArray(o.material)) o.material[i] = std; else o.material = std;
        m.dispose();
        return;
      }
      if ('envMapIntensity' in m) m.envMapIntensity = 0.85;
    });
  });

  // Synthesise a mouth when the model has none, before the driver scans for
  // what it can control.
  let generatedJaw = null;
  if (!vrm && !hasMouthShape(root)) {
    generatedJaw = buildJawMorph(root, mapping);
  }

  const expressions = new ExpressionDriver(root, vrm);

  const report = {
    kind: format,
    measuredHeight: +measured.toFixed(3),
    appliedScale: +scale.toFixed(3),
    bonesMatched: Object.keys(mapping).length,
    bonesMissing: RETARGET_ORDER.filter((s) => !mapping[s]),
    morphTargets: expressions.available.length,
    visemes: expressions.hasVisemes,
    expressionSlots: Object.keys(expressions.slots),
    generatedJaw: generatedJaw
      ? { meshes: generatedJaw.meshes, vertices: generatedJaw.vertices, dropRatio: generatedJaw.dropRatio, landmarks: generatedJaw.landmarks }
      : null,
  };

  return { root, mapping, expressions, vrm, generatedJaw, height: targetHeight, report };
}

// ---------------------------------------------------------------------------
// Generated jaw — lip sync for models that ship no blendshapes
// ---------------------------------------------------------------------------

/**
 * Mixamo characters, and most stock game models, have a head mesh but no
 * facial rig at all: no jaw bone, no morph targets. Their mouths physically
 * cannot open, which is fatal for dialogue and worse for song.
 *
 * Rather than reject those models, synthesise the missing morph. We locate the
 * mouth geometrically, then build a `jawOpen` morph target by rotating the
 * lower face about an anatomical hinge. It cannot produce true phoneme shapes
 * — there is no `aa` versus `oo` — but it turns "the mouth never moves" into
 * "the mouth opens with the voice", which is the difference between unusable
 * and usable.
 *
 * Everything is derived from the geometry itself, so it works on any rig whose
 * head bone we managed to map.
 */

const JAW_MORPH_NAME = 'jawOpen';

/** True if the model already has something we can drive as a mouth. */
export function hasMouthShape(root) {
  let found = false;
  root.traverse((o) => {
    if (!o.morphTargetDictionary) return;
    if (Object.keys(o.morphTargetDictionary).some((k) => /viseme|jaw_?open|mouth_?open|^(aa|a)$/i.test(k))) {
      found = true;
    }
  });
  return found;
}

/** Head bone plus every bone below it — the vertices we consider "head". */
function headBoneSet(headBone) {
  const set = new Set();
  headBone.traverse((o) => { if (o.isBone || o.isObject3D) set.add(o); });
  return set;
}

/**
 * Build and attach a `jawOpen` morph target to every mesh containing mouth
 * geometry.
 *
 * @param {THREE.Object3D} root imported model
 * @param {object} mapping control-rig slot -> imported bone
 * @param {object} [options] `{ angle }` maximum jaw rotation in radians
 * @returns {object|null} a report, or null if no head bone was mapped
 */
export function buildJawMorph(root, mapping, options = {}) {
  const headBone = mapping.head;
  if (!headBone) return null;

  const maxAngle = options.angle ?? 0.30;
  const group = headBoneSet(headBone);

  // --- Head frame -----------------------------------------------------------
  // Up runs along the bone toward its child; forward is world +Z expressed in
  // the bone's own space, since imported avatars are normalised to face +Z.
  headBone.updateWorldMatrix(true, false);
  const headQuat = new THREE.Quaternion();
  headBone.matrixWorld.decompose(new THREE.Vector3(), headQuat, new THREE.Vector3());
  const headWorldPos = new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld);

  // "Up" has to come from the neck-to-head axis. Taking the head bone's first
  // child is unreliable: on a Mixamo rig that child is usually an eye, which
  // points forward and sideways and skews the entire frame — which in turn
  // sends the mouth detection hunting in the wrong part of the skull.
  let up = null;
  if (mapping.neck) {
    mapping.neck.updateWorldMatrix(true, false);
    const neckPos = new THREE.Vector3().setFromMatrixPosition(mapping.neck.matrixWorld);
    const dirWorld = headWorldPos.clone().sub(neckPos);
    if (dirWorld.lengthSq() > 1e-10) {
      up = dirWorld.normalize().applyQuaternion(headQuat.clone().invert()).normalize();
    }
  }
  if (!up) {
    const tip = headBone.children.find((c) => /top|end|skull/i.test(c.name) && !/eye/i.test(c.name))
      || headBone.children.filter((c) => !/eye/i.test(c.name))
        .sort((a, b) => b.position.lengthSq() - a.position.lengthSq())[0];
    up = tip && tip.position.lengthSq() > 1e-8
      ? tip.position.clone().normalize()
      : new THREE.Vector3(0, 1, 0);
  }
  const forward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(headQuat.clone().invert())
    .projectOnPlane(up)
    .normalize();
  if (!Number.isFinite(forward.x) || forward.lengthSq() < 0.1) forward.set(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();

  // --- Gather head vertices in head-local space -----------------------------
  const candidates = [];
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry?.attributes?.position) return;
    const headIndex = o.skeleton.bones.indexOf(headBone);
    const groupIndices = new Set();
    const eyeIndices = new Set();
    o.skeleton.bones.forEach((b, i) => {
      if (group.has(b)) groupIndices.add(i);
      if (/eye|lash|brow|pupil|iris|cornea/i.test(b.name)) eyeIndices.add(i);
    });
    if (headIndex < 0 && !groupIndices.size) return;
    if (/eye|lash|brow|cornea|pupil/i.test(o.name)) return;

    const toHead = new THREE.Matrix4()
      .multiplyMatrices(o.skeleton.boneInverses[Math.max(0, headIndex)], o.bindMatrix);

    const pos = o.geometry.attributes.position;
    const skinIndex = o.geometry.attributes.skinIndex;
    const skinWeight = o.geometry.attributes.skinWeight;
    const local = new Float32Array(pos.count * 3);
    const weight = new Float32Array(pos.count);
    const v = new THREE.Vector3();
    let any = 0;

    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      let eyeW = 0;
      if (skinIndex && skinWeight) {
        for (let k = 0; k < 4; k++) {
          const bi = skinIndex.getComponent(i, k);
          const bw = skinWeight.getComponent(i, k);
          if (groupIndices.has(bi)) w += bw;
          if (eyeIndices.has(bi)) eyeW += bw;
        }
      } else {
        w = 1;
      }
      if (eyeW > 0.25) w = 0;
      weight[i] = w;
      if (w < 0.5) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(toHead);
      local[i * 3] = v.dot(right);
      local[i * 3 + 1] = v.dot(up);
      local[i * 3 + 2] = v.dot(forward);
      any++;
    }
    if (any > 24) candidates.push({ mesh: o, local, weight, toHead, count: pos.count });
  });

  if (!candidates.length) return null;

  // --- Anatomy from the geometry -------------------------------------------
  // The forward-most vertex in the upper head is the nose tip, which anchors
  // everything else far more reliably than absolute proportions do.
  let minUp = Infinity;
  let maxUp = -Infinity;
  for (const c of candidates) {
    for (let i = 0; i < c.count; i++) {
      if (c.weight[i] < 0.5) continue;
      const y = c.local[i * 3 + 1];
      if (y < minUp) minUp = y;
      if (y > maxUp) maxUp = y;
    }
  }
  const headHeight = maxUp - minUp;
  if (!(headHeight > 1e-4)) return null;

  let noseUp = minUp + headHeight * 0.55;
  let bestFwd = -Infinity;
  for (const c of candidates) {
    for (let i = 0; i < c.count; i++) {
      if (c.weight[i] < 0.5) continue;
      const y = c.local[i * 3 + 1];
      // Only look in the middle band: the crown and the neck both mislead.
      if (y < minUp + headHeight * 0.35 || y > minUp + headHeight * 0.80) continue;
      if (Math.abs(c.local[i * 3]) > headHeight * 0.12) continue; // near the centreline
      const z = c.local[i * 3 + 2];
      if (z > bestFwd) { bestFwd = z; noseUp = y; }
    }
  }

  // Anchor the facial landmarks to nose-tip-to-crown rather than to total head
  // height. How much neck ends up weighted to the head bone varies wildly
  // between rigs, so total height is an unstable ruler — and if the ruler is
  // long, the mouth line lands below the lips and they travel together instead
  // of parting.
  const faceUnit = Math.max(1e-5, maxUp - noseUp);
  const mouthUp = noseUp - faceUnit * 0.21;
  const chinUp = noseUp - faceUnit * 0.46;
  const hingeUp = noseUp + faceUnit * 0.09;      // roughly ear height
  const hingeFwd = bestFwd - faceUnit * 0.72;    // set back toward the ear canal
  const span = Math.max(1e-5, hingeUp - chinUp);
  const frontSpan = Math.max(1e-5, bestFwd - hingeFwd);

  const hinge = new THREE.Vector3()
    .addScaledVector(up, hingeUp)
    .addScaledVector(forward, hingeFwd);

  // --- Build the morph ------------------------------------------------------
  const axis = right.clone();
  const applied = [];
  const q = new THREE.Quaternion();
  const rel = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (const c of candidates) {
    const { mesh, local, weight, count } = c;
    const deltas = new Float32Array(count * 3);
    const inverseToHead = new THREE.Matrix4().copy(c.toHead).invert();
    let touched = 0;

    for (let i = 0; i < count; i++) {
      if (weight[i] < 0.4) continue;
      const x = local[i * 3];
      const y = local[i * 3 + 1];
      const z = local[i * 3 + 2];
      if (y > hingeUp + headHeight * 0.05) continue; // well above the hinge

      // The mandible boundary. At the face it is the mouth line; sweeping back
      // toward the ears it rises to meet the hinge itself. Weighting linearly
      // from the hinge instead just stretches the whole lower face downward and
      // the lips never part, because upper and lower lip travel together.
      const tz = THREE.MathUtils.clamp((z - hingeFwd) / frontSpan, 0, 1);
      const boundary = THREE.MathUtils.lerp(hingeUp, mouthUp, tz);
      const band = faceUnit * 0.05;
      let w = THREE.MathUtils.clamp((boundary + band - y) / (2 * band), 0, 1);
      w = w * w * (3 - 2 * w);
      // Fade out around the back of the skull and the neck column.
      const front = THREE.MathUtils.smoothstep(z, hingeFwd - faceUnit * 0.10, hingeFwd + faceUnit * 0.50);
      // Fade at the extreme sides so the cheeks don't shear.
      const side = 1 - THREE.MathUtils.smoothstep(Math.abs(x), faceUnit * 0.45, faceUnit * 0.72);
      w *= front * side * Math.min(1, weight[i]);
      if (w < 0.004) continue;

      p.set(0, 0, 0).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(forward, z);
      rel.subVectors(p, hinge);
      q.setFromAxisAngle(axis, maxAngle * w);
      rel.applyQuaternion(q).add(hinge).sub(p);

      // Back into the mesh's own space, where morph deltas live.
      const dx = rel.dot(right);
      const dy = rel.dot(up);
      const dz = rel.dot(forward);
      const worldDelta = new THREE.Vector3()
        .addScaledVector(right, dx).addScaledVector(up, dy).addScaledVector(forward, dz);
      worldDelta.applyMatrix4(new THREE.Matrix4().extractRotation(inverseToHead));

      deltas[i * 3] = worldDelta.x;
      deltas[i * 3 + 1] = worldDelta.y;
      deltas[i * 3 + 2] = worldDelta.z;
      touched++;
    }

    if (touched < 12) continue;

    // Largest displacement, in head-local units, for the report.
    let maxDelta = 0;
    for (let i = 0; i < count; i++) {
      const dx = deltas[i * 3];
      const dy = deltas[i * 3 + 1];
      const dz = deltas[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxDelta) maxDelta = d2;
    }
    maxDelta = Math.sqrt(maxDelta);

    const geo = mesh.geometry;
    if (!geo.morphAttributes.position) geo.morphAttributes.position = [];
    geo.morphAttributes.position.push(new THREE.BufferAttribute(deltas, 3));
    geo.morphTargetsRelative = true;

    const slot = geo.morphAttributes.position.length - 1;
    mesh.morphTargetDictionary = mesh.morphTargetDictionary || {};
    mesh.morphTargetDictionary[JAW_MORPH_NAME] = slot;
    mesh.morphTargetInfluences = mesh.morphTargetInfluences || [];
    while (mesh.morphTargetInfluences.length <= slot) mesh.morphTargetInfluences.push(0);

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => { if (m) m.needsUpdate = true; });

    applied.push({ mesh: mesh.name || '(unnamed)', vertices: touched, maxDelta: +maxDelta.toFixed(4) });
  }

  if (!applied.length) return null;

  // --- Mouth cavity ---------------------------------------------------------
  // An opened jaw on a solid head reveals the inside of the skull. A dark
  // ellipsoid behind the lips reads as a mouth instead of a hole.
  const mouthPoint = new THREE.Vector3()
    .addScaledVector(up, mouthUp)
    .addScaledVector(forward, bestFwd - faceUnit * 0.22);

  const cavity = new THREE.Mesh(
    new THREE.SphereGeometry(faceUnit * 0.26, 12, 10),
    new THREE.MeshBasicMaterial({ color: '#25101a', side: THREE.BackSide, toneMapped: false }),
  );
  cavity.position.copy(mouthPoint);
  cavity.scale.set(1.15, 0.62, 0.8);
  cavity.renderOrder = -1;
  cavity.name = 'generatedMouthCavity';
  headBone.add(cavity);

  return {
    applied,
    headHeight: +headHeight.toFixed(4),
    noseUp: +noseUp.toFixed(4),
    mouthUp: +mouthUp.toFixed(4),
    hingeUp: +hingeUp.toFixed(4),
    angle: maxAngle,
    faceUnit: +faceUnit.toFixed(4),
    landmarks: {
      mouth: +((mouthUp - minUp) / headHeight).toFixed(3),
      nose: +((noseUp - minUp) / headHeight).toFixed(3),
      hinge: +((hingeUp - minUp) / headHeight).toFixed(3),
    },
    meshes: applied.length,
    vertices: applied.reduce((s, a) => s + a.vertices, 0),
    // As a fraction of head height: a real jaw drop is roughly 0.12–0.22.
    dropRatio: +(Math.max(...applied.map((a) => a.maxDelta)) / headHeight).toFixed(3),
  };
}

// ---------------------------------------------------------------------------
// Persistence — avatars survive a reload without re-picking files
// ---------------------------------------------------------------------------

const DB_NAME = 'playhouse';
const STORE = 'avatars';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAvatarFile(character, buffer, filename) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ buffer, filename, savedAt: Date.now() }, character);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false; // private browsing, quota, etc. — not worth failing over
  }
}

export async function loadStoredAvatars() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () => {
        const out = new Map();
        keys.result.forEach((k, i) => out.set(k, values.result[i]));
        db.close();
        resolve(out);
      };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    return new Map();
  }
}

export async function clearStoredAvatar(character) {
  try {
    const db = await openDb();
    // Await the commit: "Remove" re-renders on this promise, and a reload right
    // after must not resurrect the avatar from an uncommitted delete.
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(character);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* nothing to clear */ }
}

export { RETARGET_ORDER };
