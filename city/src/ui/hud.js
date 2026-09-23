// On-screen interface: prompt, chat bar with voice choice, emote bar,
// clock and place name, minimap, help, and the pause menu.
import * as THREE from 'three';
import { VOICES } from '../game/speech.js';
import { EMOTES } from '../core/actor.js';
import { XS, ZS, HALF_ROAD, WALK_W, BEACH, blockRect } from '../world/layout.js';
import { MODELS, randomLook } from '../core/cast.js';

const EMOTE_KEYS = [
  ['Digit1', 'wave', 'Wave'], ['Digit2', 'point', 'Point'], ['Digit3', 'cheer', 'Cheer'], ['Digit4', 'clap', 'Clap'],
  ['Digit5', 'dance', 'Dance'], ['Digit6', 'phone', 'Phone'], ['Digit7', 'arms_crossed', 'Arms crossed'], ['Digit8', 'think', 'Think'],
  ['Digit9', 'shrug', 'Shrug'], ['Digit0', 'sit_ground', 'Sit down'], ['Minus', 'facepalm', 'Facepalm'], ['Equal', 'samba', 'Samba'],
];

const PLACES = [
  { name: 'Ocean Drive', test: (x) => x > 184 && x < 196 },
  { name: 'Solana Beach', test: (x) => x > 206 && x < 330 },
  { name: 'The Promenade', test: (x) => x >= 196 && x <= 206 },
  { name: 'Palm Park', test: (x, z) => x > -32 && x < 32 && z > -70 && z < -6 },
  { name: 'Main Street', test: (x, z) => Math.abs(z) < 10 && x > -38 },
  { name: 'Downtown', test: (x) => x < -38 },
  { name: 'Art Deco District', test: (x) => x > 114 },
  { name: 'Midtown', test: () => true },
];

