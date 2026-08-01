import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { EventLog } from "../src/core/events.ts";
import { Game } from "../src/sim/game.ts";
import { currentNode } from "../src/sim/map.ts";
import { beginEncounter, resolveAttack } from "../src/sim/combat.ts";
import { fromId } from "../src/sim/loot.ts";

/**
 * Dying, and the two things that are allowed to happen first.
 *
 * The ladder is room, then floor, then the run — and both come back on the way
 * down. It exists so the simulation never has to be careful with the player:
 * with backloads in the bank a floor can be genuinely lethal and still be fair,
 * and when they are gone the next death is real and everybody knew it was
 * coming.
 *
 * The last stand is the other half. A death that arrives between two lines of
 * text with no chance to answer is the single worst thing this kind of game
 * does to people, so a killing blow leaves you upright for exactly one round,
 * once per fight, healing nothing and stopping no clocks.
 */

const log = () => new EventLog(() => 0);

function fresh(seed = 12): Game {
  return Game.create(seed, { name: "Ladder", job: "roofer", hobby: "distance running" });
}

/* ---------------------------------------------------------- last stand */

test("a killing blow leaves you upright for one round, once", () => {
  const g = fresh();
  const node = currentNode(g.state.floor);
  node.spawn = [{ mob: "rat_brute", count: 1, level: 6 }];
  node.cleared = false;
  const enc = beginEncounter(g.state, Rng.fromSeed(3), log(), node);
  g.state.encounter = enc;

  const me = enc.combatants.find((c) => c.side === "crawler")!;
  const foe = enc.combatants.find((c) => c.side === "hostile")!;
  foe.zone = me.zone;
  assert.ok(enc.lastStands >= 1, "a fight started with no last stand at all");

  const stands = enc.lastStands;
  me.hp = 1;
  resolveAttack(g.state, Rng.fromSeed(1), log(), enc, node, foe, me, { extraAccuracy: 99 });
  assert.equal(me.hp, 1, "the killing blow was not caught");
  assert.equal(enc.lastStands, stands - 1, "it was caught for free");
  assert.ok(me.statuses.some((x) => x.id === "dying"), "and nothing marked how close it is");

  // Spend the rest of them and the next one lands for real.
  while (enc.lastStands > 0) {
    me.hp = 1;
    resolveAttack(g.state, Rng.fromSeed(2), log(), enc, node, foe, me, { extraAccuracy: 99 });
  }
  me.hp = 1;
  resolveAttack(g.state, Rng.fromSeed(4), log(), enc, node, foe, me, { extraAccuracy: 99 });
  assert.equal(me.hp, 0, "the last stand came back without being earned");
});

/* ------------------------------------------------------------- the ladder */

test("room, then floor, then that is the run", async () => {
  const g = fresh();
  const s = g.state;
  s.floor.n = 2;
  s.restores = { room: true, floor: true };
  g.takeCheckpoint("floor");

  const startingGold = s.crawler.gold;
  const atFloorStart = s.floor.at;

  // Walk somewhere, take the room checkpoint there, then lose everything since.
  s.crawler.gold = startingGold + 500;
  g.takeCheckpoint("room");
  s.crawler.gold = startingGold + 900;
  s.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });
  assert.equal(s.crawler.alive, false, "zero health and an hour passing was survivable");

  assert.ok(g.canRestore("room"));
  assert.ok(g.restore("room"));
  assert.equal(g.state.crawler.alive, true, "came back dead");
  assert.equal(g.state.crawler.gold, startingGold + 500, "the room backload did not roll the state back");
  assert.equal(g.canRestore("room"), false, "the room backload was reusable");
  assert.equal(g.canRestore("floor"), true, "the floor backload was spent by a room backload");

  // Die again: only the floor is left.
  g.state.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });
  assert.equal(g.state.crawler.alive, false);
  assert.ok(g.restore("floor"));
  assert.equal(g.state.floor.at, atFloorStart, "the floor backload did not go back to the landing");
  assert.equal(g.state.crawler.gold, startingGold, "the floor backload kept money earned after it");

  // Going back a floor hands the room back with it — but not the floor.
  assert.equal(g.canRestore("room"), true, "a floor backload should restore the room one");
  assert.equal(g.canRestore("floor"), false);

  // Spend the room one too, and now the next death is the run.
  g.state.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });
  assert.ok(g.restore("room"));
  assert.equal(g.canRestore("room"), false);
  assert.equal(g.canRestore("floor"), false);

  g.state.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });
  assert.equal(g.state.crawler.alive, false);
  assert.equal(g.restore("room"), false, "a fourth life appeared out of nowhere");
  assert.equal(g.restore("floor"), false);
});

