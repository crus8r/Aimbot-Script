import type { Combatant, EncounterState, MapNode, Zone } from "../core/types.ts";

/**
 * Pure geometry and bookkeeping over an encounter. No dice, no state changes,
 * no logging — which is why both the resolver and the enemy AI can lean on it
 * without either one importing the other.
 */

/** Merge a flat modifier into a dice spec without producing "1d6+1+2". */
export function addToDice(spec: string, n: number): string {
  const m = /^(\d*d\d+)([+-]\d+)?$/i.exec(spec.trim());
  if (!m) return spec;
  const total = (m[2] ? parseInt(m[2], 10) : 0) + n;
  return total === 0 ? m[1]! : `${m[1]}${total > 0 ? "+" : ""}${total}`;
}

export function zoneOf(node: MapNode, id: string): Zone {
  return node.zones.find((z) => z.id === id) ?? node.zones[0]!;
}

/** Steps between two positions across the room's own links. */
export function zoneDistance(node: MapNode, from: string, to: string): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length && d < 10) {
    d++;
    const next: string[] = [];
    for (const z of frontier) {
      for (const l of zoneOf(node, z).links) {
        if (seen.has(l)) continue;
        if (l === to) return d;
        seen.add(l);
        next.push(l);
      }
    }
    frontier = next;
  }
  return 99;
}

/** First step along the shortest path, or null if there is no route. */
export function stepToward(node: MapNode, from: string, to: string): string | null {
  if (from === to) return null;
  let best: string | null = null;
  let bestDist = zoneDistance(node, from, to);
  for (const l of zoneOf(node, from).links) {
    const d = zoneDistance(node, l, to);
    if (d < bestDist) {
      bestDist = d;
      best = l;
    }
  }
  return best;
}

export const living = (enc: EncounterState, side?: Combatant["side"]): Combatant[] =>
  enc.combatants.filter((c) => c.alive && (!side || c.side === side));

export const isHostileTo = (a: Combatant, b: Combatant): boolean =>
  (a.side === "hostile") !== (b.side === "hostile");

export const hostilesOf = (enc: EncounterState, c: Combatant): Combatant[] =>
  living(enc).filter((o) => isHostileTo(o, c));

export const alliesOf = (enc: EncounterState, c: Combatant): Combatant[] =>
  living(enc).filter((o) => o.id !== c.id && !isHostileTo(o, c));

export const byId = (enc: EncounterState, id: string): Combatant | undefined =>
  enc.combatants.find((c) => c.id === id);

export const crawlerOf = (enc: EncounterState): Combatant =>
  enc.combatants.find((c) => c.side === "crawler")!;

/**
 * How many enemies are already engaged with this defender, and how many the
 * ground allows. This is the number that makes a doorway worth dying in: at
 * capacity 1, the seventh gnoll in the room is a spectator.
 */
export function meleePressure(
  enc: EncounterState,
  node: MapNode,
  defender: Combatant,
): { engaged: number; capacity: number; full: boolean } {
  const capacity = zoneOf(node, defender.zone).capacity;
  const engaged = hostilesOf(enc, defender).filter((o) => o.zone === defender.zone && o.reach <= 1)
    .length;
  return { engaged, capacity, full: engaged >= capacity };
}

/** Can `a` bring its weapon to bear on `b` from where it is standing? */
export function canReach(node: MapNode, a: Combatant, b: Combatant): boolean {
  return zoneDistance(node, a.zone, b.zone) <= a.reach;
}
