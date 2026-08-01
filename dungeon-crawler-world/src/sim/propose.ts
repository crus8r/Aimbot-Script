import type { GameState, Item, MapNode } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import {
  FAMILY_CAN_BE_VITAL, FAMILY_KIND, FAMILY_TAGS, FAMILIES,
  REQUIREMENT_KINDS, requirementWeight, sanitiseName, sanitiseProse,
  type Decline, type Family, type Proposal, type Reading, type Requirement, type Transform,
} from "../core/proposal.ts";
import { isMatTag, MATERIAL_BY_ID } from "../data/materials.ts";
import { heldUnits, materialOf, spendUnits } from "./harvest.ts";
import { nextIid } from "./loot.ts";
import { capabilityOf, satisfy } from "./transform.ts";
import { skillLevel, trainSkill } from "./character.ts";
import { notePractice } from "./emergent.ts";
import { commaList } from "../core/util.ts";

/**
 * Taking a Dungeon Master seriously without giving it the till.
 *
 * `src/core/proposal.ts` decides what a model is allowed to SAY. This decides
 * what any of it is WORTH, and the split is the safety argument: the model
 * classifies and bills, the engine prices and pays.
 *
 * Nothing here asks whether a proposal is true. It asks what it costs, and
 * every cost is a thing the world can be interrogated about. That is what
 * removes the argument surface entirely — there is no truth check to lose an
 * argument about, no tier to appeal, no validator that can be talked round.
 *
 * The magnitude formula is the only place a number gets invented, and it is
 * built from four quantities the engine already owns:
 *
 *   R  how hard the requirements are, scored by `requirementWeight`
 *   M  what the inputs are worth and how rare they are
 *   T  how long it takes, which is hours off a floor that is closing
 *   S  the skill it sits under, which the crawler had to earn
 *
 * A proposal cannot raise any of them by claiming anything, because each is
 * debited against something that has to actually exist.
 */

/* ---------------------------------------------------------- the ceiling */

/**
 * The authored table is the ceiling and it is not negotiable.
 *
 * `oxide_charge` is the strongest thing anybody wrote down: alchemy 6, an
 * Ordnance Studio, six units of material and two and a half hours, for power 4
 * with vitals. Nothing minted may exceed it, and the cap is applied last so no
 * combination of generous intermediate scores can walk past it.
 */
export const MAX_POWER = 4;

/** Below this a device cannot go through something, whatever family it is. */
const VITAL_FLOOR = 2;

export interface Priced {
  power: number;
  vital: boolean;
  kind: (typeof FAMILY_KIND)[Family];
  tags: string[];
  weight: number;
  value: number;
  minutes: number;
  /** The four components, kept for the log so a number is never unexplained. */
  parts: { requirements: number; materials: number; time: number; skill: number };
}

/**
 * What a proposal is worth, in the only currency the resolver reads.
 *
 * Every term is sub-linear. Doubling the difficulty of what you claim does not
 * double the result, which means the cheapest way to a strong device is still
 * to actually assemble a strong device rather than to describe one eloquently.
 */
export function price(state: GameState, t: Transform): Priced {
  const R = t.needs.reduce((n, r) => n + requirementWeight(r), 0);

  // Materials score on WORTH, not on count. Three sacks of rubble is not an
  // argument; one flask of ichor is.
  const M = t.inputs.reduce((n, i) => {
    const mat = heldMaterial(state, i.id);
    return n + (mat ? Math.sqrt(mat.value) * Math.min(i.qty, 6) * 0.35 : 0);
  }, 0);

  const hours = t.needs.reduce(
    (n, r) => n + (r.k === "hours" ? r.n : r.k === "heat" ? r.holdHours : 0),
    0,
  );
  const T = Math.min(3, hours * 0.4);

  const S = Math.min(3, skillLevel(state, t.under) * 0.35);

  // Sub-linear in the total, then capped. Reaching MAX_POWER wants roughly what
  // the Oxide Charge wants, which is the intended equivalence.
  const raw = Math.sqrt(Math.max(0, R + M + T + S)) * 1.15;
  const power = Math.max(1, Math.min(MAX_POWER, Math.round(raw)));

  const family = t.family;
  const vital = FAMILY_CAN_BE_VITAL[family] && power >= VITAL_FLOOR;

  return {
    power,
    vital,
    kind: FAMILY_KIND[family],
    // Engine-owned and closed. Whatever the model called the thing never
    // reaches the resolver, so a minted device is defended against by exactly
    // the traits that defend against an authored one.
    tags: [...FAMILY_TAGS[family]],
    weight: Math.max(0.2, Math.round(t.inputs.reduce((n, i) => n + unitWeight(state, i.id) * i.qty, 0) * 0.6 * 10) / 10),
    value: Math.round(30 * power * power + M * 12),
    minutes: Math.max(15, Math.round(20 + R * 22 + hours * 45)),
    parts: {
      requirements: round2(R), materials: round2(M), time: round2(T), skill: round2(S),
    },
  };
}

