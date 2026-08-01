import type { Combatant, EncounterState, GameState, Item, MapNode } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import { makeStatus } from "../data/statuses.ts";
import { MOB_BY_ID, BOSS_BY_ID } from "../data/mobs.ts";
import { hookBonus } from "./emergent.ts";
import { derive, skillLevel } from "./character.ts";
import { hostilesOf, living, zoneDistance, zoneOf } from "./tactics.ts";
import { clamp } from "../core/util.ts";

/**
 * Delivering something that was built to end an argument.
 *
 * This module is where the game agrees to be beaten. If a crawler works out
 * how to put a burn-through charge on a person-sized boss's head, the boss
 * dies — not "takes heavy damage", dies — and the fight is over in one round
 * and the pacing is ruined. That is the correct outcome and pretending
 * otherwise is the thing that makes a system feel like it is lying to you.
 *
 * The four gates are knowledge, materials, delivery, and the target's own
 * nature. Only the last two live here.
 */

/* ------------------------------------------------------------- traits */

export type Trait =
  | "no_vitals" // an ooze, a swarm, a construct: nothing inside it is load-bearing
  | "massive" // more mass than any charge you can carry up a stairwell
  | "large"
  | "small" // hard to land anything on
  | "armoured"
  | `immune:${string}`
  | `resist:${string}`
  | `vulnerable:${string}`;

export function traitsOf(c: Combatant): string[] {
  const explicit = MOB_BY_ID[c.sourceId]?.traits ?? BOSS_BY_ID[c.sourceId]?.traits ?? [];
  const out = new Set(explicit);
  // Silhouette implies mass. A boss the width of a corridor is massive whether
  // or not anybody remembered to write it down.
  if (c.tags.includes("behemoth") || c.tags.includes("corridor-filling")) out.add("massive");
  else if (c.tags.includes("large")) out.add("large");
  if (out.has("massive")) out.delete("large");
  return [...out];
}

/**
 * How much of a vital effect actually reaches something.
 *
 * This one function is the entire balance of the system. Everything person-
 * sized and made of meat takes it in full and dies. Everything that is mostly
 * volume, or has nothing inside it worth reaching, does not.
 */
export function vitalMultiplier(target: Combatant, tags: readonly string[]): number {
  const traits = traitsOf(target);
  for (const tag of tags) {
    if (traits.includes(`immune:${tag}`)) return 0;
  }
  let mult = 1;
  if (traits.includes("no_vitals")) mult *= 0.2;
  if (traits.includes("massive")) mult *= 0.35;
  else if (traits.includes("large")) mult *= 0.7;
  for (const tag of tags) {
    if (traits.includes(`resist:${tag}`)) mult *= 0.5;
    if (traits.includes(`vulnerable:${tag}`)) mult *= 1.6;
  }
  return mult;
}

function immunityNote(target: Combatant, tags: readonly string[]): string | null {
  const traits = traitsOf(target);
  for (const tag of tags) {
    if (traits.includes(`immune:${tag}`)) {
      return `${target.name} is not merely resistant to that. It lives in it. You have given it a warm afternoon and told it exactly where you are standing.`;
    }
  }
  if (traits.includes("no_vitals")) {
    return `${target.name} has no inside worth reaching. You have made a hole in it, and it is a hole in a thing that does not need to not have holes.`;
  }
  if (traits.includes("massive")) {
    return `${target.name} is bigger than what you brought. It has taken real damage in one specific place, and it has a great many other places.`;
  }
  return null;
}

/* ----------------------------------------------------------- delivery */

function deliveryDc(target: Combatant, adjacent: boolean, aware: boolean): number {
  const traits = traitsOf(target);
  let dc = 14;
  if (traits.includes("massive")) dc = 6;
  else if (traits.includes("large")) dc = 10;
  else if (traits.includes("small")) dc = 18;
  if (adjacent) dc -= 3;
  if (!aware) dc -= 6;
  return Math.max(4, dc);
}

export interface DeliveryResult {
  landed: boolean;
  killed: boolean;
  damage: number;
}

/**
 * Throw or place a built device. `vital` payloads that land on their target do
 * damage proportional to what they are, not to what the encounter budget would
 * prefer — which is how a charge kills a boss and how the same charge fails to
 * kill something the width of the room.
 */
