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
  };

  return { root, mapping, expressions, vrm, height: targetHeight, report };
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
        resolve(out);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return new Map();
  }
}

export async function clearStoredAvatar(character) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(character);
  } catch { /* nothing to clear */ }
}

export { RETARGET_ORDER };
