// The people of Port Solana: walkers on the sidewalks, sitters on benches,
// sunbathers, staff behind counters, patrons in booths. Each has a small
// routine (walk somewhere, do something, pick again) and reacts to the
// player: bumps, waves, and conversation.
import * as THREE from 'three';
import { randomLook } from '../core/cast.js';
import { sitActor } from './seats.js';
import { approach } from './interact.js';
import { buildNavGraph } from './navgraph.js';
import { rng } from '../world/textures.js';
import { NAMES, CHATTER, BUMPED, BUMPED_HARD, WAVE_BACK, STAFF_GREET, GREETINGS, replyTo, pick } from './lines.js';
import { EMOTES } from '../core/actor.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const HANG_EMOTES = ['phone', 'arms_crossed', 'think', 'hands_hips', null, null];

export class Crowd {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.npcs = [];
    this.r = rng(4242);
    this.graph = buildNavGraph(this.world);
    this.talking = null;           // NPC in conversation with the player
  }

  add(modelKey, role, opts = {}) {
    const r = this.r;
    const look = opts.look || randomLook(modelKey, r);
    const sex = modelKey === 'michelle' || modelKey === 'girl' ? 'f' : 'm';
    const name = opts.name || pick(NAMES[sex], r);
    const actor = this.game.addActor(modelKey, look, { name, voice: sex === 'f' ? 'woman' : 'man' });
    const npc = new NPC(this, actor, role, opts);
    actor.npc = npc;
    actor.onBump = (other) => npc.bumped(other);
    this.npcs.push(npc);
    return npc;
  }

  randomModel() {
    const u = this.r();
    return u < 0.46 ? 'man' : u < 0.7 ? 'girl' : 'michelle';
  }

  spawn({ scale = 1 } = {}) {
    const r = this.r;
    const W = this.world;
    const G = this.graph;
    const n = (k) => Math.max(0, Math.round(k * scale));
    // Walkers, spread over the graph but denser near the beachfront.
    // Most walkers where the player starts (the beachfront); some everywhere.
    for (let i = 0; i < n(34); i++) {
      const near = i < 20;
      const node = G.randomNode(r, (m) => (m.tag === 'walk' || m.tag === 'promenade') && (near ? m.p.x > 100 && Math.abs(m.p.z) < 90 : true));
      const npc = this.add(this.randomModel(), 'walker');
      npc.actor.place(node.p.x + (r() - 0.5) * 1.5, node.p.y, node.p.z + (r() - 0.5) * 1.5, r() * 6.28);
      npc.think();
    }
    // Sitting on benches and the fountain rim.
    const outdoorSeats = W.seats.filter((s) => !s.room && (s.kind === 'bench'));
    shuffle(outdoorSeats, r);
    for (const seat of outdoorSeats.slice(0, n(10))) {
      const npc = this.add(this.randomModel(), 'sitter');
      npc.sitNow(seat, 30 + r() * 90);
    }
    // The beach.
    const towels = [...W.spots.beach];
    shuffle(towels, r);
    for (const t of towels.slice(0, n(7))) {
      const npc = this.add(r() < 0.5 ? 'girl' : this.randomModel(), 'beach');
      npc.actor.place(t.x, t.y, t.z, t.heading);
      npc.doEmote(r() < 0.5 ? 'sunbathe' : 'sit_ground', 60 + r() * 120);
    }
    const loungers = W.seats.filter((s) => s.kind === 'lounger');
    shuffle(loungers, r);
    for (const seat of loungers.slice(0, n(4))) {
      const npc = this.add(this.randomModel(), 'beach');
      npc.lieNow(seat, 60 + r() * 120);
    }
    // At the end of the pier, looking out.
    const end = W.spots.view.find((v) => v.kind === 'pierend');
    if (end) for (let k = 0; k < n(3); k++) {
      const npc = this.add(this.randomModel(), 'hang');
      npc.actor.place(end.x - k * 1.4, end.y, end.z - 2.5 + k * 1.7, Math.PI / 2);
      npc.hang(40 + r() * 60, pick(['phone', 'arms_crossed', null], r));
    }
    // A pair chatting in the park, another by the court.
    for (const v of W.spots.view.filter((s) => s.kind === 'plaza' || s.kind === 'court')) {
      const a = this.add(this.randomModel(), 'chatter');
      const b = this.add(this.randomModel(), 'chatter');
      a.actor.place(v.x + v.r * 0.9, 0.15, v.z + 1.5, 0);
      b.actor.place(v.x + v.r * 0.9 + 1.1, 0.15, v.z + 1.5, 0);
      a.startChat(b, 60 + r() * 60);
    }
    this.spawnInteriors();
  }

  spawnInteriors() {
    const r = this.r;
    for (const room of this.world.rooms) {
      const seats = this.world.seats.filter((s) => s.room === room);
      for (const st of room.staff || []) {
        const model = st.role === 'waitress' || st.role === 'receptionist' ? (r() < 0.5 ? 'michelle' : 'girl') : st.role === 'cook' ? 'man' : this.randomModel();
        const npc = this.add(model, 'staff', { job: st.role });
        const [x, z] = room.w(st.x, st.z);
        npc.actor.place(x, room.y, z, room.yaw + st.heading);
        npc.post = { x, z, heading: room.yaw + st.heading, room };
        npc.state = 'work';
      }
      const want = { diner: 5, bar: 3, office: 4, store: 0, boutique: 1, apartment: 1 }[room.kind] || 0;
      const pool = seats.filter((s) => (room.kind === 'office' ? s.kind === 'desk' : room.kind === 'apartment' ? s.kind === 'sofa' : s.kind !== 'piano'));
      shuffle(pool, r);
      for (const seat of pool.slice(0, want)) {
        const npc = this.add(this.randomModel(), 'patron');
        npc.sitNow(seat, 1e9);
        npc.room = room;
      }
      if (room.kind === 'bar' && room.danceFloor) {
        for (let k = 0; k < 2; k++) {
          const [x, z] = room.w(room.danceFloor.x - 1 + k * 1.8, room.danceFloor.z + (k ? 0.6 : -0.4));
          const npc = this.add(k ? 'michelle' : 'girl', 'dancer');
          npc.actor.place(x, room.y, z, room.yaw + Math.PI + (k ? 0.6 : -0.5));
          npc.doEmote(k ? 'samba' : 'dance', 1e9);
          npc.room = room;
        }
      }
      if (room.kind === 'store') {
        for (let k = 0; k < 2; k++) {
          const [x, z] = room.w(-2 + k * 2.6, -1.35 + k * 2.1);
          const npc = this.add(this.randomModel(), 'patron');
          npc.actor.place(x, room.y, z, room.yaw + (k ? 0 : Math.PI));
          npc.hang(1e9, k ? 'think' : null);
          npc.room = room;
        }
      }
      if (room.kind === 'boutique') {
        for (const [lx, lz, rot] of room.mannequins || []) {
          const [x, z] = room.w(lx, lz);
          const npc = this.add('mannequin', 'mannequin', { name: 'Mannequin', look: { top: pick(['#e76f51', '#2a9d8f', '#e9c46a', '#f4f1ea'], r) } });
          npc.actor.place(x, room.y + 0.2, z, room.yaw + rot);
          npc.actor.playFull(pick(['hands_hips', 'arms_crossed', 'think'], r), { instant: true });
          npc.actor.state = 'action';
          npc.actor.frozenAt = 0.6;
          npc.state = 'mannequin';
        }
      }
    }
  }

  update(dt) {
    const p = this.game.player;
    for (const npc of this.npcs) npc.update(dt, p);
    // End a conversation when the player walks off.
    if (this.talking && p && this.talking.actor.object.position.distanceTo(p.object.position) > 5) this.endTalk();
  }

  // An NPC right in front of the player, as an interaction.
  talkPrompt(player) {
    if (player.state !== 'free') return null;
    const f = player.forward(_v);
    let best = null, bd = 2.2;
    for (const npc of this.npcs) {
      if (npc.state === 'mannequin' || npc.actor.state === 'driving') continue;
      const q = npc.actor.object.position;
      _d.subVectors(q, player.object.position);
      if (Math.abs(_d.y) > 1.2) continue;
      const d = Math.hypot(_d.x, _d.z);
      if (d > bd || (_d.x * f.x + _d.z * f.z) / (d || 1) < 0.5) continue;
      best = npc; bd = d;
    }
    if (!best) return null;
    return { kind: 'talk', npc: best, label: () => (this.talking === best ? `Talking to ${best.actor.name}` : `Talk to ${best.actor.name}`), act: () => this.startTalk(best) };
  }

  startTalk(npc) {
    if (this.talking && this.talking !== npc) this.endTalk();
    this.talking = npc;
    npc.beginTalk();
    this.game.hud?.openChat(npc);
  }

  endTalk() {
    if (!this.talking) return;
    this.talking.endTalk();
    this.talking = null;
    this.game.hud?.chatTarget(null);
  }

  // The player said something out loud.
  heard(text) {
    const p = this.game.player;
    let npc = this.talking;
    if (!npc) {
      // Someone close and facing roughly your way might answer.
      let bd = 6;
      for (const n of this.npcs) {
        if (n.state === 'mannequin' || n.busyTalking) continue;
        const d = n.actor.object.position.distanceTo(p.object.position);
        if (d < bd) { bd = d; npc = n; }
      }
      if (!npc || this.r() < 0.25) return;
    }
    npc.replyTo(text);
  }

  // The player emoted: waves get waves back.
  sawEmote(name) {
    if (name !== 'wave') return;
    const p = this.game.player;
    const candidates = this.npcs.filter((n) => n.state !== 'mannequin' && n.actor.object.position.distanceTo(p.object.position) < 12);
    candidates.sort((a, b) => a.actor.object.position.distanceTo(p.object.position) - b.actor.object.position.distanceTo(p.object.position));
    candidates.slice(0, 2).forEach((n, i) => this.game.later(0.5 + i * 0.7, () => n.waveBack()));
  }
}

