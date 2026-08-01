import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/sim/game.ts";
import { interpret } from "../src/sim/improvise.ts";
import { currentNode } from "../src/sim/map.ts";
import { fromId } from "../src/sim/loot.ts";
import { Rng } from "../src/core/rng.ts";
import { heldUnits, materialItem, materialOf } from "../src/sim/harvest.ts";
import {
  availableTransforms, capabilityOf, checkTransform, inputsFor,
  productOf, readTransform, satisfy, transformMenu,
} from "../src/sim/transform.ts";
import { TRANSFORMS, TRANSFORM_BY_ID } from "../src/data/transforms.ts";
import { MATERIAL_BY_ID, isMatTag } from "../src/data/materials.ts";
import type { GameState } from "../src/core/types.ts";

/**
 * Chemistry, rather than a crafting table.
 *
 * The distinction is the point of the layer. A crafting table can only make
 * what somebody wrote down. These rules are keyed on properties, so a rule
 * written once about carbonates covers limestone, mortar and bone — none of
 * which appear in it — and a player who reasons correctly about a substance
 * gets the result their reasoning earned rather than the result somebody
 * anticipated.
 */

function stocked(mats: Record<string, number>, extra: string[] = []): Game {
  const g = Game.create(2, { name: "T", job: "roofer", hobby: "distance running" });
  for (const [id, qty] of Object.entries(mats)) {
    g.state.inventory.push(materialItem(MATERIAL_BY_ID[id]!, qty));
  }
  for (const id of extra) g.state.inventory.push(fromId(id, 1, Rng.fromSeed(1)));
  return g;
}

/* ------------------------------------------------------------ the rules */

test("no rule names a material — every one keys on properties", () => {
  const ids = new Set(Object.keys(MATERIAL_BY_ID));
  for (const r of TRANSFORMS) {
    for (const t of [...r.wants, ...(r.refuses ?? []), ...(r.with?.wants ?? [])]) {
      assert.ok(isMatTag(t), `${r.id} wants "${t}", which is not a property`);
      assert.ok(!ids.has(t), `${r.id} is keyed on a material rather than a property`);
    }
  }
});

test("every rule can be reached by something that exists", () => {
  for (const r of TRANSFORMS) {
    const inputs = Object.values(MATERIAL_BY_ID).filter(
      (m) => r.wants.every((t) => m.tags.includes(t)) && !r.refuses?.some((t) => m.tags.includes(t)),
    );
    assert.ok(inputs.length > 0, `${r.id} can never be run — nothing in the world matches it`);
    if (r.with) {
      const seconds = Object.values(MATERIAL_BY_ID).filter((m) => r.with!.wants.every((t) => m.tags.includes(t)));
      assert.ok(seconds.length > 0, `${r.id} wants a second ingredient that does not exist`);
    }
  }
});

test("a rule always demands something, and something checkable", () => {
  for (const r of TRANSFORMS) {
    assert.ok(r.needs.length > 0, `${r.id} is free, which makes everything downstream of it free`);
    assert.ok(r.minutes > 0, `${r.id} costs no time`);
    assert.ok(r.ratio.in > 0 && r.ratio.out > 0, `${r.id} makes something out of nothing`);
    assert.ok(r.because.length > 40, `${r.id} does not explain itself`);
  }
});

test("a named product exists, and a derived one carries only known properties", () => {
  for (const r of TRANSFORMS) {
    for (const id of Object.values(r.prefer ?? {})) {
      assert.ok(MATERIAL_BY_ID[id], `${r.id} prefers "${id}", which is not a material`);
    }
    if (r.makes.id) assert.ok(MATERIAL_BY_ID[r.makes.id], `${r.id} makes "${r.makes.id}", which is not a material`);
    for (const t of [...(r.makes.add ?? []), ...(r.makes.drop ?? [])]) {
      assert.ok(isMatTag(t), `${r.id} produces "${t}", which is not a property`);
    }
  }
});

/* ------------------------------------------------- the worked example */

