// Actor: one character in the world — body, animation, and the verbs a
// director would use (walk here, sit there, say this, look at her).
//
// Everything that moves a character goes through this class, whether the
// mover is the keyboard, an NPC's routine, or (later) a script being staged.
// That is deliberate: the studio this city becomes needs every behaviour the
// player can do to be callable as a command.
import * as THREE from 'three';
import { STAND_AT_SEAT, BED_IN } from './clips.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

// Bone masks for upper-body layers played over walking.
const ARM_R = ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];
const ARM_L = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'];
const FINGERS = (side) => ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((j) => `${side}Hand${f}${j}`));
const MASKS = {
  armR: [...ARM_R, ...FINGERS('Right')],
  arms: [...ARM_R, ...ARM_L, ...FINGERS('Right'), ...FINGERS('Left')],
  upper: ['Spine1', 'Spine2', 'Neck', 'Head', ...ARM_R, ...ARM_L, ...FINGERS('Right'), ...FINGERS('Left')],
};

// Emotes: which clip, whether it can play over walking (and on which bones),
// and whether it loops until cancelled.
export const EMOTES = {
  wave: { clip: 'wave', mask: 'armR', seated: 'sit_wave', time: 2.6 },
  point: { clip: 'point', mask: 'armR', time: 2.4 },
  cheer: { clip: 'cheer', mask: 'arms', time: 2.4 },
  clap: { clip: 'clap', mask: 'arms', time: 2.7 },
  phone: { clip: 'phone', mask: 'armR', loop: true },
  arms_crossed: { clip: 'arms_crossed', mask: 'arms', loop: true },
  hands_hips: { clip: 'hands_hips', mask: 'arms', loop: true },
  think: { clip: 'think', mask: 'arms', loop: true },
  shrug: { clip: 'shrug', mask: 'arms', time: 1.4 },
  facepalm: { clip: 'facepalm', mask: 'upper', time: 2.2 },
  bow: { clip: 'bow', full: true, time: 2.0 },
  dance: { clip: 'dance', full: true, loop: true },
  samba: { clip: 'samba', full: true, loop: true },
  sit_ground: { clip: 'sit_ground', full: true, loop: true },
  sunbathe: { clip: 'sunbathe', full: true, loop: true },
  crouch: { clip: 'crouch', full: true, loop: true },
  agree: { clip: 'agree', mask: 'upper', time: 2.5 },
  headshake: { clip: 'headshake', mask: 'upper', time: 2.2 },
  talk: { clip: 'talk', mask: 'arms', loop: true },
};

let _nextId = 1;

export class Actor {
  constructor(cast, modelKey, look = {}, { name = 'someone', voice = null } = {}) {
    this.id = _nextId++;
    this.cast = cast;
    this.modelKey = modelKey;
    this.name = name;
    this.appearance = look;
    const inst = cast.instance(modelKey, look);
    this.def = inst.def;
    this.file = inst.def.file;
    this.rig = inst.rig;
    this.bones = inst.bones;
    this.morphs = inst.morphs;
    this.voice = voice || (inst.def.sex === 'f' ? 'woman' : 'man');
    this.sex = inst.def.sex;
    this.height = inst.def.height;
    this.object = new THREE.Group();
    this.object.name = `actor:${name}`;
    this.object.add(inst.root);
    this.object.userData.actor = this;
    this.model = inst.root;

    // Motion state, written by controllers and the physics step.
    this.heading = 0;              // radians; 0 faces +Z
    this.velocity = new THREE.Vector3();
    this.speed = 0;                // horizontal ground speed, m/s
    this.grounded = true;
    this.airTime = 0;
    this.radius = 0.28;
    this.intent = { dir: new THREE.Vector3(), speed: 0, jump: false, face: null };
    this.state = 'free';           // free | seated | lying | action | driving | busy
    this.seat = null;
    this.busy = false;             // transition in progress: ignore intent

    this.mixer = new THREE.AnimationMixer(inst.skeletonRoot);
    this.skeletonRoot = inst.skeletonRoot;
    this.mixer.addEventListener('finished', (e) => this._onFinished(e));
    this.loco = {
      idle: this._action(this.def.idle),
      walk: this._action(this.def.walk),
      run: this._action('run'),
      weight: 1,
      phase: 0,
    };
    for (const k of ['idle', 'walk', 'run']) { this.loco[k].play(); this.loco[k].setEffectiveWeight(0); }
    this.loco.walkSpeed = cast.naturalSpeed(this.file, this.def.walk);
    this.loco.runSpeed = cast.naturalSpeed(this.file, 'run');
    this.full = [];                // [{action, weight, target, rate, name, onDone}]
    this.layer = null;             // upper-body overlay {clip, interps, time, weight, target, mask, loop, until}
    this.look = { target: null, weight: 0, yaw: 0, pitch: 0, auto: null };
    this.speech = { active: false, until: 0, level: 0 };
    this.talkLayerOwned = false;
    this._t = 0;
  }

