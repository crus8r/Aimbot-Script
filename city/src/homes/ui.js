// The interface: mode tabs, household and needs, the pie menu of things to
// do, the catalogue, the build swatches, chat with the four voices, and the
// menu (move house, add a sim, export a lot). DOM lives in web/homes.html.
import * as THREE from 'three';
import { CATALOG, CATEGORIES } from './catalog.js';
import { PAINTS, SIDINGS, FLOORS, ROOFS } from './finishes.js';
import { NEEDS } from './sims.js';
import { itemActions, simActions, selfActions, floorActions, typedLine } from './actions.js';
import { BuildTools } from './buildmode.js';
import { Thumbs } from './thumbs.js';
import { VOICES } from '../game/speech.js';
import { MODELS, randomLook } from '../core/cast.js';
import { rng } from '../world/textures.js';
import { PLANS, LOTS } from './plans.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const money = (n) => `§${Math.round(n).toLocaleString('en-US')}`;
const needColor = (v) => (v > 55 ? '#3ba55c' : v > 28 ? '#e8a33a' : '#d9573b');
const BODY = { michelle: 'Woman', man: 'Man', girl: 'Girl', soldier: 'Tall man', mannequin: 'Mannequin' };

const BUILD_TOOLS = [
  { kind: 'paint', name: 'Paint walls', set: PAINTS },
  { kind: 'floor', name: 'Floors', set: FLOORS },
  { kind: 'siding', name: 'Outside walls', set: SIDINGS },
  { kind: 'roof', name: 'Roof', set: ROOFS },
  { kind: 'door', name: 'Add door' },
  { kind: 'window', name: 'Add window' },
  { kind: 'arch', name: 'Add archway' },
  { kind: 'erase', name: 'Wall up' },
];

export class HomeUI {
  constructor(game) {
    this.game = game;
    this.build = new BuildTools(game);
    this.build.onChange = () => { this.buyDirty = true; };
    this.thumbs = new Thumbs(game.models);
    this.cat = 'seating';
    this.buildKind = 'paint';
    this.swatch = { paint: 'sage', floor: 'oak', siding: null, roof: null };
    this.t = 0;
    game.ui = this;
    game.onSelect = () => this.renderHousehold();
    game.onSimNote = (sim, why) => this.toast(why);
    game.onRestyle = () => this.renderHousehold();
    game.onMove = () => this.renderLot();
    this.liveTool = this.makeLiveTool();
    this.makePlumbob();
    this.bindTop();
    this.bindView();
    this.bindChat();
    this.bindMenu();
    this.bindKeys();
    this.renderHousehold();
    this.renderNeeds();
    this.renderLot();
    this.setMode('live');
    document.body.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
    // Scripted screenshots: no transitions to catch half-way.
    document.body.classList.toggle('test', game.test);
  }

  // ------------------------------------------------------------ modes

  setMode(m) {
    const g = this.game;
    g.mode = m;
    this.closePie();
    this.build.drop();
    this.build.select(null);
    this.build.clearHover();
    document.body.classList.remove('mode-live', 'mode-buy', 'mode-build');
    document.body.classList.add(`mode-${m}`);
    for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
    $('live').hidden = m !== 'live';
    $('catalog').hidden = m !== 'buy';
    $('builder').hidden = m !== 'build';
    g.view.tool = m === 'live' ? this.liveTool : this.build.tool();
    if (m === 'buy') this.renderCatalog();
    if (m === 'build') { this.renderBuild(); if (g.home.house.mode === 'cutaway') this.setWalls('up'); }
    else if (g.home.house.mode === 'up' && !this.userWalls) this.setWalls('cutaway');
    // The sheet covers the bottom of the view: lift the camera's aim.
    this.sheetH = m === 'live' ? 0 : Math.min(250, Math.round(innerHeight * (innerWidth < 700 ? 0.4 : 0.34)));
    document.body.style.setProperty('--sheet-h', `${this.sheetH}px`);
    g.view.setSheet(this.sheetH);
  }

