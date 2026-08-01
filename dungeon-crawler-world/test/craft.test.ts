import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { EventLog } from "../src/core/events.ts";
import { Game } from "../src/sim/game.ts";
import { currentNode } from "../src/sim/map.ts";
import { beginEncounter } from "../src/sim/combat.ts";
import { fromId } from "../src/sim/loot.ts";
import { trainSkill } from "../src/sim/character.ts";
import {
  buySpace, buyUpgrade, canCraft, craft, brew, experiment, installStation,
  sellPrice, buyPrice, stationsHere, RECIPE_BY_ID, SPACE_COST, STATION_BY_ID, UPGRADES,
} from "../src/sim/craft.ts";
import { calledShotModifier, deliverDevice, traitsOf, vitalMultiplier } from "../src/sim/devices.ts";
import type { Combatant, GameState, MapNode } from "../src/core/types.ts";

/**
 * The systems that let a run be won by being clever rather than by being
 * levelled, and the systems that make that cost money.
 *
 * The load-bearing claim under all of it: a burn-through charge on a person-
 * sized boss's head kills it outright, the same charge does very little to
 * something the width of a corridor, and something that lives in fire takes
 * exactly nothing. If those three stop being true the whole design is a lie.
 */

const log = () => new EventLog(() => 0);

function ready(seed = 4): Game {
  const g = Game.create(seed, { name: "Bench", job: "chemist", hobby: "demolition" });
  return g;
}

function give(state: GameState, id: string, qty: number): void {
  state.inventory.push(fromId(id, qty, Rng.fromSeed(1)));
}

function bench(state: GameState): MapNode {
  const node = currentNode(state.floor);
  node.kind = "guild";
  return node;
}

/** Puts one specific thing in a room and starts the fight. */
function fightWith(g: Game, opts: { mob?: string; boss?: string }): { node: MapNode; foe: Combatant } {
  const node = currentNode(g.state.floor);
  node.spawn = opts.mob ? [{ mob: opts.mob, count: 1, level: 8 }] : [];
  node.boss = opts.boss;
  node.cleared = false;
  const enc = beginEncounter(g.state, Rng.fromSeed(3), log(), node);
  g.state.encounter = enc;
  const foe = enc.combatants.find((c) => c.side === "hostile")!;
  return { node, foe };
}

/* ------------------------------------------------------------- vitality */

test("a charge to the head kills a person-sized boss and the game does not argue", () => {
  const g = ready();
  const { node, foe } = fightWith(g, { boss: "hoarder" });
  const me = g.state.encounter!.combatants.find((c) => c.side === "crawler")!;
  me.zone = foe.zone; // on top of it
  trainSkill(g.state, "throwing", 400); // it landed; this test is about what happens next

  const charge = fromId("scrap", 1, Rng.fromSeed(1));
  charge.name = "Oxide Charge";
  charge.device = { ...RECIPE_BY_ID["oxide_charge"]!.makes.device };

  const before = foe.hp;
  const r = deliverDevice(g.state, Rng.fromSeed(11), log(), g.state.encounter!, node, charge, foe, foe.zone);
  assert.ok(r.landed, "it did not land, with throwing at four hundred");
  assert.ok(r.damage > before, `a burn-through charge did ${r.damage} to a ${before}hp person`);
  assert.equal(foe.hp, 0, "the boss survived having a hole burned through its head");
});

test("the same charge does not kill something the width of the corridor", () => {
  const g = ready();
  const { node, foe } = fightWith(g, { boss: "ball_of_swine" });
  const me = g.state.encounter!.combatants.find((c) => c.side === "crawler")!;
  me.zone = foe.zone;
  trainSkill(g.state, "throwing", 400);

  const charge = fromId("scrap", 1, Rng.fromSeed(1));
  charge.name = "Oxide Charge";
  charge.device = { ...RECIPE_BY_ID["oxide_charge"]!.makes.device };

  const before = foe.hp;
  deliverDevice(g.state, Rng.fromSeed(11), log(), g.state.encounter!, node, charge, foe, foe.zone);
  assert.ok(foe.hp > 0, "mass did not save it");
  assert.ok(before - foe.hp > 40, "and it should still have hurt it a great deal");
  assert.ok(traitsOf(foe).includes("massive"));
});

