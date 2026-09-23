// Sims: an Actor with needs, a queue of things to do, and the patience to
// walk round the furniture to do them.
//
// A task is a list of steps (go, sit, lie, stand, anim, wait, say, call).
// Steps are plain data, so the same list a click builds today is what a
// screenplay line will build for the studio later: "Maya sits on the sofa
// and watches TV" is go -> sit -> wait.
import * as THREE from 'three';
import { approach } from '../game/interact.js';
import { EMOTES } from '../core/actor.js';

export const NEEDS = [
  { id: 'hunger', name: 'Hunger', decay: 0.11 },
  { id: 'energy', name: 'Energy', decay: 0.065 },
  { id: 'bladder', name: 'Bladder', decay: 0.13 },
  { id: 'hygiene', name: 'Hygiene', decay: 0.06 },
  { id: 'fun', name: 'Fun', decay: 0.12 },
  { id: 'social', name: 'Social', decay: 0.09 },
];

const _v = new THREE.Vector3();

export class Sim {
  constructor(game, actor, { name, voice, model, look, needs }) {
    this.game = game;
    this.actor = actor;
    this.name = name;
    this.voice = voice;
    this.model = model;
    this.look = look;
    actor.voice = voice;
    actor.sim = this;
    this.needs = Object.fromEntries(NEEDS.map((n) => [n.id, needs?.[n.id] ?? 70]));
    this.queue = [];
    this.task = null;
    this.idle = 0;
    this.autonomous = true;
  }

  get pos() { return this.actor.object.position; }
  mood() { return NEEDS.reduce((s, n) => s + this.needs[n.id], 0) / NEEDS.length; }

  gain(g, k = 1) {
    for (const [id, v] of Object.entries(g || {})) this.needs[id] = THREE.MathUtils.clamp(this.needs[id] + v * k, 0, 100);
  }

  // Add to the queue; `now` drops whatever is queued and interrupts.
  push(task, { now = false } = {}) {
    if (now) { this.queue = []; if (this.task) this.task.cancel(); }
    if (this.queue.length >= 6) return;
    this.queue.push(task);
    this.idle = 0;
  }

  cancel(task) {
    if (task === this.task) task.cancel();
    else this.queue = this.queue.filter((t) => t !== task);
  }

  cancelAll() { this.queue = []; this.task?.cancel(); }

  update(dt, live) {
    if (live) {
      for (const n of NEEDS) this.needs[n.id] = Math.max(0, this.needs[n.id] - n.decay * dt);
      if (this.task?.gains) this.gain(this.task.gains, dt);
    }
    // Furniture sold out from under someone: stand them up where they are.
    if (this.actor.seat?.removed) forceFree(this.actor);
    if (!live) return;
    if (!this.task && this.queue.length) {
      this.task = this.queue.shift();
      this.task.start(this);
    }
    if (this.task) {
      const r = this.task.update(dt);
      if (r !== 'run') {
        if (r === 'fail' && this.task.why && this.game.onSimNote) this.game.onSimNote(this, this.task.why);
        // A seat claimed for a task that ended without sitting is free again.
        const c = this.task.claimed;
        if (c && c.occupant === this.actor && this.actor.state === 'free') c.occupant = null;
        if (r === 'fail' && this.task.item && this.task.auto) (this.avoid = this.avoid || new Map()).set(this.task.item.uid, this.game.time + 20);
        this.task = null;
      }
      this.idle = 0;
    } else {
      this.idle += dt;
    }
  }

  // The same sim in different clothes.
  restyle(look) {
    const old = this.actor;
    const a = this.game.addActor(this.model, look, { name: this.name, voice: this.voice });
    a.place(old.object.position.x, old.object.position.y, old.object.position.z, old.heading);
    a.sim = this;
    a.isPlayer = old.isPlayer;
    this.game.removeActor(old);
    this.actor = a;
    this.look = look;
  }
}

