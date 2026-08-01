import type { Item, Mod, Rarity } from "../core/types.ts";

/**
 * The catalogue. Every number here feeds the combat resolver directly — a
 * weapon's damage string is rolled, an armour value is subtracted, a mod is
 * summed into a derived stat. There are no items whose only effect is a
 * sentence.
 *
 * Weight is in kilograms and it is load-bearing: the inventory has no slot
 * limit, so Strength is the only thing standing between you and carrying a
 * vending machine.
 */

export type ItemTemplate = Omit<Item, "iid" | "qty" | "equipped">;

const w = (
  id: string,
  name: string,
  rarity: Rarity,
  damage: string,
  weight: number,
  value: number,
  tags: string[],
  desc: string,
  extra: Partial<ItemTemplate> = {},
): ItemTemplate => ({
  id,
  name,
  kind: "weapon",
  rarity,
  slot: "weapon",
  damage,
  reach: 1,
  weight,
  value,
  tags: ["weapon", ...tags],
  desc,
  ...extra,
});

const a = (
  id: string,
  name: string,
  rarity: Rarity,
  slot: Item["slot"],
  armor: number,
  weight: number,
  value: number,
  tags: string[],
  desc: string,
  mods: Mod[] = [],
): ItemTemplate => ({
  id,
  name,
  kind: "armor",
  rarity,
  slot,
  weight,
  value,
  tags: ["armour", ...tags],
  desc,
  mods: armor > 0 ? [{ k: "armor", v: armor }, ...mods] : mods,
});

