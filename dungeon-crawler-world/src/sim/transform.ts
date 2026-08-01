import type { GameState, Item, MapNode } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import type { Requirement } from "../core/proposal.ts";
import { requirementWeight } from "../core/proposal.ts";
import {
  MATERIAL_BY_ID, isMatTag, type MatTag, type MaterialDef, type ToolClass,
} from "../data/materials.ts";
import { TRANSFORMS, TRANSFORM_BY_ID, type Product, type TransformRule } from "../data/transforms.ts";
import { heldUnits, materialItem, materialOf, spendUnits, toolFor } from "./harvest.ts";
import { skillLevel, trainSkill } from "./character.ts";
import { stationsHere } from "./craft.ts";
import { notePractice } from "./emergent.ts";
import { currentNode } from "./map.ts";
import { commaList } from "../core/util.ts";

/**
 * Turning one substance into another.
 *
 * The engine never asks whether a transformation is REAL. It prices it. Every
 * requirement is a thing the world can be interrogated about — do you have nine
 * hundred degrees, can you hold it for three hours, is there anywhere for the
 * fumes to go — and none of them require the simulation to know any chemistry.
 *
 * That is what makes this safe to open up to a language model later without a
 * validator anybody can argue with. There is no truth check to lose an argument
 * about. Claim something needs nothing and you get something that does nothing;
 * claim it needs eleven hours at nine hundred degrees and you have to actually
 * produce eleven hours at nine hundred degrees.
 */

/* -------------------------------------------------------- what you have */

export interface Capability {
  /** Hottest thing you can get to, and whether it will stay there. */
  heatC: number;
  heatSustained: boolean;
  heatFrom: string;
  flame: boolean;
  water: boolean;
  vessel: "none" | "open" | "sealed" | "pressure";
  ventilated: boolean;
  current: boolean;
  freezing: boolean;
  stations: string[];
}

const has = (state: GameState, ...tags: MatTag[]): boolean =>
  state.inventory.some((i) => {
    const m = materialOf(i);
    return !!m && tags.every((t) => m.tags.includes(t)) && i.qty > 0;
  });

/**
 * What this room and this pack are physically capable of.
 *
 * Deliberately generous about what counts and specific about how much: a fire
 * of green timber is a real fire and it is four hundred degrees, which is not
 * enough to calcine anything and is exactly the sort of fact a player should be
 * able to find out and then go and fix.
 */
export function capabilityOf(state: GameState, node: MapNode): Capability {
  const stations = stationsHere(state, node);
  const zones = node.zones;

  const lighter = state.inventory.some((i) => ["lighter", "torch", "detonator"].includes(i.id));
  const fireFeature = zones.some((z) => z.features.some((f) => !f.spent && (f.kind === "ignite" || f.kind === "gas")));
  const flame = lighter || fireFeature || stations.length > 0;

  // Fuel decides the ceiling. Charcoal is the whole reason smelting exists.
  let heatC = 0;
  let heatFrom = "nothing that burns";
  if (flame && has(state, "combustible")) {
    heatC = 420;
    heatFrom = "an open fire";
  }
  if (flame && has(state, "combustible", "purified")) {
    heatC = 1250;
    heatFrom = "a charcoal fire, forced";
  }
  if (stations.includes("alchemy") && heatC < 700) {
    heatC = 700;
    heatFrom = "the bench burner";
  }
  if (stations.includes("ordnance") && heatC < 900) {
    heatC = 900;
    heatFrom = "the studio's furnace";
  }
  if (stations.includes("forge")) {
    heatC = Math.max(heatC, 1500);
    heatFrom = "the forge";
  }
  // Holding a temperature for hours is a different problem from reaching it.
  const heatSustained = stations.length > 0 || has(state, "combustible", "purified") || has(state, "organic", "combustible");

  const water = zones.some((z) => z.tags.includes("water")) ||
    state.inventory.some((i) => i.id === "waterskin" || i.tags.includes("water"));

  // Something OPEN is always to hand — a helmet, a boot, a hollow in the floor.
  // Gating on owning a bucket would refuse people for the wrong reason. Sealed
  // and pressure are real problems and stay real problems.
  const vessel: Capability["vessel"] =
    stations.includes("ordnance") || stations.includes("forge")
      ? "pressure"
      : has(state, "refractory", "purified") || has(state, "metal", "malleable") ||
        has(state, "silicate", "refractory") || stations.length > 0
        ? "sealed"
        : "open";

  return {
    heatC, heatSustained, heatFrom, flame, water, vessel,
    ventilated: zones.some((z) => !z.tags.includes("confined")),
    current: zones.some((z) => z.features.some((f) => !f.spent && f.kind === "electrify")) ||
      (has(state, "conductive") && stations.includes("engineering")),
    // Nothing in the dungeon is cold yet. The requirement exists because a
    // proposal is allowed to ask for it, and asking for something the world
    // cannot supply must fail honestly rather than be quietly waived.
    freezing: false,
    stations,
  };
}

