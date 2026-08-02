import type { RngState } from "./rng.ts";
import type { Hook, MintedSkill, SpellDef } from "./hooks.ts";
import type { Style } from "./events.ts";

export type { Style };

/* ------------------------------------------------------------------ stats */

export type StatKey = "str" | "dex" | "con" | "int" | "cha";
export const STAT_KEYS: readonly StatKey[] = ["str", "dex", "con", "int", "cha"] as const;
export const STAT_NAMES: Record<StatKey, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  cha: "Charisma",
};

export type Stats = Record<StatKey, number>;

/* ------------------------------------------------------------------ items */

export type Rarity = "junk" | "common" | "uncommon" | "rare" | "epic" | "legendary" | "celestial";
export const RARITIES: readonly Rarity[] = [
  "junk",
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "celestial",
];

export type Slot =
  | "head"
  | "neck"
  | "chest"
  | "legs"
  | "feet"
  | "hands"
  | "ring1"
  | "ring2"
  | "weapon"
  | "offhand";

export const SLOTS: readonly Slot[] = [
  "head",
  "neck",
  "chest",
  "legs",
  "feet",
  "hands",
  "ring1",
  "ring2",
  "weapon",
  "offhand",
];

export const SLOT_LABEL: Record<Slot, string> = {
  head: "Head",
  neck: "Neck",
  chest: "Chest",
  legs: "Legs",
  feet: "Feet",
  hands: "Hands",
  ring1: "Ring",
  ring2: "Ring",
  weapon: "Weapon",
  offhand: "Off-hand",
};

export type ItemKind =
  | "weapon"
  | "armor"
  | "jewelry"
  | "potion"
  | "food"
  | "explosive"
  | "tool"
  | "material"
  | "book"
  | "junk";

/**
 * The closed set of things an item is allowed to do. Closed on purpose: every
 * modifier here is read by name somewhere in the simulation, so there is no
 * such thing as a decorative stat line.
 */
export type Mod =
  | { k: "stat"; stat: StatKey; v: number }
  | { k: "hp"; v: number }
  | { k: "armor"; v: number }
  | { k: "accuracy"; v: number }
  | { k: "defense"; v: number }
  | { k: "damage"; v: number }
  | { k: "crit"; v: number }
  | { k: "initiative"; v: number }
  | { k: "carry"; v: number }
  | { k: "skill"; skill: string; v: number }
  | { k: "onKill"; effect: "heal" | "stam" | "views"; v: number }
  | { k: "unstable"; v: number }
  | { k: "spectacle"; v: number }
  | { k: "resist"; tag: string; v: number };

export interface Item {
  iid: string;
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  slot?: Slot;
  /** Kilograms. The inventory has no slot limit; Strength is the only gate. */
  weight: number;
  value: number;
  qty: number;
  tags: string[];
  desc: string;
  mods?: Mod[];
  /** Weapons only. */
  damage?: string;
  reach?: number;
  twoHanded?: boolean;
  /** Consumables only. */
  use?: { effect: string; v: number };
  equipped?: boolean;
  /** Protected from `drop junk` and other bulk operations. */
  locked?: boolean;
  /** Built rather than found. Devices are delivered, not swung. */
  device?: {
    kind: "burn" | "blast" | "shaped" | "toxin" | "shock" | "smoke";
    power: number;
    vital: boolean;
    tags: string[];
    placed?: boolean;
    note: string;
  };
  /** True for anything the item generator invented rather than the catalogue. */
  generated?: boolean;
}

/* ----------------------------------------------------------------- skills */

export interface SkillState {
  level: number;
  xp: number;
}

/* --------------------------------------------------------------- statuses */

export interface Status {
  id: string;
  name: string;
  bad: boolean;
  /** Rounds if in combat, otherwise hours. -1 is until something removes it. */
  turns: number;
  magnitude: number;
  note: string;
}

/* ------------------------------------------------------------------- map */

export type ZoneTag =
  | "choke"
  | "cover"
  | "high"
  | "exposed"
  | "confined"
  | "water"
  | "flammable"
  | "rubble"
  | "dark";

export interface Feature {
  id: string;
  name: string;
  /** What interacting with it does. */
  kind:
    | "topple"
    | "ignite"
    | "collapse"
    | "electrify"
    | "vent"
    | "winch"
    | "gas"
    | "cache"
    | "barricade_stock";
  /** Difficulty of the check, if any. */
  dc: number;
  /** Which stat or skill the check leans on. */
  check: { stat?: StatKey; skill?: string };
  /** Consumed after use, or reusable. */
  spent: boolean;
  note: string;
  /** Some features arm others: gas + ignite, water + electrify. */
  primes?: string[];
}