test("something that lives in fire takes nothing at all from an incendiary", () => {
  const g = ready();
  const { node, foe } = fightWith(g, { mob: "soot_djinn" });
  const me = g.state.encounter!.combatants.find((c) => c.side === "crawler")!;
  me.zone = foe.zone;
  trainSkill(g.state, "throwing", 400);

  const charge = fromId("scrap", 1, Rng.fromSeed(1));
  charge.name = "Oxide Charge";
  charge.device = { ...RECIPE_BY_ID["oxide_charge"]!.makes.device };

  const before = foe.hp;
  deliverDevice(g.state, Rng.fromSeed(11), log(), g.state.encounter!, node, charge, foe, foe.zone);
  assert.equal(foe.hp, before, "the fire elemental was hurt by fire");
});

test("vitalMultiplier grades every counter the way the design says it should", () => {
  const person = { sourceId: "hunter_crawler", tags: [] } as unknown as Combatant;
  const ooze = { sourceId: "slime_imp", tags: [] } as unknown as Combatant;
  const behemoth = { sourceId: "ball_of_swine", tags: [] } as unknown as Combatant;
  const djinn = { sourceId: "soot_djinn", tags: [] } as unknown as Combatant;

  assert.equal(vitalMultiplier(person, ["fire"]), 1, "an ordinary person should take it in full");
  assert.ok(vitalMultiplier(ooze, ["fire"]) < 0.5, "an ooze has nothing inside it worth burning");
  assert.ok(vitalMultiplier(behemoth, ["fire"]) < 0.5, "mass should blunt it");
  assert.equal(vitalMultiplier(djinn, ["fire"]), 0, "immunity should be absolute");
  // Tags are checked, not assumed: the same target, a different answer.
  assert.ok(vitalMultiplier(djinn, ["concussive"]) > 0, "immunity to one thing is not immunity to everything");
});

test("silhouette implies mass even when nobody wrote the trait down", () => {
  const c = { sourceId: "not_a_real_mob", tags: ["behemoth"] } as unknown as Combatant;
  assert.ok(traitsOf(c).includes("massive"));
  const big = { sourceId: "not_a_real_mob", tags: ["large"] } as unknown as Combatant;
  assert.ok(traitsOf(big).includes("large"));
  // And a thing can't be both.
  const both = { sourceId: "ball_of_swine", tags: ["large"] } as unknown as Combatant;
  assert.ok(!traitsOf(both).includes("large"), "massive and large at once");
});

/* ---------------------------------------------------------- called shots */

test("a called shot is harder, ignores armour, and triples what the weapon does", () => {
  const g = ready();
  const { foe } = fightWith(g, { mob: "hunter_crawler" });
  const me = g.state.encounter!.combatants.find((c) => c.side === "crawler")!;
  const mod = calledShotModifier(g.state, me, foe);
  assert.ok(mod.accuracy < 0, "aiming at a head was not harder than aiming at a person");
  assert.ok(mod.ignoresArmour);
  assert.equal(mod.multiplier, 3);
});

test("there is nowhere to aim on an ooze and the game says so", () => {
  const g = ready();
  const { foe } = fightWith(g, { mob: "slime_imp" });
  const me = g.state.encounter!.combatants.find((c) => c.side === "crawler")!;
  const mod = calledShotModifier(g.state, me, foe);
  assert.equal(mod.multiplier, 1, "a called shot worked on something with no vitals");
  assert.ok(mod.note, "and it did not explain why");
});

test("a called shot cannot one-shot something built out of a building", () => {
  const g = ready();
  const { foe } = fightWith(g, { boss: "ball_of_swine" });
  const me = g.state.encounter!.combatants.find((c) => c.side === "crawler")!;
  const mod = calledShotModifier(g.state, me, foe);
  assert.ok(mod.multiplier < 3, `a headshot on a corridor-filling boss multiplied by ${mod.multiplier}`);
  assert.ok(mod.note, "and nothing told the player why");
});

/* -------------------------------------------------------------- crafting */