// Stand someone up immediately (their seat is gone, or a menu says so).
export function forceFree(a) {
  const seat = a.seat;
  a.stopFull(0.2);
  a.hopAnim = null;
  a.goal = null;
  if (seat) {
    seat.occupant = null;
    if (seat.standPoint) a.place(seat.standPoint.x, seat.floorY ?? a.object.position.y, seat.standPoint.z, a.heading);
  }
  a.state = 'free';
  a.busy = false;
  a.seat = null;
  a.stopLayer?.(0.2);
}

// ---------------------------------------------------------------- tasks

export class Task {
  // spec: { label, icon, steps, item, other, ad, voiced }
  constructor(spec) {
    Object.assign(this, spec);
    this.i = -1;
    this.step = null;
    this.cancelling = false;
    this.gains = null;
  }

  start(sim) {
    this.sim = sim;
    this.next();
  }

  next() {
    this.i++;
    this.gains = null;
    const s = this.steps[this.i];
    if (!s) { this.step = null; return; }
    this.step = { spec: s, t: 0, state: {} };
    const r = STEPS[s.type].start(this.sim, s, this.step.state, this);
    if (r === 'fail') this.failed = true;
    if (r === 'done') this.next();
  }

  update(dt) {
    if (this.failed) return this.finishFail();
    if ((this.item && this.item.removed) || (this.other && this.other.gone)) { this.why = this.why || null; return this.finishFail(); }
    if (!this.step) return 'done';
    const s = this.step;
    s.t += dt;
    const r = STEPS[s.spec.type].update(this.sim, s.spec, s.state, dt, this, s.t);
    if (r === 'fail') return this.finishFail();
    if (r === 'done') {
      if (this.cancelling && !s.spec.always) return this.wrapUp();
      this.next();
      if (this.failed) return this.finishFail();
      return this.step ? 'run' : 'done';
    }
    return 'run';
  }

  // Cancel politely: a sim who is sitting stands, a dancer stops.
  cancel() {
    if (this.cancelling) return;
    this.cancelling = true;
    const s = this.step;
    if (s && STEPS[s.spec.type].interrupt) STEPS[s.spec.type].interrupt(this.sim, s.spec, s.state, this);
  }

  wrapUp() {
    // Keep only the steps that restore a normal pose.
    const rest = this.steps.slice(this.i + 1).filter((s) => s.always);
    this.steps = [...this.steps.slice(0, this.i + 1), ...rest];
    this.cancelling = false;
    this.next();
    return this.step ? 'run' : 'done';
  }

  finishFail() {
    const a = this.sim.actor;
    if (this.claimed && this.claimed.occupant === a && a.state === 'free') this.claimed.occupant = null;
    if (a.state === 'action') a.endAction();
    a.goal = null;
    a.intent.speed = 0;
    return 'fail';
  }
}

