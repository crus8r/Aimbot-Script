/**
 * Score: a procedural underscore that follows the script.
 *
 * WHY THIS IS SYNTHESISED AND NOT LICENSED
 *     Every honest alternative to generating the music is worse. Shipping
 *     library cues means shipping someone's copyright inside a bundle that
 *     gets published to a URL. Calling a music-generation API means a key, a
 *     bill, and a network round trip in the middle of playback. Generating it
 *     in the browser costs nothing, works offline, and — the part that
 *     actually matters here — can be re-cued on a frame boundary, because the
 *     music is being *performed* rather than played back.
 *
 * WHAT IT IS AND IS NOT
 *     This is underscore: sustained harmony, a slow motif, and a pulse that
 *     comes up under tension. It is the bed you do not notice under dialogue.
 *     It is emphatically NOT a song, a theme, or anything with a tune you
 *     could hum, and it will not score a musical number — a musical's music
 *     is the *script*, and it arrives as an upload (see audio.js).
 *
 *     The bar it has to clear is low but real: better than silence, never
 *     distracting, and never wrong about the scene. Wrong is the only true
 *     failure mode — cheerful music under a threat is worse than no music —
 *     which is why cue selection is keyword-driven and conservative, and why
 *     an unrecognised scene gets the neutral cue rather than a guess.
 *
 * HOW IT FOLLOWS THE FILM
 *     Three inputs, in decreasing order of trust:
 *       1. an explicit `music` field on a shot or scene, which always wins;
 *       2. the environment's mood (NIGHT and STORM are not cheerful);
 *       3. keyword evidence from the beat text of the shots in view.
 *     Cues cross-fade over a couple of seconds rather than cutting, except on
 *     an explicit cut, because an audible music edit draws the ear to itself.
 *
 * DIALOGUE ALWAYS WINS
 *     `duck()` drops the bus by 10 dB whenever a line is being spoken. This is
 *     not a nicety: TTS through a phone speaker loses to a pad at equal level,
 *     and the whole point of the pad is to be under something.
 */

// Semitone offsets from the tonic. Everything is built from these two, which
// is a deliberate limit — modes are how you make procedural harmony sound
// intentional, and two well-used ones beat seven badly used.
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/**
 * The cue library.
 *
 * `chords` are scale degrees (0-indexed), not absolute notes, so a cue can be
 * transposed to any key without rewriting it. `pulse` is how much of the
 * rhythmic layer is audible: 0 is pure pad, 1 is a driving ostinato. `bright`
 * opens the filter — the single most effective knob for "is this hopeful".
 */
const CUES = {
  neutral: { mode: MINOR, chords: [0, 5, 3, 4], bpm: 62, pulse: 0.0, bright: 0.42, gain: 0.55, root: 48 },
  warm:    { mode: MAJOR, chords: [0, 4, 5, 3], bpm: 68, pulse: 0.10, bright: 0.72, gain: 0.60, root: 50 },
  wonder:  { mode: MAJOR, chords: [0, 3, 4, 3], bpm: 54, pulse: 0.0, bright: 0.85, gain: 0.55, root: 55 },
  calm:    { mode: MAJOR, chords: [0, 3, 0, 4], bpm: 50, pulse: 0.0, bright: 0.58, gain: 0.45, root: 48 },
  grief:   { mode: MINOR, chords: [0, 3, 5, 0], bpm: 46, pulse: 0.0, bright: 0.30, gain: 0.52, root: 43 },
  tense:   { mode: MINOR, chords: [0, 1, 0, 6], bpm: 76, pulse: 0.45, bright: 0.34, gain: 0.58, root: 41 },
  danger:  { mode: MINOR, chords: [0, 6, 0, 1], bpm: 88, pulse: 0.72, bright: 0.28, gain: 0.66, root: 38 },
  action:  { mode: MINOR, chords: [0, 6, 4, 5], bpm: 132, pulse: 1.0, bright: 0.46, gain: 0.72, root: 38 },
};

/**
 * Keyword evidence, in two strengths. Deliberately blunt and deliberately
 * auditable: when a scene gets the wrong cue this table is where you look,
 * and a reader can predict what a script will score before running it. A
 * learned classifier would be more accurate on average and impossible to
 * debug on the one scene the user cares about.
 *
 * The two tiers are the whole reason this works. Flat weights let a scene
 * full of mild words outvote one decisive one: "he stops" scored the forest
 * standoff as merely *tense* while "drones" — the actual threat, and the
 * reason the scene exists — counted exactly as much as "slowly". A rifle in
 * frame is strong evidence. Somebody standing still is not.
 */
