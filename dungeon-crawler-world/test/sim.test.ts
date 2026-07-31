import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { generateFloor, route } from "../src/sim/map.ts";
import { makeItem, openBox, usageTags } from "../src/sim/loot.ts";
import { Game } from "../src/sim/game.ts";
import { derive, skillLevel, trainSkill, grantXp, xpForLevel } from "../src/sim/character.ts";
import { addToDice, meleePressure, zoneDistance, zoneOf } from "../src/sim/tactics.ts";
import { beginEncounter, resolveAttack } from "../src/sim/combat.ts";
import { EventLog } from "../src/core/events.ts";
import { RARITIES } from "../src/core/types.ts";
import { skillXpToNext } from "../src/data/skills.ts";
import { TIER_TABLE } from "../src/data/boxes.ts";

/* ------------------------------------------------------------------ map */

test("floor generation: every place is reachable from the landing", () => {
  for (const seed of [1, 2, 99, 12345, 777777]) {
    for (const n of [1, 2, 3, 4]) {
      const floor = generateFloor(seed, n);
      const ids = Object.keys(floor.nodes);
      const seen = new Set(["n0"]);
      const queue = ["n0"];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const l of floor.nodes[cur]!.links) {
          if (!seen.has(l.to)) {
            seen.add(l.to);
            queue.push(l.to);
          }
        }
      }
      assert.equal(seen.size, ids.length, `seed ${seed} floor ${n}: ${ids.length - seen.size} orphaned`);
    }
  }
});

test("floor generation: links are symmetric", () => {
  const floor = generateFloor(31337, 2);
  for (const node of Object.values(floor.nodes)) {
    for (const l of node.links) {
      const back = floor.nodes[l.to]!.links.find((x) => x.to === node.id);
      assert.ok(back, `${l.to} has no link back to ${node.id}`);
      assert.equal(back!.minutes, l.minutes, "travel time differs by direction");
    }
  }
});

test("floor generation: the arrival landing is safe and offers a choice", () => {
  for (const seed of [5, 50, 500, 5000]) {
    const floor = generateFloor(seed, 1);
    const start = floor.nodes["n0"]!;
    assert.equal(start.spawn.length, 0, "something is waiting in the arrival landing");
    assert.equal(start.boss, undefined);
    assert.ok(start.cleared);
    assert.ok(start.links.length >= 2, "the run opens on a corridor with one exit");
    assert.ok(start.loot.length > 0, "nothing to pick up before the first fight");
  }
});

test("floor generation: a way down always exists, and safe rooms exist", () => {
  for (const seed of [3, 33, 333, 3333]) {
    for (const n of [1, 2, 3]) {
      const floor = generateFloor(seed, n);
      const nodes = Object.values(floor.nodes);
      assert.ok(nodes.some((x) => x.hasStairs), `seed ${seed} floor ${n}: no stairs`);
      assert.ok(
        nodes.some((x) => x.hasStairs && !x.boss),
        `seed ${seed} floor ${n}: every way down is behind a boss`,
      );
      assert.ok(nodes.some((x) => x.kind === "safe_room"), `seed ${seed} floor ${n}: no safe room`);
    }
  }
});

test("floor generation: difficulty rises with distance from the entrance", () => {
  // Averaged over many seeds, because any single floor is allowed to be unfair.
  let nearTotal = 0;
  let nearCount = 0;
  let farTotal = 0;
  let farCount = 0;
  for (let seed = 0; seed < 60; seed++) {
    const floor = generateFloor(seed * 101 + 7, 1);
    const depth: Record<string, number> = { n0: 0 };
    const queue = ["n0"];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const l of floor.nodes[cur]!.links) {
        if (depth[l.to] === undefined) {
          depth[l.to] = depth[cur]! + 1;
          queue.push(l.to);
        }
      }
    }
    const max = Math.max(...Object.values(depth));
    for (const node of Object.values(floor.nodes)) {
      for (const g of node.spawn) {
        const lvl = g.level ?? 0;
        if ((depth[node.id] ?? 0) <= max * 0.3) {
          nearTotal += lvl;
          nearCount++;
        } else if ((depth[node.id] ?? 0) >= max * 0.7) {
          farTotal += lvl;
          farCount++;
        }
      }
    }
  }
  assert.ok(nearCount > 10 && farCount > 10, "not enough samples to judge");
  const near = nearTotal / nearCount;
  const far = farTotal / farCount;
  assert.ok(far > near + 0.5, `deep rooms (${far.toFixed(2)}) are not harder than shallow ones (${near.toFixed(2)})`);
});