export const ITEMS: readonly ItemTemplate[] = [
  /* ------------------------------------------------------- Earth weapons */
  w("knife_kitchen", "Kitchen Knife", "junk", "1d4", 0.2, 3, ["blades", "earth"],
    "Six inches of German steel that has never cut anything that fought back. It is about to."),
  w("pipe", "Length of Steel Pipe", "junk", "1d6", 2.4, 4, ["bludgeon", "earth", "improvised"],
    "Threaded at one end. There is a great deal of this floor and most of it used to be a building."),
  w("rebar", "Bent Rebar", "junk", "1d6", 3.0, 3, ["bludgeon", "earth", "improvised"],
    "Ribbed, rusted, and about as long as your leg. Swings badly, lands well."),
  w("crowbar", "Crowbar", "common", "1d6+1", 2.6, 22, ["bludgeon", "earth", "tool"],
    "Opens doors, crates, and skulls, in descending order of how the manufacturer intended.",
    { mods: [{ k: "skill", skill: "lockpicking", v: 1 }] }),
  w("machete", "Machete", "common", "1d6+1", 1.1, 34, ["blades", "earth"],
    "Made for undergrowth. The dungeon has provided a broadly similar problem."),
  w("fire_axe", "Fire Axe", "common", "1d8", 3.4, 45, ["blades", "earth"],
    "Behind glass, once. The glass is not a consideration any more."),
  w("sledge", "Sledgehammer", "common", "2d4+1", 6.2, 40, ["bludgeon", "earth"],
    "Twelve pounds on a hickory shaft. Slow enough that a rat will get out of the way and heavy enough that it will only do that once.",
    { twoHanded: true, mods: [{ k: "accuracy", v: -1 }, { k: "damage", v: 1 }] }),
  w("nailgun", "Framing Nailgun", "uncommon", "1d6", 3.1, 90, ["ranged", "earth", "improvised"],
    "Runs off a canister that will not last the floor. Ranged, until it is not.",
    { reach: 3, mods: [{ k: "unstable", v: 0.1 }] }),
  w("bow_hunting", "Hunting Bow", "common", "1d6+1", 1.4, 60, ["ranged", "earth"],
    "Compound, camouflaged, and belonged to somebody who is not going to miss it.",
    { reach: 3, twoHanded: true }),
  w("sling", "Leather Sling", "junk", "1d4", 0.2, 5, ["ranged"],
    "Ammunition is every third thing you step on."),

  /* ---------------------------------------------------- dungeon weapons */
  w("short_sword", "Short Sword", "common", "1d6+1", 1.5, 48, ["blades"],
    "Unenchanted, unremarkable, and it does exactly what it says on the blade."),
  w("spear_bronze", "Bronze-Tipped Spear", "common", "1d6", 2.0, 52, ["polearm"],
    "Reach two. You can hold a doorway with this against things that badly want through it.",
    { reach: 2 }),
  w("cleaver", "Butcher's Cleaver", "uncommon", "1d8", 1.6, 180, ["blades", "craft"],
    "Comes off a mob that was using it for its intended purpose on something recognisable.",
    { mods: [{ k: "skill", skill: "butchery", v: 2 }] }),
  w("goblin_repeater", "Goblin Repeater", "uncommon", "1d8+1", 3.6, 260, ["ranged", "goblin"],
    "Jams roughly one shot in eight. The goblins consider that a feature and will explain why at length.",
    { reach: 3, mods: [{ k: "unstable", v: 0.13 }] }),
  w("war_gauntlet", "War Gauntlet", "rare", "1d8", 2.2, 900, ["brawl", "divine"],
    "Blessed at somebody's forge. Counts as a fist, which means every unarmed bonus you own applies to it.",
    { slot: "hands", tags: ["weapon", "brawl", "divine", "unarmed"], mods: [{ k: "stat", stat: "str", v: 3 }] }),
  w("wisp_lance", "Wisp Lance", "rare", "1d10", 2.8, 1100, ["polearm", "caster"],
    "Spends mana instead of stamina. Casters who cannot punch swear by it and everyone else finds it inconvenient.",
    { reach: 2 }),

  /* ---------------------------------------------------------- explosives */
  {
    id: "molotov", name: "Molotov", kind: "explosive", rarity: "common", weight: 0.8, value: 25,
    tags: ["explosive", "fire", "thrown"], damage: "2d6",
    desc: "A bottle, a rag, and forty seconds of committed decision-making. Sets the zone on fire.",
  },
  {
    id: "dynamite_goblin", name: "Goblin Dynamite", kind: "explosive", rarity: "common", weight: 0.4, value: 38,
    tags: ["explosive", "goblin", "thrown"], damage: "3d6",
    desc: "Short fuse, honest yield, no quality control whatsoever. Sold openly by people who find your caution hilarious.",
  },
  {
    id: "dynamite_hob", name: "Hobgoblin Dynamite", kind: "explosive", rarity: "uncommon", weight: 0.9, value: 130,
    tags: ["explosive", "goblin", "thrown"], damage: "5d6",
    desc: "Longer fuse, four times the yield, still no quality control. Do not carry two.",
  },
  {
    id: "pipe_bomb", name: "Pipe Bomb", kind: "explosive", rarity: "common", weight: 0.6, value: 45,
    tags: ["explosive", "crafted", "thrown"], damage: "3d6",
    desc: "You made this. That fact will be relevant to how you feel about it either way.",
  },
  {
    id: "shaped_charge", name: "Shaped Charge", kind: "explosive", rarity: "uncommon", weight: 1.6, value: 210,
    tags: ["explosive", "crafted", "structural"], damage: "4d6",
    desc: "Directional. Brings down what it is pointed at rather than everything, which is the entire difference between demolition and an accident.",
  },

  /* --------------------------------------------------------------- armour */
  a("hivis", "Hi-Vis Vest", "junk", "chest", 0, 0.3, 2, ["clothes", "earth"],
    "Retroreflective. The cameras adore it and so, unfortunately, does everything with eyes.",
    [{ k: "spectacle", v: 0.06 }, { k: "defense", v: -1 }]),
  a("leather_jacket", "Leather Jacket", "junk", "chest", 1, 1.8, 20, ["clothes", "earth"],
    "Scuffed at both elbows. Whoever wore it came off a bike at least once and kept wearing it."),
  a("work_boots", "Steel-Toed Boots", "junk", "feet", 1, 1.6, 18, ["clothes", "earth"],
    "Loud on stone. Every crawler who took up sneaking regrets these and keeps them anyway.",
    [{ k: "damage", v: 1 }]),
  a("hard_hat", "Hard Hat", "junk", "head", 1, 0.4, 12, ["clothes", "earth"],
    "Rated for falling objects, which turns out to be the single most common cause of death on this floor."),
  a("gambeson", "Padded Gambeson", "common", "chest", 2, 3.2, 85, ["clothes"],
    "Quilted linen, thirty layers. Stops blunt force beautifully and is unbearably hot."),
  a("kevlar", "Ballistic Vest", "uncommon", "chest", 3, 4.1, 220, ["clothes", "earth"],
    "Police issue. Rated for handguns, which are not the problem, and it works anyway."),
  a("riot_shield", "Riot Shield", "common", "offhand", 0, 4.4, 70, ["shield", "earth"],
    "Polycarbonate, scratched to fog. Hold a doorway with this and things stop getting past you.",
    [{ k: "defense", v: 3 }]),
  a("trollskin_vest", "Trollskin Vest", "uncommon", "chest", 2, 2.6, 240, ["clothes", "dungeon"],
    "Smells like a wet basement and will save your life anyway.",
    [{ k: "stat", stat: "con", v: 4 }]),
  a("boxers_enchanted", "Enchanted Boxers", "uncommon", "legs", 1, 0.1, 160, ["clothes", "joke"],
    "The system finds this funny and intends to keep mentioning it in front of an audience of trillions.",
    [{ k: "stat", stat: "con", v: 2 }, { k: "spectacle", v: 0.08 }]),
  a("croc_sandals", "Ill-Fitting Pink Crocs", "junk", "feet", 0, 0.4, 1, ["clothes", "joke"],
    "Two sizes too small. Merchandising has already been notified.",
    [{ k: "spectacle", v: 0.1 }, { k: "defense", v: -1 }]),
  a("prism_goggles", "Focusing Goggles", "rare", "head", 1, 0.3, 1200, ["caster", "sponsor"],
    "Off-world optics. They sharpen a spell and, more to the point, they look expensive on camera.",
    [{ k: "accuracy", v: 2 }, { k: "stat", stat: "int", v: 2 }]),
  a("shroud_cloak", "Shroud Cloak", "rare", "neck", 0, 1.1, 1300, ["stealth"],
    "Halves how far away you can be noticed while you are standing still. The instant you move it is a cloak.",
    [{ k: "skill", skill: "stealth", v: 3 }]),

  /* ------------------------------------------------------------ jewellery */
  {
    id: "toe_ring", name: "Toe Ring of the Steadfast", kind: "jewelry", rarity: "uncommon", slot: "ring1",
    weight: 0.02, value: 200, tags: ["jewellery"],
    desc: "It only works barefoot, and the system will bring that up every time it is relevant and several times when it is not.",
    mods: [{ k: "stat", stat: "str", v: 2 }],
  },
  {
    id: "band_hurry", name: "Band of Small Hurry", kind: "jewelry", rarity: "uncommon", slot: "ring1",
    weight: 0.02, value: 300, tags: ["jewellery"],
    desc: "You go earlier. Not faster — earlier. Ask anyone who has been hit first whether that is the same thing.",
    mods: [{ k: "initiative", v: 4 }],
  },
  {
    id: "charm_wit", name: "Charm of Borrowed Wit", kind: "jewelry", rarity: "uncommon", slot: "neck",
    weight: 0.05, value: 320, tags: ["jewellery", "caster"],
    desc: "Whose wit is not disclosed and the description declines to elaborate.",
    mods: [{ k: "stat", stat: "int", v: 2 }],
  },
  {
    id: "bounty_pin", name: "Bounty Hunter's Pin", kind: "jewelry", rarity: "rare", slot: "neck",
    weight: 0.03, value: 1100, tags: ["jewellery", "show"],
    desc: "Shows the standing bounty on anything you can see. Including, at all times, yours.",
    mods: [{ k: "spectacle", v: 0.1 }, { k: "initiative", v: 2 }],
  },

  /* -------------------------------------------------------------- potions */
  {
    id: "potion_health", name: "Health Potion", kind: "potion", rarity: "common", weight: 0.3, value: 28,
    tags: ["filler", "heal"], use: { effect: "heal", v: 32 },
    desc: "Restores a modest amount of health and tastes like warm pennies.",
  },
  {
    id: "potion_health_good", name: "Good Health Potion", kind: "potion", rarity: "uncommon", weight: 0.3, value: 95,
    tags: ["heal"], use: { effect: "heal", v: 85 },
    desc: "The same idea, executed by somebody who cared.",
  },
  {
    id: "potion_mana", name: "Mana Potion", kind: "potion", rarity: "common", weight: 0.3, value: 30,
    tags: ["filler", "mana"], use: { effect: "mana", v: 14 },
    desc: "Fizzes unpleasantly and works immediately, which is the correct order for those two things.",
  },
  {
    id: "potion_stamina", name: "Stimulant Shot", kind: "potion", rarity: "common", weight: 0.1, value: 24,
    tags: ["filler"], use: { effect: "stamina", v: 60 },
    desc: "You will find out what you did later, and so will everyone watching.",
  },
  {
    id: "antidote", name: "Antidote", kind: "potion", rarity: "common", weight: 0.2, value: 30,
    tags: ["filler", "heal"], use: { effect: "cure", v: 1 },
    desc: "Clears Poisoned. Does nothing whatsoever for the other one.",
  },
  {
    id: "bandage", name: "Bandage", kind: "potion", rarity: "junk", weight: 0.1, value: 4,
    tags: ["filler", "heal"], use: { effect: "bleed", v: 1 },
    desc: "Stops bleeding. Unglamorous, and it will keep you alive more often than any weapon in this list.",
  },

  /* ---------------------------------------------------------------- tools */
  {
    id: "rope", name: "Coil of Rope", kind: "tool", rarity: "junk", weight: 3.2, value: 8,
    tags: ["filler", "utility"],
    desc: "Fifteen metres. Solves more rooms than a sword does and gets a fraction of the credit.",
  },
  {
    id: "lockpicks", name: "Lockpick Set", kind: "tool", rarity: "common", weight: 0.1, value: 25,
    tags: ["utility", "stealth"], mods: [{ k: "skill", skill: "lockpicking", v: 2 }],
    desc: "Six picks and a tension wrench, in a roll of felt somebody loved.",
  },
  {
    id: "lighter", name: "Lighter", kind: "tool", rarity: "junk", weight: 0.02, value: 2,
    tags: ["filler", "fire", "utility"],
    desc: "Works. Will keep working far longer than seems reasonable. Fire solves more rooms down here than steel does.",
  },
  {
    id: "torch", name: "Torch", kind: "tool", rarity: "junk", weight: 0.5, value: 2,
    tags: ["filler", "fire", "utility"],
    desc: "Burns for two hours. There is a spell that does this better and you do not have it.",
  },
  {
    id: "toolkit", name: "Work Tools", kind: "tool", rarity: "common", weight: 4.5, value: 60,
    tags: ["utility", "craft"], mods: [{ k: "skill", skill: "engineering", v: 1 }, { k: "skill", skill: "electrical", v: 1 }],
    desc: "Yours, from the job. You know every one of them by feel, which is worth more down here than it sounds.",
  },
  {
    id: "detonator", name: "Detonator Kit", kind: "tool", rarity: "uncommon", weight: 1.2, value: 145,
    tags: ["explosive", "craft"], mods: [{ k: "skill", skill: "demolitions", v: 2 }],
    desc: "Wire, caps and a plunger. Using it without Electrical Work is an event rather than a plan.",
  },
  {
    id: "first_aid", name: "First Aid Kit", kind: "tool", rarity: "common", weight: 1.0, value: 70,
    tags: ["heal", "utility"], mods: [{ k: "skill", skill: "field_dressing", v: 2 }],
    desc: "Gauze, tape, shears, and a card explaining the recovery position to somebody who will never need it again.",
  },

  /* ---------------------------------------------------------------- tomes */
  {
    id: "tome", name: "Spell Tome", kind: "book", rarity: "uncommon", weight: 0.9, value: 380,
    tags: ["caster", "tome"],
    desc: "Teaches one spell, once, and then it is a heavy book. The dungeon picks the spell and it does not take requests.",
  },
  {
    id: "tome_water", name: "Water-Damaged Tome", kind: "book", rarity: "common", weight: 1.1, value: 90,
    tags: ["caster", "tome"],
    desc: "Most of it has run. What is left still works, which raises questions about the rest of it that nobody is answering.",
  },
  {
    id: "tome_field", name: "Field Grimoire", kind: "book", rarity: "rare", weight: 0.6, value: 1400,
    tags: ["caster", "tome"],
    desc: "Annotated in three hands, the last of which stops mid-sentence.",
  },

  /* -------------------------------------------------------------- materials */
  { id: "scrap", name: "Scrap Metal", kind: "material", rarity: "junk", weight: 1.4, value: 3, tags: ["craft"],
    desc: "The planet was demolished into this floor. There is an unhelpful amount of it." },
  { id: "wire", name: "Spool of Wire", kind: "material", rarity: "junk", weight: 0.6, value: 6, tags: ["craft", "explosive"],
    desc: "Copper. Conducts, ties, trips, and garottes, and is priced as though it only does the first one." },
  { id: "powder", name: "Sack of Black Powder", kind: "material", rarity: "common", weight: 2.2, value: 55, tags: ["craft", "explosive"],
    desc: "Sold openly by goblins, who find human caution the funniest thing about this season." },
  { id: "hide", name: "Monster Hide", kind: "material", rarity: "junk", weight: 2.0, value: 8, tags: ["craft"],
    desc: "Comes off better with Butchery. Comes off regardless." },
  { id: "glowmoss", name: "Glow Moss", kind: "material", rarity: "junk", weight: 0.1, value: 4, tags: ["craft", "utility"],
    desc: "Alchemical reagent, emergency light source, and genuinely terrible food." },
  { id: "reagent", name: "Alchemical Reagent", kind: "material", rarity: "common", weight: 0.3, value: 40, tags: ["craft", "alchemy"],
    desc: "Labelled in a script nobody has bothered to translate because the smell is sufficient warning." },

  /* ------------------------------------------------------------------ food */
  { id: "rations", name: "Dungeon Rations", kind: "food", rarity: "junk", weight: 0.4, value: 3, tags: ["filler", "food"],
    use: { effect: "feed", v: 40 }, desc: "Nutritionally complete. Aggressively beige." },
  { id: "cereal_bar", name: "Cereal Bar", kind: "food", rarity: "junk", weight: 0.06, value: 2, tags: ["filler", "food", "earth"],
    use: { effect: "feed", v: 18 }, desc: "One of the last things grown on Earth. Enjoy it or do not; there is no more." },
  { id: "waterskin", name: "Waterskin", kind: "food", rarity: "junk", weight: 1.1, value: 3, tags: ["filler", "food"],
    use: { effect: "feed", v: 12 }, desc: "The dungeon does dehydrate you. It considers this a feature of the format." },

  /* ------------------------------------------------------------------ junk */
  { id: "phone", name: "Phone, 41% Battery", kind: "junk", rarity: "junk", weight: 0.2, value: 1, tags: ["filler", "earth"],
    desc: "No signal. Every mast on the planet went down with everything else. A clock, a torch, and several thousand photographs of the dead." },
  { id: "keys", name: "Keyring", kind: "junk", rarity: "junk", weight: 0.1, value: 1, tags: ["filler", "earth"],
    desc: "House, car, one you never identified, and a bottle opener. Two of those are now permanently theoretical." },
  { id: "sanitiser", name: "Bottle of Hand Sanitiser", kind: "junk", rarity: "junk", weight: 0.25, value: 1, tags: ["filler", "joke", "fire"],
    desc: "Thrown in as a punchline. Seventy percent alcohol, which makes it occasionally load-bearing." },
  { id: "vending_haul", name: "Armful of Vending Machine", kind: "junk", rarity: "junk", weight: 22, value: 14, tags: ["filler", "joke", "food"],
    desc: "Not the contents. The machine. You are carrying a vending machine and everyone can see you doing it." },
];

