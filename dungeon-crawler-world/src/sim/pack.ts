import type { GameState, Item, Rarity, Slot } from "../core/types.ts";
import { RARITIES, SLOTS, SLOT_LABEL } from "../core/types.ts";
import { carriedWeight, carryCapacity } from "./character.ts";

/**
 * Making a two-hundred-item bag usable.
 *
 * There is no slot limit and there never was — the only question is whether you
 * can get a thing off the ground. That is the right rule and it has a cost: by
 * floor four the pack is enormous, and an enormous flat list is not an
 * inventory, it is a punishment.
 *
 * All of this used to live inside the terminal renderer, welded to ANSI colour
 * codes, which meant the browser client — the one this is actually played on —
 * had a flat unsorted list with none of it. Filtering, ordering and "is this
 * better than what I have on" are *decisions about the game*, not decisions
 * about a terminal, so they belong here and both clients read from them.
 *
 * Nothing in this file renders anything. It answers questions and hands back
 * plain data; the clients decide what that looks like.
 */

/* ---------------------------------------------------------------- slices */

export type PackFilter =
  | "all" | "weapons" | "armour" | "consumables" | "materials" | "tools" | "junk" | "new";

export interface FilterDef {
  id: PackFilter;
  label: string;
  test: (i: Item) => boolean;
}

/**
 * The slices people actually reach for, in the order they reach for them.
 *
 * "new" is not a timestamp — it means anything above junk, which is what
 * somebody means when they say "show me what's worth looking at".
 */
export const PACK_FILTERS: readonly FilterDef[] = [
  { id: "all", label: "All", test: () => true },
  { id: "new", label: "Worth a look", test: (i) => i.rarity !== "junk" },
  { id: "weapons", label: "Weapons", test: (i) => i.kind === "weapon" || i.kind === "explosive" },
  { id: "armour", label: "Armour", test: (i) => i.kind === "armor" || i.kind === "jewelry" },
  { id: "consumables", label: "Consumables", test: (i) => i.kind === "potion" || i.kind === "food" || !!i.use },
  { id: "materials", label: "Materials", test: (i) => i.kind === "material" || i.tags.includes("craft") },
  { id: "tools", label: "Tools", test: (i) => i.kind === "tool" },
  { id: "junk", label: "Junk", test: (i) => i.rarity === "junk" && !i.use && !i.slot },
];

export const FILTER_BY_ID: Record<string, FilterDef> = Object.fromEntries(
  PACK_FILTERS.map((f) => [f.id, f]),
);

export function matchesFilter(item: Item, filter: string): boolean {
  return (FILTER_BY_ID[filter] ?? FILTER_BY_ID.all!).test(item);
}

/* ---------------------------------------------------------------- order */

export type PackSort = "relevance" | "value" | "weight" | "rarity" | "name" | "recent" | "density";

export const PACK_SORTS: readonly { id: PackSort; label: string }[] = [
  { id: "relevance", label: "Useful" },
  { id: "value", label: "Value" },
  { id: "weight", label: "Weight" },
  { id: "rarity", label: "Rarity" },
  { id: "name", label: "Name" },
  { id: "recent", label: "Newest" },
  /**
   * Value per kilogram, and the only sort that answers "what do I drop".
   *
   * The correct and non-obvious order for a game with no slot limit whose
   * storage stat is Strength: the question is never "what is worth least", it
   * is "what is worth least for the space it costs me".
   */
  { id: "density", label: "Density" },
];

export const rarityRank = (r: Rarity): number => RARITIES.indexOf(r);

/**
 * Relevance is the default because it is the only order that knows anything
 * about your situation: something you could put on right now beats something
 * rarer that you cannot, and a healing potion outranks both the moment you are
 * hurt.
 */
export function relevanceScore(state: GameState, i: Item): number {
  const hurt = state.crawler.hp / Math.max(1, state.crawler.hpMax) < 0.7;
  let v = rarityRank(i.rarity) * 10;
  if (i.slot && !state.inventory.some((x) => x.equipped && x.slot === i.slot)) v += 60;
  if (i.slot && compare(state, i).verdict === "better") v += 45;
  if (hurt && i.use?.effect === "heal") v += 80;
  if (i.use) v += 20;
  if (i.rarity === "junk") v -= 40;
  if (i.locked) v += 5;
  return v;
}

export function sortItems<T extends { item: Item }>(state: GameState, rows: T[], sort: PackSort): T[] {
  const copy = rows.slice();
  switch (sort) {
    case "value": return copy.sort((a, b) => b.item.value - a.item.value);
    case "weight": return copy.sort((a, b) => b.item.weight * b.item.qty - a.item.weight * a.item.qty);
    case "rarity": return copy.sort((a, b) => rarityRank(b.item.rarity) - rarityRank(a.item.rarity));
    case "name": return copy.sort((a, b) => a.item.name.localeCompare(b.item.name));
    case "recent": return copy.reverse();
    case "density": {
      const per = (i: { value: number; weight: number }) => i.value / Math.max(0.1, i.weight);
      return copy.sort((a, b) => per(b.item) - per(a.item));
    }
    default: return copy.sort((a, b) => relevanceScore(state, b.item) - relevanceScore(state, a.item));
  }
}