class NPC {
  constructor(crowd, actor, role, opts) {
    this.crowd = crowd;
    this.game = crowd.game;
    this.actor = actor;
    this.role = role;
    this.job = opts.job;
    this.state = 'idle';
    this.timer = 0;
    this.path = null;
    this.speed = 1.2 + crowd.r() * 0.35;
    this.cooldown = 0;
    this.stuck = 0;
    this.lookTimer = 0;
    this.chatLine = 0;
  }

  get r() { return this.crowd.r; }

  // Choose the next thing to do.
  think() {
    const r = this.r;
    const W = this.crowd.world;
    const G = this.crowd.graph;
    const here = this.actor.object.position;
    if (this.role === 'staff' || this.role === 'mannequin' || this.role === 'dancer') return;
    const u = r();
    if (this.role === 'walker' || this.role === 'sitter' || this.role === 'beach' || this.role === 'hang' || this.role === 'chatter') {
      if (u < 0.2) {
        // Sit on a free bench nearby.
        const seat = nearestFree(W.seats, here, 45, (s) => !s.room && s.kind === 'bench');
        if (seat) { this.goSit(seat, 25 + r() * 60); return; }
      }
      if (u < 0.3) {
        this.hang(8 + r() * 18, pick(HANG_EMOTES, r));
        return;
      }
      // Stroll to a random node up to ~150m away.
      const from = G.nearest(here);
      const to = G.randomNode(r, (m) => m !== from && m.p.distanceTo(here) < 150 && m.p.distanceTo(here) > 25);
      const path = G.path(from, to);
      if (path) { this.walk(path.map((e) => ({ p: e.node.p.clone().add(new THREE.Vector3((r() - 0.5) * 0.9, 0, (r() - 0.5) * 0.9)), cross: e.cross }))); return; }
    }
    this.hang(5, null);
  }

