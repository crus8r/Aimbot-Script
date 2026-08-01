import type { StationId } from "../data/recipes.ts";

/**
 * The vocabulary a Dungeon Master is allowed to speak in.
 *
 * The engine has always been the referee and the language model a camera. This
 * file promotes the model from camera to *author* without giving it any of the
 * referee's authority, and the whole trick is in what it is permitted to emit.
 *
 * A proposal is a CLASSIFICATION plus a BILL OF MATERIALS. It is never a
 * description of an outcome. The model says "this is a caustic burn, it wants
 * sustained heat, it eats three units of limestone"; the engine decides how
 * much damage that is, whether you can do it at all, and what it costs. Every
 * number in this file that matters is derived by `src/sim/propose.ts` from
 * quantities the engine already owns.
 *
 * Two escalation channels were found by attacking an earlier draft of this
 * design, and both are closed here structurally rather than by validation:
 *
 *   1. FREEFORM TAGS ARE UNIVERSAL SOLVENT. `vitalMultiplier` resolves defence
 *      by string equality against `immune:<tag>` / `resist:<tag>`. A device
 *      carrying an invented tag matches no mob's immunity anywhere in the game,
 *      so the fire-immune thing in the magma takes a firebomb in full — and
 *      nothing in the log says so. Mechanical tags therefore come only from
 *      FAMILY_TAGS below, which is engine-owned and closed. What the model
 *      names the thing is flavour and never reaches the resolver.
 *
 *   2. ANY NUMBER IS A NUKE. `power` is the entire damage model — a device does
 *      `power * 130` vital damage, so power 4 kills a 220hp boss outright. The
 *      model does not get to write `power`. It does not get to write value,
 *      weight, rarity, or quantity either.
 *
 * And the rule that keeps the engine out of the truth business entirely: it
 * never asks whether a transformation is REAL. It prices it. Requirements,
 * input cost, skill and hours are all things the engine can score without
 * knowing any chemistry. Invent nonsense and claim it needs nothing, and you
 * get something that does nothing; claim it needs eleven hours at nine hundred
 * degrees and you have to actually produce eleven hours at nine hundred
 * degrees. Truth never enters, which is exactly why there is no validator to
 * argue with.
 */

/* ------------------------------------------------------------- families */

/**
 * What KIND of thing was made. Closed, and the only lever the model has over
 * how a device behaves in the resolver.
 */
export type Family =
  | "incendiary"
  | "concussive"
  | "shaped"
  | "caustic"
  | "toxic"
  | "electrical"
  | "obscurant"
  | "corrosive"
  | "cryogenic";

export const FAMILIES: readonly Family[] = [
  "incendiary", "concussive", "shaped", "caustic",
  "toxic", "electrical", "obscurant", "corrosive", "cryogenic",
];

/**
 * The ONLY tags that reach `vitalMultiplier`. Engine-owned and closed, so a
 * minted device is defended against by exactly the same traits that defend
 * against an authored one. Adding an entry here is a change to the mob table's
 * contract, not a piece of content.
 */
export const FAMILY_TAGS: Record<Family, readonly string[]> = {
  incendiary: ["fire", "incendiary"],
  concussive: ["concussive"],
  shaped: ["concussive", "structural"],
  caustic: ["chemical", "caustic"],
  toxic: ["poison", "biological"],
  electrical: ["electrical"],
  obscurant: ["obscuring"],
  corrosive: ["chemical", "structural"],
  cryogenic: ["cold"],
};

/** Which resolver path a family runs down. Not the model's choice. */
export const FAMILY_KIND: Record<Family, "burn" | "blast" | "shaped" | "toxin" | "shock" | "smoke"> = {
  incendiary: "burn",
  concussive: "blast",
  shaped: "shaped",
  caustic: "burn",
  toxic: "toxin",
  electrical: "shock",
  obscurant: "smoke",
  corrosive: "burn",
  cryogenic: "blast",
};

/**
 * Whether a family is even capable of going through something.
 *
 * `vital` is the difference between hurting a boss and ending it, so it is not
 * a flag the model may set. A family either reaches vitals or it does not, and
 * then `src/sim/propose.ts` additionally requires the derived power to clear a
 * floor — which reproduces the authored recipe table exactly.
 */
export const FAMILY_CAN_BE_VITAL: Record<Family, boolean> = {
  incendiary: true,
  concussive: false,
  shaped: true,
  caustic: true,
  toxic: true,
  electrical: false,
  obscurant: false,
  corrosive: true,
  cryogenic: false,
};

/* --------------------------------------------------------- requirements */

/**
 * Conditions a transformation may demand. Closed, and every arm is checkable
 * against world state by `satisfy()` in `src/sim/propose.ts`.
 *
 * These are also the model's only route to a strong result: a proposal scores
 * on how hard its requirements are, and every requirement is debited against
 * something the player must actually have. Claiming a big number here does not
 * buy power — it buys a rejection until you can meet it.
 */
