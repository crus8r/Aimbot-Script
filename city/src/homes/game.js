// Sunny Lane: the city's engine (renderer, cast, physics, sky, speech)
// driving a different game. One lot is "home": its house is live (walls cut
// away, furniture you can buy and move, a household with needs). The other
// lots and the houses across the road are frozen scenery until you move.
import * as THREE from 'three';
import { Game } from '../game/game.js';
import { updateGoal } from '../game/interact.js';
import { updateHeld } from '../game/hooks.js';
import { loadModelProps } from '../world/models.js';
import { House, FY } from './house.js';
import { Items } from './items.js';
import { NavGrid } from './nav.js';
import { HomeView } from './view.js';
import { buildStreet, lotBounds } from './street.js';
import { PLANS, LOTS, HOUSEHOLD } from './plans.js';
import { BY_ID } from './catalog.js';
import { Sim } from './sims.js';
import { chooseAutonomous, idleTask } from './actions.js';

const KEY = 'sunnylane:v1';

// Browser storage can be missing or refuse (private windows, previews):
// every read and write is guarded, and the game runs without it.
export const store = {
  get(k) { try { const v = localStorage.getItem(`${KEY}:${k}`); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(`${KEY}:${k}`); } catch { /* nothing to do */ } },
};

export class HomeGame extends Game {
  constructor(opts) {
    super(opts);
    this.input.wantLock = false;
    this.speech.bubbles.maxDist = 90;   // the camera hangs 20-40m above the lot
    this.view = new HomeView(this.camera, this.renderer.domElement, this.input);
    this.plans = PLANS;
    this.mode = 'live';               // live | buy | build
    this.speed = 1;
    this.paused = false;
    this.sims = [];
    this.selected = null;
    this.settings = { voiceAll: false, freeWill: true, ...(store.get('settings') || {}) };
    this.neighbours = new Map();
    this.home = null;
    this.saveT = 0;
    this.test = this.params.has('test');
    // Scripted runs get a fresh in-memory store: saving and loading still
    // run, but nothing leaks between runs.
    if (this.test) { const m = new Map(); this.store = { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => { m.set(k, JSON.stringify(v)); return true; }, del: (k) => m.delete(k) }; }
    else this.store = store;
  }

  async load() {
    await this.cast.load((p) => this.onProgress(0.05 + p * 0.55, 'Casting the household'));
    this.onProgress(0.62, 'Delivering the furniture');
    this.models = await loadModelProps(this, ['armchair', 'boombox', 'vase', 'lantern', 'bottle', 'sofa']);
    this.onProgress(0.78, 'Building Sunny Lane');
    this.street = buildStreet(this);
    this.lights = this.street.lights;
    this.day.setHours(Number(this.params.get('hour')) || this.store.get('hour') || 10.5);
    const want = this.params.get('lot') || this.store.get('active') || 'B';
    const active = LOTS.find((l) => l.id === want) || LOTS[1];
    for (const lot of LOTS) if (lot !== active) this.freezeLot(lot);
    this.onProgress(0.9, 'Moving in');
    this.moveIn(active);
    this.spawnHousehold();
    this.onProgress(0.98, 'Opening the front door');
  }

  // ------------------------------------------------------------ lots

  lotState(id) { return this.store.get(`lot:${id}`); }

  freezeLot(lot) {
    const saved = this.lotState(lot.id);
    const h = new House(this, lot, PLANS[lot.plan], saved?.house);
    h.freeze();
    this.neighbours.set(lot.id, h);
  }

