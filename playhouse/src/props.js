/**
 * Prop library.
 *
 * Every prop is a parametric build function returning a THREE.Group, plus
 * metadata the stage dresser and the blocking system read: footprint, height,
 * category, whether it emits light, and any anchors a character can occupy
 * (sit, lean, stand-behind).
 *
 * Props that move register a `userData.update(dt, elapsed)` callback — flame
 * flicker, clock pendulum, hands — so the scene has life even in a held shot.
 */

import * as THREE from 'three';
import {
  woodMaterial, metalMaterial, glassMaterial, glowMaterial,
  fabricMaterial, darkMaterial,
} from './materials.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, mat, seg = 16, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function lathe(profile, mat, seg = 20) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Oil lamp — glass cylindrical chimney, live flame, flickering practical light
// ---------------------------------------------------------------------------

function buildOilLamp({ brass = '#b8873f', oil = '#c8862c' } = {}) {
  const g = new THREE.Group();
  const brassMat = metalMaterial(brass, 0.32);

  // Turned foot and stem.
  const footProfile = [
    V3(0, 0, 0), V3(0.055, 0, 0), V3(0.055, 0.010, 0), V3(0.044, 0.018, 0),
    V3(0.030, 0.026, 0), V3(0.020, 0.040, 0), V3(0.024, 0.052, 0),
    V3(0.034, 0.060, 0), V3(0.036, 0.068, 0),
  ].map((p) => new THREE.Vector2(p.x, p.y));
  const foot = lathe(footProfile, brassMat, 24);
  g.add(foot);

  // Glass font holding the oil.
  const fontProfile = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const y = 0.068 + t * 0.088;
    const r = 0.036 + Math.sin(t * Math.PI) * 0.020;
    fontProfile.push(new THREE.Vector2(r, y));
  }
  const font = lathe(fontProfile, glassMaterial('#e8f0f2', 0.30), 24);
  font.castShadow = false;
  g.add(font);

  // The oil itself, filling the lower two-thirds.
  const oilProfile = fontProfile
    .filter((p) => p.y < 0.068 + 0.088 * 0.62)
    .map((p) => new THREE.Vector2(p.x * 0.93, p.y));
  oilProfile.push(new THREE.Vector2(0, oilProfile[oilProfile.length - 1].y));
  const oilMesh = lathe(oilProfile, new THREE.MeshStandardMaterial({
    color: new THREE.Color(oil), roughness: 0.18, metalness: 0, transparent: true, opacity: 0.85,
  }), 24);
  oilMesh.castShadow = false;
  g.add(oilMesh);

  // Brass collar and burner gallery.
  const collar = cyl(0.030, 0.034, 0.026, brassMat, 20, 0, 0.168, 0);
  g.add(collar);
  const knurl = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0035, 6, 20), brassMat);
  knurl.rotation.x = Math.PI / 2;
  knurl.position.y = 0.176;
  g.add(knurl);

  // Wick adjuster wheel on the side.
  const wheel = cyl(0.011, 0.011, 0.004, brassMat, 12, 0.032, 0.170, 0);
  wheel.rotation.z = Math.PI / 2;
  g.add(wheel);

  const gallery = cyl(0.036, 0.031, 0.014, brassMat, 20, 0, 0.188, 0);
  g.add(gallery);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = box(0.005, 0.030, 0.005, brassMat, Math.cos(a) * 0.033, 0.205, Math.sin(a) * 0.033);
    g.add(prong);
  }

  // Wick.
  const wick = cyl(0.006, 0.007, 0.016, darkMaterial('#2a2018'), 8, 0, 0.199, 0);
  g.add(wick);

  // --- The chimney: a straight glass cylinder, lightly flared at the lip ---
  const chimneyProfile = [];
  const chimH = 0.165;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const y = 0.196 + t * chimH;
    // Straight-sided for all but the top 15%, which opens out.
    const flare = t > 0.85 ? (t - 0.85) / 0.15 : 0;
    chimneyProfile.push(new THREE.Vector2(0.0325 + flare * 0.008, y));
  }
  const chimney = lathe(chimneyProfile, glassMaterial('#eef6f8', 0.20), 28);
  chimney.castShadow = false;
  chimney.renderOrder = 2;
  g.add(chimney);

  // --- Flame ---------------------------------------------------------------
  const flame = new THREE.Group();
  flame.position.set(0, 0.208, 0);

  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.014, 0.058, 10, 1, true),
    glowMaterial('#ff9a3c', 0.42),
  );
  outer.position.y = 0.029;
  flame.add(outer);

  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.008, 0.036, 10, 1, true),
    glowMaterial('#ffe6a8', 0.85),
  );
  inner.position.y = 0.018;
  flame.add(inner);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.005, 8, 6),
    glowMaterial('#9fc8ff', 0.5),
  );
  core.position.y = 0.006;
  flame.add(core);

  g.add(flame);

  const light = new THREE.PointLight('#ffb765', 2.6, 6.5, 1.9);
  light.position.set(0, 0.225, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.004;
  g.add(light);

  g.userData.update = (dt, t) => {
    // Layered sines read as an organic flicker without the jitter of noise.
    const f = 0.82
      + Math.sin(t * 11.3) * 0.09
      + Math.sin(t * 27.7) * 0.05
      + Math.sin(t * 4.1) * 0.06;
    flame.scale.set(0.9 + f * 0.14, f, 0.9 + f * 0.14);
    flame.position.x = Math.sin(t * 8.3) * 0.0014;
    flame.position.z = Math.cos(t * 6.9) * 0.0014;
    light.intensity = 2.1 + f * 1.1;
  };
  g.userData.lightSource = light;

  return g;
}

