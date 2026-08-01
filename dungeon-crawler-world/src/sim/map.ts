import type { FloorState, Item, MapNode, NodeKind, Zone } from "../core/types.ts";
import { derived, type Rng } from "../core/rng.ts";
import { FEATURES, floorDef, layoutsFor } from "../data/floors.ts";
import { BOSS_BY_ID, MOB_BY_ID } from "../data/mobs.ts";
import { makeItem } from "./loot.ts";
import { clamp } from "../core/util.ts";

/**
 * Floor generation.
 *
 * A floor is a connected graph of places. Not a percentage — a graph, with
 * travel times on the edges, so that "go back for the boss you skipped" costs
 * you forty real minutes off a real timer, and so that getting lost is a
 * thing that can happen to you.
 *
 * The whole floor is generated from a stream derived purely from the world
 * seed and the floor number. Floor 3 is the same floor whether you arrived
 * there in six hours or sixty.
 */

export function generateFloor(worldSeed: number, n: number): FloorState {
  const def = floorDef(n);
  const rng = derived(worldSeed, `floor:${n}`);
  const count = rng.int(def.size[0], def.size[1]);

  const nodes: Record<string, MapNode> = {};
  const order: string[] = [];

  const id = (i: number) => `n${i}`;

  // ---- 1. a connected graph, spine-heavy with a few loops
  for (let i = 0; i < count; i++) {
    const nid = id(i);
    order.push(nid);
    nodes[nid] = blankNode(nid);
    if (i > 0) {
      // Attach to a recent node most of the time so the floor reads as a route
      // rather than a starburst, but occasionally reach back and make a spur.
      const back = rng.chance(0.72) ? rng.int(Math.max(0, i - 4), i - 1) : rng.int(0, i - 1);
      link(nodes, nid, id(back), rng.int(7, 26));
    }
  }
  // A handful of shortcuts. Loops are what make a floor navigable under
  // pressure — a dead-end tree is just a punishment with extra walking.
  for (let k = 0; k < Math.floor(count / 5); k++) {
    const a = rng.int(1, count - 1);
    const b = rng.int(1, count - 1);
    if (a !== b && !nodes[id(a)]!.links.some((l) => l.to === id(b))) {
      link(nodes, id(a), id(b), rng.int(10, 32));
    }
  }
  // The arrival landing always offers a choice. Opening a run on a corridor
  // with one exit is not a decision, it is a corridor.
  while (nodes[id(0)]!.links.length < 2 && count > 2) {
    const candidate = id(rng.int(1, Math.min(6, count - 1)));
    if (!nodes[id(0)]!.links.some((l) => l.to === candidate)) {
      link(nodes, id(0), candidate, rng.int(9, 22));
    }
  }

  // ---- 2. depth from the arrival landing drives difficulty
  const depth = bfsDepth(nodes, id(0));
  const maxDepth = Math.max(1, ...Object.values(depth));

  // ---- 3. assign roles
  const roles: Record<string, NodeKind> = {};
  roles[id(0)] = "corridor";

  const byDepth = order.slice(1).sort((a, b) => (depth[a] ?? 0) - (depth[b] ?? 0));
  const deep = byDepth.filter((x) => (depth[x] ?? 0) >= maxDepth * 0.45);
  const mid = byDepth.filter((x) => (depth[x] ?? 0) >= 2 && (depth[x] ?? 0) < maxDepth * 0.75);

  const take = (pool: string[], k: number): string[] => {
    const picked = rng.sample(pool.filter((p) => !roles[p]), k);
    return picked;
  };

  // Safe rooms are the game's punctuation: boxes only open here, points only
  // spend here, and sleeping only happens here. Spread them out.
  for (const s of take(byDepth, Math.max(2, Math.round(count / 7)))) roles[s] = "safe_room";
  if (n === 1 || n === 3) for (const g of take(mid, 1)) roles[g] = "guild";
  for (const s of take(mid, rng.int(1, 2))) roles[s] = "shop";
  for (const v of take(deep, rng.int(1, 2))) roles[v] = "vault";
  if (rng.chance(0.5)) for (const s of take(mid, 1)) roles[s] = "shrine";

  // Lairs: each holds a boss and a stairwell, which is the deal — the good
  // way down is behind something that would rather you did not.
  const bossPool = rng.shuffle(def.bosses);
  const lairCount = clamp(bossPool.length, 1, 3);
  const lairs = take(deep, lairCount);
  lairs.forEach((l, i) => {
    roles[l] = "lair";
    nodes[l]!.boss = bossPool[i % bossPool.length];
    nodes[l]!.hasStairs = true;
  });

  // Plain stairwells, for anybody who would rather run than fight. Fewer, and
  // deeper, so that "just find the stairs" is a real strategy with a real cost.
  for (const s of take(deep, rng.int(1, 2))) {
    roles[s] = "stairwell";
    nodes[s]!.hasStairs = true;
  }

  // ---- 4. flesh out every node
  const usedNames = new Set<string>();
  for (const nid of order) {
    const node = nodes[nid]!;
    const kind: NodeKind =
      roles[nid] ?? (rng.chance(0.34) ? "corridor" : rng.chance(0.5) ? "chamber" : "plaza");
    node.kind = kind;
    node.name = nid === id(0) ? `the arrival landing` : nameFor(rng, def.qualifiers, def.places, usedNames);
    node.zones = buildZones(rng, kind, n);
    node.entry = node.zones[0]!.id;
    node.note = noteFor(kind);

    const d = depth[nid] ?? 0;
    const pressure = d / maxDepth;

    if (nid === id(0)) {
      // The arrival landing is always empty. You get one room to read the
      // interface and find something to hit things with before the dungeon
      // starts charging for mistakes.
      node.cleared = true;
      node.loot = [
        makeItem(rng, { floor: n, rarity: "junk", prefer: ["weapon"], bespoke: false }),
        makeItem(rng, { floor: n, rarity: "junk", prefer: ["filler"], bespoke: false }),
      ];
      continue;
    }
    if (kind === "safe_room" || kind === "guild") {
      node.cleared = true;
    } else if (kind === "lair") {
      const boss = BOSS_BY_ID[node.boss!];
      node.spawn = boss?.adds ? [{ mob: boss.adds.mob, count: boss.adds.count }] : [];
    } else {
      node.spawn = rollSpawns(rng, def.mobs, n, pressure, kind, d);
    }

    node.loot = rollNodeLoot(rng, n, kind, pressure);
  }

  const hours = def.days * 24;
  return {
    n,
    name: def.name,
    nodes,
    at: id(0),
    hoursLeft: hours,
    hoursTotal: hours,
    // On the first floor the stairwells are seeded partway through the timer.
    // Everywhere else they are in place from the moment the floor opens.
    stairsAnnounced: n !== 1,
    bossesKilled: [],
  };
}

