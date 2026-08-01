/**
 * The mechanical vocabulary that generated content is built from.
 *
 * This file is the load-bearing idea behind everything that grows: skills the
 * dungeon invents because of what you did, spells out of a tome nobody wrote,
 * classes assembled around a build that did not exist until you played it.
 *
 * The engine owns the verbs. A generator — procedural, or a language model
 * when one is available — only ever *composes* from this list. That is what
 * keeps invented content real: a minted skill is not a name and a joke, it is
 * `{ k: "accuracy", when: "choke", v: 1 }`, which the combat resolver reads by
 * name on the very next swing. And it is what keeps invented content safe: a
 * generator cannot express "you win", because there is no hook for it.
 */

/** The situations the resolver can ask about. Closed, and each one is checked
 *  somewhere in combat.ts or game.ts. */
export type Cond =
  | "always"
  | "choke" // standing somewhere that admits two or fewer attackers
  | "outnumbered" // three or more hostiles still up
  | "hidden" // they have not seen you
  | "ranged" // striking from another position
  | "melee"
  | "wounded" // below a third of your health
  | "vs_higher" // the target outranks you
  | "unarmed"
  | "improvised"
  | "fire"
  | "high_ground"
  | "vs_larger"; // boss-sized

export const CONDS: readonly Cond[] = [
  "always", "choke", "outnumbered", "hidden", "ranged", "melee", "wounded",
  "vs_higher", "unarmed", "improvised", "fire", "high_ground", "vs_larger",
];

export const COND_LABEL: Record<Cond, string> = {
  always: "at all times",
  choke: "while holding a narrow position",
  outnumbered: "while outnumbered three to one",
  hidden: "against anything that has not seen you",
  ranged: "at distance",
  melee: "in close",
  wounded: "below a third of your health",
  vs_higher: "against anything that outranks you",
  unarmed: "with your bare hands",
  improvised: "with whatever came to hand",
  fire: "with fire",
  high_ground: "from above",
  vs_larger: "against something far larger than you",
};

/**
 * What a level of a skill can be worth. Every entry is summed by name in the
 * resolver; nothing here is decorative.
 */
export type Hook =
  | { k: "accuracy"; when: Cond; v: number }
  | { k: "damage"; when: Cond; v: number }
  | { k: "defense"; when: Cond; v: number }
  | { k: "armor"; when: Cond; v: number }
  | { k: "crit"; when: Cond; v: number }
  | { k: "feature"; v: number } // using the room itself
  | { k: "flee"; v: number }
  | { k: "parley"; v: number }
  | { k: "intimidate"; v: number }
  | { k: "stealth"; v: number }
  | { k: "search"; v: number }
  | { k: "carry"; v: number }
  | { k: "spectacle"; v: number }
  | { k: "initiative"; v: number }
  | { k: "onKill"; effect: "heal" | "stam" | "views"; v: number }
  | { k: "resist"; tag: string; v: number }
  | { k: "lastStand"; v: number }; // extra rounds on your feet at zero

export const HOOK_LABEL = (h: Hook): string => {
  switch (h.k) {
    case "accuracy":
      return `+${h.v} accuracy ${COND_LABEL[h.when]}`;
    case "damage":
      return `+${h.v} damage ${COND_LABEL[h.when]}`;
    case "defense":
      return `+${h.v} defence ${COND_LABEL[h.when]}`;
    case "armor":
      return `+${h.v} armour ${COND_LABEL[h.when]}`;
    case "crit":
      return `a wider critical range ${COND_LABEL[h.when]}`;
    case "feature":
      return `+${h.v} to using the room against people`;
    case "flee":
      return `+${h.v} to getting out`;
    case "parley":
      return `+${h.v} to talking something down`;
    case "intimidate":
      return `+${h.v} to making something reconsider`;
    case "stealth":
      return `+${h.v} to moving unseen`;
    case "search":
      return `+${h.v} to finding what a room is hiding`;
    case "carry":
      return `+${h.v} kg on what you can lift into the inventory`;
    case "spectacle":
      return `views multiplied by a further ${Math.round(h.v * 100)}%`;
    case "initiative":
      return `+${h.v} initiative`;
    case "onKill":
      return h.effect === "heal"
        ? `${h.v} health back on a kill`
        : h.effect === "stam"
          ? `${h.v} stamina back on a kill`
          : `${h.v} extra views on a kill`;
    case "resist":
      return `+${h.v} against ${h.tag}`;
    case "lastStand":
      return `${h.v} extra round on your feet when you should be off them`;
  }
};

/** A skill or spell that did not exist until this run produced it. */
export interface MintedSkill {
  id: string;
  name: string;
  group: "combat" | "survival" | "craft" | "social" | "utility";
  desc: string;
  hooks: Hook[];
  /** Why the dungeon started keeping track. Shown in the codex forever. */
  origin: string;
  /** Minted rather than authored. */
  minted: true;
}

/** Scale a hook by the level of the skill carrying it. Levels 1-5 are most of
 *  the value; the curve past that is deliberately shallow because skills stall
 *  hard by design. */
export function hookValueAt(v: number, level: number): number {
  if (v === 0) return 0;
  const scaled = v * (0.5 + level * 0.5);
  return v > 0 ? Math.floor(scaled) : Math.ceil(scaled);
}

/* ------------------------------------------------------------- spells */

export type SpellEffect =
  | { k: "damage"; dice: string; tag?: "fire" | "cold" | "shock" | "force"; scope: "one" | "zone" }
  | { k: "heal"; dice: string; scope: "self" | "ally" }
  | { k: "status"; id: string; turns: number; scope: "one" | "zone" | "self" }
  | { k: "buff"; hook: Hook; turns: number }
  | { k: "blink"; zones: number }
  | { k: "reveal" }
  | { k: "ward"; v: number; turns: number };

export interface SpellDef {
  id: string;
  name: string;
  mana: number;
  effects: SpellEffect[];
  desc: string;
  tags: string[];
  /** Rounds before it can be cast again. Most spells have none. */
  cooldown?: number;
  /** Composed by the generator rather than shipped with the game. */
  minted?: boolean;
}
