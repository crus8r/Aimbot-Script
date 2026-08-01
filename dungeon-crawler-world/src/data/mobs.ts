/**
 * Mobs, with statistics the combat resolver actually consumes.
 *
 * `behavior` is the important field. A pack hunter and a brute with identical
 * numbers play completely differently, because one of them is trying to get
 * behind you and the other one is walking straight into your spear. Fights are
 * interesting because of what the other side is doing, not because of how big
 * its health bar is.
 */

export type Behavior =
  | "brute" // straight at the nearest thing, ignores its own safety
  | "pack" // wants a flank; loses its nerve alone
  | "ambusher" // starts hidden, opens huge, disengages to do it again
  | "caster" // holds range, targets the weakest defence, must be reached
  | "exploder" // closes and detonates
  | "swarm" // many, weak, and they all act
  | "shooter" // holds range and takes cover
  | "commander" // buffs its side; killing it collapses the fight
  | "skirmisher" // hits and withdraws
  | "tank" // slow, armoured, holds ground
  | "neutral"; // will not start it

export interface MobDef {
  id: string;
  name: string;
  /** The level band this thing spawns at. */
  level: [number, number];
  floors: [number, number];
  behavior: Behavior;
  /** Statistics at the bottom of its level band; the spawner scales upward. */
  hp: number;
  armor: number;
  accuracy: number;
  defense: number;
  damage: string;
  reach: number;
  /** 0 breaks instantly, 100 fights to the last. Intimidation checks against this. */
  morale: number;
  xp: number;
  tags: string[];
  weapon: string;
  desc: string;
  drops: { id: string; chance: number; qty?: [number, number] }[];
  /** How many turn up together. */
  group: [number, number];
  /**
   * What this thing is made of, mechanically. Traits are the answer to a
   * crawler who has worked out one devastating trick: an ooze has no vitals, a
   * fire elemental laughs at an incendiary, and something the width of the
   * corridor has more mass than any charge fits in a rucksack.
   */
  traits?: string[];
}

const m = (d: MobDef): MobDef => d;

