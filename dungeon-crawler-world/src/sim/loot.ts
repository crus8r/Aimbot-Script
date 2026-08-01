import type { Item, Rarity } from "../core/types.ts";
import { RARITIES } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import {
  GENERATED_BASES,
  ITEMS,
  ITEM_BY_ID,
  PREFIXES,
  SUFFIXES,
  type Affix,
  type ItemTemplate,
} from "../data/items.ts";
import { BOX_BY_ID, TIER_BIAS, TIER_TABLE, type Tier } from "../data/boxes.ts";
import { clamp } from "../core/util.ts";

/**
 * Instance ids come out of the same stream that decided the item exists, so a
 * floor generated twice from one seed is byte-identical. Nothing rolls against
 * an iid — this is purely so that "same seed, same save" is literally true and
 * a replay can be diffed.
 */
let counter = 0;
export const nextIid = (rng?: Rng): string =>
  rng ? `i${Math.floor(rng.next() * 0xffffffff).toString(36)}` : `i${(++counter).toString(36)}`;

export function instantiate(t: ItemTemplate, qty = 1, rng?: Rng): Item {
  return { ...structuredClone(t), iid: nextIid(rng), qty, equipped: false };
}

export function fromId(id: string, qty = 1, rng?: Rng): Item {
  const t = ITEM_BY_ID[id];
  if (!t) throw new Error(`unknown item id: ${id}`);
  return instantiate(t, qty, rng);
}

/* --------------------------------------------------------------- rarity */

export function rollRarity(rng: Rng, weights: Partial<Record<Rarity, number>>, lucky = false): Rarity {
  const entries = RARITIES.map((r) => [r, weights[r] ?? 0] as const).filter(([, w]) => w > 0);
  const one = () => rng.weighted(entries);
  if (!lucky) return one();
  const a = one();
  const b = one();
  return RARITIES.indexOf(a) >= RARITIES.indexOf(b) ? a : b;
}

/** Floor-appropriate rarity when nothing else specifies one. */
function ambientRarity(rng: Rng, floor: number, quality: number): Rarity {
  const w: Partial<Record<Rarity, number>> = {
    junk: Math.max(2, 40 - floor * 4 - quality * 14),
    common: 40,
    uncommon: 12 + floor * 3 + quality * 12,
    rare: Math.max(0, floor * 1.4 - 1 + quality * 8),
    epic: Math.max(0, floor - 3 + quality * 2),
  };
  return rollRarity(rng, w);
}

/* ------------------------------------------------------------ generation */

export interface MakeOpts {
  floor: number;
  /** 0 ordinary, 1 better than ordinary, 2 vault-grade. */
  quality?: number;
  rarity?: Rarity;
  /** Bias toward these tags when picking from the catalogue. */
  prefer?: string[];
  /** Force a generated (affixed) item rather than a catalogue entry. */
  bespoke?: boolean;
}

/**
 * Two ways an item comes into existence, and the split is deliberate.
 *
 * The catalogue supplies the things the world is made of — a crowbar is a
 * crowbar and has been since the first floor. The generator supplies the
 * things the dungeon *made for you*, and those are real: a prefix and a
 * suffix each carry modifiers the combat resolver reads, so a Serrated Glaive
 * of Bad Ideas is mechanically a different weapon from the one in your hands,
 * not a different noun.
 */
export function makeItem(rng: Rng, opts: MakeOpts): Item {
  const rarity = opts.rarity ?? ambientRarity(rng, opts.floor, opts.quality ?? 0);
  const wantBespoke =
    opts.bespoke ?? rng.chance(clamp(RARITIES.indexOf(rarity) * 0.16 - 0.05, 0, 0.75));

  if (!wantBespoke) {
    const catalogue = pickCatalogue(rng, rarity, opts.prefer);
    if (catalogue) return instantiate(catalogue, rollQty(rng, catalogue, rarity), rng);
  }
  return generate(rng, rarity, opts.prefer);
}

function pickCatalogue(rng: Rng, rarity: Rarity, prefer?: string[]): ItemTemplate | null {
  // Exact rarity or nothing. Walking down to the next band that happens to
  // exist is how a Celestial box quietly hands somebody a rare item: the
  // catalogue holds nothing above rare, so everything epic and up must be
  // generated. Returning null here is what routes it to the generator.
  let pool = ITEMS.filter((i) => i.rarity === rarity);
  if (!pool.length) return null;
  if (prefer?.length) {
    const biased = pool.filter((i) => i.tags.some((t) => prefer.includes(t)));
    if (biased.length) pool = biased;
  }
  return rng.pick(pool);
}