const STEPS = {
  // Walk (round things) to a point; `exact` ends with a slide onto it.
  go: {
    start(sim, s, st, task) {
      const a = sim.actor;
      if (a.state !== 'free') {
        // Stand up first; the walk begins when that's done.
        if (a.state === 'lying') a.getUp(() => a.stand());
        else if (a.state === 'seated') a.stand();
        else if (a.state === 'action') a.endAction();
        st.waitFree = true;
        return;
      }
      return STEPS.go.plan(sim, s, st, task);
    },
    plan(sim, s, st, task) {
      const a = sim.actor;
      const p = a.object.position;
      const to = typeof s.to === 'function' ? s.to() : s.to;
      if (!to) { task.why = 'Nowhere to go'; return 'fail'; }
      st.to = to;
      const stop = s.near || 0;
      if (Math.hypot(to.x - p.x, to.z - p.z) <= Math.max(stop, 0.05)) { st.arrived = true; return STEPS.go.arrive(sim, s, st); }
      const path = sim.game.nav.find(p.x, p.z, to.x, to.z);
      if (!path) { task.why = `${sim.name} can't get there`; return 'fail'; }
      st.path = path;
      st.k = 1;
      st.stuck = 0; st.checkT = 0; st.lastPos = null;
    },
    arrive(sim, s, st) {
      const a = sim.actor;
      a.intent.speed = 0;
      if (s.exact) {
        st.sliding = true;
        const h = s.face ?? a.heading;
        approach(a, st.to, h, () => { st.done = true; }, { speed: 1.3, slide: 0.3 });
      } else if (s.lookAt) {
        const t = typeof s.lookAt === 'function' ? s.lookAt() : s.lookAt;
        st.face = Math.atan2(t.x - a.object.position.x, t.z - a.object.position.z);
        st.faceT = 0;
      } else st.done = true;
    },
    update(sim, s, st, dt, task) {
      const a = sim.actor;
      if (st.waitFree) {
        if (a.state !== 'free' || a.busy) return 'run';
        st.waitFree = false;
        const r = STEPS.go.plan(sim, s, st, task);
        if (r === 'fail') return r;
      }
      if (st.done) return 'done';
      if (st.face !== undefined) {
        st.faceT += dt;
        let d = st.face - a.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        a.heading += d * Math.min(1, dt * 8);
        return Math.abs(d) < 0.05 || st.faceT > 0.8 ? 'done' : 'run';
      }
      if (st.sliding) { if (!a.goal) st.done = true; return 'run'; }
      if (task.cancelling) { a.intent.speed = 0; return 'done'; }
      const p = a.object.position;
      const w = st.path[st.k];
      const last = st.k === st.path.length - 1;
      const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
      const stop = last ? Math.max(s.near || 0, s.exact ? 0.4 : 0.2) : 0.3;
      if (d < stop) {
        if (!last) { st.k++; return 'run'; }
        STEPS.go.arrive(sim, s, st);
        return 'run';
      }
      a.intent.dir.set(dx / d, 0, dz / d);
      a.intent.speed = Math.min(s.speed || 1.35, 0.5 + d * 1.8);
      a.intent.face = null;
      // Stuck behind someone: try a fresh path, then give up. Progress is
      // real movement, not closeness to the goal: a path round a house
      // walks away from its goal for a while.
      st.checkT = (st.checkT || 0) + dt;
      if (!st.lastPos) st.lastPos = p.clone();
      if (st.checkT > 1) {
        const moved = Math.hypot(p.x - st.lastPos.x, p.z - st.lastPos.z);
        st.stuck = moved < 0.25 ? st.stuck + st.checkT : 0;
        st.checkT = 0;
        st.lastPos.copy(p);
      }
      if (st.stuck > 2.5) {
        if (st.replanned) { a.intent.speed = 0; task.why = `${sim.name} is stuck`; return 'fail'; }
        st.replanned = true; st.stuck = 0;
        const r = STEPS.go.plan(sim, s, st, task);
        if (r === 'fail') { a.intent.speed = 0; return r; }
      }
      return 'run';
    },
    interrupt(sim, s, st) { if (!st.sliding) sim.actor.intent.speed = 0; },
  },

  // Take a seat (walks the last metre and sits, or hops on a stool).
  sit: {
    start(sim, s, st, task) {
      const a = sim.actor;
      const seat = typeof s.seat === 'function' ? s.seat() : s.seat;
      if (!seat || seat.removed) { task.why = 'That seat is gone'; return 'fail'; }
      if (a.state === 'seated' && a.seat === seat) return 'done';
      if (seat.occupant && seat.occupant !== a) { task.why = 'Someone is sitting there'; return 'fail'; }
      seat.occupant = a;
      task.claimed = seat;
      st.seat = seat;
      approach(a, seat.standPoint, seat.hop ? seat.heading - Math.PI / 2 : seat.heading, () => {
        const ok = a.sit(seat, () => { st.done = true; seat.onSit?.(a); });
        if (!ok) { seat.occupant = null; st.failed = true; }
      }, { speed: 1.2 });
    },
    update(sim, s, st, dt, task, t) {
      if (st.failed) { task.why = 'Could not sit'; return 'fail'; }
      if (t > 12 && !st.done) { task.why = 'Could not reach the seat'; return 'fail'; }
      return st.done ? 'done' : 'run';
    },
  },

  lie: {
    start(sim, s, st) { if (sim.actor.state === 'lying') return 'done'; st.ok = sim.actor.lieDown(() => { st.done = true; }); },
    update(sim, s, st) { if (!st.ok) return 'fail'; return st.done ? 'done' : 'run'; },
  },

  stand: {
    start(sim, s, st) {
      const a = sim.actor;
      if (a.state === 'action') a.endAction();
      if (a.state === 'free') return 'done';
      const seat = a.seat;
      const done = () => { st.done = true; seat?.onStand?.(a); };
      if (a.state === 'lying') a.getUp(() => a.stand(done));
      else a.stand(done);
    },
    update(sim, s, st, dt, task, t) {
      const a = sim.actor;
      if (st.done || (a.state === 'free' && !a.busy)) return 'done';
      if (t > 8) { forceFree(a); return 'done'; }
      return 'run';
    },
  },

  // An emote, or a layered gesture, for a time.
  anim: {
    start(sim, s, st) {
      const a = sim.actor;
      const e = EMOTES[s.name];
      if (e) { a.emote(s.name); st.emote = e; }
      else a.playLayer(s.name, { mask: s.mask || 'arms', loop: !!s.loop, time: s.time });
    },
    update(sim, s, st, dt, task, t) {
      if (s.gains) task.gains = s.gains;
      if (t >= (s.time ?? st.emote?.time ?? 2)) { STEPS.anim.stop(sim, s, st); return 'done'; }
      if (task.cancelling) { STEPS.anim.stop(sim, s, st); return 'done'; }
      return 'run';
    },
    stop(sim, s, st) {
      const a = sim.actor;
      if (st.emote?.full || st.emote?.loop) a.cancel();
      if (s.loop || st.emote?.loop) a.stopLayer?.(0.3);
    },
  },

  // Stay put while a need fills: until full, or for `time` seconds.
  wait: {
    start(sim, s) { s.onStart?.(sim); },
    update(sim, s, st, dt, task, t) {
      task.gains = s.gains || null;
      const full = s.until && sim.needs[s.until] >= 99.5;
      if (task.cancelling || full || t >= (s.time ?? 1e9)) { s.onEnd?.(sim); return 'done'; }
      s.each?.(sim, dt, t);
      return 'run';
    },
    interrupt(sim, s) { /* the update notices `cancelling` */ },
  },

  say: {
    start(sim, s, st, task) {
      const text = typeof s.text === 'function' ? s.text() : s.text;
      const who = s.who ? (typeof s.who === 'function' ? s.who() : s.who) : sim;
      if (!text || !who) return 'done';
      sim.game.speech.say(who.actor, text, { voice: who.voice, voiced: s.voiced ?? task.voiced ?? false, priority: 1 });
      st.dur = Math.max(1.4, text.split(/\s+/).length / 2.6 + 0.6);
    },
    update(sim, s, st, dt, task, t) { return t >= (s.wait === false ? 0 : st.dur) ? 'done' : 'run'; },
  },

  face: {
    start(sim, s, st) {
      const t = typeof s.to === 'function' ? s.to() : s.to;
      if (!t) return 'done';
      const p = sim.actor.object.position;
      st.h = Math.atan2(t.x - p.x, t.z - p.z);
    },
    update(sim, s, st, dt, task, t) {
      const a = sim.actor;
      if (a.state !== 'free') return 'done';
      let d = st.h - a.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      a.heading += d * Math.min(1, dt * 8);
      return Math.abs(d) < 0.05 || t > 0.8 ? 'done' : 'run';
    },
  },

  call: {
    start(sim, s, st, task) { const r = s.fn(sim, task); return r === false ? 'fail' : 'done'; },
    update() { return 'done'; },
  },
};

// Step helpers, so tasks read like sentences.
export const go = (to, o = {}) => ({ type: 'go', to, ...o });
export const sit = (seat) => ({ type: 'sit', seat });
export const lie = () => ({ type: 'lie' });
export const stand = () => ({ type: 'stand', always: true });
export const anim = (name, o = {}) => ({ type: 'anim', name, ...o });
export const wait = (o) => ({ type: 'wait', ...o });
export const say = (text, o = {}) => ({ type: 'say', text, ...o });
export const face = (to) => ({ type: 'face', to });
export const call = (fn, o = {}) => ({ type: 'call', fn, ...o });

export function headOf(sim) { return sim.actor.headPosition(_v.clone()); }