export const MOBS: readonly MobDef[] = [
  /* --------------------------------------------------------------- floor 1 */
  m({
    id: "rat", name: "Dungeon Rat", level: [1, 3], floors: [1, 2], behavior: "swarm",
    hp: 7, armor: 0, accuracy: 2, defense: 10, damage: "1d4", reach: 1, morale: 30, xp: 8,
    tags: ["beast", "vermin"], weapon: "teeth", group: [2, 5],
    desc: "Level two, in every neighbourhood, regardless of whatever else lives there. Free experience and a small insult.",
    traits: ["small"],
    drops: [{ id: "hide", chance: 0.25 }],
  }),
  m({
    id: "rat_hooligan", name: "Rat Hooligan", level: [3, 6], floors: [1, 2], behavior: "skirmisher",
    hp: 16, armor: 1, accuracy: 4, defense: 12, damage: "1d6+1", reach: 1, morale: 55, xp: 26,
    tags: ["ratkin"], weapon: "a length of scaffolding", group: [1, 3],
    desc: "The fastest and ugliest of them, and the only ones with a workable grasp of what a weapon is for.",
    drops: [{ id: "pipe", chance: 0.3 }, { id: "scrap", chance: 0.4 }],
  }),
  m({
    id: "rat_brute", name: "Rat Brute", level: [4, 7], floors: [1, 2], behavior: "brute",
    hp: 30, armor: 2, accuracy: 4, defense: 10, damage: "1d8+1", reach: 1, morale: 75, xp: 44,
    tags: ["ratkin"], weapon: "a fist the size of your head", group: [1, 1],
    desc: "All shoulders and no neck. Comes straight down the middle because nothing has ever made it regret that.",
    traits: ["large"],
    drops: [{ id: "hide", chance: 0.6, qty: [1, 2] }],
  }),
  m({
    id: "rat_shaman", name: "Rat Shaman", level: [4, 8], floors: [1, 2], behavior: "caster",
    hp: 15, armor: 0, accuracy: 6, defense: 12, damage: "2d4", reach: 3, morale: 40, xp: 52,
    tags: ["ratkin", "caster"], weapon: "something green and unwell", group: [1, 1],
    desc: "Kill it first. Everything else in the room is a delivery system for it and they all know that.",
    drops: [{ id: "reagent", chance: 0.5 }, { id: "glowmoss", chance: 0.4 }],
  }),
  m({
    id: "goblin", name: "Goblin", level: [2, 5], floors: [1, 3], behavior: "shooter",
    hp: 13, armor: 1, accuracy: 4, defense: 12, damage: "1d6", reach: 3, morale: 45, xp: 20,
    tags: ["goblin", "sapient"], weapon: "a crossbow it has modified badly", group: [2, 4],
    desc: "Organised, mercantile, and negotiable if you have the Charisma. They sell explosives and they remember faces.",
    drops: [{ id: "dynamite_goblin", chance: 0.25 }, { id: "powder", chance: 0.2 }],
  }),
  m({
    id: "hobgoblin", name: "Hobgoblin", level: [4, 8], floors: [1, 3], behavior: "commander",
    hp: 26, armor: 2, accuracy: 5, defense: 13, damage: "1d8", reach: 1, morale: 70, xp: 48,
    tags: ["goblin", "sapient"], weapon: "a cleaver and a whistle", group: [1, 1],
    desc: "Bigger, meaner, and the reason the goblins in the room are behaving like a unit instead of a crowd.",
    drops: [{ id: "dynamite_hob", chance: 0.2 }, { id: "cleaver", chance: 0.12 }],
  }),
  m({
    id: "rot_sticker", name: "Rot Sticker", level: [2, 5], floors: [1, 3], behavior: "exploder",
    hp: 11, armor: 0, accuracy: 3, defense: 9, damage: "2d6", reach: 1, morale: 100, xp: 30,
    tags: ["undead"], weapon: "itself", group: [1, 3],
    desc: "Detonates when it dies. Kill it at range or learn something durable about yourself.",
    traits: ["vulnerable:fire"],
    drops: [{ id: "powder", chance: 0.3 }],
  }),
  m({
    id: "troglodyte", name: "Troglodyte", level: [3, 6], floors: [1, 2], behavior: "ambusher",
    hp: 19, armor: 1, accuracy: 5, defense: 13, damage: "1d8", reach: 1, morale: 50, xp: 34,
    tags: ["beast"], weapon: "claws", group: [1, 3],
    desc: "Waits in the dark and smells appalling, which is the only warning the room gives you.",
    drops: [{ id: "hide", chance: 0.5 }],
  }),
  m({
    id: "sludge_crab", name: "Sludge Crab", level: [2, 6], floors: [1, 4], behavior: "tank",
    hp: 26, armor: 3, accuracy: 3, defense: 9, damage: "1d8", reach: 1, morale: 90, xp: 32,
    tags: ["beast", "armoured"], weapon: "a claw that closes like a car door", group: [1, 2],
    desc: "Slow, armoured, and worth real crafting materials if you have anything sharp and any patience.",
    traits: ["armoured", "resist:fire"],
    drops: [{ id: "hide", chance: 0.7, qty: [1, 3] }, { id: "scrap", chance: 0.3 }],
  }),
  m({
    id: "cave_bat", name: "Cave Bat", level: [1, 4], floors: [1, 3], behavior: "swarm",
    hp: 5, armor: 0, accuracy: 4, defense: 14, damage: "1d3", reach: 1, morale: 20, xp: 6,
    tags: ["beast", "flying"], weapon: "teeth", group: [3, 7],
    desc: "Individually trivial. Collectively a status effect.",
    traits: ["small"],
    drops: [],
  }),
  m({
    id: "bad_llama", name: "Bad Llama", level: [3, 6], floors: [1, 2], behavior: "skirmisher",
    hp: 19, armor: 0, accuracy: 4, defense: 12, damage: "1d6", reach: 2, morale: 40, xp: 30,
    tags: ["beast"], weapon: "a corrosive and deeply personal spit", group: [1, 2],
    desc: "Named by a committee that had stopped caring somewhere around the third focus group.",
    drops: [{ id: "hide", chance: 0.4 }],
  }),
  m({
    id: "vespa", name: "Brindled Vespa", level: [4, 8], floors: [1, 4], behavior: "skirmisher",
    hp: 14, armor: 1, accuracy: 7, defense: 15, damage: "1d6", reach: 1, morale: 60, xp: 40,
    tags: ["beast", "flying", "poison"], weapon: "a paralytic sting", group: [1, 3],
    desc: "A wasp the size of a dog. It will not stay still and it does not need to.",
    traits: ["small"],
    drops: [{ id: "reagent", chance: 0.4 }],
  }),
  m({
    id: "mimic_crate", name: "Mimic Crate", level: [3, 7], floors: [1, 5], behavior: "ambusher",
    hp: 28, armor: 3, accuracy: 6, defense: 8, damage: "1d10", reach: 1, morale: 100, xp: 55,
    tags: ["construct"], weapon: "a hinge that is not a hinge", group: [1, 1],
    desc: "Looting has a cost. Occasionally it invoices in advance.",
    traits: ["no_vitals", "armoured"],
    drops: [{ id: "scrap", chance: 0.8, qty: [1, 3] }, { id: "lockpicks", chance: 0.2 }],
  }),

  /* --------------------------------------------------------------- floor 2 */
  m({
    id: "kobold", name: "Kobold Trapper", level: [3, 8], floors: [2, 4], behavior: "shooter",
    hp: 16, armor: 1, accuracy: 5, defense: 14, damage: "1d6", reach: 3, morale: 35, xp: 34,
    tags: ["kobold", "sapient"], weapon: "a dart thrower and a lot of string", group: [2, 4],
    desc: "They do not fight you. They arrange for the room to.",
    traits: ["small"],
    drops: [{ id: "wire", chance: 0.5 }, { id: "lockpicks", chance: 0.15 }],
  }),
  m({
    id: "kobold_rider", name: "Kobold Rider", level: [5, 10], floors: [2, 4], behavior: "pack",
    hp: 42, armor: 2, accuracy: 7, defense: 14, damage: "1d10", reach: 1, morale: 60, xp: 62,
    tags: ["kobold", "mounted"], weapon: "a lance and something with too many legs", group: [1, 3],
    desc: "Fast, and it will not engage until its friends are somewhere behind you.",
    drops: [{ id: "hide", chance: 0.5 }],
  }),
  m({
    id: "clurichaun", name: "Clurichaun", level: [4, 9], floors: [2, 3], behavior: "skirmisher",
    hp: 24, armor: 1, accuracy: 8, defense: 17, damage: "1d8", reach: 1, morale: 45, xp: 58,
    tags: ["fae", "sapient"], weapon: "a broken bottle and total confidence", group: [1, 2],
    desc: "Drunk, hostile, and irritatingly difficult to actually hit.",
    drops: [{ id: "potion_health", chance: 0.4 }],
  }),
  m({
    id: "slime_imp", name: "Slime Imp", level: [3, 8], floors: [2, 4], behavior: "swarm",
    hp: 15, armor: 2, accuracy: 4, defense: 11, damage: "1d6", reach: 1, morale: 100, xp: 26,
    tags: ["ooze"], weapon: "a limb it grows on request", group: [2, 4],
    desc: "Splits when cut. Bring something blunt, or something on fire.",
    traits: ["no_vitals", "resist:concussive", "vulnerable:fire"],
    drops: [{ id: "reagent", chance: 0.35 }],
  }),
  m({
    id: "danger_dingo", name: "Danger Dingo", level: [4, 9], floors: [2, 4], behavior: "pack",
    hp: 22, armor: 1, accuracy: 6, defense: 14, damage: "1d8", reach: 1, morale: 50, xp: 48,
    tags: ["beast", "pack"], weapon: "teeth", group: [3, 5],
    desc: "Pack hunter with a name that tells you everything you require.",
    drops: [{ id: "hide", chance: 0.5 }],
  }),
  m({
    id: "mind_horror", name: "Mind Horror", level: [6, 11], floors: [2, 5], behavior: "caster",
    hp: 44, armor: 1, accuracy: 9, defense: 14, damage: "2d6", reach: 3, morale: 80, xp: 110,
    tags: ["aberration", "caster"], weapon: "a suggestion you cannot decline", group: [1, 1],
    desc: "Attacks Intelligence directly, which makes stupidity a legitimate defensive build and everyone hates that.",
    drops: [{ id: "reagent", chance: 0.6 }, { id: "charm_wit", chance: 0.08 }],
  }),
  m({
    id: "shriek_moth", name: "Shriek Moth", level: [4, 8], floors: [2, 4], behavior: "commander",
    hp: 16, armor: 0, accuracy: 4, defense: 16, damage: "1d4", reach: 2, morale: 20, xp: 44,
    tags: ["beast", "flying"], weapon: "a noise", group: [1, 1],
    desc: "Its cry pulls every hostile within a quarter mile. Kill it first, kill it quietly, or spend the next hour explaining yourself.",
    drops: [],
  }),
  m({
    id: "gutter_ogre", name: "Gutter Ogre", level: [7, 12], floors: [2, 5], behavior: "brute",
    hp: 72, armor: 3, accuracy: 6, defense: 10, damage: "2d8", reach: 2, morale: 85, xp: 140,
    tags: ["giant"], weapon: "a section of kerb", group: [1, 1],
    desc: "Slow, enormous, and it throws masonry with genuinely unfair accuracy.",
    traits: ["large"],
    drops: [{ id: "scrap", chance: 0.8, qty: [2, 4] }, { id: "sledge", chance: 0.15 }],
  }),
  m({
    id: "bopca", name: "Bopca Protector", level: [1, 40], floors: [1, 18], behavior: "neutral",
    hp: 400, armor: 20, accuracy: 30, defense: 40, damage: "10d10", reach: 1, morale: 100, xp: 0,
    tags: ["staff", "sapient"], weapon: "administrative authority", group: [1, 1],
    desc: "Waist-high, enormous ears, permanently affronted. Non-combatant safe room staff. Attacking one is a category of mistake with its own paperwork.",
    drops: [],
  }),

  /* --------------------------------------------------------------- floor 3+ */
  m({
    id: "gnoll_raider", name: "Gnoll Raider", level: [6, 12], floors: [3, 6], behavior: "pack",
    hp: 62, armor: 3, accuracy: 9, defense: 15, damage: "1d10+2", reach: 1, morale: 65, xp: 150,
    tags: ["gnoll", "sapient", "pack"], weapon: "a notched falchion", group: [2, 5],
    desc: "Pack scaling is the whole threat model. Alone it is nervous; in four it is a problem.",
    drops: [{ id: "machete", chance: 0.25 }, { id: "hide", chance: 0.5 }],
  }),
  m({
    id: "wight_hound", name: "Wight Hound", level: [7, 13], floors: [3, 6], behavior: "brute",
    hp: 70, armor: 2, accuracy: 10, defense: 15, damage: "2d6+2", reach: 1, morale: 100, xp: 170,
    tags: ["undead"], weapon: "teeth", group: [1, 3],
    desc: "Does not tire, does not stop, and does not need to breathe. Two of those are worse than they sound.",
    traits: ["no_vitals", "resist:poison"],
    drops: [],
  }),
  m({
    id: "rock_ape", name: "Rock Ape", level: [7, 12], floors: [3, 6], behavior: "skirmisher",
    hp: 78, armor: 2, accuracy: 9, defense: 14, damage: "2d6", reach: 1, morale: 55, xp: 160,
    tags: ["beast", "climber"], weapon: "fists and gravity", group: [1, 2],
    desc: "Territorial and vertical. It will follow you across an entire district out of spite.",
    traits: ["large"],
    drops: [{ id: "hide", chance: 0.6, qty: [1, 2] }],
  }),
  m({
    id: "road_bandit", name: "Road Bandit", level: [6, 12], floors: [3, 6], behavior: "shooter",
    hp: 55, armor: 3, accuracy: 9, defense: 16, damage: "1d10", reach: 3, morale: 40, xp: 140,
    tags: ["npc", "sapient", "human"], weapon: "a crossbow and a bad year", group: [2, 4],
    desc: "An NPC with a fabricated childhood they experience as real, a family they can describe, and a knife. Killing them is allowed. It is also noticed.",
    traits: ["vulnerable:piercing"],
    drops: [{ id: "potion_health", chance: 0.3 }, { id: "lockpicks", chance: 0.2 }],
  }),
  m({
    id: "carrion_dove", name: "Carrion Dove", level: [5, 10], floors: [3, 6], behavior: "swarm",
    hp: 20, armor: 0, accuracy: 7, defense: 16, damage: "1d6", reach: 1, morale: 25, xp: 60,
    tags: ["beast", "flying"], weapon: "a beak built for the aftermath", group: [3, 6],
    desc: "Follows dying things. Where there is a flock there is a fight you have not seen yet.",
    traits: ["small"],
    drops: [],
  }),
  m({
    id: "rail_wight", name: "Rail Wight", level: [10, 17], floors: [4, 7], behavior: "ambusher",
    hp: 110, armor: 4, accuracy: 13, defense: 18, damage: "2d8+3", reach: 1, morale: 100, xp: 340,
    tags: ["undead"], weapon: "a coupling hook", group: [1, 2],
    desc: "Lives in the gap between carriages. The gap is not a place. Do not stand in the gap.",
    traits: ["no_vitals", "resist:poison"],
    drops: [{ id: "scrap", chance: 0.6, qty: [2, 4] }],
  }),
  m({
    id: "soot_djinn", name: "Soot Djinn", level: [11, 18], floors: [4, 8], behavior: "caster",
    hp: 96, armor: 2, accuracy: 15, defense: 19, damage: "3d6", reach: 3, morale: 90, xp: 400,
    tags: ["elemental", "caster"], weapon: "the air in your lungs", group: [1, 1],
    desc: "Fills a carriage with itself. Bring a mask, or a plan, or a different carriage.",
    traits: ["immune:fire", "no_vitals"],
    drops: [{ id: "reagent", chance: 0.7, qty: [1, 2] }],
  }),
  m({
    id: "hunter_crawler", name: "Bounty Crawler", level: [3, 40], floors: [2, 18], behavior: "skirmisher",
    hp: 60, armor: 3, accuracy: 9, defense: 16, damage: "1d10+2", reach: 1, morale: 45, xp: 200,
    tags: ["crawler", "human", "sapient", "hunter"], weapon: "whatever the last floor gave them", group: [1, 2],
    desc: "Another human being, doing exactly what you are doing, who has read your bounty and done the arithmetic.",
    traits: ["vulnerable:piercing"],
    drops: [{ id: "potion_health", chance: 0.5 }, { id: "scrap", chance: 0.4 }],
  }),
];

