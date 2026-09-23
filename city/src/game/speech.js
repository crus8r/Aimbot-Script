// Speech: text becomes a voiced line with a bubble and a talking body.
//
// Four voice presets, chosen from whatever voices the viewer's system has
// (they differ per OS and browser), then shaped with pitch and rate. When a
// browser has no speech synthesis at all, bubbles still appear and the
// character still talks for as long as the line would take to say.
import * as THREE from 'three';

export const VOICES = {
  man: { label: 'Adult male', sex: 'm', pitch: 0.92, rate: 1.0 },
  woman: { label: 'Adult female', sex: 'f', pitch: 1.08, rate: 1.0 },
  boy: { label: 'Boy', sex: 'm', pitch: 1.55, rate: 1.08 },
  girl: { label: 'Girl', sex: 'f', pitch: 1.75, rate: 1.1 },
};

// Name fragments that identify a system voice's sex. Voices rarely say so
// directly, so this is a list of the common ones across macOS, Windows,
// Chrome and Android.
const MALE = /\b(male|man|david|mark|daniel|alex|fred|george|guy|james|john|ryan|thomas|oliver|arthur|aaron|gordon|rishi|tom|jorge|diego|reed|eddy|rocko|ralph|junior|bruce|lee|christopher|eric|roger|steffan|brian|andrew|william)\b/i;
const FEMALE = /\b(female|woman|samantha|victoria|karen|zira|susan|hazel|serena|moira|tessa|fiona|allison|ava|kate|kathy|vicki|veena|joanna|salli|kimberly|ivy|emma|amy|aria|jenny|michelle|libby|sonia|natasha|catherine|nicky|flo|sandy|shelley|grandma|martha|google us english|google uk english female)\b/i;

export class Speech {
  constructor(game) {
    this.game = game;
    this.synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    this.voices = [];
    this.current = null;
    this.muted = false;
    this.volume = 1;
    this.bubbles = new Bubbles(game);
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices().filter((v) => /^en/i.test(v.lang)); this.assign(); };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
    this.map = {};
  }

  // Pick a system voice for each preset: English, sex-matched, local first.
  assign() {
    const byScore = (sex) => [...this.voices].sort((a, b) => score(b, sex) - score(a, sex));
    const score = (v, sex) => {
      let s = 0;
      if ((sex === 'm' ? MALE : FEMALE).test(v.name)) s += 10;
      if ((sex === 'm' ? FEMALE : MALE).test(v.name)) s -= 10;
      if (/en[-_]US/i.test(v.lang)) s += 2;
      if (/natural|neural|premium|enhanced|online/i.test(v.name)) s += 3;
      if (v.localService) s += 1;
      return s;
    };
    const males = byScore('m'), females = byScore('f');
    this.map = {
      man: males[0] || null,
      woman: females[0] || null,
      boy: males[1] || males[0] || null,
      girl: females[1] || females[0] || null,
    };
  }

  describe() {
    return Object.fromEntries(Object.entries(this.map).map(([k, v]) => [k, v ? `${v.name} (${v.lang})` : 'bubble only']));
  }

  // Say a line. `voiced` false = bubble and body only (distant chatter).
  say(actor, text, { voice = actor.voice, voiced = true, priority = 1, onEnd } = {}) {
    text = String(text).trim().slice(0, 240);
    if (!text) return;
    const words = text.split(/\s+/).length;
    const preset = VOICES[voice] || VOICES.man;
    const est = Math.max(1.2, (words / 2.6) / preset.rate + 0.4);
    const bubble = this.bubbles.show(actor, text, est + 1.8);
    actor.setSpeaking(true, est);
    const canVoice = voiced && this.synth && !this.muted && this.game.audioUnlocked !== false;
    if (!canVoice) {
      setTimeout(() => onEnd?.(), est * 1000);
      return;
    }
    if (this.current && this.current.priority > priority && this.synth.speaking) {
      // Someone more important is talking; this one just mouths it.
      setTimeout(() => onEnd?.(), est * 1000);
      return;
    }
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.map[voice];
    if (v) u.voice = v;
    u.pitch = preset.pitch;
    u.rate = preset.rate;
    u.volume = this.volume;
    const entry = { actor, priority, u };
    this.current = entry;
    u.onstart = () => { actor.setSpeaking(true, est * 2); bubble.reveal(0); };
    u.onboundary = (e) => { if (e.name === 'word' || e.charIndex !== undefined) bubble.reveal(e.charIndex); };
    const done = () => {
      if (this.current === entry) this.current = null;
      actor.setSpeaking(false);
      bubble.reveal(text.length);
      bubble.hold(1.6);
      onEnd?.();
    };
    u.onend = done;
    u.onerror = done;
    this.synth.speak(u);
    // Chrome sometimes never fires onend for long lines.
    setTimeout(() => { if (this.current === entry && !this.synth.speaking) done(); }, (est * 2 + 3) * 1000);
  }

  stopAll() { this.synth?.cancel(); this.current = null; }
}

// Speech bubbles are DOM elements tracked over heads each frame.
class Bubbles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.layer = document.getElementById('bubbles') || document.body;
    this._v = new THREE.Vector3();
  }

  show(actor, text, life) {
    // One bubble per actor: a new line replaces the old.
    for (const b of this.list) if (b.actor === actor) b.kill();
    const el = document.createElement('div');
    el.className = 'bubble';
    el.style.opacity = '0';          // until the first frame positions it
    if (actor.isPlayer) el.classList.add('you');
    const name = document.createElement('b');
    name.textContent = actor.isPlayer ? 'You' : actor.name;
    const body = document.createElement('span');
    el.append(name, body);
    this.layer.appendChild(el);
    const b = {
      actor, el, body, text, t: 0, life, shown: -1,
      reveal: (i) => {
        // Reveal whole words up to character i, so the bubble reads in step
        // with the voice.
        const end = i >= text.length ? text.length : Math.max(i, text.indexOf(' ', i + 1) === -1 ? text.length : text.indexOf(' ', i + 1));
        if (end !== b.shown) { b.shown = end; body.textContent = text.slice(0, end); }
      },
      hold: (s) => { b.life = Math.max(b.life, b.t + s); },
      kill: () => { b.life = 0; },
    };
    body.textContent = text;       // full text until voice timing arrives
    this.list.push(b);
    return b;
  }

  update(dt) {
    const cam = this.game.camera;
    const w = innerWidth, h = innerHeight;
    for (const b of this.list) {
      b.t += dt;
      const v = b.actor.headPosition(this._v);
      v.y += 0.42;
      const d = v.distanceTo(cam.position);
      v.project(cam);
      const visible = v.z < 1 && d < 32 && b.actor.object.visible !== false;
      const fade = Math.min(1, (b.life - b.t) / 0.4) * Math.min(1, (32 - d) / 8);
      b.el.style.opacity = visible ? Math.max(0, fade).toFixed(2) : '0';
      if (visible) {
        const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
        const s = THREE.MathUtils.clamp(9 / d, 0.62, 1.1);
        b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      }
    }
    this.list = this.list.filter((b) => {
      if (b.t < b.life) return true;
      b.el.remove();
      return false;
    });
  }
}
