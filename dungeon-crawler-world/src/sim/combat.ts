import type { Combatant, EncounterState, GameState, MapNode, Style, Zone } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import { clamp } from "../core/util.ts";
import { BOSS_BY_ID, MOB_BY_ID, type BossDef } from "../data/mobs.ts";
import { makeStatus, statusEffects } from "../data/statuses.ts";
import { derive, skillLevel, trainSkill } from "./character.ts";
import { chooseAiAction, type AiAction } from "./ai.ts";
import { hookBonus, hookResist, type HookCtx } from "./emergent.ts";
import {
  addToDice,
  byId,
  crawlerOf,
  hostilesOf,
  living,
  meleePressure,
  zoneDistance,
  zoneOf,
} from "./tactics.ts";

export { addToDice, byId, crawlerOf, hostilesOf, living, meleePressure, zoneDistance, zoneOf };

/**
 * The tactical layer.
 *
 * Three ideas carry the whole system, and everything else is bookkeeping:
 *
 *   ZONES        A room is a small graph of positions, not a place. Where you
 *                are standing is a decision with consequences.
 *
 *   CAPACITY     Each position states how many enemies can bring a melee
 *                weapon to bear on one defender standing in it. A doorway is
 *                capacity 1. That single number is why one crawler with a
 *                spear can hold a corridor against six things, and it is the
 *                mechanical form of the sentence "cleverness buys position".
 *
 *   FEATURES     Every room ships with one to three things that are not
 *                enemies and can still end the fight. The bus you can shoulder
 *                over. The gas main nobody has dealt with. The cable that is
 *                still live, in a room with standing water.
 *
 * The resolver does not know what "fair" means and does not try to be. It
 * knows what is in the room.
 */

/* ------------------------------------------------------------- spawning */

function scaleMob(rng: Rng, mobId: string, level: number, index: number): Combatant {
  const def = MOB_BY_ID[mobId]!;
  const delta = Math.max(0, level - def.level[0]);
  const suffix = index > 0 ? ` ${"αβγδεζηθ"[index] ?? index + 1}` : "";
  return {
    id: `${mobId}_${index}_${Math.floor(rng.next() * 1e6).toString(36)}`,
    sourceId: mobId,
    name: def.name + suffix,
    side: "hostile",
    level,
    hp: Math.round(def.hp * (1 + 0.13 * delta)),
    hpMax: Math.round(def.hp * (1 + 0.13 * delta)),
    armor: def.armor + Math.floor(delta / 3),
    accuracy: def.accuracy + Math.round(delta * 0.6),
    defense: def.defense + Math.round(delta * 0.45),
    damage: addToDice(def.damage, Math.round(delta * 0.7)),
    reach: def.reach,
    initiative: 0,
    zone: "",
    behavior: def.behavior,
    statuses: [],
    hidden: def.behavior === "ambusher",
    braced: false,
    aiming: false,
    prone: false,
    fleeing: false,
    alive: true,
    xp: Math.round(def.xp * (1 + 0.18 * delta)),
    tags: [...def.tags],
    weapon: def.weapon,
    blockedBy: null,
  };
}

function bossCombatant(boss: BossDef): Combatant {
  return {
    id: `boss_${boss.id}`,
    sourceId: boss.id,
    name: boss.name,
    side: "hostile",
    level: boss.level,
    hp: boss.hp,
    hpMax: boss.hp,
    armor: boss.armor,
    accuracy: boss.accuracy,
    defense: boss.defense,
    damage: boss.damage,
    reach: boss.reach,
    initiative: 0,
    zone: "",
    behavior: boss.phases[0]!.behavior,
    statuses: [],
    hidden: false,
    braced: false,
    aiming: false,
    prone: false,
    fleeing: false,
    alive: true,
    xp: boss.xp,
    tags: ["boss", boss.size],
    weapon: "everything it is made of",
    blockedBy: null,
  };
}

function crawlerCombatant(state: GameState, node: MapNode): Combatant {
  const d = derive(state);
  return {
    id: "crawler",
    sourceId: "crawler",
    name: state.crawler.name,
    side: "crawler",
    level: state.crawler.level,
    hp: state.crawler.hp,
    hpMax: d.hpMax,
    armor: d.armor,
    accuracy: d.accuracy,
    defense: d.defense,
    damage: addToDice(d.weaponDamage, d.damageBonus),
    reach: d.reach,
    initiative: 0,
    zone: node.entry,
    behavior: "crawler",
    statuses: state.crawler.statuses,
    hidden: false,
    braced: false,
    aiming: false,
    prone: false,
    fleeing: false,
    alive: true,
    xp: 0,
    tags: ["crawler"],
    weapon: d.weaponName,
    blockedBy: null,
  };
}