test("knowledge, materials and a bench are each separately required", () => {
  const g = ready();
  const node = bench(g.state);
  const s = g.state;

  // Doesn't know it.
  s.recipes = [];
  assert.equal(canCraft(s, node, "oxide_charge").ok, false, "built something it had never heard of");

  // Knows it, hasn't the skill. (A chemist's intake may already have started
  // them on alchemy, so this has to be zeroed rather than assumed.)
  s.recipes = ["oxide_charge"];
  delete s.skills["alchemy"];
  const noSkill = canCraft(s, node, "oxide_charge");
  assert.equal(noSkill.ok, false);
  assert.match(noSkill.reason!, /alchemy/);

  // Has the skill, hasn't the materials.
  trainSkill(s, "alchemy", 5000);
  const noMats = canCraft(s, node, "oxide_charge");
  assert.equal(noMats.ok, false);
  assert.match(noMats.reason!, /needs/i);

  // Has everything but the bench — and this one cannot be improvised.
  give(s, "scrap", 3);
  give(s, "reagent", 2);
  give(s, "powder", 1);
  const noBench = canCraft(s, node, "oxide_charge");
  assert.equal(noBench.ok, false, "improvised a burn-through charge on a stone floor");
  assert.match(noBench.reason!, /Ordnance/);

  // With the studio, finally.
  s.space = { owned: true, stations: ["ordnance"], upgrades: [] };
  assert.equal(canCraft(s, node, "oxide_charge").ok, true);
});

test("crafting consumes the materials and hands back a device that works", () => {
  const g = ready();
  const node = bench(g.state);
  const s = g.state;
  s.recipes = ["oxide_charge"];
  trainSkill(s, "alchemy", 5000);
  s.space = { owned: true, stations: ["ordnance"], upgrades: [] };
  give(s, "scrap", 3);
  give(s, "reagent", 2);
  give(s, "powder", 1);

  const { item, minutes } = craft(s, Rng.fromSeed(2), log(), node, "oxide_charge");
  assert.ok(item, "the bench produced nothing");
  assert.ok(item!.device, "and what it produced was not a device");
  assert.equal(item!.device!.vital, true);
  assert.ok(item!.device!.tags.includes("fire"));
  assert.equal(minutes, RECIPE_BY_ID["oxide_charge"]!.minutes);
  assert.equal(s.inventory.filter((i) => i.id === "powder").length, 0, "the powder is still in the bag");
  assert.equal(s.inventory.filter((i) => i.id === "reagent").reduce((n, i) => n + i.qty, 0), 0);
});

test("improvising something improvisable costs more than twice the time", () => {
  const g = ready();
  const node = currentNode(g.state.floor); // no bench of any kind
  const s = g.state;
  s.recipes = ["cutting_charge"];
  trainSkill(s, "demolitions", 5000);
  give(s, "powder", 2);
  give(s, "scrap", 2);
  give(s, "wire", 1);

  const check = canCraft(s, node, "cutting_charge");
  assert.equal(check.ok, true);
  assert.equal(check.improvised, true);
  const { minutes } = craft(s, Rng.fromSeed(7), log(), node, "cutting_charge");
  assert.ok(minutes > RECIPE_BY_ID["cutting_charge"]!.minutes * 2, "improvising was not slower");
});

test("a guild hall's communal benches are free and the good ones are not", () => {
  const g = ready();
  const node = bench(g.state);
  assert.deepEqual(stationsHere(g.state, node).sort(), ["alchemy", "engineering"]);
  // The studio is never communal. That is the entire reason it costs money.
  assert.ok(!stationsHere(g.state, node).includes("ordnance"));
});

test("brewing turns reagents into the supplies that keep a run alive", () => {
  const g = ready();
  const node = bench(g.state);
  const s = g.state;
  trainSkill(s, "alchemy", 200);
  give(s, "reagent", 1);
  give(s, "glowmoss", 1);
  const { items } = brew(s, log(), node, "brew_health", Rng.fromSeed(5));
  assert.equal(items.length, 1);
  assert.ok(items[0]!.qty >= 2, "two potions a batch, minimum");
  assert.equal(s.inventory.filter((i) => i.id === "glowmoss").length, 0);
});