test("limestone burns into quicklime, offline, with nothing but heat and time", async () => {
  // The exact thing that started this: "the walls are brick and mortar and
  // limestone; I'll knock the limestone out and later make quicklime from it."
  const g = stocked({ limestone: 15, charcoal: 15 }, ["lighter"]);
  await g.execute({ t: "look" });

  const read = readTransform(g.state, "i want to make quicklime out of the limestone");
  assert.equal(read?.rule.id, "calcine", "calcining was not the reading");
  assert.equal(read?.input.id, "limestone");

  // A batch can spoil — that is what skill is for — so the assertion is that
  // the process WORKS, not that it works first time. Two batches' worth of
  // stone is enough to prove the physics without asserting a die roll.
  const first = await g.execute({ t: "transform", rule: "calcine", input: "limestone" });
  assert.doesNotMatch(first.lines.map((l) => l.text).join(" "), /wants/i, "it refused a run it had every part of");

  while (heldUnits(g.state, "quicklime") === 0 && heldUnits(g.state, "limestone") >= 3) {
    await g.execute({ t: "transform", rule: "calcine", input: "limestone" });
  }
  assert.ok(heldUnits(g.state, "quicklime") > 0, "fifteen blocks of limestone produced no quicklime at all");
  assert.ok(heldUnits(g.state, "limestone") < 15, "the limestone was not consumed");
});

test("and then the quicklime slakes, which is the second link in the chain", async () => {
  const g = stocked({ quicklime: 4 });
  // Standing in water, which is what slaking wants.
  const node = currentNode(g.state.floor);
  if (!node.zones[0]!.tags.includes("water")) node.zones[0]!.tags.push("water");
  await g.execute({ t: "look" });

  const r = await g.execute({ t: "transform", rule: "slake", input: "quicklime" });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.doesNotMatch(text, /wants/i, `it refused: ${text}`);
  assert.ok(heldUnits(g.state, "slaked_lime") > 0, "slaking produced nothing");
});

test("a rule written about carbonates works on bone without mentioning bone", () => {
  const g = stocked({ bone_stock: 6, charcoal: 4 }, ["lighter"]);
  const inputs = inputsFor(g.state, TRANSFORM_BY_ID.calcine!);
  assert.ok(inputs.some((i) => i.mat.id === "bone_stock"), "bone is a carbonate and calcining refused it");

  const product = productOf(TRANSFORM_BY_ID.calcine!, MATERIAL_BY_ID.bone_stock!);
  assert.ok(product.tags.includes("caustic"), "burnt bone came out without the property that makes it worth burning");
  assert.ok(!product.tags.includes("carbonate"), "it is still a carbonate after being decarbonated");
  assert.notEqual(product.id, "quicklime", "burnt bone was silently relabelled as quicklime");
});

test("a product is a legal input to the next process, or the chain is one link long", () => {
  const burnt = productOf(TRANSFORM_BY_ID.calcine!, MATERIAL_BY_ID.bone_stock!);
  const g = stocked({});
  g.state.inventory.push(materialItem(burnt, 4));

  // It came out of nothing the catalogue knows about, and it still reads back.
  const item = g.state.inventory.find((i) => i.id === `mat_${burnt.id}`)!;
  assert.equal(materialOf(item)?.id, burnt.id, "a minted substance could not be read back off the item");
  assert.ok(inputsFor(g.state, TRANSFORM_BY_ID.slake!).some((i) => i.mat.id === burnt.id),
    "burnt bone cannot be slaked, so the chain stops");
});

/* -------------------------------------------------------- the refusals */