// ---------------------------------------------------------------------------
// Grandfather clock
// ---------------------------------------------------------------------------

/** Painted dial drawn to a canvas — far sharper than modelled numerals. */
function clockFaceTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const r = size / 2;

  x.fillStyle = '#efe6d0';
  x.beginPath(); x.arc(r, r, r, 0, Math.PI * 2); x.fill();

  // Aged wash toward the rim.
  const grad = x.createRadialGradient(r, r, r * 0.35, r, r, r);
  grad.addColorStop(0, 'rgba(120,95,55,0)');
  grad.addColorStop(1, 'rgba(120,95,55,0.30)');
  x.fillStyle = grad;
  x.beginPath(); x.arc(r, r, r, 0, Math.PI * 2); x.fill();

  x.strokeStyle = '#3a2a18';
  x.lineWidth = size * 0.012;
  x.beginPath(); x.arc(r, r, r * 0.93, 0, Math.PI * 2); x.stroke();
  x.lineWidth = size * 0.006;
  x.beginPath(); x.arc(r, r, r * 0.74, 0, Math.PI * 2); x.stroke();

  const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  x.fillStyle = '#2b1e10';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `bold ${Math.round(size * 0.088)}px Georgia, serif`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    x.save();
    x.translate(r + Math.cos(a) * r * 0.835, r + Math.sin(a) * r * 0.835);
    x.rotate(a + Math.PI / 2);
    x.fillText(numerals[i], 0, 0);
    x.restore();
  }

  // Minute ticks.
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const long = i % 5 === 0;
    x.strokeStyle = '#2b1e10';
    x.lineWidth = long ? size * 0.010 : size * 0.004;
    x.beginPath();
    x.moveTo(r + Math.cos(a) * r * (long ? 0.68 : 0.71), r + Math.sin(a) * r * (long ? 0.68 : 0.71));
    x.lineTo(r + Math.cos(a) * r * 0.745, r + Math.sin(a) * r * 0.745);
    x.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildGrandfatherClock({ wood = '#4a2c18', brass = '#c9a24a' } = {}) {
  const g = new THREE.Group();
  const woodMat = woodMaterial(wood, 0.48);
  const darkWood = woodMaterial('#33200f', 0.55);
  const brassMat = metalMaterial(brass, 0.26);

  // Plinth.
  g.add(box(0.54, 0.06, 0.34, darkWood, 0, 0.03, 0));
  g.add(box(0.48, 0.22, 0.30, woodMat, 0, 0.17, 0));
  g.add(box(0.52, 0.03, 0.32, darkWood, 0, 0.295, 0));

  // Trunk with a recessed, glazed door.
  const trunkH = 1.18;
  const trunkY = 0.31 + trunkH / 2;
  g.add(box(0.42, trunkH, 0.26, woodMat, 0, trunkY, 0));
  // Side stiles frame the glass.
  g.add(box(0.06, trunkH - 0.06, 0.02, darkWood, 0.175, trunkY, 0.131));
  g.add(box(0.06, trunkH - 0.06, 0.02, darkWood, -0.175, trunkY, 0.131));
  g.add(box(0.42, 0.07, 0.02, darkWood, 0, trunkY + trunkH / 2 - 0.05, 0.131));
  g.add(box(0.42, 0.07, 0.02, darkWood, 0, trunkY - trunkH / 2 + 0.05, 0.131));

  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.29, trunkH - 0.16),
    glassMaterial('#cfe0e6', 0.16),
  );
  pane.position.set(0, trunkY, 0.133);
  pane.renderOrder = 3;
  g.add(pane);

  // Dark interior so the pendulum reads against something.
  g.add(box(0.34, trunkH - 0.10, 0.01, darkMaterial('#120c08'), 0, trunkY, -0.10));

  // Pendulum on a pivot group.
  const pivot = new THREE.Group();
  pivot.position.set(0, trunkY + trunkH / 2 - 0.04, 0.02);
  const rod = cyl(0.006, 0.006, 0.78, brassMat, 8, 0, -0.39, 0);
  pivot.add(rod);
  const bob = cyl(0.075, 0.075, 0.014, brassMat, 24, 0, -0.79, 0);
  bob.rotation.x = Math.PI / 2;
  pivot.add(bob);
  const bobRim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 8, 24), brassMat);
  bobRim.position.y = -0.79;
  pivot.add(bobRim);
  g.add(pivot);

  // Driving weights.
  const weights = [];
  for (const wx of [-0.10, 0.10]) {
    const w = cyl(0.030, 0.030, 0.18, metalMaterial('#8f7a4a', 0.4), 14, wx, trunkY + 0.20, -0.03);
    g.add(w);
    weights.push(w);
    const chain = cyl(0.003, 0.003, 0.34, brassMat, 6, wx, trunkY + 0.46, -0.03);
    g.add(chain);
  }

  // Hood.
  const hoodY = 0.31 + trunkH + 0.24;
  g.add(box(0.54, 0.48, 0.32, woodMat, 0, hoodY, 0));
  g.add(box(0.58, 0.035, 0.35, darkWood, 0, hoodY + 0.255, 0));

  // Swan-neck pediment: two quarter-torus sweeps meeting a central finial.
  for (const s of [1, -1]) {
    const neck = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.018, 8, 16, Math.PI * 0.5),
      woodMat,
    );
    neck.position.set(s * 0.13, hoodY + 0.27, 0.10);
    neck.rotation.z = s > 0 ? Math.PI * 0.5 : 0;
    neck.scale.z = 0.6;
    g.add(neck);
    const finial = lathe([
      new THREE.Vector2(0, 0), new THREE.Vector2(0.018, 0.012),
      new THREE.Vector2(0.014, 0.030), new THREE.Vector2(0.022, 0.046),
      new THREE.Vector2(0.008, 0.064), new THREE.Vector2(0, 0.072),
    ], brassMat, 14);
    finial.position.set(s * 0.235, hoodY + 0.27, 0);
    g.add(finial);
  }
  const centreFinial = lathe([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.022, 0.014),
    new THREE.Vector2(0.017, 0.036), new THREE.Vector2(0.027, 0.056),
    new THREE.Vector2(0.010, 0.078), new THREE.Vector2(0, 0.090),
  ], brassMat, 16);
  centreFinial.position.set(0, hoodY + 0.27, 0);
  g.add(centreFinial);

  // Dial, bezel and hands.
  const dial = new THREE.Mesh(
    new THREE.CircleGeometry(0.185, 40),
    new THREE.MeshStandardMaterial({ map: clockFaceTexture(), roughness: 0.55, metalness: 0.05 }),
  );
  dial.position.set(0, hoodY + 0.02, 0.162);
  g.add(dial);

  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.190, 0.012, 10, 36), brassMat);
  bezel.position.set(0, hoodY + 0.02, 0.164);
  g.add(bezel);

  const hourHand = new THREE.Group();
  const hh = box(0.016, 0.098, 0.006, darkMaterial('#241608'), 0, 0.049, 0);
  hourHand.add(hh);
  hourHand.position.set(0, hoodY + 0.02, 0.170);
  g.add(hourHand);

  const minuteHand = new THREE.Group();
  const mh = box(0.011, 0.150, 0.006, darkMaterial('#241608'), 0, 0.075, 0);
  minuteHand.add(mh);
  minuteHand.position.set(0, hoodY + 0.02, 0.175);
  g.add(minuteHand);

  g.add(cyl(0.014, 0.014, 0.012, brassMat, 12, 0, hoodY + 0.02, 0.178)
    .rotateX(Math.PI / 2));

  // Glazed hood door.
  const hoodPane = new THREE.Mesh(
    new THREE.CircleGeometry(0.196, 32),
    glassMaterial('#cfe0e6', 0.13),
  );
  hoodPane.position.set(0, hoodY + 0.02, 0.181);
  hoodPane.renderOrder = 3;
  g.add(hoodPane);

  // State: clock time and chime hook.
  const state = { hours: 9, minutes: 12, chiming: 0, tickPhase: 0 };
  const setTime = (h, m) => { state.hours = h; state.minutes = m; };

  g.userData.update = (dt, t) => {
    // Escapement-style swing: fast through centre, slow at the extremes.
    pivot.rotation.z = Math.sin(t * Math.PI * 2 / 1.6) * 0.13;
    const totalMin = state.hours * 60 + state.minutes;
    minuteHand.rotation.z = -(state.minutes / 60) * Math.PI * 2;
    hourHand.rotation.z = -((totalMin % 720) / 720) * Math.PI * 2;
    if (state.chiming > 0) {
      state.chiming = Math.max(0, state.chiming - dt);
      const shake = Math.sin(t * 60) * 0.002 * state.chiming;
      g.position.x = (g.userData.baseX ?? 0) + shake;
    }
    weights.forEach((w, i) => { w.position.y = trunkY + 0.20 - Math.sin(t * 0.05 + i) * 0.002; });
  };
  g.userData.setTime = setTime;
  g.userData.chime = () => { state.chiming = 2.5; };

  return g;
}