/** Whether a single requirement is met, and what would fix it if not. */
export function satisfy(state: GameState, cap: Capability, r: Requirement): string | null {
  switch (r.k) {
    case "heat":
      if (cap.heatC < r.minC) {
        return `${r.minC}°C, held. The best you have here is ${cap.heatC || "no fire at all"}${cap.heatC ? `°C from ${cap.heatFrom}` : ""}${
          cap.heatC && cap.heatC < r.minC ? " — charcoal, or a forge, or both" : ""
        }`;
      }
      if (r.holdHours >= 2 && !cap.heatSustained) return `enough fuel to hold it for ${r.holdHours} hours, which you do not have`;
      return null;
    case "flame":
      return cap.flame ? null : "a light — a lighter, a torch, or something already burning";
    case "immersion":
      return r.medium === "water"
        ? cap.water ? null : "water, either standing in this room or in a skin"
        : has(state, r.medium === "acid" ? "acidic" : r.medium === "alkali" ? "alkaline" : "combustible")
          ? null
          : `${r.medium} to put it in`;
    case "vessel": {
      const rank = { none: 0, open: 1, sealed: 2, pressure: 3 };
      return rank[cap.vessel] >= rank[r.kind]
        ? null
        : `something ${r.kind} to do it in${r.kind === "sealed" ? " — fired clay, glass, or a capped pipe" : r.kind === "pressure" ? " — that means a bench" : ""}`;
    }
    case "station":
      return cap.stations.includes(r.id) ? null : `${r.id === "ordnance" ? "an Ordnance Studio" : `a ${r.id} bench`}, and there is not one here`;
    case "tool": {
      const words: Record<ToolClass, string> = {
        edge: "something with an edge", lever: "a bar to lever with", percussion: "something heavy to hit it with",
        cutting: "something that cuts metal", fine: "fine tools and a steady hand",
      };
      return toolFor(state, r.klass) ? null : words[r.klass];
    }
    case "skill": {
      const have = skillLevel(state, r.id);
      return have >= r.level ? null : `${r.id} ${r.level} — you have ${have}`;
    }
    case "hours":
      return state.floor.hoursLeft >= r.n ? null : `${r.n} clear hours, and this floor has ${state.floor.hoursLeft.toFixed(1)} left`;
    case "ventilation":
      return r.kind === "confined" || cap.ventilated ? null : "somewhere for the fumes to go, which this room is not";
    case "current":
      return cap.current ? null : "a live circuit — a bench, or something in the room already carrying one";
    case "freezing":
      return cap.freezing ? null : "cold you cannot get to on this floor";
  }
}

/* ------------------------------------------------------------- matching */

/** Materials in the pack that could be the main input to this rule. */
export function inputsFor(state: GameState, rule: TransformRule): { mat: MaterialDef; units: number }[] {
  const out: { mat: MaterialDef; units: number }[] = [];
  for (const item of state.inventory) {
    const m = materialOf(item);
    if (!m) continue;
    if (!rule.wants.every((t) => m.tags.includes(t))) continue;
    if (rule.refuses?.some((t) => m.tags.includes(t))) continue;
    const units = heldUnits(state, m.id);
    if (units > 0 && !out.some((o) => o.mat.id === m.id)) out.push({ mat: m, units });
  }
  return out;
}

function secondFor(state: GameState, rule: TransformRule): { mat: MaterialDef; units: number } | null {
  if (!rule.with) return null;
  for (const item of state.inventory) {
    const m = materialOf(item);
    if (!m || !rule.with.wants.every((t) => m.tags.includes(t))) continue;
    const units = heldUnits(state, m.id);
    if (units >= rule.with.qty) return { mat: m, units };
  }
  return null;
}

/** Every rule that could run on something you are currently holding. */
export function availableTransforms(state: GameState): { rule: TransformRule; inputs: { mat: MaterialDef; units: number }[] }[] {
  return TRANSFORMS
    .map((rule) => ({ rule, inputs: inputsFor(state, rule) }))
    .filter((r) => r.inputs.length > 0);
}