/* -------------------------------------------------------------- checking */

export interface Verdict {
  ok: boolean;
  /** What is missing, phrased as what would fix it. Never a lecture. */
  missing: string[];
  priced?: Priced;
}

/**
 * Is the world in a state where this could happen.
 *
 * Identical machinery to the offline transformation table — `satisfy` is the
 * same function — which is the point. A proposal is not a second, softer route
 * to the same result; it is the same route reached by a different sentence.
 */
export function judge(state: GameState, node: MapNode, t: Transform): Verdict {
  const missing: string[] = [];
  const cap = capabilityOf(state, node);

  for (const r of t.needs) {
    const gap = satisfy(state, cap, r);
    if (gap) missing.push(gap);
  }
  for (const i of t.inputs) {
    const held = heldUnits(state, i.id);
    if (held < i.qty) {
      const name = heldMaterial(state, i.id)?.name ?? MATERIAL_BY_ID[i.id]?.name ?? i.id;
      missing.push(`${i.qty} ${name.toLowerCase()} — you have ${held}`);
    }
  }
  if (!skillLevel(state, t.under) && !state.skills[t.under]) {
    // Not a refusal. Doing something for the first time is how a skill starts.
    trainSkill(state, t.under, 1);
  }

  return missing.length ? { ok: false, missing } : { ok: true, missing: [], priced: price(state, t) };
}

/* -------------------------------------------------------------- cleaning */

/**
 * Everything a model returned, put through a sieve before anything reads it.
 *
 * A malformed proposal is dropped rather than repaired: half-understanding a
 * device is how you end up with one that has a family nobody wrote a defence
 * for. Prose is sanitised rather than dropped, because the words are the part
 * the model is actually good at.
 */
export function clean(raw: unknown, state: GameState): Proposal | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (o.kind === "decline") {
    return { kind: "decline", note: sanitiseProse(String(o.note ?? "")) || "Not something that can be done here." };
  }

  if (o.kind === "reading") {
    const intent = String(o.intent ?? "").trim().toLowerCase();
    if (!intent || !/^[a-z]{2,16}$/.test(intent)) return null;
    const r: Reading = {
      kind: "reading",
      intent,
      note: sanitiseProse(String(o.note ?? "")) || `Read as ${intent}.`,
    };
    const arg = o.argument === undefined ? undefined : sanitiseProse(String(o.argument), 64);
    return arg ? { ...r, argument: arg } : r;
  }

  if (o.kind !== "transform") return null;

  const family = String(o.family ?? "");
  if (!FAMILIES.includes(family as Family)) return null;

  const under = String(o.under ?? "").trim().toLowerCase();
  if (!/^[a-z_]{3,24}$/.test(under)) return null;

  const inputs: { id: string; qty: number }[] = [];
  for (const item of Array.isArray(o.inputs) ? o.inputs : []) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const id = String(i.id ?? "").trim();
    const qty = Math.round(Number(i.qty));
    // A proposal cannot invent stock. If it is not in the pack, it does not
    // exist, and no amount of describing it makes it exist. An absurd quantity
    // is clamped rather than rejected — a bill for a billion units is somebody
    // being sloppy, and `judge` will refuse it for the real reason a moment
    // later: they do not have twenty either.
    if (!id || !Number.isFinite(qty) || qty < 1) continue;
    if (!heldMaterial(state, id)) continue;
    inputs.push({ id, qty: Math.min(qty, 20) });
  }
  if (!inputs.length) return null;

  const needs: Requirement[] = [];
  for (const item of Array.isArray(o.needs) ? o.needs : []) {
    const r = cleanRequirement(item);
    if (r) needs.push(r);
  }

  const t: Transform = {
    kind: "transform",
    name: sanitiseName(String(o.name ?? ""), "Improvised Device"),
    desc: sanitiseProse(String(o.desc ?? "")) || "Built out of what was to hand.",
    family: family as Family,
    inputs,
    needs,
    under,
    because: sanitiseProse(String(o.because ?? ""), 400) || "It works because of what it is made of.",
  };
  return t;
}

