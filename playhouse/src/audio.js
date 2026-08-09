/**
 * Audio: upload a recording, become the master clock, and give the staging
 * layer something to synchronise against.
 *
 * What this does honestly do: decode, waveform, onset/beat detection, tempo
 * estimate, live amplitude for lip sync, and lyric timestamps you can place
 * automatically then correct by tapping.
 *
 * What it does NOT do: forced alignment. Locking each *word* of a sung lyric
 * to the millisecond needs an acoustic model, which is a server-side job — so
 * the honest client-side answer is even distribution plus tap-to-correct,
 * which converges on a good result fast and never pretends to be automatic.
 */

export class AudioTrack {
  constructor() {
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.analyser = null;
    this.gain = null;
    this.startedAt = 0;
    this.offset = 0;
    this.playing = false;
    this.name = '';
    this.peaks = [];
    this.onsets = [];
    this.bpm = null;
    this._levelData = null;
  }

  get duration() { return this.buffer?.duration ?? 0; }
  get loaded() { return !!this.buffer; }

  #ensureContext() {
    if (!this.context) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.context = new Ctx();
      this.gain = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.55;
      this.gain.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this._levelData = new Uint8Array(this.analyser.fftSize);
    }
    return this.context;
  }

  /** iOS requires a user gesture before audio will start. */
  async resume() {
    this.#ensureContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  /**
   * Decode a File/Blob and analyse it.
   * @returns {Promise<{duration:number, bpm:number|null, onsets:number[]}>}
   */
  async load(file) {
    const ctx = this.#ensureContext();
    const bytes = await file.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(bytes);
    this.name = file.name || 'audio';
    this.peaks = computePeaks(this.buffer, 900);
    const analysis = detectOnsets(this.buffer);
    this.onsets = analysis.onsets;
    this.bpm = analysis.bpm;
    this.offset = 0;
    return { duration: this.duration, bpm: this.bpm, onsets: this.onsets };
  }

  play(at = null) {
    if (!this.buffer) return;
    this.#ensureContext();
    this.stop(true);
    const src = this.context.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const start = at !== null ? at : this.offset;
    src.start(0, Math.max(0, Math.min(start, this.duration - 0.01)));
    this.source = src;
    this.startedAt = this.context.currentTime - start;
    this.offset = start;
    this.playing = true;
    src.onended = () => {
      if (this.source === src) this.playing = false;
    };
  }

  stop(silent = false) {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
    if (!silent) {
      this.offset = this.currentTime;
      this.playing = false;
    }
  }

  pause() {
    if (!this.playing) return;
    const t = this.currentTime;
    this.stop(true);
    this.offset = t;
    this.playing = false;
  }

  seek(time) {
    const wasPlaying = this.playing;
    this.stop(true);
    this.offset = Math.max(0, Math.min(time, this.duration));
    this.playing = false;
    if (wasPlaying) this.play(this.offset);
  }

  get currentTime() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.context.currentTime - this.startedAt);
  }

  setVolume(v) {
    this.#ensureContext();
    this.gain.gain.value = v;
  }

  /** 0..1 amplitude, suitable for driving a jaw. */
  level() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteTimeDomainData(this._levelData);
    let sum = 0;
    for (let i = 0; i < this._levelData.length; i++) {
      const v = (this._levelData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this._levelData.length);
    // Speech/singing sits low in the range; expand so the mouth actually moves.
    return Math.min(1, Math.pow(rms * 3.4, 0.75));
  }
}

// ---------------------------------------------------------------------------
// Offline analysis
// ---------------------------------------------------------------------------

/** Min/max envelope for waveform drawing. */
export function computePeaks(buffer, count) {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / count) || 1;
  const peaks = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(data.length, start + block);
    for (let j = start; j < end; j += 4) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

/**
 * Broadband energy-flux onset detection with an adaptive threshold, then a
 * histogram over inter-onset intervals for tempo.
 *
 * This is a deliberately simple detector. It locks reliably onto percussive
 * material and gets vaguer on legato singing — which is exactly the honest
 * shape of the problem, and why tap-correction exists.
 */