export interface Zone {
  id: string;
  name: string;
  tags: ZoneTag[];
  links: string[];
  /** How many hostiles can melee a single defender standing here. The whole
   *  reason a doorway is worth dying in. */
  capacity: number;
  features: Feature[];
  /** Set by preparation. */
  barricaded: boolean;
  traps: { name: string; damage: string; status?: string; hidden: boolean }[];
  hazard?: { kind: "fire" | "current" | "smoke"; turns: number; damage: string };
}

export type NodeKind =
  | "corridor"
  | "chamber"
  | "plaza"
  | "shop"
  | "safe_room"
  | "guild"
  | "lair"
  | "stairwell"
  | "vault"
  | "shrine";

export interface MapNode {
  id: string;
  name: string;
  kind: NodeKind;
  zones: Zone[];
  /** Zone the crawler enters through. */
  entry: string;
  links: { to: string; minutes: number; known: boolean }[];
  /** `level` is set by the generator from depth, so the second room a level-1
   *  crawler opens is not allowed to contain the top of a mob's band. */
  spawn: { mob: string; count: number; level?: number }[];
  loot: Item[];
  searched: boolean;
  cleared: boolean;
  visited: boolean;
  /** Adjacent-but-unvisited nodes are "sensed" — you know there is something
   *  through there, not what. */
  sensed: boolean;
  boss?: string;
  hasStairs: boolean;
  note: string;
}

export interface FloorState {
  n: number;
  name: string;
  nodes: Record<string, MapNode>;
  at: string;
  hoursLeft: number;
  hoursTotal: number;
  stairsAnnounced: boolean;
  bossesKilled: string[];
}

/* ------------------------------------------------------------- the crawler */

export interface Companion {
  id: string;
  name: string;
  species: string;
  sapient: boolean;
  level: number;
  hp: number;
  hpMax: number;
  stats: Stats;
  stance: "aggressive" | "defensive" | "support" | "hide";
  trust: number;
  mood: string;
  alive: boolean;
  epitaph?: string;
  note: string;
}

export interface Sponsor {
  id: string;
  name: string;
  terms: string;
  /** Broken terms drop you, loudly. */
  clause: string;
  since: number;
  strikes: number;
}

export interface LootBox {
  bid: string;
  type: string;
  tier: string;
  why: string;
}

export interface Crawler {
  name: string;
  number: number;
  level: number;
  xp: number;
  stats: Stats;
  /** Points you have earned but cannot spend until race and class are chosen. */
  banked: number;
  points: number;
  hp: number;
  hpMax: number;
  mana: number;
  manaMax: number;
  stamina: number;
  staminaMax: number;
  fatigue: number;
  hunger: number;
  gold: number;
  bounty: number;
  race: string | null;
  klass: string | null;
  skillCap: number;
  statuses: Status[];
  stars: string[];
  alive: boolean;
  death?: { cause: string; floor: number; at: number };
  /** Hooks the chosen class contributes. Generated classes carry real ones. */
  classHooks?: Hook[];
  className?: string;

  /** How they walked in. Referenced forever. */
  origin: { job: string; hobby: string; dress: string; carried: string[] };
}

export interface Ratings {
  views: number;
  followers: number;
  favourites: number;
  peak: number;
  /**
   * The last forty spikes, newest last.
   *
   * The totals alone are a scoreboard, and a scoreboard is not what being
   * broadcast feels like. What a crawler would actually notice is the shape:
   * the room where nobody was watching, the four seconds where everybody was.
   * Kept short and capped because it is drawn, not analysed.
   */
  recent: number[];
  /** Views at the moment this floor opened, so a floor can be scored on its own. */
  floorStart: number;
  /** Run hours at the last spike, so attention can be made to drain. */
  lastSpikeAt: number;
}

export interface Counters {
  kills: number;
  bossKills: number;
  unarmedKills: number;
  environmentalKills: number;
  punchingUpKills: number;
  npcKills: number;
  fled: number;
  parleys: number;
  boxesOpened: number;
  roomsCleared: number;
  trapsSet: number;
  damageTaken: number;
  damageDealt: number;
  nearDeaths: number;
  crawlersMet: number;
  spared: number;
}

/** The same tally, reset on every descent. Sponsor clauses are checked against
 *  this and only this — a good floor does not buy forgiveness for a bad one. */
export interface FloorTally {
  kills: number;
  unarmedKills: number;
  environmentalKills: number;
  fled: number;
  parleys: number;
  spared: number;
  npcKills: number;
  damageTaken: number;
  bossKills: number;
  roomsCleared: number;
}