function cleanRequirement(raw: unknown): Requirement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const k = String(r.k ?? "");
  if (!(REQUIREMENT_KINDS as readonly string[]).includes(k)) return null;
  const num = (v: unknown, lo: number, hi: number): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
  };

  switch (k) {
    case "heat": {
      const minC = num(r.minC, 40, 20_000);
      const holdHours = num(r.holdHours, 0, 48);
      return minC === null || holdHours === null ? null : { k: "heat", minC, holdHours };
    }
    case "flame": return { k: "flame" };
    case "current": return { k: "current" };
    case "freezing": return { k: "freezing" };
    case "immersion":
      return ["water", "acid", "alkali", "oil"].includes(String(r.medium))
        ? { k: "immersion", medium: String(r.medium) as "water" | "acid" | "alkali" | "oil" }
        : null;
    case "vessel":
      return ["open", "sealed", "pressure"].includes(String(r.kind))
        ? { k: "vessel", kind: String(r.kind) as "open" | "sealed" | "pressure" }
        : null;
    case "station":
      return ["alchemy", "engineering", "ordnance", "forge"].includes(String(r.id))
        ? { k: "station", id: String(r.id) as "alchemy" | "engineering" | "ordnance" | "forge" }
        : null;
    case "tool":
      return ["edge", "lever", "percussion", "cutting", "fine"].includes(String(r.klass))
        ? { k: "tool", klass: String(r.klass) as "edge" | "lever" | "percussion" | "cutting" | "fine" }
        : null;
    case "skill": {
      const id = String(r.id ?? "").trim().toLowerCase();
      const level = num(r.level, 0, 20);
      return /^[a-z_]{3,24}$/.test(id) && level !== null ? { k: "skill", id, level } : null;
    }
    case "hours": {
      const n = num(r.n, 0, 48);
      return n === null ? null : { k: "hours", n };
    }
    case "ventilation":
      return ["open", "confined"].includes(String(r.kind))
        ? { k: "ventilation", kind: String(r.kind) as "open" | "confined" }
        : null;
    default:
      return null;
  }
}

/* --------------------------------------------------------------- minting */

export interface MintResult {
  ok: boolean;
  reason?: string;
  item?: Item;
  priced?: Priced;
}

/**
 * Turn an approved proposal into a thing in the pack.
 *
 * Note what is copied from the proposal: the name, the description, and the
 * reason. Everything mechanical — kind, power, vital, tags, weight, value,
 * minutes — comes from `price`, which the model never touches.
 */
export function mint(
  state: GameState,
  rng: Rng,
  log: EventLog,
  node: MapNode,
  t: Transform,
): MintResult {
  const verdict = judge(state, node, t);
  if (!verdict.ok) {
    return { ok: false, reason: `That would work. It wants ${verdict.missing.join("; ")}.` };
  }

  const p = verdict.priced!;
  for (const i of t.inputs) spendUnits(state, i.id, i.qty);

  const item: Item = {
    iid: nextIid(rng),
    id: `made_${slug(t.name)}`,
    name: t.name,
    kind: "explosive",
    rarity: p.power >= 4 ? "rare" : p.power >= 3 ? "uncommon" : "common",
    weight: p.weight,
    value: p.value,
    qty: 1,
    tags: ["crafted", "improvised", ...p.tags],
    desc: t.desc,
    equipped: false,
    device: {
      kind: p.kind,
      power: p.power,
      vital: p.vital,
      tags: p.tags,
      note: `${t.because}`,
    },
  };

  state.inventory.push(item);
  trainSkill(state, t.under, 8);
  notePractice(state, "improvising", 1);

  log.push({
    kind: "mint", channel: "loot",
    name: t.name, family: t.family, power: p.power, vital: p.vital,
    from: t.inputs.map((i) => `${i.qty} × ${heldMaterial(state, i.id)?.name ?? i.id}`),
    minutes: p.minutes,
    // Every number, with its derivation, in the log. A minted device that
    // cannot be audited is a minted device nobody should trust.
    working: `power ${p.power} of ${MAX_POWER} — requirements ${p.parts.requirements}, materials ${p.parts.materials}, time ${p.parts.time}, skill ${p.parts.skill}${p.vital ? ". It goes through things." : ""}`,
    because: t.because,
  });

  return { ok: true, item, priced: p };
}

/* ----------------------------------------------------------------- bits */

/**
 * The material behind an id, ONLY if it is actually in the pack.
 *
 * Strictly in the pack, and that strictness is the whole guard: falling back to
 * the catalogue here meant a proposal could bill for a mana shard nobody had,
 * because the shard exists in the world even though it does not exist in the
 * bag. Naming a thing is not having it.
 */
function heldMaterial(state: GameState, id: string) {
  for (const item of state.inventory) {
    if (item.qty <= 0) continue;
    const m = materialOf(item);
    if (m && (m.id === id || m.name.toLowerCase() === id.toLowerCase())) return m;
  }
  return undefined;
}

function unitWeight(state: GameState, id: string): number {
  return heldMaterial(state, id)?.kg ?? 1;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "device";
const round2 = (n: number) => Math.round(n * 100) / 100;

export type { Decline, Proposal, Reading, Transform };
export { isMatTag };