export const ITEM_BY_ID: Record<string, ItemTemplate> = Object.fromEntries(
  ITEMS.map((i) => [i.id, i]),
);

/* ==========================================================================
   AFFIXES — how the dungeon invents loot
   ==========================================================================
   Generated items are not names with a flavour string attached. A prefix and
   a suffix each carry real modifiers, so a Reinforced Fire Axe of Bad Ideas
   is a genuinely different weapon from the one you found an hour ago, and the
   difference is visible in the damage numbers rather than the prose.
   ========================================================================== */

export interface Affix {
  id: string;
  name: string;
  /** Applies to weapons, armour, or both. */
  on: ("weapon" | "armor" | "jewelry")[];
  minRarity: Rarity;
  mods: Mod[];
  value: number;
  note: string;
}

export const PREFIXES: readonly Affix[] = [
  { id: "rusted", name: "Rusted", on: ["weapon", "armor"], minRarity: "junk", value: -6,
    mods: [{ k: "accuracy", v: -1 }], note: "It has been somewhere damp for a long time." },
  { id: "reinforced", name: "Reinforced", on: ["weapon", "armor"], minRarity: "common", value: 60,
    mods: [{ k: "damage", v: 1 }, { k: "armor", v: 1 }], note: "Somebody welded a second opinion onto it." },
  { id: "balanced", name: "Balanced", on: ["weapon"], minRarity: "common", value: 70,
    mods: [{ k: "accuracy", v: 2 }], note: "Sits in the hand the way the good ones do." },
  { id: "weighted", name: "Weighted", on: ["weapon"], minRarity: "common", value: 55,
    mods: [{ k: "damage", v: 2 }, { k: "accuracy", v: -1 }], note: "Lead in the head. Commits you to the swing." },
  { id: "serrated", name: "Serrated", on: ["weapon"], minRarity: "uncommon", value: 140,
    mods: [{ k: "crit", v: 1 }], note: "Leaves a wound that keeps arguing after the fight." },
  { id: "trollskin", name: "Trollskin", on: ["armor"], minRarity: "uncommon", value: 190,
    mods: [{ k: "stat", stat: "con", v: 3 }], note: "Smells appalling. Works." },
  { id: "hobgoblin", name: "Hobgoblin", on: ["weapon"], minRarity: "uncommon", value: 130,
    mods: [{ k: "damage", v: 3 }, { k: "unstable", v: 0.12 }], note: "Manufactured by people with no concept of a recall." },
  { id: "enchanted", name: "Enchanted", on: ["weapon", "armor", "jewelry"], minRarity: "rare", value: 420,
    mods: [{ k: "accuracy", v: 2 }, { k: "damage", v: 2 }], note: "It hums when you are about to be hit, which is early enough to be useful." },
  { id: "wisp", name: "Wisp", on: ["armor"], minRarity: "rare", value: 500,
    mods: [{ k: "armor", v: 2 }, { k: "defense", v: 2 }], note: "Absorbs a fixed amount per hour and then goes dim and sulks." },
  { id: "grave", name: "Gravebound", on: ["weapon"], minRarity: "rare", value: 560,
    mods: [{ k: "damage", v: 3 }, { k: "onKill", effect: "heal", v: 6 }], note: "Deals more where something has already died today, which is most ground." },
  { id: "celestine", name: "Celestine", on: ["weapon", "armor", "jewelry"], minRarity: "legendary", value: 5200,
    mods: [{ k: "accuracy", v: 4 }, { k: "damage", v: 4 }, { k: "armor", v: 3 }],
    note: "Something noticed when this was made and has not stopped noticing." },
];