function companionCombatants(state: GameState, node: MapNode): Combatant[] {
  return state.companions
    .filter((c) => c.alive)
    .map((c) => ({
      id: `ally_${c.id}`,
      sourceId: c.id,
      name: c.name,
      side: "ally" as const,
      level: c.level,
      hp: c.hp,
      hpMax: c.hpMax,
      armor: Math.floor(c.level / 4),
      accuracy: Math.floor(c.stats.dex / 2) + c.level,
      defense: 9 + Math.floor(c.stats.dex / 2),
      damage: addToDice(c.sapient ? "1d6" : "1d4", Math.floor(c.stats.str / 3) + Math.floor(c.level / 2)),
      reach: 1,
      initiative: 0,
      zone: node.entry,
      behavior: c.stance === "aggressive" ? "brute" : c.stance === "hide" ? "ambusher" : "skirmisher",
      statuses: [],
      hidden: c.stance === "hide",
      braced: false,
      aiming: false,
      prone: false,
      fleeing: false,
      alive: true,
      xp: 0,
      tags: ["ally", c.species.toLowerCase()],
      weapon: c.sapient ? "whatever they picked up" : "teeth",
      blockedBy: null,
    }));
}

/* ------------------------------------------------------------ encounter */

export function beginEncounter(
  state: GameState,
  rng: Rng,
  log: EventLog,
  node: MapNode,
  opts: { ambush?: boolean } = {},
): EncounterState {
  const hostiles: Combatant[] = [];

  if (node.boss && !state.floor.bossesKilled.includes(node.boss)) {
    const boss = BOSS_BY_ID[node.boss]!;
    hostiles.push(bossCombatant(boss));
  }
  let idx = 0;
  for (const group of node.spawn) {
    const def = MOB_BY_ID[group.mob];
    if (!def) continue;
    for (let i = 0; i < group.count; i++) {
      const level = group.level ?? rng.int(def.level[0], def.level[1]);
      hostiles.push(scaleMob(rng, group.mob, level, idx++));
    }
  }

  const crawler = crawlerCombatant(state, node);
  const allies = companionCombatants(state, node);

  // Hostiles deploy away from the entrance, favouring cover and height, which
  // means walking through the door is walking into the worst position in the
  // room. Nobody set that up for you; that is simply where things stand.
  const far = node.zones
    .slice()
    .sort((a, b) => zoneDistance(node, node.entry, b.id) - zoneDistance(node, node.entry, a.id));
  hostiles.forEach((h, i) => {
    const preferred =
      h.behavior === "shooter" || h.behavior === "caster"
        ? far.find((z) => z.tags.includes("cover") || z.tags.includes("high")) ?? far[0]!
        : h.behavior === "ambusher"
          ? far.find((z) => z.tags.includes("cover") || z.tags.includes("dark")) ?? far[0]!
          : far[Math.min(i % 2, far.length - 1)]!;
    h.zone = preferred.id;
  });

  const surprise: EncounterState["surprise"] = opts.ambush
    ? "crawler"
    : hostiles.some((h) => h.hidden) && !opts.ambush
      ? "hostiles"
      : "none";
  if (opts.ambush) {
    crawler.hidden = true;
    for (const h of hostiles) h.hidden = false;
  }

  const all = [crawler, ...allies, ...hostiles];
  for (const c of all) c.initiative = rng.d(20) + (c.id === "crawler" ? derive(state).initiative : c.accuracy);

  const enc: EncounterState = {
    nodeId: node.id,
    round: 1,
    order: all.slice().sort((a, b) => b.initiative - a.initiative).map((c) => c.id),
    turnIndex: -1,
    combatants: all,
    surprise,
    actions: { move: 1, act: 1 },
    finished: null,
    killsThisFight: 0,
    roundsTaken: 0,
    killLog: [],
    lastStands: 1 + hookBonus(state, "lastStand"),
  };

  log.push({
    kind: "encounter_start",
    channel: "bad",
    room: node.name,
    hostiles: hostiles.map((h) => ({ name: h.name, level: h.level })),
    surprise,
  });

  // A surprise round: whichever side has it acts before initiative applies.
  if (surprise === "hostiles") {
    log.say("Something was already here, and it was already waiting.");
    for (const h of hostiles.filter((x) => x.hidden)) {
      runAiTurn(state, rng, log, enc, node, h);
    }
    for (const h of hostiles) h.hidden = false;
  }

  advanceToCrawler(state, rng, log, enc, node);
  return enc;
}

/* ------------------------------------------------------------- attacking */

export interface AttackContext {
  improvised?: boolean;
  thrown?: boolean;
  featureKill?: boolean;
  extraAccuracy?: number;
  extraDamage?: number;
  damageOverride?: string;
  label?: string;
}