export function detectOnsets(buffer) {
  const sampleRate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  const hop = 512;
  const window = 1024;
  const frames = Math.floor((channel.length - window) / hop);
  if (frames < 4) return { onsets: [], bpm: null };

  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    let sum = 0;
    for (let i = 0; i < window; i += 2) {
      let s = channel[start + i];
      if (second) s = (s + second[start + i]) * 0.5;
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / (window / 2));
  }

  // Positive flux.
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    flux[f] = Math.max(0, energy[f] - energy[f - 1]);
  }

  // Adaptive threshold over a ~0.35s window.
  const half = Math.max(2, Math.round(0.35 * sampleRate / hop / 2));
  const onsets = [];
  const minGap = 0.11; // seconds — nothing musical is faster than ~9 Hz
  let lastTime = -1;

  for (let f = 1; f < frames - 1; f++) {
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, f - half); i < Math.min(frames, f + half); i++) {
      sum += flux[i];
      n++;
    }
    const mean = sum / Math.max(1, n);
    const threshold = mean * 1.65 + 1e-5;
    if (flux[f] > threshold && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1]) {
      const time = (f * hop) / sampleRate;
      if (time - lastTime >= minGap) {
        onsets.push(+time.toFixed(3));
        lastTime = time;
      }
    }
  }

  return { onsets, bpm: estimateTempo(onsets) };
}

/** Dominant inter-onset interval, folded into a musical range. */
export function estimateTempo(onsets) {
  if (onsets.length < 8) return null;
  const buckets = new Map();
  for (let i = 1; i < onsets.length; i++) {
    for (let lag = 1; lag <= 3 && i - lag >= 0; lag++) {
      let iv = onsets[i] - onsets[i - lag];
      if (iv <= 0.2 || iv > 2.2) continue;
      // Fold into 60–180 BPM.
      while (60 / iv > 180) iv *= 2;
      while (60 / iv < 60) iv /= 2;
      const key = Math.round(iv * 100) / 100;
      buckets.set(key, (buckets.get(key) || 0) + 1 / lag);
    }
  }
  if (!buckets.size) return null;
  let best = null;
  let bestScore = 0;
  for (const [iv, score] of buckets) {
    if (score > bestScore) { bestScore = score; best = iv; }
  }
  return best ? Math.round(60 / best) : null;
}

// ---------------------------------------------------------------------------
// Lyric timing
// ---------------------------------------------------------------------------

/**
 * Give every lyric line a start time.
 *
 * Strategy: if onsets were detected, snap evenly-distributed line starts to
 * the nearest strong onset — lines then land on the music rather than near it.
 * Otherwise distribute evenly. Either way the result is a starting point the
 * user corrects by tapping.
 *
 * @param {object[]} lyricBeats beats of type 'lyric', in order
 * @param {number} start seconds
 * @param {number} end seconds
 * @param {number[]} [onsets]
 * @returns {Array<{id:string, time:number}>}
 */
export function distributeLyrics(lyricBeats, start, end, onsets = []) {
  const n = lyricBeats.length;
  if (!n) return [];
  const span = Math.max(0.5, end - start);

  // Weight by syllable-ish length so long lines get more room.
  const weights = lyricBeats.map((b) => Math.max(1, (b.text || '').split(/\s+/).length));
  const total = weights.reduce((a, b) => a + b, 0);

  const times = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    times.push(start + (acc / total) * span);
    acc += weights[i];
  }

  if (onsets.length > 3) {
    const strong = onsets.filter((t) => t >= start - 0.2 && t <= end + 0.2);
    if (strong.length >= n) {
      for (let i = 0; i < n; i++) {
        let bestT = times[i];
        let bestD = Infinity;
        for (const o of strong) {
          const dd = Math.abs(o - times[i]);
          if (dd < bestD) { bestD = dd; bestT = o; }
        }
        // Only snap if the onset is genuinely nearby.
        if (bestD < span / n * 0.45) times[i] = bestT;
      }
    }
  }

  // Enforce monotonic ordering after snapping.
  for (let i = 1; i < n; i++) {
    if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 0.25;
  }

  return lyricBeats.map((b, i) => ({ id: b.id, time: +times[i].toFixed(3) }));
}

/** Convert a timestamp map into per-beat durations the director can consume. */
export function applyLyricTimings(script, timings, songEnd) {
  const byId = new Map(timings.map((t) => [t.id, t.time]));
  let applied = 0;
  for (const scene of script.scenes) {
    for (let i = 0; i < scene.beats.length; i++) {
      const beat = scene.beats[i];
      if (!byId.has(beat.id)) continue;
      const start = byId.get(beat.id);
      // Find the next timed beat to derive a duration.
      let next = songEnd;
      for (let j = i + 1; j < scene.beats.length; j++) {
        if (byId.has(scene.beats[j].id)) { next = byId.get(scene.beats[j].id); break; }
      }
      beat.duration = Math.max(0.6, next - start);
      beat.absoluteTime = start;
      applied++;
    }
  }
  return applied;
}