export const SUFFIXES: readonly Affix[] = [
  { id: "pummeling", name: "of Pummeling", on: ["weapon"], minRarity: "common", value: 70,
    mods: [{ k: "damage", v: 2 }], note: "Wide, ugly, effective." },
  { id: "splatter_skunk", name: "of the Splatter Skunk", on: ["weapon"], minRarity: "uncommon", value: 160,
    mods: [{ k: "crit", v: 1 }, { k: "spectacle", v: 0.12 }],
    note: "Named by a committee that had stopped caring. The audience adopted it immediately." },
  { id: "small_hours", name: "of Small Hours", on: ["weapon"], minRarity: "rare", value: 700,
    mods: [{ k: "damage", v: 2 }, { k: "crit", v: 2 }],
    note: "Finishes what is nearly finished. Notably reluctant against anything at full health." },
  { id: "quiet_rooms", name: "of Quiet Rooms", on: ["armor", "jewelry"], minRarity: "uncommon", value: 210,
    mods: [{ k: "skill", skill: "stealth", v: 2 }], note: "You stop making the noise you did not know you were making." },
  { id: "long_argument", name: "of the Long Argument", on: ["armor"], minRarity: "rare", value: 640,
    mods: [{ k: "armor", v: 3 }], note: "Remembers the last thing that broke on it and declines to let that happen twice." },
  { id: "bad_ideas", name: "of Bad Ideas", on: ["weapon"], minRarity: "uncommon", value: 180,
    mods: [{ k: "damage", v: 4 }, { k: "unstable", v: 0.18 }, { k: "spectacle", v: 0.15 }],
    note: "It is going to go wrong. The question is whose turn it goes wrong on." },
  { id: "patient_company", name: "of Patient Company", on: ["weapon", "jewelry"], minRarity: "rare", value: 620,
    mods: [{ k: "onKill", effect: "stam", v: 12 }], note: "Every death nearby steadies your hands a little. Do not examine that." },
  { id: "small_hurry", name: "of Small Hurry", on: ["armor", "jewelry"], minRarity: "uncommon", value: 240,
    mods: [{ k: "initiative", v: 3 }], note: "Stacks with nothing and is worth having anyway." },
  { id: "steadfast", name: "of the Steadfast", on: ["armor", "jewelry"], minRarity: "uncommon", value: 230,
    mods: [{ k: "stat", stat: "str", v: 2 }], note: "For carrying things. Mostly for carrying things." },
  { id: "open_hand", name: "of the Open Hand", on: ["weapon", "jewelry"], minRarity: "rare", value: 700,
    mods: [{ k: "skill", skill: "brawling", v: 3 }, { k: "spectacle", v: 0.1 }],
    note: "The show has a category for this and you are now in it." },
  { id: "ending_sun", name: "of the Ending Sun", on: ["weapon"], minRarity: "legendary", value: 6400,
    mods: [{ k: "damage", v: 6 }, { k: "onKill", effect: "views", v: 900 }],
    note: "Scald damage on every strike, permanently, and a god's name in the ledger beside yours." },
];

