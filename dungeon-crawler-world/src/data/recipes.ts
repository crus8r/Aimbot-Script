/**
 * Building things, and the reason boss fights can end in four seconds.
 *
 * The design position here is deliberate and it is not the safe one: if a
 * crawler works out something that would genuinely kill a thing, it kills the
 * thing. A person-sized boss with a burn-through charge welded to its skull
 * does not get to have a health bar about it. The fight is anticlimactic, the
 * pacing is ruined, and that is correct — the same way a crawler who came down
 * the stairs holding a service pistol got to shoot things in the head until the
 * ammunition ran out.
 *
 * What keeps that from trivialising the game is not a damage cap. It is that
 * every devastating answer is narrow:
 *
 *   - You need the KNOWLEDGE. Recipes are gated on real skill levels and are
 *     learned, found, or worked out at a bench over hours you do not have.
 *   - You need the MATERIALS, and they are not lying around.
 *   - You need to LAND it, against something that is moving and has noticed you.
 *   - And the thing has to be VULNERABLE to it. An incendiary against something
 *     that lives in magma is a light show. A vital strike against an ooze is a
 *     hole in an ooze. Something the width of a corridor has more mass than any
 *     charge you can carry.
 *
 * Build the run around one answer and the floor that answers back will kill
 * you. That is the trade, and it is a better trade than a damage cap.
 */

export type StationId = "alchemy" | "engineering" | "ordnance" | "forge";

export interface StationDef {
  id: StationId;
  name: string;
  cost: number;
  desc: string;
}

/**
 * Expensive on purpose. A bench is the largest single thing gold buys and it
 * changes what the rest of the run is capable of, which is exactly what a
 * money sink should do.
 */
export const STATIONS: readonly StationDef[] = [
  {
    id: "alchemy", name: "Alchemy Bench", cost: 2600,
    desc: "Glassware, a burner, and a fume hood that does not work. Potions, toxins, and reagents refined into something worth carrying.",
  },
  {
    id: "engineering", name: "Engineering Bench", cost: 4200,
    desc: "A vice, a lathe, and every fastener the dungeon has ever produced. Traps that reset, tools that hold, and repairs that are not a bodge.",
  },
  {
    id: "ordnance", name: "Ordnance Studio", cost: 7800,
    desc: "Blast-rated, ventilated, and behind its own door. Charges, fuses, and the specific chemistry that turns a rucksack into a structural argument. The single most expensive thing on the list and the reason people take out loans.",
  },
  {
    id: "forge", name: "Forge", cost: 11_000,
    desc: "Coal, anvil, quench. Raises a weapon's damage die permanently, which nothing else in the game does.",
  },
];

export const STATION_BY_ID: Record<string, StationDef> = Object.fromEntries(
  STATIONS.map((s) => [s.id, s]),
);

/* ---------------------------------------------------------- the space */

export interface UpgradeDef {
  id: string;
  name: string;
  cost: number;
  desc: string;
}

/**
 * The entry ticket, not the sink.
 *
 * Measured rather than guessed: a crawler arriving on floor four is carrying
 * about twelve hundred gold's worth of sellable rubbish, which puts an empty
 * room somewhere around floor five and the first bench a floor or two after
 * that. Price the room like a bench and the entire crafting layer never opens
 * before floor nine, which is most of a season spent looking at a menu.
 */
export const SPACE_COST = 3200;

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: "bed", name: "A Real Bed", cost: 1800,
    desc: "Sleep here and you wake up Rested for twice as long. Seven hours is seven hours either way; this is about what they buy you.",
  },
  {
    id: "stores", name: "Storage Racking", cost: 1400,
    desc: "Somewhere to put the vending machine. Adds to what you can get off the ground, because the technique is half the lifting.",
  },
  {
    id: "garden", name: "Grow Lamps", cost: 3600,
    desc: "Reagents accumulate while you are elsewhere being hit. Two a floor, quietly, whether you remember it or not.",
  },
  {
    id: "armoury", name: "Armoury Wall", cost: 2900,
    desc: "Everything racked, oiled and to hand. Gear you keep here does not degrade and you start every floor with your best equipped.",
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u]),
);

/* ------------------------------------------------------------ devices */

