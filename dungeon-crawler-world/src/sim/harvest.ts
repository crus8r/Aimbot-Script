import type { GameState, Item, MapNode, Zone } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import { derived } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import {
  MATERIAL_BY_ID, RAW_MATERIALS, TOOL_ITEMS, TOOL_TAGS,
  type MaterialDef, type ToolClass,
} from "../data/materials.ts";
import { canLift, carriedWeight, carryCapacity, skillLevel, trainSkill } from "./character.ts";
import { nextIid } from "./loot.ts";
import { notePractice } from "./emergent.ts";

/**
 * Taking the dungeon apart.
 *
 * The rule that makes this affordable: WHAT IS IN A WALL IS NEVER STORED. It is
 * a pure function of the world seed and the room's own tags, so a floor of
 * geology costs nothing until somebody touches it, and touching it stores two
 * integers. Ask what is in a wall a thousand times and you get the same answer
 * a thousand times without the save file growing by a byte.
 *
 * The rule that stops it being a mine: STRAIN. A room is not an infinite
 * resource with a slow tap on it — it is a structure, and the second and third
 * things you take out are the ones it was relying on. Pull three times the
 * room's own capacity out of a position and it starts sagging. Pull five times
 * and it comes down, on whoever is standing there, burying everything you had
 * not got to yet.
 *
 * That is the anti-farming measure, and it is deliberately not a cooldown or a
 * daily limit. It is the actual physical consequence of the actual thing you
 * did, which means a crawler who works it out can also use it: a ceiling you
 * have spent an hour weakening is a ceiling you can drop.
 */

/* -------------------------------------------------------------- deposits */

export interface Deposit {
  mat: MaterialDef;
  /** Units originally present. */
  units: number;
  /** Units still there. */
  left: number;
}

const depKey = (floor: number, node: string, zone: string, mat: string) =>
  `d:${floor}:${node}:${zone}:${mat}`;

const strainKey = (floor: number, node: string, zone: string) =>
  `s:${floor}:${node}:${zone}`;

/** How many distinct substances one position is allowed to be worth listing. */
const PER_ZONE = 4;

/**
 * Derivation is cheap but not free, and the interpreter asks on every line
 * somebody types. Keyed on exactly the inputs the derivation reads, so a hit is
 * indistinguishable from recomputing it.
 */
const memo = new Map<string, Deposit[]>();

/**
 * What this position is made of.
 *
 * Pure. Takes no live rng and consumes no state, so the examine text, the
 * interpreter and the harvest verb can all ask independently and agree.
 *
 * The per-material key is deliberate: it means adding a substance to the
 * catalogue does not reshuffle the geology of a run already in progress, which
 * matters because a save carries no record of what any wall was made of.
 */
export function depositsIn(seed: number, floor: number, node: MapNode, zone: Zone): Deposit[] {
  const cacheKey = `${seed}:${floor}:${node.id}:${zone.id}:${zone.tags.join(",")}`;
  const hit = memo.get(cacheKey);
  if (hit) return hit;

  const found: { d: Deposit; weight: number }[] = [];
  for (const mat of RAW_MATERIALS) {
    const o = mat.occurs!;
    if (o.floors && (floor < o.floors[0] || floor > o.floors[1])) continue;
    if (o.nodes?.length && !o.nodes.includes(node.kind)) continue;
    if (o.zones?.length && !o.zones.some((t) => zone.tags.includes(t))) continue;

    const r = derived(seed, `deposit:${floor}:${node.id}:${zone.id}:${mat.id}`);
    // A room that matches on a tag is likelier than one that merely does not
    // exclude it: the wall is limestone *because* the place is a cut-stone
    // undercroft, not in spite of it.
    const keyed = !!o.zones?.length || !!o.nodes?.length;
    if (!r.chance(keyed ? o.chance : o.chance * 0.55)) continue;

    found.push({ d: { mat, units: r.int(o.units[0], o.units[1]), left: 0 }, weight: r.next() });
  }

  // A wall listing eight substances is a spreadsheet, not a wall. Which four
  // survive is a stable roll rather than a rarity ranking, so a common brick
  // does not automatically crowd out the nitre worth scraping.
  found.sort((a, b) => b.weight - a.weight);
  const out = found.slice(0, PER_ZONE).map((f) => f.d);
  out.sort((a, b) => a.mat.id.localeCompare(b.mat.id));

  if (memo.size > 2000) memo.clear();
  memo.set(cacheKey, out);
  return out;
}