const STRONG = 1.5;
const WEAK = 0.7;

const EVIDENCE = {
  danger: {
    strong: ['gun', 'rifle', 'weapon', 'blood', 'kill', 'dead', 'death',
             'drone', 'soldier', 'threat', 'shoot', 'shot', 'hostage',
             'surrender', 'siren', 'alarm', 'scream'],
    weak: ['guard', 'aim', 'hunt', 'trapped', 'blade', 'knife'],
  },
  action: {
    strong: ['chase', 'sprint', 'crash', 'explode', 'explosion', 'pursuit',
             'burst', 'smash', 'flee', 'escape', 'collide'],
    weak: ['run', 'leap', 'jump', 'slam', 'speeding', 'race', 'dive'],
  },
  tense: {
    strong: ['creep', 'whisper', 'freeze', 'nervous', 'afraid', 'fear',
             'silence', 'dread'],
    weak: ['wait', 'silent', 'shadow', 'watch', 'listen', 'slowly', 'stare',
           'stop', 'halt', 'hesitate'],
  },
  grief: {
    strong: ['cry', 'weep', 'tear', 'grave', 'funeral', 'mourn', 'goodbye',
             'sob'],
    weak: ['alone', 'lost', 'gone', 'sorry', 'miss', 'empty', 'never'],
  },
  warm: {
    strong: ['laugh', 'kiss', 'hug', 'embrace', 'welcome', 'happy', 'grin'],
    weak: ['smile', 'home', 'friend', 'together', 'lemonade', 'sunny', 'warm'],
  },
  wonder: {
    strong: ['magic', 'spell', 'shimmer', 'wonder', 'impossible', 'vision'],
    // `glow` and `light` are weak on purpose: a light glowing on a gun barrel
    // is not a moment of wonder, and this table has to survive that sentence.
    weak: ['glow', 'light', 'star', 'sky', 'dream', 'float', 'vast',
           'discover', 'reveal'],
  },
  calm: {
    strong: ['gentle', 'breathe', 'peaceful', 'drowsy'],
    weak: ['morning', 'quiet', 'rest', 'sleep', 'still', 'garden', 'sit',
           'read', 'walk', 'tide', 'shore'],
  },
};

/**
 * Crudest possible stemmer: drop a trailing plural or third-person `s`.
 *
 * Not linguistics — bookkeeping. Scripts are written in the present tense
 * ("she runs", "the drones drop"), so a table listing bare verbs matches
 * almost nothing without this. The alternative, listing every inflection by
 * hand, is what the first version did, and it silently missed `drones`,
 * `sprints` and `crashes` — three of the most load-bearing words in the two
 * scenes this was built for.
 */
function stem(word) {
  if (word.length <= 3 || !word.endsWith('s') || word.endsWith('ss')) return word;
  const cut = word.slice(0, -1);
  // The `-es` ending is only a *separate* ending after a sibilant: crashes,
  // watches, boxes, glasses. Everywhere else the `e` belongs to the word.
  // Stripping `es` unconditionally turned `drones` into `dron`, which matched
  // nothing — and `drones` is the single most load-bearing word in the scene
  // this feature was written for, so it scored the standoff as neutral.
  if (cut.endsWith('e') && /(s|x|z|ch|sh)$/.test(cut.slice(0, -1))) {
    return cut.slice(0, -1);
  }
  return cut;
}

// Built once: stem -> {cue: weight}. Later cues do not clobber earlier ones
// for a shared word; both get the evidence, and the sum decides.
const LEXICON = (() => {
  const table = new Map();
  for (const [cue, tiers] of Object.entries(EVIDENCE)) {
    for (const [tier, weight] of [['strong', STRONG], ['weak', WEAK]]) {
      for (const word of tiers[tier]) {
        const key = stem(word);
        if (!table.has(key)) table.set(key, {});
        table.get(key)[cue] = Math.max(table.get(key)[cue] || 0, weight);
      }
    }
  }
  return table;
})();

// A scene's declared mood is weaker evidence than its words — a script can be
// funny at night — but it is never nothing.
const MOOD_BIAS = {
  NIGHT: { tense: 1.4, grief: 0.8, calm: 0.6 },
  STORM: { danger: 1.6, tense: 1.4 },
  DUSK: { tense: 0.7, grief: 0.5 },
  DAWN: { wonder: 1.0, calm: 0.9 },
  DAY: { warm: 0.8, calm: 0.6 },
};

