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
 *
 * ---------------------------------------------------------------------------
 * The scene file's `options`
 * ---------------------------------------------------------------------------
 *
 * A prop entry may carry `options: { colour, size }`, and those two keys are
 * the whole vocabulary — scenefile.js rejects any third. Which types honour
 * which key is declared per entry in the registry below, because the film
 * decides it: ph_assets forwards an option only to a builder that declares a
 * parameter of that name, so `colour` on a type Blender cannot tint renders
 * grey in the film. A preview that tinted it anyway would be showing the
 * author something the finished film will not contain, which is worse than not
 * offering the feature — the whole reason to have a preview is that it agrees.
 * Hence `options: []` on drone, rifle and tree: ph_assets builds all three with
 * fixed or seed-jittered liveries, so neither renderer tints them.
 *
 * `colour` is a "#rrggbb" sRGB string and names ONE surface, the type's primary
 * one — a barrel's staves, not its iron hoops; a portrait's frame, not the
 * painting inside it. Anything with a second material keeps it: recolouring a
 * whole object to a single albedo is how a prop stops reading as an object and
 * starts reading as a silhouette. The per-type list is in the registry.
 *
 * `size` is [width, height, depth] in three.js metres and is honoured by the
 * three generic primitives ONLY. This follows ph_assets, and the reasoning is
 * worth repeating because it looks like a gap: a named type's size is metadata
 * that both renderers reason *with*. validateScene warns that a wardrobe is too
 * big to carry, and blocking is solved against a 1.4 m table, from the `size`
 * field below. A scene file that resized the cup would leave both of those
 * facts wrong and nothing would say so. A scene that genuinely wants a
 * three-metre box wants `slab`.
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

function buildOilLamp({ colour, brass = colour ?? '#b8873f', oil = '#c8862c' } = {}) {
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

  const light = new THREE.PointLight('#ffb765', 6.5, 11, 1.35);
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
    light.intensity = 5.4 + f * 2.2;
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

function buildGrandfatherClock({ colour, wood = colour ?? '#4a2c18', brass = '#c9a24a' } = {}) {
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

function buildChair({ colour, wood = colour ?? '#5a3a20', seat = '#7a4a3a' } = {}) {
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

function buildArmchair({ colour, fabric = colour ?? '#5a3444', wood = '#3f2a18' } = {}) {
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

function buildTable({ colour, wood = colour ?? '#4a2f1c', round = false, w = 1.4, d = 0.8, h = 0.76 } = {}) {
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

function buildBed({ colour, blanket = colour ?? '#5a4a6a', wood = '#43291a', linen = '#d8cdb8' } = {}) {
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

function buildBookshelf({ colour, wood = colour ?? '#3f2a18' } = {}) {
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

function buildFireplace({ colour, stone = colour ?? '#6a6258' } = {}) {
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

  const light = new THREE.PointLight('#ff9440', 7.5, 12, 1.4);
  light.position.set(0, 0.42, 0.26);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.005;
  g.add(light);

  g.userData.update = (dt, t) => {
    const f = 0.85 + Math.sin(t * 7.7) * 0.10 + Math.sin(t * 19.3) * 0.06 + Math.sin(t * 3.1) * 0.05;
    fireCore.scale.set(1.5 * f, 0.8 * f, 0.7);
    fireHot.scale.set(1.4 * (2 - f), 0.9 * f, 0.6);
    light.intensity = 6.2 + f * 2.6;
  };
  g.userData.lightSource = light;
  return g;
}

function buildCandle({ colour, wax = colour ?? '#e8e0cc' } = {}) {
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.045, 0.012, metalMaterial('#9a8a6a', 0.4), 14, 0, 0.006, 0));
  const h = 0.16 + Math.random() * 0.06;
  g.add(cyl(0.017, 0.019, h, fabricMaterial(wax, 0.5), 12, 0, 0.012 + h / 2, 0));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.010, 0.036, 8, 1, true), glowMaterial('#ffcf80', 0.9));
  flame.position.y = 0.012 + h + 0.016;
  g.add(flame);
  const light = new THREE.PointLight('#ffbb70', 2.2, 5.0, 1.5);
  light.position.y = 0.012 + h + 0.03;
  g.add(light);
  g.userData.update = (dt, t) => {
    const f = 0.85 + Math.sin(t * 13.1) * 0.10 + Math.sin(t * 31.2) * 0.05;
    flame.scale.set(1, f, 1);
    light.intensity = 1.8 + f * 0.9;
  };
  g.userData.lightSource = light;
  return g;
}

function buildChandelier({ colour, brass = colour ?? '#b8933f' } = {}) {
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
  const light = new THREE.PointLight('#ffc98a', 6.0, 14, 1.35);
  light.position.y = 0.1;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  g.add(light);
  g.userData.update = (dt, t) => { light.intensity = 5.6 + Math.sin(t * 5.3) * 0.5; };
  g.userData.lightSource = light;
  g.userData.ceilingMounted = true;
  return g;
}

function buildRug({ colour, primary = colour ?? '#6a3038', secondary = '#c9a24a', w = 2.6, d = 1.8 } = {}) {
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

function buildWardrobe({ colour, wood = colour ?? '#3a2412' } = {}) {
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

function buildPortrait({ colour, frame = colour ?? '#8a6a2a', w = 0.62, h = 0.82 } = {}) {
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

function buildTrunk({ colour, wood = colour ?? '#432a16', strap = '#7a6a4a' } = {}) {
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

function buildBarrel({ colour, wood = colour ?? '#5a3f22' } = {}) {
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

function buildBottle({ colour, glass = colour ?? '#3a5a3a' } = {}) {
  const g = new THREE.Group();
  g.add(lathe([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.038, 0), new THREE.Vector2(0.040, 0.012),
    new THREE.Vector2(0.040, 0.13), new THREE.Vector2(0.030, 0.17),
    new THREE.Vector2(0.015, 0.20), new THREE.Vector2(0.015, 0.27),
    new THREE.Vector2(0.018, 0.28), new THREE.Vector2(0, 0.285),
  ], glassMaterial(glass, 0.55), 16));
  return g;
}

function buildStool({ colour, wood = colour ?? '#5a3a20' } = {}) {
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

function buildDoor({ colour, wood = colour ?? '#3a2412' } = {}) {
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

function buildWindow({ colour, frame = colour ?? '#3a2412', night = true } = {}) {
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

function buildTree({ trunk = '#3f2c1c', leaf = '#2f4a26', fruit = null, fruitCount = 7 } = {}) {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.30, 3.0, woodMaterial(trunk, 0.9), 10, 0, 1.5, 0));
  const canopies = [];
  for (let i = 0; i < 5; i++) {
    const radius = 0.9 + Math.random() * 0.5;
    const canopy = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, 1),
      fabricMaterial(leaf, 0.95),
    );
    canopy.position.set(
      (Math.random() - 0.5) * 1.5,
      2.9 + Math.random() * 1.1,
      (Math.random() - 0.5) * 1.5,
    );
    canopy.castShadow = true;
    g.add(canopy);
    canopies.push({ mesh: canopy, radius });
  }
  // Fruit dots on the canopies' lower surfaces are what make an orchard read
  // as an orchard instead of random woodland.
  if (fruit) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(fruit), roughness: 0.38 });
    for (let i = 0; i < fruitCount; i++) {
      const { mesh, radius } = canopies[i % canopies.length];
      const a = Math.random() * Math.PI * 2;
      const drop = 0.45 + Math.random() * 0.4; // below the canopy's equator
      const dot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 1), mat);
      dot.position.set(
        mesh.position.x + Math.cos(a) * radius * 0.72,
        mesh.position.y - radius * drop,
        mesh.position.z + Math.sin(a) * radius * 0.72,
      );
      dot.castShadow = true;
      g.add(dot);
    }
  }
  return g;
}

function buildWell({ colour, stone = colour ?? '#6a6258' } = {}) {
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

function buildCrate({ colour, wood = colour ?? '#6a4a28' } = {}) {
  const g = new THREE.Group();
  const s = 0.52;
  g.add(box(s, s, s, woodMaterial(wood), 0, s / 2, 0));
  for (const y of [0.10, s - 0.10]) {
    g.add(box(s + 0.02, 0.05, s + 0.02, woodMaterial('#4a3018'), 0, y, 0));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Handheld and exterior props
// ---------------------------------------------------------------------------

/**
 * An apple sized for a close insert: red body, offset stem, single leaf — the
 * three cues that make a 4 cm sphere read as fruit rather than a ball.
 */
function buildApple({ colour, skin = colour ?? '#a8231f', leaf = '#3f6a2a' } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.04, 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(skin), roughness: 0.32 }),
  );
  body.scale.y = 0.92;
  body.position.y = 0.037;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const stalk = cyl(0.004, 0.005, 0.03, woodMaterial('#4a3320', 0.8), 6, 0, 0.078, 0);
  stalk.rotation.z = 0.18;
  g.add(stalk);
  const leafMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.032, 0.014),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(leaf), roughness: 0.8, side: THREE.DoubleSide,
    }),
  );
  leafMesh.position.set(0.02, 0.085, 0);
  leafMesh.rotation.set(-0.5, 0.3, 0.5);
  g.add(leafMesh);
  g.userData.hero = true;
  return g;
}