export function resolveAttack(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
  attacker: Combatant,
  defender: Combatant,
  ctx: AttackContext = {},
): { hit: boolean; damage: number; killed: boolean } {
  const dist = zoneDistance(node, attacker.zone, defender.zone);
  const isRanged = attacker.reach > 1 && dist > 0;

  let acc = attacker.accuracy + (ctx.extraAccuracy ?? 0);
  const reasons: string[] = [];

  if (dist > attacker.reach) {
    log.push({
      kind: "miss_reason",
      channel: "system",
      attacker: attacker.name,
      reason: `${defender.name} is too far away to reach.`,
    });
    return { hit: false, damage: 0, killed: false };
  }

  // Distance. Marksmanship exists to make this survivable.
  if (isRanged && dist > 1) {
    const marks = attacker.side === "crawler" ? skillLevel(state, "marksmanship") : 0;
    const penalty = (dist - 1) * 2 - Math.floor(marks / 2);
    acc -= Math.max(0, penalty);
    if (penalty > 0) reasons.push("distance");
  }

  const aZone = zoneOf(node, attacker.zone);
  const dZone = zoneOf(node, defender.zone);
  if (aZone.tags.includes("high") && !dZone.tags.includes("high")) {
    acc += 2;
    reasons.push("high ground");
  }
  if (isRanged && dZone.tags.includes("cover")) {
    acc -= 3;
    reasons.push("cover");
  }
  if (defender.prone) {
    acc += isRanged ? -2 : 2;
  }
  if (attacker.hidden) {
    acc += 4;
    reasons.push("unseen");
  }
  if (attacker.aiming) {
    acc += 3;
    attacker.aiming = false;
  }

  // Flanking: every extra body already on the defender is another angle they
  // cannot cover. Capped, because a mob of nine should not be an auto-hit.
  const pressure = meleePressure(enc, node, defender);
  if (!isRanged && pressure.engaged > 1) {
    acc += Math.min(3, pressure.engaged - 1);
    reasons.push("flanked");
  }

  const dStatus = statusEffects(defender.statuses, defender.side === "crawler" ? skillLevel(state, "pain_tolerance") : 0);
  const aStatus = statusEffects(attacker.statuses, attacker.side === "crawler" ? skillLevel(state, "pain_tolerance") : 0);
  let defence = defender.defense + dStatus.defense + (defender.braced ? 3 : 0);
  acc += aStatus.accuracy;

  // Whatever this run has taught this crawler that the repo never knew about.
  // Minted skills and generated classes both land here, on the same swing they
  // were earned for.
  const hookCtx: HookCtx = {
    choke: aZone.capacity <= 2,
    outnumbered: hostilesOf(enc, attacker).length >= 3,
    hidden: attacker.hidden,
    ranged: isRanged,
    melee: !isRanged,
    wounded: attacker.hp / attacker.hpMax < 0.34,
    vs_higher: defender.level > attacker.level,
    unarmed: (ctx.label ?? attacker.weapon) === "your bare hands",
    improvised: ctx.improvised === true,
    fire: /fire|burn|molotov|flame/i.test(ctx.label ?? attacker.weapon),
    high_ground: aZone.tags.includes("high"),
    vs_larger: defender.tags.includes("boss"),
  };
  if (attacker.side === "crawler") acc += hookBonus(state, "accuracy", hookCtx);
  if (defender.side === "crawler") {
    defence += hookBonus(state, "defense", {
      choke: dZone.capacity <= 2,
      outnumbered: hostilesOf(enc, defender).length >= 3,
      melee: !isRanged,
      ranged: isRanged,
      wounded: defender.hp / defender.hpMax < 0.34,
      vs_larger: attacker.tags.includes("boss"),
    });
  }

  // Unstable gear fails on its own schedule and does not care whose turn it is.
  const unstable = attacker.side === "crawler" ? derive(state).unstable : 0;
  if (unstable > 0 && rng.chance(unstable)) {
    log.push({
      kind: "miss_reason",
      channel: "bad",
      attacker: attacker.name,
      reason: `${attacker.weapon} jams, misfires, or simply declines. This was a known property of it.`,
    });
    return { hit: false, damage: 0, killed: false };
  }

  const natural = rng.d(20);
  const total = natural + acc;
  const critRange = attacker.side === "crawler" ? derive(state).critRange : 20;
  const critWiden = attacker.side === "crawler" ? hookBonus(state, "crit", hookCtx) : 0;
  const crit = natural >= critRange - critWiden;
  const hit = crit || (natural !== 1 && total >= defence);
  const graze = !hit && total >= defence - 2;

  if (!hit && !graze) {
    log.push({
      kind: "attack",
      channel: attacker.side === "crawler" ? "narration" : "good",
      attacker: attacker.name,
      target: defender.name,
      weapon: ctx.label ?? attacker.weapon,
      byCrawler: attacker.side === "crawler",
      hit: false,
      crit: false,
      graze: false,
      damage: 0,
      targetHp: defender.hp,
      targetHpMax: defender.hpMax,
      styles: [],
    });
    return { hit: false, damage: 0, killed: false };
  }

  // Parry converts a landed melee hit into a graze. It is the reason a
  // defensive build survives a bad round rather than merely delaying one.
  let grazed = graze;
  if (hit && !crit && defender.side === "crawler" && !isRanged) {
    const parry = skillLevel(state, "parry");
    if (parry > 0 && rng.chance(clamp(parry * 0.035, 0, 0.4))) {
      grazed = true;
      log.say(`You turn ${attacker.name}'s weapon aside. Not cleanly, but aside.`);
    }
  }

  const spec = ctx.damageOverride ?? attacker.damage;
  let damage = rng.roll(spec) + (ctx.extraDamage ?? 0) + aStatus.damage;
  if (attacker.side === "crawler") damage += hookBonus(state, "damage", hookCtx);
  if (crit) damage += rng.roll(spec);
  if (grazed) damage = Math.ceil(damage / 2);

  // First Strike: the entire reason a level 3 crawler can kill a level 9
  // anything, provided they got there first and quietly.
  if (attacker.hidden && attacker.side === "crawler") {
    damage += Math.round(damage * (0.5 + skillLevel(state, "first_strike") * 0.15));
  }

  let soak = defender.armor;
  if (defender.side === "crawler") {
    soak += hookBonus(state, "armor", { melee: !isRanged, ranged: isRanged });
    if (hookCtx.fire) soak += hookResist(state, "fire");
  }
  damage = Math.max(1, damage - soak);
  defender.hp = Math.max(0, defender.hp - damage);

  // The last stand. A blow that would end the run instead leaves you upright
  // with one round to change the situation, once per fight. It is not a free
  // life — nothing is healed, the clock does not stop, and the next thing that
  // lands finishes it. It exists because dying between two lines of text with
  // no chance to answer is the worst thing a game like this can do to you.
  if (defender.hp <= 0 && defender.side === "crawler" && enc.lastStands > 0) {
    enc.lastStands--;
    defender.hp = 1;
    if (!defender.statuses.some((x) => x.id === "dying")) {
      defender.statuses.push(makeStatus("dying", 99));
    }
    log.say(
      "That should have been the end of it. It is not, quite. You are on one knee with a round in hand and every camera in the district swinging onto you — change something, or this was simply a longer way of dying.",
    );
  }

  const styles = collectStyles(state, enc, node, attacker, defender, ctx, { crit, ranged: isRanged });

  log.push({
    kind: "attack",
    channel: attacker.side === "crawler" ? "good" : "bad",
    attacker: attacker.name,
    target: defender.name,
    weapon: ctx.label ?? attacker.weapon,
    byCrawler: attacker.side === "crawler",
    hit: true,
    crit,
    graze: grazed,
    damage,
    targetHp: defender.hp,
    targetHpMax: defender.hpMax,
    styles,
  });

  applyWound(rng, log, attacker, defender, damage, ctx);

  if (attacker.hidden) attacker.hidden = false;
  if (attacker.side === "crawler") state.counters.damageDealt += damage;
  if (defender.side === "crawler") state.counters.damageTaken += damage;

  let killed = false;
  if (defender.hp <= 0) {
    killed = true;
    kill(state, log, enc, attacker, defender, ctx.label ?? attacker.weapon, styles);
  }
  return { hit: true, damage, killed };
}