test("floor generation is a pure function of seed and floor number", () => {
  assert.deepEqual(generateFloor(24680, 2), generateFloor(24680, 2));
  assert.notDeepEqual(generateFloor(24680, 2), generateFloor(24681, 2));
});

test("route only crosses links the crawler knows about", () => {
  const floor = generateFloor(8080, 1);
  assert.equal(route(floor, "n0", "n5"), null, "routing across unknown ground");
  for (const l of floor.nodes["n0"]!.links) l.known = true;
  const first = floor.nodes["n0"]!.links[0]!.to;
  assert.deepEqual(route(floor, "n0", first), ["n0", first]);
});

/* ----------------------------------------------------------------- loot */

test("box tiers honour their rarity tables", () => {
  const rng = Rng.fromSeed(4);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 400; i++) {
    const { items } = openBox(rng, "adventurer", "Bronze", { floor: 1, usesTags: [] });
    for (const it of items) counts[it.rarity] = (counts[it.rarity] ?? 0) + 1;
  }
  assert.ok((counts["junk"] ?? 0) > 0, "Bronze produced no junk, which is most of what Bronze is");
  assert.equal(counts["legendary"] ?? 0, 0, "a Bronze box produced legendary loot");
  assert.equal(counts["celestial"] ?? 0, 0);
});

test("a celestial box cannot produce junk, and a bronze cannot produce celestial", () => {
  const rng = Rng.fromSeed(6);
  for (let i = 0; i < 120; i++) {
    for (const it of openBox(rng, "boss", "Celestial", { floor: 6, usesTags: [] }).items) {
      assert.ok(RARITIES.indexOf(it.rarity) >= RARITIES.indexOf("epic"), `celestial box held ${it.rarity}`);
    }
  }
});

test("every tier produces at least one line and stays inside its declared range", () => {
  const rng = Rng.fromSeed(17);
  for (const [tier, table] of Object.entries(TIER_TABLE)) {
    for (let i = 0; i < 60; i++) {
      const { items } = openBox(rng, "adventurer", tier as never, { floor: 3, usesTags: [] });
      assert.ok(items.length >= table.lines[0] && items.length <= table.lines[1], `${tier} produced ${items.length} lines`);
    }
  }
});

test("generated items carry real modifiers, not just a name", () => {
  const rng = Rng.fromSeed(9);
  let generated = 0;
  for (let i = 0; i < 300; i++) {
    const item = makeItem(rng, { floor: 4, rarity: "rare", bespoke: true });
    generated++;
    assert.ok(item.mods && item.mods.length > 0, `${item.name} has no modifiers`);
    assert.ok(item.name.split(" ").length >= 2, `${item.name} was not affixed`);
    for (const m of item.mods!) assert.equal(typeof (m as { v: number }).v, "number");
  }
  assert.ok(generated > 0);
});

test("usage tags key off worn gear and trained skills, not class", () => {
  const tags = usageTags(
    [{ tags: ["weapon", "bludgeon"] } as never],
    { demolitions: { level: 5 }, stealth: { level: 1 } },
  );
  assert.ok(tags.includes("bludgeon"));
  assert.ok(tags.includes("explosive"), "a level 5 demolitions crawler should bias toward explosives");
  assert.ok(!tags.includes("stealth"), "a level 1 skill should not bias loot");
});

/* ------------------------------------------------------------ character */

test("skill curve: early levels are cheap and late ones are not", () => {
  assert.ok(skillXpToNext(1) < skillXpToNext(6));
  assert.ok(skillXpToNext(6) < skillXpToNext(11));
  assert.ok(skillXpToNext(11) < skillXpToNext(15));
  assert.equal(skillXpToNext(20), Infinity);
});

test("skills stop dead at the cap, and Primal lifts it", () => {
  const g = Game.create(1, { name: "T" });
  const s = g.state;
  for (let i = 0; i < 200000; i++) trainSkill(s, "blades", 5);
  assert.equal(s.skills["blades"]!.level, 15, "a non-Primal crawler passed the cap");
  s.crawler.skillCap = 20;
  for (let i = 0; i < 200000; i++) trainSkill(s, "blades", 5);
  assert.equal(s.skills["blades"]!.level, 20);
});

test("derived stats respond to gear immediately", () => {
  const g = Game.create(2, { name: "T" });
  const before = derive(g.state);
  g.state.inventory.push({
    iid: "x", id: "test_ring", name: "Test Ring", kind: "jewelry", rarity: "rare", slot: "ring1",
    weight: 0, value: 0, qty: 1, tags: [], desc: "", equipped: true,
    mods: [{ k: "stat", stat: "con", v: 5 }, { k: "armor", v: 3 }],
  });
  const after = derive(g.state);
  assert.equal(after.stats.con, before.stats.con + 5);
  assert.equal(after.armor, before.armor + 3);
  assert.equal(after.hpMax, before.hpMax + 40, "Constitution should move max health at 8 per point");
});

