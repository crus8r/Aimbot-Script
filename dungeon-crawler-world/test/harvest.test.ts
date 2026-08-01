import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { Game } from "../src/sim/game.ts";
import { interpret } from "../src/sim/improvise.ts";
import { currentNode } from "../src/sim/map.ts";
import { fromId } from "../src/sim/loot.ts";
import { beginEncounter } from "../src/sim/combat.ts";
import { EventLog } from "../src/core/events.ts";
import {
  collapseLimit, depositsHere, depositsIn, depositsLeft, heldUnits,
  materialItem, materialOf, spendUnits, strainLimit, strainStage,
} from "../src/sim/harvest.ts";
import { MATERIALS, MATERIAL_BY_ID, MAT_TAGS, RAW_MATERIALS, isMatTag } from "../src/data/materials.ts";
import { carriedWeight, carryCapacity } from "../src/sim/character.ts";
import { crawlerOf, hostilesOf } from "../src/sim/tactics.ts";
import type { GameState, Zone } from "../src/core/types.ts";

/**
 * The dungeon as a physical object rather than a set of tactical properties.
 *
 * The thing being protected here is a promise: a player who says "the walls are
 * brick, I'll knock some out and burn it into lime later" gets to do that, and
 * gets to do it without an API key, without a special phrasing, and without the
 * room turning into an infinite quarry when they do.
 */

function ready(seed = 7): Game {
  const g = Game.create(seed, { name: "T", job: "roofer", hobby: "distance running" });
  g.state.inventory.push(fromId("crowbar", 1, Rng.fromSeed(1)));
  return g;
}

const anyZoneWith = (g: Game): { zone: Zone; matId: string } => {
  const node = currentNode(g.state.floor);
  const found = depositsHere(g.state, node)[0]!;
  return { zone: found.zone, matId: found.deposits[0]!.mat.id };
};

/* ---------------------------------------------------------- the catalogue */

test("no material carries a property the rules have never heard of", () => {
  for (const m of MATERIALS) {
    assert.ok(m.tags.length > 0, `${m.id} has no properties at all`);
    for (const t of m.tags) {
      assert.ok(isMatTag(t), `${m.id} carries "${t}", which is not in the closed vocabulary`);
    }
  }
  // And nothing in the vocabulary is dead weight — an unused property is a
  // rule nobody wrote.
  for (const t of MAT_TAGS) {
    assert.ok(MATERIALS.some((m) => m.tags.includes(t)), `nothing is ${t}`);
  }
});

test("material ids are unique, because two limestones is a silent duplication bug", () => {
  const seen = new Set<string>();
  for (const m of MATERIALS) {
    assert.ok(!seen.has(m.id), `${m.id} is defined twice`);
    seen.add(m.id);
  }
});

test("nothing you can only make can also be dug out of a wall", () => {
  // The whole point of a transformation is that it is the only route to the
  // product. A quicklime seam would make burning the limestone pointless.
  for (const id of ["quicklime", "slaked_lime", "charcoal", "metal_fuel", "black_powder", "acid", "lye"]) {
    assert.equal(MATERIAL_BY_ID[id]?.occurs, undefined, `${id} occurs naturally, which defeats making it`);
  }
});

test("every raw material can actually be got at", () => {
  for (const m of RAW_MATERIALS) {
    assert.ok(m.occurs!.chance > 0, `${m.id} can never appear`);
    assert.ok(m.occurs!.units[0] >= 1, `${m.id} appears in quantities of zero`);
    assert.ok(m.kg > 0 && m.minutes !== undefined && m.dc !== undefined, `${m.id} has no cost to extract`);
  }
});

/* ------------------------------------------------------------- derivation */

test("what a wall is made of is derived, not stored, and never drifts", () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  const zone = node.zones[0]!;

  const a = depositsIn(g.state.seed, 1, node, zone);
  const b = depositsIn(g.state.seed, 1, node, zone);
  assert.deepEqual(a.map((d) => [d.mat.id, d.units]), b.map((d) => [d.mat.id, d.units]));

  // Nothing about it is in the save until somebody digs.
  assert.deepEqual(g.state.dug, {});
  const round = JSON.parse(JSON.stringify(g.state)) as GameState;
  assert.deepEqual(
    depositsIn(round.seed, 1, node, zone).map((d) => d.mat.id),
    a.map((d) => d.mat.id),
    "a saved and reloaded run found different geology",
  );
});