function applyWound(
  rng: Rng,
  log: EventLog,
  attacker: Combatant,
  defender: Combatant,
  damage: number,
  ctx: AttackContext,
): void {
  if (!defender.alive || defender.hp <= 0) return;
  const severity = damage / Math.max(1, defender.hpMax);
  if (severity < 0.14) return;

  const weapon = (ctx.label ?? attacker.weapon).toLowerCase();
  let id: string | null = null;
  if (/axe|blade|knife|machete|sword|claw|teeth|serrated|cleaver/.test(weapon)) id = "bleeding";
  else if (/hammer|maul|sledge|pipe|bar|club|fist|kerb|masonry/.test(weapon)) id = "staggered";
  else if (/burn|fire|molotov|flame/.test(weapon)) id = "burning";
  else if (severity > 0.3) id = "concussed";

  if (!id) return;
  const p = clamp(severity * 1.3, 0.1, 0.7);
  if (!rng.chance(p)) return;
  if (defender.statuses.some((s) => s.id === id)) return;

  const st = makeStatus(id, id === "staggered" ? 1 : rng.int(2, 4));
  defender.statuses.push(st);
  log.push({
    kind: "status",
    channel: defender.side === "crawler" ? "bad" : "good",
    who: defender.name,
    status: st.name,
    applied: true,
    note: st.note,
  });
}

function collectStyles(
  state: GameState,
  enc: EncounterState,
  node: MapNode,
  attacker: Combatant,
  defender: Combatant,
  ctx: AttackContext,
  info: { crit: boolean; ranged: boolean },
): Style[] {
  if (attacker.side !== "crawler") return [];
  const s: Style[] = [];
  const d = derive(state);
  if (d.weaponName === "your bare hands") s.push("unarmed");
  if (ctx.improvised) s.push("improvised");
  if (ctx.featureKill) s.push("environmental");
  if (info.ranged) s.push("ranged");
  if (info.crit) s.push("finisher");
  if (defender.level >= attacker.level + 3) s.push("punching_up");
  if (attacker.hp / attacker.hpMax < 0.25) s.push("wounded");
  if (hostilesOf(enc, attacker).length >= 3) s.push("outnumbered");
  if (zoneOf(node, attacker.zone).capacity <= 2) s.push("chokepoint");
  if (attacker.hidden) s.push("ambush");
  return s;
}

