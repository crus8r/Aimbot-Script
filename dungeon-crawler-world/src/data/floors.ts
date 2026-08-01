import type { NodeKind, ZoneTag } from "../core/types.ts";

/**
 * Floors are not a percentage any more. A floor is a graph of places, and a
 * place is a set of tactical positions with links between them. That single
 * change is what turns "you fight the thing" into "you fight the thing in a
 * doorway, having spent forty minutes deciding that was the doorway".
 */

export interface FloorDef {
  n: number;
  name: string;
  days: number;
  theme: string;
  rules: string[];
  mobs: string[];
  bosses: string[];
  /** How many places make up this floor's slice of the district. */
  size: [number, number];
  /** Word banks the room namer draws on. */
  places: string[];
  qualifiers: string[];
}

export const FLOORS: readonly FloorDef[] = [
  {
    n: 1,
    name: "The First Floor",
    days: 3,
    theme:
      "A city was pulled down into hewn stone and the stone kept the city's shape. Alleys that used to be streets, shopfronts with no sky above them, and a grid that almost makes sense. Not broadcast live — only highlight reels, which is the only mercy on offer.",
    rules: [
      "Mobs are level 1 to 7. Clearing a neighbourhood's boss stops its spawns.",
      "Stairwells are seeded about a third of the way through the timer. Boss chambers always hold one.",
      "Loot boxes stay locked until you have done a Guild Hall tutorial and reached a safe room.",
      "Rats infest every neighbourhood regardless of whatever else lives there.",
    ],
    mobs: ["rat", "rat_hooligan", "rat_brute", "rat_shaman", "goblin", "hobgoblin", "rot_sticker",
      "troglodyte", "sludge_crab", "cave_bat", "bad_llama", "vespa", "mimic_crate"],
    bosses: ["hoarder", "weightlifter", "goblin_chieftain", "juicer", "ball_of_swine"],
    size: [22, 28],
    places: ["parking structure", "underpass", "noodle shop", "launderette", "stairwell core",
      "loading bay", "service corridor", "pharmacy", "bus shelter", "phone exchange", "hardware store",
      "atrium", "maintenance shaft", "car park ramp", "bookmakers", "chapel of rest", "bike rack",
      "chip shop", "electrical substation", "tunnel mouth", "cistern", "market row"],
    qualifiers: ["flooded", "collapsed", "half-buried", "burnt-out", "smoke-blackened", "picked-over",
      "sunken", "shuttered", "overturned", "rain-drummed", "silent", "unlit", "fused", "sagging"],
  },
  {
    n: 2,
    name: "The Second Floor",
    days: 6,
    theme:
      "The same cinderblock logic, one storey down, and the cameras are on. Ratings populate. Followers populate. Somewhere an audience of trillions decides what it thinks of your face.",
    rules: [
      "Live broadcast. Views multiply by twenty compared with the first floor.",
      "Six-day timer — the legal minimum, cut for pacing by people who will not be down here.",
      "Bounties become real, and so do the crawlers who read them.",
      "Do not relieve yourself outside a designated bathroom. They were extremely serious about this.",
    ],
    mobs: ["kobold", "kobold_rider", "clurichaun", "slime_imp", "danger_dingo", "mind_horror",
      "shriek_moth", "gutter_ogre", "rat", "goblin", "rot_sticker", "vespa"],
    bosses: ["ralph", "goblin_chieftain", "juicer", "ball_of_swine"],
    size: [26, 34],
    places: ["transit platform", "cistern gallery", "kobold works", "fungus farm", "sorting office",
      "flooded stair", "gantry", "boiler house", "pump room", "spoil heap", "cable vault",
      "canteen", "dormitory", "washhouse", "signal box", "ventilation hall", "brood pit"],
    qualifiers: ["trap-strung", "dripping", "humming", "spore-hung", "rust-streaked", "cavernous",
      "low-ceilinged", "wire-crossed", "chalk-marked", "screaming", "recently emptied"],
  },
  {
    n: 3,
    name: "The Over City",
    days: 8,
    theme:
      "The training levels end. There is a sky, or something committed enough to the idea. Roads, weather, towns, and NPCs with jobs and names and childhoods they can describe in detail. Race and class selection happens here and it is permanent.",
    rules: [
      "Return to a Guild Hall to choose a race, then a class, then spend every point you have been hoarding since level one.",
      "Human grants ten extra points and broad small bonuses. Primal costs five and lifts the skill ceiling from 15 to 20.",
      "NPCs are people here. The system keeps a record of how you treat them and shares it with the audience.",
    ],
    mobs: ["gnoll_raider", "wight_hound", "rock_ape", "road_bandit", "carrion_dove", "sludge_crab", "goblin"],
    bosses: ["tangle_matron", "ralph"],
    size: [30, 38],
    places: ["crossroads", "toll house", "grain store", "quarry lip", "drovers' road", "shrine steps",
      "tannery", "orchard terrace", "rope bridge", "waystation", "flooded ford", "watchtower",
      "market square", "burnt farmstead", "pilgrim camp", "cistern head"],
    qualifiers: ["wind-scoured", "rain-slick", "abandoned", "barricaded", "smoke-hazed", "sun-bleached",
      "overgrown", "well-kept", "recently fought over", "quiet in a way that is wrong"],
  },
  {
    n: 4,
    name: "The Iron Tangle",
    days: 8,
    theme:
      "An impossible knot of railway. Trains that never stop, transfer stations that move, and conductors who are neighbourhood bosses. The leaderboard goes live and puts a price on the top ten.",
    rules: [
      "The leaderboard publishes after each recap. Being on it is a bounty.",
      "Boxes and achievements dry up sharply from here and each one starts meaning more.",
      "Sponsors auction for the right to own three slots of your behaviour.",
    ],
    mobs: ["rail_wight", "soot_djinn", "sludge_crab", "gnoll_raider", "hunter_crawler"],
    bosses: ["tangle_matron"],
    size: [30, 40],
    places: ["carriage", "coupling gap", "transfer platform", "signal gantry", "coal tender",
      "freight car", "turntable", "brake house", "sleeper car", "engine shed", "points junction"],
    qualifiers: ["moving", "derailed", "soot-choked", "screaming on the rails", "uncoupled",
      "packed", "sealed", "on fire and still moving"],
  },
];