const WORD = /[a-z']+/g;

/**
 * Choose a cue name from text and an optional mood.
 *
 * Scores every cue by keyword hits, adds the mood bias, and requires the
 * winner to clear a floor before it displaces `neutral`. That floor is the
 * whole design: one stray "light" in a threatening scene should not turn the
 * music hopeful, and on thin evidence the honest answer is the cue that
 * cannot be wrong.
 *
 * @param {string} text  beat text, stage directions included
 * @param {string} [mood]  environment mood, e.g. 'NIGHT'
 * @returns {{cue: string, scores: Object<string, number>}}
 */
export function cueFor(text, mood) {
  const scores = Object.create(null);
  for (const name of Object.keys(EVIDENCE)) scores[name] = 0;

  const words = (String(text || '').toLowerCase().match(WORD) || []).map(stem);
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);

  for (const [word, hits] of counts) {
    const entry = LEXICON.get(word);
    if (!entry) continue;
    // Repetition counts, but with diminishing returns: a scene that says
    // "run" nine times is not nine times more of a chase than one that says
    // it twice, and undamped, one repeated word swamps the whole table.
    const weightOfRepeats = 1 + Math.sqrt(hits - 1) * 0.5;
    for (const [name, weight] of Object.entries(entry)) {
      scores[name] += weight * weightOfRepeats;
    }
  }
  for (const [name, weight] of Object.entries(MOOD_BIAS[mood] || {})) {
    scores[name] = (scores[name] || 0) + weight;
  }

  let best = 'neutral';
  let bestScore = 0;
  for (const [name, score] of Object.entries(scores)) {
    if (score > bestScore) { best = name; bestScore = score; }
  }
  // Action and danger overlap heavily and the distinction matters: a chase is
  // action, a standoff is danger. When both fire, the one with more evidence
  // wins outright rather than averaging into something that is neither.
  return { cue: bestScore >= 1.5 ? best : 'neutral', scores };
}

const midiToHz = (note) => 440 * Math.pow(2, (note - 69) / 12);

/**
 * A generated impulse response: exponentially decaying noise.
 *
 * A dry synth pad sounds like a synth pad. The same pad with two seconds of
 * tail sounds like a room, and a room is what makes an underscore sit behind
 * a picture instead of on top of it. Generating the impulse costs about a
 * millisecond and avoids shipping a WAV.
 */
