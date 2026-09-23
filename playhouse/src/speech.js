/**
 * Browser TTS for Playhouse.
 *
 * SpeechDirector turns dialogue beats into SpeechSynthesis utterances with
 * deterministic per-character voices, fits each line's rate to its shot slot,
 * exposes a bounded `holding` stall for lines that overrun, and produces a
 * 0..1 mouth envelope with the same contract as AudioTrack.level().
 *
 * Self-contained by design: no imports, nothing attached to the app. The
 * integrator constructs one instance in main.js and calls:
 *   - unlock()          synchronously inside a user gesture (before any await)
 *   - assignVoices()    after every stageScript()
 *   - speakBeat()       from production.onBeatChange
 *   - update(dt)        once per frame, plus level() for the speaker's mouth
 *   - cancel()          on seek, pause, stageScript, pagehide/hidden
 *
 * Every path is guarded: with no window.speechSynthesis (some WebViews) the
 * whole class is a no-op that returns false/0/null and never throws.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * FNV-1a 32-bit. human.js and director.js each keep an unexported copy of the
 * same hash — a private copy per module is the established pattern here.
 */
function hash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Bigger frame implies a longer vocal tract implies a lower pitch. There is
// no gender field on a character spec — build/height/jaw are the only signals.
const BUILD_PITCH = { slim: 0.10, willowy: 0.12, average: 0, sturdy: -0.10, broad: -0.14 };
const EMOTION_RATE = {
  angry: 0.12, afraid: 0.10, joyful: 0.08, resolute: 0.06,
  wonder: -0.08, tender: -0.12, sad: -0.15,
};
const EMOTION_PITCH = { afraid: 0.08, joyful: 0.06, tender: 0.02, angry: -0.05, sad: -0.06 };

// The spec allows pitch 0..2 but the extremes sound synthetic, and Safari
// compresses the usable range hard.
const PITCH_MIN = 0.6;
const PITCH_MAX = 1.5;
const RATE_MIN = 0.6;
const RATE_MAX = 1.6;

/** Character-baseline pitch from an appearance spec. Deterministic; clamped. */
function basePitchFor(spec, name = spec?.name ?? '') {
  const build = spec?.build;
  const height = spec?.height ?? 1;
  const jaw = spec?.face?.jaw ?? 1;
  const pitch = 1
    + (BUILD_PITCH[build] ?? 0)
    - (height - 1) * 1.2
    - (jaw - 1) * 0.25
    + ((hash(String(name).toUpperCase()) % 100) / 100 - 0.5) * 0.12;
  return clamp(pitch, PITCH_MIN, PITCH_MAX);
}

/**
 * Per-beat prosody layered on the character baseline. Pure.
 * @param {object|null} spec appearance spec from production.specs (may be null)
 * @param {object} beat parsed beat with emotion/intensity
 * @returns {{pitch:number, rate:number}} absolute pitch and rate for this line
 */
export function prosodyFor(spec, beat) {
  const emotion = beat?.emotion || 'neutral';
  const intensity = beat?.intensity ?? 0.5;
  const rate = clamp(1 + (EMOTION_RATE[emotion] ?? 0) + (intensity - 0.5) * 0.12, RATE_MIN, RATE_MAX);
  const pitch = clamp(basePitchFor(spec) + (EMOTION_PITCH[emotion] ?? 0), PITCH_MIN, PITCH_MAX);
  return { pitch, rate };
}

/**
 * Deterministic, collision-free voice assignment. Pure.
 *
 * `voices` must already be the canonical pool (language-filtered, local-first,
 * name-sorted) — getVoices() ordering is NOT stable across browsers, so the
 * caller's sort is what makes this deterministic.
 *
 * @param {string[]} names character names, in script order (already sorted by
 *   line count in parser.js, so the ordering is deterministic too)
 * @param {Map<string,object>|Object<string,object>} specs name -> appearance spec
 * @param {SpeechSynthesisVoice[]} voices canonical pool
 * @returns {Map<string, {voice:object|null, pitch:number, rate:number, offset:number}>}
 */
