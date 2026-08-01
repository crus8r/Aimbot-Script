import type { GameState, Item, MapNode } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import {
  BREWS, BREW_BY_ID, RECIPES, RECIPE_BY_ID, SPACE_COST, STATIONS, STATION_BY_ID,
  UPGRADES, UPGRADE_BY_ID, type RecipeDef, type StationId,
} from "../data/recipes.ts";
import { ITEM_BY_ID } from "../data/items.ts";
import { fromId, makeItem, nextIid } from "./loot.ts";
import { skillLevel, trainSkill } from "./character.ts";

/**
 * Where gold goes.
 *
 * Before this, money accumulated with nothing to spend it on, which quietly
 * removed a whole decision layer: whether to sell the thing, whether to walk
 * back to a shop, whether this floor is a buying floor or a saving floor.
 *
 * A bench is the biggest single purchase in the game and it changes what the
 * rest of the run can attempt rather than adding a percentage to something. An
 * Ordnance Studio is roughly three floors of thorough looting, and it is the
 * difference between throwing what you find and building what you need.
 */

export interface Space {
  owned: boolean;
  stations: StationId[];
  upgrades: string[];
}

export const emptySpace = (): Space => ({ owned: false, stations: [], upgrades: [] });

/** Benches you can reach right now: your own, plus whatever a guild hall has
 *  bolted to the wall for public use. */
export function stationsHere(state: GameState, node: MapNode): StationId[] {
  const own = (state.space.owned ? state.space.stations : []) as StationId[];
  // Guild halls keep a communal bench. It is worn out, it is always busy, and
  // it is free, which is how most crawlers make their first potion.
  const communal: StationId[] = node.kind === "guild" ? ["alchemy", "engineering"] : [];
  return [...new Set([...own, ...communal])];
}

export function inSafeRoom(node: MapNode): boolean {
  return node.kind === "safe_room" || node.kind === "guild";
}

/* --------------------------------------------------------- knowing how */

export function knowsRecipe(state: GameState, id: string): boolean {
  return state.recipes.includes(id);
}

export function learnRecipe(state: GameState, id: string, log: EventLog): boolean {
  if (state.recipes.includes(id)) return false;
  const r = RECIPE_BY_ID[id];
  if (!r) return false;
  state.recipes.push(id);
  log.push({
    kind: "skill_up",
    channel: "loot",
    skill: r.name,
    level: 1,
    note: `${r.learn} Needs ${r.skill.id} ${r.skill.level}${r.station ? ` and an ${STATION_BY_ID[r.station]!.name}` : ""}.`,
  });
  return true;
}

/** What a crawler already knows on arrival, read off the life they had. */
export function startingRecipes(state: GameState): string[] {
  const out: string[] = [];
  for (const r of RECIPES) {
    if (!r.station && skillLevel(state, r.skill.id) >= r.skill.level + 1) out.push(r.id);
  }
  return out;
}

export interface CraftCheck {
  ok: boolean;
  reason?: string;
  improvised?: boolean;
}

export function canCraft(state: GameState, node: MapNode, id: string): CraftCheck {
  const r = RECIPE_BY_ID[id];
  if (!r) return { ok: false, reason: `Nothing called "${id}".` };
  if (!knowsRecipe(state, id)) return { ok: false, reason: `You do not know how to build ${r.name}.` };

  const level = skillLevel(state, r.skill.id);
  if (level < r.skill.level) {
    return { ok: false, reason: `${r.name} needs ${r.skill.id} ${r.skill.level}. You have ${level}.` };
  }
  for (const m of r.materials) {
    const held = state.inventory.filter((i) => i.id === m.id).reduce((n, i) => n + i.qty, 0);
    if (held < m.qty) {
      return {
        ok: false,
        reason: `${r.name} needs ${m.qty} × ${ITEM_BY_ID[m.id]?.name ?? m.id}. You have ${held}.`,
      };
    }
  }

  const stations = stationsHere(state, node);
  if (r.station && !stations.includes(r.station)) {
    if (!r.improvisable) {
      return {
        ok: false,
        reason: `${r.name} cannot be improvised. It needs an ${STATION_BY_ID[r.station]!.name} and there is not one here.`,
      };
    }
    return { ok: true, improvised: true };
  }
  return { ok: true };
}