export function floorDef(n: number): FloorDef {
  const found = FLOORS.find((f) => f.n === n);
  if (found) return found;
  // Deeper floors reuse the last authored template rather than pretending to
  // content that does not exist. Honest, and it keeps the game finishable.
  const last = FLOORS[FLOORS.length - 1]!;
  return { ...last, n, name: `Floor ${n}`, days: Math.max(5, 8 - Math.floor((n - 4) / 3)) };
}

/* ========================================================================
   ROOM LAYOUTS
   ========================================================================
   Each layout is a small graph of tactical positions. `capacity` is the
   number of hostiles that can bring a melee weapon to bear on one defender
   standing there, and it is the single most important number in the file: a
   doorway with capacity 1 means one crawler with a spear can hold a corridor
   against six things, which is exactly the fantasy this game is for.
   ======================================================================== */

export interface ZoneTemplate {
  id: string;
  name: string;
  tags: ZoneTag[];
  links: string[];
  capacity: number;
}

export interface LayoutTemplate {
  id: string;
  kinds: NodeKind[];
  entry: string;
  zones: ZoneTemplate[];
}

export const LAYOUTS: readonly LayoutTemplate[] = [
  {
    id: "corridor",
    kinds: ["corridor"],
    entry: "mouth",
    zones: [
      { id: "mouth", name: "the mouth of the corridor", tags: ["choke"], links: ["middle"], capacity: 2 },
      { id: "middle", name: "the middle of the run", tags: ["confined"], links: ["mouth", "far"], capacity: 3 },
      { id: "far", name: "the far end", tags: ["choke", "dark"], links: ["middle"], capacity: 2 },
    ],
  },
  {
    id: "doorway_room",
    kinds: ["chamber", "shop"],
    entry: "doorway",
    zones: [
      { id: "doorway", name: "the doorway", tags: ["choke"], links: ["floor"], capacity: 1 },
      { id: "floor", name: "the open floor", tags: ["exposed"], links: ["doorway", "shelving", "counter"], capacity: 4 },
      { id: "shelving", name: "behind the toppled shelving", tags: ["cover", "flammable"], links: ["floor"], capacity: 2 },
      { id: "counter", name: "up on the counter", tags: ["high", "cover"], links: ["floor"], capacity: 2 },
    ],
  },
  {
    id: "pillars",
    kinds: ["chamber", "vault", "shrine"],
    entry: "arch",
    zones: [
      { id: "arch", name: "the arch", tags: ["choke"], links: ["nave"], capacity: 2 },
      { id: "nave", name: "the open nave", tags: ["exposed"], links: ["arch", "pillars", "gallery"], capacity: 5 },
      { id: "pillars", name: "among the pillars", tags: ["cover"], links: ["nave", "gallery"], capacity: 2 },
      { id: "gallery", name: "the raised gallery", tags: ["high", "cover"], links: ["nave", "pillars"], capacity: 2 },
    ],
  },
  {
    id: "plaza",
    kinds: ["plaza"],
    entry: "street",
    zones: [
      { id: "street", name: "the street mouth", tags: ["exposed"], links: ["open", "wreck", "stalls"], capacity: 4 },
      { id: "open", name: "the open ground", tags: ["exposed"], links: ["street", "wreck", "stalls", "overpass"], capacity: 6 },
      { id: "wreck", name: "behind the overturned bus", tags: ["cover", "flammable"], links: ["street", "open"], capacity: 2 },
      { id: "stalls", name: "the collapsed stalls", tags: ["cover", "rubble"], links: ["street", "open"], capacity: 3 },
      { id: "overpass", name: "up on the broken overpass", tags: ["high"], links: ["open"], capacity: 1 },
    ],
  },
  {
    id: "flooded",
    kinds: ["chamber", "corridor"],
    entry: "ledge",
    zones: [
      { id: "ledge", name: "the dry ledge", tags: ["choke", "cover"], links: ["shallows"], capacity: 2 },
      { id: "shallows", name: "the shallows", tags: ["water", "exposed"], links: ["ledge", "deep", "pipes"], capacity: 4 },
      { id: "deep", name: "the deep water", tags: ["water", "confined"], links: ["shallows"], capacity: 2 },
      { id: "pipes", name: "the pipe run above the water", tags: ["high"], links: ["shallows"], capacity: 1 },
    ],
  },
  {
    id: "stairwell",
    kinds: ["stairwell"],
    entry: "landing",
    zones: [
      { id: "landing", name: "the landing", tags: ["choke"], links: ["flight"], capacity: 2 },
      { id: "flight", name: "the flight of stairs", tags: ["choke", "confined"], links: ["landing", "bottom"], capacity: 1 },
      { id: "bottom", name: "the bottom of the stairs", tags: ["dark"], links: ["flight"], capacity: 3 },
    ],
  },
  {
    id: "lair",
    kinds: ["lair"],
    entry: "approach",
    zones: [
      { id: "approach", name: "the approach", tags: ["choke"], links: ["killing_floor"], capacity: 2 },
      { id: "killing_floor", name: "the killing floor", tags: ["exposed"], links: ["approach", "spoil", "ledge", "drain"], capacity: 8 },
      { id: "spoil", name: "the spoil heap", tags: ["cover", "rubble", "high"], links: ["killing_floor"], capacity: 2 },
      { id: "ledge", name: "the ledge", tags: ["high", "cover"], links: ["killing_floor"], capacity: 1 },
      { id: "drain", name: "the drain", tags: ["confined", "choke", "water"], links: ["killing_floor"], capacity: 1 },
    ],
  },
  {
    id: "safe",
    kinds: ["safe_room", "guild"],
    entry: "door",
    zones: [
      { id: "door", name: "just inside the door", tags: ["choke"], links: ["main"], capacity: 1 },
      { id: "main", name: "the main room", tags: [], links: ["door"], capacity: 4 },
    ],
  },
];

