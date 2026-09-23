// Buy and build tools: what a click or a drag does outside live mode.
//
// Buy: hold an item from the catalogue (a ghost follows the pointer, green
// where it fits, red with a reason where it doesn't), click to place, or
// pick up a placed item and move it. Build: paint a wall side (shift: the
// whole room), lay a floor, cut a door or window, fill one in.
// Every change is undoable: a snapshot of the lot goes on the stack first.
import * as THREE from 'three';
import { BY_ID, prepared } from './catalog.js';
import { FY, WT, openingSpec } from './house.js';
import { obbOverlap } from './items.js';

const Q = Math.PI / 2;

export class BuildTools {
  constructor(game) {
    this.game = game;
    this.undoStack = [];
    this.redoStack = [];
    this.held = null;            // { entry, rot, ghost, moving, place }
    this.selected = null;
    this.buildTool = null;       // { kind: 'paint'|'floor'|'door'|'window'|'arch'|'erase', id }
    this.hoverMark = null;
    this.snapStep = 0.25;
    this.onChange = null;        // UI refresh
  }

  get home() { return this.game.home; }
  get items() { return this.game.home.items; }
  get house() { return this.game.home.house; }

  // ------------------------------------------------------------ history

  snapshot() { return { items: this.items.serialize(), house: this.house.state(), funds: this.game.funds }; }

  commit() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  restore(s) {
    this.drop();
    this.select(null);
    this.house.applyState(s.house);
    this.items.load(s.items);
    this.game.funds = s.funds;
    this.game.nav.dirty = true;
    this.game.dirty = true;
    this.onChange?.();
  }

  undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push(this.snapshot()); this.restore(s); return true; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push(this.snapshot()); this.restore(s); return true; }

  // ------------------------------------------------------------ buy: holding

  hold(id) {
    this.drop();
    this.select(null);
    const entry = BY_ID[id];
    const prep = prepared(entry, this.home.models);
    if (!prep) return;
    this.held = { entry, prep, rot: 0, ghost: this.makeGhost(entry, prep), place: null };
    // Start it in the middle of the view, so a phone user sees it at once.
    const t = this.game.view.target;
    this.aim(t.x, t.z);
  }

  pickUp(it) {
    this.drop();
    this.select(null);
    this.items.setHidden(it, true);
    this.held = { entry: it.entry, prep: it.prep, rot: it.rot, ghost: this.makeGhost(it.entry, it.prep), place: null, moving: it };
    this.aim(it.group.position.x, it.group.position.z);
  }

  drop() {
    const h = this.held;
    if (!h) return;
    h.ghost.removeFromParent();
    h.ghost.traverse((o) => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
    if (h.moving && !h.moving.removed) this.items.setHidden(h.moving, false);
    this.held = null;
    this.onChange?.();
  }

  makeGhost(entry, prep) {
    const g = new THREE.Group();
    if (prep.proto) g.add(prep.proto.clone());
    else for (const p of prep.parts) g.add(new THREE.Mesh(p.geo, p.material));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.raycast = () => {}; } });
    // The footprint, drawn on the floor: green fits, red doesn't.
    const fp = prep.fp;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(fp.hx * 2 + 0.08, fp.hz * 2 + 0.08), new THREE.MeshBasicMaterial({ color: '#3ba55c', transparent: true, opacity: 0.45, depthWrite: false }));
    quad.rotation.x = -Math.PI / 2;
    quad.position.set(fp.cx, 0.02, fp.cz);
    quad.userData.own = true;
    quad.raycast = () => {};
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fp.hx * 2 + 0.08, Math.max(0.05, prep.height), fp.hz * 2 + 0.08)), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
    edge.position.set(fp.cx, Math.max(0.05, prep.height) / 2, fp.cz);
    edge.userData.own = true;
    edge.raycast = () => {};
    g.add(quad, edge);
    g.userData.quad = quad;
    g.userData.edge = edge;
    this.game.scene.add(g);
    return g;
  }

  // Put the held item at a world point: snap, wall, surface, validity.
  aim(wx, wz) {
    const h = this.held;
    if (!h) return;
    const [lx, lz] = this.house.toLocal(wx, wz);
    const st = this.snapStep;
    let x = Math.round(lx / st) * st, z = Math.round(lz / st) * st;
    let rot = h.rot, y, wall = null;
    if (h.entry.place === 'wall') {
      const w = this.items.snapToWall(h.entry, lx, lz);
      if (w) { x = w.x; z = w.z; rot = w.rot; y = w.y; wall = w; } else y = FY + (h.entry.mount ?? 1.5);
    } else if (h.entry.place === 'surface') {
      const s = this.items.surfaceAt(lx, lz, h.moving);
      if (s) { x = lx; z = lz; y = s.y; } else y = this.house.floorY(x, z);
    } else y = this.house.floorY(x, z);
    const why = this.items.whyNot(h.entry, x, z, rot, y, { ignore: h.moving, wall });
    const cost = h.moving ? 0 : h.entry.price;
    const broke = !why && cost > this.game.funds ? 'Not enough funds' : null;
    h.place = { x, z, rot, y, wall, why: why || broke };
    const g = h.ghost;
    g.position.set(this.home.lot.cx + x, y, this.home.lot.cz + z);
    g.rotation.y = rot;
    const ok = !h.place.why;
    g.userData.quad.material.color.set(ok ? '#3ba55c' : '#d9573b');
    g.userData.edge.material.color.set(ok ? '#ffffff' : '#ffb3a3');
    this.onChange?.();
  }

  rotateHeld(dir = 1, fine = false) {
    const h = this.held;
    if (h) {
      h.rot += dir * (fine ? Q / 2 : Q);
      this.aim(h.ghost.position.x, h.ghost.position.z);
      return;
    }
    const it = this.selected;
    if (!it || it.wall) return;
    const rot = it.rot + dir * (fine ? Q / 2 : Q);
    const why = this.items.whyNot(it.entry, it.x, it.z, rot, it.y, { ignore: it });
    if (why) { this.game.ui?.toast(why); return; }
    this.commit();
    this.items.move(it, it.x, it.z, rot, { y: it.y });
    this.select(it);
  }

  // Drop the held item where it is (if it fits).
  place() {
    const h = this.held;
    if (!h?.place) return false;
    const p = h.place;
    if (p.why) { this.game.ui?.toast(p.why); this.game.audio?.blip(180, 0.12); return false; }
    this.commit();
    if (h.moving) {
      const it = h.moving;
      this.drop();
      this.items.move(it, p.x, p.z, p.rot, { y: p.y, wall: p.wall });
      this.select(it);
    } else {
      this.items.place(h.entry.id, p.x, p.z, p.rot, { y: p.y, wall: p.wall || undefined });
      this.game.funds -= h.entry.price;
      this.game.audio?.blip(990, 0.05);
      this.game.ui?.flashFunds(-h.entry.price);
      // Keep holding another of the same, for rows of chairs or fence.
      this.aim(h.ghost.position.x, h.ghost.position.z);
    }
    this.onChange?.();
    return true;
  }

  // ------------------------------------------------------------ buy: selection

  select(it) {
    this.selected = it;
    if (this.selMark) { this.selMark.removeFromParent(); this.selMark.geometry.dispose(); this.selMark = null; }
    if (it) {
      const fp = it.prep.fp;
      const h = Math.max(0.05, it.prep.height);
      const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fp.hx * 2 + 0.1, h + 0.04, fp.hz * 2 + 0.1)), new THREE.LineBasicMaterial({ color: '#ffc23c' }));
      m.position.set(fp.cx, h / 2, fp.cz);
      m.raycast = () => {};
      it.group.add(m);
      this.selMark = m;
    }
    this.onChange?.();
  }

  sell(it = this.selected) {
    if (!it) return;
    this.commit();
    const refund = [it, ...this.items.children(it)].reduce((s, x) => s + x.entry.price, 0);
    this.select(null);
    this.items.remove(it);
    this.game.funds += refund;
    this.game.ui?.flashFunds(refund);
    this.game.audio?.blip(520, 0.06);
  }

  duplicate(it = this.selected) {
    if (!it) return;
    this.hold(it.id);
    this.held.rot = it.rot;
  }

  clearFurniture({ indoorOnly = true } = {}) {
    this.commit();
    let refund = 0;
    for (const it of [...this.items.list]) {
      if (it.removed || it.parent) continue;
      if (indoorOnly && !this.house.covers(it.x, it.z)) continue;
      refund += [it, ...this.items.children(it)].reduce((s, x) => s + x.entry.price, 0);
      this.items.remove(it, { quiet: true });
    }
    this.items.changed?.('clear');
    this.game.funds += refund;
    this.select(null);
    this.onChange?.();
  }

  // ------------------------------------------------------------ build

  // What wall face or floor is under the pointer (visible ones only).
  surfaceUnder(ev) {
    const ray = this.game.view.rayFrom(ev);
    const hits = ray.intersectObjects(this.house.pickables, false);
    for (const h of hits) {
      const d = h.object.userData;
      // Walls exist twice (full and cut down); only the one showing counts.
      if (d.kind === 'wall' && !!d.low !== !!d.run.lowered) continue;
      return { ...d, point: h.point };
    }
    return null;
  }

  // Doors and windows: the wall point under the pointer.
  wallPoint(ev) {
    const s = this.surfaceUnder(ev);
    if (!s || s.kind !== 'wall') return null;
    const [lx, lz] = this.house.toLocal(s.point.x, s.point.z);
    const r = s.run;
    return r.axis === 'x' ? [lx, r.c, s] : [r.c, lz, s];
  }

  hoverBuild(ev) {
    const t = this.buildTool;
    this.clearHover();
    if (!t) return;
    if (t.kind === 'door' || t.kind === 'window' || t.kind === 'arch') {
      const p = this.wallPoint(ev);
      if (!p) return;
      const w = t.kind === 'window' ? 1.2 : t.kind === 'arch' ? 1.4 : 0.9;
      const c = this.house.canOpen(p[0], p[1], t.kind, w);
      if (!c.run) return;
      const spec = openingSpec({ kind: t.kind, w });
      const X = c.run.axis === 'x';
      const g = new THREE.Mesh(new THREE.BoxGeometry(X ? spec.w : WT + 0.06, spec.top - spec.bottom, X ? WT + 0.06 : spec.w), new THREE.MeshBasicMaterial({ color: c.why ? '#d9573b' : '#3ba55c', transparent: true, opacity: 0.5, depthWrite: false }));
      const [wx, wz] = this.house.toWorld(X ? c.at : c.run.c, X ? c.run.c : c.at);
      g.position.set(wx, FY + (spec.bottom + spec.top) / 2, wz);
      this.game.scene.add(g);
      this.hoverMark = g;
      this.hoverWhy = c.why || null;
    } else if (t.kind === 'erase') {
      const p = this.wallPoint(ev);
      const o = p && this.house.openingNear(p[0], p[1], 1.0);
      if (!o) return;
      const X = o.run.axis === 'x';
      const g = new THREE.Mesh(new THREE.BoxGeometry(X ? o.w + 0.1 : WT + 0.08, o.top - o.bottom + 0.1, X ? WT + 0.08 : o.w + 0.1), new THREE.MeshBasicMaterial({ color: '#d9573b', transparent: true, opacity: 0.45, depthWrite: false }));
      const [wx, wz] = this.house.toWorld(o.x, o.z);
      g.position.set(wx, FY + (o.bottom + o.top) / 2, wz);
      this.game.scene.add(g);
      this.hoverMark = g;
    } else if (t.kind === 'paint' || t.kind === 'floor') {
      const s = this.surfaceUnder(ev);
      this.hoverInfo = s;
    }
  }

  clearHover() {
    if (this.hoverMark) { this.hoverMark.removeFromParent(); this.hoverMark.geometry.dispose(); this.hoverMark = null; }
  }

  clickBuild(ev) {
    const t = this.buildTool;
    if (!t) return;
    const house = this.house;
    if (t.kind === 'paint') {
      const s = this.surfaceUnder(ev);
      if (!s || s.kind !== 'wall') return this.game.ui?.toast('Click a wall to paint it');
      this.commit();
      const owner = house.sideOwner(s.run, s.side);
      if (ev.shiftKey || t.room) house.paintRoom(owner, t.id);
      else house.paintSide(s.run, s.side, t.id);
      this.game.dirty = true;
      this.game.audio?.blip(700, 0.04);
    } else if (t.kind === 'floor') {
      const s = this.surfaceUnder(ev);
      if (!s || s.kind !== 'floor') return this.game.ui?.toast('Click a room floor to lay it');
      this.commit();
      house.setFloor(s.room, t.id);
      this.game.dirty = true;
      this.game.audio?.blip(600, 0.04);
    } else if (t.kind === 'door' || t.kind === 'window' || t.kind === 'arch') {
      const p = this.wallPoint(ev);
      if (!p) return this.game.ui?.toast('Click a wall to cut an opening');
      const w = t.kind === 'window' ? 1.2 : t.kind === 'arch' ? 1.4 : 0.9;
      const c = house.canOpen(p[0], p[1], t.kind, w);
      if (c.why) return this.game.ui?.toast(c.why);
      // Furniture standing where the doorway goes would be stranded.
      if (t.kind !== 'window') {
        const X = c.run.axis === 'x';
        const cx = X ? c.at : c.run.c, cz = X ? c.run.c : c.at;
        const zone = X ? { x: cx, z: cz, hx: w / 2, hz: 0.55, rot: 0 } : { x: cx, z: cz, hx: 0.55, hz: w / 2, rot: 0 };
        const blocker = this.items.list.find((it) => !it.wall && !it.parent && !it.entry.flat && obbOverlap(zone, this.items.footprint(it.entry, it.x, it.z, it.rot)));
        if (blocker) return this.game.ui?.toast(`Move the ${blocker.entry.name.toLowerCase()} first`);
      }
      this.commit();
      house.addOpening(p[0], p[1], t.kind, w);
      this.game.funds -= t.kind === 'window' ? 120 : 200;
      this.game.nav.dirty = true;
      this.game.audio?.blip(420, 0.08);
    } else if (t.kind === 'erase') {
      const p = this.wallPoint(ev);
      const o = p && house.openingNear(p[0], p[1], 1.0);
      if (!o) return this.game.ui?.toast('Click a door or window to wall it up');
      this.commit();
      house.removeOpening(o);
      this.game.nav.dirty = true;
      this.game.audio?.blip(300, 0.08);
    }
    this.clearHover();
    this.onChange?.();
  }

  // ------------------------------------------------------------ view.tool

  // The pointer tool for buy and build modes.
  tool() {
    const self = this;
    const g = this.game;
    return {
      hover(ev) {
        if (g.mode === 'buy' && self.held) { const p = self.pointOn(ev); if (p) self.aim(p.x, p.z); }
        if (g.mode === 'build') self.hoverBuild(ev);
      },
      click(ev) {
        if (g.mode === 'build') return self.clickBuild(ev);
        if (self.held) {
          const p = self.pointOn(ev);
          // Touch: first tap moves the ghost; tapping it again places it.
          if (ev.pointerType !== 'mouse' && p) {
            const d = Math.hypot(p.x - self.held.ghost.position.x, p.z - self.held.ghost.position.z);
            if (d > 0.6) { self.aim(p.x, p.z); return; }
          } else if (p) self.aim(p.x, p.z);
          self.place();
          return;
        }
        const hit = g.pick(ev, { sims: false });
        self.select(hit?.item || null);
      },
      alt() { if (self.held) self.drop(); else self.select(null); },
      dragStart(ev) {
        if (g.mode !== 'buy' || self.held) return false;
        const hit = g.pick(ev, { sims: false });
        if (!hit?.item) return false;
        self.pickUp(hit.item);
        return true;
      },
      drag(ev) { const p = self.pointOn(ev); if (p) self.aim(p.x, p.z); },
      dragEnd(ev, cancelled) {
        if (cancelled || !self.held) { self.drop(); return; }
        if (!self.place()) self.drop();
      },
    };
  }

  // Pointer to the plane the held thing lives on.
  pointOn(ev) {
    const h = this.held;
    const y = h && h.entry.place === 'wall' ? FY + (h.entry.mount ?? 1.5) : FY;
    return this.game.floorPoint(ev) || this.game.view.groundAt(ev, y);
  }
}