/** Item names the generator hangs affixes on when it is inventing rather than
 *  re-skinning a catalogue entry. */
export const GENERATED_BASES: readonly {
  id: string;
  name: string;
  kind: "weapon" | "armor" | "jewelry";
  slot: Item["slot"];
  damage?: string;
  reach?: number;
  armor?: number;
  weight: number;
  tags: string[];
}[] = [
  { id: "g_blade", name: "Blade", kind: "weapon", slot: "weapon", damage: "1d8", weight: 1.6, tags: ["blades"] },
  { id: "g_maul", name: "Maul", kind: "weapon", slot: "weapon", damage: "2d5", weight: 5.4, tags: ["bludgeon"] },
  { id: "g_glaive", name: "Glaive", kind: "weapon", slot: "weapon", damage: "1d8", reach: 2, weight: 3.2, tags: ["polearm"] },
  { id: "g_hand", name: "Gauntlets", kind: "weapon", slot: "hands", damage: "1d6", weight: 1.8, tags: ["brawl", "unarmed"] },
  { id: "g_bow", name: "Recurve", kind: "weapon", slot: "weapon", damage: "1d8", reach: 3, weight: 1.5, tags: ["ranged"] },
  { id: "g_coat", name: "Coat", kind: "armor", slot: "chest", armor: 2, weight: 2.4, tags: ["clothes"] },
  { id: "g_harness", name: "Harness", kind: "armor", slot: "chest", armor: 3, weight: 4.0, tags: ["clothes"] },
  { id: "g_helm", name: "Helm", kind: "armor", slot: "head", armor: 2, weight: 1.4, tags: ["clothes"] },
  { id: "g_boots", name: "Boots", kind: "armor", slot: "feet", armor: 1, weight: 1.3, tags: ["clothes"] },
  { id: "g_bracers", name: "Bracers", kind: "armor", slot: "hands", armor: 1, weight: 0.8, tags: ["clothes"] },
  { id: "g_ring", name: "Ring", kind: "jewelry", slot: "ring1", weight: 0.02, tags: ["jewellery"] },
  { id: "g_torc", name: "Torc", kind: "jewelry", slot: "neck", weight: 0.3, tags: ["jewellery"] },
];
