// The cast: which models exist, how they vary, and a clip cache per rig.
//
// Variety comes from recolouring, not more models. Two tricks:
//  - `tint` materials: the texture is reduced to luminance and multiplied by
//    a colour, so a pink suit can become navy (materials that are one garment).
//  - `hue` shifts: pixels inside a hue band get rotated to another hue, so
//    Michelle's yellow trousers change colour without touching her skin
//    (her whole body is one texture).
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Rig, retargetClip } from './rig.js';
import { PoseSolver, bakeClip } from './pose.js';
import { CLIPS, MOCAP } from './clips.js';

export const MODELS = {
  man: { file: 'readyplayer.me', height: 1.8, sex: 'm', walk: 'walk', idle: 'idle_m' },
  michelle: { file: 'Michelle', height: 1.7, sex: 'f', walk: 'walk_f', idle: 'idle' },
  girl: { file: 'HVGirl', height: 1.66, sex: 'f', walk: 'walk_f', idle: 'idle' },
  soldier: { file: 'Soldier', height: 1.82, sex: 'm', walk: 'walk', idle: 'idle_m' },
  mannequin: { file: 'Xbot', height: 1.78, sex: 'm', walk: 'walk', idle: 'idle_m' },
};

const MOCAP_ALL = { ...MOCAP, idle_m: ['Xbot', 'idle'], run_s: ['Soldier', 'Run'] };

// Palettes the recolouring draws from: believable clothing, not rainbow.
const CLOTH = ['#2b3a55', '#3f5e8c', '#8c2f39', '#2f6b4f', '#d9c7a0', '#e8e4dc', '#222428', '#6b4f3a', '#c75b39', '#5c4a72', '#7fa3b8', '#d4a33a', '#9aa0a6', '#f2b8c6', '#1f5f6b'];
const SKIN = ['#f1d3c0', '#e0b89a', '#c89878', '#a8765a', '#7d5440', '#5a3a2c'];
const HAIR = ['#1c1714', '#3b2a1e', '#6a4a2e', '#a8783e', '#d8b774', '#8c3b24', '#555555'];

export class Cast {
  constructor(loader) {
    this.loader = loader;
    this.rigs = new Map();
    this.solvers = new Map();
    this.clipCache = new Map();
    this.speedCache = new Map();
  }

  async load(onProgress) {
    const files = [...new Set(Object.values(MODELS).map((m) => m.file))];
    let done = 0;
    await Promise.all(files.map(async (f) => {
      const gltf = await this.loader.loadAsync(`assets/models/${f}.glb`);
      const def = Object.values(MODELS).find((m) => m.file === f);
      this.rigs.set(f, new Rig(f, gltf, { height: def.height }));
      onProgress?.(++done / files.length);
    }));
    const ref = this.rigs.get('Xbot');
    for (const [f, r] of this.rigs) this.solvers.set(f, new PoseSolver(r, ref));
  }

  rig(file) { return this.rigs.get(file); }

  // A clip for a rig, baked on first use. Procedural clips can take options
  // (seat height); options are part of the cache key, rounded so a café full
  // of slightly different chairs shares clips.
  clip(file, name, opts) {
    const key = `${file}|${name}|${opts ? JSON.stringify(opts, (k, v) => (typeof v === 'number' ? Math.round(v * 50) / 50 : v)) : ''}`;
    let c = this.clipCache.get(key);
    if (c) return c;
    const rig = this.rigs.get(file);
    if (MOCAP_ALL[name]) {
      const [src, clipName] = MOCAP_ALL[name];
      const srcRig = this.rigs.get(src);
      const raw = srcRig.gltf.animations.find((a) => a.name === clipName);
      c = retargetClip(raw, srcRig, rig, { name });
    } else if (CLIPS[name]) {
      const def = CLIPS[name];
      c = bakeClip(this.solvers.get(file), name, def.duration, (t, u, M) => def.fn(t, u, M, opts || {}));
      c.userData = { loop: def.loop };
    } else {
      throw new Error(`no clip "${name}"`);
    }
    if (!c.userData) c.userData = { loop: true };
    this.clipCache.set(key, c);
    return c;
  }

  isLooping(name) { return CLIPS[name] ? CLIPS[name].loop : true; }