function blankNode(id: string): MapNode {
  return {
    id,
    name: id,
    kind: "corridor",
    zones: [],
    entry: "",
    links: [],
    spawn: [],
    loot: [],
    searched: false,
    cleared: false,
    visited: false,
    sensed: false,
    hasStairs: false,
    note: "",
  };
}

function link(nodes: Record<string, MapNode>, a: string, b: string, minutes: number): void {
  nodes[a]!.links.push({ to: b, minutes, known: false });
  nodes[b]!.links.push({ to: a, minutes, known: false });
}

function bfsDepth(nodes: Record<string, MapNode>, start: string): Record<string, number> {
  const out: Record<string, number> = { [start]: 0 };
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const l of nodes[cur]!.links) {
      if (out[l.to] === undefined) {
        out[l.to] = out[cur]! + 1;
        q.push(l.to);
      }
    }
  }
  return out;
}

function nameFor(rng: Rng, quals: readonly string[], places: readonly string[], used: Set<string>): string {
  for (let attempt = 0; attempt < 24; attempt++) {
    const name = `the ${rng.pick(quals)} ${rng.pick(places)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return `the ${rng.pick(quals)} ${rng.pick(places)} (again)`;
}

function noteFor(kind: NodeKind): string {
  switch (kind) {
    case "safe_room":
      return "Green on the map even through fog. A Bopca who is not interested in your problems, free food, three screens, and the only place your boxes will open.";
    case "guild":
      return "A Tutorial Guild Hall. Finish the tutorial here and the interface stops being a suggestion.";
    case "shop":
      return "Somebody is selling. Somebody is always selling.";
    case "vault":
      return "Shuttered and locked. Whatever is behind it was worth locking.";
    case "lair":
      return "The local mob thins out around here, which is how you know.";
    case "stairwell":
      return "Down. Health refills on the way, and the floor behind you stops mattering.";
    case "shrine":
      return "Something is owed here, and something is offered in return.";
    default:
      return "";
  }
}

function buildZones(rng: Rng, kind: NodeKind, floor: number): Zone[] {
  const options = layoutsFor(kind);
  const layout = options.length ? rng.pick(options) : layoutsFor("chamber")[0]!;
  const zones: Zone[] = layout.zones.map((z) => ({
    id: z.id,
    name: z.name,
    tags: [...z.tags],
    links: [...z.links],
    capacity: z.capacity,
    features: [],
    barricaded: false,
    traps: [],
  }));

  // Ensure the entry zone sorts first — the crawler always starts there.
  const entryIndex = zones.findIndex((z) => z.id === layout.entry);
  if (entryIndex > 0) {
    const [entry] = zones.splice(entryIndex, 1);
    zones.unshift(entry!);
  }

  if (kind === "safe_room" || kind === "guild") return zones;

  // One to three interactables per room. These are the reason a fight has
  // more than one correct answer, so a room without any is a bug, not a
  // quiet moment.
  const wanted = rng.int(1, 3) + (kind === "lair" ? 1 : 0);
  const pool = FEATURES.filter((f) => floor >= 1);
  for (let i = 0; i < wanted; i++) {
    const f = rng.pick(pool);
    const legal = zones.filter(
      (z) => f.requires.length === 0 || f.requires.some((t) => z.tags.includes(t)),
    );
    if (!legal.length) continue;
    const z = rng.pick(legal);
    if (z.features.some((existing) => existing.id === f.id)) continue;
    z.features.push({
      id: f.id,
      name: f.name,
      kind: f.kind,
      dc: f.dc,
      check: f.check,
      spent: false,
      note: f.note,
      primes: f.primes,
    });
  }
  return zones;
}

/**
 * Difficulty is a function of distance from the way in.
 *
 * Without this, a level-6 pack can be standing in the second room a level-1
 * crawler opens, which is not difficulty — it is a coin flip held at the start
 * of the run. Depth gates which mobs are eligible at all, where in their level
 * band they roll, and how many of them there are.
 */
function rollSpawns(
  rng: Rng,
  pool: readonly string[],
  floor: number,
  pressure: number,
  kind: NodeKind,
  depth: number,
): { mob: string; count: number; level: number }[] {
  // A third of the rooms on a floor are empty, more of them near the entrance.
  // Not every corner has a monster in it, and the ones that do land harder.
  if (rng.chance(0.42 - pressure * 0.24)) return [];

  const ceiling = 2 + pressure * 14 + (floor - 1) * 3;
  let legal = pool.filter((m) => {
    const def = MOB_BY_ID[m];
    return (
      def &&
      def.behavior !== "neutral" &&
      // Bounty hunters are not scenery. They are scaled to you and they arrive
      // because somebody read your number — a level band of [3, 40] is meant
      // for that one scripted spawn, and rolling it as generic room fill puts
      // a level-forty stranger in a floor-four cupboard.
      !def.tags.includes("hunter") &&
      floor >= def.floors[0] &&
      floor <= def.floors[1] &&
      def.level[0] <= ceiling
    );
  });
  /**
   * Past the authored bestiary the floors keep coming, and every mob's floor
   * window has closed behind you. Reaching for the weakest thing left on the
   * list is how a floor-eighteen corridor ends up holding a level-four crab —
   * so instead the pool reopens without its window and levels are allowed past
   * their authored band, scaled to depth.
   *
   * This is a placeholder with the right shape rather than real content, and
   * it is deliberately marked as one: floors five and deeper want their own
   * bestiary and will get it.
   */
  let extrapolated = false;
  if (!legal.length) {
    extrapolated = true;
    legal = pool.filter((m) => {
      const def = MOB_BY_ID[m];
      return def && def.behavior !== "neutral" && !def.tags.includes("hunter");
    });
  }
  if (!legal.length) return [];

  const groups = depth >= 3 && rng.chance(0.2 + pressure * 0.4) ? 2 : 1;
  const out: { mob: string; count: number; level: number }[] = [];
  for (let g = 0; g < groups; g++) {
    const mobId = rng.pick(legal);
    const def = MOB_BY_ID[mobId]!;
    const scale = clamp(0.45 + pressure * 0.85, 0.35, 1.3);
    let count = Math.max(1, Math.round(rng.int(def.group[0], def.group[1]) * scale));
    if (kind === "corridor") count = Math.max(1, count - 1); // corridors hold fewer
    if (kind === "plaza" && pressure > 0.4 && rng.chance(0.5)) count += 1;
    // The same depth budget that decided what is allowed in the room decides
    // how big it is. Without this, a mob with a wide band arrives at the top
    // of that band the moment it becomes legal at all, and the difficulty
    // curve stops being a curve and becomes a step.
    // Out past its authored window a mob keeps growing, about two levels a
    // floor, rather than sitting at the top of its band forever or lurching
    // up in one step the moment the window closes.
    const past = extrapolated ? Math.max(0, floor - def.floors[1]) : 0;
    const top = extrapolated
      ? def.level[1] + Math.round(past * 2.4)
      : Math.max(def.level[0], Math.min(def.level[1], Math.round(ceiling)));
    const level = clamp(
      Math.round(def.level[0] + (top - def.level[0]) * pressure + rng.int(-1, 1)),
      def.level[0],
      top,
    );
    out.push({ mob: mobId, count, level });
  }
  return out;
}

function rollNodeLoot(rng: Rng, floor: number, kind: NodeKind, pressure: number): Item[] {
  const rolls =
    kind === "vault" ? rng.int(3, 5) : kind === "shop" ? 0 : kind === "lair" ? rng.int(2, 3) : rng.int(0, 2);
  const out: Item[] = [];
  for (let i = 0; i < rolls; i++) {
    out.push(makeItem(rng, { floor, quality: kind === "vault" ? 2 : pressure > 0.6 ? 1 : 0 }));
  }
  return out;
}

/* ------------------------------------------------------------- navigation */

export function currentNode(floor: FloorState): MapNode {
  return floor.nodes[floor.at]!;
}

export function neighbours(floor: FloorState): { node: MapNode; minutes: number }[] {
  return currentNode(floor).links.map((l) => ({ node: floor.nodes[l.to]!, minutes: l.minutes }));
}

/** Called on arrival: you can now see there are ways on from here. */
export function revealFrom(floor: FloorState, nodeId: string): void {
  const node = floor.nodes[nodeId]!;
  node.visited = true;
  for (const l of node.links) {
    l.known = true;
    floor.nodes[l.to]!.sensed = true;
    const back = floor.nodes[l.to]!.links.find((x) => x.to === nodeId);
    if (back) back.known = true;
  }
}

export function stairwellsKnown(floor: FloorState): MapNode[] {
  if (!floor.stairsAnnounced) return [];
  return Object.values(floor.nodes).filter((n) => n.hasStairs && (n.visited || n.sensed));
}

export function floorProgress(floor: FloorState): number {
  const all = Object.values(floor.nodes);
  const done = all.filter((n) => n.visited).length;
  return Math.round((done / all.length) * 100);
}

/** Shortest route by travel minutes across known links. Used by "go to". */
export function route(floor: FloorState, from: string, to: string): string[] | null {
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const seen = new Set<string>();
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [k, v] of Object.entries(dist)) {
      if (!seen.has(k) && v < best) {
        best = v;
        cur = k;
      }
    }
    if (cur === null) return null;
    if (cur === to) break;
    seen.add(cur);
    for (const l of floor.nodes[cur]!.links) {
      if (!l.known) continue;
      const next = best + l.minutes;
      if (next < (dist[l.to] ?? Infinity)) {
        dist[l.to] = next;
        prev[l.to] = cur;
      }
    }
  }
  const path: string[] = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev[cur]!;
    path.unshift(cur);
  }
  return path;
}
