import type { MatTag } from "./materials.ts";
import type { Requirement } from "../core/proposal.ts";

/**
 * Doing something to a substance until it is a different substance.
 *
 * Every rule here is keyed on PROPERTIES, never on a material id. "Roast a
 * carbonate hard enough for long enough" is one rule and it covers limestone,
 * mortar, chalk and bone, none of which are mentioned. That is the difference
 * between a crafting table and a chemistry: a crafting table can only make what
 * somebody wrote down, and a chemistry makes whatever follows from what you
 * have.
 *
 * It is also why this layer works with no language model attached. A player who
 * says "burn the limestone into quicklime" is describing calcination, and
 * calcination is here, so the offline path answers it exactly — same product,
 * same tags, same numbers — and a model attached later is upgrading the game's
 * VOCABULARY rather than its capability. That distinction is the whole safety
 * argument: the model can help the engine understand more sentences; it cannot
 * help the engine do more things.
 *
 * The requirements are the honest part. Nothing here asks whether you deserve
 * the product. It asks whether you have nine hundred degrees, and for how long,
 * and in what, and whether you can stand to be in the room while it happens.
 */

export interface Product {
  /**
   * A catalogue material, when the thing has a name people already know.
   * Otherwise the product is derived from the input by the rules below.
   */
  id?: string;
  /** How the product is named when derived. "Burnt" gives "Burnt Bone". */
  prefix?: string;
  suffix?: string;
  add?: MatTag[];
  drop?: MatTag[];
  /** Multiplier on the input's mass per unit. Calcining a carbonate loses 44%. */
  mass?: number;
  /** Multiplier on the input's value. Work is what makes a thing worth more. */
  worth?: number;
  desc?: string;
}

export interface TransformRule {
  id: string;
  name: string;
  /** Ways somebody might say it. Matched loosely; the model widens this, never the effects. */
  says: string[];
  /** The input must carry all of these. */
  wants: MatTag[];
  /** ...and none of these. */
  refuses?: MatTag[];
  /** A second input, when the reaction takes two things. */
  with?: { wants: MatTag[]; qty: number };
  needs: Requirement[];
  /** Units consumed to units produced. */
  ratio: { in: number; out: number };
  makes: Product;
  /** Named products for named inputs, because "Burnt Limestone" has a real name. */
  prefer?: Record<string, string>;
  under: string;
  minutes: number;
  /** Shown to the player when it works. The reason, not the flavour. */
  because: string;
}

