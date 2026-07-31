export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Integer, but honestly — Math.round on .5 skews positive and that is fine here. */
export const ri = (v: number): number => Math.round(v);

export function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "a rat" / "an ogre". Wrong for "a European", right for everything in this game. */
export function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

export function plural(n: number, one: string, many?: string): string {
  return n === 1 ? one : many ?? `${one}s`;
}

/** "a, b and c" — the list separator the System AI uses in its notifications. */
export function commaList(items: readonly string[], conj = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`;
}

export function hours(h: number): string {
  if (h < 1 / 60) return "no time at all";
  if (h < 1) return `${ri(h * 60)} minutes`;
  if (h < 2) return `${h.toFixed(1)} hours`;
  return `${ri(h)} hours`;
}

export function bar(value: number, max: number, width: number, full = "█", empty = "░"): string {
  const filled = max <= 0 ? 0 : clamp(Math.round((value / max) * width), 0, width);
  return full.repeat(filled) + empty.repeat(width - filled);
}

/** Deep structural clone that survives JSON round-tripping, which is the only
 *  kind of clone a save file cares about. */
export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function groupBy<T, K extends string>(items: readonly T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) {
    const k = key(it);
    (out[k] ??= []).push(it);
  }
  return out;
}
