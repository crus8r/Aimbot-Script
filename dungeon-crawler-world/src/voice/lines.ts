import type { Rng } from "../core/rng.ts";

/**
 * The System AI.
 *
 * This game is playable, and funny, with the network unplugged. That is a
 * design requirement rather than a fallback: a text RPG whose prose depends on
 * a remote call is a text RPG that is broken on a train.
 *
 * The trick is that the simulation already knows everything worth saying —
 * that you killed something four levels above you, barefoot, in a doorway, at
 * nine percent health. Given facts that specific, templates do not read as
 * templates. They read as a commentator who was watching.
 */

export interface Ctx {
  [k: string]: string | number;
}

function fill(template: string, ctx: Ctx): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(ctx[k] ?? `{${k}}`));
}

/** Remembers what it said recently so the same joke does not land twice in a
 *  row. Small window, because the banks are not infinite and pretending
 *  otherwise produces worse writing, not better. */
export class Voice {
  private recent = new Map<string, string[]>();
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  say(bank: readonly string[], ctx: Ctx = {}, key = "default"): string {
    const used = this.recent.get(key) ?? [];
    let pool = bank.filter((t) => !used.includes(t));
    if (pool.length === 0) pool = bank.slice();
    const chosen = this.rng.pick(pool);
    used.push(chosen);
    while (used.length > Math.min(4, Math.floor(bank.length / 2))) used.shift();
    this.recent.set(key, used);
    return fill(chosen, ctx);
  }
}

/* ------------------------------------------------------------- combat */

export const MISS = [
  "You commit to it and {target} simply is not there any more.",
  "{weapon} goes through the space {target} was occupying a moment ago and takes some of the wall with it.",
  "You miss. {target} does not comment, which is somehow worse.",
  "The swing is fine. The timing is not. {target} rides it out.",
  "You put everything into it and connect with nothing, which costs you your balance and a second you needed.",
];

export const ENEMY_MISS = [
  "{attacker} comes at you and you are not where it expected.",
  "{attacker} swings; the air where you were is now considerably worse off.",
  "You get out of the way of {attacker} by a margin you will think about later.",
  "{attacker} misses, recovers, and looks at you with something like professional annoyance.",
];

export const HIT_LIGHT = [
  "{weapon} catches {target} across the {part}. Not clean, but it counts.",
  "You land it. {target} takes {damage} and adjusts its opinion of you.",
  "A glancing thing — {damage} — and {target} keeps coming.",
  "{damage}. {target} makes a noise it has probably made before.",
];

export const HIT_SOLID = [
  "{weapon} lands properly. {damage}, and {target} folds around it.",
  "You get your weight behind it. {damage}, and something inside {target} gives.",
  "Square on. {damage}. {target} goes backwards and does not want to come forwards.",
  "That one was correct. {damage} off {target}, and the room hears it.",
];

export const HIT_CRIT = [
  "It goes exactly where you sent it. {damage}, and {target} stops being a whole thing.",
  "Perfect. {damage}. {target} was not built to survive that and it is now demonstrating why.",
  "You find the seam and open it. {damage} — the cameras will run this one back.",
  "{damage}. Nobody in the room, on either side, expected that to work as well as it did.",
];

export const KILL = [
  "{victim} comes apart and stays that way.",
  "That does it. {victim} goes down and does not get the second half of whatever it was doing.",
  "{victim} stops. There is a pause while the rest of it catches up, and then it stops properly.",
  "{victim} drops. The room is one problem smaller than it was.",
];

export const KILL_ENVIRONMENTAL = [
  "You did not kill {victim}. The room did. You just had a strong opinion about the room.",
  "{victim} is underneath it now. All of it. This is the highest form of the art.",
  "Whatever {victim} expected to happen in here, that was not on the list.",
];

export const KILL_UNARMED = [
  "{victim} had a weapon. You had a decision. The decision won.",
  "You finish {victim} with your hands, and every camera in the district swings round to find out who did that.",
  "{victim} goes down to bare knuckles, which the audience has a documented and unwholesome appetite for.",
];

export const KILL_PUNCHING_UP = [
  "{victim} outranked you by a distance the arithmetic did not allow for. The arithmetic has been updated.",
  "That should not have been available to you. It was, narrowly, and {victim} is the proof.",
];