test("a restored run is a run, not a snapshot of one", async () => {
  const g = fresh(77);
  g.state.floor.n = 2;
  g.state.restores = { room: true, floor: true };
  g.takeCheckpoint("room");
  g.state.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });
  g.restore("room");

  // It has to keep taking turns, and it has to still serialise.
  const r = await g.execute({ t: "look" });
  assert.ok(r.lines.length > 0, "a restored run could not take a turn");
  const round = JSON.parse(JSON.stringify(g.save())) as typeof g.state;
  assert.equal(round.crawler.alive, true);
  assert.ok(Game.load(round));
});

test("a checkpoint never contains a checkpoint", () => {
  const g = fresh(5);
  g.takeCheckpoint("floor");
  g.takeCheckpoint("room");
  g.takeCheckpoint("floor");
  const snapshot = JSON.parse(g.state.checkpoints.floor!) as Record<string, unknown>;
  assert.equal(snapshot["checkpoints"], undefined, "a save is nesting inside itself and will grow forever");
  assert.ok(g.state.checkpoints.floor!.length < 400_000, "the checkpoint is unreasonably large");
});

test("the backloads come back on the way down", async () => {
  const g = fresh(31);
  const s = g.state;
  s.restores = { room: false, floor: false };
  assert.equal(g.canRestore("room"), false);

  // Get to a stairwell the cheap way and take them.
  const stairs = Object.values(s.floor.nodes).find((n) => n.hasStairs)!;
  s.floor.at = stairs.id;
  s.floor.stairsAnnounced = true;
  stairs.cleared = true;
  stairs.spawn = [];
  await g.execute({ t: "descend" });

  assert.equal(g.state.restores.room, true, "a new floor did not hand the backloads back");
  assert.equal(g.state.restores.floor, true);
  assert.ok(g.canRestore("floor"), "and nothing was checkpointed on arrival");
});

/* --------------------------------------------------------------- outs */

test("the death screen names what was in the bag and never got used", async () => {
  const g = fresh(9);
  const s = g.state;
  s.inventory.push(fromId("potion_health", 2, Rng.fromSeed(1)));
  s.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });

  assert.ok(s.pendingDeath, "a death with nothing recorded about it");
  const outs = s.pendingDeath!.outs.join(" | ");
  assert.match(outs, /healing/i, `unused potions went unmentioned: ${outs}`);
});

test("a spell you could have afforded is counted as an out", async () => {
  const g = fresh(10);
  const s = g.state;
  s.crawler.mana = 50;
  s.spellbook["bolt"] = {
    id: "bolt", name: "Test Bolt", mana: 4, desc: "a bolt", cooldown: 0, tags: ["fire"],
    effects: [{ k: "damage", dice: "1d6", tag: "fire", scope: "one" }],
  };
  s.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });
  assert.match(s.pendingDeath!.outs.join(" | "), /Test Bolt/, "a castable spell was not counted");
});

test("nothing in the bag means nothing on the record, and the death still lands", async () => {
  const g = fresh(11);
  const s = g.state;
  s.inventory = [];
  s.spellbook = {};
  s.crawler.mana = 0;
  s.crawler.hp = 0;
  await g.execute({ t: "wait", hours: 1 });
  assert.equal(s.crawler.alive, false);
  assert.ok(s.pendingDeath, "the death was not recorded at all");
  assert.equal(s.pendingDeath!.outs.length, 0, "outs were invented for an empty inventory");
  assert.ok(s.crawler.death?.cause, "a death with no cause");
});