  walk(points, then) {
    this.state = 'walk';
    this.path = points;
    this.then = then;
    this.stuck = 0;
  }

  goSit(seat, dur) {
    const G = this.crowd.graph;
    const here = this.actor.object.position;
    const target = G.nearest(seat.standPoint);
    const path = G.path(G.nearest(here), target);
    const pts = path ? path.map((e) => ({ p: e.node.p.clone(), cross: e.cross })) : [];
    this.walk(pts, () => {
      if (seat.occupant) { this.think(); return; }
      this.state = 'toSeat';
      const ok = sitActor(this.actor, seat, this.game, () => { this.state = 'seated'; this.timer = dur; });
      if (!ok) this.think();
    });
  }

  sitNow(seat, dur) {
    const a = this.actor;
    seat.occupant = a;
    a.seat = seat;
    a.state = 'seated';
    a.place(seat.pos.x, seat.pos.y, seat.pos.z, seat.heading);
    a.playFull(seat.loop || 'sit', { opts: { h: seat.h, ...(seat.opts || {}) }, instant: true });
    // Desynchronise identical loops across a room.
    a.full[a.full.length - 1].action.time = this.r() * 6;
    this.state = 'seated';
    this.timer = dur;
  }

  lieNow(seat, dur) {
    const a = this.actor;
    seat.occupant = a;
    a.seat = seat;
    const f = new THREE.Vector3(Math.sin(seat.heading), 0, Math.cos(seat.heading));
    a.place(seat.pos.x - f.x * 0.32, seat.pos.y, seat.pos.z - f.z * 0.32, seat.heading - Math.PI / 2);
    a.playFull('lie', { opts: { h: seat.h }, instant: true });
    a.state = 'lying';
    this.state = 'seated';
    this.timer = dur;
  }