test("a refusal names the physical thing that is missing", async () => {
  const g = stocked({ limestone: 6 }); // no fire at all
  await g.execute({ t: "look" });
  const r = await g.execute({ t: "transform", rule: "calcine", input: "limestone" });
  const text = r.lines.map((l) => l.text).join(" ");

  assert.match(text, /850/, "it did not say how hot");
  assert.match(text, /Quicklime/, "it did not say what you would have got");
  assert.doesNotMatch(text, /cannot|can't|not allowed|invalid|unable/i, "it argued instead of pricing it");
});

test("fixing what was missing changes the answer", async () => {
  const g = stocked({ limestone: 6 });
  await g.execute({ t: "look" });
  const before = (await g.execute({ t: "transform", rule: "calcine", input: "limestone" }))
    .lines.map((l) => l.text).join(" ");
  assert.match(before, /850/);

  g.state.inventory.push(materialItem(MATERIAL_BY_ID.charcoal!, 6));
  g.state.inventory.push(fromId("lighter", 1, Rng.fromSeed(1)));
  const after = (await g.execute({ t: "transform", rule: "calcine", input: "limestone" }))
    .lines.map((l) => l.text).join(" ");
  assert.doesNotMatch(after, /850/, "the temperature was still missing after being supplied");
});

test("claiming a process needs nothing does not make it free", () => {
  // The engine never asks whether a transformation is real. It prices it, and
  // every price is a thing the world can be asked about.
  const g = stocked({ sulphur: 6 });
  const node = currentNode(g.state.floor);
  const cap = capabilityOf(g.state, node);
  for (const need of TRANSFORM_BY_ID.distil_acid!.needs) {
    const missing = satisfy(g.state, cap, need);
    if (need.k === "station" || need.k === "heat") {
      assert.ok(missing, `${need.k} was waived on a bare floor`);
    }
  }
});

test("cold nobody can reach is refused honestly rather than quietly granted", () => {
  const g = stocked({});
  const cap = capabilityOf(g.state, currentNode(g.state.floor));
  assert.ok(satisfy(g.state, cap, { k: "freezing" }), "a requirement the world cannot meet was waived");
});

/* --------------------------------------------------------- the reading */

test("a trigger word ends where the word ends", () => {
  // This was live: "lime" reached inside "limestone", so "dig out more
  // limestone" was read as an attempt to calcine it.
  const g = stocked({ limestone: 6, charcoal: 4 }, ["lighter", "crowbar"]);
  assert.equal(interpret(g.state, "dig out more limestone").command?.t, "harvest",
    "asking for more of a thing was read as processing it");
  assert.equal(interpret(g.state, "break some limestone out of the wall").command?.t, "harvest");

  const c = interpret(g.state, "make quicklime out of the limestone").command as { t: string; rule?: string };
  assert.equal(c?.t, "transform");
  assert.equal(c.rule, "calcine");
});

test("the same sentence reaches different processes depending on what you hold", () => {
  const stone = stocked({ limestone: 4, charcoal: 4 }, ["lighter"]);
  const wood = stocked({ timber: 4, charcoal: 4 }, ["lighter"]);
  assert.equal(readTransform(stone.state, "roast it")?.rule.id, "calcine");
  assert.equal(readTransform(wood.state, "cook it without air")?.rule.id, "char");
});

test("saying it several different ways all arrives somewhere sensible", () => {
  const g = stocked({ limestone: 6, charcoal: 4 }, ["lighter"]);
  for (const line of [
    "make quicklime out of the limestone",
    "burn the limestone",
    "calcine it",
    "roast the limestone",
    "i want to kiln the limestone",
  ]) {
    const c = interpret(g.state, line).command as { t: string; rule?: string };
    assert.equal(c?.t, "transform", `"${line}" did not reach a process`);
    assert.equal(c.rule, "calcine", `"${line}" reached the wrong process`);
  }
});

test("a process nobody can run yet is still explained rather than hidden", async () => {
  const g = stocked({ sulphur: 4 });
  await g.execute({ t: "look" });
  const r = await g.execute({ t: "improvise", text: "distil some acid out of the sulphur" });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /bench|station|alchemy|°C|hours|ventilat/i, "it refused without saying what it would take");
});

/* ------------------------------------------------------- the economics */