test("two different worlds are made of different things", () => {
  const summarise = (seed: number) => {
    const g = ready(seed);
    const node = currentNode(g.state.floor);
    return node.zones.flatMap((z) => depositsIn(g.state.seed, 1, node, z).map((d) => `${z.id}:${d.mat.id}:${d.units}`)).join("|");
  };
  assert.notEqual(summarise(7), summarise(999), "the seed does not reach the walls");
});

test("a position never lists more substances than a person can hold in their head", () => {
  for (const seed of [1, 7, 42, 99, 1234]) {
    const g = ready(seed);
    const node = currentNode(g.state.floor);
    for (const z of node.zones) {
      assert.ok(depositsIn(g.state.seed, 1, node, z).length <= 4, "a wall turned into a spreadsheet");
    }
  }
});

/* ------------------------------------------------------------ taking some */

test("digging takes time, produces the material, and leaves less of it", async () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  const { zone, matId } = anyZoneWith(g);
  const before = depositsLeft(g.state, node, zone).find((d) => d.mat.id === matId)!.left;
  const clock = g.state.elapsed;

  await g.execute({ t: "harvest", what: MATERIAL_BY_ID[matId]!.name.toLowerCase(), qty: 2 });

  assert.ok(g.state.elapsed > clock, "taking a wall apart cost no time");
  const after = depositsLeft(g.state, node, zone).find((d) => d.mat.id === matId)?.left ?? 0;
  assert.ok(after < before, "the wall has as much in it as before");
  assert.ok(heldUnits(g.state, matId) > 0, "nothing ended up in the bag");
});

test("a seam runs out and says so instead of paying out forever", async () => {
  const g = ready();
  g.state.crawler.stats.str = 40;
  const node = currentNode(g.state.floor);
  const { zone, matId } = anyZoneWith(g);
  const total = depositsLeft(g.state, node, zone).find((d) => d.mat.id === matId)!.left;

  for (let i = 0; i < 40; i++) {
    if (!depositsLeft(g.state, node, zone).some((d) => d.mat.id === matId)) break;
    if (strainStage(g.state, node, zone) === "down") break;
    await g.execute({ t: "harvest", what: MATERIAL_BY_ID[matId]!.name.toLowerCase(), qty: 4 });
  }
  assert.ok(heldUnits(g.state, matId) <= total, `${heldUnits(g.state, matId)} out of a seam of ${total}`);

  const r = await g.execute({ t: "harvest", what: MATERIAL_BY_ID[matId]!.name.toLowerCase() });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /no |already come down|nothing/i, "an exhausted seam kept quiet about it");
});

test("naming something the room does not contain is answered by name", async () => {
  const g = ready();
  const r = await g.execute({ t: "harvest", what: "granite" });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /no granite/i, "it did not say what was missing");
  assert.match(text, /what there is/i, "it did not say what was actually available");
  assert.equal(heldUnits(g.state, "granite"), 0, "asking for granite produced granite");
});

test("asking for one thing never quietly hands you another", async () => {
  const g = ready();
  const before = g.state.inventory.length;
  await g.execute({ t: "harvest", what: "granite" });
  assert.equal(g.state.inventory.length, before, "a refusal still put something in the bag");
});

/* ------------------------------------------------------------- the limits */

test("you cannot dig out what you cannot carry", async () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  const heavy = depositsHere(g.state, node)
    .flatMap(({ deposits }) => deposits)
    .find((d) => d.mat.kg >= 2.5);
  if (!heavy) return; // this seed's room is all light material; nothing to prove

  // Fill the pack to a kilo under the ceiling. Everything that follows is a
  // question about the running total rather than about any single object, so
  // the tool stays — a refusal about the crowbar would prove nothing.
  g.state.inventory = g.state.inventory.filter((i) => i.equipped || i.id === "crowbar");
  const room = carryCapacity(g.state) - carriedWeight(g.state) - 1;
  g.state.inventory.push({ ...materialItem(MATERIAL_BY_ID.granite!, 1), weight: room, qty: 1 });

  const r = await g.execute({ t: "harvest", what: heavy.mat.name.toLowerCase(), qty: 4 });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /carrying|lift|ceiling|room for|Strength/i, "the weight limit was silent");
  assert.equal(heldUnits(g.state, heavy.mat.id), 0, "it came away anyway");
});

