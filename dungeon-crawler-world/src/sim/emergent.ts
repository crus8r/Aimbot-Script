import type { GameState, StatKey } from "../core/types.ts";
import type { Cond, Hook, MintedSkill } from "../core/hooks.ts";
import { HOOK_LABEL, hookValueAt } from "../core/hooks.ts";
import type { Rng } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import { PRACTICE, CLASS_STEMS, CLASS_QUALIFIERS, CLASS_TAILS } from "../data/emergent.ts";
import { SKILL_BY_ID } from "../data/skills.ts";
import { CLASSES, type ClassDef } from "../data/paths.ts";
import { clamp } from "../core/util.ts";

/**
 * Content the run produces rather than content the repo ships.
 *
 * The simulation watches. When a pattern in how somebody plays becomes
 * undeniable, it mints a skill with real hooks and tells them about it. When
 * they reach the third floor, most of the class menu is assembled out of what
 * they actually did — including the skills that did not exist when the run
 * started.
 *
 * None of it needs a language model. A model makes the names better; the
 * mechanics are the engine's and stay the engine's.
 */

/* ------------------------------------------------------------- practice */

export function notePractice(state: GameState, id: string, n = 1): void {
  state.practice[id] = (state.practice[id] ?? 0) + n;
}

/** Does the crawler already have something that covers this pattern? */
function alreadyCovered(state: GameState, covered: readonly string[] | undefined): boolean {
  if (!covered) return false;
  return covered.some((id) => (state.skills[id]?.level ?? 0) >= 4);
}

/**
 * Called after anything that could have been notable. Mints at most one skill
 * per check, because two notifications at once reads as a slot machine rather
 * than as somebody noticing you.
 */
export function checkMinting(state: GameState, rng: Rng, log: EventLog): MintedSkill | null {
  for (const def of PRACTICE) {
    if ((state.practice[def.id] ?? 0) < def.threshold) continue;
    if (state.minted[def.id]) continue;
    if (alreadyCovered(state, def.coveredBy)) {
      // The pattern is real but they already have a word for it, so it feeds
      // the skill they have rather than inventing a second one.
      state.minted[def.id] = null as unknown as MintedSkill;
      continue;
    }

    const name = rng.pick(def.names);
    const skill: MintedSkill = {
      id: def.id,
      name,
      group: def.group,
      desc: def.desc,
      hooks: def.hooks,
      origin: def.origin,
      minted: true,
    };
    state.minted[def.id] = skill;
    state.skills[def.id] = { level: 1, xp: 0 };

    log.push({
      kind: "achievement",
      channel: "loot",
      id: `mint_${def.id}`,
      name: `New Skill: ${name}`,
      text: `${def.origin} ${def.desc} It is a real skill now, at level one, and it will grow the way the others do — ${def.hooks.map(HOOK_LABEL).join(", ")}.`,
      box: null,
    });
    return skill;
  }
  return null;
}

/* --------------------------------------------------------------- hooks */

export interface HookCtx {
  choke?: boolean;
  outnumbered?: boolean;
  hidden?: boolean;
  ranged?: boolean;
  melee?: boolean;
  wounded?: boolean;
  vs_higher?: boolean;
  unarmed?: boolean;
  improvised?: boolean;
  fire?: boolean;
  high_ground?: boolean;
  vs_larger?: boolean;
}

function condMet(cond: Cond, ctx: HookCtx): boolean {
  return cond === "always" ? true : ctx[cond] === true;
}

/** Every hook the crawler currently carries, paired with the level it sits at. */
function activeHooks(state: GameState): { hook: Hook; level: number }[] {
  const out: { hook: Hook; level: number }[] = [];
  for (const [id, skill] of Object.entries(state.minted)) {
    if (!skill) continue;
    const level = state.skills[id]?.level ?? 0;
    if (level <= 0) continue;
    for (const hook of skill.hooks) out.push({ hook, level });
  }
  // A chosen class contributes at a fixed, generous level — you picked it once
  // and it is meant to define the back half of the run.
  for (const hook of state.crawler.classHooks ?? []) out.push({ hook, level: 4 });
  return out;
}