export function layoutsFor(kind: NodeKind): LayoutTemplate[] {
  return LAYOUTS.filter((l) => l.kinds.includes(kind));
}

/* ========================================================================
   FEATURES — the reason a fight has more than one correct answer
   ======================================================================== */

export interface FeatureTemplate {
  id: string;
  name: string;
  kind:
    | "topple" | "ignite" | "collapse" | "electrify" | "vent" | "winch" | "gas" | "cache" | "barricade_stock";
  dc: number;
  check: { stat?: "str" | "dex" | "con" | "int" | "cha"; skill?: string };
  note: string;
  /** Zone tags this can only appear on. Empty means anywhere. */
  requires: ZoneTag[];
  /** What it arms. Gas primes fire; water primes electricity. */
  primes?: string[];
  verb: string;
}

export const FEATURES: readonly FeatureTemplate[] = [
  {
    id: "bus", name: "the overturned bus", kind: "topple", dc: 13, check: { stat: "str" },
    requires: ["cover"], verb: "shoulder over",
    note: "Eleven tonnes balanced on a kerb. Everything under it stops being a problem and starts being a mess.",
  },
  {
    id: "shelving", name: "the loaded shelving", kind: "topple", dc: 10, check: { stat: "str" },
    requires: ["cover"], verb: "haul down",
    note: "Three metres of steel racking that has been thinking about falling since the ceiling came down.",
  },
  {
    id: "vending", name: "the vending machine", kind: "topple", dc: 11, check: { stat: "str" },
    requires: [], verb: "tip",
    note: "Four hundred kilos of confectionery and disappointment.",
  },
  {
    id: "gas_main", name: "the ruptured gas main", kind: "gas", dc: 8, check: { skill: "engineering" },
    requires: [], verb: "open up", primes: ["fire"],
    note: "You can hear it. Everyone in this room can hear it. Nobody has done anything about it yet.",
  },
  {
    id: "fuel", name: "the split fuel drum", kind: "ignite", dc: 7, check: {},
    requires: ["flammable"], verb: "light",
    note: "It has been leaking downhill for an hour and the downhill is where the fighting is.",
  },
  {
    id: "brazier", name: "the burning brazier", kind: "ignite", dc: 6, check: {},
    requires: [], verb: "kick over",
    note: "Somebody was keeping warm here recently enough that it is still keeping warm.",
  },
  {
    id: "live_cable", name: "the severed cable", kind: "electrify", dc: 12, check: { skill: "electrical" },
    requires: [], verb: "drop into the water",
    note: "Still live. The substation two streets over does not know the street is gone.",
  },
  {
    id: "pillar", name: "the cracked support pillar", kind: "collapse", dc: 14, check: { skill: "demolitions" },
    requires: [], verb: "bring down",
    note: "Load-bearing, which means the ceiling above it is a weapon you have not picked up yet.",
  },
  {
    id: "scaffold", name: "the scaffold tower", kind: "collapse", dc: 11, check: { stat: "str" },
    requires: ["high"], verb: "kick out the base of",
    note: "Held together by three couplers and an optimistic assumption.",
  },
  {
    id: "grate", name: "the storm grate", kind: "vent", dc: 9, check: { stat: "str" },
    requires: [], verb: "lever open",
    note: "Goes somewhere. Somewhere is a substantial improvement on here.",
  },
  {
    id: "hoist", name: "the cargo hoist", kind: "winch", dc: 10, check: { stat: "dex" },
    requires: [], verb: "release",
    note: "Whatever is on the end of it comes down at whatever is underneath it.",
  },
  {
    id: "cache", name: "a stashed crate", kind: "cache", dc: 8, check: { skill: "lockpicking" },
    requires: ["cover"], verb: "crack open",
    note: "Somebody hid this and did not come back for it. Both halves of that are informative.",
  },
  {
    id: "timber", name: "a stack of timber and steel", kind: "barricade_stock", dc: 0, check: {},
    requires: [], verb: "drag across",
    note: "Enough to close a doorway properly, given twenty minutes you may not have.",
  },
];