// ---------------------------------------------------------------------------
// Furniture and dressing
// ---------------------------------------------------------------------------

function buildChair({ wood = '#5a3a20', seat = '#7a4a3a' } = {}) {
  const g = new THREE.Group();
  const w = woodMaterial(wood);
  for (const [x, z] of [[0.19, 0.19], [-0.19, 0.19], [0.19, -0.19], [-0.19, -0.19]]) {
    g.add(cyl(0.022, 0.026, 0.44, w, 8, x, 0.22, z));
  }
  g.add(box(0.46, 0.05, 0.46, fabricMaterial(seat), 0, 0.465, 0));
  g.add(box(0.44, 0.52, 0.045, w, 0, 0.75, -0.20));
  for (const y of [0.60, 0.78, 0.96]) g.add(box(0.40, 0.035, 0.05, w, 0, y, -0.20));
  g.userData.anchors = { sit: { position: V3(0, 0.49, 0.02), facing: 0 } };
  return g;
}

function buildArmchair({ fabric = '#5a3444', wood = '#3f2a18' } = {}) {
  const g = new THREE.Group();
  const f = fabricMaterial(fabric);
  g.add(box(0.72, 0.30, 0.70, f, 0, 0.30, 0));
  g.add(box(0.72, 0.60, 0.16, f, 0, 0.72, -0.27));
  g.add(box(0.14, 0.34, 0.70, f, 0.29, 0.60, 0));
  g.add(box(0.14, 0.34, 0.70, f, -0.29, 0.60, 0));
  g.add(box(0.62, 0.10, 0.60, fabricMaterial(fabric, 0.9), 0, 0.50, 0.02));
  for (const [x, z] of [[0.28, 0.28], [-0.28, 0.28], [0.28, -0.28], [-0.28, -0.28]]) {
    g.add(cyl(0.030, 0.034, 0.16, woodMaterial(wood), 8, x, 0.08, z));
  }
  g.userData.anchors = { sit: { position: V3(0, 0.55, 0.04), facing: 0 } };
  return g;
}