  bindTop() {
    for (const b of document.querySelectorAll('#modes button')) b.addEventListener('click', () => this.setMode(b.dataset.mode));
    for (const b of document.querySelectorAll('#speeds button')) b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed)));
    $('menu-btn').addEventListener('click', () => this.toggleMenu());
    $('lot-btn').addEventListener('click', () => this.toggleMenu(true));
  }

  setSpeed(s) {
    const g = this.game;
    if (s === 0) g.paused = true;
    else { g.paused = false; g.speed = s; }
    for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === (g.paused ? 0 : g.speed));
  }

  bindView() {
    for (const b of document.querySelectorAll('[data-walls]')) b.addEventListener('click', () => { this.userWalls = true; this.setWalls(b.dataset.walls); });
    $('roof-btn').addEventListener('click', () => {
      const h = this.game.home.house;
      h.setRoof(!h.roofOn);
      $('roof-btn').classList.toggle('on', h.roofOn);
    });
    $('rot-l').addEventListener('click', () => this.game.view.turn(-1));
    $('rot-r').addEventListener('click', () => this.game.view.turn(1));
    $('talk-btn').addEventListener('click', () => this.openChat());
  }

  setWalls(mode) {
    const h = this.game.home.house;
    h.setMode(mode);
    if (h.roofOn) { h.setRoof(false); $('roof-btn').classList.remove('on'); }
    for (const b of document.querySelectorAll('[data-walls]')) b.classList.toggle('on', b.dataset.walls === mode);
  }

  // ------------------------------------------------------------ toast, funds

  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toast);
    this._toast = setTimeout(() => t.classList.remove('show'), 2400);
  }

  flashFunds(d) {
    const f = $('funds-flash');
    f.textContent = `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`;
    f.style.color = d > 0 ? '#2a7a42' : '#b8422a';
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
    clearTimeout(this._ff);
    this._ff = setTimeout(() => f.classList.remove('show'), 1100);
  }

  // ------------------------------------------------------------ household

  simColor(s) {
    const l = s.look || {};
    if (l.top) return l.top;
    if (l.topHue !== undefined) return `hsl(${Math.round(l.topHue * 360)} 55% 52%)`;
    return '#5aa9d6';
  }

  renderHousehold() {
    const g = this.game;
    const box = $('household');
    box.textContent = '';
    for (const s of g.sims) {
      const b = el('button', `portrait${s === g.selected ? ' sel' : ''}`);
      b.type = 'button';
      b.style.background = this.simColor(s);
      b.textContent = s.name[0];
      b.title = s.name;
      b.setAttribute('aria-label', `Select ${s.name}`);
      const mood = el('i', 'mood');
      mood.style.background = needColor(s.mood());
      const nm = el('span', 'nm', s.name);
      b.append(mood, nm);
      b.addEventListener('click', () => {
        if (g.selected === s) g.view.focus(s.pos.x, s.pos.z);
        g.select(s);
      });
      s._portrait = b;
      box.appendChild(b);
    }
    const add = el('button', 'add', '+');
    add.type = 'button';
    add.title = 'Add a sim';
    add.addEventListener('click', () => this.toggleMenu(true, 'cas'));
    box.appendChild(add);
    this.renderNeeds(true);
    $('card-toggle').onclick = () => $('simcard').classList.toggle('folded');
  }

  renderNeeds(rebuild = false) {
    const s = this.game.selected;
    if (!s) return;
    const box = $('needs');
    if (rebuild || !box.children.length) {
      box.textContent = '';
      for (const n of NEEDS) {
        const d = el('div', 'need');
        const lab = el('span');
        lab.append(el('em', null, n.name));
        d.append(lab, el('i'));
        d.lastChild.appendChild(el('b'));
        d.dataset.need = n.id;
        box.appendChild(d);
      }
    }
    for (const d of box.children) {
      const v = s.needs[d.dataset.need];
      const bar = d.querySelector('b');
      bar.style.width = `${Math.max(3, v)}%`;
      bar.style.background = needColor(v);
    }
    $('sim-name').textContent = s.name;
    $('sim-doing').textContent = s.task ? s.task.label : s.actor.state === 'seated' ? 'Sitting' : 'Idle';
    const q = $('queue');
    const tasks = [s.task, ...s.queue].filter(Boolean);
    const key = tasks.map((t) => t.label).join('|');
    if (key !== this._qkey) {
      this._qkey = key;
      q.textContent = '';
      for (const t of tasks) {
        const b = el('button', null, `${t.label} ✕`);
        b.type = 'button';
        b.title = 'Cancel';
        b.addEventListener('click', () => s.cancel(t));
        q.appendChild(b);
      }
    }
    for (const o of this.game.sims) if (o._portrait) o._portrait.querySelector('.mood').style.background = needColor(o.mood());
  }

  makePlumbob() {
    const geo = new THREE.OctahedronGeometry(0.11, 0);
    geo.scale(1, 1.9, 1);
    this.plumbob = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#3fd46b', emissive: '#1f9a45', emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.92 }));
    this.game.scene.add(this.plumbob);
  }

  // ------------------------------------------------------------ live tool

  makeLiveTool() {
    const g = this.game;
    return {
      click: (ev) => {
        if (this.pieOpen) { this.closePie(); return; }
        const sim = g.selected;
        if (!sim) return;
        const hit = g.pick(ev);
        let title, acts;
        if (hit?.sim) {
          if (hit.sim === sim) { title = sim.name; acts = selfActions(g, sim); }
          else {
            title = hit.sim.name;
            acts = [{ label: `Control ${hit.sim.name}`, select: hit.sim }, ...simActions(g, sim, hit.sim)];
          }
        } else if (hit?.item) {
          title = hit.item.entry.name;
          acts = itemActions(g, sim, hit.item);
          if (!acts.length) {
            // Nothing to do with it: walk there instead.
            const p = g.floorPoint(ev);
            acts = p ? floorActions(g, sim, p) : [];
          }
        } else {
          const p = g.floorPoint(ev);
          if (!p) return;
          // Floor clicks just go: no menu in the way.
          const t = floorActions(g, sim, p)[0].make();
          t.voiced = true;
          sim.push(t, { now: !ev.shiftKey });
          this.marker(p);
          return;
        }
        this.openPie(ev.clientX, ev.clientY, title, acts, hit?.sim && hit.sim !== sim ? hit.sim : null);
      },
      alt: () => this.closePie(),
    };
  }

  marker(p) {
    const g = this.game;
    if (!this._mark) {
      this._mark = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 24), new THREE.MeshBasicMaterial({ color: '#ffc23c', transparent: true, depthWrite: false }));
      this._mark.rotation.x = -Math.PI / 2;
      g.scene.add(this._mark);
    }
    this._mark.position.set(p.x, p.y + 0.03, p.z);
    this._mark.userData.t = 0.9;
    this._mark.visible = true;
  }

  openPie(x, y, title, acts, other) {
    const g = this.game;
    const pie = $('pie');
    pie.textContent = '';
    const r = acts.length > 6 ? 100 : 84;
    // Keep it on screen.
    x = Math.min(innerWidth - r - 70, Math.max(r + 70, x));
    y = Math.min(innerHeight - r - 40, Math.max(r + 90, y));
    pie.style.left = `${x}px`;
    pie.style.top = `${y}px`;
    const center = el('div', 'center panel', title);
    pie.appendChild(center);
    acts.forEach((a, i) => {
      const ang = -Math.PI / 2 + (i / Math.max(1, acts.length)) * Math.PI * 2;
      const b = el('button', 'opt', a.label);
      b.type = 'button';
      b.style.left = `${Math.cos(ang) * r * 1.35}px`;
      b.style.top = `${Math.sin(ang) * r}px`;
      b.style.transitionDelay = `${i * 18}ms`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePie();
        const sim = g.selected;
        if (a.select) { g.select(a.select); return; }
        if (a.chat) { this.openChat(other); return; }
        const t = a.make();
        t.voiced = true;
        sim.push(t, { now: !e.shiftKey });
      });
      pie.appendChild(b);
    });
    pie.hidden = false;
    requestAnimationFrame(() => pie.classList.add('open'));
    this.pieOpen = true;
    g.audio?.blip(880, 0.04, 0.08);
  }

  closePie() {
    const pie = $('pie');
    pie.hidden = true;
    pie.classList.remove('open');
    this.pieOpen = false;
  }

  // ------------------------------------------------------------ chat

  bindChat() {
    const chips = $('voice-chips');
    for (const [k, v] of Object.entries(VOICES)) {
      const b = el('button', 'chip', v.label);
      b.type = 'button';
      b.dataset.voice = k;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { const s = this.game.selected; if (s) { s.voice = k; s.actor.voice = k; } this.renderVoice(); $('chat-input').focus(); });
      chips.appendChild(b);
    }
    $('chat').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chat-input');
      const text = input.value.trim();
      input.value = '';
      if (text && this.game.selected) typedLine(this.game, this.game.selected, text, this.chatTo);
      this.closeChat();
    });
    $('chat-input').addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { this.closeChat(); e.preventDefault(); }
      if (e.code === 'Tab') {
        e.preventDefault();
        const s = this.game.selected;
        const keys = Object.keys(VOICES);
        if (s) { s.voice = keys[(keys.indexOf(s.voice) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]; s.actor.voice = s.voice; }
        this.renderVoice();
      }
      e.stopPropagation();
    });
  }

  renderVoice() {
    const s = this.game.selected;
    for (const c of $('voice-chips').querySelectorAll('.chip')) c.classList.toggle('on', c.dataset.voice === s?.voice);
  }

  openChat(to = null) {
    const s = this.game.selected;
    if (!s) return;
    this.chatTo = to;
    $('chat-to').textContent = to ? `${s.name} says to ${to.name}` : `${s.name} says`;
    this.renderVoice();
    $('chat').hidden = false;
    this.game.input.typing = true;
    this.game.audio?.unlock();
    $('chat-input').focus();
  }

  closeChat() {
    $('chat').hidden = true;
    this.game.input.typing = false;
    $('chat-input').blur();
  }

  // ------------------------------------------------------------ buy

  renderCatalog() {
    const tabs = $('cat-tabs');
    if (!tabs.children.length) {
      for (const c of CATEGORIES) {
        const b = el('button', 'tab');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.dataset.cat = c.id;
        b.append(el('span', 'ico', c.icon), c.name);
        b.addEventListener('click', () => { this.cat = c.id; this.renderCatalog(); });
        tabs.appendChild(b);
      }
    }
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.cat === this.cat));
    const grid = $('cat-grid');
    grid.textContent = '';
    const items = CATALOG.filter((e) => e.cat === this.cat);
    for (const e of items) {
      const b = el('button', 'card');
      b.type = 'button';
      b.dataset.id = e.id;
      const ph = el('span', 'ph', '…');
      b.append(ph, el('span', 'nm', e.name), el('span', 'price', money(e.price)));
      b.addEventListener('click', () => { this.build.hold(e.id); this.buyDirty = true; });
      grid.appendChild(b);
    }
    // Pictures render a few per frame so the sheet opens at once.
    this.thumbQueue = items.slice();
    this.buyDirty = true;
  }

  pumpThumbs() {
    if (!this.thumbQueue?.length) return;
    const grid = $('cat-grid');
    for (let k = 0; k < 3 && this.thumbQueue.length; k++) {
      const e = this.thumbQueue.shift();
      const url = this.thumbs.get(e);
      const card = grid.querySelector(`[data-id="${e.id}"]`);
      if (!card || !url) continue;
      const img = el('img');
      img.alt = '';
      img.src = url;
      card.querySelector('.ph').replaceWith(img);
    }
  }

  renderBuyBar() {
    const bar = $('buy-bar');
    const B = this.build;
    const h = B.held, s = B.selected;
    for (const c of $('cat-grid').children) c.classList.toggle('on', !!h && !h.moving && c.dataset.id === h.entry.id);
    bar.textContent = '';
    if (!h && !s) { bar.hidden = true; return; }
    bar.hidden = false;
    const btn = (label, fn, cls = '') => { const b = el('button', `btn ${cls}`, label); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b); return b; };
    if (h) {
      const what = el('span', 'what', h.moving ? `Moving ${h.entry.name}` : `${h.entry.name} · ${money(h.entry.price)}`);
      bar.appendChild(what);
      if (h.place?.why) bar.appendChild(el('span', 'why', h.place.why));
      btn('⟲', () => B.rotateHeld(-1));
      btn('⟳', () => B.rotateHeld(1));
      if (document.body.classList.contains('touch')) btn(h.moving ? 'Put here' : 'Buy here', () => B.place(), 'go');
      btn('Cancel', () => B.drop());
    } else {
      bar.appendChild(el('span', 'what', s.entry.name));
      btn('Move', () => B.pickUp(s));
      btn('⟲', () => B.rotateHeld(-1));
      btn('⟳', () => B.rotateHeld(1));
      btn('Another', () => B.duplicate(s));
      btn(`Sell ${money([s, ...this.game.home.items.children(s)].reduce((a, x) => a + x.entry.price, 0))}`, () => B.sell(s), 'danger');
    }
  }

  // ------------------------------------------------------------ build

  renderBuild() {
    const tabs = $('build-tabs');
    if (!tabs.children.length) {
      for (const t of BUILD_TOOLS) {
        const b = el('button', 'tab', t.name);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.dataset.kind = t.kind;
        b.addEventListener('click', () => { this.buildKind = t.kind; this.renderBuild(); });
        tabs.appendChild(b);
      }
    }
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.kind === this.buildKind));
    const tool = BUILD_TOOLS.find((t) => t.kind === this.buildKind);
    const sw = $('build-swatches');
    sw.textContent = '';
    const bar = $('build-bar');
    bar.textContent = '';
    const house = this.game.home.house;
    if (tool.set) {
      const current = { paint: this.swatch.paint, floor: this.swatch.floor, siding: house.exterior, roof: house.roofId }[tool.kind];
      for (const [id, f] of Object.entries(tool.set)) {
        const b = el('button', `swatch${id === current ? ' on' : ''}`);
        b.type = 'button';
        const chip = el('i');
        chip.style.background = f.swatch || '#999';
        if (tool.kind === 'roof') chip.style.background = { slate: '#4a5260', terracotta: '#b55a3a', cedar: '#7a5a44', sage: '#5f7358' }[id];
        b.append(chip, el('span', null, f.name));
        b.addEventListener('click', () => this.pickSwatch(tool.kind, id));
        sw.appendChild(b);
      }
    } else {
      const text = {
        door: 'Click a wall to cut a doorway (§200). Doors open for anyone walking through.',
        window: 'Click an outside wall to add a window (§120).',
        arch: 'Click a wall for an open archway between rooms (§200).',
        erase: 'Click a door or window to wall it up again.',
      }[tool.kind];
      sw.appendChild(el('p', 'hint', text));
    }
    const hint = {
      paint: 'Click a wall side to paint it. Shift-click (or turn on Whole room) to paint every wall in that room.',
      floor: 'Click a room\'s floor to lay it.',
      siding: 'Pick a finish for every outside wall.',
      roof: 'Pick a roof. Turn the roof on (⌂) to see it.',
    }[tool.kind];
    if (hint) bar.appendChild(el('span', 'hint', hint));
    if (tool.kind === 'paint') {
      const lab = el('label', 'tog');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.id = 'whole-room';
      cb.checked = !!this.wholeRoom;
      cb.addEventListener('change', () => { this.wholeRoom = cb.checked; this.applyBuildTool(); });
      lab.append(cb, ' Whole room');
      bar.appendChild(lab);
    }
    const undo = el('button', 'btn', 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', () => this.build.undo());
    bar.appendChild(undo);
    this.applyBuildTool();
  }

  applyBuildTool() {
    const k = this.buildKind;
    const B = this.build;
    if (k === 'paint') B.buildTool = { kind: 'paint', id: this.swatch.paint, room: this.wholeRoom };
    else if (k === 'floor') B.buildTool = { kind: 'floor', id: this.swatch.floor };
    else if (['door', 'window', 'arch', 'erase'].includes(k)) B.buildTool = { kind: k };
    else B.buildTool = null;
  }

  pickSwatch(kind, id) {
    const g = this.game;
    const house = g.home.house;
    if (kind === 'siding') { this.build.commit(); house.paintRoom(null, id); g.dirty = true; }
    else if (kind === 'roof') { this.build.commit(); house.setRoofStyle(id); if (!house.roofOn) { house.setRoof(true); $('roof-btn').classList.add('on'); } g.dirty = true; }
    else this.swatch[kind] = id;
    this.renderBuild();
  }

  // ------------------------------------------------------------ menu

  bindMenu() {
    const g = this.game;
    $('empty-house').addEventListener('click', () => { this.setMode('buy'); this.build.clearFurniture(); this.toast('Emptied: everything indoors was sold. Undo brings it back.'); this.toggleMenu(false); });
    $('reset-lot').addEventListener('click', () => {
      if (!this._confirmReset) { this._confirmReset = true; $('reset-lot').textContent = 'Really restore?'; setTimeout(() => { this._confirmReset = false; $('reset-lot').textContent = 'Restore preset'; }, 3000); return; }
      this._confirmReset = false;
      $('reset-lot').textContent = 'Restore preset';
      g.resetLot();
      this.build.undoStack = []; this.build.redoStack = [];
      this.toast('Restored the preset house');
      this.toggleMenu(false);
    });
    $('export-btn').addEventListener('click', () => { $('lot-json').value = JSON.stringify(g.exportLot()); $('lot-json').select(); this.toast('Lot copied into the box below'); });
    $('copy-btn').addEventListener('click', () => {
      const t = $('lot-json');
      if (!t.value) t.value = JSON.stringify(g.exportLot());
      const done = () => this.toast('Copied');
      try { navigator.clipboard.writeText(t.value).then(done, () => { t.select(); this.toast('Selected: press Ctrl+C to copy'); }); } catch { t.select(); }
    });
    $('import-btn').addEventListener('click', () => {
      try { g.importLot(JSON.parse($('lot-json').value)); this.toast('Lot imported'); this.toggleMenu(false); } catch (e) { this.toast(`Couldn't import: ${e.message}`); }
    });
    $('set-freewill').checked = g.settings.freeWill;
    $('set-voiceall').checked = g.settings.voiceAll;
    $('set-freewill').addEventListener('change', (e) => { g.settings.freeWill = e.target.checked; g.store.set('settings', g.settings); });
    $('set-voiceall').addEventListener('change', (e) => { g.settings.voiceAll = e.target.checked; g.store.set('settings', g.settings); });
    $('set-mute').addEventListener('change', (e) => { g.audio.setMuted(e.target.checked); g.speech.muted = e.target.checked; });
    // Create-a-sim, the short version: a name, a body, a voice.
    this.cas = { model: 'soldier', voice: 'boy' };
    const bodies = $('cas-body'), voices = $('cas-voice');
    for (const [k] of Object.entries(MODELS)) {
      const b = el('button', 'chip', BODY[k] || k);
      b.type = 'button';
      b.dataset.k = k;
      b.addEventListener('click', () => { this.cas.model = k; this.cas.voice = MODELS[k].sex === 'f' ? 'woman' : 'man'; this.renderCas(); });
      bodies.appendChild(b);
    }
    for (const [k, v] of Object.entries(VOICES)) {
      const b = el('button', 'chip', v.label);
      b.type = 'button';
      b.dataset.k = k;
      b.addEventListener('click', () => { this.cas.voice = k; this.renderCas(); });
      voices.appendChild(b);
    }
    $('cas-add').addEventListener('click', () => {
      const name = ($('cas-name').value || 'Sam').trim().slice(0, 16);
      const look = randomLook(this.cas.model, rng(Math.floor(Math.random() * 1e9)));
      const s = g.addSim({ name, model: this.cas.model, voice: this.cas.voice, look, needs: { hunger: 70, energy: 80, bladder: 80, hygiene: 80, fun: 50, social: 40 } });
      const [x, z] = g.home.plan.spawn;
      s.actor.place(g.home.lot.cx + x, 0.03, g.home.lot.cz + z + 1, Math.PI);
      g.select(s);
      g.dirty = true;
      this.renderHousehold();
      this.toggleMenu(false);
      this.toast(`${name} moved in`);
    });
    this.renderCas();
  }

  renderCas() {
    for (const b of $('cas-body').children) b.classList.toggle('on', b.dataset.k === this.cas.model);
    for (const b of $('cas-voice').children) b.classList.toggle('on', b.dataset.k === this.cas.voice);
  }

  renderLot() {
    const g = this.game;
    const lot = g.home.lot;
    $('lot-name').textContent = PLANS[lot.plan].name;
    $('lot-address').textContent = lot.address;
    const box = $('lots');
    box.textContent = '';
    for (const l of LOTS) {
      const b = el('button', 'lot');
      b.type = 'button';
      b.append(el('b', null, PLANS[l.plan].name), el('small', null, `${l.address} · ${PLANS[l.plan].blurb}`));
      if (l === lot) b.append(el('em', null, 'HOME'));
      b.addEventListener('click', () => {
        if (l === lot) return;
        this.build.undoStack = []; this.build.redoStack = [];
        g.moveTo(l.id);
        this.setMode(g.mode);
        this.toggleMenu(false);
        this.toast(`Moved to ${l.address}`);
      });
      box.appendChild(b);
    }
  }

  toggleMenu(open, section) {
    const m = $('menu');
    m.hidden = open === undefined ? !m.hidden : !open;
    if (!m.hidden && section === 'cas') $('cas-name').focus();
  }

  // ------------------------------------------------------------ keys

  bindKeys() {
    addEventListener('keydown', (e) => {
      const g = this.game;
      if (g.input.typing || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const B = this.build;
      if (e.code === 'Digit1' || e.code === 'F1') { this.setMode('live'); e.preventDefault(); }
      else if (e.code === 'Digit2' || e.code === 'F2') { this.setMode('buy'); e.preventDefault(); }
      else if (e.code === 'Digit3' || e.code === 'F3') { this.setMode('build'); e.preventDefault(); }
      else if (e.code === 'Space') { this.setSpeed(g.paused ? g.speed : 0); e.preventDefault(); }
      else if (e.code === 'Escape') { if (this.pieOpen) this.closePie(); else if (B.held) B.drop(); else if (B.selected) B.select(null); else if (!$('menu').hidden) this.toggleMenu(false); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { if (e.shiftKey ? B.redo() : B.undo()) this.toast(e.shiftKey ? 'Redone' : 'Undone'); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { if (B.redo()) this.toast('Redone'); e.preventDefault(); }
      else if (g.mode === 'live' && (e.code === 'KeyT' || e.code === 'Enter')) { this.openChat(); e.preventDefault(); }
      else if (g.mode === 'live' && e.code === 'Tab') { const i = g.sims.indexOf(g.selected); g.select(g.sims[(i + 1) % g.sims.length]); e.preventDefault(); }
      else if (g.mode === 'buy' && e.code === 'KeyR') B.rotateHeld(1, e.shiftKey);
      else if (g.mode === 'buy' && (e.code === 'Delete' || e.code === 'Backspace') && B.selected) B.sell();
      else if (g.mode === 'buy' && e.code === 'KeyM' && B.selected) B.pickUp(B.selected);
      g.audio?.unlock();
    });
    addEventListener('resize', () => this.setMode(this.game.mode));
  }

  // ------------------------------------------------------------ per frame

  update(dt) {
    const g = this.game;
    this.t += dt;
    // Clock.
    const h = g.day.hours;
    if (this._lastH !== undefined && h < this._lastH - 12) g.dayCount = (g.dayCount || 1) + 1;
    this._lastH = h;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    $('time').textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
    $('day').textContent = `Day ${g.dayCount || 1}`;
    const f = money(g.funds);
    if (this._funds !== f) { this._funds = f; $('funds').firstChild.textContent = f; }
    // Needs, a few times a second.
    this._nt = (this._nt || 0) + dt;
    if (this._nt > 0.25) { this._nt = 0; this.renderNeeds(); }
    // The plumbob over whoever you're steering.
    const s = g.selected;
    const pb = this.plumbob;
    pb.visible = !!s && g.mode === 'live';
    if (s) {
      s.actor.headPosition(pb.position);
      pb.position.y += 0.62 + Math.sin(this.t * 2.2) * 0.04;
      pb.rotation.y += dt * 1.6;
      const c = needColor(s.mood());
      pb.material.color.set(c);
      pb.material.emissive.set(c).multiplyScalar(0.5);
    }
    if (this._mark?.visible) { this._mark.userData.t -= dt; this._mark.material.opacity = Math.max(0, this._mark.userData.t); if (this._mark.userData.t <= 0) this._mark.visible = false; }
    if (g.mode === 'buy') {
      this.pumpThumbs();
      if (this.buyDirty) { this.buyDirty = false; this.renderBuyBar(); }
    }
  }
}