function buildBasket({ colour, weave = colour ?? '#8a6a3c', apples = 0 } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(weave, 0.85);
  // Open flared body: DoubleSide so the camera can see inside.
  const profile = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    profile.push(new THREE.Vector2(0.13 + t * 0.07, t * 0.20));
  }
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 18),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(weave), roughness: 0.85, side: THREE.DoubleSide,
    }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  g.add(cyl(0.125, 0.13, 0.02, m, 18, 0, 0.01, 0));
  // Weave hoops sell the wicker without modelling any.
  for (const [y, r] of [[0.06, 0.152], [0.12, 0.173], [0.185, 0.196]]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 22), m);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    hoop.castShadow = true;
    g.add(hoop);
  }
  // Carry handle arching over the top.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.013, 8, 22, Math.PI), m);
  handle.position.y = 0.20;
  handle.castShadow = true;
  g.add(handle);
  for (let i = 0; i < apples; i++) {
    const a = buildApple();
    const ang = (i / Math.max(1, apples)) * Math.PI * 2 + 0.7;
    a.position.set(Math.cos(ang) * 0.07, 0.16, Math.sin(ang) * 0.07);
    a.rotation.y = ang * 3;
    g.add(a);
  }
  return g;
}

/** One fence section, built along local +X so runs and rings can rotate it. */
function buildFence({ colour, wood = colour ?? '#6a5238' } = {}) {
  const g = new THREE.Group();
  const m = woodMaterial(wood, 0.85);
  for (const y of [0.52, 0.86]) g.add(box(2.4, 0.07, 0.05, m, 0, y, 0));
  for (const x of [-1.1, 0, 1.1]) g.add(box(0.10, 1.05, 0.10, m, x, 0.525, 0));
  return g;
}

