import type { Combatant, EncounterState, GameState, MapNode } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import {
  alliesOf,
  canReach,
  hostilesOf,
  meleePressure,
  stepToward,
  zoneDistance,
  zoneOf,
} from "./tactics.ts";

/**
 * Enemy behaviour.
 *
 * Two mobs with identical statistics play completely differently depending on
 * what is in this file, and that is where the interest in a fight lives. A
 * brute walks into your spear. A pack hunter refuses to engage until one of
 * its friends is behind you. A shooter will spend the entire fight refusing to
 * come within reach and making you decide whether to leave your doorway.
 *
 * Nothing here rolls dice against the player or changes state. It returns an
 * intention; the resolver decides what that costs.
 */

export type AiAction =
  | { t: "attack"; target: string }
  | { t: "move"; zone: string }
  | { t: "move_attack"; zone: string; target: string }
  | { t: "feature"; feature: string }
  | { t: "buff"; target: string }
  | { t: "flee" }
  | { t: "hold" }
  | { t: "wait" };

export function chooseAiAction(
  state: GameState,
  rng: Rng,
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
): AiAction {
  if (self.behavior === "neutral") return { t: "wait" };

  // Broken morale overrides everything. A fleeing mob is trying to reach the
  // way out, and it is not interested in your opinion about that.
  if (self.fleeing) {
    if (self.zone === node.entry) return { t: "flee" };
    const step = stepToward(node, self.zone, node.entry);
    return step ? { t: "move", zone: step } : { t: "flee" };
  }

  const enemies = hostilesOf(enc, self);
  if (enemies.length === 0) return { t: "wait" };

  // Sapient things use the room. It is their room.
  if (self.tags.includes("sapient") && rng.chance(0.18)) {
    const useful = findUsefulFeature(enc, node, self);
    if (useful) return { t: "feature", feature: useful };
  }

  switch (self.behavior) {
    case "caster":
    case "shooter":
      return standoff(state, rng, enc, node, self, enemies);
    case "commander":
      return command(rng, enc, node, self, enemies);
    case "ambusher":
      return ambush(rng, enc, node, self, enemies);
    case "pack":
      return packHunt(rng, enc, node, self, enemies);
    case "skirmisher":
      return skirmish(rng, enc, node, self, enemies);
    case "tank":
      return holdGround(enc, node, self, enemies);
    case "brute":
    case "exploder":
    case "swarm":
    default:
      return charge(enc, node, self, enemies, self.behavior === "brute");
  }
}

/* ---------------------------------------------------------------- helpers */

function nearest(node: MapNode, self: Combatant, list: Combatant[]): Combatant {
  return list
    .slice()
    .sort((a, b) => zoneDistance(node, self.zone, a.zone) - zoneDistance(node, self.zone, b.zone))[0]!;
}

function weakest(list: Combatant[]): Combatant {
  return list.slice().sort((a, b) => a.defense - b.defense || a.hp - b.hp)[0]!;
}

/** Melee cannot pile on past a position's capacity. This is what turns a
 *  doorway into a wall and what makes the AI queue up instead of swarming. */
function engageable(enc: EncounterState, node: MapNode, self: Combatant, target: Combatant): boolean {
  if (self.reach > 1) return canReach(node, self, target);
  if (self.zone === target.zone) return true;
  return !meleePressure(enc, node, target).full;
}

function closeOn(
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  target: Combatant,
): AiAction {
  if (canReach(node, self, target) && engageable(enc, node, self, target)) {
    return { t: "attack", target: target.id };
  }
  const step = stepToward(node, self.zone, target.zone);
  if (!step) return { t: "hold" };

  // Would the step actually accomplish anything? If the destination is already
  // shoulder to shoulder, wait rather than crowd — that is the queue forming
  // outside the doorway, and it is the correct behaviour.
  const after = { ...self, zone: step };
  if (canReach(node, after, target)) {
    if (!engageable(enc, node, after, target)) {
      self.blockedBy = target.id;
      return { t: "hold" };
    }
    return { t: "move_attack", zone: step, target: target.id };
  }
  return { t: "move", zone: step };
}

function retreatZone(node: MapNode, self: Combatant, enemies: Combatant[]): string | null {
  const options = zoneOf(node, self.zone).links;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const z of options) {
    const zone = zoneOf(node, z);
    const dist = Math.min(...enemies.map((e) => zoneDistance(node, z, e.zone)));
    const score =
      dist * 3 + (zone.tags.includes("cover") ? 3 : 0) + (zone.tags.includes("high") ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = z;
    }
  }
  return best;
}

function findUsefulFeature(
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
): string | null {
  const enemies = hostilesOf(enc, self);
  for (const z of node.zones) {
    if (zoneDistance(node, self.zone, z.id) > 1) continue;
    for (const f of z.features) {
      if (f.spent) continue;
      const catches = enemies.some((e) => zoneDistance(node, z.id, e.zone) <= 1);
      const catchesSelf = zoneDistance(node, self.zone, z.id) === 0 && f.kind !== "cache";
      if (catches && !catchesSelf) return f.id;
    }
  }
  return null;
}

/* -------------------------------------------------------------- behaviours */