/** The same, with what has already been taken subtracted. */
export function depositsLeft(state: GameState, node: MapNode, zone: Zone): Deposit[] {
  const floor = state.floor.n;
  const dug = state.dug ?? {};
  // A position that has come down has nothing left in it by definition, and
  // saying so here is what stops the rubble it turned into from reading as a
  // fresh seam of everything rubble is made of.
  if (strainOf(state, node, zone) >= collapseLimit(zone)) return [];
  return depositsIn(state.seed, floor, node, zone)
    .map((d) => ({
      ...d,
      left: Math.max(0, d.units - (dug[depKey(floor, node.id, zone.id, d.mat.id)] ?? 0)),
    }))
    .filter((d) => d.left > 0);
}

/** Everything reachable in this room, position by position. */
export function depositsHere(state: GameState, node: MapNode): { zone: Zone; deposits: Deposit[] }[] {
  return node.zones
    .map((zone) => ({ zone, deposits: depositsLeft(state, node, zone) }))
    .filter((z) => z.deposits.length > 0);
}

/* ---------------------------------------------------------------- strain */

export function strainOf(state: GameState, node: MapNode, zone: Zone): number {
  return state.dug?.[strainKey(state.floor.n, node.id, zone.id)] ?? 0;
}

/**
 * How much this position will take before it starts to sag.
 *
 * Keyed to capacity because capacity already means "how much of this place is
 * structure and how much is space" — a two-man doorway is mostly wall and a
 * plaza is mostly air, and the doorway is the one that stops being a doorway.
 */
export function strainLimit(zone: Zone): number {
  return Math.max(3, zone.capacity * 3);
}

export function collapseLimit(zone: Zone): number {
  return Math.max(5, zone.capacity * 5);
}

export type StrainStage = "sound" | "working" | "sagging" | "critical" | "down";

export function strainStage(state: GameState, node: MapNode, zone: Zone): StrainStage {
  const s = strainOf(state, node, zone);
  if (s <= 0) return "sound";
  if (s >= collapseLimit(zone)) return "down";
  if (s >= strainLimit(zone)) return "critical";
  if (s >= strainLimit(zone) * 0.6) return "sagging";
  return "working";
}

export function strainNote(stage: StrainStage): string {
  switch (stage) {
    case "sound": return "";
    case "working": return "The wall here is opened up where you have been working it.";
    case "sagging": return "There is a crack running out of the hole you made, and it was not there when you started.";
    case "critical": return "It is taking the weight badly. Dust is coming down on its own, and the next thing out of this wall is going to be an event.";
    case "down": return "This part of the room has already come down. There is nothing left in it but the pieces.";
  }
}

/* ----------------------------------------------------------------- tools */

/** The best tool of a class you have to hand, or null. */
export function toolFor(state: GameState, klass: ToolClass): Item | null {
  const ids = TOOL_ITEMS[klass];
  const tags = TOOL_TAGS[klass];
  let best: Item | null = null;
  for (const i of state.inventory) {
    const fits = ids.includes(i.id) || i.tags.some((t) => tags.includes(t));
    if (!fits) continue;
    if (!best || (i.value ?? 0) > (best.value ?? 0)) best = i;
  }
  return best;
}

const TOOL_WORDS: Record<ToolClass, string> = {
  edge: "something with an edge on it",
  lever: "something to lever with — a bar, a pipe, a crowbar",
  percussion: "something heavy to hit it with",
  cutting: "something that will cut metal",
  fine: "proper tools and a steady hand",
};

/* --------------------------------------------------------------- the verb */

export interface HarvestResult {
  ok: boolean;
  reason?: string;
  got?: number;
  minutes?: number;
  collapsed?: boolean;
}