/* ------------------------------------------------------------ comparison */

export interface Comparison {
  verdict: "none" | "empty" | "better" | "worse" | "same";
  /** What it would replace. */
  against?: string;
  /** Positive means better. Roughly "points of gear". */
  delta: number;
  label: string;
}

/**
 * How much a piece of gear is worth, in one number, for comparison only.
 *
 * Armour is already a `{ k: "armor" }` modifier rather than a field on the
 * item, so the modifier sum covers it — adding a separate armour term would
 * count the same protection twice and tell somebody a breastplate beats a
 * sword.
 */
export function gearValue(i: Item): number {
  const mods = (i.mods ?? []).reduce(
    (n, m) => n + (typeof (m as { v?: number }).v === "number" ? (m as { v: number }).v : 0),
    0,
  );
  // Average of the damage die, weighted up — a weapon's dice matter more than
  // any single modifier on it.
  const m = /^(\d*)d(\d+)/i.exec(i.damage ?? "");
  const dice = m ? (parseInt(m[1] || "1", 10) * (parseInt(m[2]!, 10) + 1)) / 2 : 0;
  return mods + dice * 1.6;
}

/** A one-glance answer to "is this better than what I have on?". */
export function compare(state: GameState, item: Item): Comparison {
  if (!item.slot || item.equipped) return { verdict: "none", delta: 0, label: "" };
  const worn = state.inventory.find((i) => i.equipped && i.slot === item.slot);
  if (!worn) return { verdict: "empty", delta: gearValue(item), label: "empty slot" };
  const delta = gearValue(item) - gearValue(worn);
  if (Math.abs(delta) < 0.5) return { verdict: "same", against: worn.name, delta, label: `≈ ${worn.name}` };
  return delta > 0
    ? { verdict: "better", against: worn.name, delta, label: `▲ better than ${worn.name}` }
    : { verdict: "worse", against: worn.name, delta, label: `▼ worse than ${worn.name}` };
}

/* ----------------------------------------------------------------- view */

export interface PackRow {
  item: Item;
  /** Stable 1-based handle. `use 4` and `equip 11` are how the terminal works
   *  and the number must not move when a filter changes. */
  n: number;
  comparison: Comparison;
}

export interface PackView {
  worn: { slot: Slot; label: string; item: Item | null }[];
  rows: PackRow[];
  /** Before filtering, so "12 of 87" can be said honestly. */
  carriedCount: number;
  shownCount: number;
  kg: number;
  ceiling: number;
  /** 0..1+. Over 1 is impossible; at 0.9 the next good thing does not fit. */
  load: number;
  filter: PackFilter;
  sort: PackSort;
  /** Counts per filter, so a tab can say how much is behind it. */
  tally: Record<PackFilter, number>;
}

export function packView(state: GameState, filter: PackFilter = "all", sort: PackSort = "relevance"): PackView {
  const numbered = state.inventory.map((item, n) => ({ item, n: n + 1 }));
  const carried = numbered.filter((x) => !x.item.equipped);
  const matching = carried.filter(({ item }) => matchesFilter(item, filter));

  const tally = Object.fromEntries(
    PACK_FILTERS.map((f) => [f.id, carried.filter(({ item }) => f.test(item)).length]),
  ) as Record<PackFilter, number>;

  const ceiling = carryCapacity(state);
  const kg = carriedWeight(state);

  return {
    worn: SLOTS.map((slot) => ({
      slot,
      label: SLOT_LABEL[slot],
      item: state.inventory.find((i) => i.equipped && i.slot === slot) ?? null,
    })),
    rows: sortItems(state, matching, sort).map(({ item, n }) => ({
      item, n, comparison: compare(state, item),
    })),
    carriedCount: carried.length,
    shownCount: matching.length,
    kg,
    ceiling,
    load: ceiling > 0 ? kg / ceiling : 0,
    filter,
    sort,
    tally,
  };
}

/**
 * What "drop junk" and "sell junk" would actually take, so the button can say
 * so before it is pressed rather than after.
 */
export function junkHaul(state: GameState): { items: Item[]; kg: number; gold: number } {
  const items = state.inventory.filter(
    (i) => !i.equipped && !i.locked && i.rarity === "junk" && !i.use && !i.slot,
  );
  return {
    items,
    kg: Math.round(items.reduce((n, i) => n + i.weight * i.qty, 0) * 10) / 10,
    gold: items.reduce((n, i) => n + Math.floor(i.value * 0.4) * i.qty, 0),
  };
}