/** Straight at the nearest thing. Predictable, which is exploitable, which is
 *  the point of putting one in a corridor. */
function charge(
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  enemies: Combatant[],
  reckless: boolean,
): AiAction {
  let target = nearest(node, self, enemies);
  if (!reckless && !engageable(enc, node, self, target)) {
    const alt = enemies.find((e) => engageable(enc, node, self, e));
    if (alt) target = alt;
  }
  return closeOn(enc, node, self, target);
}

/** Keeps its distance and makes you come to it, which means leaving whatever
 *  good ground you were standing on. */
function standoff(
  state: GameState,
  rng: Rng,
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  enemies: Combatant[],
): AiAction {
  const target = weakest(enemies);
  const dist = zoneDistance(node, self.zone, target.zone);
  const crowded = enemies.some((e) => e.zone === self.zone && e.reach <= 1);

  if (crowded) {
    const away = retreatZone(node, self, enemies);
    if (away) return { t: "move", zone: away };
  }
  if (dist > self.reach) {
    const step = stepToward(node, self.zone, target.zone);
    if (step) return { t: "move_attack", zone: step, target: target.id };
  }
  // Aiming is a real option — a shooter that spends a round steadying is a
  // shooter that removes a companion next round.
  if (dist >= 2 && rng.chance(0.2)) {
    self.aiming = true;
    return { t: "hold" };
  }
  return { t: "attack", target: target.id };
}

/** Its whole value is that its side is still a side. Kill it first. */
function command(
  rng: Rng,
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  enemies: Combatant[],
): AiAction {
  const allies = alliesOf(enc, self).filter(
    (a) => zoneDistance(node, self.zone, a.zone) <= 2 && !a.statuses.some((s) => s.id === "adrenaline"),
  );
  if (allies.length && rng.chance(0.6)) {
    return { t: "buff", target: rng.pick(allies).id };
  }
  const target = weakest(enemies);
  if (canReach(node, self, target)) return { t: "attack", target: target.id };
  const away = retreatZone(node, self, enemies);
  return away ? { t: "move", zone: away } : { t: "hold" };
}

/** Opens enormous, then leaves. If you let it re-hide it does it again. */
function ambush(
  rng: Rng,
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  enemies: Combatant[],
): AiAction {
  const target = weakest(enemies);
  if (self.hidden) {
    if (canReach(node, self, target)) return { t: "attack", target: target.id };
    const step = stepToward(node, self.zone, target.zone);
    if (step) return { t: "move_attack", zone: step, target: target.id };
  }
  const engaged = enemies.some((e) => e.zone === self.zone);
  if (engaged && self.hp < self.hpMax * 0.6) {
    const away = retreatZone(node, self, enemies);
    if (away) {
      if (zoneOf(node, away).tags.includes("cover") && rng.chance(0.4)) self.hidden = true;
      return { t: "move", zone: away };
    }
  }
  return closeOn(enc, node, self, nearest(node, self, enemies));
}

/** Refuses to fight fair and is entirely correct to. */
function packHunt(
  rng: Rng,
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  enemies: Combatant[],
): AiAction {
  const nearbyAllies = alliesOf(enc, self).filter((a) => zoneDistance(node, self.zone, a.zone) <= 1);

  // Alone and hurt: fall back toward the rest of the pack rather than die
  // making a point.
  if (nearbyAllies.length === 0 && self.hp < self.hpMax * 0.6 && rng.chance(0.45)) {
    const pack = alliesOf(enc, self);
    if (pack.length) {
      const step = stepToward(node, self.zone, nearest(node, self, pack).zone);
      if (step) return { t: "move", zone: step };
    }
  }

  // Otherwise: whoever already has somebody on them.
  const scored = enemies
    .map((e) => ({
      e,
      score:
        meleePressure(enc, node, e).engaged * 3 -
        zoneDistance(node, self.zone, e.zone) * 2 -
        (meleePressure(enc, node, e).full ? 10 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return closeOn(enc, node, self, scored[0]!.e);
}

/** In, out, and it is never where you swung. */
function skirmish(
  rng: Rng,
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  enemies: Combatant[],
): AiAction {
  const engaged = enemies.filter((e) => e.zone === self.zone && e.reach <= 1);
  if (engaged.length >= 2 || (engaged.length && self.hp < self.hpMax * 0.4)) {
    const away = retreatZone(node, self, enemies);
    if (away) return { t: "move", zone: away };
  }
  return closeOn(enc, node, self, nearest(node, self, enemies));
}

/** Parks itself in the narrowest thing it can find and dares you through. */
function holdGround(
  enc: EncounterState,
  node: MapNode,
  self: Combatant,
  enemies: Combatant[],
): AiAction {
  const target = nearest(node, self, enemies);
  if (canReach(node, self, target)) return { t: "attack", target: target.id };

  const here = zoneOf(node, self.zone);
  if (!here.tags.includes("choke")) {
    const choke = here.links
      .map((l) => zoneOf(node, l))
      .find((z) => z.tags.includes("choke") && zoneDistance(node, z.id, target.zone) < zoneDistance(node, self.zone, target.zone));
    if (choke) return { t: "move", zone: choke.id };
  }
  return closeOn(enc, node, self, target);
}