export const TAKE_HIT = [
  "{attacker} gets through. {damage}, and you feel every one of them.",
  "{damage}. Your vision does something unhelpful for a moment.",
  "{attacker} lands it clean — {damage} — and the floor comes up a few inches.",
  "That hurt in a specific, informative way. {damage}.",
];

export const LOW_HEALTH = [
  "You are running on almost nothing. Everything is very loud and slightly to the left.",
  "There is not much left in the tank and the tank has a hole in it.",
  "You have been in worse shape, but not for long, and not twice.",
];

export const ENEMY_LOW = [
  "{target} is barely upright.",
  "{target} is finished and has not been told.",
  "One more and {target} is done.",
];

/* --------------------------------------------------------------- rooms */

export const ARRIVE_EMPTY = [
  "Nothing in here but the smell and the water noise.",
  "Empty. Recently, and not peacefully, but empty.",
  "Whatever lived here has gone somewhere else, which raises the question of where.",
  "No movement. The dust says nobody has been through in a while, which on this floor is its own kind of warning.",
];

export const ARRIVE_HOSTILE = [
  "Something in here notices the door open.",
  "You are not alone and the not-alone part happens immediately.",
  "There is a beat where nobody moves, and then there isn't.",
];

export const SEARCH_NOTHING = [
  "You go through it properly and it gives you nothing. Somebody was here first, or nobody was ever here.",
  "Picked clean. The dungeon has a supply chain and you are at the wrong end of it.",
  "Nothing. Forty minutes of nothing, and the clock does not give those back.",
];

export const SEARCH_FOUND = [
  "It was under the thing you moved second, which is where it always is.",
  "Somebody hid this and did not come back for it. Both halves of that sentence are useful information.",
  "Turned up in a place a tidier person would not have looked.",
];

/* ------------------------------------------------------------ notifications */

export const NOTIF_LEVEL = [
  "Level {level}. Three points. Try not to put them all in Charisma; we have seen how that ends.",
  "Level {level}. The system notes this the way a payroll system notes a birthday.",
  "Level {level}. Congratulations, statistically you are now slightly harder to kill than the median corpse.",
];

export const NOTIF_BANKED = [
  "Three more points you cannot spend. They are drifting on their own until you pick a race and a class, and drift is not always upward.",
  "Points banked, unspendable, quietly rearranging themselves. This is a known feature and everybody hates it.",
];

export const NOTIF_BOX_LOCKED = [
  "Locked. Boxes open in a safe room, all at once, in tier order, and you do not get to choose. This is not a punishment. It is a business model.",
  "Into the pile it goes. You will open it when we say, where we say, and all of them together.",
];

export const NOTIF_TIME = [
  "The clock does not care what you were doing.",
  "Time spent. There was never going to be enough of it.",
  "That cost you {hours}. The floor timer has been notified and is delighted.",
];

export const NOTIF_STAIRS = [
  "Stairwells have been seeded across the floor. Seventy-five thousand of them, allegedly. You will need one.",
  "The way down exists now. It did not, twenty minutes ago. We do not explain the schedule.",
];

export const NOTIF_COLLAPSE = [
  "The floor is closing. This is not a metaphor and it is not negotiable.",
  "Hours remaining: {hours}. After that the ceiling arrives on schedule and takes everybody who is still discussing it.",
];

export const NOTIF_HUNTER = [
  "Somebody has read your bounty and done the arithmetic. They are already walking.",
  "Your number came up on somebody else's screen. That somebody is a person, with a plan, and they are between you and something you want.",
];

export const NOTIF_SPONSOR = [
  "A patron is watching. Patrons are generous, patrons are specific, and patrons read the clause even when you do not.",
];

/* ------------------------------------------------------------ flavour */

export const BODY_PARTS = [
  "shoulder", "ribs", "jaw", "forearm", "knee", "flank", "throat", "back of the leg", "temple",
];

export const IDLE_PRESSURE = [
  "Water somewhere, on a count you could set a watch to.",
  "Something a long way off makes a noise and then stops making it.",
  "The stone is warm here, which nobody has explained.",
  "Dust comes off the ceiling in a thin line. Something moved, upstairs, and there is no upstairs.",
  "The light from your own gear is the only light, and it is not much of an argument against the dark.",
];

export const DEATH = [
  "The feed cuts to a sponsor message. Eleven thousand people who were watching you switch to somebody else inside four seconds.",
  "Your bars stop updating. Somewhere, a number that was a name becomes a number that was a name.",
  "The system does not editorialise. It simply stops.",
];