test("the running total is enforced and not merely displayed", async () => {
  // This was live: `pickUp` checked one item against the ceiling and never the
  // sum, so the kilograms on the sheet were decoration and you could carry a
  // wall home one liftable block at a time.
  const g = ready();
  g.state.inventory = g.state.inventory.filter((i) => i.equipped);
  const ceiling = carryCapacity(g.state);
  const half = ceiling * 0.6;

  const node = currentNode(g.state.floor);
  node.loot = [
    { ...fromId("rations", 1, Rng.fromSeed(1)), weight: half, qty: 1 },
    { ...fromId("rations", 1, Rng.fromSeed(2)), weight: half, qty: 1 },
  ];
  node.searched = false;
  await g.execute({ t: "search" });

  // Each is liftable on its own; the pair is not.
  assert.ok(carriedWeight(g.state) <= ceiling, `carrying ${carriedWeight(g.state)} kg against a ${ceiling} kg ceiling`);
  assert.ok(carriedWeight(g.state) >= half, "it refused the first one as well, which is a different bug");
});

test("a tool you do not have is named rather than merely missed", async () => {
  const g = Game.create(7, { name: "T", job: "roofer", hobby: "distance running" });
  g.state.inventory = g.state.inventory.filter((i) => !i.tags.includes("bludgeon") && !i.tags.includes("tool"));
  const node = currentNode(g.state.floor);
  const needs = depositsHere(g.state, node)
    .flatMap(({ deposits }) => deposits)
    .find((d) => d.mat.tool);
  if (!needs) return;

  const r = await g.execute({ t: "harvest", what: needs.mat.name.toLowerCase() });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /wants|lever|edge|heavy|cut/i, "it refused without saying what would fix it");
});

/* ----------------------------------------------------------------- strain */

test("a room is a structure, not a mine, and the structure is the limit", () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  for (const z of node.zones) {
    assert.ok(strainLimit(z) >= 3);
    assert.ok(collapseLimit(z) > strainLimit(z), "a room collapses before it sags");
    // Narrow places come down soonest. That is physics and it is also the
    // reason a chokepoint is a decision rather than a free win.
    if (z.capacity <= 2) assert.ok(collapseLimit(z) <= 10, "a doorway is as sturdy as a plaza");
  }
});

test("a position that has come down stays down, and is not a fresh seam of rubble", async () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  const zone = node.zones.find((z) => depositsLeft(g.state, node, z).length > 0)!;

  // Straight to the far side of the limit, which is what an hour of digging does.
  g.state.dug[`s:${g.state.floor.n}:${node.id}:${zone.id}`] = collapseLimit(zone);

  assert.equal(strainStage(g.state, node, zone), "down");
  assert.deepEqual(depositsLeft(g.state, node, zone), [], "the rubble read as a new seam of everything rubble is made of");

  const r = await g.execute({ t: "harvest", what: "brick", zone: zone.id });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /come down|no brick|nothing/i);
});

test("bringing a ceiling down hurts, and it hurts whoever is under it", async () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  const zone = node.zones.find((z) => depositsLeft(g.state, node, z).some((d) => d.mat.structural));
  if (!zone) return;

  // One short of the limit, so the next structural unit is the one that does it.
  g.state.dug[`s:${g.state.floor.n}:${node.id}:${zone.id}`] = collapseLimit(zone) - 1;
  g.state.crawler.stats.str = 40;
  const hpBefore = g.state.crawler.hp;

  const mat = depositsLeft(g.state, node, zone).find((d) => d.mat.structural)!;
  await g.execute({ t: "harvest", what: mat.mat.name.toLowerCase(), qty: 4, zone: zone.id });

  if (strainStage(g.state, node, zone) === "down") {
    assert.ok(g.state.crawler.hp < hpBefore, "a ceiling landed on somebody for free");
    assert.equal(zone.capacity, 1, "a collapsed position still holds a crowd");
    assert.ok(zone.tags.includes("rubble"), "the rubble is not rubble");
  }
});

/* ------------------------------------------------------------ the reading */