/**
 * Take a material out of a position.
 *
 * Everything a crawler could reasonably object to is checked before any time is
 * spent, and the refusals say what would fix them. Nothing here fails silently
 * and nothing here fails on a technicality about wording.
 */
export function harvest(
  state: GameState,
  rng: Rng,
  log: EventLog,
  node: MapNode,
  zone: Zone,
  matId: string,
  want: number,
): HarvestResult {
  const mat = MATERIAL_BY_ID[matId];
  if (!mat) return { ok: false, reason: `Nothing here is made of ${matId}.` };

  const stage = strainStage(state, node, zone);
  if (stage === "down") {
    return { ok: false, reason: `${cap(zone.name)} has already come down. Whatever was in that wall is under it.` };
  }

  const deposit = depositsLeft(state, node, zone).find((d) => d.mat.id === matId);
  if (!deposit) {
    return { ok: false, reason: `There is no ${mat.name.toLowerCase()} left in ${zone.name}.` };
  }

  const tool = mat.tool ? toolFor(state, mat.tool) : null;
  if (mat.tool && !tool) {
    return { ok: false, reason: `Getting ${mat.name.toLowerCase()} out wants ${TOOL_WORDS[mat.tool]}, and you do not have it.` };
  }

  // How many you can carry decides how many you take. Working loose four
  // blocks you cannot lift is not a tragedy, it is a waste of forty minutes.
  const room = Math.max(0, carryCapacity(state) - carriedWeight(state));
  const canCarry = Math.floor(room / mat.kg);
  if (!canLift(state, mat.kg)) {
    return { ok: false, reason: `One ${mat.unit} of ${mat.name.toLowerCase()} is ${mat.kg} kg and you cannot lift it. That is a Strength problem.` };
  }
  if (canCarry < 1) {
    return {
      ok: false,
      reason: `You are carrying ${carriedWeight(state)} kg against a ${carryCapacity(state)} kg ceiling. There is no room for ${mat.kg} kg of ${mat.name.toLowerCase()} until something goes.`,
    };
  }

  const target = Math.max(1, Math.min(want, deposit.left, canCarry));

  const skill = skillLevel(state, "scavenging");
  const bonus = skill + (tool ? 2 : 0) + (stage === "sound" ? 0 : 1);

  let got = 0;
  let minutes = 0;
  let collapsed = false;
  const per = mat.minutes ?? 8;

  for (let i = 0; i < target; i++) {
    minutes += Math.max(2, Math.round(per * (1 - Math.min(0.5, skill * 0.06))));
    const roll = rng.d(20) + bonus;
    if (roll < (mat.dc ?? 6)) {
      // A miss is not a wasted turn, it is a wasted attempt: the time went, the
      // unit did not, and the wall is no weaker for it.
      continue;
    }
    got++;

    if (mat.structural) {
      const key = strainKey(state.floor.n, node.id, zone.id);
      const dug = (state.dug ??= {});
      const next = (dug[key] ?? 0) + 1;
      dug[key] = next;
      if (next >= collapseLimit(zone)) {
        collapsed = true;
        break;
      }
    }
  }

  if (got > 0) {
    const dug = (state.dug ??= {});
    const key = depKey(state.floor.n, node.id, zone.id, mat.id);
    dug[key] = (dug[key] ?? 0) + got;

    state.inventory.push(materialItem(mat, got));
    trainSkill(state, "scavenging", got * 2);
    notePractice(state, "quarrying", got);
    if (mat.kg >= 4) notePractice(state, "heavy_haul");
  }

  const stageAfter = strainStage(state, node, zone);
  const notes: string[] = [];
  if (got === 0) notes.push("Nothing came away clean.");
  if (!collapsed && stageAfter !== "sound" && stageAfter !== "working") notes.push(strainNote(stageAfter));

  log.push({
    kind: "harvest", channel: got > 0 ? "loot" : "narration",
    material: mat.name, units: got, zone: zone.name, minutes,
    strain: stageAfter, note: notes.join(" "),
  });

  if (collapsed) bringDown(state, log, node, zone, "harvest");

  return { ok: true, got, minutes, collapsed };
}