function kill(
  state: GameState,
  log: EventLog,
  enc: EncounterState,
  killer: Combatant,
  victim: Combatant,
  method: string,
  styles: Style[],
): void {
  victim.alive = false;
  victim.hp = 0;
  enc.killsThisFight++;
  enc.killLog.push({
    name: victim.name,
    level: victim.level,
    styles,
    byCrawler: killer.side === "crawler",
  });

  log.push({
    kind: "kill",
    channel: killer.side === "crawler" ? "good" : "bad",
    victim: victim.name,
    victimLevel: victim.level,
    byCrawler: killer.side === "crawler",
    killer: killer.name,
    method,
    styles,
  });

  // An exploder is a problem you have to solve before it dies, not after.
  if (victim.behavior === "exploder") {
    const blast = zoneOf(state.floor.nodes[enc.nodeId]!, victim.zone);
    log.say(`${victim.name} comes apart, and it was full of something.`);
    for (const c of living(enc)) {
      if (c.zone !== blast.id) continue;
      const dmg = Math.max(1, 14 - c.armor);
      c.hp = Math.max(0, c.hp - dmg);
      log.push({
        kind: "attack",
        channel: c.side === "crawler" ? "bad" : "good",
        attacker: victim.name,
        target: c.name,
        weapon: "the inside of itself",
        byCrawler: false,
        hit: true,
        crit: false,
        graze: false,
        damage: dmg,
        targetHp: c.hp,
        targetHpMax: c.hpMax,
        styles: [],
      });
      if (c.hp <= 0) kill(state, log, enc, victim, c, "a detonation it was always going to have", []);
    }
  }

  // Killing the thing holding a side together is worth more than killing three
  // of the things it was holding together.
  if (victim.behavior === "commander") {
    for (const m of living(enc, "hostile")) {
      m.statuses.push(makeStatus("marked", 3));
    }
    log.say("Whatever was keeping them organised has stopped.");
  }
}

/* --------------------------------------------------------------- morale */

export function moraleCheck(
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  pressure: number,
): void {
  const side = living(enc, "hostile");
  if (side.length === 0) return;
  for (const m of side) {
    if (m.tags.includes("boss") || m.fleeing) continue;
    const def = Object.values(MOB_BY_ID).find((d) => m.id.startsWith(d.id));
    const morale = def?.morale ?? 60;
    if (rng.d(100) > morale - pressure) {
      m.fleeing = true;
      log.push({
        kind: "status",
        channel: "good",
        who: m.name,
        status: "Broken",
        applied: true,
        note: "It has decided this is not its fight and is looking for the way out.",
      });
    }
  }
}

/* -------------------------------------------------------------- features */

