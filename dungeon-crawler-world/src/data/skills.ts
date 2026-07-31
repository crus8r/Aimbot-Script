/**
 * Twenty-nine skills, and every single one is read by name somewhere in the
 * simulation. That constraint is the point: the previous design carried
 * forty-six skills of which most were a name and a joke, which taught players
 * that the character sheet was decoration. If a skill is on this list, some
 * line of code somewhere asks for it before it decides something.
 */

export type SkillGroup = "combat" | "survival" | "craft" | "social" | "utility";

export interface SkillDef {
  id: string;
  name: string;
  group: SkillGroup;
  /** Stated as a mechanic, because it is one. */
  desc: string;
}

export const SKILLS: readonly SkillDef[] = [
  // ---------------------------------------------------------------- combat
  {
    id: "brawling",
    name: "Brawling",
    group: "combat",
    desc: "+1 accuracy and +1 damage per two levels with fists, feet and elbows. The audience has a documented preference for this and pays accordingly.",
  },
  {
    id: "blades",
    name: "Blades",
    group: "combat",
    desc: "+1 accuracy per level with edged weapons, and widens the critical range at 6 and 12.",
  },
  {
    id: "bludgeon",
    name: "Blunt Force",
    group: "combat",
    desc: "+1 accuracy per level with heavy things, and a growing chance to stagger — a staggered enemy loses its action.",
  },
  {
    id: "polearm",
    name: "Polearm Drill",
    group: "combat",
    desc: "Reach weapons let you strike into an adjacent zone. Levels here add accuracy and let you brace against a charge, which stops one outright.",
  },
  {
    id: "marksmanship",
    name: "Marksmanship",
    group: "combat",
    desc: "Cuts the accuracy penalty for distance by 1 every two levels. Without it, shooting across a plaza is a gesture.",
  },
  {
    id: "throwing",
    name: "Throwing",
    group: "combat",
    desc: "Accuracy with anything not designed to be thrown, which is most of what this floor is made of. Also governs where a grenade actually lands.",
  },
  {
    id: "shield",
    name: "Shield Work",
    group: "combat",
    desc: "+1 defence per two levels, and from level 4 you soak part of what is aimed at anyone sharing your zone.",
  },
  {
    id: "dodge",
    name: "Dodge",
    group: "combat",
    desc: "+1 defence per two levels. Does nothing at all while you are prone, which is worth remembering before you go prone.",
  },
  {
    id: "parry",
    name: "Parry",
    group: "combat",
    desc: "A chance per incoming melee hit to convert it into a graze. Scales with level and needs a weapon in hand.",
  },
  {
    id: "first_strike",
    name: "First Strike",
    group: "combat",
    desc: "Bonus damage against anything that has not noticed you. Multiplies with an ambush, which is how a level 3 crawler kills a level 9 anything.",
  },
  // -------------------------------------------------------------- survival
  {
    id: "field_dressing",
    name: "Field Dressing",
    group: "survival",
    desc: "Stops bleeding without a bandage and doubles what a bandage does. Bleeding kills more crawlers than bosses do.",
  },
  {
    id: "pain_tolerance",
    name: "Pain Tolerance",
    group: "survival",
    desc: "Reduces the penalty from every bad status you are carrying, and resists stagger. Lets you keep acting when you should not be able to.",
  },
  {
    id: "sprint",
    name: "Sprint",
    group: "survival",
    desc: "An extra move in combat every other level, and a real bonus to disengaging. The most underrated skill on a timed floor.",
  },
  {
    id: "climbing",
    name: "Climbing",
    group: "survival",
    desc: "Reaches high ground in one move instead of two and opens vertical escapes other people cannot follow you up.",
  },
  {
    id: "stealth",
    name: "Stealth",
    group: "survival",
    desc: "Governs scouting a room before you commit to it, and setting up an ambush. Scouting is the single highest-value action in this game.",
  },
  {
    id: "tracking",
    name: "Tracking",
    group: "survival",
    desc: "Tells you what is waiting in the rooms next door, and how many, before you open the door on it.",
  },
  // ----------------------------------------------------------------- craft
  {
    id: "demolitions",
    name: "Demolitions",
    group: "craft",
    desc: "Builds charges from scrap and powder, and is checked whenever you try to bring a ceiling down on something. Governs blast size and whether you are inside it.",
  },
  {
    id: "electrical",
    name: "Electrical Work",
    group: "craft",
    desc: "Detonators, tripwires and live cabling. Required to weaponise a severed line, which in a flooded room is the most damage in the game.",
  },
  {
    id: "engineering",
    name: "Engineering",
    group: "craft",
    desc: "Barricades that hold, traps that reset, and the judgement to know which wall is load-bearing before you lean on it.",
  },
  {
    id: "smithing",
    name: "Smithing",
    group: "craft",
    desc: "Repairs damaged gear and, at a bench, raises a weapon's damage die. Slow, unglamorous, and it wins floors.",
  },
  {
    id: "alchemy",
    name: "Alchemy",
    group: "craft",
    desc: "Brews potions from reagents at a bench. Cheaper than buying them and available where there are no shops.",
  },
  {
    id: "butchery",
    name: "Butchery",
    group: "craft",
    desc: "Better crafting materials from a corpse, and more of them. Turns a cleared room into a supply run.",
  },
  {
    id: "lockpicking",
    name: "Lockpicking",
    group: "craft",
    desc: "Vaults, cages, shutters and the occasional collar. Vaults hold the best non-box loot on any floor.",
  },
  // ---------------------------------------------------------------- social
  {
    id: "intimidation",
    name: "Intimidation",
    group: "social",
    desc: "Forces a morale check. Broken enemies flee, and a fleeing enemy is worth more views than a dead one.",
  },
  {
    id: "negotiation",
    name: "Negotiation",
    group: "social",
    desc: "Moves shop prices in your favour by up to a third, and is the check for talking your way out of a fight you cannot win.",
  },
  {
    id: "performance",
    name: "Performance",
    group: "social",
    desc: "Directly multiplies views earned. Views buy sponsors; sponsors buy boxes. It is a damage stat, one step removed.",
  },
  // --------------------------------------------------------------- utility
  {
    id: "appraisal",
    name: "Appraisal",
    group: "utility",
    desc: "Reveals what a thing is worth and, more usefully, the clause the description buried in the middle of a joke.",
  },
  {
    id: "clean_lift",
    name: "Clean Lift",
    group: "utility",
    desc: "Adds to what you can get off the ground for the two seconds the inventory needs. Storage is a Strength problem and this is the cheat.",
  },
  {
    id: "scavenging",
    name: "Scavenging",
    group: "utility",
    desc: "Finds the second useful thing in a room everyone else has already searched, including your past self.",
  },
];

export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(
  SKILLS.map((s) => [s.id, s]),
);

/**
 * The curve. Levels 1-5 come quickly, 6-10 noticeably slower, 11-14 are a
 * grind, and 15 is the wall for everyone who is not Primal. Past 15 each
 * level costs more than the ten below it put together, which is why almost
 * nobody in the show's history has stood on 20.
 */
const THRESHOLDS = [
  0, 6, 14, 26, 44, 70, 110, 165, 240, 340, 480, 700, 1000, 1450, 2100, 3400, 5200, 7600, 10800,
  15000,
];

export function skillXpToNext(level: number): number {
  if (level >= 20) return Infinity;
  const cur = THRESHOLDS[level] ?? 15000;
  const next = THRESHOLDS[level + 1] ?? 15000;
  return next - cur;
}

export function skillMilestone(level: number): string | null {
  if (level === 5) return "first milestone — it starts behaving like a real skill";
  if (level === 10) return "second milestone, and the grind from here is genuinely punishing";
  if (level === 15) return "the cap for everyone who is not Primal";
  if (level === 20) return "the ceiling. Almost nobody in the show's history has stood on it";
  return null;
}
