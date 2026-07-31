import type { GameState, Item, Mod, StatKey, Stats } from "../core/types.ts";
import { clamp } from "../core/util.ts";
import { statusEffects } from "../data/statuses.ts";
import { skillXpToNext } from "../data/skills.ts";

/**
 * Everything derived. The rule here is that no number a player sees is
 * stored — it is computed from base stats plus what they are wearing plus
 * what is wrong with them, every time it is asked for. That means a status
 * effect or a swapped ring is felt on the very next roll with no bookkeeping.
 */

export interface Derived {
  stats: Stats;
  hpMax: number;
  manaMax: number;
  staminaMax: number;
  carry: number;
  armor: number;
  accuracy: number;
  defense: number;
  initiative: number;
  critRange: number;
  damageBonus: number;
  spectacle: number;
  unstable: number;
  reach: number;
  weaponName: string;
  weaponDamage: string;
  twoHanded: boolean;
}

export const xpForLevel = (level: number): number => Math.round(55 * Math.pow(level, 1.55));

export function equippedItems(state: GameState): Item[] {
  return state.inventory.filter((i) => i.equipped);
}

function collectMods(items: readonly Item[]): Mod[] {
  return items.flatMap((i) => i.mods ?? []);
}

function modSum(mods: readonly Mod[], k: Mod["k"], extra?: (m: Mod) => boolean): number {
  return mods
    .filter((m) => m.k === k && (!extra || extra(m)))
    .reduce((s, m) => s + (m as { v: number }).v, 0);
}

/** Skill level including whatever your gear is lending you. */
export function skillLevel(state: GameState, id: string): number {
  const base = state.skills[id]?.level ?? 0;
  const bonus = modSum(collectMods(equippedItems(state)), "skill", (m) =>
    (m as { skill: string }).skill === id);
  return base + bonus;
}

export function carryCapacity(state: GameState): number {
  const str = derive(state).stats.str;
  const lift = skillLevel(state, "clean_lift");
  const bonus = modSum(collectMods(equippedItems(state)), "carry");
  return Math.round(30 * Math.pow(Math.max(1, str) / 4, 1.6) + lift * 8 + bonus);
}

export function carriedWeight(state: GameState): number {
  return Math.round(state.inventory.reduce((s, i) => s + i.weight * i.qty, 0) * 10) / 10;
}

/** The one that matters: can you get this off the ground for two seconds. */
export function canLift(state: GameState, kg: number): boolean {
  return kg <= carryCapacity(state);
}

export function derive(state: GameState): Derived {
  const c = state.crawler;
  const eq = equippedItems(state);
  const mods = collectMods(eq);

  const stats: Stats = { ...c.stats };
  for (const key of ["str", "dex", "con", "int", "cha"] as StatKey[]) {
    stats[key] += modSum(mods, "stat", (m) => (m as { stat: StatKey }).stat === key);
    stats[key] = Math.max(1, stats[key]);
  }

  const st = statusEffects(c.statuses, state.skills["pain_tolerance"]?.level ?? 0);

  // Fatigue and hunger are not flavour. They are a running penalty that gets
  // steadily harder to ignore, which is what makes sleeping — at seven hours
  // off a floor timer — an actual decision rather than an obvious one.
  const fatiguePenalty = c.fatigue > 85 ? 2 : c.fatigue > 60 ? 1 : 0;
  const hungerPenalty = c.hunger > 85 ? 2 : c.hunger > 65 ? 1 : 0;

  const weapon = eq.find((i) => i.kind === "weapon");
  const weaponSkill = weapon ? weaponSkillFor(weapon) : "brawling";
  const wSkill = skillLevel(state, weaponSkill);

  const accuracy =
    Math.floor(stats.dex / 2) +
    modSum(mods, "accuracy") +
    accuracyFromSkill(weaponSkill, wSkill) +
    st.accuracy -
    fatiguePenalty -
    hungerPenalty;

  const defense =
    8 +
    Math.floor(stats.dex / 2) +
    Math.floor(skillLevel(state, "dodge") / 2) +
    Math.floor(skillLevel(state, "shield") / 2) +
    modSum(mods, "defense") +
    st.defense -
    fatiguePenalty;

  const damageBonus =
    Math.floor(stats.str / 2) +
    modSum(mods, "damage") +
    st.damage +
    (weaponSkill === "brawling" ? Math.floor(wSkill / 2) : 0);

  let critRange = 20 - modSum(mods, "crit");
  if (weaponSkill === "blades") {
    if (wSkill >= 12) critRange -= 2;
    else if (wSkill >= 6) critRange -= 1;
  }

  return {
    stats,
    hpMax: Math.round(30 + stats.con * 8 + c.level * 6 + modSum(mods, "hp")),
    manaMax: Math.max(0, stats.int), // canon: the pool is Intelligence, one for one
    staminaMax: Math.round(40 + stats.con * 2 + stats.str * 2),
    carry: Math.round(30 * Math.pow(Math.max(1, stats.str) / 4, 1.6) + skillLevel(state, "clean_lift") * 8 + modSum(mods, "carry")),
    armor: Math.max(0, modSum(mods, "armor")),
    accuracy,
    defense,
    initiative: stats.dex + modSum(mods, "initiative"),
    critRange: clamp(critRange, 14, 20),
    damageBonus,
    spectacle: 1 + modSum(mods, "spectacle") + skillLevel(state, "performance") * 0.05,
    unstable: modSum(mods, "unstable"),
    reach: weapon?.reach ?? 1,
    weaponName: weapon?.name ?? "your bare hands",
    weaponDamage: weapon?.damage ?? "1d3",
    twoHanded: weapon?.twoHanded ?? false,
  };
}