function buildTable({ wood = '#4a2f1c', round = false, w = 1.4, d = 0.8, h = 0.76 } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(wood);
  if (round) {
    g.add(cyl(w / 2, w / 2, 0.05, m, 28, 0, h, 0));
    g.add(cyl(0.06, 0.09, h, m, 12, 0, h / 2, 0));
    g.add(cyl(0.26, 0.30, 0.035, m, 20, 0, 0.02, 0));
  } else {
    g.add(box(w, 0.055, d, m, 0, h, 0));
    g.add(box(w - 0.12, 0.09, d - 0.12, woodMaterial(wood, 0.7), 0, h - 0.07, 0));
    const ix = w / 2 - 0.09;
    const iz = d / 2 - 0.09;
    for (const [x, z] of [[ix, iz], [-ix, iz], [ix, -iz], [-ix, -iz]]) {
      g.add(box(0.07, h - 0.02, 0.07, m, x, (h - 0.02) / 2, z));
    }
  }
  g.userData.surfaceHeight = h + 0.03;
  return g;
}

function buildBed({ wood = '#43291a', linen = '#d8cdb8', blanket = '#5a4a6a' } = {}) {
  const g = new THREE.Group();
  const w = woodMaterial(wood);
  g.add(box(1.42, 0.22, 2.02, w, 0, 0.26, 0));
  g.add(box(1.36, 0.20, 1.94, fabricMaterial(linen), 0, 0.46, 0));
  g.add(box(1.38, 0.10, 1.30, fabricMaterial(blanket), 0, 0.58, 0.28));
  g.add(box(0.56, 0.16, 0.34, fabricMaterial('#efe8d8'), -0.34, 0.62, -0.76));
  g.add(box(0.56, 0.16, 0.34, fabricMaterial('#efe8d8'), 0.34, 0.62, -0.76));
  g.add(box(1.48, 0.92, 0.08, w, 0, 0.62, -1.03));
  g.add(box(1.48, 0.46, 0.08, w, 0, 0.40, 1.03));
  return g;
}