export interface RoomCard {
  floor: number;
  node: string;
  summary: string;
  at: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: RngState;
  /** Hours since the dungeon opened, which was at 03:00. */
  elapsed: number;
  crawler: Crawler;
  inventory: Item[];
  skills: Record<string, SkillState>;
  boxes: LootBox[];
  companions: Companion[];
  sponsors: Sponsor[];
  offers: { sponsor: string; terms: string; clause: string; gives: string; expires: number }[];
  ratings: Ratings;
  counters: Counters;
  floorTally: FloorTally;
  achievements: { id: string; name: string; text: string; floor: number; at: number }[];
  floor: FloorState;
  /** Live encounter, if one is running. */
  encounter: EncounterState | null;
  memory: RoomCard[];
  /** What this crawler keeps doing. Crossing a threshold mints a skill that
   *  did not exist when the run started. */
  practice: Record<string, number>;
  /** Skills the dungeon invented for this crawler. `null` marks a pattern it
   *  noticed and decided an existing skill already covered. */
  minted: Record<string, MintedSkill | null>;
  /** Every spell this crawler knows, including ones nobody authored. */
  spellbook: Record<string, SpellDef>;
  /** Spell id to rounds remaining. */
  cooldowns: Record<string, number>;
  /** The third-floor menu, rolled once and then fixed so it cannot be rerolled. */
  classMenu?: unknown;
  /** Ordinary Earth objects claimed from pockets, capped per floor. */
  claims: number;
  /** Recipes this crawler knows. Unbounded; most are worked out at a bench. */
  recipes: string[];
  /**
   * What has been dug out of the walls, and what the walls think about it.
   *
   * The only part of the material layer that is stored. What a room is MADE of
   * is derived from the world seed on demand and never written down, so this is
   * two integers per position that anybody has actually attacked — units taken
   * under `d:floor:node:zone:material`, accumulated structural strain under
   * `s:floor:node:zone` — rather than a geology table per floor.
   */
  dug: Record<string, number>;
  /** The room off every safe room that belongs to you, and what is in it. */
  space: { owned: boolean; stations: string[]; upgrades: string[] };
  /** Stock for the shop currently standing in front of you. */
  shop: { node: string; stock: Item[] } | null;
  /**
   * Backloads. Death rewinds you to the start of the room, then to the start
   * of the floor, and then it is a death. Both come back on descending.
   *
   * This exists so the simulation never has to pull a punch: the stakes stay
   * real because the third one is final, and the game stays fair because the
   * first two are yours. Stored as JSON so a snapshot never contains a
   * snapshot.
   */
  restores: { room: boolean; floor: boolean };
  checkpoints: { room: string | null; floor: string | null };
  /** Set when the crawler is down but restores remain — the UI offers them. */
  pendingDeath: { cause: string; outs: string[] } | null;
  world: { crawlersLeft: number; feed: string[]; dead: string[] };
  flags: Record<string, number | string | boolean>;
  history: string[];
}

/* ------------------------------------------------------------- encounters */

export type Side = "crawler" | "ally" | "hostile";

export interface Combatant {
  id: string;
  /** The mob or boss definition this was stamped from, for drops and tallies. */
  sourceId: string;
  name: string;
  side: Side;
  level: number;
  hp: number;
  hpMax: number;
  armor: number;
  accuracy: number;
  defense: number;
  damage: string;
  reach: number;
  initiative: number;
  zone: string;
  behavior: string;
  statuses: Status[];
  hidden: boolean;
  braced: boolean;
  aiming: boolean;
  prone: boolean;
  fleeing: boolean;
  alive: boolean;
  /** Mobs only: what it drops and what it is worth. */
  xp: number;
  tags: string[];
  weapon: string;
  /** Set when something is holding a chokepoint against this combatant. */
  blockedBy: string | null;
}

export interface EncounterState {
  nodeId: string;
  round: number;
  order: string[];
  turnIndex: number;
  combatants: Combatant[];
  surprise: "none" | "crawler" | "hostiles";
  /** Actions the crawler has left this round. */
  actions: { move: number; act: number };
  finished: null | "victory" | "fled" | "defeat" | "parley";
  killsThisFight: number;
  roundsTaken: number;
  /** Every death in this fight, with the style it was done in. Accumulated as
   *  it happens so that a fight lasting eight turns still pays out on the
   *  first round's flourish. */
  killLog: { name: string; level: number; styles: Style[]; byCrawler: boolean }[];
  /** Last stands left. A blow that would kill you instead leaves you upright
   *  for one more round — the difference between a death you saw coming and a
   *  death that simply happened between two lines of text. */
  lastStands: number;
}