  moveIn(lot) {
    const plan = PLANS[lot.plan];
    const saved = this.lotState(lot.id);
    this.neighbours.get(lot.id)?.dispose();
    this.neighbours.delete(lot.id);
    const house = new House(this, lot, plan, saved?.house);
    const home = { lot, plan, house, models: this.models };
    const items = new Items(this, home);
    home.items = items;
    this.home = home;
    if (saved?.items) items.load(saved.items);
    else this.furnish(plan);
    this.funds = saved?.funds ?? 20000;
    this.nav = new NavGrid(this.physics, lotBounds(lot));
    const touched = () => { this.nav.dirty = true; this.dirty = true; };
    items.changed = touched;
    house.changed = touched;
    // Rooms light themselves after dark (ceiling lights you don't see).
    home.roomLights = house.rooms.map((r) => {
      const [x, z] = house.toWorld((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
      return this.lights.add({ pos: new THREE.Vector3(x, FY + 2.5, z), color: '#ffe2c0', intensity: 9, range: 9, priority: 2, night: true });
    });
    const b = lotBounds(lot);
    this.view.bounds = { x0: b.x0 - 4, x1: b.x1 + 4, z0: b.z0 - 2, z1: b.z1 + 8 };
    this.view.focus(lot.cx - 1, lot.cz + 1.5, { dist: innerWidth < innerHeight ? 36 : 26, pitch: 0.82, yaw: Math.PI / 4, instant: true });
    this.store.set('active', lot.id);
    this.dirty = false;
    this.onMove?.(home);
  }

  // Lay out a preset's furniture.
  furnish(plan) {
    const items = this.home.items;
    for (const [id, x, z, rot, extra] of plan.items) {
      const entry = BY_ID[id];
      if (!entry) { console.warn(`preset: no item ${id}`); continue; }
      if (entry.place === 'wall' || extra?.wall) {
        const w = items.snapToWall(entry, x, z);
        if (!w) { console.warn(`preset: ${id} found no wall at ${x},${z}`); continue; }
        items.place(id, w.x, w.z, w.rot, { y: w.y, wall: w });
      } else items.place(id, x, z, rot);
    }
  }

  // Leave this lot for another: save, pack up, unfreeze the new one.
  moveTo(lotId) {
    const lot = LOTS.find((l) => l.id === lotId);
    if (!lot || lot === this.home?.lot) return;
    this.save();
    for (const s of this.sims) { s.cancelAll(); s.task = null; }
    for (const a of this.actors) { a.goal = null; if (a.state !== 'free') { a.stopFull(0.01); a.state = 'free'; a.busy = false; a.seat = null; } }
    const old = this.home;
    old.items.clear();
    old.items.dispose();
    for (const s of old.roomLights) this.lights.spots = this.lights.spots.filter((x) => x !== s);
    old.house.dispose();
    this.freezeLot(old.lot);
    this.moveIn(lot);
    this.placeHousehold();
  }

  // Throw away edits on this lot and lay out the preset again.
  resetLot({ empty = false } = {}) {
    const lot = this.home.lot;
    this.store.del(`lot:${lot.id}`);
    for (const s of this.sims) { s.cancelAll(); }
    for (const a of this.actors) { a.goal = null; if (a.state !== 'free') { a.stopFull(0.01); a.state = 'free'; a.busy = false; if (a.seat) a.seat.occupant = null; a.seat = null; } }
    this.home.items.clear();
    this.home.items.dispose();
    for (const s of this.home.roomLights) this.lights.spots = this.lights.spots.filter((x) => x !== s);
    this.home.house.dispose();
    this.neighbours.set(lot.id, { dispose() {} });
    this.moveIn(lot);
    if (empty) this.home.items.clear({ keepOutdoor: true });
    this.placeHousehold();
    this.dirty = true;
  }

  save() {
    if (!this.home) return;
    const h = this.home;
    this.store.set(`lot:${h.lot.id}`, { house: h.house.state(), items: h.items.serialize(), funds: this.funds });
    this.store.set('household', this.sims.map((s) => ({ name: s.name, model: s.model, voice: s.voice, look: s.look, needs: s.needs })));
    this.store.set('hour', this.day.hours);
    this.dirty = false;
  }

  // Everything a studio would need to rebuild this set: plan, finishes,
  // furniture. Also what "Export" downloads.
  exportLot() {
    const h = this.home;
    return { format: 'sunnylane-lot', version: 1, lot: h.lot.id, plan: h.lot.plan, house: h.house.state(), items: h.items.serialize(), funds: this.funds };
  }

  importLot(data) {
    if (!data || data.format !== 'sunnylane-lot') throw new Error('Not a Sunny Lane lot file');
    const lot = LOTS.find((l) => l.plan === data.plan) || this.home.lot;
    this.store.set(`lot:${lot.id}`, { house: data.house, items: data.items, funds: data.funds });
    if (lot === this.home.lot) { this.neighbours.set(lot.id, { dispose() {} }); this.reloadHome(); } else this.moveTo(lot.id);
  }

  reloadHome() {
    const lot = this.home.lot;
    for (const s of this.sims) s.cancelAll();
    for (const a of this.actors) { a.goal = null; if (a.state !== 'free') { a.stopFull(0.01); a.state = 'free'; a.busy = false; if (a.seat) a.seat.occupant = null; a.seat = null; } }
    this.home.items.clear();
    this.home.items.dispose();
    for (const s of this.home.roomLights) this.lights.spots = this.lights.spots.filter((x) => x !== s);
    this.home.house.dispose();
    this.moveIn(lot);
    this.placeHousehold();
  }

  // ------------------------------------------------------------ people

  spawnHousehold() {
    const saved = this.test ? null : this.store.get('household');
    const list = saved?.length ? saved : HOUSEHOLD;
    for (const d of list) this.addSim(d);
    this.placeHousehold();
    this.select(this.sims[0]);
  }

  addSim(d) {
    const a = this.addActor(d.model, d.look || {}, { name: d.name, voice: d.voice });
    const sim = new Sim(this, a, d);
    this.sims.push(sim);
    return sim;
  }

  removeSim(sim) {
    sim.cancelAll();
    if (sim.actor.seat) sim.actor.seat.occupant = null;
    this.removeActor(sim.actor);
    sim.gone = true;
    this.sims = this.sims.filter((s) => s !== sim);
    if (this.selected === sim) this.select(this.sims[0] || null);
  }

  // Everyone on the front path, facing the house.
  placeHousehold() {
    const { lot, plan } = this.home;
    const [sx, sz] = plan.spawn || [0, 9];
    this.sims.forEach((s, i) => {
      const x = lot.cx + sx + (i - (this.sims.length - 1) / 2) * 0.9;
      const z = lot.cz + sz + (i % 2) * 0.5;
      s.actor.place(x, 0.03, z, Math.PI);
      s.actor.velocity.set(0, 0, 0);
    });
  }

  select(sim) {
    for (const s of this.sims) s.actor.isPlayer = false;
    this.selected = sim;
    if (sim) sim.actor.isPlayer = true;
    this.onSelect?.(sim);
  }

  // ------------------------------------------------------------ loop

  step(dt, render = true) {
    this.frame++;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t[0] <= this.time);
      if (due.length) { this.timers = this.timers.filter((t) => t[0] > this.time); for (const [, fn] of due) fn(); }
    }
    this.view.update(dt, this.input.typing);
    const live = this.mode === 'live' && !this.paused;
    const n = live ? this.speed : 1;
    for (let k = 0; k < n; k++) this.simStep(dt, live);
    for (const a of this.actors) a.update(dt * n);
    updateHeld(this);
    const home = this.home;
    home.house.updateDoors(dt, this.actors);
    home.house.updateView(this.camera.position, this.view.viewDir());
    home.items.updateOcclusion(this.camera.position, this.view.target, this.view.viewDir(this._vd || (this._vd = new THREE.Vector3())));
    home.items.update(dt);
    this.day.paused = !live;
    this.day.update(dt * n, this.view.target);
    // A lane, not a city: pull the haze in so the ground has no edge.
    this.day.fog.near = 70; this.day.fog.far = 520;
    for (const u of this.updaters) u(dt, this);
    this.lights.update(dt, this.camera.position, this.day.night);
    this.audio.update(dt);
    this.speech.bubbles.update(dt);
    this.ui?.update(dt);
    if (this.dirty && !this.test) { this.saveT += dt; if (this.saveT > 2) { this.saveT = 0; this.save(); } }
    if (render) this.render();
    this.input.endFrame();
  }