function buildBookshelf({ wood = '#3f2a18' } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(wood);
  const W = 0.94; const H = 1.92; const D = 0.30;
  g.add(box(0.05, H, D, m, -W / 2, H / 2, 0));
  g.add(box(0.05, H, D, m, W / 2, H / 2, 0));
  g.add(box(W, 0.04, 0.02, m, 0, H / 2, -D / 2));
  const palette = ['#7a2f28', '#2f4a6a', '#4a5a34', '#6a5424', '#3f2f4a', '#7a5a3a', '#28404a'];
  for (let s = 0; s < 5; s++) {
    const y = 0.10 + s * 0.37;
    g.add(box(W, 0.035, D, m, 0, y, 0));
    let x = -W / 2 + 0.05;
    while (x < W / 2 - 0.08) {
      const bw = 0.022 + Math.random() * 0.030;
      const bh = 0.20 + Math.random() * 0.10;
      const lean = Math.random() < 0.12 ? (Math.random() - 0.5) * 0.3 : 0;
      const b = box(bw, bh, 0.20 + Math.random() * 0.06,
        fabricMaterial(palette[Math.floor(Math.random() * palette.length)], 0.8),
        x + bw / 2, y + 0.018 + bh / 2, 0.02);
      b.rotation.z = lean;
      g.add(b);
      x += bw + 0.004;
    }
  }
  g.add(box(W + 0.06, 0.05, D + 0.04, m, 0, H, 0));
  return g;
}

function buildFireplace({ stone = '#6a6258' } = {}) {
  const g = new THREE.Group();
  const s = woodMaterial(stone, 0.9);
  g.add(box(1.90, 1.55, 0.32, s, 0, 0.775, 0));
  g.add(box(1.02, 0.92, 0.36, darkMaterial('#100c0a'), 0, 0.46, 0.04));
  g.add(box(2.10, 0.10, 0.44, woodMaterial('#3f2a18'), 0, 1.12, 0.06));
  g.add(box(1.90, 0.06, 0.50, s, 0, 0.03, 0.22));

  const emberGroup = new THREE.Group();
  emberGroup.position.set(0, 0.10, 0.02);
  for (let i = 0; i < 7; i++) {
    const log = cyl(0.045, 0.05, 0.42, woodMaterial('#241610', 0.95), 7,
      (Math.random() - 0.5) * 0.5, Math.random() * 0.09, (Math.random() - 0.5) * 0.16);
    log.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    log.rotation.y = (Math.random() - 0.5) * 0.8;
    emberGroup.add(log);
  }
  const fireCore = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), glowMaterial('#ff7a22', 0.5));
  fireCore.scale.set(1.5, 0.8, 0.7);
  fireCore.position.y = 0.10;
  emberGroup.add(fireCore);
  const fireHot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glowMaterial('#ffcf7a', 0.7));
  fireHot.scale.set(1.4, 0.9, 0.6);
  fireHot.position.y = 0.08;
  emberGroup.add(fireHot);
  g.add(emberGroup);

  const light = new THREE.PointLight('#ff9440', 3.4, 8, 2);
  light.position.set(0, 0.42, 0.26);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.005;
  g.add(light);

  g.userData.update = (dt, t) => {
    const f = 0.85 + Math.sin(t * 7.7) * 0.10 + Math.sin(t * 19.3) * 0.06 + Math.sin(t * 3.1) * 0.05;
    fireCore.scale.set(1.5 * f, 0.8 * f, 0.7);
    fireHot.scale.set(1.4 * (2 - f), 0.9 * f, 0.6);
    light.intensity = 2.6 + f * 1.4;
  };
  g.userData.lightSource = light;
  return g;
}

function buildCandle({ wax = '#e8e0cc' } = {}) {
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.045, 0.012, metalMaterial('#9a8a6a', 0.4), 14, 0, 0.006, 0));
  const h = 0.16 + Math.random() * 0.06;
  g.add(cyl(0.017, 0.019, h, fabricMaterial(wax, 0.5), 12, 0, 0.012 + h / 2, 0));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.010, 0.036, 8, 1, true), glowMaterial('#ffcf80', 0.9));
  flame.position.y = 0.012 + h + 0.016;
  g.add(flame);
  const light = new THREE.PointLight('#ffbb70', 0.9, 3.2, 2);
  light.position.y = 0.012 + h + 0.03;
  g.add(light);
  g.userData.update = (dt, t) => {
    const f = 0.85 + Math.sin(t * 13.1) * 0.10 + Math.sin(t * 31.2) * 0.05;
    flame.scale.set(1, f, 1);
    light.intensity = 0.7 + f * 0.5;
  };
  g.userData.lightSource = light;
  return g;
}

function buildChandelier({ brass = '#b8933f' } = {}) {
  const g = new THREE.Group();
  const m = metalMaterial(brass, 0.3);
  g.add(cyl(0.006, 0.006, 0.6, m, 6, 0, 0.3, 0));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.014, 8, 28), m));
  const arms = 6;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    const cx = Math.cos(a) * 0.34;
    const cz = Math.sin(a) * 0.34;
    g.add(cyl(0.012, 0.014, 0.10, m, 8, cx, 0.05, cz));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.038, 8, 1, true), glowMaterial('#ffcf80', 0.85));
    flame.position.set(cx, 0.13, cz);
    g.add(flame);
  }
  const light = new THREE.PointLight('#ffc98a', 2.6, 9, 1.8);
  light.position.y = 0.1;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  g.add(light);
  g.userData.update = (dt, t) => { light.intensity = 2.2 + Math.sin(t * 5.3) * 0.25; };
  g.userData.lightSource = light;
  g.userData.ceilingMounted = true;
  return g;
}