/**
 * A carry-lantern: caged candle with a ring on top, sized for a hand.
 * Distinct from the tabletop oil lamp — this one is meant to travel.
 */
function buildLantern({ colour, metal = colour ?? '#4a4038' } = {}) {
  const g = new THREE.Group();
  const m = metalMaterial(metal, 0.5);
  g.add(cyl(0.055, 0.06, 0.02, m, 10, 0, 0.01, 0));
  g.add(cyl(0.03, 0.055, 0.035, m, 10, 0, 0.21, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(box(0.012, 0.17, 0.012, m, Math.cos(a) * 0.045, 0.105, Math.sin(a) * 0.045));
  }
  const pane = cyl(0.043, 0.048, 0.165, glassMaterial('#f2ecd8', 0.22), 10, 0, 0.105, 0);
  pane.castShadow = false;
  g.add(pane);
  g.add(cyl(0.012, 0.013, 0.05, fabricMaterial('#e8e0cc', 0.5), 8, 0, 0.045, 0));
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.009, 0.03, 8, 1, true),
    glowMaterial('#ffcf80', 0.9),
  );
  flame.position.y = 0.085;
  g.add(flame);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 6, 16), m);
  ring.position.y = 0.256;
  g.add(ring);
  const light = new THREE.PointLight('#ffbb70', 2.6, 7, 1.5);
  light.position.y = 0.10;
  g.add(light);
  g.userData.update = (dt, t) => {
    const f = 0.85 + Math.sin(t * 12.3) * 0.09 + Math.sin(t * 29.1) * 0.05;
    flame.scale.set(1, f, 1);
    light.intensity = 2.1 + f * 0.9;
  };
  g.userData.lightSource = light;
  g.userData.hero = true;
  return g;
}

// ---------------------------------------------------------------------------
// Generic primitives
//
// A board, a post and a stone: the three shapes ph_assets found 79.5% of the
// set dressing in three screenplays could be built from. They are the only
// types either renderer lets a scene file resize, so they are also the answer
// whenever a script wants a box that is not one of the named types — a scene
// asking for a three-metre crate wants a slab.
//
// Defaults are ph_assets' own, converted from its linear albedos: a slab left
// untinted is #423f38 there and here. That is the point of having them.
//
// One divergence, and it is the browser's: ph_assets seeds each of these off
// the prop's id and takes it a few degrees off plumb, because nothing a person
// put down is vertical. `createProp` is never told the id, so the preview
// builds them true. It reads as slightly tidier dressing, not as a different
// prop, and closing it means widening the build signature to carry a seed.
// ---------------------------------------------------------------------------

/**
 * materials.js has no neutral dielectric factory. `woodMaterial` is a
 * MeshStandardMaterial with a roughness knob and nothing wood-specific in it,
 * so it is the one to borrow — and the alias exists so the three call sites
 * below do not read as a claim that a headstone is made of wood.
 */
const dressingMaterial = (colour, rough) => woodMaterial(colour, rough);

// The three builders below take their default extents from their own registry
// entries rather than from constants of their own. The registry `size` is what
// the validator reasons with and what blocking is solved against, so an unsized
// primitive that measured anything else would be a prop the rest of the system
// has the wrong dimensions for. Reading it at build time is safe: nothing calls
// a builder during module evaluation.

/**
 * A flat rectangular mass: a board, a panel, a lid, a step, a headstone.
 *
 * The grip is written onto the object rather than into the registry, because
 * the registry entry describes the *catalogue* prop and this one has been
 * resized. A 2 m plank held at the offset authored for a 0.20 m board hangs
 * off the fingertips.
 */
function buildSlab({ colour = '#423f38', size } = {}) {
  const g = new THREE.Group();
  const [w, h, d] = size || PROPS.slab.size;
  g.add(box(w, h, d, dressingMaterial(colour, 0.58), 0, h / 2, 0));
  g.userData.hold = { offset: [0, -h * 0.5, 0.03] };
  return g;
}

/** An upright cylinder: a post, a pipe, a bollard, a rolled carpet. */
function buildRod({ colour = '#403b34', size } = {}) {
  const g = new THREE.Group();
  const [w, h, d] = size || PROPS.rod.size;
  // ph_assets tapers each rod by a seeded 0.86–1.0, because a prism of exactly
  // constant radius is a manufacturing achievement and a row of identical
  // posts reads as one post instanced eight times. With no seed here, the
  // middle of that range at least keeps a single post from reading as pipe.
  const shaft = cyl(w * 0.5 * 0.93, w * 0.5, h, dressingMaterial(colour, 0.55), 20, 0, h / 2, 0);
  // An elliptical footprint is width and depth disagreeing; three.js cylinders
  // are circular, so the depth is taken out of the mesh's scale.
  shaft.scale.z = d / w;
  g.add(shaft);
  // Held down the shaft, not in the middle: a torch or a broom balanced at its
  // centre reads as a weightless prop.
  g.userData.hold = { offset: [0, -h * 0.36, 0.03] };
  return g;
}

/** A rounded mass: a stone, a pot, a fruit, a buoy, a snowball. */
function buildOrb({ colour = '#3e3d3a', size } = {}) {
  const g = new THREE.Group();
  const [w, h, d] = size || PROPS.orb.size;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), dressingMaterial(colour, 0.52));
  m.scale.set(w, h, d);
  // Sunk a fiftieth of its height, as ph_assets does: a sphere resting on a
  // mathematical tangent point casts a contact shadow the size of a full stop
  // and reads as hovering.
  m.position.y = h * 0.48;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  g.userData.hold = { offset: [0, -h * 0.48, 0.03] };
  return g;
}

