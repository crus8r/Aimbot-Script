import type { Rarity } from "../core/types.ts";

export const TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Legendary", "Celestial"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierTable {
  lines: [number, number];
  weights: Partial<Record<Rarity, number>>;
  gold: [number, number];
}

/**
 * Bronze really is mostly rubbish and Celestial genuinely does not happen to
 * people. The temptation is to make every box feel good; resisting it is what
 * makes a Gold box land.
 */
export const TIER_TABLE: Record<Tier, TierTable> = {
  Bronze: { lines: [2, 2], weights: { junk: 46, common: 44, uncommon: 9, rare: 1 }, gold: [0, 14] },
  Silver: { lines: [2, 3], weights: { junk: 20, common: 48, uncommon: 28, rare: 4 }, gold: [10, 65] },
  Gold: { lines: [3, 4], weights: { junk: 5, common: 27, uncommon: 46, rare: 21, epic: 1 }, gold: [45, 260] },
  Platinum: { lines: [3, 5], weights: { common: 9, uncommon: 34, rare: 45, epic: 12 }, gold: [200, 900] },
  Legendary: { lines: [4, 6], weights: { common: 2, uncommon: 14, rare: 44, epic: 34, legendary: 6 }, gold: [900, 4000] },
  Celestial: { lines: [1, 2], weights: { epic: 10, legendary: 30, celestial: 60 }, gold: [0, 0] },
};

/** How hard a box leans toward what the crawler actually uses. Low tiers do
 *  not care about you in the slightest, which is most of the joke. */
export const TIER_BIAS: Record<Tier, number> = {
  Bronze: 0,
  Silver: 0.1,
  Gold: 0.45,
  Platinum: 0.62,
  Legendary: 0.78,
  Celestial: 1,
};

export interface BoxType {
  id: string;
  name: string;
  stencil: string;
  /** Item tags this box draws from. */
  pool: string[];
  /** Bronze and Silver of this type are mostly potions and torches. */
  fillerHeavy: boolean;
  desc: string;
}

export const BOX_TYPES: readonly BoxType[] = [
  { id: "adventurer", name: "Adventurer Box", stencil: "a shield and a lantern", fillerHeavy: true,
    pool: ["filler", "heal", "mana", "utility", "weapon", "armour", "clothes", "tome"],
    desc: "The workhorse. Liberally distributed early, which is how the dungeon teaches you that most boxes are bandages." },
  { id: "weapon", name: "Weapon Box", stencil: "crossed blades", fillerHeavy: false,
    pool: ["weapon", "blades", "bludgeon", "ranged", "polearm"],
    desc: "Given for unarmed kills, which is the system's idea of a note." },
  { id: "savage", name: "Savage Box", stencil: "a broken tusk", fillerHeavy: false,
    pool: ["weapon", "bludgeon", "brawl", "armour"],
    desc: "For brutal, close-range, improvised work. Heavy ugly gear that scales with Strength." },
  { id: "goblin", name: "Goblin Box", stencil: "a skull on scrap metal", fillerHeavy: false,
    pool: ["explosive", "goblin", "craft", "ranged"],
    desc: "Cobbled together from scrap. Dynamite, powder, and machinery with a grudge." },
  { id: "mechanic", name: "Mechanic's Box", stencil: "a wrench and a spark", fillerHeavy: false,
    pool: ["craft", "utility", "explosive"],
    desc: "Tools, wire and components. Beloved by anybody who has ever wired a detonator correctly." },
  { id: "lucky", name: "Lucky Bastard Box", stencil: "a coin balanced on its edge", fillerHeavy: false,
    pool: ["jewellery", "utility", "weapon", "armour", "tome", "caster"],
    desc: "For surviving something you had no business surviving. Rolls its rarity twice and keeps the better." },
  { id: "apothecary", name: "Apothecary Box", stencil: "a mortar and pestle", fillerHeavy: true,
    pool: ["heal", "mana", "alchemy", "craft", "filler"],
    desc: "Potions, reagents, and one pharmaceutical with a legal disclaimer." },
  { id: "cartographer", name: "Cartographer's Box", stencil: "a folded map", fillerHeavy: true,
    pool: ["utility", "stealth", "filler"],
    desc: "Given for exploration. Rope, chalk, and the occasional thing that sees through a wall." },
  { id: "apparel", name: "Apparel Box", stencil: "nothing at all — the gold ones simply glow", fillerHeavy: false,
    pool: ["clothes", "armour", "jewellery"],
    desc: "Unusually generous for how easy it is to earn one. Famously awarded for arriving without trousers." },
  { id: "pet", name: "Pet Box", stencil: "a small animal of indeterminate species", fillerHeavy: true,
    pool: ["filler", "food", "utility"],
    desc: "Biscuits, collars, coupons, and occasionally something with teeth." },
  { id: "coward", name: "Coward's Box", stencil: "a turned back", fillerHeavy: true,
    pool: ["utility", "stealth", "filler", "heal"],
    desc: "For fleeing successfully and repeatedly. The gear is genuinely excellent at fleeing. The name is on the lid forever." },
  { id: "pacifist", name: "Pacifist's Box", stencil: "an open hand", fillerHeavy: true,
    pool: ["heal", "utility", "filler", "jewellery"],
    desc: "For winning something important without killing it. The system considers this a personal failing and rewards it anyway." },
  { id: "asshole", name: "Asshole's Box", stencil: "a pointing finger", fillerHeavy: true,
    pool: ["explosive", "joke", "filler", "weapon"],
    desc: "The contents are good. The commentary is not. The name is permanent." },
  { id: "boss", name: "Boss Box", stencil: "a cracked crown", fillerHeavy: false,
    pool: ["weapon", "armour", "jewellery", "utility", "explosive", "craft"],
    desc: "Its tier is set by the rank of what you killed, and by nothing else you can argue about." },
  { id: "benefactor", name: "Benefactor Box", stencil: "the sponsor's own logo", fillerHeavy: false,
    pool: ["jewellery", "armour", "utility", "caster", "sponsor", "tome"],
    desc: "Ordered and paid for by a patron who picked the contents. A Bronze Benefactor beats a Gold Adventurer and everybody resents that." },
  { id: "grimoire", name: "Grimoire Box", stencil: "a closed eye", fillerHeavy: false,
    pool: ["tome", "caster", "utility"],
    desc: "Tomes and nothing else. The dungeon picks the spell, it does not take requests, and it has never once picked the one you wanted." },
  { id: "fan", name: "Fan Box", stencil: "a great many small hands", fillerHeavy: true,
    pool: ["filler", "clothes", "joke", "utility"],
    desc: "Viewer-funded. Backers vote the tier up with real money, which mostly keeps the trolls out." },
];

export const BOX_BY_ID: Record<string, BoxType> = Object.fromEntries(BOX_TYPES.map((b) => [b.id, b]));

/** Boss rank sets box tier and there is no negotiating with it. */
export const RANK_TIER: Record<string, Tier> = {
  Neighborhood: "Bronze",
  Borough: "Silver",
  City: "Gold",
  Province: "Platinum",
  Country: "Legendary",
  Floor: "Legendary",
};