function buildRug({ primary = '#6a3038', secondary = '#c9a24a', w = 2.6, d = 1.8 } = {}) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.PlaneGeometry(w, d), fabricMaterial(primary, 0.98));
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.006;
  base.receiveShadow = true;
  g.add(base);
  const border = new THREE.Mesh(new THREE.RingGeometry(0, 1, 4), fabricMaterial(secondary, 0.98));
  border.visible = false;
  g.add(border);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.28, d - 0.28), fabricMaterial(secondary, 0.98));
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.008;
  g.add(inner);
  const centre = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.46, d - 0.46), fabricMaterial(primary, 0.98));
  centre.rotation.x = -Math.PI / 2;
  centre.position.y = 0.010;
  g.add(centre);
  return g;
}

function buildWardrobe({ wood = '#3a2412' } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(wood);
  g.add(box(1.10, 2.05, 0.58, m, 0, 1.025, 0));
  g.add(box(0.52, 1.70, 0.03, woodMaterial('#2b1a0c'), -0.27, 1.05, 0.295));
  g.add(box(0.52, 1.70, 0.03, woodMaterial('#2b1a0c'), 0.27, 1.05, 0.295));
  g.add(cyl(0.012, 0.012, 0.09, metalMaterial('#9a8244'), 8, -0.04, 1.05, 0.32).rotateZ(Math.PI / 2));
  g.add(cyl(0.012, 0.012, 0.09, metalMaterial('#9a8244'), 8, 0.04, 1.05, 0.32).rotateZ(Math.PI / 2));
  g.add(box(1.20, 0.10, 0.66, m, 0, 2.10, 0));
  return g;
}

function buildPortrait({ frame = '#8a6a2a', w = 0.62, h = 0.82 } = {}) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.05, metalMaterial(frame, 0.5), 0, 0, 0));
  const c = document.createElement('canvas');
  c.width = 128; c.height = 168;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, 168);
  grad.addColorStop(0, '#3a2f24'); grad.addColorStop(1, '#171009');
  x.fillStyle = grad; x.fillRect(0, 0, 128, 168);
  x.fillStyle = 'rgba(190,160,120,0.55)';
  x.beginPath(); x.ellipse(64, 74, 26, 33, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(40,30,22,0.85)';
  x.beginPath(); x.ellipse(64, 140, 46, 44, 0, 0, Math.PI * 2); x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const canvasMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.10, h - 0.10),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
  );
  canvasMesh.position.z = 0.027;
  g.add(canvasMesh);
  g.userData.wallMounted = true;
  return g;
}

function buildTrunk({ wood = '#432a16', strap = '#7a6a4a' } = {}) {
  const g = new THREE.Group();
  g.add(box(0.86, 0.40, 0.48, woodMaterial(wood), 0, 0.20, 0));
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.86, 14, 1, false, 0, Math.PI),
    woodMaterial(wood, 0.5),
  );
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.40;
  lid.castShadow = true;
  g.add(lid);
  for (const x of [-0.28, 0.28]) {
    g.add(box(0.05, 0.42, 0.50, metalMaterial(strap, 0.55), x, 0.20, 0));
  }
  return g;
}

function buildBarrel({ wood = '#5a3f22' } = {}) {
  const g = new THREE.Group();
  const profile = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    profile.push(new THREE.Vector2(0.26 + Math.sin(t * Math.PI) * 0.05, t * 0.82));
  }
  g.add(lathe(profile, woodMaterial(wood), 18));
  for (const y of [0.12, 0.41, 0.70]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.012, 6, 20), metalMaterial('#4a4038', 0.6));
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    g.add(hoop);
  }
  return g;
}

function buildCup({ colour = '#d8d0c0' } = {}) {
  const g = new THREE.Group();
  g.add(lathe([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.028, 0), new THREE.Vector2(0.026, 0.008),
    new THREE.Vector2(0.034, 0.055), new THREE.Vector2(0.036, 0.078),
    new THREE.Vector2(0.032, 0.078), new THREE.Vector2(0.030, 0.010),
  ], fabricMaterial(colour, 0.35), 16));
  return g;
}

function buildBottle({ glass = '#3a5a3a' } = {}) {
  const g = new THREE.Group();
  g.add(lathe([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.038, 0), new THREE.Vector2(0.040, 0.012),
    new THREE.Vector2(0.040, 0.13), new THREE.Vector2(0.030, 0.17),
    new THREE.Vector2(0.015, 0.20), new THREE.Vector2(0.015, 0.27),
    new THREE.Vector2(0.018, 0.28), new THREE.Vector2(0, 0.285),
  ], glassMaterial(glass, 0.55), 16));
  return g;
}

