// Model lab: a contact sheet of characters x clips at chosen instants, with
// seats drawn at the heights the clips were told about. Every authored pose
// is judged here, in pixels, before it goes near the game.
//
// ?sheet=sit@2,sit_down@0.5&models=Xbot,Michelle&view=side|front|three
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Rig, retargetClip } from './core/rig.js';
import { PoseSolver, bakeClip } from './core/pose.js';
import { CLIPS, MOCAP } from './core/clips.js';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9aa8b6);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(4, 8, 6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x7a8a7a }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const loader = new GLTFLoader();
const rigs = {};
async function rig(n) {
  if (!rigs[n]) rigs[n] = new Rig(n, await loader.loadAsync(`assets/models/${n}.glb`));
  return rigs[n];
}
const names = (params.get('models') || 'Xbot,Michelle,HVGirl,readyplayer.me,Soldier').split(',');
const sheet = (params.get('sheet') || 'stand@1').split(',');
const view = params.get('view') || 'three';
const opts = JSON.parse(params.get('opts') || '{}');
const ref = await rig('Xbot');
const info = [];
const GAPX = 1.1, GAPZ = 2.2;
for (let row = 0; row < sheet.length; row++) {
  const [clipName, tStr] = sheet[row].split('@');
  const t = Number(tStr || 0);
  for (let col = 0; col < names.length; col++) {
    const r = await rig(names[col]);
    const solver = r.__solver || (r.__solver = new PoseSolver(r, ref));
    const inst = SkeletonUtils.clone(r.template);
    inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const wrap = new THREE.Group();
    const inner = new THREE.Group();
    inner.quaternion.copy(r.toCanon);
    inner.scale.setScalar(r.scale);
    inner.position.y = -r.minY * r.scale;
    inner.add(inst);
    wrap.add(inner);
    wrap.position.set(col * GAPX, 0, -row * GAPZ);
    scene.add(wrap);
    let clip;
    const t0 = performance.now();
    if (MOCAP[clipName]) {
      const [srcName, srcClip] = MOCAP[clipName];
      const src = await rig(srcName);
      clip = retargetClip(src.gltf.animations.find((a) => a.name === srcClip), src, r);
    } else {
      const def = CLIPS[clipName];
      clip = bakeClip(solver, clipName, def.duration, (tt, u, M) => def.fn(tt, u, M, opts));
    }
    const ms = performance.now() - t0;
    const m = new THREE.AnimationMixer(inst);
    m.clipAction(clip).play();
    m.setTime(t);
    wrap.updateMatrixWorld(true);
    // Props the clip assumes: a seat block, a bed, a table.
    const h = opts.h ?? (clipName.includes('drive') ? 0.32 : clipName.includes('lie') || clipName === 'get_up' ? 0.55 : 0.46);
    if (/sit|type|piano|drive|stand_up/.test(clipName)) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, h, 0.42), new THREE.MeshStandardMaterial({ color: 0x8a5a3a }));
      seat.position.set(col * GAPX, h / 2, -row * GAPZ - 0.1); seat.castShadow = seat.receiveShadow = true; scene.add(seat);
    }
    if (/lie|get_up/.test(clipName)) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 2.0), new THREE.MeshStandardMaterial({ color: 0xd8d0c0 }));
      bed.position.set(col * GAPX, h / 2, -row * GAPZ + 0.35); bed.receiveShadow = true; scene.add(bed);
    }
    const feet = {};
    const lowest = { y: 9, n: '' };
    inst.traverse((o) => {
      if (!o.isBone) return;
      const p = new THREE.Vector3(); o.getWorldPosition(p);
      const n = o.name.replace(/^mixamorig/, '');
      if (/^(Left|Right)(Foot|ToeBase)$|^Hips$|^Head$|Hand$/.test(n)) feet[n] = p.toArray().map((v, i) => +(v - (i === 0 ? col * GAPX : i === 2 ? -row * GAPZ : 0)).toFixed(3));
      if (p.y < lowest.y) { lowest.y = +p.y.toFixed(3); lowest.n = n; }
    });
    info.push({ clip: clipName, t, model: names[col], bakeMs: Math.round(ms), lowest, joints: feet });
  }
}
// Frame whatever was built.
const content = new THREE.Box3();
scene.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o !== floor) content.expandByObject(o); });
const c = content.getCenter(new THREE.Vector3());
const size = content.getSize(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.1, 200);
const dirs = { side: [1, 0.25, 0.02], front: [0, 0.3, 1], three: [0.62, 0.5, 0.8], top: [0.01, 1, 0.3], back: [0, 0.3, -1] };
const dir = new THREE.Vector3(...dirs[view]).normalize();
const radius = size.length() / 2;
const fit = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * (Number(params.get('zoom') || 0.75));
camera.position.copy(c).addScaledVector(dir, fit);
camera.lookAt(c);
renderer.render(scene, camera);
window.__info = info;
window.__ready = true;