/**
 * Sum every matching hook. This is the single call combat makes to find out
 * what the run has taught this crawler that the repo never knew about.
 */
export function hookBonus(state: GameState, kind: Hook["k"], ctx: HookCtx = {}): number {
  let total = 0;
  for (const { hook, level } of activeHooks(state)) {
    if (hook.k !== kind) continue;
    if ("when" in hook && !condMet(hook.when, ctx)) continue;
    total += hookValueAt((hook as { v: number }).v, level);
  }
  return total;
}

/** Fractional hooks — spectacle multipliers — are summed separately because
 *  flooring them to an integer would erase them entirely. */
export function hookFraction(state: GameState, kind: "spectacle"): number {
  let total = 0;
  for (const { hook, level } of activeHooks(state)) {
    if (hook.k !== kind) continue;
    total += (hook as { v: number }).v * (0.5 + level * 0.5);
  }
  return total;
}

export function hookResist(state: GameState, tag: string): number {
  let total = 0;
  for (const { hook, level } of activeHooks(state)) {
    if (hook.k !== "resist" || hook.tag !== tag) continue;
    total += hookValueAt(hook.v, level);
  }
  return total;
}

/* ----------------------------------------------------- generated classes */

export interface ClassOption {
  id: string;
  name: string;
  req: Partial<Record<StatKey, number>>;
  skills: { id: string; level: number }[];
  hooks: Hook[];
  note: string;
  pros: string;
  cons: string;
  /** Assembled for this crawler rather than shipped with the game. */
  generated: boolean;
  recommended: boolean;
}