test("the ways people say it all reach the same verb", () => {
  const g = ready();
  const reads = (s: string) => interpret(g.state, s).command;
  for (const line of [
    "break some brick out of the wall",
    "knock a few bricks loose",
    "chip away at the brickwork",
    "take a pipe off the wall",
    "prise some of the mortar out of the joints",
    "i'm gonna dig into the wall and see what comes out",
    "harvest",
    "scrape the wall",
    "salvage what I can from the masonry",
  ]) {
    assert.equal(reads(line)?.t, "harvest", `"${line}" did not reach the wall`);
  }
});

test("asking about a wall is not asking to take it apart", () => {
  const g = ready();
  for (const line of [
    "what are the walls made of",
    "look at the wall",
    "how thick is the wall",
    "examine the brickwork",
    "how high is the ceiling",
  ]) {
    assert.equal(interpret(g.state, line).command?.t, "examine", `"${line}" started demolition`);
  }
});

test("a quantity in the sentence is a quantity in the command", () => {
  const g = ready();
  const qty = (s: string) => (interpret(g.state, s).command as { qty?: number }).qty;
  assert.equal(qty("knock three bricks out"), 3);
  assert.equal(qty("break out a couple of blocks from the wall"), 2);
  assert.equal(qty("dig out as much as I can carry"), 12);
});

test("nobody loses a combat round to a good idea about the walls", () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  node.spawn = [{ mob: "rat", count: 2, level: 2 }];
  node.cleared = false;
  g.state.encounter = beginEncounter(g.state, Rng.fromSeed(3), new EventLog(() => 0), node);

  const r = interpret(g.state, "dig some brick out of the wall");
  assert.equal(r.command, null, "an hour of quarrying started mid-fight");
  assert.match(r.note, /nothing spent|nothing lost/i, "it refused without saying the round was safe");

  // And the fighting words still reach the fight.
  assert.equal(interpret(g.state, "break its legs").command?.t, "attack");
  assert.equal(interpret(g.state, "hack at it").command?.t, "attack");
});

test("naming a part of something is a called shot without saying the words", () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  node.spawn = [{ mob: "rat", count: 1, level: 2 }];
  node.cleared = false;
  g.state.encounter = beginEncounter(g.state, Rng.fromSeed(3), new EventLog(() => 0), node);

  // Standing on top of it, so "closing first" is not the correct reading and
  // the assertion is about the aiming rather than about the footwork.
  const enc = g.state.encounter!;
  const me = crawlerOf(enc);
  for (const f of hostilesOf(enc, me)) f.zone = me.zone;

  for (const line of ["break its legs", "go for the throat", "stab it in the eye", "cut its tendons"]) {
    const c = interpret(g.state, line).command as { t: string; called?: boolean };
    assert.equal(c?.t, "attack", `"${line}" was not violence`);
    assert.equal(c.called, true, `"${line}" was not read as aiming at anything`);
  }
});

/* ------------------------------------------------------------ the pack */

test("a material in the bag is an ordinary item that stacks and spends", () => {
  const g = ready();
  const item = materialItem(MATERIAL_BY_ID.limestone!, 3);
  g.state.inventory.push(item);

  assert.equal(materialOf(item)?.id, "limestone");
  assert.equal(heldUnits(g.state, "limestone"), 3);
  assert.equal(spendUnits(g.state, "limestone", 5), false, "it spent stock that was not there");
  assert.equal(heldUnits(g.state, "limestone"), 3, "a failed spend still took some");
  assert.equal(spendUnits(g.state, "limestone", 2), true);
  assert.equal(heldUnits(g.state, "limestone"), 1);
  assert.equal(spendUnits(g.state, "limestone", 1), true);
  assert.equal(heldUnits(g.state, "limestone"), 0);
  assert.ok(!g.state.inventory.some((i) => i.id === "mat_limestone"), "an empty stack stayed in the pack");
});

test("looking at a room says what it is built of", async () => {
  const g = ready();
  const r = await g.execute({ t: "examine" });
  const text = r.lines.map((l) => l.text).join(" ");
  const node = currentNode(g.state.floor);
  const first = depositsHere(g.state, node)[0];
  if (!first) return;
  assert.match(text, /Made of:/, "the room never said what it was made of");
  assert.ok(
    text.toLowerCase().includes(first.deposits[0]!.mat.name.toLowerCase()),
    "the substance in the wall was not among the facts",
  );
});

test("looking at what a room is made of costs nothing", async () => {
  const g = ready();
  const before = g.state.elapsed;
  await g.execute({ t: "examine" });
  assert.equal(g.state.elapsed, before, "reading a wall cost time");
});
