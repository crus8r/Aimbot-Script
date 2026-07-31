import type { Mod, StatKey, Stats } from "../core/types.ts";

/**
 * Race and class, chosen once, on the third floor, permanently.
 *
 * Every entry does something the simulation reads. Human really is the
 * strongest opening and roughly four crawlers in five take it; Primal really
 * does put you five levels behind on day one and is the only way anyone has
 * ever pushed a skill past fifteen. That trade is the most interesting
 * decision in the game and it is a real one, not a flavour label.
 */

export interface RaceDef {
  id: string;
  name: string;
  /** Added to (or taken from) the points banked since level one. */
  points: number;
  skillCap: number;
  stats: Partial<Stats>;
  perk: Mod[];
  pros: string;
  cons: string;
  note: string;
}

export const RACES: readonly RaceDef[] = [
  {
    id: "human", name: "Human", points: 10, skillCap: 15, stats: {},
    perk: [{ k: "accuracy", v: 1 }, { k: "defense", v: 1 }],
    pros: "Ten extra points and Adaptability — a small, broad, unglamorous bonus to everything.",
    cons: "Skill ceiling of fifteen, like almost everybody else.",
    note: "Roughly four in five crawlers stay human, and roughly four in five crawlers are correct to.",
  },
  {
    id: "primal", name: "Primal", points: -5, skillCap: 20, stats: {},
    perk: [],
    pros: "Every skill can be trained to twenty instead of fifteen. Nothing else in the game does this.",
    cons: "Costs five points and forfeits Human's ten. You start fifteen points behind — five levels — and you feel every one of them for two floors.",
    note: "The progenitors. Choosing it changes nothing about your body and everything about your ceiling. Pick two things and become frightening at them.",
  },
  {
    id: "crocodilian", name: "Crocodilian", points: 0, skillCap: 15,
    stats: { str: 3, con: 3, dex: -2 },
    perk: [{ k: "armor", v: 3 }],
    pros: "Natural armour and a bite that does not need a weapon.",
    cons: "Slow. Climbs badly, dodges worse.",
    note: "Armoured, patient, and built around one enormous commitment at a time.",
  },
  {
    id: "tunnel_shrike", name: "Tunnel Shrike", points: 0, skillCap: 15,
    stats: { dex: 4, con: -2 },
    perk: [{ k: "initiative", v: 4 }, { k: "skill", skill: "first_strike", v: 2 }],
    pros: "Enormous initiative and a devastating opening strike. Built to sprint down a corridor and end something.",
    cons: "A small health pool and nothing to fall back on if the first exchange does not settle it.",
    note: "Hollow-boned corridor predator. Excellent for exactly one round.",
  },
  {
    id: "cat_royal", name: "Cat, Royal", points: 0, skillCap: 15,
    stats: { cha: 5, dex: 2, con: -3 },
    perk: [{ k: "spectacle", v: 0.35 }],
    pros: "Charisma scaling nothing else touches, and the audience adores you on sight.",
    cons: "Constitution is a rumour. Things that hit you tend to only need to do it once.",
    note: "For the pet who ate the biscuit and decided the crown fit.",
  },
  {
    id: "quill_ogre", name: "Quill Ogre", points: 0, skillCap: 15,
    stats: { str: 4, con: 3, dex: -2, cha: -2 },
    perk: [{ k: "hp", v: 40 }, { k: "armor", v: 2 }],
    pros: "An enormous health pool, and hitting you is a poor decision for whoever does it.",
    cons: "Cannot wear most armour and nobody wants to talk to you.",
    note: "Hitting you is a bad idea for the person hitting you.",
  },
  {
    id: "mycen", name: "Mycen", points: 0, skillCap: 15,
    stats: { int: 3, con: 2, cha: -2 },
    perk: [{ k: "resist", tag: "poison", v: 3 }, { k: "skill", skill: "alchemy", v: 3 }],
    pros: "Immune to disease, regrows what it loses, and understands chemistry from the inside.",
    cons: "Fire, and the fact that you are several arguments in a coat.",
    note: "A colony that has agreed, provisionally, to be a person.",
  },
  {
    id: "vellum_wraith", name: "Vellum Wraith", points: 0, skillCap: 15,
    stats: { int: 4, dex: 2, str: -3 },
    perk: [{ k: "skill", skill: "stealth", v: 3 }],
    pros: "Silent, clever, and the largest mana pool available at this level.",
    cons: "Paper-thin. Fire and water are both catastrophic and this floor has plenty of each.",
    note: "The race the dungeon reuses whenever it needs a librarian who can kill.",
  },
];