/**
 * The consequence.
 *
 * It is not a scolding and it is not a game-over. It is the ceiling arriving,
 * which hurts, buries what was left, and permanently changes what that corner
 * of the room is — including, if you were paying attention, in ways you can
 * arrange on purpose.
 */
export function bringDown(
  state: GameState,
  log: EventLog,
  node: MapNode,
  zone: Zone,
  caused: "harvest" | "charge" | "feature",
): void {
  const dug = (state.dug ??= {});
  dug[strainKey(state.floor.n, node.id, zone.id)] = collapseLimit(zone);

  zone.capacity = 1;
  if (!zone.tags.includes("rubble")) zone.tags.push("rubble");
  // Whatever was in that corner is under the same rubble as everything else.
  for (const f of zone.features) f.spent = true;

  const hurt: { who: string; amount: number; killed: boolean }[] = [];
  const enc = state.encounter && !state.encounter.finished ? state.encounter : null;

  if (enc) {
    for (const c of enc.combatants) {
      if (c.hp <= 0 || c.zone !== zone.id) continue;
      // Proportional, because a ceiling does not have a damage die — it has a
      // mass, and it does not care what you were wearing.
      const hit = Math.max(6, Math.round(c.hpMax * 0.28));
      c.hp = Math.max(0, c.hp - hit);
      hurt.push({ who: c.side === "crawler" ? "you" : c.name, amount: hit, killed: c.hp <= 0 });
      if (c.side === "crawler") state.crawler.hp = c.hp;
    }
    // A fight in a room that has just lost a position is a different fight.
    for (const c of enc.combatants) {
      if (c.hp > 0 && c.zone === zone.id) {
        const out = node.zones.find((z) => z.id !== zone.id && zone.links.includes(z.id));
        if (out) c.zone = out.id;
      }
    }
  } else if (caused === "harvest") {
    // You were the one holding the bar. You do not get clear of all of it.
    const hit = Math.max(4, Math.round(state.crawler.hp * 0.15));
    state.crawler.hp = Math.max(1, state.crawler.hp - hit);
    hurt.push({ who: "you", amount: hit, killed: false });
  }

  log.push({
    kind: "collapse", channel: "bad", zone: zone.name, hurt, caused,
    note:
      `${cap(zone.name)} comes down — a section of wall lets go, then the ceiling it was holding, then everything above that ` +
      `for about two seconds. What is left is a pile of what it was made of, and whatever you had not dug out yet is at the bottom of it.`,
  });

  notePractice(state, "demolition_work", 2);
}

/* ----------------------------------------------------------------- items */

/** A material becomes an ordinary stacking inventory item, because it is one. */
export function materialItem(mat: MaterialDef, qty: number): Item {
  return {
    iid: nextIid(),
    id: `mat_${mat.id}`,
    name: mat.name,
    kind: "material",
    rarity: mat.value >= 60 ? "uncommon" : mat.value >= 20 ? "common" : "junk",
    weight: mat.kg,
    value: mat.value,
    qty,
    tags: ["craft", "material", ...mat.tags],
    desc: mat.desc,
    equipped: false,
  };
}

/** The material an inventory item is, if it is one. */
export function materialOf(item: Item): MaterialDef | undefined {
  return item.id.startsWith("mat_") ? MATERIAL_BY_ID[item.id.slice(4)] : undefined;
}

/** How many units of a material are in the pack. */
export function heldUnits(state: GameState, matId: string): number {
  return state.inventory
    .filter((i) => i.id === `mat_${matId}`)
    .reduce((n, i) => n + i.qty, 0);
}

/** Take units out of the pack. Returns false and changes nothing if short. */
export function spendUnits(state: GameState, matId: string, qty: number): boolean {
  if (heldUnits(state, matId) < qty) return false;
  let left = qty;
  for (const i of state.inventory) {
    if (left <= 0) break;
    if (i.id !== `mat_${matId}`) continue;
    const take = Math.min(left, i.qty);
    i.qty -= take;
    left -= take;
  }
  state.inventory = state.inventory.filter((i) => i.qty > 0 || i.equipped);
  return true;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function plural(unit: string): string {
  if (/(s|x|ch|sh)$/.test(unit)) return `${unit}es`;
  if (/[^aeiou]y$/.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
}
