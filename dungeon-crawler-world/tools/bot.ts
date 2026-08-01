import { Game, type Command } from "../src/sim/game.ts";
import type { GameState, MapNode } from "../src/core/types.ts";
import { crawlerOf, hostilesOf, living, zoneDistance, zoneOf } from "../src/sim/tactics.ts";
import { derive } from "../src/sim/character.ts";
import { BOSS_BY_ID, MOB_BY_ID } from "../src/data/mobs.ts";

/**
 * A competent-but-not-clairvoyant policy that plays the game through the same
 * public command surface a person uses.
 *
 * It exists for two reasons. First, it is the balance harness: two hundred
 * runs tell you whether floor one kills 40% of crawlers or 4%, and no amount
 * of staring at a damage formula tells you that. Second, it is the most
 * demanding integration test in the repo — it will find the crash on turn
 * nine thousand that a hand-written test never reaches.
 */

export interface BotOptions {
  maxTurns?: number;
  /** Called with every turn's rendered output, for a watchable demo run. */
  onTurn?: (cmd: Command, lines: { channel: string; text: string }[], state: GameState) => void;
  /** Stop once this floor is reached. */
  stopAtFloor?: number;
}

export interface BotResult {
  turns: number;
  died: boolean;
  cause: string;
  floor: number;
  level: number;
  hours: number;
  views: number;
  kills: number;
  bossKills: number;
  roomsCleared: number;
  fled: number;
  achievements: number;
  boxesOpened: number;
  gold: number;
  topSkill: number;
}

export async function autoPlay(game: Game, opts: BotOptions = {}): Promise<BotResult> {
  const max = opts.maxTurns ?? 2500;
  let turns = 0;

  const run = async (cmd: Command): Promise<void> => {
    turns++;
    const r = await game.execute(cmd);
    opts.onTurn?.(cmd, r.lines, game.state);
  };

  // Stall guard. A command the simulation refuses costs no time, so a policy
  // bug becomes an infinite loop rather than a bad score.
  //
  // The signal has to include combat rounds. The clock deliberately does not
  // advance mid-fight — time is charged when the fight ends — so watching
  // `elapsed` alone declares every fight past a dozen turns a stall and jams
  // the policy into permanent end-turn, which is a very slow way to be beaten
  // to death by a rat.
  const progress = (): string =>
    `${game.state.elapsed.toFixed(4)}|${game.state.encounter?.round ?? 0}|${game.state.encounter?.killsThisFight ?? 0}`;
  let lastProgress = "";
  let stuck = 0;

  while (turns < max && game.state.crawler.alive) {
    if (opts.stopAtFloor && game.state.floor.n >= opts.stopAtFloor) break;
    const s = game.state;
    const now = progress();
    if (now === lastProgress) stuck++;
    else {
      stuck = 0;
      lastProgress = now;
    }
    const fighting = s.encounter !== null && s.encounter.finished === null;
    const cmd =
      stuck > 12
        ? // The unstick move has to be legal where we are. `wait` is refused
          // mid-fight, which turns the guard itself into the loop.
          fighting
          ? ({ t: "endturn" } as const)
          : ({ t: "wait", hours: 1 } as const)
        : fighting
          ? fightPlan(s)
          : explorePlan(s, game);
    await run(cmd);
  }

  const s = game.state;
  return {
    turns,
    died: !s.crawler.alive,
    cause: s.crawler.death?.cause ?? "survived",
    floor: s.floor.n,
    level: s.crawler.level,
    hours: s.elapsed,
    views: s.ratings.views,
    kills: s.counters.kills,
    bossKills: s.counters.bossKills,
    roomsCleared: s.counters.roomsCleared,
    fled: s.counters.fled,
    achievements: s.achievements.length,
    boxesOpened: s.counters.boxesOpened,
    gold: s.crawler.gold,
    topSkill: Math.max(0, ...Object.values(s.skills).map((k) => k.level)),
  };
}

/* ------------------------------------------------------------- fighting */