// ---------------------------------------------------------------------------
// Beach dressing — the three types the film could build and the preview could not
//
// ph_assets has built a ball, a bucket and a parasol since the beach scene was
// written, and nothing here answered to those names. The cost was not that the
// preview looked emptier than the film: it was that scenes/beach-night.mjs
// points a shot at `nearPail` and gives another `secondary: 'nearShade'`, and
// with no object on the stage to resolve either name the solver framed the
// ground and framed a single. Two of that scene's four cameras sat 2.3 m and
// 7.4 m from where the film put them.
//
// The dimensions below are ph_assets' own, measured rather than read off its
// source: `ob.dimensions` over seeds 0-23, median. Its meshes are seeded, so
// the extents are emergent — a blob's amplitude, a scalloped canopy, a rolled
// lip and a handle arc — and the constants in the Python are the *inputs* to
// those, not the answer. The registry `size` is what the validator warns from
// and what blocking is solved against, so it has to be the answer.
//
// None of the three takes `colour`: make_ball, make_bucket and make_parasol
// pick their hue off the seed and declare no colour parameter, so the film
// cannot be told one. Offering it here would tint the preview and not the
// film, which is the divergence this file exists to avoid. The defaults are
// each builder's first seeded choice, converted from its linear albedo.
//
// Hence the empty `({} = {})` on all three. It is not decoration:
// tools/vocabulary.mjs reads each builder's destructuring pattern and checks it
// against the `options` the registry advertises, so a builder with no options
// object at all cannot be checked and the generator refuses to guess.
// ---------------------------------------------------------------------------

/**
 * Stack horizontal rings into a surface, each ring's radius free to ripple
 * with angle.
 *
 * `lathe()` covers every profile that is a circle, which is why this is the
 * only place in the file that needs its own geometry: the parasol's canopy is
 * scalloped, and a lobed ring is not a circle. Mirrors ph_assets' `_ring` and
 * `_loft`, including the closing seam and the cap over the first ring.
 *
 * @param {{y: number, radius: number, lobes?: (a: number) => number}[]} rings
 * @param {number} segments vertices per ring
 */
function lobedLoft(rings, segments) {
  const pos = [];
  const ring = (r) => {
    const out = [];
    for (let i = 0; i < segments; i += 1) {
      const a = (Math.PI * 2 * i) / segments;
      const k = r.lobes ? r.lobes(a) : 1;
      out.push(V3(Math.cos(a) * r.radius * k, r.y, Math.sin(a) * r.radius * k));
    }
    return out;
  };
  const built = rings.map(ring);
  const push = (v) => pos.push(v.x, v.y, v.z);
  for (let b = 0; b < built.length - 1; b += 1) {
    const lower = built[b];
    const upper = built[b + 1];
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      push(lower[i]); push(upper[i]); push(upper[j]);
      push(lower[i]); push(upper[j]); push(lower[j]);
    }
  }
  // Cap the first ring. On the parasol that is the 28 mm hub, which is a
  // rounding error in the silhouette and a hole in the shading without it.
  const cap = built[0];
  const hub = V3(0, cap[0].y, 0);
  for (let i = 0; i < segments; i += 1) {
    push(hub); push(cap[(i + 1) % segments]); push(cap[i]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * A beach ball, settled a centimetre into the sand.
 *
 * Banded, and the bands are the point: a single-coloured sphere in a
 * background does not read as an object at all, it reads as a bubble or a hole
 * in the mesh, because nothing outdoors is a uniform circle. ph_assets bands
 * it by latitude and so does this, from the same alternation.
 */
function buildBall({} = {}) {
  const g = new THREE.Group();
  const radius = 0.17;
  const bands = 6;
  // Latitude bands as ph_assets assigns them: `int((z + 1) * 3) % 2` over the
  // unit sphere, which is six equal slices of the vertical axis. A sphere
  // sliced by phi gives the same figure with geometry instead of per-face
  // material indices, which three.js has no cheap equivalent of.
  const shell = [dressingMaterial('#ce5955', 0.30), dressingMaterial('#dfddd7', 0.30)];
  for (let i = 0; i < bands; i += 1) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 4, 0, Math.PI * 2,
        (Math.PI * i) / bands, Math.PI / bands),
      shell[i % 2],
    );
    // Sunk to the depth ph_assets sinks it (centre at 0.94 of the radius): a
    // sphere resting on a mathematical tangent point casts a contact shadow
    // the size of a full stop and reads as hovering.
    m.position.y = radius * 0.94;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * A child's sand bucket: a tapered open cylinder with a rolled lip and a
 * handle.
 *
 * Open at the top, which is the whole reason it is not a cone — a solid lump
 * this size reads as a rock, and the dark ellipse of the opening is the only
 * cue that says "container".
 */
function buildBucket({} = {}) {
  const g = new THREE.Group();
  const height = 0.20;
  const base = 0.085;
  const mouth = 0.115;
  const body = dressingMaterial('#d46f45', 0.34);

  // Open both ends so the inside is visible, and doubled back on itself for
  // the rolled lip: an open cylinder is a zero-thickness edge at the rim,
  // which catches the key light as a bright wire.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(mouth, base, height, 20, 1, true), body,
  );
  wall.position.y = height / 2;
  wall.material.side = THREE.DoubleSide;
  wall.castShadow = true;
  wall.receiveShadow = true;
  g.add(wall);
  g.add(cyl(mouth * 0.9, mouth, 0.012, body, 20, 0, height - 0.006, 0));
  // Floor, so the bucket is not a tube seen from above.
  g.add(cyl(base, base, 0.008, body, 20, 0, 0.004, 0));

  // Handle: a thin arc from rim to rim, which is what takes the silhouette
  // from "cup" to "bucket" at any distance worth putting one in frame.
  const arc = [];
  for (let i = 0; i <= 9; i += 1) {
    const a = (Math.PI * i) / 9;
    arc.push(V3(Math.cos(a) * mouth * 0.98, height + Math.sin(a) * mouth * 0.55, 0));
  }
  const handle = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 12, 0.006, 6, false), body,
  );
  handle.castShadow = true;
  g.add(handle);
  return g;
}