export const MOB_BY_ID: Record<string, MobDef> = Object.fromEntries(MOBS.map((x) => [x.id, x]));

/* ================================ BOSSES ================================ */

export type BossRank = "Neighborhood" | "Borough" | "City" | "Province" | "Country" | "Floor";

export interface BossDef {
  id: string;
  name: string;
  rank: BossRank;
  floors: [number, number];
  /** Silhouette decides the whole fight. A person-sized boss follows you into
   *  a drain. A behemoth cannot, and is therefore easier despite the numbers. */
  size: "person" | "large" | "corridor-filling" | "behemoth";
  level: number;
  hp: number;
  armor: number;
  accuracy: number;
  defense: number;
  damage: string;
  reach: number;
  xp: number;
  boxTier: string;
  phases: { at: number; name: string; note: string; behavior: Behavior }[];
  adds?: { mob: string; count: number; atPhase: number };
  desc: string;
  /** The thing about the room that beats it, if you find it. */
  weakness: string;
  traits?: string[];
}

export const BOSSES: readonly BossDef[] = [
  {
    id: "hoarder", name: "The Hoarder", rank: "Neighborhood", floors: [1, 1], size: "person",
    level: 8, hp: 220, armor: 4, accuracy: 7, defense: 13, damage: "2d6+2", reach: 1, xp: 450,
    boxTier: "Bronze",
    desc: "A human being, once. The dungeon took somebody who could not throw anything away and made it literal: a bloated thing dragging a neighbourhood of fused debris behind it. It is roughly person-shaped, which is far worse than being enormous, because it fits everywhere you fit.",
    traits: ["vulnerable:fire"],
    weakness: "The debris is load-bearing. Take the mass off it and it is a frightened man in a heap of rubbish.",
    phases: [
      { at: 1.0, name: "Accumulation", note: "It drags its collection with it and swings the heavy end.", behavior: "brute" },
      { at: 0.6, name: "Shedding", note: "It sheds weight to move faster and the room fills with what it dropped.", behavior: "skirmisher" },
      { at: 0.25, name: "Nothing Left", note: "Stripped down to the person inside, and that person is quick.", behavior: "ambusher" },
    ],
  },
  {
    id: "weightlifter", name: "The Weightlifter", rank: "Neighborhood", floors: [1, 1], size: "person",
    level: 9, hp: 260, armor: 5, accuracy: 8, defense: 12, damage: "2d8", reach: 1, xp: 500,
    boxTier: "Bronze",
    desc: "Another person the dungeon turned into a joke about themselves. All arms and no neck, dragging plates of fused iron, and strong enough that the joke stops being funny about four seconds in.",
    weakness: "It cannot turn quickly. Everything it does is committed a full second before it lands.",
    phases: [
      { at: 1.0, name: "Warm-Up Set", note: "Measured, showy, playing to the cameras.", behavior: "brute" },
      { at: 0.5, name: "Failure", note: "Form goes. Power does not. It starts throwing the plates.", behavior: "shooter" },
    ],
  },
  {
    id: "goblin_chieftain", name: "Goblin War Chieftain", rank: "Neighborhood", floors: [1, 2], size: "person",
    level: 10, hp: 200, armor: 4, accuracy: 9, defense: 15, damage: "1d10+3", reach: 1, xp: 520,
    boxTier: "Bronze",
    desc: "Sits at the back of a chamber full of non-combatants, which the system counts separately and will bill you for in full.",
    weakness: "It is a commander. Its side is holding together because it is watching.",
    adds: { mob: "goblin", count: 3, atPhase: 1 },
    phases: [
      { at: 1.0, name: "Command", note: "It directs and does not commit.", behavior: "commander" },
      { at: 0.45, name: "Personally Offended", note: "Its people are dead and it has decided this is between the two of you.", behavior: "brute" },
    ],
  },
  {
    id: "juicer", name: "The Juicer", rank: "Neighborhood", floors: [1, 2], size: "large",
    level: 11, hp: 300, armor: 6, accuracy: 8, defense: 11, damage: "3d6", reach: 2, xp: 620,
    boxTier: "Bronze",
    desc: "Troglodyte boss. It compresses things. You are, from a certain point of view, a thing.",
    traits: ["large", "vulnerable:fire"],
    weakness: "It is blind in the light. Something in this room burns.",
    phases: [
      { at: 1.0, name: "The Press", note: "Grabs and squeezes; being grabbed is the whole danger.", behavior: "brute" },
      { at: 0.4, name: "Spill", note: "It stops trying to hold anything and starts flooding the floor.", behavior: "tank" },
    ],
  },
  {
    id: "ball_of_swine", name: "The Ball of Swine", rank: "Borough", floors: [1, 2], size: "corridor-filling",
    level: 14, hp: 620, armor: 7, accuracy: 10, defense: 9, damage: "4d6", reach: 2, xp: 1600,
    boxTier: "Silver",
    desc: "A rolling sphere of screaming Tusklings fused into a ball roughly the width of the corridor. It cannot be fought head-on by anybody sane, and it is guarding a stairwell, which is the joke.",
    traits: ["massive", "resist:piercing"],
    weakness: "It rolls. It cannot corner, and it cannot climb. Every corner in this room is an argument in your favour.",
    phases: [
      { at: 1.0, name: "Momentum", note: "It runs the length of the room and back, and the room is a corridor.", behavior: "brute" },
      { at: 0.55, name: "Shedding", note: "Individual Tusklings come loose and keep screaming.", behavior: "swarm" },
      { at: 0.2, name: "Unwound", note: "What is left is not a ball any more and is much angrier about it.", behavior: "pack" },
    ],
    adds: { mob: "rot_sticker", count: 3, atPhase: 2 },
  },
  {
    id: "ralph", name: "Ralph", rank: "Borough", floors: [2, 3], size: "large",
    level: 13, hp: 700, armor: 8, accuracy: 13, defense: 16, damage: "3d8", reach: 2, xp: 2100,
    boxTier: "Silver",
    desc: "Kobold boss, enormously strong, mounted on something that should not support him. The fight is really about the arena and he knows the arena.",
    traits: ["large"],
    weakness: "The mount is the fast part. On foot he is a heavy man in a room full of his own traps.",
    phases: [
      { at: 1.0, name: "Mounted", note: "Charges across the room and is gone before you answer.", behavior: "skirmisher" },
      { at: 0.5, name: "Unhorsed", note: "On foot, furious, and swinging for a finish.", behavior: "brute" },
      { at: 0.2, name: "The Traps", note: "He stops fighting and starts using the room, which he built.", behavior: "shooter" },
    ],
  },
  {
    id: "tangle_matron", name: "The Tangle Matron", rank: "City", floors: [3, 5], size: "behemoth",
    level: 18, hp: 1500, armor: 12, accuracy: 18, defense: 18, damage: "4d8+4", reach: 3, xp: 7000,
    boxTier: "Gold",
    desc: "Building-sized, slow to turn, impossible to hide from, and counterintuitively more survivable than something person-sized — because a thing that big cannot follow you into a drain.",
    traits: ["massive", "armoured"],
    weakness: "It cannot fit down the side passages. Every one of them is a free round.",
    phases: [
      { at: 1.0, name: "Sweep", note: "It covers the open ground and dares you to cross it.", behavior: "brute" },
      { at: 0.6, name: "Nest", note: "It calls its brood and stops caring where they are standing.", behavior: "commander" },
      { at: 0.25, name: "Collapse", note: "It brings the structure down to deny you the side passages.", behavior: "tank" },
    ],
    adds: { mob: "vespa", count: 4, atPhase: 2 },
  },
];

export const BOSS_BY_ID: Record<string, BossDef> = Object.fromEntries(BOSSES.map((b) => [b.id, b]));

export const RANK_STAR: Record<BossRank, string> = {
  Neighborhood: "bronze",
  Borough: "silver",
  City: "gold",
  Province: "platinum",
  Country: "obsidian",
  Floor: "white",
};
