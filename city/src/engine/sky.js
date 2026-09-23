// Time of day: sun, sky, fog, ambient light, stars, and the "night" factor
// that street lamps, windows and neon read to switch on.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const LAT_TILT = 0.35;   // sun path tilt toward the south, radians

// Horizon/fog colours keyed by sun elevation (degrees). Picked from reference
// photos of a coastal evening rather than derived: the Preetham sky is
// physically plausible but reads grey at the horizon in fog.
const FOG_KEYS = [
  [-18, '#070b18'], [-8, '#1a2140'], [-2, '#5a4a70'], [3, '#e89a78'], [10, '#f2c9a0'], [25, '#c9dbea'], [60, '#b7d0e6'],
];
const HEMI_SKY = [[-18, '#10162c'], [-4, '#2a2d50'], [4, '#f0b090'], [15, '#bcd4f0'], [60, '#cfe2ff']];
const HEMI_GROUND = [[-18, '#05060a'], [0, '#3a2a30'], [15, '#6a5a4a'], [60, '#7a6e5e']];

function keyed(keys, x) {
  if (x <= keys[0][0]) return new THREE.Color(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [a, ca] = keys[i - 1], [b, cb] = keys[i];
      return new THREE.Color(ca).lerp(new THREE.Color(cb), (x - a) / (b - a));
    }
  }
  return new THREE.Color(keys[keys.length - 1][1]);
}

export class DayCycle {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.hours = 17.6;
    this.rate = 1 / 60;            // game hours per real second (1 minute = 1 hour)
    this.paused = false;

    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4f0, 0x6a5a4a, 1.0);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xc9dbea, 60, 900);
    scene.fog = this.fog;

    this.stars = makeStars();
    scene.add(this.stars);
    this.moon = makeMoon();
    scene.add(this.moon);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this.lastEnvHours = -99;
    this.sunDir = new THREE.Vector3();
    this.night = 0;
    this.focus = new THREE.Vector3();
  }

  // 0 at noon .. 1 at deep night; lamps switch on around 0.35.
  get elevationDeg() { return this._elev; }

  setHours(h) { this.hours = ((h % 24) + 24) % 24; this.lastEnvHours = -99; }

  update(dt, focus) {
    if (!this.paused) this.hours = (this.hours + dt * this.rate) % 24;
    this.focus.copy(focus);
    // Sun: rises in the east (+X, over the ocean), sets in the west.
    const a = ((this.hours - 6) / 12) * Math.PI;          // 0 at 6:00, PI at 18:00
    const dir = this.sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(LAT_TILT), Math.sin(a) * Math.sin(LAT_TILT) * 0.6).normalize();
    const elev = Math.asin(dir.y) * 180 / Math.PI;
    this._elev = elev;
    this.night = THREE.MathUtils.clamp((4 - elev) / 14, 0, 1);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(dir);
    // Keep the sky visible at night but dark; Preetham goes black, which reads
    // as a hole. Stars and a tinted fog carry the night.
    this.sky.material.uniforms.rayleigh.value = 1.2 + 1.8 * THREE.MathUtils.clamp(1 - elev / 30, 0, 1);

    const fogC = keyed(FOG_KEYS, elev);
    this.fog.color.copy(fogC);
    this.fog.near = 80;
    this.fog.far = THREE.MathUtils.lerp(1100, 500, this.night);
    this.scene.background = null;

    // Sun light: warm and low at the ends of the day, off below the horizon,
    // replaced by a cool moon from the opposite side.
    const day = THREE.MathUtils.clamp((elev + 2) / 10, 0, 1);
    const warm = THREE.MathUtils.clamp(1 - (elev - 2) / 25, 0, 1);
    const moonDir = new THREE.Vector3(-dir.x, Math.max(0.35, -dir.y), -dir.z + 0.3).normalize();
    const lightDir = day > 0.02 ? dir : moonDir;
    this.sun.color.set('#ffffff').lerp(new THREE.Color('#ff9a5a'), warm * 0.75);
    if (day <= 0.02) this.sun.color.set('#8aa4ff');
    this.sun.intensity = day > 0.02 ? 3.2 * day : 0.35;
    this.sun.position.copy(this.focus).addScaledVector(lightDir, 200);
    this.sun.target.position.copy(this.focus);
    // Snap the shadow camera to texels so shadows don't crawl as you walk.
    const texel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.copy(this.sun.target.position).addScaledVector(lightDir, 200);

    this.hemi.color.copy(keyed(HEMI_SKY, elev));
    this.hemi.groundColor.copy(keyed(HEMI_GROUND, elev));
    this.hemi.intensity = THREE.MathUtils.lerp(1.15, 0.55, this.night);

    this.stars.material.opacity = THREE.MathUtils.clamp((this.night - 0.4) / 0.5, 0, 1);
    this.stars.position.copy(this.focus);
    this.moon.position.copy(this.focus).addScaledVector(moonDir, 900);
    this.moon.material.opacity = THREE.MathUtils.clamp((this.night - 0.3) / 0.4, 0, 1);
    this.moon.visible = this.moon.material.opacity > 0.01;
    this.sky.position.copy(this.focus);

    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.62, 0.95, this.night);

    // Environment reflections follow the sky, refreshed every ~20 game minutes.
    if (Math.abs(this.hours - this.lastEnvHours) > 0.33) {
      this.lastEnvHours = this.hours;
      const eu = this.envSky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = u[k].value;
      eu.sunPosition.value.copy(dir);
      const old = this.envTarget;
      this.envScene.background = null;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = THREE.MathUtils.lerp(1.0, 0.25, this.night);
      old?.dispose();
    }
  }

  clockString() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function makeStars() {
  const n = 1800;
  const pos = new Float32Array(n * 3);
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.05;
    const rr = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * rr * 1500, y * 1500, Math.sin(th) * rr * 1500], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -1;
  return p;
}

function makeMoon() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.35, 'rgba(250,245,225,1)');
  g.addColorStop(0.42, 'rgba(200,210,255,0.25)');
  g.addColorStop(1, 'rgba(120,140,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
  s.scale.setScalar(90);
  return s;
}