function fightPlan(s: GameState): Command {
  const enc = s.encounter!;
  const node = s.floor.nodes[enc.nodeId]!;
  const me = crawlerOf(enc);
  const foes = living(enc, "hostile");
  const d = derive(s);
  const hpFrac = me.hp / me.hpMax;

  // Bleeding out is the most common way to die, so treat it before anything.
  const bleeding = s.crawler.statuses.some((x) => x.id === "bleeding");
  const bandage = s.inventory.find((i) => i.use?.effect === "bleed");
  if (bleeding && bandage && enc.actions.act > 0 && hpFrac < 0.6) {
    return { t: "use", item: bandage.iid };
  }

  const potion = s.inventory.find((i) => i.use?.effect === "heal");
  if (hpFrac < 0.3 && potion && enc.actions.act > 0) return { t: "use", item: potion.iid };
  if (hpFrac < 0.18 && !potion) return { t: "flee" };

  // Mana is scarce enough that a spell is worth a whole turn or it is not
  // worth casting. Spend it when the fight is actually going badly.
  if (enc.actions.act > 0 && (hpFrac < 0.5 || foes.length >= 3)) {
    const castable = Object.values(s.spellbook).filter(
      (sp) => sp.mana <= s.crawler.mana && !(s.cooldowns[sp.id] > 0),
    );
    const healer = castable.find((sp) => sp.effects.some((e) => e.k === "heal"));
    const blast = castable
      .filter((sp) => sp.effects.some((e) => e.k === "damage" && e.scope === "zone"))
      .sort((a, b) => b.mana - a.mana)[0];
    if (hpFrac < 0.35 && healer) return { t: "cast", spell: healer.id };
    if (foes.length >= 3 && blast) return { t: "cast", spell: blast.id };
  }

  // A feature that catches two or more is almost always better than a swing.
  if (enc.actions.act > 0) {
    const best = bestFeature(s, node, enc, me);
    if (best) return { t: "feature", id: best };
  }

  // Outnumbered in the open is how people die. Get to a chokepoint.
  const here = zoneOf(node, me.zone);
  const pressure = foes.filter((f) => f.zone === me.zone && f.reach <= 1).length;
  if (enc.actions.move > 0 && pressure >= 2 && here.capacity > 1) {
    const choke = here.links
      .map((l) => zoneOf(node, l))
      .filter((z) => z.capacity < here.capacity && !z.barricaded)
      .sort((a, b) => a.capacity - b.capacity)[0];
    if (choke) return { t: "move", zone: choke.id };
  }

  if (enc.actions.act > 0) {
    const reachable = foes
      .filter((f) => zoneDistance(node, me.zone, f.zone) <= me.reach)
      .sort((a, b) => a.hp - b.hp);
    if (reachable.length) return { t: "attack", target: reachable[0]!.id };

    // Nothing in reach and something worth throwing at a cluster.
    const bomb = s.inventory.find((i) => i.kind === "explosive");
    if (bomb && foes.length >= 2) {
      const target = clusterZone(node, enc, me);
      if (target && target !== me.zone) return { t: "throw", item: bomb.iid, zone: target };
    }
  }

  if (enc.actions.move > 0) {
    const nearest = foes
      .slice()
      .sort((a, b) => zoneDistance(node, me.zone, a.zone) - zoneDistance(node, me.zone, b.zone))[0]!;
    const step = zoneOf(node, me.zone).links.find(
      (l) => zoneDistance(node, l, nearest.zone) < zoneDistance(node, me.zone, nearest.zone),
    );
    if (step) return { t: "move", zone: step };
  }

  return { t: "endturn" };
}

function bestFeature(
  s: GameState,
  node: MapNode,
  enc: NonNullable<GameState["encounter"]>,
  me: { zone: string; id: string },
): string | null {
  let best: string | null = null;
  let bestCount = 1; // never spend an action to catch a single target
  for (const z of node.zones) {
    if (zoneDistance(node, me.zone, z.id) > 1) continue;
    for (const f of z.features) {
      if (f.spent) continue;
      if (f.kind === "cache" || f.kind === "barricade_stock" || f.kind === "vent") continue;
      const targets = [z.id, ...z.links];
      for (const t of targets) {
        if (t === me.zone) continue; // do not stand in it
        const count = hostilesOf(enc, me as never).filter((h) => h.zone === t).length;
        if (count > bestCount) {
          bestCount = count;
          best = f.id;
        }
      }
    }
  }
  return best;
}

function clusterZone(
  node: MapNode,
  enc: NonNullable<GameState["encounter"]>,
  me: { zone: string; id: string },
): string | null {
  let best: string | null = null;
  let count = 0;
  for (const z of node.zones) {
    const n = hostilesOf(enc, me as never).filter((h) => h.zone === z.id).length;
    if (n > count) {
      count = n;
      best = z.id;
    }
  }
  return count >= 2 ? best : null;
}

/* ------------------------------------------------------------ exploring */