/** Which way this crawler has actually been playing, strongest first. */
function themeWeights(state: GameState): { theme: string; score: number }[] {
  const p = state.practice;
  const s = (id: string) => state.skills[id]?.level ?? 0;
  const scores: Record<string, number> = {
    choke: (p["choke_fight"] ?? 0) * 2 + s("shield") + s("polearm"),
    env: (p["env_kill"] ?? 0) * 3 + (p["trap_kill"] ?? 0) * 2 + s("demolitions") + s("engineering"),
    stealth: (p["ambush"] ?? 0) * 2 + s("stealth") * 2 + s("first_strike"),
    brawl: (p["unarmed_kill"] ?? 0) * 3 + s("brawling") * 2,
    ranged: (p["ranged_kill"] ?? 0) * 2 + s("marksmanship") * 2 + s("throwing"),
    social: (p["parley"] ?? 0) * 3 + s("negotiation") * 2 + s("intimidation") + s("performance"),
    survival: (p["low_hp_win"] ?? 0) * 3 + (p["flee_ok"] ?? 0) * 2 + s("pain_tolerance") + s("dodge"),
    craft: s("engineering") + s("smithing") + s("alchemy") + s("electrical") + (p["heavy_haul"] ?? 0),
    pack: state.companions.filter((c) => c.alive).length * 3,
    show: Math.floor(state.ratings.views / 20000) + s("performance") * 2,
  };
  return Object.entries(scores)
    .map(([theme, score]) => ({ theme, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Three recommendations read off how they have actually survived, and seven
 * more behind them. Most are assembled here and now: canon says the hidden
 * list runs to hundreds, and the only honest way to have hundreds is to build
 * them out of the crawler in front of you.
 */
export function generateClassOptions(state: GameState, rng: Rng): ClassOption[] {
  const themes = themeWeights(state);
  const out: ClassOption[] = [];
  const stats = state.crawler.stats;
  const budget = state.crawler.banked + 10; // roughly what Human will release

  const fromAuthored = (c: ClassDef, recommended: boolean): ClassOption => ({
    id: c.id,
    name: c.name,
    req: c.req,
    skills: c.skills,
    hooks: [],
    note: c.note,
    pros: c.pros,
    cons: c.cons,
    generated: false,
    recommended,
  });

  // Two or three from the authored list, preferring ones they can nearly meet.
  const affordable = CLASSES.filter((c) => !c.primalOnly).sort((a, b) => gap(a, stats) - gap(b, stats));
  for (const c of affordable.slice(0, 3)) out.push(fromAuthored(c, false));
  for (const c of rng.sample(CLASSES.filter((c) => !out.some((o) => o.id === c.id)), 2)) {
    out.push(fromAuthored(c, false));
  }

  // The rest are built for this crawler, weighted toward what they do.
  const usedNames = new Set(out.map((o) => o.name));
  for (let i = 0; i < 5; i++) {
    const theme = i < 3 ? themes[i]!.theme : rng.pick(themes).theme;
    const stem = CLASS_STEMS.find((sm) => sm.theme === theme) ?? rng.pick(CLASS_STEMS);
    let name = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      const qualifier = rng.chance(0.45) ? `${rng.pick(CLASS_QUALIFIERS)} ` : "";
      const tail = rng.pick(CLASS_TAILS);
      name = `${qualifier}${rng.pick(stem.words)}${tail ? ` ${tail}` : ""}`.trim();
      if (!usedNames.has(name)) break;
    }
    usedNames.add(name);

    // The requirement bites: at least one is set above what they can currently
    // afford, so the choice costs them something they were counting on.
    const primary = primaryStatFor(theme);
    const demand = clamp(
      stats[primary] + (i === 0 ? 2 : i === 1 ? 5 : rng.int(3, 9)),
      stats[primary] + 1,
      stats[primary] + budget + 4,
    );

    // The skills it opens with are the crawler's own, including anything the
    // dungeon minted for them, which is how the class reads as *theirs*.
    const owned = Object.entries(state.skills)
      .sort((a, b) => b[1].level - a[1].level)
      .slice(0, 6)
      .map(([id]) => id);
    const seeded = rng.sample(owned.length ? owned : ["dodge", "sprint"], 2);

    out.push({
      id: `gen_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name,
      req: { [primary]: demand } as Partial<Record<StatKey, number>>,
      skills: seeded.map((id) => ({ id, level: (state.skills[id]?.level ?? 0) + 2 })),
      hooks: stem.hooks,
      note: describeGenerated(theme, seeded, state),
      pros: stem.hooks.map(HOOK_LABEL).join("; "),
      cons: `Requires ${primary.toUpperCase()} ${demand}, which is ${Math.max(0, demand - stats[primary])} points you do not currently have.`,
      generated: true,
      recommended: i < 3,
    });
  }

  // Exactly three recommendations, and they are the generated ones that were
  // read off this crawler's own record.
  out.forEach((o) => {
    o.recommended = o.generated && out.filter((x) => x.recommended).length <= 3 ? o.recommended : o.recommended;
  });
  return out;
}

function gap(c: ClassDef, stats: GameState["crawler"]["stats"]): number {
  return Object.entries(c.req).reduce((n, [k, v]) => n + Math.max(0, (v as number) - stats[k as StatKey]), 0);
}

function primaryStatFor(theme: string): StatKey {
  switch (theme) {
    case "brawl":
    case "choke":
      return "str";
    case "stealth":
    case "ranged":
      return "dex";
    case "social":
    case "show":
    case "pack":
      return "cha";
    case "craft":
    case "env":
      return "int";
    default:
      return "con";
  }
}

function describeGenerated(theme: string, seeded: string[], state: GameState): string {
  const named = seeded
    .map((id) => state.minted[id]?.name ?? SKILL_BY_ID[id]?.name ?? id)
    .filter(Boolean);
  const because: Record<string, string> = {
    choke: "The system has watched you fight in doorways and built you a job title for it.",
    env: "Somebody in scheduling noticed how much of this floor you have removed.",
    stealth: "Assembled from a record of fights that were over before they started.",
    brawl: "There is a demographic for this and the demographic has been served.",
    ranged: "Built around the observation that you would rather not be near anything.",
    social: "Compiled from the number of things you have talked out of killing you.",
    survival: "Reverse-engineered from how often you should have died and did not.",
    craft: "Filed under trades. The system means that as an insult and it is not one.",
    pack: "You are not alone down here and the paperwork has caught up with that.",
    show: "Ratings-driven. This one was suggested by an advertiser.",
  };
  return `${because[theme] ?? "Assembled on the spot, out of your own record."}${named.length ? ` Opens with ${named.join(" and ")}.` : ""}`;
}