function rollQty(rng: Rng, t: ItemTemplate, rarity: Rarity): number {
  const stacky = ["potion", "food", "material", "explosive"].includes(t.kind) || rarity === "junk";
  return stacky ? rng.int(1, rarity === "junk" ? 3 : 2) : 1;
}

function affixCount(rarity: Rarity): number {
  switch (rarity) {
    case "junk":
      return 0;
    case "common":
      return 1;
    case "uncommon":
      return 1;
    case "rare":
      return 2;
    case "epic":
      return 2;
    case "legendary":
      return 2;
    case "celestial":
      return 2;
  }
}

function generate(rng: Rng, rarity: Rarity, prefer?: string[]): Item {
  let bases = GENERATED_BASES.slice();
  if (prefer?.length) {
    const biased = bases.filter((b) => b.tags.some((t) => prefer.includes(t)));
    if (biased.length) bases = biased;
  }
  const base = rng.pick(bases);
  const tierIndex = RARITIES.indexOf(rarity);

  const eligible = (list: readonly Affix[]) =>
    list.filter(
      (a) =>
        a.on.includes(base.kind) &&
        RARITIES.indexOf(a.minRarity) <= tierIndex &&
        // Do not staple a legendary affix onto a common stick.
        RARITIES.indexOf(a.minRarity) >= tierIndex - 2,
    );

  const wanted = affixCount(rarity);
  const prefixPool = eligible(PREFIXES);
  const suffixPool = eligible(SUFFIXES);

  let prefix: Affix | null = null;
  let suffix: Affix | null = null;
  if (wanted >= 1) {
    if (prefixPool.length && (!suffixPool.length || rng.chance(0.5))) prefix = rng.pick(prefixPool);
    else if (suffixPool.length) suffix = rng.pick(suffixPool);
  }
  if (wanted >= 2) {
    if (!prefix && prefixPool.length) prefix = rng.pick(prefixPool);
    else if (!suffix && suffixPool.length) suffix = rng.pick(suffixPool);
  }

  const name = [prefix?.name, base.name, suffix?.name].filter(Boolean).join(" ");
  const mods = [...(prefix?.mods ?? []), ...(suffix?.mods ?? [])];
  if (base.armor) mods.unshift({ k: "armor", v: base.armor });

  // Rarity itself is worth raw numbers, so an epic with dull affixes still
  // outperforms an uncommon with good ones.
  const bump = Math.max(0, tierIndex - 2);
  if (bump > 0) {
    if (base.kind === "weapon") mods.push({ k: "damage", v: bump }, { k: "accuracy", v: Math.ceil(bump / 2) });
    else mods.push({ k: "armor", v: Math.ceil(bump / 2) }, { k: "defense", v: Math.ceil(bump / 2) });
  }

  const notes = [prefix?.note, suffix?.note].filter(Boolean) as string[];
  const desc =
    notes.length > 0
      ? notes.join(" ")
      : "It is what it looks like, which around here counts as a warning.";

  const value = Math.round(
    (20 + (prefix?.value ?? 0) + (suffix?.value ?? 0)) * (1 + tierIndex * 0.6),
  );

  return {
    iid: nextIid(rng),
    id: `${base.id}_${prefix?.id ?? "x"}_${suffix?.id ?? "x"}`,
    name,
    kind: base.kind,
    rarity,
    slot: base.slot,
    weight: base.weight,
    value: Math.max(1, value),
    qty: 1,
    tags: [...base.tags, "generated"],
    desc,
    mods,
    damage: base.damage,
    reach: base.reach ?? 1,
    generated: true,
  };
}

/* --------------------------------------------------------------- boxes */

export interface BoxResult {
  items: Item[];
  gold: number;
}

/**
 * Enough about this specific crawler to make a piece of loot theirs.
 *
 * "Sometimes tailored" is the ask and it is the right one: a box that is
 * always procedural feels like a slot machine, and a box that is always
 * hand-authored runs out. So most lines come off the tables, some are
 * generated, and a few — only at real rarities — are made *for you*, and say
 * so in the description.
 */