/** What a built device does when it arrives. */
export interface DevicePayload {
  kind: "burn" | "blast" | "shaped" | "toxin" | "shock" | "smoke";
  /** Scales everything. 1 is a firework; 4 is a structural decision. */
  power: number;
  /**
   * Seeks something that cannot take being burned through or opened up. Vital
   * damage ignores armour and is proportional to the target's whole health —
   * which is what allows it to simply kill — and it is what `no_vitals` and
   * `massive` exist to answer.
   */
  vital: boolean;
  /** Checked against a target's resistances and immunities. */
  tags: string[];
  /** Must be placed rather than thrown: needs the target unaware or adjacent. */
  placed?: boolean;
  note: string;
}

export interface RecipeDef {
  id: string;
  name: string;
  /** Skill and level required to know what you are doing. */
  skill: { id: string; level: number };
  materials: { id: string; qty: number }[];
  station?: StationId;
  /** Improvised without the bench: slower, and it may not work. */
  improvisable: boolean;
  minutes: number;
  makes: {
    name: string;
    weight: number;
    value: number;
    desc: string;
    device: DevicePayload;
  };
  /** How the crawler comes to know it. */
  learn: string;
}

export const RECIPES: readonly RecipeDef[] = [
  {
    id: "pipe_charge", name: "Pipe Charge",
    skill: { id: "demolitions", level: 2 },
    materials: [{ id: "powder", qty: 1 }, { id: "scrap", qty: 1 }],
    improvisable: true, minutes: 25,
    learn: "Anybody with a passing interest in demolition works this one out in an afternoon.",
    makes: {
      name: "Pipe Charge", weight: 0.7, value: 60,
      desc: "A threaded pipe, packed and capped. Honest, loud, and it will not surprise anybody.",
      device: { kind: "blast", power: 1, vital: false, tags: ["concussive"], note: "A hard bang across one position." },
    },
  },
  {
    id: "cutting_charge", name: "Cutting Charge",
    skill: { id: "demolitions", level: 5 },
    materials: [{ id: "powder", qty: 2 }, { id: "scrap", qty: 2 }, { id: "wire", qty: 1 }],
    station: "ordnance", improvisable: true, minutes: 70,
    learn: "Shaping a charge so the force goes one direction is the whole trade, and it takes a bench to do properly.",
    makes: {
      name: "Cutting Charge", weight: 1.4, value: 340,
      desc: "Directional. Everything it has goes exactly where it is pointed, which is the difference between demolition and an accident.",
      device: { kind: "shaped", power: 2, vital: true, tags: ["concussive", "structural"], placed: true, note: "Pointed at one thing, at contact range." },
    },
  },
  {
    /**
     * The one the whole system exists for. Metal oxide and a fine metal fuel,
     * which burn together at a temperature that does not care what it is
     * burning through. It is not an explosive; it is a hole, arriving.
     */
    id: "oxide_charge", name: "Oxide Charge",
    skill: { id: "alchemy", level: 6 },
    materials: [{ id: "scrap", qty: 3 }, { id: "reagent", qty: 2 }, { id: "powder", qty: 1 }],
    station: "ordnance", improvisable: false, minutes: 150,
    learn: "Metal oxide and a fine metal fuel. The reaction is self-sustaining, needs no air, and reaches a temperature that is not interested in what is underneath it. Getting the ratio wrong ruins the mix; getting it right ruins whatever it is sitting on.",
    makes: {
      name: "Oxide Charge", weight: 1.1, value: 900,
      desc: "A pouch of grey powder with a coarse fuse. It does not explode. It burns downward, through, at a temperature that stops being a number and starts being a fact, and it does not stop until it has finished. Land it on something's head and there will be no head.",
      device: {
        kind: "burn", power: 4, vital: true, tags: ["fire", "incendiary", "sustained"], placed: false,
        note: "Burns through. Ignores armour entirely, and the only defence is not being where it lands.",
      },
    },
  },
  {
    id: "fuel_bottle", name: "Fuel Bottle",
    skill: { id: "alchemy", level: 1 },
    materials: [{ id: "reagent", qty: 1 }],
    improvisable: true, minutes: 15,
    learn: "A bottle, a rag, and a decision.",
    makes: {
      name: "Fuel Bottle", weight: 0.8, value: 40,
      desc: "Sets a position alight and keeps it that way.",
      device: { kind: "burn", power: 1, vital: false, tags: ["fire"], note: "Fire across one position." },
    },
  },
  {
    id: "nerve_toxin", name: "Nerve Toxin",
    skill: { id: "alchemy", level: 5 },
    materials: [{ id: "reagent", qty: 3 }, { id: "glowmoss", qty: 2 }],
    station: "alchemy", improvisable: false, minutes: 90,
    learn: "Distilled from things that were already trying to do this to you.",
    makes: {
      name: "Nerve Toxin", weight: 0.3, value: 520,
      desc: "Coats a blade or fills a dart. It does not care how big something is; it cares how much blood it has.",
      device: { kind: "toxin", power: 3, vital: true, tags: ["poison", "biological"], placed: true, note: "Needs to get inside something." },
    },
  },
  {
    id: "arc_trap", name: "Arc Trap",
    skill: { id: "electrical", level: 4 },
    materials: [{ id: "wire", qty: 2 }, { id: "scrap", qty: 2 }],
    station: "engineering", improvisable: true, minutes: 55,
    learn: "A capacitor bank, a plate, and a very short circuit.",
    makes: {
      name: "Arc Trap", weight: 2.2, value: 300,
      desc: "Placed, armed, and patient. Catastrophic in standing water and merely unpleasant on dry stone.",
      device: { kind: "shock", power: 2, vital: false, tags: ["electrical"], placed: true, note: "Placed on the ground and left." },
    },
  },
  {
    id: "smoke_pot", name: "Smoke Pot",
    skill: { id: "engineering", level: 2 },
    materials: [{ id: "scrap", qty: 1 }, { id: "reagent", qty: 1 }],
    improvisable: true, minutes: 20,
    learn: "Obvious once somebody has shot at you across an open floor.",
    makes: {
      name: "Smoke Pot", weight: 0.6, value: 90,
      desc: "Nothing in it hurts anybody. It simply means nothing at range can see you, which on some floors is worth more than a weapon.",
      device: { kind: "smoke", power: 1, vital: false, tags: ["obscuring"], note: "Blinds a position for several rounds." },
    },
  },
];

