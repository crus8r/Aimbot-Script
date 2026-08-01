/**
 * Deterministic randomness.
 *
 * Every number this game produces comes from here, and every one of them is
 * reproducible from a seed. That is not a purity exercise: it means a bug
 * report is a seed plus a list of commands, a balance run is repeatable, and
 * save-scumming is structurally pointless because the dice were already cast.
 *
 * Two flavours, and the distinction matters:
 *
 *   derived(key)  A pure function of (rootSeed, key). Floor 3's map is the
 *                 same floor whether you got there in four hours or forty,
 *                 because its stream does not depend on how many times you
 *                 swung a pipe on the way down.
 *
 *   live          One advancing stream, serialised into the save. Combat,
 *                 loot rolls, wandering monsters. This is the stream that
 *                 remembers.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * sfc32 — small, fast, and passes PractRand well past anything a game needs.
 *
 * The four state words are `w x y z` rather than the reference implementation's
 * `a b c d`, because this class also exposes `d(sides)` for a die roll and an
 * instance field named `d` shadows the prototype method. That cost an afternoon
 * once and it is not costing another one.
 */
export class Rng {
  private w: number;
  private x: number;
  private y: number;
  private z: number;

  constructor(state: RngState) {
    this.w = state.a | 0;
    this.x = state.b | 0;
    this.y = state.c | 0;
    this.z = state.d | 0;
  }

  static fromSeed(seed: number | string): Rng {
    const n = typeof seed === "string" ? hashString(seed) : seed | 0;
    // Scatter one seed word into four, then discard the first outputs so
    // low-entropy seeds (1, 2, 3...) do not produce visibly similar streams.
    const r = new Rng({
      a: (n ^ 0x9e3779b9) | 0,
      b: (n ^ 0x85ebca6b) | 0,
      c: (n ^ 0xc2b2ae35) | 0,
      d: (n ^ 0x27d4eb2f) | 0,
    });
    for (let i = 0; i < 20; i++) r.next();
    return r;
  }

  save(): RngState {
    return { a: this.w, b: this.x, c: this.y, d: this.z };
  }

  clone(): Rng {
    return new Rng(this.save());
  }

  /** Raw float in [0, 1). */
  next(): number {
    const t = (((this.w + this.x) | 0) + this.z) | 0;
    this.z = (this.z + 1) | 0;
    this.w = this.x ^ (this.x >>> 9);
    this.x = (this.y + (this.y << 3)) | 0;
    this.y = (this.y << 21) | (this.y >>> 11);
    this.y = (this.y + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi], inclusive both ends. */
  int(lo: number, hi: number): number {
    if (hi < lo) [lo, hi] = [hi, lo];
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** A single die. d(20) is 1..20. */
  d(sides: number): number {
    return this.int(1, sides);
  }

  /** "2d6+3", "1d4", "3d8-2". The only dice notation this game speaks. */
  roll(spec: string): number {
    const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(spec.trim());
    if (!m) throw new Error(`bad dice spec: ${spec}`);
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    const mod = m[3] ? parseInt(m[3], 10) : 0;
    let total = mod;
    for (let i = 0; i < count; i++) total += this.d(sides);
    return total;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    if (list.length === 0) throw new Error("pick from empty list");
    return list[Math.floor(this.next() * list.length)]!;
  }

  /** Pick `n` distinct entries. Returns fewer only if the list is shorter. */
  sample<T>(list: readonly T[], n: number): T[] {
    const pool = list.slice();
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]!);
    }
    return out;
  }

  shuffle<T>(list: readonly T[]): T[] {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Weighted pick. Entries with weight <= 0 are unreachable, not merely unlikely. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
    if (total <= 0) throw new Error("weighted pick with no positive weight");
    let x = this.next() * total;
    for (const [value, w] of entries) {
      x -= Math.max(0, w);
      if (x <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  /** Roughly-normal float around `mid`, clamped. Two rolls, not twelve. */
  spread(mid: number, radius: number): number {
    return mid + (this.next() + this.next() - 1) * radius;
  }
}

export function hashString(s: string): number {
  // FNV-1a. Deterministic across platforms, which Math.random-adjacent
  // approaches emphatically are not.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * A stream derived purely from the world seed and a key. Same key, same
 * numbers, forever, no matter what else the run has done.
 */
export function derived(rootSeed: number, key: string): Rng {
  return Rng.fromSeed((rootSeed ^ hashString(key)) | 0);
}