/**
 * A beach parasol, planted at a lean.
 *
 * The lean is not decoration. A vertical pole with a symmetric disc on top is
 * the most obviously procedural shape it is possible to put in a frame, and
 * ph_assets tilts every one of them four to eight degrees off plumb for that
 * reason. The preview leans them by a fixed six degrees rather than a seeded
 * angle, because `createProp` is never told the prop's id and so has nothing
 * to seed from — the same gap the primitives' lean has. A row of parasols
 * therefore leans as one here and individually in the film; it reads as
 * tidier dressing, not as a different object.
 */
function buildParasol({} = {}) {
  const g = new THREE.Group();
  const top = 1.95;
  const span = 0.92;
  const canopy = dressingMaterial('#cb695d', 0.62);
  const pole = dressingMaterial('#524b3e', 0.55);

  // Driven into the sand rather than standing on it: the pole starts below
  // zero, which is also where the measured height of 2.01 m comes from.
  g.add(cyl(0.016, 0.020, top + 0.06, pole, 8, 0, (top - 0.06) / 2, 0));

  // Domed AND scalloped, which is why this is lofted rather than lathed: a
  // lathe can only make a circle, and ph_assets' own note is that a smooth
  // cone reads as a lampshade. The eight lobes also account for the difference
  // between the 1.84 m a plain disc of this span measures and the 1.91 m the
  // film measures — the rim swings +-7%, so the registry's figure is the
  // scalloped one and a circular rim would be 3.5% under it.
  const scallop = (depth) => (a) => 1 + depth * Math.cos(a * 8);
  const shade = new THREE.Mesh(lobedLoft([
    { y: top, radius: 0.028 },
    { y: top - 0.14, radius: span * 0.62, lobes: scallop(0.05) },
    { y: top - 0.30, radius: span, lobes: scallop(0.07) },
  ], 24), canopy);
  shade.material.side = THREE.DoubleSide;
  shade.castShadow = true;
  shade.receiveShadow = true;
  g.add(shade);

  g.rotation.z = THREE.MathUtils.degToRad(6);
  return g;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Drone
// ---------------------------------------------------------------------------

/**
 * A quadrotor. Reads as menacing mostly through the sensor eye and the way it
 * holds station — a dead-still hover with a twitchy scan beats any amount of
 * greebling at the distance drones are actually shot from.
 */
function buildDrone({ shell = '#33383f', accent = '#ff3b30' } = {}) {
  const g = new THREE.Group();
  const body = metalMaterial(shell, 0.5);
  const dark = darkMaterial('#16181c');

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), body);
  core.scale.set(1.55, 0.60, 1.15);
  core.castShadow = true;
  g.add(core);

  // Canopy: a darker upper shell gives the silhouette a "front".
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  canopy.scale.set(1.35, 0.75, 1.0);
  canopy.position.set(0, 0.035, 0.02);
  g.add(canopy);

  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const ax = Math.cos(a) * 0.24;
    const az = Math.sin(a) * 0.24;

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.020, 0.20, 8), body);
    arm.position.set(ax * 0.55, 0.004, az * 0.55);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = -a;
    arm.castShadow = true;
    g.add(arm);

    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.05, 10), body);
    pod.position.set(ax, 0.012, az);
    g.add(pod);

    // Rotor disc: at speed a real blade is a translucent smear, so model that
    // rather than blades that would strobe against the frame rate.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.115, 20),
      new THREE.MeshBasicMaterial({
        color: '#8fa0b4', transparent: true, opacity: 0.20,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(ax, 0.042, az);
    g.add(disc);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.005, 0.022), dark);
    blade.position.set(ax, 0.042, az);
    g.add(blade);
    rotors.push({ blade, disc, dir: i % 2 ? 1 : -1 });
  }

  // Gimbal and sensor eye.
  const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), dark);
  gimbal.position.set(0, -0.055, 0.045);
  g.add(gimbal);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), glowMaterial(accent, 0.95));
  eye.position.set(0, -0.058, 0.092);
  g.add(eye);

  const eyeLight = new THREE.PointLight(accent, 1.6, 3.2, 2);
  eyeLight.position.set(0, -0.06, 0.13);
  g.add(eyeLight);

  // Navigation strobes.
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), glowMaterial('#7fe8a0', 0.9));
  strobe.position.set(0, 0.05, -0.14);
  g.add(strobe);

  const home = { y: 0 };
  g.userData.update = (dt, t) => {
    for (const r of rotors) {
      r.blade.rotation.y += dt * 48 * r.dir;
      r.disc.rotation.y += dt * 9 * r.dir;
    }
    // Station-keeping: a slow bob with a faster micro-correction on top.
    g.position.y = home.y + Math.sin(t * 1.3) * 0.035 + Math.sin(t * 5.7) * 0.008;
    g.rotation.z = Math.sin(t * 0.9) * 0.035;
    g.rotation.x = Math.cos(t * 1.1) * 0.028;
    eye.scale.setScalar(1 + Math.sin(t * 3.1) * 0.12);
    eyeLight.intensity = 1.3 + Math.sin(t * 3.1) * 0.5;
    strobe.material.opacity = (t % 1.4) < 0.09 ? 1 : 0.06;
  };
  g.userData.setHoverHeight = (y) => { home.y = y; };
  g.userData.lightSource = eyeLight;
  return g;
}

