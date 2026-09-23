// The game: owns the renderer, world, actors and the frame loop.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Cast } from '../core/cast.js';
import { Actor } from '../core/actor.js';
import { Input } from '../engine/input.js';
import { Physics } from '../engine/physics.js';
import { FollowCamera } from '../engine/camera.js';
import { DayCycle } from '../engine/sky.js';
import { PlayerController } from './player.js';
import { Interactions, updateGoal } from './interact.js';
import { Speech } from './speech.js';
import { GameAudio } from './audio.js';
import { heldInteraction, dropHeld, updateHeld } from './hooks.js';
import { randomLook } from '../core/cast.js';
import { rng } from '../world/textures.js';

export class Game {
  constructor({ canvas, params, onProgress }) {
    this.params = params;
    this.onProgress = onProgress || (() => {});
    this.quality = params.get('quality') || (params.has('test') ? 'low' : 'high');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === 'low', powerPreference: 'high-performance', preserveDrawingBuffer: params.has('test') });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality === 'high' ? 1.5 : 1));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
    this.loader = new GLTFLoader();
    // The Ferrari ships Draco-compressed; the decoder is published next to
    // the page. The plain-JS decoder, not WASM: embedded viewers may forbid
    // compiling WebAssembly, and simplifying the model offline to avoid
    // Draco altogether barely reduced it (328k -> 305k triangles, 6MB).
    const draco = new DRACOLoader();
    draco.setDecoderPath('assets/draco/');
    draco.setDecoderConfig({ type: 'js' });
    this.loader.setDRACOLoader(draco);
    this.cast = new Cast(this.loader);
    this.input = new Input(canvas);
    this.physics = new Physics();
    this.follow = new FollowCamera(this.camera, this.physics);
    this.day = new DayCycle(renderer, this.scene);
    this.interactions = new Interactions();
    this.actors = [];
    this.updaters = [];            // (dt, game) => void, for world systems
    this.speech = new Speech(this);
    this.audio = new GameAudio(this);
    this.log = [];                 // what was said, for the studio to read later
    this.timers = [];              // [time, fn]: game-time callbacks
    this.frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.frame = 0;
    addEventListener('resize', () => this.resize());
    this.setupPost();
  }

  // high: 1.5x pixels, bloom, SMAA, 2048 shadows. medium: 1x, bloom.
  // low: 1x, no post, 1024 shadows. Chosen automatically after start.
  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : 1));
    this.renderer.setSize(innerWidth, innerHeight);
    const size = q === 'low' ? 1024 : 2048;
    const sh = this.day.sun.shadow;
    if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); sh.map?.dispose(); sh.map = null; }
    this.setupPost();
    this.onQuality?.(q);
  }

  // Watch the first seconds of play and step quality down if frames are slow.
  autoQuality(dt) {
    if (this.params.has('quality') || this.params.has('test')) return;
    const a = this._aq || (this._aq = { t: 0, frames: 0, sum: 0 });
    a.t += dt;
    if (a.t < 1.5) return;                 // let shaders compile first
    a.frames++; a.sum += this._frameMs || dt * 1000;
    if (a.frames < 90) return;
    const avg = a.sum / a.frames;
    a.t = 0; a.frames = 0; a.sum = 0;
    if (avg > 26 && this.quality !== 'low') this.setQuality(this.quality === 'high' ? 'medium' : 'low');
    else this._aq.done = (this._aq.done || 0) + 1;
    if (this._aq.done > 1) this.autoQuality = () => {};
  }

  setupPost() {
    if (this.quality === 'low') { this.composer = null; return; }
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.35, 0.5, 0.92);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    if (this.quality === 'high') c.addPass(new SMAAPass());
    c.setPixelRatio(this.renderer.getPixelRatio());
    c.setSize(innerWidth, innerHeight);
    this.composer = c;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
  }

  async load(buildWorld) {
    await this.cast.load((p) => this.onProgress(0.1 + p * 0.5, 'Casting characters'));
    this.onProgress(0.65, 'Building the city');
    await buildWorld(this);
    this.onProgress(0.95, 'Opening the doors');
  }

  addActor(modelKey, look, opts) {
    const a = new Actor(this.cast, modelKey, look, opts);
    this.scene.add(a.object);
    this.actors.push(a);
    return a;
  }

  removeActor(a) {
    a.dispose();
    this.actors = this.actors.filter((x) => x !== a);
  }

  setPlayer(actor) {
    this.player = actor;
    this.controller = new PlayerController(this, actor);
    actor.isPlayer = true;
  }

  start() {
    this.clock.start();
    let last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      this._frameMs = now - last; last = now;
      const dt = Math.min(this.clock.getDelta(), 1 / 20);
      this.step(dt);
      this.autoQuality(dt);
    };
    loop();
  }

  // Run fn after `s` seconds of game time. Game time, not wall time, so a
  // scripted or recorded run replays identically at any frame rate.
  later(s, fn) { this.timers.push([this.time + s, fn]); }

  step(dt, render = true) {
    this.time += dt;
    this.frame++;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t[0] <= this.time);
      if (due.length) { this.timers = this.timers.filter((t) => t[0] > this.time); for (const [, fn] of due) fn(); }
    }
    const p = this.player;
    this.follow.input(this.input, dt);
    if (this.input.hit('KeyE') && p) this.useInteraction();
    if (this.input.hit('KeyQ') && p?.held) dropHeld(this, p);
    this.controller?.update(dt);
    this.crowd?.update(dt);
    for (const a of this.actors) {
      if (a.goal) updateGoal(a, dt, this.physics);
    }
    for (const u of this.updaters) u(dt, this);
    for (const a of this.actors) {
      if (a.state === 'driving') continue;
      this.physics.moveActor(a, dt, this.actors);
    }
    // Cull actors by hand (skinned bounds are useless once posed), and
    // animate far ones at a lower rate; nobody can see the difference.
    this._pv.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pv);
    for (const a of this.actors) {
      const d2 = a.object.position.distanceToSquared(this.camera.position);
      this._sphere.center.copy(a.object.position).y += 0.9;
      const vis = a === p || (d2 < 160 * 160 && this.frustum.intersectsSphere(this._sphere));
      a.object.visible = vis && !a.hidden;
      // Only nearby people cast shadows: each caster is drawn twice.
      const caster = d2 < 28 * 28;
      if (caster !== a._caster) { a._caster = caster; a.object.traverse((o) => { if (o.isMesh) o.castShadow = caster; }); }
      if (!vis || (d2 > 70 * 70 && (this.frame + a.id) % 3)) { a._skip = Math.min(0.5, (a._skip || 0) + dt); continue; }
      a.update(dt + (a._skip || 0));
      a._skip = 0;
    }
    updateHeld(this);
    this.audio.update(dt);
    this.day.update(dt, p ? p.object.position : this.camera.position);
    if (p) this.follow.update(dt, p, { speed: p.speed, driving: p.vehicle || null });
    this.prompt = null;
    if (p && p.state !== 'driving' && !p.busy && !p.goal) {
      this.prompt = this.vehiclePrompt?.(p) || this.interactions.best(p) || this.crowd?.talkPrompt(p) || heldInteraction(this, p);
    }
    this.hud?.update(dt);
    if (render) this.render();
    this.input.endFrame();
  }

  // Change who you are: same place, same facing, new body (or new clothes).
  swapPlayer(modelKey, restyle = false) {
    const old = this.player;
    if (!old || old.state !== 'free') return;
    const r = rng(Math.floor(Math.random() * 1e9));
    const look = restyle || modelKey !== old.modelKey ? randomLook(modelKey, r) : old.appearance;
    const a = this.addActor(modelKey, look, { name: 'You', voice: old.voice });
    a.place(old.object.position.x, old.object.position.y, old.object.position.z, old.heading);
    if (old.held) { a.held = old.held; old.held = null; }
    this.removeActor(old);
    this.setPlayer(a);
    this.audio?.blip(760, 0.08);
  }

  useInteraction() {
    const it = this.prompt;
    if (it) it.act(this.player, this);
  }

  render() {
    if (this.composer) {
      // Bloom works on linear HDR values, and the daytime sky alone is far
      // above any usable threshold: measured, even a threshold of 3.5 hazed
      // noon white. So bloom is a night effect only (lamps, neon, windows).
      const n = this.day.night;
      this.bloom.enabled = n > 0.08;
      this.bloom.threshold = 0.85;
      this.bloom.strength = 0.6 * Math.min(1, (n - 0.08) / 0.5);
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