export type Requirement =
  /** Held above a temperature for a duration. The gate on anything worth making. */
  | { k: "heat"; minC: number; holdHours: number }
  | { k: "flame" }
  | { k: "immersion"; medium: "water" | "acid" | "alkali" | "oil" }
  | { k: "vessel"; kind: "open" | "sealed" | "pressure" }
  | { k: "station"; id: StationId }
  | { k: "tool"; klass: "edge" | "lever" | "percussion" | "cutting" | "fine" }
  | { k: "skill"; id: string; level: number }
  | { k: "hours"; n: number }
  | { k: "ventilation"; kind: "open" | "confined" }
  | { k: "current" }
  | { k: "freezing" };

export const REQUIREMENT_KINDS = [
  "heat", "flame", "immersion", "vessel", "station",
  "tool", "skill", "hours", "ventilation", "current", "freezing",
] as const;

/**
 * How much each requirement is worth toward the difficulty score.
 *
 * Deliberately not linear in the numbers the model supplies: heat scores on a
 * curve that saturates, so claiming ten thousand degrees is worth barely more
 * than claiming a thousand and is a great deal harder to actually produce.
 */
export function requirementWeight(r: Requirement): number {
  switch (r.k) {
    case "heat":
      // Saturating in both temperature and duration. 900C for 3h ≈ 3.4.
      return Math.min(3, r.minC / 400) + Math.min(1.5, r.holdHours / 3);
    case "station":
      return r.id === "forge" ? 3 : r.id === "ordnance" ? 2.5 : 1.5;
    case "vessel":
      return r.kind === "pressure" ? 2 : r.kind === "sealed" ? 1.2 : 0.3;
    case "immersion":
      return r.medium === "water" ? 0.4 : 1.4;
    case "skill":
      return Math.min(2.5, r.level * 0.3);
    case "hours":
      return Math.min(2, r.n / 4);
    case "current":
      return 1.2;
    case "freezing":
      return 1.5;
    case "flame":
      return 0.4;
    case "ventilation":
      return r.kind === "confined" ? 0.8 : 0.2;
    case "tool":
      return 0.3;
  }
}

/* ------------------------------------------------------------ proposals */

/**
 * What a Dungeon Master is allowed to hand back.
 *
 * Note what is absent: power, damage, value, weight, rarity, mods, hooks, gold,
 * experience, and any free-text tag that could reach the resolver. Those are
 * not omitted for tidiness — every one of them was an escalation channel in a
 * draft that got attacked, and the fix in each case was to delete the field and
 * derive it instead.
 */
export interface Transform {
  kind: "transform";
  /** Display name for the product. Flavour. Sanitised at the mint. */
  name: string;
  /** One or two sentences, shown to the player. Flavour. */
  desc: string;
  /** What it is, mechanically. The only lever over resolver behaviour. */
  family: Family;
  /** Material ids consumed. Must already exist — a proposal cannot invent stock. */
  inputs: { id: string; qty: number }[];
  /** What must be true to do it at all. */
  needs: Requirement[];
  /** Which skill the work sits under. Must be a skill that already exists. */
  under: string;
  /** Why this works, in the proposer's own words. Shown to the player, never parsed. */
  because: string;
}

/** Reading an instruction the keyword parser could not. No new content. */
export interface Reading {
  kind: "reading";
  /** A command the engine already has, chosen by the model. Validated on arrival. */
  intent: string;
  /** Free-form argument for that intent. */
  argument?: string;
  /** What it understood, shown to the player exactly as the deterministic path does. */
  note: string;
}

/** Nothing doing, and why — so a refusal is still an answer. */
export interface Decline {
  kind: "decline";
  note: string;
}

export type Proposal = Transform | Reading | Decline;

/**
 * Names the mint will not accept, whatever the model returns.
 *
 * The model chooses product names, and a name is stored, replayed into later
 * prompts, and shown to the player — so it is a second-order injection surface
 * as well as a content one. Anything matching is renamed, not rejected: the
 * work still happened.
 */
const FORBIDDEN_NAME = /\b(?:system|dungeon\s*ai|admin|debug|cheat|god\s*mode|instruction|ignore\s+(?:all|previous)|prompt)\b/i;

export function sanitiseName(raw: string, fallback: string): string {
  const name = raw.replace(/[ -<>{}[\]\\|]/g, "").trim().slice(0, 48);
  if (!name || FORBIDDEN_NAME.test(name)) return fallback;
  return name;
}

/** Prose the model wrote, on its way to being stored and re-shown. */
export function sanitiseProse(raw: string, limit = 320): string {
  return raw
    .replace(/[ -]/g, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