export function voicePlanFor(names, specs, voices) {
  const pool = voices || [];
  const plan = new Map();
  const claimed = new Set();
  let reuseRound = 0;
  for (const name of names || []) {
    const spec = specs?.get ? specs.get(name) : specs?.[name];
    const base = basePitchFor(spec, name);
    if (!pool.length) {
      // Legitimate end state (some Android WebViews): the system default voice
      // still speaks; characters are then differentiated by pitch alone.
      plan.set(name, { voice: null, pitch: base, rate: 1, offset: 0 });
      continue;
    }
    if (claimed.size >= pool.length) {
      // Characters outnumber voices: wrap and reuse, but nudge pitch by a
      // deterministic ±0.14 per round so reused voices stay audibly separate.
      claimed.clear();
      reuseRound++;
    }
    let i = hash(name.toUpperCase()) % pool.length;
    while (claimed.has(i)) i = (i + 1) % pool.length;
    claimed.add(i);
    const offset = reuseRound === 0 ? 0 : 0.14 * reuseRound * (reuseRound % 2 ? 1 : -1);
    plan.set(name, { voice: pool[i], pitch: clamp(base + offset, PITCH_MIN, PITCH_MAX), rate: 1, offset });
  }
  return plan;
}

export class SpeechDirector {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.enabled=true]
   * @param {boolean} [opts.speakLyrics=false] read lyric beats aloud (not sung)
   * @param {boolean} [opts.speakAction=false] narrator mode for action beats
   */
  constructor(opts = {}) {
    /** Master switch, read/write from the UI. */
    this.enabled = opts.enabled ?? true;
    /** Default for lyric beats; opts.singLyrics on speakBeat overrides per call. */
    this.speakLyrics = opts.speakLyrics ?? false;
    /** Default for action beats; opts.speakAction on speakBeat overrides per call. */
    this.speakAction = opts.speakAction ?? false;
    /** Set true while an uploaded recording is the master clock — the
     *  recording is the performance; two clocks fighting is worse than either. */
    this.suppressed = false;
    /** 0..1. NOTE: iOS ignores utterance.volume on several versions. */
    this.volume = 1;

    this._supported = typeof window !== 'undefined'
      && !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;
    this._synth = this._supported ? window.speechSynthesis : null;

    this._unlocked = false;
    this._ready = false;
    this._voices = [];    // full known list (for the UI)
    this._pool = [];      // canonical assignment pool (lang-filtered, local-first, sorted)
    this._plan = new Map();
    this._overrides = new Map(); // name -> voiceURI, survives re-assignment
    this._characters = null;
    this._specs = null;
    this._voicesPromise = null;
    this._settleVoices = null;

    // Live utterance state.
    this._token = 0;
    this._utter = null;
    this._beat = null;
    this._charName = null;
    this._resolve = null;
    this._promise = Promise.resolve(false);
    this._speaking = false;
    this._holding = false;
    this._started = false;
    this._slotLeft = 0;
    this._holdLeft = 0;
    this._watchdog = 0;
    this._hardTimer = 0;
    this._heartbeat = 0;

    // Mouth envelope.
    this._env = 0;
    this._envTarget = 0;
    this._decay = 6;
    this._sawBoundary = false;
    this._synthetic = false;
    this._boundaryTimer = 0;
    this._phase = 0;
    this._intensity = 0.5;

    if (this._supported) {
      // One persistent listener does double duty: it settles the resolveVoices
      // race AND keeps the pool fresh when Chrome adds voices late. Fall back
      // to onvoiceschanged where addEventListener is missing (older Safari).
      const changed = () => this.#onVoicesChanged();
      try {
        if (typeof this._synth.addEventListener === 'function') {
          this._synth.addEventListener('voiceschanged', changed);
        } else if ('onvoiceschanged' in this._synth) {
          this._synth.onvoiceschanged = changed;
        }
      } catch { /* never fatal */ }
      this.resolveVoices(); // cheap, non-blocking warm-up
    }
  }

  /** True when the browser has SpeechSynthesis at all. */
  get supported() { return this._supported; }
  /** True once the voice list has resolved — possibly resolved-empty. */
  get ready() { return this._ready; }
  /** True once a user gesture has armed the engine. */
  get unlocked() { return this._unlocked; }
  /** True while an utterance is live (queued or sounding). */
  get speaking() { return this._speaking; }
  /** Name of the character currently speaking, or null. */
  get character() { return this._charName; }
  /** True while an overrunning line should stall the production clock. */
  get holding() { return this._holding; }

  /**
   * Full known voice list for UI pickers, local voices first then by name.
   * (Assignment uses an internal language-filtered pool; the UI list stays
   * unfiltered so users can pick any voice as an override.)
   */
  get voices() {
    const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1
      : a.voiceURI < b.voiceURI ? -1 : a.voiceURI > b.voiceURI ? 1 : 0);
    return this._voices.slice().sort((a, b) =>
      (b.localService === true) - (a.localService === true) || byName(a, b));
  }

  // -------------------------------------------------------------------------
  // Arming
  // -------------------------------------------------------------------------

  /**
   * Arm the engine. MUST be called synchronously inside a user gesture —
   * on Safari an `await` before this breaks the gesture chain and every later
   * speak() is silently dropped (often without ever firing onend).
   */
  unlock() {
    if (!this._supported || this._unlocked) return;
    try {
      // A single space, not '': some engines reject empty text outright.
      const u = new window.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 1;
      this._synth.speak(u);
      this._unlocked = true;
      try { this._synth.cancel(); } catch { /* primer already queued; fine */ }
    } catch { /* stay locked; a later gesture can retry */ }
  }

  // -------------------------------------------------------------------------
  // Voices
  // -------------------------------------------------------------------------

  #getVoicesSafe() {
    try { return this._synth.getVoices() || []; } catch { return []; }
  }

  #onVoicesChanged() {
    this._voices = this.#getVoicesSafe();
    if (!this._voices.length) return;
    this.#rebuildPool();
    this._settleVoices?.();
    // Voices arriving after casting: re-assign so characters get real voices
    // instead of everyone sharing the system default for the rest of the show.
    if (this._characters) this.#computePlan();
  }

  /**
   * Resolve the voice list. Idempotent — returns a cached promise that settles
   * on whichever lands first: the voiceschanged event (Chrome), a bounded
   * 100ms poll (Safari versions where the event is unreliable), or a 2.5s
   * timeout that resolves with whatever exists, possibly [].
   * @returns {Promise<SpeechSynthesisVoice[]>}
   */
  resolveVoices() {
    if (!this._supported) {
      this._ready = true;
      return Promise.resolve([]);
    }
    if (this._voicesPromise) return this._voicesPromise;
    this._voicesPromise = new Promise((resolve) => {
      let done = false;
      let iv = 0;
      let to = 0;
      const settle = () => {
        if (done) return;
        done = true;
        clearInterval(iv);
        clearTimeout(to);
        this._settleVoices = null;
        this._voices = this.#getVoicesSafe();
        this.#rebuildPool();
        this._ready = true;
        resolve(this._voices);
      };
      this._settleVoices = settle;
      if (this.#getVoicesSafe().length) { settle(); return; }
      let tries = 0;
      iv = setInterval(() => {
        tries++;
        if (this.#getVoicesSafe().length) settle();
        else if (tries >= 20) clearInterval(iv); // ~2s; leave the timeout to settle
      }, 100);
      to = setTimeout(settle, 2500); // empty is a legitimate end state
    });
    return this._voicesPromise;
  }

  /**
   * Canonical pool: UI-language family first (fall back to everything),
   * local voices before remote (remote Chrome voices need network and
   * Playhouse is a self-contained file), sorted by name then voiceURI so the
   * ordering — and therefore the assignment — is deterministic per session.
   */
  #rebuildPool() {
    const lang = ((typeof navigator !== 'undefined' && navigator.language) || 'en')
      .slice(0, 2).toLowerCase();
    let pool = this._voices.filter((v) => (v.lang || '').slice(0, 2).toLowerCase() === lang);
    if (!pool.length) pool = this._voices.slice();
    const local = pool.filter((v) => v.localService === true);
    const remote = pool.filter((v) => v.localService !== true);
    const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1
      : a.voiceURI < b.voiceURI ? -1 : a.voiceURI > b.voiceURI ? 1 : 0);
    local.sort(byName);
    remote.sort(byName);
    this._pool = local.concat(remote);
  }

  /**
   * (Re)assign voices for a cast. Call after every stageScript().
   * Computes a provisional plan immediately (so voiceFor works right away),
   * then awaits the voice list and recomputes with real voices.
   * @param {Array<{name:string}|string>} characters script.characters
   * @param {Map<string,object>} specs production.specs
   * @returns {Promise<Map>} the final plan
   */
  async assignVoices(characters, specs) {
    this._characters = (characters || []).map((c) => (typeof c === 'string' ? { name: c } : c));
    this._specs = specs || new Map();
    this.#computePlan();
    if (!this._supported) return this._plan;
    await this.resolveVoices();
    return this.#computePlan();
  }

  #computePlan() {
    const names = (this._characters || []).map((c) => c.name);
    this._plan = voicePlanFor(names, this._specs, this._pool);
    for (const [name, uri] of this._overrides) this.#applyOverride(name, uri);
    return this._plan;
  }

  /** Assigned voice for a character, or null (system default / unknown). */
  voiceFor(name) { return this._plan.get(name)?.voice ?? null; }

  /** Read-only snapshot of a character's assignment, for the UI. */
  planFor(name) {
    const e = this._plan.get(name);
    if (!e) return null;
    return { voice: e.voice, voiceURI: e.voice?.voiceURI ?? null, pitch: e.pitch, rate: e.rate };
  }

  /**
   * Pin a character to a specific voice (persisted here across assignVoices).
   * Pass a falsy voiceURI to clear and return to the hashed assignment.
   */
  setVoiceOverride(name, voiceURI) {
    if (voiceURI) this._overrides.set(name, voiceURI);
    else this._overrides.delete(name);
    if (this._characters) this.#computePlan();
    else if (voiceURI) this.#applyOverride(name, voiceURI);
  }

  #applyOverride(name, uri) {
    const v = this._voices.find((x) => x.voiceURI === uri) || null;
    if (!v) return; // unknown URI (voice list changed since it was saved) — keep the hashed pick
    const entry = this._plan.get(name);
    if (entry) entry.voice = v;
    else this._plan.set(name, { voice: v, pitch: basePitchFor(this._specs?.get?.(name), name), rate: 1, offset: 0 });
  }

  // -------------------------------------------------------------------------
  // Speaking
  // -------------------------------------------------------------------------

  /**
   * Speak one beat. Call once per BEAT (production.onBeatChange fires exactly
   * once per beat object), never per shot — dialogue beats subdivide into up
   * to 3 shots that share one beat.
   *
   * Never speaks: transition/cue beats; lyric beats (or dialogue with
   * beat.singing) unless opts.singLyrics / this.speakLyrics; action beats
   * unless opts.speakAction / this.speakAction; anything while !unlocked,
   * !enabled or suppressed.
   *
   * @param {object} beat parsed beat ({type, text, character, emotion, intensity, ...})
   * @param {object|string|null} character appearance spec from production.specs
   *   (preferred), or a bare character name
   * @param {object|number} [opts] {slotSeconds, singLyrics, speakAction, volume},
   *   or a bare number meaning slotSeconds. slotSeconds should mirror the
   *   director: Math.max(0.8, (beat.duration || 1.5) / (production.pace ?? 1)).
   * @returns {Promise<boolean>} resolves when the line ends, is cancelled, or
   *   the watchdog fires — true only on a natural end. NEVER left pending:
   *   a missing onend is reaped by the dt-driven watchdog in update() and by a
   *   wall-clock backstop timer, so awaiting this cannot deadlock the caller.
   */
  speakBeat(beat, character, opts = {}) {
    if (typeof opts === 'number') opts = { slotSeconds: opts };
    if (!this._supported || !this.enabled || !this._unlocked || this.suppressed) {
      return Promise.resolve(false);
    }
    if (!beat || !beat.text || !String(beat.text).trim()) return Promise.resolve(false);

    const type = beat.type;
    if (type !== 'dialogue' && type !== 'lyric' && type !== 'action') return Promise.resolve(false);
    const singing = type === 'lyric' || beat.singing === true;
    if (singing && !(opts.singLyrics ?? this.speakLyrics)) return Promise.resolve(false);
    if (type === 'action' && !(opts.speakAction ?? this.speakAction)) return Promise.resolve(false);

    // Same beat re-fired while still live (e.g. a defensive caller): keep the
    // running utterance rather than restarting the line.
    if (this._speaking && this._beat === beat) return this._promise;

    this.cancel(); // one voice at a time; resolves any previous promise false

    const spec = character && typeof character === 'object'
      ? character
      : (this._specs?.get?.(character) ?? null);
    const name = spec?.name
      ?? (typeof character === 'string' ? character : beat.character)
      ?? null;

    // Action beats get the narrator: the voice at the END of the sorted pool,
    // so it never collides with a cast member (cast hashes probe from their
    // own slots and the pool is rarely saturated).
    const assigned = (type === 'action' ? null : this._plan.get(name))
      ?? {
        voice: type === 'action' ? (this._pool[this._pool.length - 1] ?? null) : null,
        pitch: basePitchFor(spec, name ?? ''),
        rate: 1,
        offset: 0,
      };

    const prosody = prosodyFor(spec, beat);

    // Rate-fit into the slot. The parser sized the slot with words/2.7 + 0.45,
    // so rate ≈ 1 usually fits; clamp the correction narrowly because outside
    // ~±25% the voice stops sounding like a performance.
    const slot = Math.max(0.3, opts.slotSeconds ?? beat.duration ?? 1.5);
    const words = (String(beat.text).match(/\S+/g) || []).length;
    const natural = words / 2.8 + 0.4; // seconds at rate 1.0
    const fit = clamp(natural / slot, 0.85, 1.25);

    let u;
    try {
      u = new window.SpeechSynthesisUtterance(String(beat.text));
    } catch {
      return Promise.resolve(false);
    }
    if (assigned.voice) {
      u.voice = assigned.voice;
      if (assigned.voice.lang) u.lang = assigned.voice.lang;
    }
    // Reuse offset rides on top of the per-beat prosody; +0.05 for read-aloud
    // lyrics ("read aloud, not sung").
    u.pitch = clamp(prosody.pitch + (assigned.offset || 0) + (singing ? 0.05 : 0), PITCH_MIN, PITCH_MAX);
    u.rate = clamp(prosody.rate * fit, RATE_MIN, RATE_MAX);
    u.volume = clamp(opts.volume ?? this.volume, 0, 1);

    const token = ++this._token;
    this._utter = u;
    this._beat = beat;
    this._charName = name;
    this._speaking = true;
    this._holding = false;
    this._started = false;
    this._slotLeft = slot;
    // Bounded stall: how a stage manager runs an overrunning line.
    this._holdLeft = Math.min(2.5, slot * 0.6);
    this._watchdog = slot * 2.5 + 3;
    this._sawBoundary = false;
    this._synthetic = false;
    this._boundaryTimer = 0;
    this._phase = 0;
    this._intensity = beat.intensity ?? 0.5;
    this._envTarget = 0;
    this._decay = 6;

    const promise = new Promise((resolve) => { this._resolve = resolve; });
    this._promise = promise;

    u.onstart = () => { if (token === this._token) this._started = true; };
    u.onboundary = (e) => { if (token === this._token) this.#onBoundary(e, u.text); };
    u.onend = () => { if (token === this._token) this.#finish(true); };
    u.onerror = () => { if (token === this._token) this.#finish(false); };

    // Wall-clock backstop: the dt-driven watchdog in update() is primary, but
    // if the caller's frame loop stalls this still refuses to leave the
    // promise pending. iOS cancel() sometimes never fires onend — without a
    // watchdog one stuck utterance stalls the whole show forever. Reap via
    // cancel(): it also stops a zombie utterance that is genuinely still
    // sounding, not just one whose onend was lost.
    this._hardTimer = setTimeout(() => {
      if (token === this._token && this._speaking) this.cancel();
    }, (this._watchdog + 1) * 1000);

    try {
      this._synth.speak(u);
    } catch {
      this.#finish(false);
      return promise;
    }
    this.#startHeartbeat();
    return promise;
  }

  /**
   * Stop speaking now. Used for seek/pause/teardown — never synth.pause():
   * pause/resume is broken on iOS and resumes at odd offsets, so losing the
   * tail of one line is the cheaper failure. Resolves the pending promise
   * (false) itself rather than trusting cancel() to fire onend — iOS often
   * doesn't.
   */
  cancel() {
    if (!this._supported) return;
    this._token++; // orphan any late events from the cancelled utterance
    try { this._synth.cancel(); } catch { /* nothing queued */ }
    if (this._speaking || this._resolve) this.#finish(false);
  }

  #finish(ok) {
    if (this._hardTimer) { clearTimeout(this._hardTimer); this._hardTimer = 0; }
    this.#stopHeartbeat();
    this._speaking = false;
    this._holding = false;
    this._started = false;
    this._synthetic = false;
    this._utter = null;
    this._beat = null;
    this._charName = null;
    this._envTarget = 0; // the decay in update() closes the mouth in ~120ms
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(ok);
  }

  // Chrome desktop cuts utterances off at ~15s unless nudged. Guarded to
  // non-iOS: pause/resume on iOS can drop the utterance entirely.
  #startHeartbeat() {
    if (this._heartbeat) return;
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iP(hone|ad|od)/.test(ua)) return;
    this._heartbeat = setInterval(() => {
      try {
        if (this._synth.speaking && !this._synth.paused) this._synth.resume();
      } catch { /* engine gone */ }
    }, 8000);
  }

  #stopHeartbeat() {
    if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = 0; }
  }

  // -------------------------------------------------------------------------
  // Per-frame state: budgets, watchdog, mouth envelope
  // -------------------------------------------------------------------------

  /**
   * Tier 1 lip sync (Chrome desktop/Android): word boundaries drive the
   * envelope from cheap syllable counts.
   */
  #onBoundary(e, text) {
    this._sawBoundary = true;
    this._synthetic = false;
    const s = String(text);
    const idx = typeof e.charIndex === 'number' ? e.charIndex : 0;
    const len = typeof e.charLength === 'number' && e.charLength > 0
      ? e.charLength
      : ((s.slice(idx).match(/^\S+/) || [''])[0].length);
    const word = s.substr(idx, len);
    const syllables = (word.match(/[aeiouy]+/gi) || []).length || 1;
    this._envTarget = Math.min(1, 0.42 + syllables * 0.13);
    // Decay scaled to the word's estimated spoken length: long words hold the
    // jaw open longer before the next boundary re-energises it.
    const est = Math.max(0.12, (word.length || 3) * 0.05);
    this._decay = clamp(0.8 / est, 3, 10);
    // After punctuation (or a sentence boundary) close fast — reads as breath.
    const after = s.slice(idx + len).match(/^\s*[,.;:!?]/);
    if (after || e.name === 'sentence') this._decay = 12;
  }

  /**
   * Advance budgets and the mouth envelope. Call once per frame, always —
   * the envelope needs it to decay, and the watchdog lives here.
   * @param {number} dt seconds since last frame
   */
  update(dt) {
    if (!this._supported || !(dt > 0)) return;

    if (this._speaking) {
      // Tier 2 (iOS Safari — onboundary never fires on many versions):
      // 400ms after onstart with no boundary event, generate the envelope
      // synthetically with the same layered-primes trick as anim.js.
      if (this._started && !this._sawBoundary && !this._synthetic) {
        this._boundaryTimer += dt;
        if (this._boundaryTimer >= 0.4) this._synthetic = true;
      }

      // Elastic slot: the plan stays authoritative. Spend the slot first,
      // then a bounded hold; `holding` tells the integrator to freeze
      // production.time (pass externalTime = production.time) until release.
      if (this._slotLeft > 0) {
        this._slotLeft -= dt;
        this._holding = false;
      } else {
        this._holdLeft -= dt;
        this._holding = this._holdLeft > 0;
      }

      this._watchdog -= dt;
      // Mandatory: never deadlock. cancel() stops the engine too, in case the
      // utterance is a zombie that is still audibly speaking.
      if (this._watchdog <= 0) this.cancel();

      if (this._synthetic && this._speaking) {
        this._phase += dt;
        const p = this._phase;
        const syl = (Math.sin(p * 11.0) * 0.5 + 0.5) * (Math.sin(p * 6.3) * 0.5 + 0.5);
        this._envTarget = syl * (0.35 + this._intensity * 0.55);
        this._decay = 6;
      }
    }

    // Integrate even when idle so the mouth actually closes after a line.
    this._env += (this._envTarget - this._env) * Math.min(1, dt * 18);
    this._envTarget *= Math.max(0, 1 - dt * this._decay);
  }

  /**
   * 0..1 mouth openness — same contract as AudioTrack.level(), so the
   * integrator feeds it to Animator.setMouthOpen EVERY FRAME (mouthTarget
   * decays per frame; a once-per-boundary call would evaporate unread).
   */
  level() {
    return clamp(this._env, 0, 1);
  }
}

/**
 * Factory, so a headless test can construct a director through a bundled
 * global without the app being wired up.
 */
export function createSpeechDirector(opts) {
  return new SpeechDirector(opts);
}