function explorePlan(s: GameState, game: Game): Command {
  const floor = s.floor;
  const node = floor.nodes[floor.at]!;
  const d = derive(s);
  const hpFrac = s.crawler.hp / d.hpMax;
  const safe = node.kind === "safe_room" || node.kind === "guild";
  const timePressure = floor.hoursLeft < 10;

  if (safe) {
    if (s.boxes.length > 0) return { t: "open" };
    if (s.crawler.points > 0) return { t: "spend", stat: bestStat(s) };
    // Only if it will actually work. A refused command costs no time, and a
    // policy that keeps asking for a meal it cannot afford never stops asking.
    const canBuyMeal = floor.n <= 2 || s.crawler.gold >= 15 * floor.n;
    const hasFood = s.inventory.some((i) => i.kind === "food");
    if (s.crawler.hunger > 40 && (canBuyMeal || hasFood)) return { t: "eat" };
    if ((s.crawler.fatigue > 70 || hpFrac < 0.55) && !timePressure) return { t: "rest" };
    if (node.kind === "guild" && floor.n >= 3 && !s.crawler.race) {
      // Take a recommendation — which is usually one the run assembled — and
      // fall back to whatever is cheapest to qualify for.
      const menu = game.classOptions();
      const affordable = menu
        .slice()
        .sort((a, b) => reqGap(s, a.req) - reqGap(s, b.req));
      const pick = affordable.find((o) => o.recommended) ?? affordable[0]!;
      return { t: "select", race: "human", klass: pick.id };
    }
  }

  if (s.offers.length > 0) return { t: "sign", sponsor: s.offers[0]!.sponsor };

  // Equip anything strictly better than what is on. Cheap, and it is the
  // single largest survivability lever available for free.
  const upgrade = findUpgrade(s);
  if (upgrade) return { t: "equip", item: upgrade };

  const bleeding = s.crawler.statuses.some((x) => x.id === "bleeding");
  const bandage = s.inventory.find((i) => i.use?.effect === "bleed");
  if (bleeding && bandage) return { t: "use", item: bandage.iid };

  // Something here, and we are not equal to it: leave. Walking a level-2
  // crawler into a Borough boss is not bravery, it is the commonest way this
  // game ends and a competent player does not do it.
  if (hasHostiles(s, node) && outclassed(s, node)) {
    const away = node.links.find((l) => floor.nodes[l.to]!.cleared || floor.nodes[l.to]!.visited);
    if (away) return { t: "go", to: away.to };
  }

  // Hostiles here and we slipped in unseen: set up before starting it.
  if (s.flags.undetected) {
    if (!s.flags.ambushReady) return { t: "prep", what: "ambush" };
    return { t: "engage" };
  }
  if (hasHostiles(s, node)) {
    if (hpFrac < 0.4) {
      const back = node.links.find((l) => floor.nodes[l.to]!.cleared);
      if (back) return { t: "go", to: back.to };
    }
    return { t: "engage" };
  }

  if (!node.searched && node.kind !== "safe_room") return { t: "search" };

  // Time to leave the floor: stairs beat completionism, always.
  const stairs = Object.values(floor.nodes).filter(
    (n) => n.hasStairs && (n.visited || n.sensed) && (!n.boss || floor.bossesKilled.includes(n.boss)),
  );
  const explored = Object.values(floor.nodes).filter((n) => n.visited).length;
  const wantOut = timePressure || explored > Object.values(floor.nodes).length * 0.55;
  if (floor.stairsAnnounced && wantOut && stairs.length) {
    if (node.hasStairs && (!node.boss || floor.bossesKilled.includes(node.boss))) {
      return { t: "descend" };
    }
    return { t: "go", to: stairs[0]!.id };
  }

  // Rest up before pushing on if there is slack in the clock.
  if (hpFrac < 0.5 && !timePressure) {
    const nearSafe = node.links.find((l) => floor.nodes[l.to]!.kind === "safe_room");
    if (nearSafe) return { t: "go", to: nearSafe.to };
    return { t: "prep", what: "breather" };
  }

  const unvisited = node.links
    .filter((l) => !floor.nodes[l.to]!.visited)
    .filter((l) => !knownDeathtrap(s, floor.nodes[l.to]!));
  if (unvisited.length) {
    const pick = unvisited.sort((a, b) => a.minutes - b.minutes)[0]!;
    // Look before you leap, when there is time for it. Scouting is the single
    // highest-value action available and costs twelve minutes.
    if (!s.flags[`scouted_${pick.to}`] && !timePressure) return { t: "scout", node: pick.to };
    return { t: "go", to: pick.to };
  }

  // Nothing unexplored next door. Find the nearest unexplored place we can
  // actually get to across known ground, and take the first step toward it.
  // Asking for somewhere unreachable throws, costs no time, and loops forever.
  const target = nearestReachable(s, (n) => !n.visited && !knownDeathtrap(s, n));
  if (target) return { t: "go", to: target };

  // Everything reachable is seen and there is nowhere left to be clever. Take
  // whatever stairs exist, boss or no boss — the timer wins every argument it
  // is ever in.
  if (floor.stairsAnnounced) {
    if (node.hasStairs) return hasHostiles(s, node) ? { t: "engage" } : { t: "descend" };
    const toStairs = nearestReachable(s, (n) => n.hasStairs);
    if (toStairs) return { t: "go", to: toStairs };
  }
  return { t: "wait", hours: 1 };
}