export function craft(
  state: GameState,
  rng: Rng,
  log: EventLog,
  node: MapNode,
  id: string,
): { item: Item | null; minutes: number } {
  const check = canCraft(state, node, id);
  if (!check.ok) throw new Error(check.reason!);
  const r = RECIPE_BY_ID[id]!;

  for (const m of r.materials) consume(state, m.id, m.qty);
  const minutes = check.improvised ? Math.round(r.minutes * 2.2) : r.minutes;

  // Improvising a charge on a stone floor with no extraction is exactly as
  // reliable as it sounds.
  if (check.improvised && rng.chance(0.3)) {
    log.say(
      `It does not come together. ${r.name} wants a bench, and a stone floor and your own hands are not a bench. The materials are gone and so is the time.`,
    );
    trainSkill(state, r.skill.id, 1);
    return { item: null, minutes };
  }

  const over = skillLevel(state, r.skill.id) - r.skill.level;
  const power = Math.max(1, r.makes.device.power + (over >= 6 ? 1 : 0));
  const item: Item = {
    iid: nextIid(rng),
    id: `device_${r.id}`,
    name: r.makes.name + (power > r.makes.device.power ? ", Overbuilt" : ""),
    kind: "explosive",
    rarity: power >= 4 ? "rare" : power >= 2 ? "uncommon" : "common",
    weight: r.makes.weight,
    value: r.makes.value,
    qty: 1,
    tags: ["device", "crafted", "thrown", ...r.makes.device.tags],
    desc: r.makes.desc,
    device: { ...r.makes.device, power },
  };
  trainSkill(state, r.skill.id, 3);
  log.push({ kind: "craft", channel: "loot", item: item.name, from: r.materials.map((m) => ITEM_BY_ID[m.id]?.name ?? m.id), minutes });
  return { item, minutes };
}

/* -------------------------------------------------------------- brewing */

export function brew(
  state: GameState,
  log: EventLog,
  node: MapNode,
  id: string,
  rng: Rng,
): { items: Item[]; minutes: number } {
  const b = BREW_BY_ID[id];
  if (!b) throw new Error(`Nothing called "${id}". Try \`craft\` to see the list.`);
  if (!stationsHere(state, node).includes(b.station)) {
    throw new Error(`${b.name} needs an ${STATION_BY_ID[b.station]!.name}, and there is not one here.`);
  }
  const level = skillLevel(state, b.skill.id);
  if (level < b.skill.level) throw new Error(`${b.name} needs ${b.skill.id} ${b.skill.level}. You have ${level}.`);
  for (const m of b.materials) {
    const held = state.inventory.filter((i) => i.id === m.id).reduce((n, i) => n + i.qty, 0);
    if (held < m.qty) throw new Error(`Short of ${ITEM_BY_ID[m.id]?.name ?? m.id} — you need ${m.qty}, you have ${held}.`);
  }
  for (const m of b.materials) consume(state, m.id, m.qty);
  const bonus = level >= b.skill.level + 4 ? 1 : 0;
  const items = [fromId(b.makes, b.qty + bonus, rng)];
  trainSkill(state, b.skill.id, 2);
  log.push({ kind: "craft", channel: "loot", item: `${b.qty + bonus} × ${ITEM_BY_ID[b.makes]?.name ?? b.makes}`, from: b.materials.map((m) => ITEM_BY_ID[m.id]?.name ?? m.id), minutes: b.minutes });
  return { items, minutes: b.minutes };
}

/**
 * Hours at a bench, burning materials, to find out something you did not know.
 * The only way to reach the recipes nobody hands out.
 */
export function experiment(
  state: GameState,
  rng: Rng,
  log: EventLog,
  node: MapNode,
): { learned: string | null; minutes: number } {
  const stations = stationsHere(state, node);
  if (!stations.length) throw new Error("You need a bench. Guild halls keep a communal one; the good ones you buy.");
  const scrap = state.inventory.filter((i) => i.tags.includes("craft")).reduce((n, i) => n + i.qty, 0);
  if (scrap < 3) throw new Error("You need materials to waste. At least three things worth taking apart.");

  consumeAnyCraft(state, 3);
  const minutes = rng.int(90, 180);

  const reachable = RECIPES.filter(
    (r) =>
      !knowsRecipe(state, r.id) &&
      skillLevel(state, r.skill.id) >= r.skill.level &&
      (!r.station || stations.includes(r.station)),
  );
  // Weight toward whatever they are best at; a good chemist finds chemistry.
  const scored = reachable
    .map((r) => ({ r, w: skillLevel(state, r.skill.id) - r.skill.level + 1 }))
    .filter((x) => x.w > 0);

  if (!scored.length || !rng.chance(0.55)) {
    log.say(
      reachable.length === 0
        ? "Hours of it, and nothing. You are not skilled enough for anything you have not already worked out, and no amount of staring changes that."
        : "Hours of it, and nothing you did not already know. The materials are gone. The clock is gone. This is what research is.",
    );
    for (const r of new Set(reachable.map((x) => x.skill.id))) trainSkill(state, r, 2);
    return { learned: null, minutes };
  }

  const found = rng.weighted(scored.map((x) => [x.r, x.w] as const));
  learnRecipe(state, found.id, log);
  log.say(`It comes together somewhere around the fourth hour. You know how to build ${found.name} now, and you will not forget it.`);
  return { learned: found.id, minutes };
}

