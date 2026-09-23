/**
 * Figure inspector — a neutral studio for looking at the humanoid generator on
 * its own, away from mood lighting and cinematic grading. Development only;
 * not part of the shipped app.
 */

import * as THREE from 'three';
import { castCharacter, createCharacter, HAIR_STYLES } from './human.js';
import { Animator, POSES } from './anim.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(2);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#6a6e78');

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);

// Even, generous studio light so geometry — not lighting — is what you judge.
scene.add(new THREE.HemisphereLight('#ffffff', '#5a5a60', 2.0));
const key = new THREE.DirectionalLight('#fff4e6', 2.4);
key.position.set(-3, 5, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3; key.shadow.camera.right = 3;
key.shadow.camera.top = 4; key.shadow.camera.bottom = -1;
scene.add(key);
const fill = new THREE.DirectionalLight('#cfe0ff', 0.9);
fill.position.set(4, 2, 3);
scene.add(fill);
const rim = new THREE.DirectionalLight('#ffffff', 1.4);
rim.position.set(1, 3, -5);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: '#8a8e96', roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const figures = [];
const animators = [];

function build(count = 5) {
  figures.forEach((f) => scene.remove(f));
  figures.length = 0;
  animators.length = 0;
  const names = ['MIREN', 'CORVAL', 'ASHE', 'BRENNA', 'TOMAS', 'IVO', 'SELKA'];
  for (let i = 0; i < count; i++) {
    const spec = castCharacter(names[i % names.length], {}, i);
    const c = createCharacter(spec);
    c.position.x = (i - (count - 1) / 2) * 0.95;
    scene.add(c);
    figures.push(c);
    animators.push(new Animator(c, i));
  }
}

const VIEWS = {
  lineup: { pos: [0, 1.35, 4.6], look: [0, 0.95, 0], fov: 40 },
  front: { pos: [0, 1.05, 2.4], look: [0, 0.95, 0], fov: 36 },
  side: { pos: [2.6, 1.05, 0.1], look: [0, 0.95, 0], fov: 36 },
  back: { pos: [0, 1.05, -2.4], look: [0, 0.95, 0], fov: 36 },
  face: { pos: [0, 1.62, 0.75], look: [0, 1.60, 0], fov: 32 },
  faceQuarter: { pos: [0.52, 1.64, 0.62], look: [0, 1.60, 0], fov: 32 },
  faceSide: { pos: [0.80, 1.62, 0.05], look: [0, 1.60, 0], fov: 32 },
  torso: { pos: [0, 1.30, 1.6], look: [0, 1.20, 0], fov: 36 },
  legs: { pos: [0, 0.60, 1.9], look: [0, 0.55, 0], fov: 36 },
};

function setView(name) {
  const v = VIEWS[name] || VIEWS.front;
  camera.position.set(...v.pos);
  camera.lookAt(...v.look);
  camera.fov = v.fov;
  camera.updateProjectionMatrix();
}

function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', fit);

let elapsed = 0;
const clock = new THREE.Clock();
let animate = true;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (animate) {
    elapsed += dt;
    animators.forEach((a) => a.update(dt, elapsed));
  }
  renderer.render(scene, camera);
}

build(5);
fit();
setView('lineup');
frame();

window.figure = {
  build,
  setView,
  scene,
  camera,
  renderer,
  figures,
  animators,
  setPose: (name) => animators.forEach((a) => a.setPose(name, true)),
  setSolo: (n) => {
    build(1);
    if (n) figures[0].position.x = 0;
  },
  setHair: (style) => { build(1); },
  freeze: (v) => { animate = !v; },
  poses: Object.keys(POSES),
  hairStyles: HAIR_STYLES,
  step: (n = 30) => {
    for (let i = 0; i < n; i++) { elapsed += 1 / 60; animators.forEach((a) => a.update(1 / 60, elapsed)); }
    renderer.render(scene, camera);
  },
};