  doEmote(name, dur) {
    const a = this.actor;
    a.emote(name);
    this.state = 'emote';
    this.timer = dur;
  }

  hang(dur, emote) {
    this.state = 'hang';
    this.timer = dur;
    this.actor.intent.speed = 0;
    if (emote) this.actor.emote(emote);
  }

  startChat(other, dur) {
    for (const [a, b] of [[this, other], [other, this]]) {
      a.state = 'chat'; a.timer = dur; a.partner = b;
      a.actor.intent.speed = 0;
      a.actor.lookAt(b.actor);
      const p = a.actor.object.position, q = b.actor.object.position;
      a.faceTo = Math.atan2(q.x - p.x, q.z - p.z);
    }
    this.chatLead = true;
    this.chatTimer = 1 + this.r() * 2;
    this.chatPair = pick(CHATTER, this.r);
    this.chatLine = 0;
  }

  update(dt, player) {
    const a = this.actor;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.state === 'mannequin') {
      // Hold one frame of the pose; mannequins don't breathe.
      const f = a.full[a.full.length - 1];
      if (f) { f.action.time = a.frozenAt; f.action.timeScale = 0; }
      return;
    }
    a.intent.face = null;
    this.ambientLook(dt, player);
    if (this.busyTalking) {
      a.intent.speed = 0;
      if (this.talkFace !== undefined && a.state === 'free') a.intent.face = this.talkFace;
      return;
    }
    switch (this.state) {
      case 'idle': this.think(); break;
      case 'walk': this.walkStep(dt); break;
      case 'hang':
        a.intent.speed = 0;
        this.timer -= dt;
        if (this.timer <= 0) { a.cancel(); a.stopLayer(); this.state = 'idle'; }
        break;
      case 'emote':
        this.timer -= dt;
        if (this.timer <= 0) { a.endAction(); a.stopLayer(); this.state = 'idle'; }
        break;
      case 'seated':
        this.timer -= dt;
        if (this.timer <= 0 && !a.busy) {
          this.state = 'standing';
          // stand() gets up off a bed or lounger first.
          if (!a.stand(() => { this.state = 'idle'; })) this.state = 'idle';
        }
        break;
      case 'chat': this.chatStep(dt); break;
      case 'work': this.workStep(dt, player); break;
      case 'knocked':
        this.timer -= dt;
        if (this.timer <= 0) {
          a.endAction();
          a.knocked = false;
          const p = this.game.player;
          this.faceTo = Math.atan2(p.object.position.x - a.object.position.x, p.object.position.z - a.object.position.z);
          a.lookAt(p);
          this.state = 'react'; this.timer = 2.5; this.resume = 'idle';
          this.game.speech?.say(a, pick(['Are you insane?!', 'Learn to drive!', 'I am calling my lawyer!'], this.r), { priority: 2 });
        }
        break;
      case 'react':
        a.intent.speed = 0;
        a.intent.face = this.faceTo;
        this.timer -= dt;
        if (this.timer <= 0) { a.lookAt(null); this.state = this.resume || 'idle'; }
        break;
      default: break;
    }
  }

  walkStep(dt) {
    const a = this.actor;
    const pos = a.object.position;
    if (!this.path || !this.path.length) {
      a.intent.speed = 0;
      const then = this.then; this.then = null;
      this.state = 'idle';
      if (then) then(); else this.think();
      return;
    }
    const next = this.path[0];
    // Wait for the walk signal before a signalled crossing.
    if (next.cross && !next.cross.unsignalled && this.game.traffic && !this.game.traffic.canCross(next.cross.road)) {
      const d = Math.hypot(next.p.x - pos.x, next.p.z - pos.z);
      if (d > 5 && d < 22 && !this.crossing) {
        a.intent.speed = 0;
        a.intent.face = Math.atan2(next.p.x - pos.x, next.p.z - pos.z);
        return;
      }
    }
    this.crossing = !!next.cross;
    _d.set(next.p.x - pos.x, 0, next.p.z - pos.z);
    const d = _d.length();
    const last = this.path.length === 1;
    if (d < (last ? 0.5 : 1.1)) { this.path.shift(); this.crossing = false; return; }
    _d.divideScalar(d);
    // Step to the right of whoever is in the way.
    for (const o of this.game.actors) {
      if (o === a || !o.object.visible) continue;
      _v.subVectors(o.object.position, pos);
      const od = Math.hypot(_v.x, _v.z);
      if (od > 2 || od < 0.01) continue;
      if ((_v.x * _d.x + _v.z * _d.z) / od > 0.6) {
        const rx = -_d.z, rz = _d.x;
        _d.x += rx * 0.7; _d.z += rz * 0.7;
        break;
      }
    }
    a.intent.dir.copy(_d.normalize());
    a.intent.speed = this.speed;
    // Unstick: if walking but not moving, step aside, then give up on the point.
    if (a.speed < 0.25) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 1.2) {
      a.intent.dir.set(-_d.z, 0, _d.x).multiplyScalar(this.r() < 0.5 ? 1 : -1);
    }
    if (this.stuck > 4) { this.path.shift(); this.stuck = 0; }
  }

  chatStep(dt) {
    const a = this.actor;
    a.intent.speed = 0;
    if (a.state === 'free') a.intent.face = this.faceTo;
    this.timer -= dt;
    if (this.timer <= 0) {
      a.lookAt(null);
      this.state = 'idle';
      if (this.partner && this.partner.state === 'chat') { this.partner.state = 'idle'; this.partner.actor.lookAt(null); }
      return;
    }
    if (!this.chatLead) return;
    this.chatTimer -= dt;
    if (this.chatTimer > 0) return;
    const speaker = this.chatLine % 2 === 0 ? this : this.partner;
    const line = this.chatPair[this.chatLine % 2];
    const near = this.game.player && speaker.actor.object.position.distanceTo(this.game.player.object.position) < 9;
    this.game.speech?.say(speaker.actor, line, { voiced: near, priority: 0 });
    this.chatLine++;
    if (this.chatLine >= 2) { this.chatPair = pick(CHATTER, this.r); this.chatLine = 0; this.chatTimer = 5 + this.r() * 4; }
    else this.chatTimer = 1.2 + line.split(' ').length / 2.6;
  }

  workStep(dt, player) {
    const a = this.actor;
    const post = this.post;
    const pos = a.object.position;
    // Drift back to the post if pushed.
    const d = Math.hypot(post.x - pos.x, post.z - pos.z);
    if (d > 0.4) { a.intent.dir.set((post.x - pos.x) / d, 0, (post.z - pos.z) / d); a.intent.speed = 1; }
    else { a.intent.speed = 0; a.intent.face = post.heading; }
    // Greet the player walking in.
    const inRoom = player && post.room.inside(player.object.position.x, player.object.position.z, -0.3);
    if (inRoom && !this.greeted && STAFF_GREET[this.job]) {
      this.greeted = true;
      this.game.later(0.6, () => this.game.speech?.say(a, pick(STAFF_GREET[this.job], this.r), { priority: 1 }));
    }
    if (!inRoom) this.greeted = false;
    // Idle work gestures now and then.
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 6 + this.r() * 10;
      if (this.r() < 0.35 && a.state === 'free') a.playLayer(pick(['think', 'arms_crossed', 'hands_hips'], this.r), { mask: 'arms', loop: false, time: 4 });
    }
  }

  // Glance at the player when they pass close in front.
  ambientLook(dt, player) {
    const a = this.actor;
    this.lookTimer -= dt;
    if (this.lookTimer > 0 || !player || this.state === 'chat' || this.busyTalking || this.state === 'react') return;
    this.lookTimer = 0.5;
    const d = a.object.position.distanceTo(player.object.position);
    if (d < 5 && this.r() < 0.7) a.lookAt(player);
    else if (a.look.target === player && d > 7) a.lookAt(null);
  }

  bumped(other) {
    if (!other.isPlayer || this.cooldown > 0 || this.state === 'mannequin' || this.busyTalking) return;
    this.cooldown = 4;
    const hard = other.speed > 3.5;
    const a = this.actor;
    const p = a.object.position, q = other.object.position;
    this.faceTo = Math.atan2(q.x - p.x, q.z - p.z);
    a.lookAt(other);
    if (this.state !== 'seated' && a.state === 'free') {
      this.resume = this.state === 'walk' ? 'walk' : 'idle';
      this.state = 'react';
      this.timer = 2.2;
      if (hard) a.playLayer('shrug', { mask: 'arms', time: 1.4 });
    }
    this.game.speech?.say(a, pick(hard ? BUMPED_HARD : BUMPED, this.r), { priority: 1 });
  }

  // Hit by a car: knocked flat, a moment on the ground, then very angry.
  knockedBy(car) {
    const a = this.actor;
    if (a.knocked || this.state === 'mannequin') return;
    a.knocked = true;
    const f = car.forward();
    const side = Math.sign((a.object.position.x - car.object.position.x) * f.z - (a.object.position.z - car.object.position.z) * f.x) || 1;
    a.object.position.x += f.x * 1.4 + f.z * side * 0.9;
    a.object.position.z += f.z * 1.4 - f.x * side * 0.9;
    a.heading = car.heading + Math.PI;
    a.cancel();
    a.state = 'free';
    a.emote('sunbathe');
    this.state = 'knocked';
    this.timer = 2.6;
    this.game.speech?.say(a, 'Ow!', { priority: 2 });
  }

  waveBack() {
    const a = this.actor;
    if (this.busyTalking || this.state === 'mannequin') return;
    const p = this.game.player;
    if (!p) return;
    a.lookAt(p);
    a.emote('wave');
    this.game.speech?.say(a, pick(WAVE_BACK, this.r), { priority: 0 });
    this.game.later(3, () => { if (!this.busyTalking) a.lookAt(null); });
  }

  beginTalk() {
    const a = this.actor, p = this.game.player;
    this.busyTalking = true;
    this.savedState = this.state;
    const pos = a.object.position, q = p.object.position;
    this.talkFace = Math.atan2(q.x - pos.x, q.z - pos.z);
    a.lookAt(p);
    if (a.state === 'free') a.cancel();
    this.game.later(0.35, () => this.game.speech?.say(a, pick(GREETINGS, this.r), { priority: 2 }));
  }

  endTalk() {
    this.busyTalking = false;
    this.actor.lookAt(null);
    if (this.state === 'walk' && !this.path?.length) this.state = 'idle';
  }

  replyTo(text) {
    const a = this.actor;
    const p = this.game.player;
    a.lookAt(p);
    const pos = a.object.position, q = p.object.position;
    this.talkFace = Math.atan2(q.x - pos.x, q.z - pos.z);
    const wasBusy = this.busyTalking;
    this.busyTalking = true;
    const line = replyTo(text, a, this.r);
    // Let the player's line land before answering.
    const delay = 0.6 + Math.min(2.5, text.length * 0.025);
    this.game.later(delay, () => this.game.speech?.say(a, line, {
      priority: 2,
      onEnd: () => { if (!wasBusy && this.crowd.talking !== this) { this.busyTalking = false; this.game.later(1.5, () => a.lookAt(null)); } },
    }));
  }
}

function nearestFree(seats, p, maxD, filter) {
  let best = null, bd = maxD;
  for (const s of seats) {
    if (s.occupant || (filter && !filter(s))) continue;
    const d = s.pos.distanceTo(p);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function shuffle(a, r) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