  // Ground speed a locomotion clip implies, measured from the feet: during
  // stance a planted foot slides backward at exactly the speed the body
  // should move forward. Playing a walk at any other speed is foot sliding.
  naturalSpeed(file, name) {
    const key = `${file}|${name}`;
    if (this.speedCache.has(key)) return this.speedCache.get(key);
    const rig = this.rigs.get(file);
    const clip = this.clip(file, name);
    const obj = rig.template;
    const mixer = new THREE.AnimationMixer(obj);
    mixer.clipAction(clip).play();
    const feet = ['LeftFoot', 'RightFoot'].map((n) => rig.bones.get(n));
    const inv = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const N = 60;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      mixer.setTime((i / N) * clip.duration);
      obj.updateMatrixWorld(true);
      inv.copy(obj.matrixWorld).invert();
      samples.push(feet.map((f) => p.setFromMatrixPosition(f.matrixWorld).applyMatrix4(inv).applyQuaternion(rig.toCanon).clone()));
    }
    mixer.stopAllAction(); mixer.uncacheRoot(obj);
    for (const [n, b] of rig.bones) b.quaternion.copy(rig.restLocal.get(n));
    rig.bones.get('Hips').position.copy(rig.restHipsLocalPos);
    const dt = clip.duration / N;
    let sum = 0, cnt = 0;
    for (let i = 0; i < N; i++) {
      // The lower foot is the planted one.
      const k = samples[i][0].y < samples[i][1].y ? 0 : 1;
      const v = -(samples[i + 1][k].z - samples[i][k].z) / dt;
      if (v > 0) { sum += v; cnt++; }
    }
    const speed = cnt ? (sum / cnt) * rig.scale : 1.4;
    this.speedCache.set(key, speed);
    return speed;
  }

  // A new character instance. `look` is a seeded variant description.
  instance(modelKey, look = {}) {
    const def = MODELS[modelKey];
    const rig = this.rigs.get(def.file);
    const inst = SkeletonUtils.clone(rig.template);
    const inner = new THREE.Group();
    inner.quaternion.copy(rig.toCanon);
    inner.scale.setScalar(rig.scale);
    inner.position.y = -rig.minY * rig.scale;
    inner.add(inst);
    const morphs = [];
    inst.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      // Skinned bounds are computed in bind pose; a seated or lying pose
      // leaves them and gets culled at the screen edge.
      o.frustumCulled = false;
      o.material = restyle(o.material, modelKey, look);
      if (o.morphTargetDictionary && 'mouthOpen' in o.morphTargetDictionary) morphs.push(o);
      if (modelKey === 'man' && /Headwear/.test(o.material.name) && look.hat === false) o.visible = false;
      if (modelKey === 'man' && /Beard/.test(o.material.name) && look.beard === false) o.visible = false;
    });
    const bones = new Map();
    inst.traverse((o) => { if (o.isBone) bones.set(o.name.replace(/^mixamorig[:_]?/, ''), o); });
    return { root: inner, skeletonRoot: inst, bones, morphs, rig, def };
  }
}

// Seeded look for a model: which colours, hat, beard.
export function randomLook(modelKey, rand) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const look = { seed: Math.floor(rand() * 1e6) };
  if (modelKey === 'man') {
    Object.assign(look, { top: pick(CLOTH), bottom: pick(CLOTH), shoes: pick(['#2a2420', '#3a2a22', '#e8e4dc', '#222']), skin: pick(SKIN), hair: pick(HAIR), hat: rand() < 0.35, beard: rand() < 0.5 });
  } else if (modelKey === 'girl') {
    Object.assign(look, { top: pick(CLOTH), bottom: pick(CLOTH), shoes: pick(['#6b4f3a', '#222', '#e8e4dc']), skin: pick(SKIN), hair: pick(HAIR) });
  } else if (modelKey === 'michelle') {
    Object.assign(look, { pantsHue: rand(), topHue: rand() });
  } else if (modelKey === 'mannequin') {
    Object.assign(look, { top: pick(CLOTH) });
  }
  return look;
}

const hex = (c) => new THREE.Color(c);

function restyle(mat, modelKey, look) {
  const m = mat.clone();
  const n = mat.name || '';
  let tint = null, keepLight = false;
  if (modelKey === 'man') {
    if (/Outfit_Top/.test(n) && look.top) tint = look.top;
    else if (/Outfit_Bottom/.test(n) && look.bottom) tint = look.bottom;
    else if (/Footwear/.test(n) && look.shoes) tint = look.shoes;
    else if (/Headwear/.test(n) && look.top) tint = look.bottom;
    else if (/(Skin|Body)$/.test(n) && look.skin) { tint = look.skin; keepLight = true; }
    else if (/Hair|Beard/.test(n) && look.hair) tint = look.hair;
  } else if (modelKey === 'girl') {
    if (/T-shirt/.test(n) && look.top) m.color = hex(look.top);
    else if (/^short$/.test(n) && look.bottom) m.color = hex(look.bottom);
    else if (/^brown$/.test(n) && look.shoes) m.color = hex(look.shoes);
    else if (/^skin$/.test(n) && look.skin) m.color = hex(look.skin);
    else if (/^hair$/.test(n) && look.hair) m.color = hex(look.hair);
  } else if (modelKey === 'michelle' && look.pantsHue !== undefined) {
    hueShift(m, [[0.1, 0.2, look.pantsHue], [0.97, 0.06, look.topHue]]);
  } else if (modelKey === 'mannequin' && look.top) {
    if (/Beta_Joints|Joints/i.test(n)) m.color = hex('#333');
    else m.color = hex(look.top).lerp(hex('#ffffff'), 0.25);
  }
  if (tint) tintByLuminance(m, hex(tint), keepLight);
  m.envMapIntensity = 0.7;
  return m;
}

// Replace a garment texture's colour with `color`, keeping its shading and
// weave (luminance). For skin, keep more of the original so faces don't flatten.
function tintByLuminance(m, color, keepLight) {
  const u = { tintColor: { value: color }, tintKeep: { value: keepLight ? 0.35 : 0.0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 tintColor; uniform float tintKeep;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 t = tintColor * clamp(l * 1.9, 0.0, 1.4);
          diffuseColor.rgb = mix(t, diffuseColor.rgb, tintKeep); }`);
  };
  m.customProgramCacheKey = () => 'tint';
}

// Rotate the hue of pixels inside [h0,h1] (wrapping) to target hue `to`.
function hueShift(m, bands) {
  const u = {
    hsBand: { value: bands.map((b) => new THREE.Vector3(b[0], b[1], b[2])) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 hsBand[2];
        vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x);}
        vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y);}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 hsv = rgb2hsv(diffuseColor.rgb);
          for (int i = 0; i < 2; i++) {
            vec3 b = hsBand[i];
            bool inBand = b.x < b.y ? (hsv.x > b.x && hsv.x < b.y) : (hsv.x > b.x || hsv.x < b.y);
            if (inBand && hsv.y > 0.35) { hsv.x = b.z; diffuseColor.rgb = hsv2rgb(hsv); break; }
          } }`);
  };
  m.customProgramCacheKey = () => 'hue';
}