test("experimenting needs a bench and materials to waste, and can find things nobody hands out", () => {
  const g = ready();
  const bare = currentNode(g.state.floor);
  const s = g.state;
  assert.throws(() => experiment(s, Rng.fromSeed(1), log(), bare), /bench/i);

  const node = bench(s);
  assert.throws(() => experiment(s, Rng.fromSeed(1), log(), node), /materials/i);

  give(s, "scrap", 6);
  trainSkill(s, "alchemy", 900);
  trainSkill(s, "engineering", 900);
  s.recipes = [];

  // 55% a go: over a dozen attempts it has to find something.
  let learned: string | null = null;
  for (let i = 0; i < 12 && !learned; i++) {
    give(s, "scrap", 3);
    learned = experiment(s, Rng.fromSeed(20 + i), log(), node).learned;
  }
  assert.ok(learned, "twelve sessions at a bench taught it nothing");
  assert.ok(s.recipes.includes(learned!));
});

/* ------------------------------------------------------------ gold sinks */

test("a room of your own is gated on the floor and on the money", () => {
  const g = ready();
  const s = g.state;
  s.floor.n = 1;
  s.crawler.gold = 99_999;
  assert.throws(() => buySpace(s, log()), /third floor/i);

  s.floor.n = 3;
  s.crawler.gold = SPACE_COST - 1;
  assert.throws(() => buySpace(s, log()), /gold/i);

  s.crawler.gold = SPACE_COST + 10;
  buySpace(s, log());
  assert.equal(s.space.owned, true);
  assert.equal(s.crawler.gold, 10, "the money did not actually leave");
  assert.throws(() => buySpace(s, log()), /already/i);
});

test("benches cost what they cost and cannot be installed in a room you do not have", () => {
  const g = ready();
  const s = g.state;
  s.crawler.gold = 99_999;
  assert.throws(() => installStation(s, log(), "ordnance"), /space/i);

  s.space = { owned: true, stations: [], upgrades: [] };
  const cost = STATION_BY_ID["ordnance"]!.cost;
  s.crawler.gold = cost - 1;
  assert.throws(() => installStation(s, log(), "ordnance"), /gold/i);

  s.crawler.gold = cost;
  installStation(s, log(), "ordnance");
  assert.equal(s.crawler.gold, 0);
  assert.ok(s.space.stations.includes("ordnance"));
  assert.throws(() => installStation(s, log(), "ordnance"), /already/i);
  assert.throws(() => installStation(s, log(), "nonsense"), /No such bench/i);
});

test("every room upgrade is buyable exactly once and is paid for", () => {
  const g = ready();
  const s = g.state;
  s.space = { owned: true, stations: [], upgrades: [] };
  for (const u of UPGRADES) {
    s.crawler.gold = u.cost;
    buyUpgrade(s, log(), u.id);
    assert.equal(s.crawler.gold, 0, `${u.name} was free`);
    assert.ok(s.space.upgrades.includes(u.id));
    s.crawler.gold = u.cost;
    assert.throws(() => buyUpgrade(s, log(), u.id), /already/i);
  }
});

test("an Ordnance Studio is a real amount of looting, not pocket change", () => {
  // The point of a sink is that it is felt. If a studio were affordable on
  // floor two the decision layer it exists to create would not exist.
  const g = ready();
  const s = g.state;
  const loot = fromId("potion_health", 1, Rng.fromSeed(1));
  const perSale = sellPrice(s, loot);
  assert.ok(STATION_BY_ID["ordnance"]!.cost / Math.max(1, perSale) > 100, "the studio is too cheap to hurt");
  assert.ok(buyPrice(s, loot) > perSale, "you could buy low and sell high in the same shop");
});

test("negotiation moves both prices in the crawler's favour", () => {
  const g = ready();
  const s = g.state;
  const item = fromId("potion_health", 1, Rng.fromSeed(1));
  const buyBefore = buyPrice(s, item);
  const sellBefore = sellPrice(s, item);
  trainSkill(s, "negotiation", 4000);
  assert.ok(buyPrice(s, item) < buyBefore, "haggling did not lower what you pay");
  assert.ok(sellPrice(s, item) > sellBefore, "haggling did not raise what you get");
});