export const TRANSFORMS: readonly TransformRule[] = [
  /* ------------------------------------------------------------ by heat */
  {
    id: "calcine",
    name: "Calcining",
    says: ["calcine", "burn the", "roast", "cook", "fire the", "bake", "kiln", "quicklime", "burnt lime", "lime"],
    wants: ["carbonate"],
    needs: [{ k: "heat", minC: 850, holdHours: 3 }, { k: "vessel", kind: "open" }, { k: "ventilation", kind: "open" }],
    ratio: { in: 3, out: 2 },
    prefer: { limestone: "quicklime", mortar: "quicklime" },
    makes: {
      prefix: "Burnt",
      add: ["oxide", "alkaline", "caustic", "calcined", "hygroscopic", "reactive", "powdered"],
      drop: ["carbonate", "brittle", "dense", "granular"],
      mass: 0.56, worth: 20,
      desc: "Held hot until the gas came out of it and did not come back. It is thirsty now in a way stone is not, and what it does to water it will do to anything wet.",
    },
    under: "alchemy", minutes: 200,
    because: "A carbonate held above about eight hundred and fifty degrees gives up its carbon dioxide and what is left is the oxide. That is the whole of it, and people have been doing it in pits since before anybody wrote anything down.",
  },
  {
    id: "plaster",
    name: "Burning Plaster",
    says: ["plaster", "calcine the gypsum", "burn the gypsum", "roast the gypsum", "make a cast"],
    wants: ["salt", "hygroscopic"],
    refuses: ["calcined"],
    needs: [{ k: "heat", minC: 160, holdHours: 2 }, { k: "vessel", kind: "open" }],
    ratio: { in: 2, out: 2 },
    prefer: { gypsum: "plaster" },
    makes: {
      prefix: "Burnt", add: ["calcined", "powdered"], drop: ["brittle", "crystalline"],
      mass: 0.79, worth: 8,
      desc: "Driven off most of its water. Give it back and you have four minutes before it is stone again.",
    },
    under: "alchemy", minutes: 90,
    because: "Gypsum is a salt that keeps water in its crystal. Take three quarters of that water out with gentle heat and it will take it back on demand, hard, in minutes.",
  },
  {
    id: "char",
    name: "Charring",
    says: ["char", "make charcoal", "charcoal", "coke", "cook the wood", "without air", "no air", "pyrolyse", "pyrolyze"],
    wants: ["organic", "combustible"],
    refuses: ["powdered", "purified"],
    needs: [{ k: "heat", minC: 400, holdHours: 4 }, { k: "vessel", kind: "sealed" }],
    ratio: { in: 3, out: 2 },
    prefer: { timber: "charcoal", rope_fibre: "charcoal", bone_stock: "charcoal" },
    makes: {
      prefix: "Charred", add: ["purified", "granular"], drop: ["fibrous", "volatile"],
      mass: 0.35, worth: 9,
      desc: "Cooked in the absence of air until everything that was not carbon had left. Burns hotter and cleaner than the thing it came from.",
    },
    under: "alchemy", minutes: 260,
    because: "Heat it where the air cannot get to it and everything volatile boils off, leaving carbon. This is the step that makes a fire hot enough to be useful for anything other than warmth.",
  },
  {
    id: "smelt",
    name: "Smelting",
    says: ["smelt", "melt down", "reduce the ore", "cast", "pour", "ingot", "furnace"],
    wants: ["oxide"],
    refuses: ["refractory"],
    with: { wants: ["combustible", "purified"], qty: 1 },
    needs: [{ k: "heat", minC: 1200, holdHours: 4 }, { k: "station", id: "forge" }, { k: "ventilation", kind: "open" }],
    ratio: { in: 3, out: 1 },
    prefer: { rust: "pig_iron", oxide_fines: "pig_iron", slag: "pig_iron" },
    makes: {
      prefix: "Cast", add: ["metal", "dense", "malleable", "purified"], drop: ["oxide", "granular", "oxidiser", "powdered"],
      mass: 1.6, worth: 40,
      desc: "Taken back off the oxygen it had found, and run out of the bottom of the furnace as metal.",
    },
    under: "smithing", minutes: 400,
    because: "Carbon at that temperature wants the oxygen more than the metal does, so it takes it and leaves the metal behind. That trade is the entire Iron Age.",
  },
  {
    id: "glassmake",
    name: "Glassmaking",
    says: ["glass", "melt the sand", "blow", "make a flask", "make a vessel", "glassware", "retort"],
    wants: ["silicate"],
    with: { wants: ["alkaline"], qty: 1 },
    needs: [{ k: "heat", minC: 1100, holdHours: 3 }, { k: "station", id: "forge" }, { k: "tool", klass: "fine" }],
    ratio: { in: 3, out: 2 },
    prefer: { sand: "glass_stock", glass_cullet: "glass_stock", sandstone: "glass_stock", quartz: "glass_stock" },
    makes: {
      prefix: "Worked", add: ["refractory", "purified", "brittle"], drop: ["granular", "powdered"],
      mass: 0.5, worth: 25,
      desc: "Melted with an alkali to bring the temperature within reach, and worked into something that will hold what a metal pot would not.",
    },
    under: "alchemy", minutes: 220,
    because: "Silica alone melts far above anything you can build down here. An alkali drops that by five hundred degrees, which is why every glassworks in history kept a barrel of ash.",
  },

  /* ------------------------------------------------------- by water */
  {
    id: "slake",
    name: "Slaking",
    says: ["slake", "add water", "add it to water", "wet the lime", "hydrate", "quench"],
    wants: ["calcined", "caustic"],
    needs: [{ k: "immersion", medium: "water" }, { k: "vessel", kind: "open" }, { k: "ventilation", kind: "open" }],
    ratio: { in: 2, out: 2 },
    prefer: { quicklime: "slaked_lime" },
    makes: {
      prefix: "Slaked", add: ["slaked", "powdered", "alkaline"], drop: ["calcined", "hygroscopic", "reactive"],
      mass: 1.3, worth: 0.8,
      desc: "It has had its water and got the heat out of its system. Still caustic; no longer dangerous to keep.",
    },
    under: "alchemy", minutes: 40,
    because: "The oxide takes the water back and gives out the heat it swallowed getting made. Do it on purpose in a bucket and it is a chore; do it by accident in your pack and it is a fire.",
  },
  {
    id: "leach",
    name: "Leaching",
    says: ["leach", "lye", "steep", "soak the ash", "pour water through", "wash it out", "extract"],
    wants: ["alkaline", "granular"],
    needs: [{ k: "immersion", medium: "water" }, { k: "vessel", kind: "open" }, { k: "hours", n: 3 }],
    ratio: { in: 3, out: 1 },
    prefer: { ash: "lye" },
    makes: {
      prefix: "Leached", add: ["caustic", "reactive"], drop: ["granular", "oxide", "powdered"],
      mass: 1.7, worth: 20,
      desc: "Water poured slowly through it and boiled back down to what the water took. It takes paint off, and it does not distinguish between paint and skin.",
    },
    under: "alchemy", minutes: 190,
    because: "The soluble part of wood ash is an alkali. Water separates it from everything that is not, and boiling separates it from the water.",
  },
  {
    id: "brine",
    name: "Brining",
    says: ["brine", "salt water", "dissolve the salt", "make a solution", "conduct"],
    wants: ["salt", "crystalline"],
    refuses: ["oxidiser"],
    needs: [{ k: "immersion", medium: "water" }, { k: "vessel", kind: "open" }],
    ratio: { in: 2, out: 2 },
    makes: {
      prefix: "Saturated", add: ["conductive", "reactive"], drop: ["crystalline", "brittle"],
      mass: 1.4, worth: 3,
      desc: "Salt taken into water until the water will not take any more. It carries a current the way a wire does and it ruins metal the way weather does.",
    },
    under: "alchemy", minutes: 30,
    because: "Dissolved salt is ions moving freely, which is what electricity is, which is why the flooded rooms on this floor are more dangerous than they look.",
  },

  /* ------------------------------------------------------- by working */
  {
    id: "mill",
    name: "Milling",
    says: ["grind", "mill", "powder", "crush", "pulverise", "pulverize", "pound", "reduce to dust", "make a powder", "flour"],
    wants: ["brittle"],
    refuses: ["powdered"],
    needs: [{ k: "tool", klass: "percussion" }, { k: "hours", n: 1 }],
    ratio: { in: 2, out: 2 },
    prefer: { rust: "oxide_fines", sandstone: "sand", glass_cullet: "sand" },
    makes: {
      prefix: "Ground", add: ["powdered", "granular"], drop: ["brittle", "dense", "crystalline"],
      mass: 0.9, worth: 2.5,
      desc: "Taken down far enough that the surface stops being a detail and starts being the whole point.",
    },
    under: "alchemy", minutes: 70,
    because: "Nothing changes chemically. What changes is surface area, and surface area is the difference between a thing that burns and a thing that goes off.",
  },
  {
    id: "atomise",
    name: "Atomising",
    says: ["file down", "grind the metal", "metal powder", "filings", "dust the metal", "shave", "rasp", "atomise", "atomize"],
    wants: ["metal", "reactive"],
    refuses: ["powdered"],
    needs: [{ k: "tool", klass: "fine" }, { k: "station", id: "engineering" }, { k: "hours", n: 3 }],
    ratio: { in: 2, out: 1 },
    prefer: { alu_stock: "metal_fuel", zinc_stock: "metal_fuel" },
    makes: {
      prefix: "Powdered", add: ["powdered", "combustible"], drop: ["malleable", "dense", "conductive"],
      mass: 0.6, worth: 14,
      desc: "The same metal, at a particle size where it stops behaving like a metal and starts behaving like a fuel.",
    },
    under: "engineering", minutes: 200,
    because: "A sheet of it is a window frame. A flour of it has enough surface to find every molecule of oxygen at once, which is a different substance in every way that matters.",
  },
  {
    id: "mix_propellant",
    name: "Milling a Propellant",
    says: ["mix the powder", "make powder", "make gunpowder", "black powder", "propellant", "mill it together", "make a charge"],
    wants: ["oxidiser", "crystalline"],
    with: { wants: ["combustible", "purified"], qty: 1 },
    needs: [
      { k: "station", id: "ordnance" }, { k: "immersion", medium: "water" },
      { k: "hours", n: 4 }, { k: "skill", id: "demolitions", level: 3 },
    ],
    ratio: { in: 3, out: 2 },
    prefer: { nitre: "black_powder" },
    makes: {
      id: "black_powder",
      desc: "Milled wet and dried thin, a long way from anything you are fond of.",
    },
    under: "demolitions", minutes: 300,
    because: "An oxidiser and a fuel, ground together fine enough to be one substance rather than two. Milled wet, because milled dry is how the mill stops being there.",
  },
  {
    id: "thermic_mix",
    name: "An Oxide Mix",
    says: ["mix the oxide", "oxide mix", "burn through", "metal and rust", "cutting mix", "burning mix"],
    wants: ["oxide", "powdered", "oxidiser"],
    with: { wants: ["metal", "powdered", "reactive"], qty: 1 },
    needs: [
      { k: "station", id: "ordnance" }, { k: "vessel", kind: "open" },
      { k: "skill", id: "alchemy", level: 5 }, { k: "hours", n: 2 },
    ],
    ratio: { in: 2, out: 1 },
    makes: {
      prefix: "Mixed", suffix: "Charge",
      add: ["oxidiser", "reactive", "powdered", "combustible"], drop: ["granular"],
      mass: 1.2, worth: 9,
      desc: "A grey powder that does not explode. It burns downward at a temperature that stops being a number and starts being a fact, and it does not stop until it has finished.",
    },
    under: "alchemy", minutes: 180,
    because: "A metal that wants oxygen more than iron does, mixed with iron that already has some. The reaction carries its own oxidiser, so smothering it is not an option, and it reaches a temperature nothing structural is rated for.",
  },

  /* ------------------------------------------------------- by chemistry */
  {
    id: "distil_acid",
    name: "Distilling an Acid",
    says: ["make acid", "distil", "distill", "acid", "condense", "vitriol", "fume"],
    wants: ["sulphide"],
    needs: [
      { k: "heat", minC: 600, holdHours: 3 }, { k: "vessel", kind: "sealed" },
      { k: "station", id: "alchemy" }, { k: "ventilation", kind: "open" }, { k: "skill", id: "alchemy", level: 4 },
    ],
    ratio: { in: 3, out: 1 },
    prefer: { sulphur: "acid" },
    makes: {
      prefix: "Distilled", add: ["acidic", "caustic", "reactive", "volatile"], drop: ["combustible", "brittle", "sulphide"],
      mass: 1.6, worth: 30,
      desc: "Roasted, caught, and condensed into glass. Eats metal quickly, stone slowly, and you at a speed that depends entirely on how fast you move.",
    },
    under: "alchemy", minutes: 240,
    because: "Burn a sulphide and catch what comes off, in the presence of water, and what condenses is an acid. Do it in a room without ventilation and what condenses is also in your lungs.",
  },
  {
    id: "render",
    name: "Rendering",
    says: ["render", "boil down", "melt the fat", "tallow", "reduce it down"],
    wants: ["organic", "combustible"],
    refuses: ["fibrous", "purified"],
    needs: [{ k: "heat", minC: 120, holdHours: 1 }, { k: "vessel", kind: "open" }],
    ratio: { in: 2, out: 2 },
    makes: {
      prefix: "Rendered", add: ["purified"], drop: ["granular"],
      mass: 0.8, worth: 4,
      desc: "Boiled down and strained. Burns slow and steady and will not go out in a draught.",
    },
    under: "alchemy", minutes: 70,
    because: "Heat separates what will melt from what will not. Everything after that is straining.",
  },
  {
    id: "saponify",
    name: "Saponifying",
    says: ["soap", "saponify", "mix the lye", "make soap", "boil the lye"],
    wants: ["alkaline", "caustic"],
    with: { wants: ["organic", "combustible"], qty: 1 },
    needs: [{ k: "heat", minC: 100, holdHours: 2 }, { k: "vessel", kind: "open" }],
    ratio: { in: 2, out: 2 },
    makes: {
      prefix: "Saponified", add: ["purified", "combustible"], drop: ["caustic", "reactive", "alkaline"],
      mass: 1.2, worth: 6,
      desc: "A caustic and a fat, boiled together until they have stopped being either. Cleans things, and sticks to what it is burning.",
    },
    under: "alchemy", minutes: 130,
    because: "An alkali and a fat react into something that is neither, which is the oldest useful chemistry there is and also, thickened, one of the nastier ones.",
  },
  {
    id: "electroplate",
    name: "Electrolysing",
    says: ["electrolyse", "electrolyze", "run a current through", "plate", "electrify the", "battery", "cell"],
    wants: ["conductive"],
    needs: [{ k: "current" }, { k: "vessel", kind: "open" }, { k: "station", id: "engineering" }, { k: "hours", n: 2 }],
    ratio: { in: 2, out: 1 },
    makes: {
      prefix: "Refined", add: ["purified"], drop: ["oxide", "granular"],
      mass: 0.8, worth: 22,
      desc: "Taken apart by a current and put back down somewhere else, one atom at a time, over hours.",
    },
    under: "electrical", minutes: 140,
    because: "A current in a solution moves the metal to whichever end you tell it to. It is slow, it is boring, and it produces something purer than any amount of heat will.",
  },
  {
    id: "extract_toxin",
    name: "Extracting",
    says: ["extract", "concentrate", "reduce the venom", "poison", "toxin", "boil it down", "purify the"],
    wants: ["organic", "toxic"],
    needs: [
      { k: "station", id: "alchemy" }, { k: "vessel", kind: "sealed" },
      { k: "ventilation", kind: "open" }, { k: "skill", id: "alchemy", level: 3 }, { k: "hours", n: 2 },
    ],
    ratio: { in: 3, out: 1 },
    makes: {
      prefix: "Concentrated", add: ["purified", "reactive"], drop: ["fibrous", "granular"],
      mass: 0.5, worth: 34,
      desc: "Reduced until what is left is only the part that does something. It does not care how big a thing is; it cares how much blood it has.",
    },
    under: "alchemy", minutes: 160,
    because: "Everything in it that is not the active fraction can be boiled off or filtered out. What remains is the same substance at ten times the concentration, which is a different substance in practice.",
  },
  {
    id: "temper",
    name: "Tempering",
    says: ["temper", "harden", "quench the", "forge", "work the metal", "anneal", "beat it out"],
    wants: ["metal", "malleable"],
    refuses: ["powdered"],
    needs: [{ k: "heat", minC: 900, holdHours: 1 }, { k: "station", id: "forge" }, { k: "tool", klass: "percussion" }],
    ratio: { in: 2, out: 1 },
    makes: {
      prefix: "Tempered", add: ["dense", "purified"], drop: ["malleable"],
      mass: 1.4, worth: 26,
      desc: "Heated, worked, and cooled at the right speed. Harder than it was, and it will hold an edge instead of folding over.",
    },
    under: "smithing", minutes: 150,
    because: "How fast metal cools decides what its grain does, and what its grain does decides whether it bends or breaks. Everything else about smithing is arranging that on purpose.",
  },
  {
    id: "fire_clay",
    name: "Firing",
    says: ["fire the clay", "bake the clay", "make a pot", "make a crucible", "kiln the", "make a vessel"],
    wants: ["silicate", "hygroscopic"],
    needs: [{ k: "heat", minC: 700, holdHours: 3 }, { k: "vessel", kind: "open" }],
    ratio: { in: 2, out: 2 },
    prefer: { clay: "brick" },
    makes: {
      prefix: "Fired", add: ["refractory", "brittle"], drop: ["hygroscopic", "granular"],
      mass: 0.85, worth: 6,
      desc: "Held hot until the water left the structure rather than the surface. It will not soften again.",
    },
    under: "engineering", minutes: 190,
    because: "Clay heated past about six hundred degrees loses the water bound into its crystal and cannot take it back. That irreversibility is the entire invention of pottery.",
  },
];

export const TRANSFORM_BY_ID: Record<string, TransformRule> = Object.fromEntries(
  TRANSFORMS.map((t) => [t.id, t]),
);
