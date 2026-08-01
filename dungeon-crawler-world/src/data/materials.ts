import type { NodeKind, ZoneTag } from "../core/types.ts";

/**
 * What the dungeon is physically made of.
 *
 * Until now a room was a set of tactical properties — a choke point, standing
 * water, something that would take a light — and the walls were scenery. That
 * is fine right up until somebody says "the walls are brick and mortar and
 * limestone; I'll take a pipe off the wall and knock the limestone out, and
 * later I'll burn it into quicklime." Nothing in a tactical description can
 * answer that, and answering it with a canned refusal is the game telling a
 * player that their good idea is not a real idea.
 *
 * So rooms are made of substances now, and a substance is a bag of PROPERTIES
 * rather than a name. Nothing anywhere keys on `limestone`. Things key on
 * `carbonate`, `brittle`, `refractory`, `oxidiser` — which is what lets one
 * rule about roasting carbonates cover limestone, chalk, marble, shell and
 * bone without any of them being written down as a special case, and what lets
 * a player's chemistry work because it is chemistry and not because somebody
 * anticipated them.
 *
 * Two rules hold the whole file up:
 *
 *   1. TAGS ARE CLOSED. `MatTag` is a union, not a string. A material cannot
 *      carry a property the rules have never heard of, which is the same
 *      discipline `src/core/proposal.ts` applies to a language model and for
 *      the same reason: a novel tag is a property nothing defends against.
 *
 *   2. DEPOSITS ARE DERIVED, NOT STORED. What is in a wall is a pure function
 *      of the world seed and the room's own tags. Only what you have TAKEN and
 *      the STRAIN you left behind persist, so a floor's worth of geology costs
 *      a few integers instead of a few thousand.
 */

/* ------------------------------------------------------------ properties */

/**
 * Every property a substance can have, and the entire vocabulary the
 * transformation rules are allowed to reason in.
 *
 * Grouped by what the property tells you, because the groups are how the rules
 * read: composition decides what a reaction does, behaviour decides whether you
 * can work it, reactivity decides what it does to you, and history decides what
 * has already been done to it.
 */
export type MatTag =
  /* composition — what it is */
  | "carbonate"
  | "oxide"
  | "metal"
  | "silicate"
  | "sulphide"
  | "salt"
  | "organic"
  /* behaviour — how it handles */
  | "brittle"
  | "dense"
  | "fibrous"
  | "malleable"
  | "refractory"
  | "granular"
  | "crystalline"
  /* reactivity — what it does */
  | "combustible"
  | "volatile"
  | "oxidiser"
  | "conductive"
  | "hygroscopic"
  | "reactive"
  | "acidic"
  | "alkaline"
  | "caustic"
  | "toxic"
  /* history — what has been done to it */
  | "calcined"
  | "slaked"
  | "powdered"
  | "purified";

export const MAT_TAGS: readonly MatTag[] = [
  "carbonate", "oxide", "metal", "silicate", "sulphide", "salt", "organic",
  "brittle", "dense", "fibrous", "malleable", "refractory", "granular", "crystalline",
  "combustible", "volatile", "oxidiser", "conductive", "hygroscopic", "reactive",
  "acidic", "alkaline", "caustic", "toxic",
  "calcined", "slaked", "powdered", "purified",
];

const MAT_TAG_SET: ReadonlySet<string> = new Set(MAT_TAGS);

/** Nothing enters the rules without going through here. */
export function isMatTag(s: string): s is MatTag {
  return MAT_TAG_SET.has(s);
}

/**
 * What you have to be holding to get it out of the wall.
 *
 * Deliberately a class rather than an item: a fire axe, a machete and a
 * butcher's cleaver are all an edge, and requiring a specific item is how you
 * end up telling somebody their axe is the wrong kind of axe.
 */
export type ToolClass = "edge" | "lever" | "percussion" | "cutting" | "fine";

export const TOOL_CLASSES: readonly ToolClass[] = ["edge", "lever", "percussion", "cutting", "fine"];

/**
 * Which item tags count as which class. Read off the catalogue that already
 * exists rather than adding a `toolClass` field to sixty items — a crowbar was
 * already tagged as a tool and a sledgehammer was already a bludgeon.
 */
export const TOOL_TAGS: Record<ToolClass, readonly string[]> = {
  edge: ["blades"],
  percussion: ["bludgeon"],
  lever: ["tool"],
  cutting: ["blades", "craft"],
  fine: ["tool", "utility"],
};