function buildStool({ wood = '#5a3a20' } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(wood);
  g.add(cyl(0.19, 0.20, 0.045, m, 16, 0, 0.44, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.018, 0.022, 0.44, m, 8, Math.cos(a) * 0.14, 0.22, Math.sin(a) * 0.14);
    leg.rotation.z = -Math.cos(a) * 0.10;
    leg.rotation.x = Math.sin(a) * 0.10;
    g.add(leg);
  }
  g.userData.anchors = { sit: { position: V3(0, 0.47, 0), facing: 0 } };
  return g;
}

function buildDoor({ wood = '#3a2412' } = {}) {
  const g = new THREE.Group();
  g.add(box(1.06, 2.22, 0.10, woodMaterial('#2b1a0c'), 0, 1.11, 0));
  const leaf = new THREE.Group();
  leaf.position.set(-0.45, 0, 0);
  const panel = box(0.90, 2.10, 0.055, woodMaterial(wood), 0.45, 1.05, 0);
  leaf.add(panel);
  leaf.add(box(0.32, 0.72, 0.02, woodMaterial('#2b1a0c'), 0.45, 1.52, 0.036));
  leaf.add(box(0.32, 0.72, 0.02, woodMaterial('#2b1a0c'), 0.45, 0.66, 0.036));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), metalMaterial('#9a7a3a', 0.35));
  knob.position.set(0.80, 1.05, 0.06);
  leaf.add(knob);
  g.add(leaf);
  g.userData.door = leaf;
  g.userData.open = (amount = 1) => { leaf.rotation.y = -amount * Math.PI * 0.55; };
  return g;
}

function buildWindow({ frame = '#3a2412', night = true } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(frame);
  g.add(box(1.24, 1.58, 0.12, m, 0, 0, 0));
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 1.36),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(night ? '#16243a' : '#bcd6ea'),
      roughness: 0.1,
      metalness: 0.2,
      emissive: new THREE.Color(night ? '#0d1830' : '#7fa8d0'),
      emissiveIntensity: night ? 0.5 : 1.1,
    }),
  );
  pane.position.z = 0.02;
  g.add(pane);
  g.add(box(0.05, 1.36, 0.10, m, 0, 0, 0.03));
  g.add(box(1.02, 0.05, 0.10, m, 0, 0, 0.03));
  g.userData.wallMounted = true;
  return g;
}

function buildTree({ trunk = '#3f2c1c', leaf = '#2f4a26' } = {}) {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.30, 3.0, woodMaterial(trunk, 0.9), 10, 0, 1.5, 0));
  for (let i = 0; i < 5; i++) {
    const canopy = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9 + Math.random() * 0.5, 1),
      fabricMaterial(leaf, 0.95),
    );
    canopy.position.set(
      (Math.random() - 0.5) * 1.5,
      2.9 + Math.random() * 1.1,
      (Math.random() - 0.5) * 1.5,
    );
    canopy.castShadow = true;
    g.add(canopy);
  }
  return g;
}

function buildWell({ stone = '#6a6258' } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(stone, 0.92);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.76, 0.72, 20, 1, true), m);
  ring.position.y = 0.36;
  ring.castShadow = true;
  ring.receiveShadow = true;
  g.add(ring);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.06, 8, 24), m).translateY(0.72).rotateX(Math.PI / 2));
  for (const x of [-0.62, 0.62]) g.add(box(0.10, 1.30, 0.10, woodMaterial('#4a3320'), x, 1.37, 0));
  g.add(box(1.60, 0.10, 0.70, woodMaterial('#4a3320'), 0, 2.05, 0));
  g.add(cyl(0.07, 0.07, 1.10, woodMaterial('#4a3320'), 10, 0, 1.90, 0).rotateZ(Math.PI / 2));
  return g;
}