export function weaponSkillFor(item: Item): string {
  if (item.tags.includes("unarmed") || item.tags.includes("brawl")) return "brawling";
  if (item.tags.includes("ranged")) return item.tags.includes("thrown") ? "throwing" : "marksmanship";
  if (item.tags.includes("polearm")) return "polearm";
  if (item.tags.includes("blades")) return "blades";
  if (item.tags.includes("bludgeon")) return "bludgeon";
  return "brawling";
}

function accuracyFromSkill(skill: string, level: number): number {
  switch (skill) {
    case "brawling":
      return Math.floor(level / 2);
    case "blades":
    case "bludgeon":
    case "polearm":
      return level;
    case "marksmanship":
    case "throwing":
      return Math.floor(level * 0.75);
    default:
      return 0;
  }
}

/* ------------------------------------------------------------ progression */

export interface LevelResult {
  levels: number;
  pointsGained: number;
  banked: boolean;
}

/**
 * Three points a level.
 *
 * Once you have a race and a class they are yours to place. Before that — the
 * whole of the first two floors — you cannot spend them, and this is where the
 * previous design left the crawler flat for a third of the run. So two of the
 * three *drift*: they land somewhere on their own, biased toward whatever you
 * have actually been doing, and the third is banked for the third floor.
 *
 * You still grow. You simply do not get a say in it yet, which is both more
 * playable and considerably more in character.
 */
export function grantXp(state: GameState, amount: number, drift?: () => number): LevelResult {
  const c = state.crawler;
  c.xp += amount;
  let levels = 0;
  let points = 0;
  while (c.xp >= xpForLevel(c.level)) {
    c.xp -= xpForLevel(c.level);
    c.level++;
    levels++;
    points += 3;
  }
  if (levels > 0) {
    if (c.race && c.klass) {
      c.points += points;
    } else {
      c.banked += levels; // one a level held back for the third floor
      const drifting = points - levels;
      const roll = drift ?? (() => Math.floor(Math.random() * 5));
      const order = driftWeights(state);
      for (let i = 0; i < drifting; i++) {
        const key = order[roll() % order.length]!;
        c.stats[key]++;
      }
    }
    const d = derive(state);
    c.hpMax = d.hpMax;
    c.hp = Math.min(c.hpMax, c.hp + levels * 12);
    c.manaMax = d.manaMax;
  }
  return { levels, pointsGained: points, banked: !(c.race && c.klass) };
}

/**
 * The drift is not uniform. It leans toward what the crawler has been doing,
 * which is why two people who walked in identical do not walk out identical.
 * Constitution is always in the pool because staying alive is always relevant.
 */
function driftWeights(state: GameState): StatKey[] {
  const pool: StatKey[] = ["con", "con", "str", "dex", "int", "cha"];
  const lvl = (id: string) => state.skills[id]?.level ?? 0;
  if (lvl("brawling") + lvl("bludgeon") + lvl("clean_lift") >= 4) pool.push("str", "str");
  if (lvl("blades") + lvl("dodge") + lvl("stealth") + lvl("marksmanship") >= 4) pool.push("dex", "dex");
  if (lvl("demolitions") + lvl("electrical") + lvl("engineering") + lvl("alchemy") >= 4) pool.push("int", "int");
  if (lvl("negotiation") + lvl("intimidation") + lvl("performance") >= 4) pool.push("cha", "cha");
  if (lvl("pain_tolerance") + lvl("field_dressing") >= 4) pool.push("con", "con");
  return pool;
}

/** Use-based skill growth. Returns the new level if it moved. */
export function trainSkill(state: GameState, id: string, xp = 1): number | null {
  const cap = state.crawler.skillCap;
  const cur = state.skills[id] ?? { level: 0, xp: 0 };
  if (cur.level >= cap) return null;
  cur.xp += xp;
  let raised: number | null = null;
  while (cur.level < cap && cur.xp >= skillXpToNext(cur.level)) {
    cur.xp -= skillXpToNext(cur.level);
    cur.level++;
    raised = cur.level;
  }
  state.skills[id] = cur;
  return raised;
}

/* ------------------------------------------------------------- the body */

/** Out of combat only. Constitution is the dial and it is a steep one. */
export function regenPerHour(state: GameState): { hp: number; mana: number; stamina: number } {
  const d = derive(state);
  const fed = state.crawler.statuses.some((s) => s.id === "well_fed") ? 1.35 : 1;
  return {
    hp: d.hpMax * clamp(0.06 + d.stats.con * 0.05, 0.06, 0.9) * fed,
    mana: clamp(d.stats.int * 3.6, 1, 240) / 60,
    stamina: 45,
  };
}