export function useFeature(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
  actor: Combatant,
  featureId: string,
  targetZoneId?: string,
): boolean {
  const zone = node.zones.find((z) => z.features.some((f) => f.id === featureId && !f.spent));
  const feature = zone?.features.find((f) => f.id === featureId);
  if (!zone || !feature) {
    log.say("There is nothing here by that name, or you have already used it.");
    return false;
  }

  const dist = zoneDistance(node, actor.zone, zone.id);
  if (dist > 1) {
    log.say(`${feature.name} is not close enough to do anything about.`);
    return false;
  }

  const d = derive(state);
  let bonus = 0;
  if (feature.check.stat) bonus += d.stats[feature.check.stat];
  if (feature.check.skill) bonus += skillLevel(state, feature.check.skill);
  if (actor.side === "crawler") bonus += hookBonus(state, "feature");
  const roll = rng.d(20) + bonus;
  const success = roll >= feature.dc;

  const target = targetZoneId ?? pickFeatureTarget(enc, node, zone, actor);
  const targetZone = zoneOf(node, target);
  const caught = living(enc).filter((c) => c.zone === target && c.id !== actor.id);

  const verbs: Record<string, string> = {
    topple: "brings down",
    ignite: "sets alight",
    collapse: "collapses",
    electrify: "electrifies",
    vent: "opens",
    winch: "releases",
    gas: "opens up",
    cache: "cracks open",
    barricade_stock: "drags across",
  };

  if (!success) {
    log.push({
      kind: "feature",
      channel: "bad",
      actor: actor.name,
      feature: feature.name,
      verb: verbs[feature.kind] ?? "uses",
      success: false,
      affected: [],
      damage: 0,
      note: "It does not move, and now everything in the room knows what you were trying to do.",
    });
    return true; // it still cost the action
  }

  let damage = 0;
  let note = "";
  const affected: string[] = [];

  switch (feature.kind) {
    case "topple":
    case "winch": {
      damage = rng.roll(feature.kind === "topple" ? "3d8" : "2d8");
      note = "Whatever was underneath it is not, structurally speaking, underneath it any more.";
      for (const c of caught) {
        const taken = Math.max(1, damage - Math.floor(c.armor / 2));
        c.hp = Math.max(0, c.hp - taken);
        c.prone = true;
        c.statuses.push(makeStatus("prone", 1));
        affected.push(c.name);
        if (c.hp <= 0) kill(state, log, enc, actor, c, feature.name, ["environmental", "finisher"]);
      }
      feature.spent = true;
      break;
    }
    case "ignite": {
      const primed = targetZone.tags.includes("flammable") || zone.features.some((f) => f.kind === "gas" && f.spent);
      damage = primed ? rng.roll("4d6") : rng.roll("2d6");
      targetZone.hazard = { kind: "fire", turns: primed ? 5 : 3, damage: primed ? "2d6" : "1d6" };
      note = primed
        ? "The gas goes first and the room goes with it. Everyone hears it before they feel it."
        : "It catches, and it will keep catching for a while.";
      for (const c of caught) {
        const taken = Math.max(1, damage - Math.floor(c.armor / 3));
        c.hp = Math.max(0, c.hp - taken);
        c.statuses.push(makeStatus("burning", 3));
        affected.push(c.name);
        if (c.hp <= 0) kill(state, log, enc, actor, c, "fire", ["environmental", "finisher"]);
      }
      feature.spent = true;
      break;
    }
    case "gas": {
      note = "Now the room is full of it. Somebody is going to strike a light in here, and that somebody had better be you.";
      feature.spent = true;
      for (const z of node.zones) if (z.id === zone.id) z.tags.push("flammable");
      break;
    }
    case "electrify": {
      const wet = targetZone.tags.includes("water");
      damage = wet ? rng.roll("5d6") : rng.roll("1d6");
      note = wet
        ? "The water does the work. Everything standing in it goes rigid at the same instant, which is a sight."
        : "It arcs, spits, and achieves very little. The water was the point.";
      for (const c of caught) {
        const taken = Math.max(1, damage - Math.floor(c.armor / 4));
        c.hp = Math.max(0, c.hp - taken);
        if (wet) c.statuses.push(makeStatus("stunned", 1));
        affected.push(c.name);
        if (c.hp <= 0) kill(state, log, enc, actor, c, "the water", ["environmental", "finisher"]);
      }
      feature.spent = true;
      break;
    }
    case "collapse": {
      damage = rng.roll("5d8");
      note =
        "The ceiling was load-bearing right up until the moment it became your idea. What is left of that ground is rubble, and rubble only admits one at a time.";
      for (const c of caught) {
        const taken = Math.max(1, damage - Math.floor(c.armor / 2));
        c.hp = Math.max(0, c.hp - taken);
        affected.push(c.name);
        if (c.hp <= 0) kill(state, log, enc, actor, c, "several tonnes of building", ["environmental", "finisher"]);
      }
      // Deliberately does NOT delete links. Severing a small graph can orphan
      // a zone with a survivor in it, and then nothing can reach anything and
      // the fight never ends. Instead the ground is permanently choked: an
      // open plaza becomes a doorway, which is a better mechanic anyway.
      targetZone.capacity = 1;
      if (!targetZone.tags.includes("rubble")) targetZone.tags.push("rubble");
      if (!targetZone.tags.includes("choke")) targetZone.tags.push("choke");
      feature.spent = true;
      break;
    }
    case "vent": {
      note = "It goes somewhere. Somewhere is a substantial improvement.";
      zone.tags.push("choke");
      feature.spent = true;
      state.flags._ventOpen = true;
      break;
    }
    case "cache": {
      note = "Somebody hid this and did not come back for it.";
      feature.spent = true;
      break;
    }
    case "barricade_stock": {
      note = "Enough material to close a doorway properly, if you have twenty minutes.";
      break;
    }
  }

  if (actor.side === "crawler" && affected.length > 0) {
    state.counters.environmentalKills += living(enc, "hostile").length === 0 ? affected.length : 0;
  }

  log.push({
    kind: "feature",
    channel: actor.side === "crawler" ? "good" : "bad",
    actor: actor.name,
    feature: feature.name,
    verb: verbs[feature.kind] ?? "uses",
    success: true,
    affected,
    damage,
    note,
  });
  return true;
}

function pickFeatureTarget(
  enc: EncounterState,
  node: MapNode,
  zone: Zone,
  actor: Combatant,
): string {
  const candidates = [zone.id, ...zone.links];
  let best = zone.id;
  let bestCount = -1;
  for (const z of candidates) {
    const count = hostilesOf(enc, actor).filter((c) => c.zone === z).length;
    if (count > bestCount) {
      bestCount = count;
      best = z;
    }
  }
  return best;
}