/**
 * Whole-phrase match, both ends.
 *
 * Substring matching here was live and wrong in exactly the way that makes a
 * game feel broken: the phrase "lime" reached inside the word "limestone", so
 * "dig out more limestone" was read as an attempt to calcine it. A rule's
 * trigger has to end where the word ends.
 */
const said = (text: string, phrase: string): boolean =>
  new RegExp(`(?:^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i").test(text);

/**
 * Which rule somebody meant.
 *
 * Matches on what they said AND on what they are holding, because "burn the
 * limestone" and "burn the timber" are different rules reached by the same
 * sentence and the difference is entirely in the bag.
 */
export function readTransform(
  state: GameState,
  text: string,
): { rule: TransformRule; input: MaterialDef } | null {
  const t = text.toLowerCase();
  const scored: { rule: TransformRule; input: MaterialDef; score: number }[] = [];

  for (const { rule, inputs } of availableTransforms(state)) {
    let score = 0;
    for (const phrase of rule.says) if (said(t, phrase)) score += phrase.length > 6 ? 3 : 2;
    // Naming the product counts double: "make quicklime" is the clearest a
    // person can be, and it never names the rule or the input.
    for (const id of Object.values(rule.prefer ?? {})) {
      const named = MATERIAL_BY_ID[id];
      if (named && said(t, named.name.toLowerCase())) score += 6;
    }
    if (!score) continue;
    for (const { mat } of inputs) {
      const names = said(t, mat.name.toLowerCase()) ||
        mat.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && said(t, w));
      scored.push({ rule, input: mat, score: score + (names ? 4 : 0) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0] ? { rule: scored[0].rule, input: scored[0].input } : null;
}

/* ------------------------------------------------------------ the product */

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What comes out.
 *
 * Named where the thing has a name people know, derived otherwise. The derived
 * path is the important one: it is what lets a rule written once about
 * carbonates produce a correct and differently-named product from bone, mortar
 * and limestone without any of the three appearing in the rule.
 */
export function productOf(rule: TransformRule, input: MaterialDef): MaterialDef {
  const named = rule.prefer?.[input.id] ?? rule.makes.id;
  const known = named ? MATERIAL_BY_ID[named] : undefined;
  if (known) return known;

  const p: Product = rule.makes;
  const tags = new Set<MatTag>(input.tags);
  for (const t of p.drop ?? []) tags.delete(t);
  for (const t of p.add ?? []) tags.add(t);

  const base = input.name.replace(/^(?:raw|old|wet|broken|fired|worked)\s+/i, "");
  const name = [p.prefix, base, p.suffix].filter(Boolean).join(" ");

  return {
    id: `${rule.id}_${input.id}`,
    name,
    unit: "measure",
    // Every tag came from the input or from the rule's own closed lists, so a
    // product cannot carry a property nothing in the game defends against.
    tags: [...tags].filter(isMatTag),
    kg: Math.max(0.1, Math.round(input.kg * (p.mass ?? 1) * 10) / 10),
    value: Math.max(1, Math.round(input.value * 1.4 + (p.worth ?? 0))),
    desc: p.desc ?? `${cap1(base.toLowerCase())}, after ${rule.name.toLowerCase()}.`,
  };
}

/* --------------------------------------------------------------- doing it */

export interface TransformCheck {
  ok: boolean;
  rule: TransformRule;
  input: MaterialDef;
  product: MaterialDef;
  /** Requirements not met, phrased as what would fix them. */
  missing: string[];
  /** Units of input available against units needed. */
  have: number;
  need: number;
  second: { mat: MaterialDef; qty: number } | null;
}

export function checkTransform(
  state: GameState,
  node: MapNode,
  rule: TransformRule,
  input: MaterialDef,
  batches = 1,
): TransformCheck {
  const cap = capabilityOf(state, node);
  const missing = rule.needs.map((r) => satisfy(state, cap, r)).filter((m): m is string => m !== null);

  const second = secondFor(state, rule);
  if (rule.with && !second) {
    missing.push(`a second ingredient — something ${commaList(rule.with.wants)}`);
  }

  const need = rule.ratio.in * batches;
  const have = heldUnits(state, input.id);
  if (have < need) missing.push(`${need} ${input.name.toLowerCase()} — you have ${have}`);
  if (second && rule.with && heldUnits(state, second.mat.id) < rule.with.qty * batches) {
    missing.push(`${rule.with.qty * batches} ${second.mat.name.toLowerCase()}`);
  }

  return {
    ok: missing.length === 0,
    rule, input, product: productOf(rule, input), missing, have, need,
    second: second && rule.with ? { mat: second.mat, qty: rule.with.qty * batches } : null,
  };
}

export interface TransformResult {
  ok: boolean;
  reason?: string;
  made?: { mat: MaterialDef; units: number };
  minutes?: number;
}

/**
 * Run it.
 *
 * A failure here is a botched batch, not a refusal — the refusal happened in
 * `checkTransform` before any material was spent. Once the work starts, the
 * materials are gone whether it worked or not, which is what makes a skill
 * level mean something and what makes a first attempt a decision.
 */
export function runTransform(
  state: GameState,
  rng: Rng,
  log: EventLog,
  node: MapNode,
  ruleId: string,
  inputId: string,
  batches = 1,
): TransformResult {
  const rule = TRANSFORM_BY_ID[ruleId];
  if (!rule) return { ok: false, reason: `Nothing called ${ruleId}.` };

  const input = state.inventory.map(materialOf).find((m) => m?.id === inputId) ?? MATERIAL_BY_ID[inputId];
  if (!input) return { ok: false, reason: `You are not carrying any ${inputId}.` };

  const check = checkTransform(state, node, rule, input, batches);
  if (!check.ok) {
    return {
      ok: false,
      reason: `${rule.name} ${check.missing.length === 1 ? "wants" : "wants"} ${commaList(check.missing)}.`,
    };
  }

  spendUnits(state, input.id, check.need);
  if (check.second) spendUnits(state, check.second.mat.id, check.second.qty);

  const skill = skillLevel(state, rule.under);
  // Half the requirement weight, not all of it.
  //
  // The requirements are the gate; they have already been checked and met, and
  // charging their full difficulty again as a dice roll means a crawler who
  // assembled nine hundred degrees, three hours of fuel and an open kiln still
  // ruins the batch nearly half the time. Failure here is meant to be handling
  // error, not physics — physics was the part they already solved.
  const difficulty = 4 + Math.round(rule.needs.reduce((n, r) => n + requirementWeight(r), 0) / 2);
  const roll = rng.d(20) + skill + (check.rule.needs.some((r) => r.k === "station") ? 2 : 0);

  const minutes = Math.round(rule.minutes * batches * (1 - Math.min(0.45, skill * 0.05)));

  if (roll < difficulty) {
    // Ruined. The time and the materials went; the knowledge stayed.
    trainSkill(state, rule.under, 3);
    log.push({
      kind: "transform", channel: "bad",
      rule: rule.name, input: input.name, product: check.product.name,
      units: 0, minutes, worked: false,
      because: `The batch is spoiled — ${roll < difficulty - 5 ? "badly, and it went everywhere" : "narrowly, which is worse to watch"}. ${check.need} ${input.name.toLowerCase()} gone, and you know more than you did.`,
    });
    return { ok: true, made: undefined, minutes };
  }

  const units = rule.ratio.out * batches + (roll >= difficulty + 8 ? 1 : 0);
  state.inventory.push(materialItem(check.product, units));
  trainSkill(state, rule.under, 6);
  notePractice(state, "transmuting", 1);
  if (check.product.tags.includes("caustic") || check.product.tags.includes("acidic")) {
    notePractice(state, "fire", 1);
  }

  log.push({
    kind: "transform", channel: "loot",
    rule: rule.name, input: input.name, product: check.product.name,
    units, minutes, worked: true,
    because: rule.because,
  });

  return { ok: true, made: { mat: check.product, units }, minutes };
}

/** Everything you could do right now, for the workshop sheet. */
export function transformMenu(state: GameState): {
  rule: TransformRule; input: MaterialDef; product: MaterialDef; ok: boolean; missing: string[];
}[] {
  const node = currentNode(state.floor);
  const out: { rule: TransformRule; input: MaterialDef; product: MaterialDef; ok: boolean; missing: string[] }[] = [];
  for (const { rule, inputs } of availableTransforms(state)) {
    for (const { mat } of inputs) {
      const c = checkTransform(state, node, rule, mat);
      out.push({ rule, input: mat, product: c.product, ok: c.ok, missing: c.missing });
    }
  }
  // Doable first, then by how close it is to being doable.
  out.sort((a, b) => Number(b.ok) - Number(a.ok) || a.missing.length - b.missing.length);
  return out;
}

/** For the interpreter: is this line about doing something to a substance? */
export function looksLikeTransform(text: string): boolean {
  const t = text.toLowerCase();
  return TRANSFORMS.some((r) => r.says.some((s) => said(t, s)));
}

export type { Item };