test("points bank before race selection and drift rather than sitting idle", () => {
  const g = Game.create(3, { name: "T" });
  const s = g.state;
  const statsBefore = { ...s.crawler.stats };
  let roll = 0;
  grantXp(s, xpForLevel(1) + xpForLevel(2) + xpForLevel(3), () => roll++);
  assert.ok(s.crawler.level >= 3);
  assert.equal(s.crawler.points, 0, "unspendable points leaked into the spendable pool");
  assert.ok(s.crawler.banked > 0, "nothing was held back for the third floor");
  const total = (o: typeof statsBefore) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.ok(
    total(s.crawler.stats) > total(statsBefore),
    "a crawler gained three levels and got no stronger at all",
  );
});

/* -------------------------------------------------------------- combat */

test("addToDice merges modifiers instead of stacking them", () => {
  assert.equal(addToDice("1d6", 2), "1d6+2");
  assert.equal(addToDice("1d6+1", 2), "1d6+3");
  assert.equal(addToDice("1d6+1", -1), "1d6");
  assert.equal(addToDice("2d8-1", 3), "2d8+2");
});

test("zone distance follows the room's own links", () => {
  const floor = generateFloor(4242, 1);
  const node = Object.values(floor.nodes).find((n) => n.zones.length >= 3)!;
  const [a] = node.zones;
  assert.equal(zoneDistance(node, a!.id, a!.id), 0);
  for (const link of a!.links) assert.equal(zoneDistance(node, a!.id, link), 1);
});

test("chokepoint capacity caps how many things can engage you at once", () => {
  const g = Game.create(555, { name: "T", body: "strong" });
  const state = g.state;
  const node = Object.values(state.floor.nodes).find((n) =>
    n.zones.some((z) => z.capacity === 1) && n.zones.length >= 3,
  )!;
  node.spawn = [{ mob: "rat", count: 5, level: 1 }];
  node.cleared = false;

  const log = new EventLog(() => 0);
  const enc = beginEncounter(state, Rng.fromSeed(1), log, node);
  const me = enc.combatants.find((c) => c.side === "crawler")!;
  const choke = node.zones.find((z) => z.capacity === 1)!;
  me.zone = choke.id;

  // Put every rat in the doorway with the crawler and confirm the ground
  // still only admits one of them.
  for (const h of enc.combatants.filter((c) => c.side === "hostile")) h.zone = choke.id;
  const pressure = meleePressure(enc, node, me);
  assert.equal(pressure.capacity, 1);
  assert.ok(pressure.full, "a capacity-1 position did not report as full");
});

test("armour subtracts from damage and damage never drops below one", () => {
  const g = Game.create(606, { name: "T" });
  const state = g.state;
  const node = Object.values(state.floor.nodes)[1]!;
  node.spawn = [{ mob: "rat", count: 1, level: 1 }];
  node.cleared = false;
  const log = new EventLog(() => 0);
  const enc = beginEncounter(state, Rng.fromSeed(2), log, node);
  const me = enc.combatants.find((c) => c.side === "crawler")!;
  const rat = enc.combatants.find((c) => c.side === "hostile")!;

  rat.armor = 9999;
  rat.zone = me.zone;
  rat.defense = -50; // guarantee the swing lands
  const before = rat.hp;
  const rng = Rng.fromSeed(3);
  resolveAttack(state, rng, log, enc, node, me, rat);
  assert.ok(rat.hp < before, "an armoured target took zero damage; the floor should be 1");
  assert.equal(before - rat.hp, 1);
});

test("nothing can be attacked from outside its attacker's reach", () => {
  const g = Game.create(707, { name: "T" });
  const state = g.state;
  const node = Object.values(state.floor.nodes).find((n) => n.zones.length >= 3)!;
  node.spawn = [{ mob: "rat", count: 1, level: 1 }];
  node.cleared = false;
  const log = new EventLog(() => 0);
  const enc = beginEncounter(state, Rng.fromSeed(4), log, node);
  const me = enc.combatants.find((c) => c.side === "crawler")!;
  const rat = enc.combatants.find((c) => c.side === "hostile")!;

  const far = node.zones.find((z) => zoneDistance(node, me.zone, z.id) >= 2);
  if (!far) return; // this layout has no far position; nothing to assert
  rat.zone = far.id;
  me.reach = 1;
  const before = rat.hp;
  resolveAttack(state, Rng.fromSeed(5), log, enc, node, me, rat);
  assert.equal(rat.hp, before, "something was hit from two positions away with a fist");
});