export interface TailorCtx {
  name: string;
  job: string;
  lastBoss?: string;
  mintedSkill?: string;
  floor: number;
}

const TAILORED = [
  (t: TailorCtx) => `Stamped, in small letters, with your crawler number. Somebody in fabrication read your file and had opinions about it.`,
  (t: TailorCtx) => `The grip has been rewrapped for a hand the size of yours. Nobody measured you. Nobody had to.`,
  (t: TailorCtx) => `Sized for somebody who ${t.job.toLowerCase()} for a living, which the system finds funnier than you do.`,
  (t: TailorCtx) => `Made from ${t.lastBoss ? `what was left of ${t.lastBoss}` : "something that died on this floor recently"}. It is still slightly warm and the system would like you to notice that.`,
  (t: TailorCtx) => `Built around ${t.mintedSkill ? `the way you have been fighting — the thing they are calling ${t.mintedSkill}` : "the way you have been fighting"}. The audience voted on the shape.`,
  (t: TailorCtx) => `There is a production note attached. It reads: "for the one who keeps doing that". It does not elaborate.`,
];

/** Some proportion of what a good box holds was made for the person opening
 *  it. Never at low rarity — a tailored piece of junk is just a joke. */
function tailor(rng: Rng, item: Item, ctx: TailorCtx): Item {
  if (RARITIES.indexOf(item.rarity) < RARITIES.indexOf("rare")) return item;
  if (!rng.chance(0.4)) return item;
  const note = rng.pick(TAILORED)(ctx);
  return {
    ...item,
    name: rng.chance(0.5) ? `${item.name}, Fitted` : item.name,
    desc: `${item.desc} ${note}`,
    tags: [...item.tags, "tailored"],
  };
}

/**
 * Opening a box is two decisions, and the player makes neither. The engine
 * rolls the shape — how many lines, what rarity each is — and then fills each
 * line, biased toward what the crawler actually uses only once the tier is
 * high enough to care. Below Gold the dungeon is genuinely not paying
 * attention to you.
 */
export function openBox(
  rng: Rng,
  typeId: string,
  tier: Tier,
  ctx: { floor: number; usesTags: string[]; tailor?: TailorCtx },
): BoxResult {
  const type = BOX_BY_ID[typeId] ?? BOX_BY_ID["adventurer"]!;
  const table = TIER_TABLE[tier];
  const lines = rng.int(table.lines[0], table.lines[1]);
  const bias = TIER_BIAS[tier];
  const items: Item[] = [];

  for (let i = 0; i < lines; i++) {
    const rarity = rollRarity(rng, table.weights, typeId === "lucky");
    const fillerLine =
      type.fillerHeavy && (tier === "Bronze" || tier === "Silver") && rng.chance(0.55);

    // Bias has to NARROW, not widen. Appending the build tags to an already
    // broad type pool changes almost nothing, which is how a Gold box ends up
    // feeling identical for a brawler and an archer.
    let prefer = type.pool;
    if (fillerLine) prefer = ["filler", "heal", "food"];
    else if (rng.chance(bias) && ctx.usesTags.length) prefer = ctx.usesTags;

    const rolled = makeItem(rng, { floor: ctx.floor, rarity, prefer });
    items.push(ctx.tailor ? tailor(rng, rolled, ctx.tailor) : rolled);
  }

  const [lo, hi] = table.gold;
  return { items, gold: hi > 0 ? rng.int(lo, hi) : 0 };
}

/** What this crawler visibly uses, for box bias. Keyed off gear and trained
 *  skills rather than class, which is why a heavy-armour brawler keeps being
 *  handed bows. */
export function usageTags(equipped: readonly Item[], skills: Record<string, { level: number }>): string[] {
  const out = new Set<string>();
  for (const i of equipped) for (const t of i.tags) out.add(t);
  for (const [id, s] of Object.entries(skills)) {
    if (s.level < 3) continue;
    if (id === "brawling") out.add("brawl");
    if (id === "blades") out.add("blades");
    if (id === "bludgeon") out.add("bludgeon");
    if (id === "polearm") out.add("polearm");
    if (id === "marksmanship" || id === "throwing") out.add("ranged");
    if (id === "demolitions" || id === "electrical") out.add("explosive");
    if (id === "stealth") out.add("stealth");
    if (id === "engineering" || id === "smithing" || id === "alchemy") out.add("craft");
  }
  return [...out];
}