function makeReverb(ctx, seconds = 2.4, decay = 2.6) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      // Deterministic rather than Math.random(): two runs of the same film
      // should sound identical, and a hash is as good as noise here.
      const h = Math.sin((i + channel * 7919) * 12.9898) * 43758.5453;
      data[i] = ((h - Math.floor(h)) * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

/**
 * The underscore engine.
 *
 * Scheduling is the usual Web Audio two-clock arrangement: a coarse timer
 * wakes up a few times a second and schedules every note that falls inside a
 * short lookahead window, at sample-accurate times. Scheduling notes straight
 * from a timer callback is what makes browser music audibly stumble, because
 * a timer that fires 15 ms late plays the note 15 ms late.
 */
export class Score {
  /**
   * @param {AudioContext} [ctx] an existing context to share with speech
   */
  constructor(ctx = null) {
    this.ctx = ctx;
    this.enabled = true;
    this.cue = 'neutral';
    this.next = 'neutral';
    this.intensity = 0.5;
    this.playing = false;
    this.beat = 0;
    this.nextNoteAt = 0;
    this.timer = null;
    this.ducked = false;
    this.nodes = null;
    this.lookahead = 0.35;
  }

  /** Available cue names, for a UI that wants to offer an override. */
  static cues() { return Object.keys(CUES); }

  /**
   * Build the audio graph. Separate from the constructor because a context
   * cannot be created — or resumed — outside a user gesture on iOS, so the
   * caller decides when.
   */
  init(ctx) {
    if (this.nodes) return true;
    const Ctx = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext) : null;
    this.ctx = ctx || this.ctx || (Ctx ? new Ctx() : null);
    if (!this.ctx) return false;

    const c = this.ctx;
    const master = c.createGain();
    master.gain.value = 0.0;

    // A gentle limiter, not a sound-design choice: a pad plus a pulse plus a
    // reverb tail can transiently sum past 0 dBFS, and clipping on a phone
    // speaker is the ugliest sound this program can make.
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.6;

    const dry = c.createGain();
    dry.gain.value = 0.72;
    const wet = c.createGain();
    wet.gain.value = 0.38;
    const verb = c.createConvolver();
    verb.buffer = makeReverb(c);

    filter.connect(dry).connect(comp);
    filter.connect(verb).connect(wet).connect(comp);
    comp.connect(master).connect(c.destination);

    this.nodes = { master, comp, filter, verb, dry, wet };
    return true;
  }

  /** Start performing. Safe to call repeatedly. */
  start() {
    if (!this.init()) return false;
    if (this.playing) return true;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.playing = true;
    this.beat = 0;
    this.nextNoteAt = this.ctx.currentTime + 0.08;
    // #targetGain, not a level of its own: a caller that set the intensity or
    // ducked before pressing play must not have that silently discarded.
    this.#fadeTo(this.#targetGain(), 1.4);
    const tick = () => {
      if (!this.playing) return;
      try { this.pump(this.ctx.currentTime + this.lookahead); } catch { /* never let audio kill playback */ }
      this.timer = setTimeout(tick, 120);
    };
    tick();
    return true;
  }

  /** Stop, with a short fade so it does not click. */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.#fadeTo(0, 0.6);
  }

  /**
   * Change cue.
   *
   * @param {string} cue  a name from CUES
   * @param {object} [opts]
   * @param {boolean} [opts.immediate]  cut rather than cross-fade, for a hard
   *   scene change where a smooth transition would be the wrong edit
   */
  setCue(cue, opts = {}) {
    if (!CUES[cue] || cue === this.cue) return;
    this.cue = cue;
    if (!this.nodes) return;
    // Only the *level* moves here. Harmony changes at the next bar line, in
    // #schedule, because re-harmonising mid-chord is the single most obvious
    // way to make generated music sound generated.
    this.#fadeTo(this.#targetGain(), opts.immediate ? 0.05 : 2.0);
  }

  /** 0..1. Scales level and how much of the pulse layer is audible. */
  setIntensity(value) {
    this.intensity = Math.max(0, Math.min(1, Number(value) || 0));
    if (this.nodes) this.#fadeTo(this.#targetGain(), 1.2);
  }

  /** Duck under dialogue. Fast down, slow up, the way a real ducker behaves. */
  duck(on) {
    if (this.ducked === !!on) return;
    this.ducked = !!on;
    if (this.nodes) this.#fadeTo(this.#targetGain(), on ? 0.18 : 0.9);
  }

  /** Mute without tearing down the graph. */
  setEnabled(on) {
    this.enabled = !!on;
    if (this.nodes) this.#fadeTo(this.#targetGain(), 0.4);
  }

  #targetGain() {
    if (!this.enabled) return 0;
    const cue = CUES[this.cue];
    const level = cue.gain * (0.34 + this.intensity * 0.66) * 0.5;
    return this.ducked ? level * 0.30 : level;
  }

  #fadeTo(value, seconds) {
    const gain = this.nodes.master.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(1e-4, gain.value), now);
    // Exponential, because loudness is perceived exponentially and a linear
    // fade audibly hangs at the end.
    gain.exponentialRampToValueAtTime(Math.max(1e-4, value), now + seconds);
  }

  /**
   * Schedule every note starting before `until`, an absolute context time.
   *
   * Public, and taking an absolute deadline rather than reading the clock
   * itself, because those two properties are what make the performance
   * renderable offline: an OfflineAudioContext has no wall clock and never
   * runs a `setTimeout`, so its whole score has to be laid down in one call
   * before rendering starts. That is not only a test affordance — it is how
   * you bounce a cue to a file to hand an editor.
   */
  pump(until) {
    const cue = CUES[this.cue];
    const spb = 60 / cue.bpm;
    while (this.nextNoteAt < until) {
      const at = this.nextNoteAt;
      const bar = Math.floor(this.beat / 4);
      const inBar = this.beat % 4;
      const degree = cue.chords[bar % cue.chords.length];

      if (inBar === 0) this.#chord(cue, degree, at, spb * 4);
      const pulse = cue.pulse * (0.35 + this.intensity * 0.65);
      if (pulse > 0.05) this.#pulse(cue, degree, at, spb, pulse, inBar);
      // The motif: one note a bar, off the downbeat so it reads as a phrase
      // rather than as part of the chord.
      if (inBar === 2 && this.intensity > 0.25) this.#motif(cue, degree, at, spb);

      this.beat += 1;
      this.nextNoteAt += spb;
    }

    // Filter tracks brightness and intensity together, which is most of what
    // makes the same four chords feel different in two different scenes.
    const target = 380 + cue.bright * 2600 * (0.55 + this.intensity * 0.45);
    const f = this.nodes.filter.frequency;
    f.cancelScheduledValues(this.ctx.currentTime);
    f.setTargetAtTime(target, this.ctx.currentTime, 0.9);
  }

  /** One sustained voice: two detuned oscillators through their own envelope. */
  #voice(note, at, duration, level, type = 'triangle', detune = 6) {
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    const attack = Math.min(0.45, duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.connect(this.nodes.filter);

    for (const cents of [-detune, detune]) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToHz(note);
      osc.detune.value = cents;
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + duration + 0.05);
      // Nodes disconnect themselves; leaving them attached leaks a voice per
      // bar, which over a five-minute film is thousands of live nodes.
      osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch { /* gone */ } };
    }
  }

  #note(cue, degree, offset, octave = 0) {
    const scale = cue.mode;
    const index = degree + offset;
    const wrap = Math.floor(index / scale.length);
    return cue.root + scale[((index % scale.length) + scale.length) % scale.length]
      + 12 * (wrap + octave);
  }

  /** A triad plus the octave, voiced wide and low. */
  #chord(cue, degree, at, duration) {
    const level = 0.16;
    this.#voice(this.#note(cue, degree, 0, -1), at, duration, level * 1.2);
    this.#voice(this.#note(cue, degree, 2, 0), at + 0.02, duration, level * 0.8);
    this.#voice(this.#note(cue, degree, 4, 0), at + 0.04, duration, level * 0.7);
    this.#voice(this.#note(cue, degree, 0, 1), at + 0.06, duration * 0.8, level * 0.35);
  }

  /** The rhythmic layer: short plucks on the root, accented on the bar. */
  #pulse(cue, degree, at, spb, amount, inBar) {
    const accent = inBar === 0 ? 1.0 : 0.55;
    this.#voice(this.#note(cue, degree, 0, -1), at, spb * 0.45,
                0.14 * amount * accent, 'sawtooth', 3);
    if (amount > 0.6) {
      this.#voice(this.#note(cue, degree, 4, -1), at + spb * 0.5, spb * 0.3,
                  0.08 * amount, 'sawtooth', 3);
    }
  }

  /** A single sustained upper note, the closest this gets to a tune. */
  #motif(cue, degree, at, spb) {
    const step = [4, 2, 6, 0][Math.floor(this.beat / 4) % 4];
    this.#voice(this.#note(cue, degree, step, 1), at, spb * 2.2,
                0.075 * this.intensity, 'sine', 4);
  }
}