/** Specific items that are the class regardless of how they are tagged. */
export const TOOL_ITEMS: Record<ToolClass, readonly string[]> = {
  edge: ["fire_axe", "machete", "cleaver"],
  percussion: ["sledge", "pipe", "rebar", "crowbar"],
  lever: ["crowbar", "pipe", "rebar", "toolkit"],
  cutting: ["fire_axe", "machete", "knife_kitchen", "cleaver", "toolkit"],
  fine: ["toolkit", "lockpicks", "first_aid", "detonator"],
};

/* ------------------------------------------------------------ materials */

export interface MaterialDef {
  id: string;
  name: string;
  /** Singular, for "a unit of ___". */
  unit: string;
  tags: MatTag[];
  /** Kilograms per unit. Load-bearing: this is what stops you taking a wall. */
  kg: number;
  /** Gold per unit. Raw substance is close to worthless and that is the point —
   *  it is worth something once you have done something to it. */
  value: number;
  desc: string;
  /**
   * Where it occurs. Absent means it never appears in a wall — every product of
   * a transformation is in this catalogue too, and none of them are minable.
   */
  occurs?: Occurrence;
  /**
   * Taking it out weakens what it was part of. Stone, brick and structural
   * steel do; moss growing on the stone does not.
   */
  structural?: boolean;
  /** What working it wants. `null` means hands. */
  tool?: ToolClass | null;
  /** Minutes per unit, before any skill. */
  minutes?: number;
  /** Difficulty of getting it out cleanly. */
  dc?: number;
}

export interface Occurrence {
  /** Zone tags any of which will do. Empty means any zone. */
  zones?: ZoneTag[];
  /** Room kinds any of which will do. Empty means any room. */
  nodes?: NodeKind[];
  /** Floors between these, inclusive. */
  floors?: [number, number];
  /** 0..1, before the room's own tags adjust it. */
  chance: number;
  /** Units present when it is present. */
  units: [number, number];
}

/**
 * The catalogue.
 *
 * Raw materials first, then the things you can only get by doing something to
 * them. The split matters: a product has no `occurs`, so no amount of digging
 * at a wall will ever produce quicklime. You have to burn the limestone.
 */