// ---------------------------------------------------------------------------
// Rifle
// ---------------------------------------------------------------------------

/**
 * Built pointing along +Z so attachToHand's forward axis aims it correctly.
 * Silhouette is everything here: stock, magazine, and a long barrel read as a
 * rifle from any distance a rifle is ever framed at.
 */
function buildRifle({ metal = '#2c3036', furniture = '#3f3a34' } = {}) {
  const g = new THREE.Group();
  const m = metalMaterial(metal, 0.55);
  const f = fabricMaterial(furniture, 0.75);

  g.add(box(0.045, 0.075, 0.26, f, 0, -0.005, -0.20));      // stock
  g.add(box(0.05, 0.09, 0.22, m, 0, 0, 0.005));             // receiver
  g.add(box(0.035, 0.10, 0.055, f, 0, -0.085, -0.045));     // grip
  const mag = box(0.030, 0.13, 0.055, m, 0, -0.095, 0.045);
  mag.rotation.x = -0.18;
  g.add(mag);
  g.add(cyl(0.014, 0.016, 0.34, m, 10, 0, 0.012, 0.28));    // barrel
  g.add(box(0.032, 0.030, 0.15, f, 0, -0.020, 0.19));       // handguard
  g.add(box(0.016, 0.032, 0.075, m, 0, 0.062, 0.02));       // optic
  g.add(cyl(0.017, 0.017, 0.07, m, 8, 0, 0.075, 0.03).rotateX(Math.PI / 2));

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.grip = { position: new THREE.Vector3(0, -0.085, -0.045), rotation: 0 };
  return g;
}

/**
 * name -> { build, size [w,h,d], category, tags, options }
 *
 * `size` is the footprint used for placement and collision avoidance, and it is
 * what validateScene reasons about a prop with, so it describes the type as
 * built with no options — see the `size` note at the top of this file.
 *
 * `options` lists the scene-file option keys this type honours, and the list is
 * the contract: `createProp` warns about anything a scene asks for that is not
 * on it, and the vocabulary generator publishes it so a system prompt can say
 * truthfully which props take a colour. It is a per-type fact rather than one
 * rule because the film makes it one: ph_assets tints fifteen of its types and
 * builds the drone, the rifle and the tree with liveries a scene file cannot
 * reach. Every entry below is that same answer.
 *
 * `colour` names the type's primary surface, listed per entry where it is not
 * simply "the whole thing".
 */
