import type { GameState, MapNode, Zone } from "../core/types.ts";
import { currentNode } from "./map.ts";
import { MOB_BY_ID, BOSS_BY_ID } from "../data/mobs.ts";
import { depositsHere, strainStage, type StrainStage } from "./harvest.ts";

/**
 * What standing in a room tells you.
 *
 * One boundary holds this whole file up, and it is the same one `examine`
 * obeys: THIS IS A VIEW OVER WHAT IS ALREADY KNOWN, never a reveal. Being in a
 * room tells you what is standing in it. It does not tell you what is in the
 * cupboards, what is through the far door, or how much health the thing in the
 * corner has left. Those cost `search`, `scout`, and being wrong.
 *
 * Getting that boundary right in one place is what stops two clients drifting
 * into two different games — the terminal used to know things the browser did
 * not, which is not a difference of presentation, it is a difference of
 * difficulty.
 */

export type Threat = "clear" | "unseen" | "known" | "boss";

export interface SceneExit {
  to: string;
  minutes: number;
  /** Named only if you have been there or scouted it. */
  name: string;
  known: boolean;
  marks: string[];
}

export interface ScenePosition {
  zone: Zone;
  /** Standing here, how many can reach you at once. The reason a doorway matters. */
  capacity: number;
  /** What this position IS, in words, from tags the resolver actually reads. */
  qualities: string[];
  features: { id: string; name: string; note: string; spent: boolean }[];
  /** Substances in reach, and what the structure thinks of your digging. */
  seams: { id: string; name: string; left: number; kg: number }[];
  strain: StrainStage;
  here: boolean;
}

export interface Scene {
  node: MapNode;
  name: string;
  kind: MapNode["kind"];
  /** The authored line for this place, if it has one. */
  note: string;
  threat: Threat;
  /** Only populated once you could actually know. */
  hostiles: { name: string; count: number; level?: number }[];
  boss: { name: string; rank: string; size: string; weakness: string } | null;
  undetected: boolean;
  searched: boolean;
  cleared: boolean;
  hasStairs: boolean;
  positions: ScenePosition[];
  exits: SceneExit[];
  /** True when this is somewhere you can stop being hunted for an hour. */
  safe: boolean;
}

const QUALITY: Record<string, string> = {
  choke: "narrow enough that they have to come one or two at a time",
  cover: "something to get behind",
  high: "above the rest of it",
  exposed: "open ground, with nothing between you and anything",
  confined: "no room to swing and nowhere to back into",
  water: "standing water, which carries a current a great deal better than air",
  flammable: "it will take a light and keep it",
  rubble: "broken ground you cannot cross quickly",
  dark: "dark enough that nothing at range is reliable",
};

export function sceneOf(state: GameState): Scene {
  const node = currentNode(state.floor);
  const enc = state.encounter && !state.encounter.finished ? state.encounter : null;
  const meZone = enc ? enc.combatants.find((c) => c.side === "crawler")?.zone : undefined;

  const bossId = node.boss && !state.floor.bossesKilled.includes(node.boss) ? node.boss : null;
  const alive = !node.cleared && (node.spawn.length > 0 || bossId !== null);

  // You know what is in here once you have been in here, or once you scouted
  // it from the threshold. Otherwise you know only that something is.
  const known = node.visited || state.flags[`scouted_${node.id}`] === true;
  const threat: Threat = !alive ? "clear" : bossId ? "boss" : known ? "known" : "unseen";

  const boss = bossId ? BOSS_BY_ID[bossId] : null;

  return {
    node,
    name: node.name,
    kind: node.kind,
    note: node.note,
    threat,
    hostiles:
      alive && known
        ? node.spawn
            .map((g) => ({ name: MOB_BY_ID[g.mob]?.name ?? g.mob, count: g.count, level: g.level }))
            .filter((h) => h.name)
        : [],
    boss: boss && known ? { name: boss.name, rank: boss.rank, size: boss.size, weakness: boss.weakness } : null,
    undetected: state.flags.undetected === true && alive,
    searched: node.searched,
    cleared: node.cleared,
    hasStairs: node.hasStairs && state.floor.stairsAnnounced,
    safe: node.kind === "safe_room" || node.kind === "guild",
    positions: ((all) => node.zones.map((zone) => {
      const seams = all.find((d) => d.zone === zone)?.deposits ?? [];
      return {
        zone,
        capacity: zone.capacity,
        qualities: zone.tags.map((t) => QUALITY[t]).filter(Boolean) as string[],
        features: zone.features.map((f) => ({ id: f.id, name: f.name, note: f.note, spent: f.spent })),
        seams: seams.map((d) => ({ id: d.mat.id, name: d.mat.name, left: d.left, kg: d.mat.kg })),
        strain: strainStage(state, node, zone),
        here: meZone === zone.id,
      };
    }))(depositsHere(state, node)),
    exits: node.links.map((l) => {
      const n = state.floor.nodes[l.to]!;
      const seen = n.visited || state.flags[`scouted_${n.id}`] === true;
      const marks: string[] = [];
      if (seen && n.hasStairs && state.floor.stairsAnnounced) marks.push("stairs");
      if (seen && n.kind === "safe_room") marks.push("safe room");
      if (seen && n.kind === "guild") marks.push("guild hall");
      if (seen && n.kind === "shop") marks.push("shop");
      if (seen && n.cleared) marks.push("cleared");
      if (seen && !n.searched && n.visited) marks.push("unsearched");
      return {
        to: l.to,
        minutes: l.minutes,
        name: seen ? n.name : "somewhere you have not been",
        known: seen,
        marks,
      };
    }),
  };
}

/**
 * The one-line answer to "what is the situation".
 *
 * Written to be read in the second before you decide something, so it leads
 * with the thing that can kill you and stops.
 */
export function situationLine(scene: Scene): string {
  if (scene.boss) return `${scene.boss.name} — ${scene.boss.rank} boss, ${scene.boss.size}.`;
  if (scene.threat === "unseen") return "Something is in here with you.";
  if (scene.threat === "known") {
    return scene.hostiles.map((h) => `${h.count} × ${h.name}${h.level ? ` (lv ${h.level})` : ""}`).join(", ");
  }
  if (!scene.searched) return "Nothing alive in here. Not been through it properly either.";
  return "Clear, and already been through.";
}

/** Every choke point in the room, which is the tactical fact that matters most. */
export function chokes(scene: Scene): ScenePosition[] {
  return scene.positions.filter((p) => p.capacity <= 2);
}