export interface ClassDef {
  id: string;
  name: string;
  /** Stat minimums, checked after the race's points are released and spent. */
  req: Partial<Record<StatKey, number>>;
  skills: { id: string; level: number }[];
  perk: Mod[];
  primalOnly?: boolean;
  pros: string;
  cons: string;
  note: string;
}

export const CLASSES: readonly ClassDef[] = [
  {
    id: "prizefighter", name: "Prizefighter", req: { str: 15 },
    skills: [{ id: "brawling", level: 4 }, { id: "pain_tolerance", level: 2 }],
    perk: [{ k: "spectacle", v: 0.25 }, { k: "damage", v: 2 }],
    primalOnly: true,
    pros: "Unarmed damage that scales past what weapons manage, and a crowd meter that feeds it.",
    cons: "Requires fifteen Strength, which is most of a race's worth of points.",
    note: "Earth-flavoured, so it is only on the menu if you took Primal.",
  },
  {
    id: "sapper", name: "Sapper", req: { int: 13 },
    skills: [{ id: "demolitions", level: 4 }, { id: "engineering", level: 3 }, { id: "electrical", level: 2 }],
    perk: [],
    pros: "Trenches, tunnels and demolition. Every room becomes a thing you can take apart.",
    cons: "Deeply unfashionable right up until the floor where it wins outright.",
    note: "Nobody respects the sapper until the ceiling comes down on schedule.",
  },
  {
    id: "field_medic", name: "Field Medic", req: { int: 14 },
    skills: [{ id: "field_dressing", level: 5 }, { id: "alchemy", level: 3 }],
    perk: [{ k: "hp", v: 20 }],
    pros: "Non-divine healing: triage, stimulants, amputation. Keeps parties alive where nothing else does.",
    cons: "The unglamorous one. Views come slowly and sponsors look elsewhere.",
    note: "Everyone wants one in the party and nobody wants to be one.",
  },
  {
    id: "rogue", name: "Rogue", req: { dex: 14 },
    skills: [{ id: "stealth", level: 4 }, { id: "first_strike", level: 3 }, { id: "lockpicking", level: 2 }],
    perk: [{ k: "crit", v: 1 }],
    pros: "Scouting, ambush and opening damage. An ambush is the only reliable way to punch three levels up.",
    cons: "A fight that lasts past round two is a fight going badly.",
    note: "The Desperado Club's favourite people, and the reason it has a members' entrance.",
  },
  {
    id: "quartermaster", name: "Quartermaster", req: { int: 12, cha: 12 },
    skills: [{ id: "negotiation", level: 4 }, { id: "appraisal", level: 4 }, { id: "clean_lift", level: 3 }],
    perk: [{ k: "carry", v: 60 }],
    pros: "Better prices, heavier lifting, and you can read the clause the description buried.",
    cons: "You are the logistics. Somebody else is the fight.",
    note: "Counts your Strength as higher for deciding what goes in the inventory, which is more useful than it sounds.",
  },
  {
    id: "provocateur", name: "Provocation Artist", req: { cha: 18 },
    skills: [{ id: "intimidation", level: 4 }, { id: "performance", level: 4 }],
    perk: [{ k: "spectacle", v: 0.4 }],
    pros: "Forces morale checks, and multiplies views for humiliating something larger than you.",
    cons: "Eighteen Charisma buys no health whatsoever, and the bounty climbs accordingly.",
    note: "Taunt, force the aggro, and get paid for the indignity you inflict.",
  },
  {
    id: "gravedigger", name: "Gravedigger", req: { con: 14 },
    skills: [{ id: "butchery", level: 4 }, { id: "bludgeon", level: 3 }, { id: "pain_tolerance", level: 3 }],
    perk: [{ k: "hp", v: 25 }, { k: "damage", v: 1 }],
    pros: "Loots faster, butchers better, and gets stronger standing where things have died.",
    cons: "Slow, grim, and there is a smell.",
    note: "The dungeon supplies corpses at an industrial rate and somebody ought to be using them.",
  },
  {
    id: "stunt_double", name: "Stunt Double", req: { dex: 16 },
    skills: [{ id: "dodge", level: 4 }, { id: "sprint", level: 3 }, { id: "climbing", level: 3 }],
    perk: [{ k: "defense", v: 2 }, { k: "spectacle", v: 0.2 }],
    pros: "Damage taken on camera converts partly into ratings. Actively rewards spectacle.",
    cons: "Requires sixteen Dexterity and a certain attitude to your own spine.",
    note: "The only class where getting hit is part of the business model.",
  },
];

export const RACE_BY_ID: Record<string, RaceDef> = Object.fromEntries(RACES.map((r) => [r.id, r]));
export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