export const PROPS = {
  // The drone's livery and its red sensor eye, the rifle's furniture and the
  // tree's seeded bark and leaf are all fixed in ph_assets, so tinting them
  // here would show the author a prop the film will not render.
  drone: { build: buildDrone, size: [0.55, 0.30, 0.55], category: 'vehicle', tags: ['air'], options: [] },
  rifle: { build: buildRifle, size: [0.10, 0.20, 0.70], category: 'handheld', tags: ['held'], options: [] },
  tree: { build: buildTree, size: [2.40, 4.20, 2.40], category: 'nature', tags: ['exterior'], options: [] },

  // Beach dressing. Sizes are measured off ph_assets rather than declared by
  // it — see the builders above. Like the drone and the rifle, none of the
  // three can be tinted from a scene file, because the film's builders take no
  // colour. The bucket is deliberately NOT tagged 'held': make_bucket authors
  // no ph_grip, so claiming a grip that does not exist would suppress the
  // carry warning on the strength of a tag. Tag it when the grip is added.
  ball: { build: buildBall, size: [0.34, 0.34, 0.34], category: 'clutter', tags: ['floor', 'exterior'], options: [] },
  bucket: { build: buildBucket, size: [0.23, 0.27, 0.23], category: 'clutter', tags: ['floor', 'exterior'], options: [] },
  parasol: { build: buildParasol, size: [1.91, 2.01, 1.91], category: 'structure', tags: ['floor', 'exterior'], options: [] },

  // The generic primitives: the only three types either renderer resizes. The
  // grips are the catalogue ones; a primitive built at a scene-file `size`
  // overrides them with its own, measured from the size it was actually given.
  slab: {
    build: buildSlab, size: [0.30, 0.20, 0.04], category: 'clutter',
    tags: ['floor', 'handheld'], hold: { offset: [0, -0.10, 0.03] },
    options: ['colour', 'size'],
  },
  rod: {
    build: buildRod, size: [0.12, 0.25, 0.12], category: 'clutter',
    tags: ['floor', 'handheld'], hold: { offset: [0, -0.09, 0.03] },
    options: ['colour', 'size'],
  },
  orb: {
    build: buildOrb, size: [0.24, 0.24, 0.24], category: 'clutter',
    tags: ['floor', 'handheld'], hold: { offset: [0, -0.115, 0.03] },
    options: ['colour', 'size'],
  },

  // colour -> the brass: the chimney is glass and the flame is the flame.
  oilLamp: { build: buildOilLamp, size: [0.13, 0.37, 0.13], category: 'light', tags: ['table', 'hero'], options: ['colour'] },
  // colour -> the case timber; the dial, hands and pendulum stay brass.
  grandfatherClock: { build: buildGrandfatherClock, size: [0.58, 2.20, 0.36], category: 'furniture', tags: ['wall', 'hero'], options: ['colour'] },
  // colour -> the wax.
  candle: { build: buildCandle, size: [0.09, 0.24, 0.09], category: 'light', tags: ['table'], options: ['colour'] },
  chandelier: { build: buildChandelier, size: [0.70, 0.70, 0.70], category: 'light', tags: ['ceiling'], options: ['colour'] },
  // colour -> the stonework; the fire is not dressing.
  fireplace: { build: buildFireplace, size: [2.10, 1.55, 0.50], category: 'light', tags: ['wall'], options: ['colour'] },
  // colour -> the frame timber, as ph_assets does; the seat pad keeps its own.
  chair: { build: buildChair, size: [0.50, 1.00, 0.50], category: 'seat', tags: ['floor'], options: ['colour'] },
  stool: { build: buildStool, size: [0.40, 0.48, 0.40], category: 'seat', tags: ['floor'], options: ['colour'] },
  // colour -> the upholstery, which on an armchair is the object.
  armchair: { build: buildArmchair, size: [0.78, 0.95, 0.74], category: 'seat', tags: ['floor'], options: ['colour'] },
  table: { build: buildTable, size: [1.40, 0.80, 0.80], category: 'surface', tags: ['floor'], options: ['colour'] },
  roundTable: { build: (o) => buildTable({ ...o, round: true, w: 0.95 }), size: [0.95, 0.80, 0.95], category: 'surface', tags: ['floor'], options: ['colour'] },
  // colour -> the blanket. A bed is named by its bedding, and the frame is
  // barely in shot; the sheets and pillows stay linen so it still reads as a
  // made bed rather than one dyed object.
  bed: { build: buildBed, size: [1.50, 1.10, 2.10], category: 'furniture', tags: ['wall'], options: ['colour'] },
  // colour -> the carcass; the books are the point of a bookshelf.
  bookshelf: { build: buildBookshelf, size: [1.00, 1.95, 0.32], category: 'furniture', tags: ['wall'], options: ['colour'] },
  wardrobe: { build: buildWardrobe, size: [1.20, 2.15, 0.60], category: 'furniture', tags: ['wall'], options: ['colour'] },
  // colour -> the timber; the iron straps stay iron.
  trunk: { build: buildTrunk, size: [0.90, 0.62, 0.50], category: 'furniture', tags: ['floor', 'wall'], options: ['colour'] },
  // colour -> the staves; the hoops stay iron.
  barrel: { build: buildBarrel, size: [0.60, 0.82, 0.60], category: 'clutter', tags: ['floor'], options: ['colour'] },
  // colour -> the boards; the battens keep their darker tone.
  crate: { build: buildCrate, size: [0.54, 0.54, 0.54], category: 'clutter', tags: ['floor'], options: ['colour'] },
  // colour -> the field; the border stays the contrasting trim.
  rug: { build: buildRug, size: [2.60, 0.01, 1.80], category: 'floor', tags: ['floor'], options: ['colour'] },
  // colour -> the frame, not the painting inside it.
  portrait: { build: buildPortrait, size: [0.62, 0.82, 0.06], category: 'decor', tags: ['wall'], options: ['colour'] },
  // colour -> the frame; the glazing is lit by the time of day.
  window: { build: buildWindow, size: [1.24, 1.58, 0.14], category: 'decor', tags: ['wall'], options: ['colour'] },
  // colour -> the leaf; the jamb and the knob stay put.
  door: { build: buildDoor, size: [1.06, 2.22, 0.12], category: 'structure', tags: ['wall'], options: ['colour'] },
  cup: { build: buildCup, size: [0.08, 0.08, 0.08], category: 'clutter', tags: ['table'], options: ['colour'] },
  // colour -> the glass; the browser bottle has no label to keep white.
  bottle: { build: buildBottle, size: [0.09, 0.29, 0.09], category: 'clutter', tags: ['table'], options: ['colour'] },
  // colour -> the stonework; the windlass timber stays timber.
  well: { build: buildWell, size: [1.70, 2.10, 0.80], category: 'nature', tags: ['exterior'], options: ['colour'] },
  // colour -> the skin; the stalk and leaf are what make it read as fruit.
  apple: {
    build: buildApple, size: [0.08, 0.10, 0.08], category: 'clutter',
    tags: ['table', 'hero', 'handheld'], hold: { offset: [0, -0.10, 0.03] },
    options: ['colour'],
  },
  basket: {
    build: buildBasket, size: [0.42, 0.42, 0.42], category: 'clutter',
    tags: ['floor', 'handheld'], hold: { offset: [0, -0.46, 0.05] },
    options: ['colour'],
  },
  fence: { build: buildFence, size: [2.40, 1.05, 0.12], category: 'structure', tags: ['exterior'], options: ['colour'] },
  // colour -> the metalwork; the pane and the flame are the light.
  lantern: {
    build: buildLantern, size: [0.12, 0.29, 0.12], category: 'light',
    tags: ['table', 'hero', 'handheld'], hold: { offset: [0, -0.36, 0.03] },
    options: ['colour'],
  },
};

export const PROP_NAMES = Object.keys(PROPS);

/** The scene file's whole option vocabulary; scenefile.js rejects any third. */
const OPTION_KEYS = ['colour', 'size'];

/**
 * Instantiate a prop by name.
 *
 * A scene-file option this type does not honour is dropped, and dropped
 * loudly. That is the whole point: a builder that is never passed a `colour`
 * has no way to complain about it, so a scene asking for a green drone would
 * otherwise preview as an ordinary drone and say nothing — and then render as
 * an ordinary drone too, with the author still none the wiser. It stays a
 * warning rather than an error for ph_assets' reason: a mis-aimed option is a
 * note to the author, not a reason to refuse to show them their scene.
 *
 * Only the two scene-file keys are policed. Anything else in `opts` came from
 * inside the engine — the orchard passes `fruit` to its trees — and a builder's
 * own parameters are not the scene file's business.
 *
 * @returns {THREE.Group|null} group carrying `userData.propName` and metadata
 */