  _action(name, opts) {
    const clip = this.cast.clip(this.file, name, opts);
    return this.mixer.clipAction(clip);
  }

  get position() { return this.object.position; }

  place(x, y, z, heading = this.heading) {
    this.object.position.set(x, y, z);
    this.heading = heading;
    this.object.rotation.y = heading;
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  // ------------------------------------------------------------------
  // Full-body clips (sit, lie, dance...). Weighted list, crossfaded.

  playFull(name, { opts, fade = 0.25, loop, rate = 1, onDone, instant = false } = {}) {
    const clip = this.cast.clip(this.file, name, opts);
    const action = this.mixer.clipAction(clip);
    const looping = loop ?? this.cast.isLooping(name);
    action.reset();
    action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.timeScale = rate;
    action.play();
    const entry = { action, name, weight: instant ? 1 : 0, target: 1, fade: Math.max(0.001, fade), onDone };
    for (const f of this.full) { if (f.action === action) continue; f.target = 0; f.fade = entry.fade; if (instant) f.weight = 0; }
    this.full = this.full.filter((f) => f.action !== action);
    this.full.push(entry);
    return entry;
  }

  stopFull(fade = 0.3) {
    for (const f of this.full) { f.target = 0; f.fade = fade; }
  }

  get fullName() {
    const f = this.full[this.full.length - 1];
    return f && f.target > 0 ? f.name : null;
  }

  _onFinished(e) {
    const f = this.full.find((x) => x.action === e.action);
    if (f && f.onDone && f.target > 0) { const cb = f.onDone; f.onDone = null; cb(); }
  }

  // ------------------------------------------------------------------
  // Upper-body layer (wave while walking, talk, phone).

  playLayer(name, { mask = 'upper', loop = false, time = null, fade = 0.25, opts } = {}) {
    const clip = this.cast.clip(this.file, name, opts);
    const keep = new Set(MASKS[mask] || mask);
    const interps = [];
    for (const tr of clip.tracks) {
      const [bone, prop] = tr.name.split('.');
      const n = bone.replace(/^mixamorig[:_]?/, '');
      if (prop !== 'quaternion' || !keep.has(n) || !this.bones.has(n)) continue;
      interps.push({ bone: this.bones.get(n), interp: tr.createInterpolant(new Float32Array(4)) });
    }
    this.layer = { name, clip, interps, t: 0, weight: this.layer ? this.layer.weight : 0, target: 1, fade, loop, until: time ?? (loop ? Infinity : clip.duration) };
  }

  stopLayer(fade = 0.3) { if (this.layer) { this.layer.target = 0; this.layer.fade = fade; } }

  // ------------------------------------------------------------------
  // Verbs.

  // Emote by name; picks full-body or layered form from context.
  emote(name) {
    const e = EMOTES[name];
    if (!e || this.busy) return false;
    if (this.state === 'seated') {
      if (e.seated) { this.playLayer(e.seated, { mask: 'upper', loop: false, time: e.time, opts: { h: this.seat.h } }); return true; }
      if (e.full) return false;
      this.playLayer(e.clip, { mask: e.mask, loop: e.loop, time: e.time });
      return true;
    }
    if (this.state !== 'free') return false;
    if (e.full) {
      this.state = 'action';
      this.playFull(e.clip, { loop: e.loop, onDone: () => this.endAction() });
      return true;
    }
    this.playLayer(e.clip, { mask: e.mask, loop: e.loop, time: e.time });
    return true;
  }

  endAction() {
    if (this.state === 'action') { this.state = 'free'; this.stopFull(0.35); }
  }

  cancel() {
    if (this.state === 'action') this.endAction();
    if (this.layer && this.layer.loop && this.layer.name !== 'talk') this.stopLayer();
  }

  // seat: { pos: Vector3 (floor under pelvis), heading, h, kind, opts }
  // The actor must already be standing at seat.standPoint facing seat.heading.
  sit(seat, then) {
    if (this.state !== 'free' || this.busy) return false;
    this.busy = true;
    this.seat = seat;
    this.state = 'seated';
    const opts = { h: seat.h, ...(seat.opts || {}) };
    const loopName = seat.loop || 'sit';
    if (seat.hop) {
      // Slide onto the seat while crossfading into sitting.
      const from = this.object.position.clone(), fromH = this.heading;
      let dh = seat.heading - fromH; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.playFull(loopName, { opts, fade: 0.4 });
      this.hopAnim = { t: 0, dur: 0.4, from, to: seat.pos.clone(), fromH, dh, done: () => { this.busy = false; then?.(); } };
      return true;
    }
    this.playFull('sit_down', {
      opts,
      fade: 0.2,
      onDone: () => {
        this.place(seat.pos.x, seat.pos.y, seat.pos.z, seat.heading);
        this.playFull(loopName, { opts, instant: true });
        this.busy = false;
        then?.();
      },
    });
    return true;
  }

  stand(then) {
    if (this.state === 'lying') { this.getUp(() => this.stand(then)); return true; }
    if (this.state !== 'seated' || this.busy) return false;
    this.busy = true;
    const seat = this.seat;
    const opts = { h: seat.h, ...(seat.opts || {}) };
    if (seat.hop) {
      this.stopFull(0.4);
      const from = this.object.position.clone();
      this.hopAnim = { t: 0, dur: 0.4, from, to: seat.standPoint.clone().setY(seat.floorY ?? seat.pos.y), fromH: this.heading, dh: 0, done: () => {
        this.state = 'free'; this.seat = null; this.busy = false; seat.occupant = null; then?.();
      } };
      return true;
    }
    const f = this.forward(_v);
    this.place(seat.pos.x + f.x * STAND_AT_SEAT, seat.floorY ?? seat.pos.y, seat.pos.z + f.z * STAND_AT_SEAT, seat.heading);
    this.playFull('stand_up', {
      opts,
      instant: true,
      onDone: () => {
        this.stopFull(0.25);
        this.state = 'free';
        this.seat = null;
        this.busy = false;
        seat.occupant = null;
        then?.();
      },
    });
    return true;
  }

  // From seated on a bed's edge, lie back. seat must carry `bed: true`.
  lieDown(then) {
    if (this.state !== 'seated' || this.busy || !this.seat?.bed) return false;
    this.busy = true;
    const opts = { h: this.seat.h };
    this.playFull('lie_down', {
      opts,
      fade: 0.15,
      onDone: () => {
        const f = this.forward(_v);
        this.place(this.seat.pos.x - f.x * BED_IN, this.seat.pos.y, this.seat.pos.z - f.z * BED_IN, this.seat.heading - Math.PI / 2);
        this.playFull(this.seat.lieLoop || 'lie', { opts, instant: true });
        this.state = 'lying';
        this.busy = false;
        then?.();
      },
    });
    return true;
  }

  getUp(then) {
    if (this.state !== 'lying' || this.busy) return false;
    this.busy = true;
    const seat = this.seat;
    this.place(seat.pos.x, seat.pos.y, seat.pos.z, seat.heading);
    this.playFull('lie_down', {
      opts: { h: seat.h },
      instant: true,
      rate: -1,
    });
    // Played backwards: start from the end.
    const e = this.full[this.full.length - 1];
    e.action.time = e.action.getClip().duration;
    e.action.paused = false;
    e.action.setLoop(THREE.LoopOnce, 1);
    e.onDone = () => {
      this.playFull('sit', { opts: { h: seat.h }, instant: true });
      this.state = 'seated';
      this.busy = false;
      then?.();
    };
    return true;
  }

  // Speech is voiced by the speech system; the actor only animates it.
  setSpeaking(on, duration = 0) {
    this.speech.active = on;
    this.speech.until = on ? this._t + duration : 0;
    if (on && this.state === 'free' && (!this.layer || this.layer.target === 0 || this.layer.name === 'talk')) {
      this.playLayer('talk', { mask: 'arms', loop: true });
      this.talkLayerOwned = true;
    } else if (on && this.state === 'seated' && (!this.layer || this.layer.target === 0)) {
      this.playLayer('sit_talk', { mask: ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', ...FINGERS('Right')], loop: true, opts: { h: this.seat.h } });
      this.talkLayerOwned = true;
    }
    if (!on && this.talkLayerOwned) { this.stopLayer(0.5); this.talkLayerOwned = false; }
  }

  lookAt(target) { this.look.target = target; }

  // ------------------------------------------------------------------

  update(dt) {
    this._t += dt;
    if (this.hopAnim) {
      const h = this.hopAnim;
      h.t += dt;
      const u = Math.min(1, h.t / h.dur), e = u * u * (3 - 2 * u);
      this.object.position.lerpVectors(h.from, h.to, e);
      this.heading = h.fromH + h.dh * e;
      if (u >= 1) { this.hopAnim = null; h.done(); }
    }
    this.object.rotation.y = this.heading;
    this._updateLocomotion(dt);
    // Full-body weights.
    let fullW = 0;
    for (const f of this.full) {
      const step = dt / f.fade;
      f.weight = f.target > f.weight ? Math.min(f.target, f.weight + step) : Math.max(f.target, f.weight - step);
      fullW += f.weight;
    }
    for (const f of this.full) {
      if (f.weight <= 0 && f.target === 0) { f.action.stop(); }
    }
    this.full = this.full.filter((f) => !(f.weight <= 0 && f.target === 0));
    const locoW = Math.max(0, 1 - Math.min(1, fullW));
    const norm = fullW > 1 ? 1 / fullW : 1;
    for (const f of this.full) f.action.setEffectiveWeight(f.weight * norm);
    const lw = this.loco.w;
    this.loco.idle.setEffectiveWeight(lw.idle * locoW);
    this.loco.walk.setEffectiveWeight(lw.walk * locoW);
    this.loco.run.setEffectiveWeight(lw.run * locoW);
    this.mixer.update(dt);
    this._applyLayer(dt);
    this._applyLook(dt);
    this._applyMouth(dt);
    if (this.speech.active && this.speech.until && this._t > this.speech.until) this.setSpeaking(false);
  }

  _updateLocomotion(dt) {
    const L = this.loco;
    const s = this.grounded ? this.speed : 0;
    // Blend weights by speed: idle -> walk -> run.
    let wi = 0, ww = 0, wr = 0;
    const ws = L.walkSpeed, rs = L.runSpeed;
    if (s < 0.15) wi = 1;
    else if (s < ws * 0.8) { const k = (s - 0.15) / (ws * 0.8 - 0.15); wi = 1 - k; ww = k; }
    else if (s < ws * 1.25) ww = 1;
    else if (s < rs * 0.85) { const k = (s - ws * 1.25) / (rs * 0.85 - ws * 1.25); ww = 1 - k; wr = k; }
    else wr = 1;
    // Smooth weight changes a little so stops don't snap.
    const prev = L.w || { idle: 1, walk: 0, run: 0 };
    const k = Math.min(1, dt * 10);
    L.w = { idle: prev.idle + (wi - prev.idle) * k, walk: prev.walk + (ww - prev.walk) * k, run: prev.run + (wr - prev.run) * k };
    // Walk and run share one phase so crossfades keep feet in step. The
    // cycle rate follows real ground speed: that is what stops foot sliding.
    const walkDur = L.walk.getClip().duration, runDur = L.run.getClip().duration;
    const moveW = L.w.walk + L.w.run;
    if (moveW > 0.001) {
      const wRun = L.w.run / moveW;
      const natural = ws + (rs - ws) * wRun;
      const dur = walkDur + (runDur - walkDur) * wRun;
      const rate = Math.min(1.6, Math.max(0.55, s / natural));
      L.phase = (L.phase + (dt * rate) / dur) % 1;
    }
    L.walk.time = L.phase * walkDur;
    L.run.time = L.phase * runDur;
    L.walk.timeScale = 0; L.run.timeScale = 0;
  }

  _applyLayer(dt) {
    const Ly = this.layer;
    if (!Ly) return;
    Ly.t += dt;
    const step = dt / Ly.fade;
    if (Ly.t > Ly.until && Ly.target > 0) Ly.target = 0;
    Ly.weight = Ly.target > Ly.weight ? Math.min(1, Ly.weight + step) : Math.max(0, Ly.weight - step);
    if (Ly.weight <= 0 && Ly.target === 0) { this.layer = null; return; }
    const d = Ly.clip.duration;
    const t = Ly.loop ? Ly.t % d : Math.min(Ly.t, d);
    const w = ease(Ly.weight);
    for (const { bone, interp } of Ly.interps) {
      const r = interp.evaluate(t);
      _q.fromArray(r);
      bone.quaternion.slerp(_q, w);
    }
  }

  // Turn neck and head toward a point, within human limits, after the
  // animation has posed them. Split 40/60 between neck and head.
  _applyLook(dt) {
    const L = this.look;
    const head = this.bones.get('Head');
    const neck = this.bones.get('Neck');
    let tYaw = 0, tPitch = 0, want = 0;
    const tgt = L.target && (L.target.isVector3 ? L.target : L.target.headPosition?.());
    if (tgt && (this.state === 'free' || this.state === 'seated' || this.state === 'action')) {
      this.object.updateMatrixWorld(true);
      head.getWorldPosition(_v);
      _v2.copy(tgt).sub(_v);
      // Into the actor's local frame.
      _v2.applyAxisAngle(UP, -this.heading);
      tYaw = Math.atan2(_v2.x, _v2.z);
      tPitch = -Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
      if (Math.abs(tYaw) < 1.9) want = 1;
      tYaw = Math.max(-1.2, Math.min(1.2, tYaw));
      tPitch = Math.max(-0.5, Math.min(0.6, tPitch));
    }
    const k = Math.min(1, dt * 4);
    L.weight += (want - L.weight) * k;
    L.yaw += (tYaw - L.yaw) * k;
    L.pitch += (tPitch - L.pitch) * k;
    if (L.weight < 0.01) return;
    // World-space rotation about the actor's up and right axes.
    this.object.updateMatrixWorld(true);
    const right = _v.set(1, 0, 0).applyAxisAngle(UP, this.heading);
    for (const [bone, share] of [[neck, 0.4], [head, 0.6]]) {
      if (!bone) continue;
      const yawQ = _q.setFromAxisAngle(UP, L.yaw * share * L.weight);
      const pitchQ = _q2.setFromAxisAngle(right, L.pitch * share * L.weight);
      const delta = yawQ.multiply(pitchQ);
      bone.parent.updateMatrixWorld(true);
      const parentQ = new THREE.Quaternion();
      bone.parent.getWorldQuaternion(parentQ);
      const worldQ = parentQ.clone().multiply(bone.quaternion);
      worldQ.premultiply(delta);
      bone.quaternion.copy(parentQ.invert().multiply(worldQ));
    }
  }

  _applyMouth(dt) {
    if (!this.morphs.length) return;
    const s = this.speech;
    let target = 0;
    if (s.active) {
      // Syllable-rate flapping; the speech system can also push `level`.
      target = 0.25 + 0.35 * Math.max(0, Math.sin(this._t * 21) * Math.sin(this._t * 7.3 + 1));
    }
    s.level += (target - s.level) * Math.min(1, dt * 18);
    for (const m of this.morphs) m.morphTargetInfluences[m.morphTargetDictionary.mouthOpen] = s.level;
  }

  headPosition(out = new THREE.Vector3()) {
    const h = this.bones.get('Head');
    if (!h) return out.copy(this.object.position).setY(this.object.position.y + this.height * 0.93);
    h.getWorldPosition(out);
    return out;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}

function ease(x) { return x * x * (3 - 2 * x); }
