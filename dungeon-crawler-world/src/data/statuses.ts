import type { Status } from "../core/types.ts";

/**
 * Statuses are read every single round by the combat resolver and every hour
 * by the clock. Each one has a stated numeric effect; none of them are mood.
 */

export interface StatusDef {
  id: string;
  name: string;
  bad: boolean;
  /** Damage per round in combat, or per hour out of it. */
  tick?: number;
  accuracy?: number;
  defense?: number;
  damage?: number;
  /** Loses their action entirely this round. */
  skipsTurn?: boolean;
  desc: string;
}

export const STATUSES: readonly StatusDef[] = [
  {
    id: "bleeding", name: "Bleeding", bad: true, tick: 3,
    desc: "Loses health every round and every hour until it is dressed. This is what actually kills crawlers; bosses only get the credit.",
  },
  {
    id: "burning", name: "Burning", bad: true, tick: 6, defense: -1,
    desc: "Fire damage per round, and it spreads to anything flammable you are standing in or wearing.",
  },
  {
    id: "poisoned", name: "Poisoned", bad: true, tick: 2, accuracy: -1,
    desc: "Damage over time and a shaking hand to go with it.",
  },
  {
    id: "broken_limb", name: "Broken Limb", bad: true, accuracy: -3, damage: -2,
    desc: "Halved effectiveness on that side. Heals slowly. Amputations do not heal at all.",
  },
  {
    id: "concussed", name: "Concussed", bad: true, accuracy: -2, defense: -1,
    desc: "The room will not hold still and neither will anything in it.",
  },
  {
    id: "staggered", name: "Staggered", bad: true, skipsTurn: true, defense: -2,
    desc: "Loses this round entirely. Blunt weapons cause this and it is why blunt weapons are good.",
  },
  {
    id: "stunned", name: "Stunned", bad: true, skipsTurn: true, defense: -3,
    desc: "Not acting, not defending, and everybody in the room has noticed.",
  },
  {
    id: "prone", name: "Prone", bad: true, defense: -2, accuracy: -2,
    desc: "On the floor. Standing up costs your move, and Dodge does nothing at all down here.",
  },
  {
    id: "exhausted", name: "Exhausted", bad: true, accuracy: -2, defense: -2,
    desc: "You have been awake too long and it is costing you two of everything. Find a safe room.",
  },
  {
    id: "starving", name: "Starving", bad: true, tick: 1, damage: -1,
    desc: "Constitution draining. Safe room food is free on the tutorial floors and there is no excuse for this.",
  },
  {
    id: "marked", name: "Marked", bad: true, defense: -1,
    desc: "Every hostile on the floor has a rough idea of where you are and is acting on it.",
  },
  {
    id: "hunted", name: "Hunted", bad: true,
    desc: "Somebody has read your bounty, done the arithmetic, and started walking.",
  },
  {
    id: "adrenaline", name: "Adrenaline", bad: false, damage: 2, accuracy: 1,
    desc: "Damage up, pain suppressed. You will find out what you did to yourself later.",
  },
  {
    id: "braced", name: "Braced", bad: false, defense: 3,
    desc: "Set against a charge. The next thing that runs at you regrets the running part.",
  },
  {
    id: "rested", name: "Rested", bad: false, accuracy: 1, defense: 1,
    desc: "Slept properly. It cost you seven hours off the floor timer and it was worth it.",
  },
  {
    id: "well_fed", name: "Well Fed", bad: false,
    desc: "Regenerating faster for the next several hours.",
  },
  {
    id: "crowd_favourite", name: "Crowd Favourite", bad: false,
    desc: "Views accruing at an elevated rate. So, quietly, is the bounty.",
  },
];

export const STATUS_BY_ID: Record<string, StatusDef> = Object.fromEntries(
  STATUSES.map((s) => [s.id, s]),
);

export function makeStatus(id: string, turns: number, magnitude = 0): Status {
  const def = STATUS_BY_ID[id];
  if (!def) throw new Error(`unknown status: ${id}`);
  return {
    id,
    name: def.name,
    bad: def.bad,
    turns,
    magnitude: magnitude || def.tick || 0,
    note: def.desc,
  };
}

/** Sums the mechanical effect of everything a combatant is carrying. */
export function statusEffects(
  statuses: readonly Status[],
  painTolerance = 0,
): { accuracy: number; defense: number; damage: number; tick: number; skipsTurn: boolean } {
  let accuracy = 0;
  let defense = 0;
  let damage = 0;
  let tick = 0;
  let skipsTurn = false;
  for (const s of statuses) {
    const def = STATUS_BY_ID[s.id];
    if (!def) continue;
    // Pain Tolerance blunts penalties without touching the benefits, which is
    // exactly what it says on the skill.
    const soften = def.bad ? Math.min(1, painTolerance * 0.08) : 0;
    accuracy += (def.accuracy ?? 0) * (def.bad ? 1 - soften : 1);
    defense += (def.defense ?? 0) * (def.bad ? 1 - soften : 1);
    damage += (def.damage ?? 0) * (def.bad ? 1 - soften : 1);
    tick += s.magnitude || def.tick || 0;
    if (def.skipsTurn) skipsTurn = true;
  }
  return {
    accuracy: Math.round(accuracy),
    defense: Math.round(defense),
    damage: Math.round(damage),
    tick,
    skipsTurn,
  };
}