/* ------------------------------------------------------------- movement */

export function moveTo(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
  who: Combatant,
  zoneId: string,
): boolean {
  const dest = node.zones.find((z) => z.id === zoneId);
  if (!dest) return false;
  const fromZone = zoneOf(node, who.zone);
  if (!fromZone.links.includes(zoneId) && who.zone !== zoneId) {
    if (who.side === "crawler") log.say("You cannot get there from here in one move.");
    return false;
  }
  if (dest.barricaded) {
    if (who.side === "crawler") log.say("Your own barricade is in the way. Take it down or go around.");
    else return false;
  }

  // Disengaging under a melee is not free. Sprint is what makes it survivable.
  const engaged = hostilesOf(enc, who).filter((h) => h.zone === who.zone && h.reach <= 1);
  let disengaged = false;
  if (engaged.length > 0) {
    disengaged = true;
    const sprint = who.side === "crawler" ? skillLevel(state, "sprint") : 0;
    for (const e of engaged) {
      if (rng.d(20) + sprint + 4 < e.accuracy + 10) {
        resolveAttack(state, rng, log, enc, node, e, who, { label: `${e.weapon}, as you turn` });
      }
    }
  }

  who.zone = zoneId;
  who.braced = false;

  // Traps do not care whose side you are on. They care where you put your foot.
  if (dest.traps.length > 0) {
    const trap = dest.traps.shift()!;
    const dmg = rng.roll(trap.damage);
    who.hp = Math.max(0, who.hp - dmg);
    log.push({ kind: "trap_sprung", channel: who.side === "crawler" ? "bad" : "good", victim: who.name, trap: trap.name, damage: dmg });
    if (trap.status) who.statuses.push(makeStatus(trap.status, 3));
    if (who.hp <= 0) kill(state, log, enc, who, who, trap.name, []);
  }

  log.push({
    kind: "reposition",
    channel: "narration",
    who: who.name,
    from: fromZone.name,
    to: dest.name,
    disengaged,
  });
  return true;
}

/* ------------------------------------------------------------ turn order */

export function tickZoneHazards(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
): void {
  for (const z of node.zones) {
    if (!z.hazard) continue;
    for (const c of living(enc)) {
      if (c.zone !== z.id) continue;
      const dmg = rng.roll(z.hazard.damage);
      c.hp = Math.max(0, c.hp - dmg);
      log.push({
        kind: "attack",
        channel: c.side === "crawler" ? "bad" : "good",
        attacker: `the ${z.hazard.kind}`,
        target: c.name,
        weapon: z.hazard.kind,
        byCrawler: false,
        hit: true,
        crit: false,
        graze: false,
        damage: dmg,
        targetHp: c.hp,
        targetHpMax: c.hpMax,
        styles: [],
      });
      if (c.hp <= 0) kill(state, log, enc, c, c, `the ${z.hazard.kind}`, []);
    }
    z.hazard.turns--;
    if (z.hazard.turns <= 0) delete z.hazard;
  }
}

function tickStatuses(state: GameState, rng: Rng, log: EventLog, enc: EncounterState, c: Combatant): void {
  const pain = c.side === "crawler" ? skillLevel(state, "pain_tolerance") : 0;
  const eff = statusEffects(c.statuses, pain);
  if (eff.tick > 0) {
    c.hp = Math.max(0, c.hp - eff.tick);
    if (c.hp <= 0) {
      kill(state, log, enc, c, c, "wounds nobody dressed", []);
      return;
    }
  }
  c.statuses = c.statuses.filter((s) => {
    s.turns--;
    if (s.turns > 0) return true;
    log.push({ kind: "status", channel: s.bad ? "good" : "system", who: c.name, status: s.name, applied: false, note: "" });
    return false;
  });
  if (c.prone && !c.statuses.some((s) => s.id === "prone")) c.prone = false;
}

/** Advance the turn pointer, running everybody who is not the crawler. */
export function advanceToCrawler(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
): void {
  let guard = 0;
  while (enc.finished === null && guard++ < 400) {
    enc.turnIndex++;
    if (enc.turnIndex >= enc.order.length) {
      enc.turnIndex = 0;
      enc.round++;
      enc.roundsTaken++;
      tickZoneHazards(state, rng, log, enc, node);
      log.push({ kind: "round", channel: "system", n: enc.round });

      // Nothing in this game should be able to run forever. A stand-off this
      // long means somebody cannot reach somebody else, and the correct
      // outcome is that the side with less to prove walks away.
      if (enc.round > 60) {
        for (const h of living(enc, "hostile")) h.alive = false;
        log.say(
          "This has stopped being a fight and started being a siege. Whatever is left of them breaks off and goes to find something easier, and the audience has already changed channel.",
        );
        enc.finished = "fled";
        log.push({
          kind: "combat_end",
          channel: "system",
          outcome: "fled",
          rounds: enc.roundsTaken,
          killed: enc.killsThisFight,
        });
        return;
      }
    }
    if (checkEnd(state, log, enc)) return;

    const id = enc.order[enc.turnIndex]!;
    const c = byId(enc, id);
    if (!c || !c.alive) continue;

    tickStatuses(state, rng, log, enc, c);
    if (!c.alive) continue;

    const eff = statusEffects(c.statuses, c.side === "crawler" ? skillLevel(state, "pain_tolerance") : 0);
    if (eff.skipsTurn) {
      log.say(`${c.name} loses the round.`);
      continue;
    }

    if (c.side === "crawler") {
      enc.actions = { move: 1 + Math.floor(skillLevel(state, "sprint") / 3), act: 1 };
      state.crawler.hp = c.hp;
      return;
    }
    runAiTurn(state, rng, log, enc, node, c);
    if (checkEnd(state, log, enc)) return;
  }
}

