/**
 * Magic and effects.
 *
 * Every ability is a short-lived bundle of CPU-simulated particles plus a
 * little mesh work and a light pulse. Particle counts are deliberately modest:
 * on a phone, a burst of 200 additive sprites with a bright light behind it
 * reads far better than 5000 sprites at half the framerate.
 */

import * as THREE from 'three';
import { glowMaterial } from './materials.js';

let sparkTexture = null;

/** Soft radial sprite, generated once. */
function getSparkTexture() {
  if (sparkTexture) return sparkTexture;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  sparkTexture = new THREE.CanvasTexture(c);
  return sparkTexture;
}

/** A CPU-simulated particle burst. */
class Particles {
  constructor(count, colour, { size = 0.05, blending = THREE.AdditiveBlending } = {}) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.colours = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.base = new THREE.Color(colour);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.PointsMaterial({
      size,
      map: getSparkTexture(),
      vertexColors: true,
      transparent: true,
      blending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
  }

  emit(i, pos, vel, life, colour) {
    this.positions[i * 3] = pos.x;
    this.positions[i * 3 + 1] = pos.y;
    this.positions[i * 3 + 2] = pos.z;
    this.vel[i * 3] = vel.x;
    this.vel[i * 3 + 1] = vel.y;
    this.vel[i * 3 + 2] = vel.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    const c = colour || this.base;
    this.colours[i * 3] = c.r;
    this.colours[i * 3 + 1] = c.g;
    this.colours[i * 3 + 2] = c.b;
  }

  /** @param {(i:number, dt:number)=>void} [perParticle] extra forces */
  step(dt, gravity = 0, drag = 0.98, perParticle = null) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.sizes[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] += gravity * dt;
      this.vel[k] *= drag;
      this.vel[k + 1] *= drag;
      this.vel[k + 2] *= drag;
      if (perParticle) perParticle(i, dt);
      this.positions[k] += this.vel[k] * dt;
      this.positions[k + 1] += this.vel[k + 1] * dt;
      this.positions[k + 2] += this.vel[k + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      // Fade by dimming colour: additive blending means alpha alone won't do it.
      const f = t * t;
      this.colours[k] = this.base.r * f;
      this.colours[k + 1] = this.base.g * f;
      this.colours[k + 2] = this.base.b * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.points.material.dispose();
  }
}

const SHIELD_VERT = `
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SHIELD_FRAG = `
uniform vec3 uColour;
uniform float uTime;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.2);
  float grid = 0.5 + 0.5 * sin(vLocal.y * 34.0 + uTime * 2.2) * sin(vLocal.x * 34.0 - uTime * 1.4);
  float band = smoothstep(0.0, 1.0, sin(vLocal.y * 6.0 - uTime * 3.0) * 0.5 + 0.5);
  float a = (fres * 0.85 + grid * 0.12 + band * 0.08) * uOpacity;
  gl_FragColor = vec4(uColour * (0.7 + fres * 0.9), a);
}`;

/** Ease helpers for effect envelopes. */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const bell = (t) => Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1));

export const ABILITY_DEFAULTS = {
  light: { colour: '#ffe9a8', duration: 2.6 },
  fire: { colour: '#ff7a2a', duration: 2.2 },
  frost: { colour: '#8fd8ff', duration: 2.6 },
  telekinesis: { colour: '#c9a8ff', duration: 3.0 },
  heal: { colour: '#a8ffc4', duration: 2.8 },
  teleport: { colour: '#d0a8ff', duration: 1.6 },
  shield: { colour: '#8fc4ff', duration: 3.2 },
  illusion: { colour: '#ff9ede', duration: 3.0 },
  shadow: { colour: '#7a5fa8', duration: 2.8 },
  wind: { colour: '#d8f0e8', duration: 2.4 },
};

/**
 * Owns all live effects. Effects are spawned with a world-space origin (and
 * optionally a target) and tear themselves down when their envelope expires.
 */
export class VFXSystem {
  constructor(scene) {
    this.scene = scene;
    this.effects = [];
    this.maxConcurrent = 6;
  }

  /**
   * @param {string} ability one of ABILITY_DEFAULTS
   * @param {object} opts { origin: Vector3, target?: Vector3, colour?, scale?, targetObject? }
   */
  spawn(ability, opts = {}) {
    const def = ABILITY_DEFAULTS[ability] || ABILITY_DEFAULTS.light;
    const colour = new THREE.Color(opts.colour || def.colour);
    const origin = (opts.origin || new THREE.Vector3()).clone();
    const target = opts.target ? opts.target.clone() : null;
    const duration = opts.duration || def.duration;

    if (this.effects.length >= this.maxConcurrent) {
      this.#retire(this.effects[0]);
    }

    const maker = this[`_${ability}`] || this._light;
    const effect = maker.call(this, { origin, target, colour, duration, ...opts });
    effect.age = 0;
    effect.duration = duration;
    effect.ability = ability;
    this.scene.add(effect.root);
    this.effects.push(effect);
    return effect;
  }

  update(dt, elapsed) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      const t = Math.min(1, e.age / e.duration);
      e.step(dt, t, elapsed);
      if (e.age >= e.duration) {
        this.#retire(e);
      }
    }
  }

  #retire(effect) {
    const i = this.effects.indexOf(effect);
    if (i >= 0) this.effects.splice(i, 1);
    this.scene.remove(effect.root);
    effect.dispose?.();
  }

  clear() {
    [...this.effects].forEach((e) => this.#retire(e));
  }

  // --- Individual abilities ------------------------------------------------

  _light({ origin, colour, duration }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), glowMaterial(colour, 0.95));
    root.add(core);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), glowMaterial(colour, 0.25));
    root.add(halo);

    const light = new THREE.PointLight(colour, 0, 7, 1.7);
    root.add(light);

    const p = new Particles(150, colour, { size: 0.035 });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.05 + Math.random() * 0.10;
      p.emit(i,
        new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.1 - 0.05, Math.sin(a) * r),
        new THREE.Vector3(Math.cos(a) * 0.12, 0.28 + Math.random() * 0.4, Math.sin(a) * 0.12),
        0.9 + Math.random() * duration * 0.7);
    }

    return {
      root,
      step: (dt, t, elapsed) => {
        const env = bell(t);
        core.scale.setScalar(0.6 + easeOut(Math.min(1, t * 3)) * 1.0 * (0.85 + env * 0.3));
        halo.scale.setScalar(1 + env * 1.4);
        halo.material.opacity = 0.28 * env;
        core.material.opacity = 0.95 * Math.min(1, env * 1.8);
        light.intensity = env * 5.5;
        // Gentle orbit as the motes rise.
        p.step(dt, 0.05, 0.995, (i) => {
          const k = i * 3;
          const a = elapsed * 1.6 + i;
          p.vel[k] += Math.cos(a) * 0.28 * dt;
          p.vel[k + 2] += Math.sin(a) * 0.28 * dt;
        });
      },
      dispose: () => p.dispose(),
    };
  }

  _fire({ origin, target, colour, duration }) {
    const root = new THREE.Group();
    root.position.copy(origin);
    const dir = target ? target.clone().sub(origin).normalize() : new THREE.Vector3(0, 1, 0);

    const p = new Particles(260, colour, { size: 0.11 });
    root.add(p.points);
    const hot = new THREE.Color('#ffe6a0');
    for (let i = 0; i < p.count; i++) {
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8,
      );
      const speed = 1.4 + Math.random() * 2.8;
      p.emit(i,
        new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08),
        dir.clone().multiplyScalar(speed).add(spread),
        0.4 + Math.random() * duration * 0.55,
        Math.random() < 0.3 ? hot : null);
    }

    const flash = new THREE.PointLight(colour, 0, 9, 1.8);
    root.add(flash);

    return {
      root,
      step: (dt, t) => {
        p.step(dt, 1.4, 0.955);
        flash.intensity = Math.pow(1 - t, 2.2) * 9;
      },
      dispose: () => p.dispose(),
    };
  }

  _frost({ origin, colour, duration }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    const shards = [];
    const shardMat = new THREE.MeshPhysicalMaterial({
      color: colour, roughness: 0.06, metalness: 0.1,
      transparent: true, opacity: 0.72, envMapIntensity: 2.2,
    });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.20 + Math.random() * 0.18, 5), shardMat);
      s.position.set(Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34);
      s.rotation.z = -Math.cos(a) * 0.5;
      s.rotation.x = Math.sin(a) * 0.5;
      s.castShadow = true;
      root.add(s);
      shards.push(s);
    }

    const p = new Particles(180, colour, { size: 0.032 });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.7;
      p.emit(i,
        new THREE.Vector3(Math.cos(a) * r, 0.8 + Math.random() * 0.9, Math.sin(a) * r),
        new THREE.Vector3((Math.random() - 0.5) * 0.16, -0.28 - Math.random() * 0.25, (Math.random() - 0.5) * 0.16),
        1.0 + Math.random() * duration * 0.6);
    }

    const light = new THREE.PointLight(colour, 0, 6, 2);
    light.position.y = 0.4;
    root.add(light);

    return {
      root,
      step: (dt, t) => {
        const grow = easeOut(Math.min(1, t * 2.4));
        const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
        shards.forEach((s, i) => {
          s.scale.setScalar(grow * fade * (0.8 + (i % 3) * 0.2));
          s.position.y = grow * 0.10;
        });
        shardMat.opacity = 0.72 * fade;
        light.intensity = bell(t) * 3.2;
        p.step(dt, -0.05, 0.99);
      },
      dispose: () => { p.dispose(); shardMat.dispose(); },
    };
  }

  _telekinesis({ origin, colour, duration, targetObject }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    const rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34 + i * 0.12, 0.008, 6, 32), glowMaterial(colour, 0.7));
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
      rings.push(ring);
    }

    const p = new Particles(150, colour, { size: 0.035 });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.35;
      p.emit(i,
        new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.2, Math.sin(a) * r),
        new THREE.Vector3(0, 0.16 + Math.random() * 0.2, 0),
        1.2 + Math.random() * duration * 0.5);
    }

    const light = new THREE.PointLight(colour, 0, 5, 2);
    root.add(light);
    const startY = targetObject ? targetObject.position.y : 0;

    return {
      root,
      step: (dt, t, elapsed) => {
        const env = bell(t);
        rings.forEach((ring, i) => {
          ring.rotation.z = elapsed * (0.8 + i * 0.4) * (i % 2 ? 1 : -1);
          ring.position.y = 0.1 + Math.sin(elapsed * 1.4 + i) * 0.10 + env * 0.3;
          ring.scale.setScalar(0.5 + env * 0.8);
          ring.material.opacity = 0.7 * env;
        });
        light.intensity = env * 3.0;
        if (targetObject) {
          targetObject.position.y = startY + env * 0.85;
          targetObject.rotation.y += dt * 0.7 * env;
        }
        p.step(dt, 0.02, 0.99, (i) => {
          const k = i * 3;
          const a = elapsed * 2.2 + i * 0.4;
          p.vel[k] += Math.cos(a) * 0.5 * dt;
          p.vel[k + 2] += Math.sin(a) * 0.5 * dt;
        });
      },
      dispose: () => { p.dispose(); if (targetObject) targetObject.position.y = startY; },
    };
  }

  _heal({ origin, colour, duration }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    const p = new Particles(190, colour, { size: 0.042 });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.45;
      p.emit(i,
        new THREE.Vector3(Math.cos(a) * r, -0.85 + Math.random() * 0.3, Math.sin(a) * r),
        new THREE.Vector3(0, 0.55 + Math.random() * 0.5, 0),
        1.4 + Math.random() * duration * 0.5);
    }

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 6, 36), glowMaterial(colour, 0.6));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.85;
    root.add(ring);

    const light = new THREE.PointLight(colour, 0, 5.5, 2);
    root.add(light);

    return {
      root,
      step: (dt, t, elapsed) => {
        const env = bell(t);
        ring.position.y = -0.85 + t * 1.9;
        ring.scale.setScalar(0.6 + env * 0.7);
        ring.material.opacity = 0.6 * env;
        light.intensity = env * 3.4;
        light.position.y = ring.position.y;
        p.step(dt, 0.02, 0.995, (i) => {
          const k = i * 3;
          const a = elapsed * 1.8 + i * 0.6;
          p.vel[k] += Math.cos(a) * 0.22 * dt;
          p.vel[k + 2] += Math.sin(a) * 0.22 * dt;
        });
      },
      dispose: () => p.dispose(),
    };
  }

  _teleport({ origin, colour, duration, character }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    const p = new Particles(240, colour, { size: 0.05 });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.9 + Math.random() * 0.9;
      const y = Math.random() * 1.8;
      p.emit(i,
        new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        new THREE.Vector3(-Math.cos(a) * 2.4, 0.5, -Math.sin(a) * 2.4),
        0.5 + Math.random() * 0.8);
    }

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.30, 2.4, 20, 1, true),
      glowMaterial(colour, 0.5),
    );
    column.position.y = 1.2;
    root.add(column);

    const light = new THREE.PointLight(colour, 0, 8, 1.7);
    light.position.y = 1.0;
    root.add(light);

    return {
      root,
      step: (dt, t) => {
        const env = bell(t);
        column.scale.set(1 - t * 0.7, 1 + t * 0.4, 1 - t * 0.7);
        column.material.opacity = 0.55 * env;
        light.intensity = env * 7;
        p.step(dt, 0.2, 0.94);
        if (character) {
          const fade = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2;
          character.traverse((o) => {
            if (o.isMesh && o.material && 'opacity' in o.material) {
              o.material.transparent = true;
              o.material.opacity = Math.max(0.05, fade);
            }
          });
        }
      },
      dispose: () => {
        p.dispose();
        if (character) {
          character.traverse((o) => {
            if (o.isMesh && o.material && 'opacity' in o.material) o.material.opacity = 1;
          });
        }
      },
    };
  }

  _shield({ origin, colour, duration }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColour: { value: new THREE.Color(colour) },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.05, 28, 20), mat);
    dome.position.y = 0.95;
    root.add(dome);

    const light = new THREE.PointLight(colour, 0, 6, 2);
    light.position.y = 0.95;
    root.add(light);

    return {
      root,
      step: (dt, t, elapsed) => {
        const env = bell(t);
        mat.uniforms.uTime.value = elapsed;
        mat.uniforms.uOpacity.value = env * 0.9;
        dome.scale.setScalar(0.4 + easeOut(Math.min(1, t * 3.5)) * 0.65);
        light.intensity = env * 2.6;
      },
      dispose: () => mat.dispose(),
    };
  }

  _illusion({ origin, colour, duration, character }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    const p = new Particles(200, colour, { size: 0.05 });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.4;
      p.emit(i,
        new THREE.Vector3(Math.cos(a) * r, Math.random() * 1.75, Math.sin(a) * r),
        new THREE.Vector3(0, 0.1, 0),
        1.4 + Math.random() * duration * 0.5);
    }

    // A ghosted double, if a body was supplied to copy.
    let phantom = null;
    if (character) {
      phantom = character.clone(true);
      phantom.traverse((o) => {
        if (o.isMesh) {
          o.material = glowMaterial(colour, 0.14);
          o.castShadow = false;
        }
      });
      phantom.position.set(0, 0, 0);
      root.add(phantom);
    }

    const light = new THREE.PointLight(colour, 0, 5, 2);
    light.position.y = 1.1;
    root.add(light);

    return {
      root,
      step: (dt, t, elapsed) => {
        const env = bell(t);
        light.intensity = env * 2.2;
        if (phantom) {
          phantom.position.x = Math.sin(elapsed * 2.2) * 0.32;
          phantom.scale.setScalar(0.9 + env * 0.12);
          phantom.traverse((o) => {
            if (o.isMesh && o.material) o.material.opacity = 0.16 * env;
          });
        }
        p.step(dt, 0.0, 0.99, (i) => {
          const k = i * 3;
          const a = elapsed * 3.0 + i;
          p.vel[k] += Math.cos(a) * 0.42 * dt;
          p.vel[k + 2] += Math.sin(a) * 0.42 * dt;
        });
      },
      dispose: () => p.dispose(),
    };
  }

  _shadow({ origin, colour, duration }) {
    const root = new THREE.Group();
    root.position.copy(origin);

    // Subtractive-feeling darkness: normal blending with a dark colour, plus a
    // negative-intensity light is not possible, so we dim with a dark dome.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 20, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#0a0610'), transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    dome.position.y = 1.0;
    root.add(dome);

    const p = new Particles(200, colour, { size: 0.09, blending: THREE.NormalBlending });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.2 + Math.random() * 1.0;
      p.emit(i,
        new THREE.Vector3(Math.cos(a) * r, Math.random() * 1.9, Math.sin(a) * r),
        new THREE.Vector3(-Math.cos(a) * 0.25, 0.06, -Math.sin(a) * 0.25),
        1.4 + Math.random() * duration * 0.5);
    }

    return {
      root,
      step: (dt, t, elapsed) => {
        const env = bell(t);
        dome.material.opacity = env * 0.62;
        dome.scale.setScalar(0.55 + env * 0.6);
        p.step(dt, -0.02, 0.99, (i) => {
          const k = i * 3;
          const a = elapsed * 1.2 + i * 0.8;
          p.vel[k] += Math.cos(a) * 0.2 * dt;
          p.vel[k + 2] += Math.sin(a) * 0.2 * dt;
        });
      },
      dispose: () => p.dispose(),
    };
  }

  _wind({ origin, target, colour, duration }) {
    const root = new THREE.Group();
    root.position.copy(origin);
    const dir = target ? target.clone().sub(origin).normalize() : new THREE.Vector3(1, 0.1, 0);

    const p = new Particles(240, colour, { size: 0.06 });
    root.add(p.points);
    for (let i = 0; i < p.count; i++) {
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() - 0.5) * 2.2);
      p.emit(i,
        perp.clone().setY(Math.random() * 2.0).addScaledVector(dir, -1.5 - Math.random() * 1.5),
        dir.clone().multiplyScalar(2.6 + Math.random() * 3.4).add(new THREE.Vector3(0, (Math.random() - 0.3) * 0.6, 0)),
        1.0 + Math.random() * duration * 0.4);
    }

    return {
      root,
      step: (dt, t, elapsed) => {
        p.step(dt, -0.04, 0.988, (i) => {
          const k = i * 3;
          p.vel[k + 1] += Math.sin(elapsed * 4 + i) * 0.5 * dt;
        });
      },
      dispose: () => p.dispose(),
    };
  }
}