export function createProp(name, opts = {}) {
  const def = PROPS[name];
  if (!def) return null;
  const honoured = def.options || [];
  const build = { ...opts };
  for (const key of OPTION_KEYS) {
    if (build[key] === undefined || honoured.includes(key)) continue;
    delete build[key];
    console.warn(`scene file: prop type "${name}" takes no ${key}, so it was ignored`
      + (key === 'size'
        ? '; a named type\'s size is what blocking and the validator are solved against. Use "slab", "rod" or "orb" for a shape sized by the scene file'
        : `; ${name} is built with a fixed livery in both renderers`));
  }
  const group = def.build(build);
  group.userData.propName = name;
  // The size a prop was actually built at, which for a resized primitive is not
  // the catalogue one. Placement and collision avoidance read this, and a 2 m
  // plank announcing itself as a 0.30 m board is placed on top of something.
  group.userData.size = (honoured.includes('size') && build.size) || def.size;
  group.userData.category = def.category;
  group.userData.tags = def.tags;
  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; }
  });
  return group;
}

/** Loose keyword -> prop name, so scripts can call for things in prose. */
const PROP_KEYWORDS = {
  drone: ['drone', 'drones', 'quadcopter', 'uav'],
  rifle: ['rifle', 'rifles', 'gun', 'guns', 'weapon', 'weapons', 'carbine'],
  oilLamp: ['oil lamp', 'lamp', 'oil-lamp'],
  lantern: ['lantern', 'carry lantern', 'hand lantern'],
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
  // 'branches'/'boughs' matter: writers describe the tree without naming it.
  tree: ['tree', 'trees', 'oak', 'birch', 'branches', 'boughs', 'orchard'],
  ball: ['ball', 'balls', 'beachball', 'beach ball', 'football'],
  bucket: ['bucket', 'buckets', 'pail', 'pails', 'sandcastle bucket'],
  parasol: ['parasol', 'parasols', 'umbrella', 'umbrellas', 'sunshade', 'beach umbrella'],
  well: ['well'],
  chandelier: ['chandelier'],
  apple: ['apple', 'apples'],
  basket: ['basket', 'hamper'],
  fence: ['fence', 'gate', 'stile'],
  // The generic primitives answer to the shapes prose asks for by name. Words
  // that are usually adjectives are left out on purpose — 'stone' would dress
  // a stone wall with a boulder in front of it.
  slab: ['slab', 'board', 'plank', 'panel', 'headstone'],
  rod: ['rod', 'post', 'pole', 'bollard'],
  orb: ['orb', 'boulder'],
};

// ---------------------------------------------------------------------------
// Hand attachment
// ---------------------------------------------------------------------------

/**
 * Parent a prop to a character's hand bone so it rides every pose and walk.
 *
 * Works for procedural humans and imported avatars alike — both expose
 * `userData.bones.handL/handR`. Character groups may be scaled (height), so
 * the prop is counter-scaled and its offset expressed in world metres.
 *
 * @param {THREE.Object3D} character group carrying `userData.bones`
 * @param {THREE.Object3D} prop group from `createProp`
 * @param {'L'|'R'} [side] which hand; offsets mirror for the left
 * @returns {boolean} true when the prop was attached
 */
export function attachToHand(character, prop, side = 'R') {
  const hand = character?.userData?.bones?.[side === 'L' ? 'handL' : 'handR'];
  if (!hand || !prop) return false;
  // A builder that was told a `size` knows where its own grip is; the registry
  // entry only describes the catalogue prop, and a 2 m plank held at the offset
  // authored for a 0.20 m board hangs off the fingertips.
  const hold = prop.userData?.hold || PROPS[prop.userData?.propName]?.hold || {};
  prop.userData.prevParent = prop.parent || null;
  hand.updateWorldMatrix(true, false);
  const ws = new THREE.Vector3();
  hand.getWorldScale(ws);
  const world = Math.abs(ws.y) > 1e-6 ? Math.abs(ws.y) : 1;
  hand.add(prop);
  prop.scale.setScalar((hold.scale ?? 1) / world);
  // Offsets are authored in world metres for the right hand; divide by the
  // accumulated scale so they survive scaled character groups.
  const [ox, oy, oz] = hold.offset || [0, -0.10, 0.03];
  prop.position.set((side === 'L' ? -ox : ox) / world, oy / world, oz / world);
  const [rx, ry, rz] = hold.rotation || [0, 0, 0];
  prop.rotation.set(rx, side === 'L' ? -ry : ry, rz);
  prop.userData.heldBy = character;
  prop.userData.heldSide = side;
  return true;
}

/**
 * Release a held prop, restoring its previous parent (or the character's own
 * parent as a fallback) while keeping its world transform, so the caller can
 * then settle it — e.g. at the character's feet.
 * @returns {boolean} true when the prop was actually held
 */
export function detachFromHand(prop) {
  if (!prop || !prop.userData?.heldBy) return false;
  const prev = prop.userData.prevParent;
  const target = prev && prev.isObject3D ? prev : prop.userData.heldBy.parent || null;
  if (target) target.attach(prop);
  else prop.removeFromParent();
  prop.userData.heldBy = null;
  prop.userData.heldSide = null;
  prop.userData.prevParent = null;
  return true;
}

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