  simStep(dt, live) {
    if (live) {
      this.time += dt;
      for (const s of this.sims) {
        s.update(dt, true);
        // Free will: idle sims pick something to do. The one you control
        // waits longer before deciding for itself.
        const patience = s === this.selected ? 12 : 2.5;
        if (this.settings.freeWill && !s.task && !s.queue.length && s.idle > patience && s.actor.state !== 'lying') {
          s.idle = 0;
          const pick = chooseAutonomous(this, s);
          const t = pick ? pick.make() : (Math.random() < 0.5 ? idleTask(this, s) : null);
          if (t) { t.auto = true; t.voiced = this.settings.voiceAll; s.push(t); }
        }
      }
    } else for (const s of this.sims) s.update(dt, false);
    for (const a of this.actors) if (a.goal) updateGoal(a, dt, this.physics);
    for (const a of this.actors) this.physics.moveActor(a, dt, this.actors);
  }

  // Things a click can hit: furniture and sims, nearest first.
  pick(ev, { items = true, sims = true } = {}) {
    const ray = this.view.rayFrom(ev);
    const objs = [];
    if (items) for (const it of this.home.items.list) objs.push(it.group);
    if (sims) for (const s of this.sims) objs.push(s.actor.object);
    const hits = ray.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.item && !o.userData.actor) o = o.parent;
      if (!o) continue;
      if (o.userData.actor?.sim) return { sim: o.userData.actor.sim, point: h.point };
      const it = o.userData.item;
      if (it && !it.cut) return { item: it, point: h.point };
    }
    return null;
  }

  // Where a click lands on the lot: the house floor if inside, else ground.
  floorPoint(ev) {
    const h = this.home.house;
    const p = this.view.groundAt(ev, FY);
    if (p) {
      const [lx, lz] = h.toLocal(p.x, p.z);
      if (h.covers(lx, lz, 0)) return p;
    }
    const g = this.view.groundAt(ev, 0);
    return g;
  }
}