export function deliverDevice(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
  item: Item,
  target: Combatant | null,
  zoneId: string,
): DeliveryResult {
  const device = item.device!;
  const me = enc.combatants.find((c) => c.side === "crawler")!;
  const power = device.power;

  let landedOnTarget = false;
  if (target) {
    const adjacent = zoneDistance(node, me.zone, target.zone) === 0;
    if (device.placed && !adjacent && !target.hidden && !me.hidden) {
      log.say(
        `${item.name} has to be put where it is going, not thrown. You would need to be on top of ${target.name}, or it would need to not have seen you coming.`,
      );
      return { landed: false, killed: false, damage: 0 };
    }
    const dc = deliveryDc(target, adjacent, !me.hidden);
    const roll =
      rng.d(20) +
      skillLevel(state, "throwing") +
      Math.floor(derive(state).stats.dex / 2) +
      hookBonus(state, "feature") +
      (me.hidden ? 4 : 0);
    landedOnTarget = roll >= dc;
    if (!landedOnTarget) {
      log.say(
        `It does not land where you sent it. ${target.name} is ${traitsOf(target).includes("small") ? "small and it does not hold still" : "moving, and you are not as good at this as you need to be"}.`,
      );
    }
  }

  const caught = living(enc).filter((c) => c.zone === zoneId && c.id !== me.id);
  let total = 0;
  let killed = false;

  // The vital hit: the charge is on the thing, and the thing is made of
  // something a charge can get through.
  if (landedOnTarget && target && device.vital) {
    const mult = vitalMultiplier(target, device.tags);
    const raw = power * 130 + rng.roll(`${power}d20`);
    const dealt = Math.round(raw * mult);
    target.hp = Math.max(0, target.hp - dealt);
    total += dealt;

    log.push({
      kind: "attack",
      channel: "good",
      attacker: state.crawler.name,
      target: target.name,
      weapon: item.name,
      byCrawler: true,
      hit: true,
      crit: true,
      graze: false,
      damage: dealt,
      targetHp: target.hp,
      targetHpMax: target.hpMax,
      styles: ["environmental", "improvised", "finisher"],
    });

    const note = immunityNote(target, device.tags);
    if (note) log.say(note);
    else if (target.hp <= 0 && target.tags.includes("boss")) {
      // The anticlimax is the point and the game should say so out loud.
      log.say(
        `There is a pause. Nobody in the room, on either side, expected the fight to be over before it started, and the production has cut to a wide shot because there is nothing else to cut to. ${target.name} is simply finished, and the audience is going to talk about this for the rest of the season.`,
      );
    }
    if (device.tags.includes("fire") && target.hp > 0) {
      target.statuses.push(makeStatus("burning", 4));
    }
    if (target.hp <= 0) killed = true;
  }

  // Everything else in the position, including a miss, takes the blast.
  const splash = landedOnTarget && device.vital ? Math.round(power * 6) : power * 12;
  for (const c of caught) {
    if (c === target && landedOnTarget && device.vital) continue;
    const traits = traitsOf(c);
    if (device.tags.some((t) => traits.includes(`immune:${t}`))) continue;
    const dealt = Math.max(1, rng.roll(`${power}d8`) + splash - Math.floor(c.armor / 2));
    c.hp = Math.max(0, c.hp - dealt);
    total += dealt;
    log.push({
      kind: "attack",
      channel: c.side === "crawler" ? "bad" : "good",
      attacker: state.crawler.name,
      target: c.name,
      weapon: item.name,
      byCrawler: c.side !== "crawler",
      hit: true,
      crit: false,
      graze: false,
      damage: dealt,
      targetHp: c.hp,
      targetHpMax: c.hpMax,
      styles: ["improvised"],
    });
    if (device.tags.includes("fire")) c.statuses.push(makeStatus("burning", 3));
    if (c.hp <= 0) killed = true;
  }

  // A sustained burn does not stop being on fire because the round ended.
  const zone = zoneOf(node, zoneId);
  if (device.kind === "burn") {
    zone.hazard = { kind: "fire", turns: device.tags.includes("sustained") ? 6 : 3, damage: `${power}d6` };
  }
  if (device.kind === "smoke") {
    zone.hazard = { kind: "smoke", turns: 4, damage: "0d1" };
    if (!zone.tags.includes("cover")) zone.tags.push("cover");
  }
  if (device.kind === "shaped" || device.kind === "blast") {
    // Structural work is structural. A position that has been opened up stops
    // being somewhere several people can stand.
    zone.capacity = Math.max(1, zone.capacity - 1);
    if (!zone.tags.includes("rubble")) zone.tags.push("rubble");
  }

  log.push({
    kind: "feature",
    channel: "good",
    actor: state.crawler.name,
    feature: item.name,
    verb: device.placed ? "sets" : "throws",
    success: true,
    affected: caught.map((c) => c.name),
    damage: total,
    note: device.note,
  });

  return { landed: landedOnTarget, killed, damage: total };
}

/* --------------------------------------------------------- called shots */

/**
 * Aiming at something specific.
 *
 * Much harder to land, ignores armour, and triples what the weapon does — so a
 * firearm or a bow reliably ends an ordinary mob in one shot the way it should,
 * without ever being able to one-shot something built out of a building. An
 * ooze has nothing to aim at and will tell you so.
 */
export function calledShotModifier(
  state: GameState,
  attacker: Combatant,
  target: Combatant,
): { accuracy: number; multiplier: number; ignoresArmour: boolean; note: string | null } {
  const traits = traitsOf(target);
  if (traits.includes("no_vitals")) {
    return {
      accuracy: -6,
      multiplier: 1,
      ignoresArmour: false,
      note: `There is nowhere on ${target.name} that matters more than anywhere else on ${target.name}.`,
    };
  }
  const mult = vitalMultiplier(target, ["piercing"]);
  const unaware = attacker.hidden;
  return {
    accuracy: -6 + (unaware ? 5 : 0) + Math.floor(skillLevel(state, "marksmanship") / 2),
    multiplier: clamp(3 * mult, 1, 3),
    ignoresArmour: true,
    note: traits.includes("massive")
      ? `${target.name} has a head somewhere. It is a long way up and it is not the part of it that is currently the problem.`
      : null,
  };
}

export function describeTraits(c: Combatant): string {
  const t = traitsOf(c);
  const bits: string[] = [];
  if (t.includes("no_vitals")) bits.push("nothing inside it worth reaching");
  if (t.includes("massive")) bits.push("more mass than anything you can carry");
  else if (t.includes("large")) bits.push("large");
  if (t.includes("small")) bits.push("small and quick — hard to land anything on");
  if (t.includes("armoured")) bits.push("armoured");
  for (const x of t) {
    if (x.startsWith("immune:")) bits.push(`immune to ${x.slice(7)}`);
    if (x.startsWith("resist:")) bits.push(`resists ${x.slice(7)}`);
    if (x.startsWith("vulnerable:")) bits.push(`vulnerable to ${x.slice(11)}`);
  }
  return bits.join(", ");
}

export { hostilesOf };