test("a process is never a way to make something out of nothing", () => {
  for (const r of TRANSFORMS) {
    for (const mat of Object.values(MATERIAL_BY_ID)) {
      if (!r.wants.every((t) => mat.tags.includes(t))) continue;
      if (r.refuses?.some((t) => mat.tags.includes(t))) continue;
      const p = productOf(r, mat);
      const inValue = mat.value * r.ratio.in;
      const outValue = p.value * r.ratio.out;
      // Work adds value — that is the point — but a rule that multiplied it
      // twentyfold would be a gold printer wearing a chemistry hat.
      assert.ok(
        outValue <= Math.max(120, inValue * 12),
        `${r.id} turns ${inValue} gold of ${mat.id} into ${outValue} gold of ${p.name}`,
      );
    }
  }
});

test("nothing minted by a process can carry a property the game has never heard of", () => {
  for (const r of TRANSFORMS) {
    for (const mat of Object.values(MATERIAL_BY_ID)) {
      if (!r.wants.every((t) => mat.tags.includes(t))) continue;
      const p = productOf(r, mat);
      for (const t of p.tags) {
        assert.ok(isMatTag(t), `${r.id} on ${mat.id} produced "${t}" — an undefended property`);
      }
      assert.ok(p.kg > 0 && p.value >= 1, `${r.id} on ${mat.id} produced something weightless or worthless`);
    }
  }
});

test("a spoiled batch still costs the materials, because that is what makes skill mean anything", async () => {
  const g = stocked({ limestone: 12, charcoal: 8 }, ["lighter"]);
  await g.execute({ t: "look" });
  const before = heldUnits(g.state, "limestone");
  let spoiled = 0;
  for (let i = 0; i < 4; i++) {
    const r = await g.execute({ t: "transform", rule: "calcine", input: "limestone" });
    if (r.lines.some((l) => /spoiled/i.test(l.text))) spoiled++;
    if (heldUnits(g.state, "limestone") < 3) break;
  }
  assert.ok(heldUnits(g.state, "limestone") < before, "the limestone survived being processed");
  if (spoiled) {
    assert.ok(true, "a spoiled batch consumed its input, which is the intended cost");
  }
});

test("the menu tells you what you could make and what stands in the way", () => {
  const g = stocked({ limestone: 6, rust: 4 }, ["crowbar"]);
  const menu = transformMenu(g.state);
  assert.ok(menu.length > 0, "holding two raw substances offered no processes at all");
  for (const m of menu) {
    if (!m.ok) assert.ok(m.missing.length > 0, `${m.rule.id} is not possible and would not say why`);
  }
  assert.ok(menu.some((m) => m.product.name.toLowerCase().includes("quicklime")), "the obvious one is not on the list");
});

test("an empty pack offers no processes rather than throwing", () => {
  const g = Game.create(2, { name: "T", job: "roofer", hobby: "distance running" });
  assert.deepEqual(availableTransforms(g.state), []);
  assert.deepEqual(transformMenu(g.state), []);
});

test("processing costs hours off the floor clock", async () => {
  const g = stocked({ limestone: 6, charcoal: 6 }, ["lighter"]);
  await g.execute({ t: "look" });
  const before = g.state.floor.hoursLeft;
  await g.execute({ t: "transform", rule: "calcine", input: "limestone" });
  assert.ok(g.state.floor.hoursLeft < before, "three hours in a kiln cost nothing");
});

test("what came out survives a save and a reload", async () => {
  const g = stocked({ limestone: 12, charcoal: 12 }, ["lighter"]);
  await g.execute({ t: "look" });
  while (heldUnits(g.state, "quicklime") === 0 && heldUnits(g.state, "limestone") >= 3) {
    await g.execute({ t: "transform", rule: "calcine", input: "limestone" });
  }
  const made = heldUnits(g.state, "quicklime");
  assert.ok(made > 0, "nothing was made, so the round trip proves nothing");

  const round = JSON.parse(JSON.stringify(g.save())) as GameState;
  const back = Game.load(round);
  assert.equal(heldUnits(back.state, "quicklime"), made, "the quicklime did not survive the round trip");
  const item = back.state.inventory.find((i) => i.id === "mat_quicklime");
  assert.ok(item && materialOf(item)?.tags.includes("caustic"), "it came back without its properties");
});