/**
 * Breadth-first over links we actually know about, returning the first step
 * toward the nearest match. Returning a node id we cannot route to makes the
 * command throw for free, and a free failing command is an infinite loop.
 */
function nearestReachable(s: GameState, want: (n: MapNode) => boolean): string | null {
  const floor = s.floor;
  const start = floor.at;
  const prev = new Map<string, string>();
  const seen = new Set([start]);
  const queue = [start];
  let found: string | null = null;

  while (queue.length && !found) {
    const cur = queue.shift()!;
    for (const l of floor.nodes[cur]!.links) {
      if (!l.known || seen.has(l.to)) continue;
      seen.add(l.to);
      prev.set(l.to, cur);
      if (want(floor.nodes[l.to]!)) {
        found = l.to;
        break;
      }
      queue.push(l.to);
    }
  }
  if (!found) return null;

  let step = found;
  while (prev.get(step) !== start && prev.has(step)) step = prev.get(step)!;
  return step;
}

/** Is what is standing in this room out of our weight class? */
function outclassed(s: GameState, node: MapNode): boolean {
  if (node.boss && !s.floor.bossesKilled.includes(node.boss)) {
    const boss = BOSS_BY_ID[node.boss];
    if (boss && s.crawler.level < boss.level - 2) return true;
  }
  const worst = Math.max(
    0,
    ...node.spawn.map((g) => (g.level ?? MOB_BY_ID[g.mob]?.level[1] ?? 0)),
  );
  const bodies = node.spawn.reduce((n, g) => n + g.count, 0);
  return worst > s.crawler.level + 4 && bodies >= 3;
}

/** Only counts as known if we scouted it or have already been in it. */
function knownDeathtrap(s: GameState, node: MapNode): boolean {
  const known = s.flags[`scouted_${node.id}`] === true || node.visited;
  return known && outclassed(s, node);
}

function reqGap(s: GameState, req: Partial<Record<string, number>>): number {
  return Object.entries(req).reduce(
    (n, [k, v]) => n + Math.max(0, (v as number) - (s.crawler.stats as Record<string, number>)[k]!),
    0,
  );
}

function hasHostiles(s: GameState, node: MapNode): boolean {
  if (node.cleared) return false;
  if (node.boss && !s.floor.bossesKilled.includes(node.boss)) return true;
  return node.spawn.length > 0;
}

function bestStat(s: GameState): "str" | "dex" | "con" | "int" | "cha" {
  // Constitution first — health is the only stat that stops a run ending.
  const c = s.crawler.stats;
  if (c.con < 12) return "con";
  if (c.str < 10) return "str";
  if (c.dex < 10) return "dex";
  return "con";
}

function findUpgrade(s: GameState): string | null {
  for (const item of s.inventory) {
    if (item.equipped || !item.slot) continue;
    const worn = s.inventory.find((i) => i.equipped && i.slot === item.slot);
    if (!worn) return item.iid;
    if (score(item) > score(worn)) return item.iid;
  }
  return null;
}

function score(i: { mods?: { k: string; v?: number }[]; damage?: string; rarity: string }): number {
  const mods = (i.mods ?? []).reduce((n, m) => n + (typeof m.v === "number" ? m.v : 0), 0);
  const dice = i.damage ? avgDice(i.damage) : 0;
  const rarityBonus = ["junk", "common", "uncommon", "rare", "epic", "legendary", "celestial"].indexOf(i.rarity);
  return mods + dice * 1.5 + rarityBonus;
}

function avgDice(spec: string): number {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(spec);
  if (!m) return 0;
  const n = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2]!, 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;
  return n * ((sides + 1) / 2) + mod;
}