function buildCrate({ wood = '#6a4a28' } = {}) {
  const g = new THREE.Group();
  const s = 0.52;
  g.add(box(s, s, s, woodMaterial(wood), 0, s / 2, 0));
  for (const y of [0.10, s - 0.10]) {
    g.add(box(s + 0.02, 0.05, s + 0.02, woodMaterial('#4a3018'), 0, y, 0));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * name -> { build, size [w,h,d], category, tags }
 * `size` is the footprint used for placement and collision avoidance.
 */
export const PROPS = {
  oilLamp: { build: buildOilLamp, size: [0.13, 0.37, 0.13], category: 'light', tags: ['table', 'hero'] },
  grandfatherClock: { build: buildGrandfatherClock, size: [0.58, 2.20, 0.36], category: 'furniture', tags: ['wall', 'hero'] },
  candle: { build: buildCandle, size: [0.09, 0.24, 0.09], category: 'light', tags: ['table'] },
  chandelier: { build: buildChandelier, size: [0.70, 0.70, 0.70], category: 'light', tags: ['ceiling'] },
  fireplace: { build: buildFireplace, size: [2.10, 1.55, 0.50], category: 'light', tags: ['wall'] },
  chair: { build: buildChair, size: [0.50, 1.00, 0.50], category: 'seat', tags: ['floor'] },
  stool: { build: buildStool, size: [0.40, 0.48, 0.40], category: 'seat', tags: ['floor'] },
  armchair: { build: buildArmchair, size: [0.78, 0.95, 0.74], category: 'seat', tags: ['floor'] },
  table: { build: buildTable, size: [1.40, 0.80, 0.80], category: 'surface', tags: ['floor'] },
  roundTable: { build: (o) => buildTable({ ...o, round: true, w: 0.95 }), size: [0.95, 0.80, 0.95], category: 'surface', tags: ['floor'] },
  bed: { build: buildBed, size: [1.50, 1.10, 2.10], category: 'furniture', tags: ['wall'] },
  bookshelf: { build: buildBookshelf, size: [1.00, 1.95, 0.32], category: 'furniture', tags: ['wall'] },
  wardrobe: { build: buildWardrobe, size: [1.20, 2.15, 0.60], category: 'furniture', tags: ['wall'] },
  trunk: { build: buildTrunk, size: [0.90, 0.62, 0.50], category: 'furniture', tags: ['floor', 'wall'] },
  barrel: { build: buildBarrel, size: [0.60, 0.82, 0.60], category: 'clutter', tags: ['floor'] },
  crate: { build: buildCrate, size: [0.54, 0.54, 0.54], category: 'clutter', tags: ['floor'] },
  rug: { build: buildRug, size: [2.60, 0.01, 1.80], category: 'floor', tags: ['floor'] },
  portrait: { build: buildPortrait, size: [0.62, 0.82, 0.06], category: 'decor', tags: ['wall'] },
  window: { build: buildWindow, size: [1.24, 1.58, 0.14], category: 'decor', tags: ['wall'] },
  door: { build: buildDoor, size: [1.06, 2.22, 0.12], category: 'structure', tags: ['wall'] },
  cup: { build: buildCup, size: [0.08, 0.08, 0.08], category: 'clutter', tags: ['table'] },
  bottle: { build: buildBottle, size: [0.09, 0.29, 0.09], category: 'clutter', tags: ['table'] },
  tree: { build: buildTree, size: [2.40, 4.20, 2.40], category: 'nature', tags: ['exterior'] },
  well: { build: buildWell, size: [1.70, 2.10, 0.80], category: 'nature', tags: ['exterior'] },
};

export const PROP_NAMES = Object.keys(PROPS);

/**
 * Instantiate a prop by name.
 * @returns {THREE.Group|null} group carrying `userData.propName` and metadata
 */
export function createProp(name, opts = {}) {
  const def = PROPS[name];
  if (!def) return null;
  const group = def.build(opts);
  group.userData.propName = name;
  group.userData.size = def.size;
  group.userData.category = def.category;
  group.userData.tags = def.tags;
  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; }
  });
  return group;
}

/** Loose keyword -> prop name, so scripts can call for things in prose. */
const PROP_KEYWORDS = {
  oilLamp: ['oil lamp', 'lamp', 'lantern', 'oil-lamp'],
  grandfatherClock: ['grandfather clock', 'longcase clock', 'clock', 'grandfather'],
  candle: ['candle', 'candles', 'taper'],
  fireplace: ['fireplace', 'hearth', 'fire place', 'mantel', 'mantelpiece'],
  chair: ['chair', 'seat'],
  armchair: ['armchair', 'wing chair'],
  stool: ['stool'],
  table: ['table', 'desk', 'writing desk'],
  roundTable: ['round table', 'tea table'],
  bed: ['bed', 'bedstead'],
  bookshelf: ['bookshelf', 'bookcase', 'shelves', 'books'],
  wardrobe: ['wardrobe', 'armoire', 'cupboard'],
  trunk: ['trunk', 'chest'],
  barrel: ['barrel', 'cask'],
  crate: ['crate', 'box'],
  rug: ['rug', 'carpet'],
  portrait: ['portrait', 'painting', 'picture'],
  window: ['window', 'casement'],
  door: ['door', 'doorway'],
  cup: ['cup', 'teacup', 'mug'],
  bottle: ['bottle', 'flask', 'decanter'],
  tree: ['tree', 'oak', 'birch'],
  well: ['well'],
  chandelier: ['chandelier'],
};

/** Find props a line of prose is asking for. */
export function propsMentioned(text) {
  const low = ` ${String(text).toLowerCase()} `;
  const found = [];
  for (const [name, words] of Object.entries(PROP_KEYWORDS)) {
    if (words.some((w) => low.includes(` ${w} `) || low.includes(`${w}s `) || low.includes(`${w},`) || low.includes(`${w}.`))) {
      found.push(name);
    }
  }
  return found;
}