/**
 * Read a whole production and decide what it should sound like, shot by shot.
 *
 * Returns one entry per shot so playback is a lookup rather than a decision:
 * analysis happens once, when the script loads, and a cue change at a cut is
 * then free. It also means the cue sheet can be shown, argued with and
 * overridden before a frame is rendered — which for a tool whose whole
 * premise is directability matters more than the choices themselves.
 *
 * @param {object} scene  a normalised scene file
 * @returns {Array<{id: string, start: number, cue: string, intensity: number}>}
 */
export function cueSheet(scene) {
  const mood = scene?.environment?.mood;
  const shots = scene?.shots || [];
  // Shot sizes carry intent that words do not: a run of close-ups is a scene
  // tightening, and the underscore should tighten with it.
  const TIGHT = { ECU: 1.0, CU: 0.85, MCU: 0.7, MS: 0.5, MWS: 0.4, WS: 0.3, EWS: 0.25 };

  return shots.map((shot, index) => {
    const text = [
      shot.caption,
      shot.music,
      ...(shot.actions || []).map((a) => `${a.do || ''} ${a.pose || ''} ${a.prop || ''}`),
    ].filter(Boolean).join(' ');
    // Neighbouring shots are context: one silent insert in the middle of a
    // chase is still the chase, and scoring it on its own text alone would
    // drop the music out for two seconds.
    const near = shots.slice(Math.max(0, index - 1), index + 2)
      .map((s) => s.caption || '').join(' ');

    const explicit = shot.music || scene?.music;
    const chosen = CUES[explicit] ? explicit : cueFor(`${text} ${near}`, mood).cue;
    const size = TIGHT[shot.camera?.size] ?? 0.5;
    const fast = /run|chase|burst|crash/i.test(text) ? 0.25 : 0;
    return {
      id: shot.id,
      start: shot.start || 0,
      cue: chosen,
      intensity: Math.min(1, size * 0.7 + fast + (CUES[chosen].pulse * 0.3)),
    };
  });
}