export const MATERIALS: readonly MaterialDef[] = [
  /* ------------------------------------------------------------- masonry */
  {
    id: "limestone", name: "Limestone", unit: "block",
    tags: ["carbonate", "brittle", "dense"],
    kg: 4.0, value: 1, structural: true, tool: "percussion", minutes: 12, dc: 8,
    desc: "Pale, soft enough to score with a nail, and the reason half the dungeon smells faintly of a quarry. Roast it hard enough for long enough and it stops being stone.",
    occurs: { zones: ["rubble", "confined"], chance: 0.55, units: [3, 9] },
  },
  {
    id: "brick", name: "Fired Brick", unit: "brick",
    tags: ["silicate", "brittle", "refractory"],
    kg: 2.8, value: 1, structural: true, tool: "percussion", minutes: 8, dc: 7,
    desc: "Somebody's terrace, demolished into a dungeon wall along with the rest of the planet. Takes heat without complaint, which makes it the cheapest furnace lining there is.",
    occurs: { zones: [], chance: 0.4, units: [4, 12] },
  },
  {
    id: "mortar", name: "Old Mortar", unit: "handful",
    tags: ["carbonate", "granular", "brittle"],
    kg: 0.9, value: 1, structural: true, tool: null, minutes: 4, dc: 5,
    desc: "Crumbles out of the joints if you lean on it. Lime, sand, and a century of nobody looking.",
    occurs: { zones: [], chance: 0.45, units: [2, 8] },
  },
  {
    id: "granite", name: "Granite", unit: "slab",
    tags: ["silicate", "dense", "refractory", "crystalline"],
    kg: 9.5, value: 3, structural: true, tool: "percussion", minutes: 25, dc: 13,
    desc: "Does not care. Will not burn, will not crack usefully, and weighs what it looks like it weighs.",
    occurs: { zones: ["rubble"], floors: [3, 99], chance: 0.3, units: [1, 4] },
  },
  {
    id: "sandstone", name: "Sandstone", unit: "block",
    tags: ["silicate", "granular", "brittle"],
    kg: 3.4, value: 1, structural: true, tool: "percussion", minutes: 9, dc: 6,
    desc: "Comes away in sheets and gets everywhere. Grind it and it is sand, which is more useful than it sounds.",
    occurs: { zones: ["rubble", "exposed"], chance: 0.35, units: [3, 8] },
  },
  {
    id: "gypsum", name: "Gypsum", unit: "lump",
    tags: ["salt", "brittle", "granular", "hygroscopic"],
    kg: 2.1, value: 2, structural: false, tool: "percussion", minutes: 7, dc: 6,
    desc: "Chalky white veins running through the wall. Burn the water out of it and it sets like a cast, which is exactly what it is for.",
    occurs: { zones: ["confined", "dark"], chance: 0.22, units: [2, 5] },
  },
  {
    id: "clay", name: "Wet Clay", unit: "lump",
    tags: ["silicate", "granular", "hygroscopic"],
    kg: 2.6, value: 1, structural: false, tool: null, minutes: 5, dc: 4,
    desc: "Where the water has been sitting long enough. Holds any shape you press into it and holds heat once fired.",
    occurs: { zones: ["water"], chance: 0.5, units: [2, 6] },
  },
  {
    id: "quartz", name: "Quartz", unit: "crystal",
    tags: ["silicate", "crystalline", "refractory"],
    kg: 0.7, value: 12, structural: false, tool: "percussion", minutes: 14, dc: 11,
    desc: "Clear seams in the darker rock. Melts at a temperature you will not reach by accident, which is what makes it worth something.",
    occurs: { zones: ["dark", "rubble"], floors: [2, 99], chance: 0.18, units: [1, 3] },
  },

  /* -------------------------------------------------------------- metals */
  {
    id: "steel_stock", name: "Structural Steel", unit: "length",
    tags: ["metal", "dense", "conductive", "malleable"],
    kg: 6.5, value: 8, structural: true, tool: "cutting", minutes: 30, dc: 14,
    desc: "Beams, joists, and the bones of the building that used to be here. Cutting a piece free takes proper tools and proper time, and the ceiling notices.",
    occurs: { zones: ["high", "rubble"], chance: 0.28, units: [1, 3] },
  },
  {
    id: "pipe_stock", name: "Pipework", unit: "length",
    tags: ["metal", "malleable", "conductive"],
    kg: 2.4, value: 5, structural: true, tool: "lever", minutes: 11, dc: 9,
    desc: "Runs along the wall at head height, threaded at both ends and full of something or nothing. Comes off with a bar and some conviction.",
    occurs: { zones: [], chance: 0.42, units: [1, 4] },
  },
  {
    id: "copper_stock", name: "Copper", unit: "length",
    tags: ["metal", "malleable", "conductive", "purified"],
    kg: 1.6, value: 22, structural: false, tool: "cutting", minutes: 13, dc: 10,
    desc: "Stripped out of everything by everybody, everywhere, always. There is a reason there is never any left.",
    occurs: { zones: ["confined", "dark"], chance: 0.24, units: [1, 3] },
  },
  {
    id: "lead_stock", name: "Lead", unit: "sheet",
    tags: ["metal", "dense", "malleable", "toxic"],
    kg: 5.2, value: 14, structural: false, tool: "cutting", minutes: 10, dc: 8,
    desc: "Flashing, ballast, and old plumbing. Soft, heavy, poisonous, and the only thing on the floor that stops what the deeper floors put out.",
    occurs: { zones: ["high"], floors: [4, 99], chance: 0.2, units: [1, 3] },
  },
  {
    id: "zinc_stock", name: "Zinc", unit: "sheet",
    tags: ["metal", "malleable", "reactive"],
    kg: 1.9, value: 16, structural: false, tool: "cutting", minutes: 9, dc: 9,
    desc: "Galvanising, peeled off in dull grey curls. Reactive enough to be interesting and cheap enough to waste finding out.",
    occurs: { zones: ["water", "exposed"], floors: [2, 99], chance: 0.2, units: [1, 4] },
  },
  {
    id: "alu_stock", name: "Aluminium", unit: "offcut",
    tags: ["metal", "malleable", "reactive", "conductive"],
    kg: 0.9, value: 18, structural: false, tool: "cutting", minutes: 8, dc: 8,
    desc: "Window frames, ladders, and the trim off a hundred thousand shopfronts. Harmless in a sheet. Not harmless as a powder.",
    occurs: { zones: [], floors: [2, 99], chance: 0.26, units: [1, 4] },
  },
  {
    id: "rust", name: "Iron Scale", unit: "scrape",
    tags: ["oxide", "granular", "oxidiser"],
    kg: 0.5, value: 2, structural: false, tool: null, minutes: 3, dc: 4,
    desc: "Flakes off anything that has been damp for a season. It is iron that has already found its oxygen and would very much like to give it to something else.",
    occurs: { zones: ["water", "rubble"], chance: 0.5, units: [2, 7] },
  },
  {
    id: "slag", name: "Furnace Slag", unit: "lump",
    tags: ["oxide", "granular", "refractory"],
    kg: 3.1, value: 2, structural: false, tool: "percussion", minutes: 6, dc: 6,
    desc: "Glassy, blistered, and dumped by whatever was smelting down here before the dungeon was. Useless and heat-proof, which is not the same as useless.",
    occurs: { nodes: ["lair", "vault"], floors: [3, 99], chance: 0.3, units: [2, 6] },
  },

  /* ------------------------------------------------------------- burnables */
  {
    id: "timber", name: "Timber", unit: "beam",
    tags: ["organic", "fibrous", "combustible"],
    kg: 5.8, value: 2, structural: true, tool: "cutting", minutes: 14, dc: 8,
    desc: "Joists, pallets, and shoring. Dry as a bone down here and it knows it.",
    occurs: { zones: ["flammable", "rubble"], chance: 0.5, units: [2, 6] },
  },
  {
    id: "coal", name: "Coal", unit: "sack",
    tags: ["organic", "combustible", "granular"],
    kg: 4.4, value: 6, structural: false, tool: null, minutes: 6, dc: 5,
    desc: "Seams in the wall on the older floors, or somebody's stockpile. Burns hot and long, which is the only way to get a fire to do work rather than make light.",
    occurs: { zones: ["dark", "confined"], floors: [2, 99], chance: 0.3, units: [2, 8] },
  },
  {
    id: "tar", name: "Tar", unit: "pot",
    tags: ["organic", "combustible", "volatile"],
    kg: 2.3, value: 9, structural: false, tool: null, minutes: 7, dc: 6,
    desc: "Seeping out of a joint or left in a bucket by whoever was fixing the roof when the sky went. Sticks, spreads, and does not go out politely.",
    occurs: { zones: ["flammable"], chance: 0.3, units: [1, 4] },
  },
  {
    id: "resin", name: "Resin", unit: "wad",
    tags: ["organic", "combustible", "volatile"],
    kg: 0.6, value: 14, structural: false, tool: "edge", minutes: 6, dc: 7,
    desc: "Weeping out of whatever is growing through the wall. Sticky, aromatic, and it takes a light off a spark.",
    occurs: { zones: ["flammable", "dark"], floors: [2, 99], chance: 0.24, units: [1, 4] },
  },
  {
    id: "tallow", name: "Rendered Fat", unit: "block",
    tags: ["organic", "combustible"],
    kg: 1.5, value: 7, structural: false, tool: null, minutes: 5, dc: 5,
    desc: "Off something that was recently upright. Candles, grease, soap, and a slow steady flame that will not go out in a draught.",
    occurs: { nodes: ["lair"], chance: 0.35, units: [1, 4] },
  },
  {
    id: "rope_fibre", name: "Raw Fibre", unit: "hank",
    tags: ["organic", "fibrous", "combustible"],
    kg: 0.4, value: 3, structural: false, tool: null, minutes: 4, dc: 4,
    desc: "Unravelled off something that was holding something else up. Cordage, wick, wadding, tinder.",
    occurs: { zones: [], chance: 0.4, units: [2, 6] },
  },

  /* ------------------------------------------------------------ chemistry */
  {
    id: "nitre", name: "Wall Nitre", unit: "scrape",
    tags: ["salt", "oxidiser", "crystalline", "hygroscopic"],
    kg: 0.3, value: 26, structural: false, tool: null, minutes: 9, dc: 8,
    desc: "White furring on old damp stone where the wall has been quietly making it out of everything that has died against it. Every powder mill in history started with somebody scraping this off a cellar.",
    occurs: { zones: ["confined", "dark", "water"], chance: 0.28, units: [1, 5] },
  },
  {
    id: "sulphur", name: "Sulphur", unit: "lump",
    tags: ["sulphide", "combustible", "brittle", "toxic"],
    kg: 0.8, value: 30, structural: false, tool: "percussion", minutes: 8, dc: 9,
    desc: "Yellow crust around anything venting hot. Smells like the floor is warning you, because it is.",
    occurs: { zones: ["exposed", "rubble"], floors: [4, 99], chance: 0.25, units: [1, 4] },
  },
  {
    id: "rock_salt", name: "Rock Salt", unit: "lump",
    tags: ["salt", "crystalline", "hygroscopic"],
    kg: 1.2, value: 5, structural: false, tool: "percussion", minutes: 5, dc: 5,
    desc: "Seams of it, tasting of exactly what it is. Preserves, melts ice, ruins metal, and carries a current once it is wet.",
    occurs: { zones: ["water", "dark"], chance: 0.25, units: [2, 6] },
  },
  {
    id: "ash", name: "Wood Ash", unit: "scoop",
    tags: ["oxide", "granular", "alkaline"],
    kg: 0.7, value: 2, structural: false, tool: null, minutes: 3, dc: 3,
    desc: "Whatever burned here last. Soak it and pour off the water and you have something that will take the skin off your hands, which people have known for six thousand years.",
    occurs: { zones: ["flammable"], chance: 0.45, units: [2, 8] },
  },
  {
    id: "glass_cullet", name: "Broken Glass", unit: "double handful",
    tags: ["silicate", "brittle", "crystalline"],
    kg: 1.1, value: 2, structural: false, tool: null, minutes: 4, dc: 6,
    desc: "There was a lot of glass on Earth and all of it arrived here at once.",
    occurs: { zones: [], chance: 0.4, units: [2, 8] },
  },

  /* -------------------------------------------------------------- organic */
  {
    id: "bone_stock", name: "Bone", unit: "armful",
    tags: ["organic", "carbonate", "brittle"],
    kg: 1.8, value: 3, structural: false, tool: null, minutes: 5, dc: 5,
    desc: "Some of it is not human and some of it is. Burn it white and it is lime and phosphate, which is a rude thing to know about a friend.",
    occurs: { nodes: ["lair", "shrine", "vault"], chance: 0.4, units: [2, 6] },
  },
  {
    id: "chitin", name: "Chitin Plate", unit: "plate",
    tags: ["organic", "fibrous", "refractory"],
    kg: 1.3, value: 18, structural: false, tool: "edge", minutes: 10, dc: 9,
    desc: "Off the things down here that came with their own armour. Light, stiff, and it laughs at a flame.",
    occurs: { nodes: ["lair"], floors: [2, 99], chance: 0.35, units: [1, 4] },
  },
  {
    id: "spore_cap", name: "Spore Cap", unit: "cap",
    tags: ["organic", "toxic", "volatile"],
    kg: 0.3, value: 24, structural: false, tool: null, minutes: 6, dc: 8,
    desc: "Growing where the dead are. Burst it in a confined space and everything in the room finds out at the same time.",
    occurs: { zones: ["dark", "confined"], floors: [2, 99], chance: 0.24, units: [1, 4] },
  },
  {
    id: "ichor", name: "Ichor", unit: "flask",
    tags: ["organic", "reactive", "toxic", "volatile"],
    kg: 0.5, value: 45, structural: false, tool: "fine", minutes: 12, dc: 12,
    desc: "Drained carefully out of something that was using it. Still warm, still moving slightly, and it eats through the wrong container in about an hour.",
    occurs: { nodes: ["lair"], floors: [3, 99], chance: 0.22, units: [1, 3] },
  },
  {
    id: "mana_shard", name: "Mana Shard", unit: "shard",
    tags: ["crystalline", "reactive", "purified"],
    kg: 0.2, value: 90, structural: false, tool: "fine", minutes: 18, dc: 14,
    desc: "Grown, not formed. Holds a charge that is not electrical and does not leak, and the dungeon prices it accordingly.",
    occurs: { nodes: ["shrine", "vault"], floors: [3, 99], chance: 0.18, units: [1, 2] },
  },

  /* ---------------------------------------------------------- ONLY MADE */
  /* Nothing below occurs in a wall. Every one is the output of doing        */
  /* something to something above, which is the whole point of the layer.    */
  {
    id: "quicklime", name: "Quicklime", unit: "measure",
    tags: ["oxide", "alkaline", "caustic", "calcined", "hygroscopic", "reactive", "powdered"],
    kg: 1.1, value: 55,
    desc: "What limestone becomes when it has been held hot for long enough to drive the gas out of it. It is thirsty in a way that stone is not: it takes water back with enough heat to set fire to what it is packed in, and it does the same thing to anything wet it lands on. Handle it dry, handle it in gloves, and do not breathe it.",
  },
  {
    id: "slaked_lime", name: "Slaked Lime", unit: "measure",
    tags: ["alkaline", "caustic", "slaked", "powdered"],
    kg: 1.4, value: 40,
    desc: "Quicklime that has already had its water and got the heat out of its system. Still caustic, no longer dangerous to keep, and it sets hard in air.",
  },
  {
    id: "plaster", name: "Plaster", unit: "measure",
    tags: ["salt", "calcined", "powdered", "hygroscopic"],
    kg: 1.0, value: 30,
    desc: "Calcined gypsum. Add water, get four minutes, then get stone. Casts, moulds, seals, and one or two things nobody has told the dungeon about yet.",
  },
  {
    id: "charcoal", name: "Charcoal", unit: "sack",
    tags: ["organic", "combustible", "granular", "purified"],
    kg: 2.0, value: 22,
    desc: "Wood cooked without air until only the carbon is left. Burns hotter and cleaner than what it was made from, which is the only reason anybody ever smelted anything.",
  },
  {
    id: "lye", name: "Lye", unit: "flask",
    tags: ["alkaline", "caustic", "reactive"],
    kg: 1.2, value: 48,
    desc: "Ash, leached with water and boiled down. It saponifies fat, it strips paint, and it does not distinguish between those and skin.",
  },
  {
    id: "acid", name: "Acid", unit: "flask",
    tags: ["acidic", "caustic", "reactive", "volatile"],
    kg: 1.3, value: 85,
    desc: "Roasted, condensed and caught in glass. Eats metal, eats stone slowly, eats you quickly, and fumes the whole time it is doing it.",
  },
  {
    id: "metal_fuel", name: "Metal Powder", unit: "measure",
    tags: ["metal", "powdered", "reactive", "combustible"],
    kg: 0.8, value: 70,
    desc: "A reactive metal taken down to a dust. In a sheet it is a window frame. At this particle size the same metal has enough surface that it stops behaving like a metal and starts behaving like a fuel.",
  },
  {
    id: "oxide_fines", name: "Oxide Fines", unit: "measure",
    tags: ["oxide", "powdered", "oxidiser", "granular"],
    kg: 0.9, value: 45,
    desc: "Iron scale ground to a flour. It is carrying oxygen, it is not carrying anything else, and it is looking for something hungrier than iron to give it to.",
  },
  {
    id: "black_powder", name: "Milled Powder", unit: "measure",
    tags: ["oxidiser", "combustible", "granular", "powdered"],
    kg: 1.0, value: 60,
    desc: "Nitre, charcoal and sulphur, milled wet and dried in a thin layer well away from anything you are fond of. The oldest thing on this list by five hundred years.",
  },
  {
    id: "glass_stock", name: "Worked Glass", unit: "vessel",
    tags: ["silicate", "brittle", "refractory", "purified"],
    kg: 0.8, value: 55,
    desc: "Cullet remelted into something that holds a liquid you would not put in a metal pot. The reason an alchemy bench is glassware and not saucepans.",
  },
  {
    id: "pig_iron", name: "Pig Iron", unit: "ingot",
    tags: ["metal", "dense", "malleable", "purified"],
    kg: 4.0, value: 95,
    desc: "Ore and charcoal and a great deal of air, held long enough that the metal runs out of the bottom. Brittle, useful, and the start of everything sharp.",
  },
  {
    id: "sand", name: "Sand", unit: "sack",
    tags: ["silicate", "granular", "refractory"],
    kg: 2.4, value: 4,
    desc: "Ground out of sandstone, or swept up. Moulds, filters, ballast, and — with enough heat and enough alkali — glass.",
  },
];

export const MATERIAL_BY_ID: Record<string, MaterialDef> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m]),
);

/** Everything that can be dug out of a wall, in catalogue order. */
export const RAW_MATERIALS: readonly MaterialDef[] = MATERIALS.filter((m) => m.occurs);

/** Everything that only exists because somebody made it. */
export const MADE_MATERIALS: readonly MaterialDef[] = MATERIALS.filter((m) => !m.occurs);

export function hasTag(m: MaterialDef | undefined, t: MatTag): boolean {
  return !!m && m.tags.includes(t);
}

/** Materials carrying every tag in `want`. The transformation table's index. */
export function materialsWith(...want: MatTag[]): MaterialDef[] {
  return MATERIALS.filter((m) => want.every((t) => m.tags.includes(t)));
}
