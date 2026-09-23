// Sound, all synthesised: the sea, the city's hum, a jukebox that actually
// plays a tune, a piano under the player's fingers. Nothing starts until the
// viewer has clicked or pressed a key (browsers require it).
import * as THREE from 'three';
import { shoreline } from '../world/nature.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.muted = false;
    this.sources = [];
    this.shoreX = shoreline();
    const unlock = () => this.unlock();
    addEventListener('pointerdown', unlock, { once: false });
    addEventListener('keydown', unlock, { once: false });
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise();
    this.startAmbience();
    for (const s of this.sources) if (s.wantOn) s.start();
    this.game.audioUnlocked = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; }
    return buf;
  }

  loopNoise(filterType, freq, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return { src, f, g };
  }

  startAmbience() {
    // Surf: filtered noise swelling on a slow cycle.
    this.sea = this.loopNoise('lowpass', 700, 0);
    // City: a low, distant rumble.
    this.city = this.loopNoise('lowpass', 180, 0);
  }

  update(dt) {
    if (!this.ctx) return;
    const p = this.game.player?.object.position || this.game.camera.position;
    const t = this.ctx.currentTime;
    const dSea = Math.max(0, this.shoreX - p.x);
    const inside = this.game.world?.rooms?.some((r) => r.inside(p.x, p.z));
    const swell = 0.55 + 0.45 * Math.sin(t * 0.55) * Math.sin(t * 0.21 + 1);
    const seaVol = (inside ? 0.15 : 1) * 0.5 * Math.max(0, 1 - dSea / 140) * swell;
    this.sea.g.gain.setTargetAtTime(seaVol, t, 0.3);
    this.sea.f.frequency.setTargetAtTime(500 + swell * 700, t, 0.3);
    this.city.g.gain.setTargetAtTime((inside ? 0.05 : 0.14) * (1 - 0.6 * this.game.day.night), t, 0.5);
    for (const s of this.sources) s.update?.(p);
  }

  // A positional music source: the jukebox tune.
  jukebox(pos, { on = false, room = null } = {}) {
    const self = this;
    const s = {
      pos: pos.clone(), wantOn: on, playing: false, room,
      start() {
        this.wantOn = true;
        if (!self.ctx || this.playing) return;
        this.playing = true;
        this.gain = self.ctx.createGain(); this.gain.gain.value = 0; this.gain.connect(self.master);
        this.seq = new Sequencer(self.ctx, this.gain, self.noise);
        this.seq.start();
      },
      stop() {
        this.wantOn = false;
        if (!this.playing) return;
        this.playing = false;
        this.seq.stop();
        this.gain.gain.setTargetAtTime(0, self.ctx.currentTime, 0.1);
      },
      toggle() { if (this.wantOn) this.stop(); else this.start(); return this.wantOn; },
      update(p) {
        if (!this.playing) return;
        const d = p.distanceTo(this.pos);
        const inRoom = this.room ? this.room.inside(p.x, p.z, 0.5) : true;
        const vol = Math.max(0, 1 - d / 30) * (inRoom ? 0.6 : 0.12);
        this.gain.gain.setTargetAtTime(vol, self.ctx.currentTime, 0.2);
      },
    };
    this.sources.push(s);
    return s;
  }

  // Piano: while someone plays, improvise over the same progression.
  piano(pos) {
    const self = this;
    const s = {
      pos: pos.clone(), wantOn: false, playing: false,
      start() {
        this.wantOn = true;
        if (!self.ctx || this.playing) return;
        this.playing = true;
        this.gain = self.ctx.createGain(); this.gain.gain.value = 0.5; this.gain.connect(self.master);
        let step = 0;
        const scale = [0, 2, 4, 7, 9, 12, 14, 16];
        const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
        this.timer = setInterval(() => {
          const t = self.ctx.currentTime + 0.05;
          const ch = chords[Math.floor(step / 8) % 4];
          if (step % 8 === 0) for (const n of ch) pianoNote(self.ctx, this.gain, NOTE(n - 12), t, 1.6, 0.18);
          if (Math.random() < 0.75) pianoNote(self.ctx, this.gain, NOTE(ch[0] + 12 + scale[Math.floor(Math.random() * scale.length)]), t, 0.8, 0.22);
          step++;
        }, 280);
      },
      stop() { this.wantOn = false; if (!this.playing) return; this.playing = false; clearInterval(this.timer); },
      update(p) { if (this.playing) this.gain.gain.setTargetAtTime(Math.max(0, 1 - p.distanceTo(this.pos) / 25) * 0.7, self.ctx.currentTime, 0.2); },
    };
    this.sources.push(s);
    return s;
  }

  blip(freq = 880, dur = 0.08, vol = 0.15) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  fizz() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    const g = this.ctx.createGain(); const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.4);
  }
}

function pianoNote(ctx, out, freq, t, dur, vol) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  g.connect(out);
  for (const [mult, amp] of [[1, 1], [2, 0.4], [3, 0.15], [4, 0.08]]) {
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = freq * mult;
    const og = ctx.createGain(); og.gain.value = amp;
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

// A small four-bar groove: kick, snare, hats, bass and chord stabs, looped.
class Sequencer {
  constructor(ctx, out, noise) { this.ctx = ctx; this.out = out; this.noise = noise; this.step = 0; }
  start() {
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }
  stop() { clearInterval(this.timer); }
  schedule() {
    const spb = 60 / 104 / 4;       // 104bpm, 16th notes
    while (this.next < this.ctx.currentTime + 0.25) {
      this.play(this.step % 64, this.next, spb);
      this.next += spb; this.step++;
    }
  }
  play(s, t, spb) {
    const ctx = this.ctx, out = this.out;
    const bar = Math.floor(s / 16), q = s % 16;
    const roots = [45, 41, 36, 43];
    const root = roots[bar];
    if (q % 4 === 0) { // kick
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.22);
    }
    if (q === 4 || q === 12) this.noiseHit(t, 'bandpass', 1800, 0.35, 0.15);
    if (q % 2 === 1) this.noiseHit(t, 'highpass', 8000, 0.12, 0.04);
    if ([0, 3, 6, 10, 14].includes(q)) this.tone(NOTE(root - 12), t, spb * 1.8, 'triangle', 0.35);
    if (q === 2 || q === 10) for (const iv of [12, 16, 19]) this.tone(NOTE(root + iv), t, spb * 1.5, 'sawtooth', 0.045, 1400);
    if (q === 8 && bar % 2 === 1) this.tone(NOTE(root + 24 + [7, 4, 2, 0][bar]), t, spb * 3, 'square', 0.04, 2200);
  }
  tone(freq, t, dur, type, vol, lp = 0) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = o;
    if (lp) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  noiseHit(t, type, freq, vol, dur) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out); src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
}