const ROOM_NAMES = { diner: 'Sunny Side Diner', store: '24/7 Quik Stop', apartment: 'Apartment 1A', bar: 'Neon Lounge', boutique: 'Maison Solana', office: 'Solana Media' };

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.el = (id) => document.getElementById(id);
    this.voice = load('voice', 'man');
    this.place = '';
    this.chatOpen = false;
    this.target = null;
    this.buildChat();
    this.buildEmotes();
    this.buildMenu();
    this.map = new Minimap(game, this.el('minimap'));
    this.bigMap = null;
    addEventListener('keydown', (e) => this.key(e));
    this.el('lock-hint')?.addEventListener('click', () => this.game.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 0 })));
    document.addEventListener('pointerlockchange', () => this.root.classList.toggle('locked', !!document.pointerLockElement));
    // Once someone has dragged or locked the mouse, they know; stop nagging.
    game.renderer.domElement.addEventListener('mousedown', () => setTimeout(() => this.root.classList.add('looked'), 1500));
    if (game.params.has('test')) this.root.classList.add('test');
  }

  key(e) {
    if (this.chatOpen) {
      if (e.code === 'Escape') { this.closeChat(); e.preventDefault(); }
      return;
    }
    if (this.menuOpen) {
      if (e.code === 'Escape' || e.code === 'KeyP') this.toggleMenu(false);
      return;
    }
    if (e.code === 'KeyT' || e.code === 'Enter') { this.openChat(); e.preventDefault(); return; }
    if (e.code === 'KeyH') { this.root.classList.toggle('help-open'); return; }
    if (e.code === 'KeyG') { this.root.classList.toggle('emotes-open'); return; }
    if (e.code === 'KeyM') { this.root.classList.toggle('map-open'); if (this.root.classList.contains('map-open')) this.drawBigMap(); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { this.toggleMenu(true); return; }
    const em = EMOTE_KEYS.find(([k]) => k === e.code);
    if (em) this.emote(em[1]);
    this.game.audio?.unlock();
  }

  emote(name) {
    const p = this.game.player;
    if (p.emote(name)) this.game.crowd?.sawEmote(name);
  }

  // ---------------------------------------------------------------- chat
  buildChat() {
    const chips = this.el('voice-chips');
    for (const [k, v] of Object.entries(VOICES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.voice = k;
      b.textContent = v.label;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { this.setVoice(k); this.el('chat-input').focus(); });
      chips.appendChild(b);
    }
    this.setVoice(this.voice);
    const form = this.el('chat-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.el('chat-input');
      const text = input.value.trim();
      input.value = '';
      if (text) this.say(text);
      this.closeChat();
    });
    this.el('chat-input').addEventListener('keydown', (e) => {
      // Tab cycles the voice without leaving the box.
      if (e.code === 'Tab') {
        e.preventDefault();
        const keys = Object.keys(VOICES);
        this.setVoice(keys[(keys.indexOf(this.voice) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]);
      }
      e.stopPropagation();
    });
    this.el('chat-input').addEventListener('blur', () => setTimeout(() => { if (this.chatOpen && document.activeElement !== this.el('chat-input')) this.closeChat(); }, 150));
  }

  setVoice(k) {
    this.voice = k;
    save('voice', k);
    for (const c of this.el('voice-chips').children) c.classList.toggle('on', c.dataset.voice === k);
    if (this.game.player) this.game.player.voice = k;
  }

  openChat(npc) {
    if (npc !== undefined) this.chatTarget(npc);
    this.chatOpen = true;
    this.root.classList.add('chat-open');
    this.game.input.typing = true;
    this.game.input.keys.clear();
    this.game.input.releaseLock();
    this.game.audio?.unlock();
    setTimeout(() => this.el('chat-input').focus(), 0);
  }

  closeChat() {
    this.chatOpen = false;
    this.root.classList.remove('chat-open');
    this.game.input.typing = false;
    this.el('chat-input').blur();
  }

  chatTarget(npc) {
    this.target = npc;
    this.el('chat-to').textContent = npc ? `Talking to ${npc.actor.name}` : 'Say something out loud';
  }

  say(text) {
    const g = this.game;
    g.audio?.unlock();
    g.speech.say(g.player, text, { voice: this.voice, priority: 3 });
    g.crowd?.heard(text);
    g.log?.push({ t: g.time, who: 'You', text, voice: this.voice });
  }

  // ---------------------------------------------------------------- emotes
  buildEmotes() {
    const list = this.el('emote-list');
    for (const [code, name, label] of EMOTE_KEYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emote';
      b.innerHTML = `<kbd>${code.replace('Digit', '').replace('Minus', '-').replace('Equal', '=')}</kbd>${label}`;
      b.addEventListener('click', () => { this.emote(name); this.root.classList.remove('emotes-open'); });
      list.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- menu
  buildMenu() {
    const g = this.game;
    this.el('menu-resume').addEventListener('click', () => this.toggleMenu(false));
    const time = this.el('menu-time');
    time.addEventListener('input', () => { g.day.setHours(Number(time.value)); });
    this.el('menu-speed').addEventListener('change', (e) => {
      const v = e.target.value;
      g.day.paused = v === 'paused';
      g.day.rate = v === 'fast' ? 1 / 6 : 1 / 60;
    });
    const q = this.el('menu-quality');
    q.value = g.quality;
    q.addEventListener('change', () => g.setQuality(q.value));
    g.onQuality = (v) => { q.value = v; };
    this.el('menu-mute').addEventListener('change', (e) => { g.speech.muted = e.target.checked; g.audio?.setMuted(e.target.checked); });
    const models = this.el('menu-models');
    for (const [k, label] of [['man', 'Man in a suit'], ['michelle', 'Michelle'], ['girl', 'Casual girl'], ['soldier', 'Soldier'], ['mannequin', 'Mannequin']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.addEventListener('click', () => { g.swapPlayer(k); this.toggleMenu(false); });
      models.appendChild(b);
    }
    this.el('menu-restyle').addEventListener('click', () => { g.swapPlayer(g.player.modelKey, true); this.toggleMenu(false); });
    this.el('menu-voicetest').addEventListener('click', () => {
      g.audio?.unlock();
      g.speech.say(g.player, `This is the ${VOICES[this.voice].label.toLowerCase()} voice.`, { voice: this.voice, priority: 3 });
    });
  }

  toggleMenu(open) {
    this.menuOpen = open;
    this.root.classList.toggle('menu-open', open);
    this.game.input.enabled = !open;
    if (open) {
      this.game.input.releaseLock();
      this.el('menu-time').value = this.game.day.hours.toFixed(2);
      const d = this.game.speech.describe();
      this.el('menu-voices').textContent = Object.entries(d).map(([k, v]) => `${VOICES[k].label}: ${v}`).join(' · ');
    }
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    g.speech?.bubbles.update(dt);
    // Prompt.
    const it = g.prompt;
    const prompt = this.el('prompt');
    const label = it ? it.label(p) : p.state === 'seated' || p.state === 'lying' ? 'Move to stand up' : null;
    if (label !== this._label) {
      this._label = label;
      prompt.hidden = !label;
      this.el('prompt-text').textContent = (label || '').replace(/^F: /, '');
      this.el('prompt-key').hidden = !it;
      this.el('prompt-key').textContent = it?.keyLabel || 'E';
    }
    // Clock.
    this.el('clock').textContent = g.day.clockString();
    // Place.
    const pos = p.object.position;
    const room = g.world?.rooms?.find((r) => r.inside(pos.x, pos.z));
    const place = room ? ROOM_NAMES[room.kind] : (PLACES.find((pl) => pl.test(pos.x, pos.z))?.name || '');
    if (place !== this.place) {
      this.place = place;
      const el = this.el('place');
      el.textContent = place;
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    }
    if (p.vehicle) this.el('speed').textContent = `${Math.round(Math.abs(p.vehicle.speed) * 3.6)} km/h`;
    this.el('speed').hidden = !p.vehicle;
    this.map.draw(p, g.follow.yaw);
  }

  drawBigMap() { this.map.drawFull(this.el('bigmap'), this.game.player); }
}

// ---------------------------------------------------------------------------
// Minimap: the plan painted once to a canvas, then shown rotated with the
// camera around the player.
class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.x0 = -270; this.z0 = -240; this.w = 620; this.h = 480; this.s = 2;
    this.base = this.paint();
  }

  paint() {
    const c = document.createElement('canvas');
    c.width = this.w * this.s; c.height = this.h * this.s;
    const x = c.getContext('2d');
    const P = (wx, wz) => [(wx - this.x0) * this.s, (wz - this.z0) * this.s];
    const rect = (x0, z0, x1, z1, col) => { const [a, b] = P(x0, z0); const [e, f] = P(x1, z1); x.fillStyle = col; x.fillRect(a, b, e - a, f - b); };
    x.fillStyle = '#1b2230'; x.fillRect(0, 0, c.width, c.height);
    rect(BEACH.promenade1 + 40, -300, 700, 300, '#1f5f6f');
    rect(BEACH.promenade1, -260, BEACH.promenade1 + 45, 260, '#d8c49a');
    rect(BEACH.promenade0, -260, BEACH.promenade1, 260, '#c9b8a0');
    // Roads.
    for (const xx of XS) rect(xx - HALF_ROAD, ZS[0] - HALF_ROAD, xx + HALF_ROAD, ZS[4] + HALF_ROAD, '#3a3f4a');
    for (const zz of ZS) rect(XS[0] - HALF_ROAD, zz - HALF_ROAD, XS[5] + HALF_ROAD, zz + HALF_ROAD, '#3a3f4a');
    rect(BEACH.promenade1, -3, BEACH.pierEnd, 3, '#8a6a4a');
    const g = this.game.world;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) { const b = blockRect(i, j); rect(b.x0, b.z0, b.x1, b.z1, '#9a948a'); }
    for (const s of g?.plan.special || []) {
      if (s.kind === 'park') rect(s.x0 + WALK_W, s.z0 + WALK_W, s.x1 - WALK_W, s.z1 - WALK_W, '#4f7f3e');
      if (s.kind === 'parking') rect(s.x0 + WALK_W, s.z0 + WALK_W, s.x1 - WALK_W, s.z1 - WALK_W, '#4a4f58');
      if (s.kind === 'court') rect(s.x0 + 10, s.z0 + 18, s.x1 - 10, s.z1 - 10, '#c46a3a');
    }
    for (const l of g?.plan.lots || []) rect(l.x0, l.z0, l.x1, l.z1, l.interior ? '#e6b14a' : '#e8e1d4');
    this.P = P;
    return c;
  }

  draw(player, camYaw) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const p = player.object.position;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.clip();
    ctx.translate(W / 2, H / 2);
    // Up on the minimap is where the camera looks: rotating by the camera
    // yaw turns its ground-forward (-sin yaw, -cos yaw) to canvas-up.
    ctx.rotate(camYaw);
    const [px, pz] = this.P(p.x, p.z);
    const zoom = 1.25;
    ctx.scale(zoom / this.s * 1.0, zoom / this.s * 1.0);
    ctx.drawImage(this.base, -px, -pz);
    // Others.
    ctx.fillStyle = '#ffffff';
    for (const a of this.game.actors) {
      if (a === player) continue;
      const [ax, az] = this.P(a.object.position.x, a.object.position.z);
      if (Math.abs(ax - px) > 200 || Math.abs(az - pz) > 200) continue;
      ctx.fillStyle = a.state === 'driving' ? '#7fd3ff' : 'rgba(255,255,255,0.8)';
      ctx.fillRect(ax - px - 2, az - pz - 2, 4, 4);
    }
    for (const car of this.game.traffic?.cars || []) {
      if (car.driver === player) continue;
      const [ax, az] = this.P(car.object.position.x, car.object.position.z);
      if (Math.abs(ax - px) > 220 || Math.abs(az - pz) > 220) continue;
      ctx.fillStyle = '#7fd3ff';
      ctx.fillRect(ax - px - 3, az - pz - 3, 6, 6);
    }
    ctx.restore();
    // Player arrow: its facing (sin h, cos h), rotated like the map.
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI - player.heading + camYaw);
    ctx.fillStyle = '#ff7a59';
    ctx.strokeStyle = '#1b2230'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // North (-Z, canvas-up on the base map) after the same rotation.
    const r = W / 2 - 11;
    ctx.fillStyle = '#f3e9dc'; ctx.font = 'bold 13px Rajdhani, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', W / 2 + r * Math.sin(camYaw), H / 2 - r * Math.cos(camYaw));
  }

  drawFull(canvas, player) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.clientWidth * devicePixelRatio;
    const H = canvas.height = canvas.clientHeight * devicePixelRatio;
    const k = Math.min(W / this.base.width, H / this.base.height);
    ctx.fillStyle = '#10151e'; ctx.fillRect(0, 0, W, H);
    const ox = (W - this.base.width * k) / 2, oy = (H - this.base.height * k) / 2;
    ctx.drawImage(this.base, ox, oy, this.base.width * k, this.base.height * k);
    const pt = (x, z) => { const [a, b] = this.P(x, z); return [ox + a * k, oy + b * k]; };
    ctx.font = `600 ${Math.round(13 * devicePixelRatio)}px Rajdhani, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const room of this.game.world?.rooms || []) {
      const [x, y] = pt(room.entrance.x, room.entrance.z);
      ctx.fillStyle = '#ff4fa0'; ctx.beginPath(); ctx.arc(x, y, 5 * devicePixelRatio, 0, 7); ctx.fill();
      ctx.fillStyle = '#f3e9dc'; ctx.fillText(ROOM_NAMES[room.kind], x, y - 9 * devicePixelRatio);
    }
    for (const [label, x, z] of [['Palm Park', 0, -38], ['Solana Beach', 240, -90], ['Pier', 290, -8], ['Downtown', -114, -38], ['Parking', -76, 38], ['Court', -152, -20]]) {
      const [a, b] = pt(x, z); ctx.fillStyle = 'rgba(243,233,220,0.85)'; ctx.fillText(label, a, b);
    }
    const [px, py] = pt(player.object.position.x, player.object.position.z);
    ctx.fillStyle = '#ff7a59'; ctx.beginPath(); ctx.arc(px, py, 7 * devicePixelRatio, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
}

function load(k, d) { try { return localStorage.getItem(`ps:${k}`) || d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(`ps:${k}`, v); } catch { /* storage blocked: setting lasts this visit */ } }