function runAiTurn(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
  c: Combatant,
): void {
  const action: AiAction = chooseAiAction(state, rng, enc, node, c);
  switch (action.t) {
    case "attack": {
      const target = byId(enc, action.target);
      if (target?.alive) resolveAttack(state, rng, log, enc, node, c, target);
      break;
    }
    case "move":
      moveTo(state, rng, log, enc, node, c, action.zone);
      break;
    case "move_attack": {
      moveTo(state, rng, log, enc, node, c, action.zone);
      const target = byId(enc, action.target);
      if (target?.alive) resolveAttack(state, rng, log, enc, node, c, target);
      break;
    }
    case "feature":
      useFeature(state, rng, log, enc, node, c, action.feature);
      break;
    case "buff": {
      const ally = byId(enc, action.target);
      if (ally?.alive && !ally.statuses.some((s) => s.id === "adrenaline")) {
        ally.statuses.push(makeStatus("adrenaline", 3));
        log.push({
          kind: "status",
          channel: "bad",
          who: ally.name,
          status: "Adrenaline",
          applied: true,
          note: `${c.name} says something to it, and it comes off the wall harder.`,
        });
      }
      break;
    }
    case "flee": {
      c.alive = false; // it is gone, not dead
      log.push({ kind: "flee", channel: "good", who: c.name, success: true, note: "It gets out, and it will tell others." });
      break;
    }
    case "hold":
      c.braced = true;
      break;
    case "wait":
      break;
  }
  if (c.side === "crawler") state.crawler.hp = c.hp;
}

export function checkEnd(state: GameState, log: EventLog, enc: EncounterState): boolean {
  if (enc.finished) return true;
  const crawler = crawlerOf(enc);
  if (!crawler.alive || crawler.hp <= 0) {
    enc.finished = "defeat";
    return true;
  }
  if (living(enc, "hostile").length === 0) {
    enc.finished = "victory";
    log.push({
      kind: "combat_end",
      channel: "good",
      outcome: "victory",
      rounds: enc.roundsTaken,
      killed: enc.killsThisFight,
    });
    return true;
  }
  return false;
}

/* ------------------------------------------------------------- fleeing */

export function attemptFlee(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState,
  node: MapNode,
): boolean {
  const crawler = crawlerOf(enc);
  const atEntry = crawler.zone === node.entry;
  const sprint = skillLevel(state, "sprint");
  const hardest = Math.max(0, ...living(enc, "hostile").map((h) => h.accuracy));
  const roll = rng.d(20) + derive(state).stats.dex + sprint + (atEntry ? 4 : 0) + hookBonus(state, "flee");
  const dc = 11 + hardest;

  if (roll < dc) {
    log.push({
      kind: "flee",
      channel: "bad",
      who: crawler.name,
      success: false,
      note: atEntry
        ? "You break for the door and something gets a hand on you first."
        : "You are not near the way out, and everything in here noticed you looking at it.",
    });
    for (const h of living(enc, "hostile").slice(0, 2)) {
      resolveAttack(state, rng, log, enc, node, h, crawler, { label: `${h.weapon}, as you run` });
    }
    return false;
  }

  enc.finished = "fled";
  state.counters.fled++;
  log.push({
    kind: "flee",
    channel: "narration",
    who: crawler.name,
    success: true,
    note: "You get out. It costs you the room, whatever was in it, and a measurable amount of dignity.",
  });
  log.push({ kind: "combat_end", channel: "system", outcome: "fled", rounds: enc.roundsTaken, killed: enc.killsThisFight });
  return true;
}

/* ------------------------------------------------------------- training */

/** Combat is where skills actually grow, and only for what you actually did. */
export function trainFromAction(state: GameState, log: EventLog, skill: string, amount = 1): void {
  const raised = trainSkill(state, skill, amount);
  if (raised !== null) {
    log.push({
      kind: "skill_up",
      channel: "good",
      skill,
      level: raised,
      note: "",
    });
  }
}

export type { Combatant, EncounterState };
export { makeStatus };