export const RECIPE_BY_ID: Record<string, RecipeDef> = Object.fromEntries(
  RECIPES.map((r) => [r.id, r]),
);

/* --------------------------------------------------------- consumables */

export interface BrewDef {
  id: string;
  name: string;
  skill: { id: string; level: number };
  materials: { id: string; qty: number }[];
  station: StationId;
  minutes: number;
  makes: string;
  qty: number;
}

/** The unglamorous half of a bench, and the half that keeps runs alive. */
export const BREWS: readonly BrewDef[] = [
  { id: "brew_health", name: "Health Potions", skill: { id: "alchemy", level: 2 }, station: "alchemy",
    materials: [{ id: "reagent", qty: 1 }, { id: "glowmoss", qty: 1 }], minutes: 40, makes: "potion_health", qty: 2 },
  { id: "brew_health_good", name: "Good Health Potions", skill: { id: "alchemy", level: 6 }, station: "alchemy",
    materials: [{ id: "reagent", qty: 2 }, { id: "glowmoss", qty: 2 }], minutes: 70, makes: "potion_health_good", qty: 2 },
  { id: "brew_antidote", name: "Antidotes", skill: { id: "alchemy", level: 3 }, station: "alchemy",
    materials: [{ id: "glowmoss", qty: 2 }], minutes: 35, makes: "antidote", qty: 2 },
  { id: "brew_bandage", name: "Bandages", skill: { id: "field_dressing", level: 1 }, station: "alchemy",
    materials: [{ id: "hide", qty: 1 }], minutes: 15, makes: "bandage", qty: 4 },
  { id: "make_dynamite", name: "Dynamite", skill: { id: "demolitions", level: 3 }, station: "ordnance",
    materials: [{ id: "powder", qty: 2 }, { id: "scrap", qty: 1 }], minutes: 45, makes: "dynamite_goblin", qty: 2 },
];

export const BREW_BY_ID: Record<string, BrewDef> = Object.fromEntries(BREWS.map((b) => [b.id, b]));