/* ------------------------------------------------------- buying things */

export function buySpace(state: GameState, log: EventLog): void {
  if (state.space.owned) throw new Error("You already have one.");
  if (state.floor.n < 3) throw new Error("Personal spaces go on sale from the third floor. Borant likes you to want one first.");
  if (state.crawler.gold < SPACE_COST) {
    throw new Error(`A personal space is ${SPACE_COST} gold. You have ${state.crawler.gold}. Sell something.`);
  }
  state.crawler.gold -= SPACE_COST;
  state.space.owned = true;
  log.push({ kind: "gold", channel: "loot", amount: -SPACE_COST, total: state.crawler.gold, reason: "A personal space." });
  log.say(
    "A door that was not there is there now, and it is yours, and it opens off every safe room on every floor from here down. It is empty. It is four walls and a light. It is the first thing since the sky went that belongs to you, and the system would like to remind you that it is charging you nothing to keep it because it is charging you for everything you put in it.",
  );
}

export function installStation(state: GameState, log: EventLog, id: string): void {
  const def = STATION_BY_ID[id];
  if (!def) throw new Error(`No such bench: ${id}. Available: ${STATIONS.map((s) => s.id).join(", ")}.`);
  if (!state.space.owned) throw new Error("Nowhere to put it. You need a personal space first.");
  if (state.space.stations.includes(def.id)) throw new Error(`You already have an ${def.name}.`);
  if (state.crawler.gold < def.cost) {
    throw new Error(`An ${def.name} is ${def.cost} gold. You have ${state.crawler.gold}.`);
  }
  state.crawler.gold -= def.cost;
  state.space.stations.push(def.id);
  log.push({ kind: "gold", channel: "loot", amount: -def.cost, total: state.crawler.gold, reason: def.name });
  log.say(`${def.name}, installed, in your own room, on your own floor. ${def.desc}`);
}

export function buyUpgrade(state: GameState, log: EventLog, id: string): void {
  const def = UPGRADE_BY_ID[id];
  if (!def) throw new Error(`No such upgrade: ${id}. Available: ${UPGRADES.map((u) => u.id).join(", ")}.`);
  if (!state.space.owned) throw new Error("You need a personal space first.");
  if (state.space.upgrades.includes(def.id)) throw new Error("You have that already.");
  if (state.crawler.gold < def.cost) throw new Error(`${def.name} is ${def.cost} gold. You have ${state.crawler.gold}.`);
  state.crawler.gold -= def.cost;
  state.space.upgrades.push(def.id);
  log.push({ kind: "gold", channel: "loot", amount: -def.cost, total: state.crawler.gold, reason: def.name });
  log.say(`${def.name}. ${def.desc}`);
}

/* ------------------------------------------------------------- shops */

export function rollShopStock(state: GameState, rng: Rng): Item[] {
  const out: Item[] = [];
  // The staples, always, because a shop that does not sell bandages is not a
  // shop, it is a puzzle.
  for (const id of ["potion_health", "bandage", "rations", "powder", "reagent", "wire", "scrap"]) {
    const item = fromId(id, rng.int(2, 5), rng);
    out.push(item);
  }
  for (let i = 0; i < rng.int(3, 6); i++) {
    out.push(makeItem(rng, { floor: state.floor.n, quality: rng.chance(0.3) ? 1 : 0 }));
  }
  return out;
}

export const buyPrice = (state: GameState, item: Item): number =>
  Math.max(2, Math.round(item.value * 1.45 * (1 - Math.min(0.3, skillLevel(state, "negotiation") * 0.035))));

export const sellPrice = (state: GameState, item: Item): number =>
  Math.max(1, Math.round(item.value * 0.35 * (1 + Math.min(0.6, skillLevel(state, "negotiation") * 0.05))));

/* ------------------------------------------------------------ helpers */

function consume(state: GameState, id: string, qty: number): void {
  let left = qty;
  for (const item of [...state.inventory]) {
    if (item.id !== id || left <= 0) continue;
    const take = Math.min(item.qty, left);
    item.qty -= take;
    left -= take;
    if (item.qty <= 0) state.inventory = state.inventory.filter((i) => i.iid !== item.iid);
  }
}

function consumeAnyCraft(state: GameState, qty: number): void {
  let left = qty;
  for (const item of [...state.inventory]) {
    if (!item.tags.includes("craft") || item.equipped || item.locked || left <= 0) continue;
    const take = Math.min(item.qty, left);
    item.qty -= take;
    left -= take;
    if (item.qty <= 0) state.inventory = state.inventory.filter((i) => i.iid !== item.iid);
  }
}

export { RECIPES, BREWS, STATIONS, UPGRADES, SPACE_COST, RECIPE_BY_ID, STATION_BY_ID };
export type { RecipeDef, StationId };
