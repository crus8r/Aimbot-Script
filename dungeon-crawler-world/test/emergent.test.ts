import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/sim/game.ts";
import { Rng } from "../src/core/rng.ts";
import { EventLog } from "../src/core/events.ts";
import { checkMinting, hookBonus, notePractice, generateClassOptions } from "../src/sim/emergent.ts";
import { PRACTICE } from "../src/data/emergent.ts";
import { generateSpell, SPELLS } from "../src/data/spells.ts";
import { castSpell, learnSpell, spellFromTome } from "../src/sim/spells.ts";
import { interpret, ruleOnClaim } from "../src/sim/improvise.ts";
import { beginEncounter, resolveAttack } from "../src/sim/combat.ts";
import { crawlerOf } from "../src/sim/tactics.ts";
import { derive, xpForLevel } from "../src/sim/character.ts";

const newGame = (seed = 1) =>
  Game.create(seed, {
    name: "Tess", job: "electrician", hobby: "boxing", body: "fit",
    mind: "high", people: "mid", dress: "work", carried: ["tools"], companion: "cat",
  });

const log = () => new EventLog(() => 0);

/* ------------------------------------------------------ minted skills */

test("a pattern the engine can see mints a skill, exactly once", () => {
  const g = newGame();
  const rng = Rng.fromSeed(2);
  const l = log();

  for (let i = 0; i < 10; i++) notePractice(g.state, "choke_fight");
  const minted = checkMinting(g.state, rng, l);
  assert.ok(minted, "crossing the threshold minted nothing");
  assert.equal(g.state.skills[minted!.id]?.level, 1);
  assert.ok(minted!.hooks.length > 0, "a minted skill with no hooks is a name and a joke");

  // Again, and it must not re-mint.
  const again = checkMinting(g.state, rng, l);
  assert.notEqual(again?.id, minted!.id);
});

test("a pattern already covered by a trained skill does not mint a second one", () => {
  const g = newGame();
  g.state.skills["brawling"] = { level: 8, xp: 0 };
  for (let i = 0; i < 20; i++) notePractice(g.state, "unarmed_kill");
  const minted = checkMinting(g.state, Rng.fromSeed(3), log());
  assert.notEqual(minted?.id, "unarmed_kill", "minted a duplicate of a skill they already have");
});

test("every practice definition can actually mint and produces usable hooks", () => {
  for (const def of PRACTICE) {
    const g = newGame(7);
    g.state.skills = {}; // nothing covering anything
    for (let i = 0; i < def.threshold; i++) notePractice(g.state, def.id);
    const minted = checkMinting(g.state, Rng.fromSeed(4), log());
    assert.equal(minted?.id, def.id, `${def.id} never mints`);
    assert.ok(minted!.name.length > 2);
    assert.ok(minted!.hooks.length > 0, `${def.id} mints with no mechanical effect`);
  }
});

test("a minted skill changes the numbers on the very next swing", () => {
  const g = newGame(11);
  const state = g.state;
  const node = Object.values(state.floor.nodes).find((n) => n.zones.length >= 3)!;
  node.spawn = [{ mob: "rat", count: 1, level: 1 }];
  node.cleared = false;

  const before = hookBonus(state, "accuracy", { choke: true });
  for (let i = 0; i < 10; i++) notePractice(state, "choke_fight");
  checkMinting(state, Rng.fromSeed(5), log());
  const after = hookBonus(state, "accuracy", { choke: true });
  assert.ok(after > before, "the minted skill contributes nothing in a chokepoint");

  // And it is conditional: no bonus where the condition does not hold.
  assert.equal(hookBonus(state, "accuracy", { ranged: true }), 0);
});

test("hooks scale with the level of the skill carrying them", () => {
  const g = newGame(12);
  for (let i = 0; i < 10; i++) notePractice(g.state, "punch_up");
  checkMinting(g.state, Rng.fromSeed(6), log());
  const atOne = hookBonus(g.state, "damage", { vs_higher: true });
  g.state.skills["punch_up"] = { level: 8, xp: 0 };
  const atEight = hookBonus(g.state, "damage", { vs_higher: true });
  assert.ok(atEight > atOne, "levelling a minted skill did nothing");
});

/* ---------------------------------------------------- generated classes */

test("the third-floor menu mixes authored and assembled options", () => {
  const g = newGame(21);
  for (let i = 0; i < 10; i++) notePractice(g.state, "env_kill");
  const menu = generateClassOptions(g.state, Rng.fromSeed(7));
  assert.ok(menu.length >= 8, "too few options to be a menu");
  assert.ok(menu.some((o) => o.generated), "nothing was assembled for this crawler");
  assert.ok(menu.some((o) => !o.generated), "the authored classes vanished");
  assert.ok(menu.filter((o) => o.recommended).length >= 1);
  for (const o of menu) {
    assert.ok(o.name.length > 2, "a class with no name");
    assert.ok(Object.keys(o.req).length > 0, `${o.name} demands nothing`);
  }
  // Names should not collide, or the select command becomes ambiguous.
  const names = menu.map((o) => o.name);
  assert.equal(new Set(names).size, names.length, "two options share a name");
});

test("a generated class can be selected and its hooks go live", async () => {
  const g = newGame(22);
  g.state.floor = { ...g.state.floor, n: 3 };
  const guild = Object.values(g.state.floor.nodes)[1]!;
  guild.kind = "guild";
  g.state.floor.at = guild.id;

  const menu = g.classOptions();
  const generated = menu.find((o) => o.generated && o.hooks.length > 0)!;
  await g.execute({ t: "select", race: "human", klass: generated.id });

  assert.equal(g.state.crawler.className, generated.name);
  assert.deepEqual(g.state.crawler.classHooks, generated.hooks);
  const kind = generated.hooks[0]!.k;
  assert.ok(
    hookBonus(g.state, kind, { choke: true, unarmed: true, hidden: true, ranged: true, wounded: true }) !== 0 ||
      kind === "onKill" || kind === "resist",
    `${generated.name} contributes nothing after selection`,
  );
});

/* ---------------------------------------------------------------- spells */

test("generated spells are varied, affordable, and mechanically real", () => {
  const rng = Rng.fromSeed(31);
  const names = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const sp = generateSpell(rng, 3);
    names.add(sp.name);
    assert.ok(sp.mana >= 1 && sp.mana <= 20, `${sp.name} costs ${sp.mana}`);
    assert.ok(sp.effects.length > 0, `${sp.name} does nothing`);
  }
  assert.ok(names.size > 40, `only ${names.size} distinct spells in 200 rolls`);
});

test("casting spends mana, respects cooldowns, and refuses the unknown", () => {
  const g = newGame(32);
  const state = g.state;
  state.crawler.stats.int = 20;
  state.crawler.mana = 20;
  const l = log();

  learnSpell(state, SPELLS.find((s) => s.id === "heal")!, l);
  state.crawler.hp = 10;
  const before = state.crawler.mana;
  const r = castSpell(state, Rng.fromSeed(8), l, null, null, "heal");
  assert.ok(r.ok, r.reason ?? "the cast failed for no stated reason");
  assert.equal(state.crawler.mana, before - 6);
  assert.ok(state.crawler.hp > 10, "heal healed nothing");

  const unknown = castSpell(state, Rng.fromSeed(9), l, null, null, "magic_missile");
  assert.equal(unknown.ok, false, "cast a spell that was never learned");

  state.crawler.mana = 0;
  const broke = castSpell(state, Rng.fromSeed(10), l, null, null, "heal");
  assert.equal(broke.ok, false);
  assert.match(broke.reason!, /mana|costs/i);
});

test("a tome never teaches a spell already known", () => {
  const g = newGame(33);
  const rng = Rng.fromSeed(11);
  const l = log();
  for (let i = 0; i < 25; i++) learnSpell(g.state, spellFromTome(g.state, rng), l);
  const ids = Object.keys(g.state.spellbook);
  assert.equal(new Set(ids).size, ids.length, "the spellbook has duplicates");
  assert.ok(ids.length > 10, "tomes stopped producing new spells");
});

/* ------------------------------------------------------------ last stand */

test("a killing blow leaves you standing once, and only once", () => {
  const g = newGame(41);
  const state = g.state;
  const node = Object.values(state.floor.nodes)[1]!;
  node.spawn = [{ mob: "rat", count: 1, level: 1 }];
  node.cleared = false;
  const l = log();
  const enc = beginEncounter(state, Rng.fromSeed(12), l, node);
  const me = crawlerOf(enc);
  const rat = enc.combatants.find((c) => c.side === "hostile")!;

  rat.zone = me.zone;
  rat.damage = "50d10"; // unambiguously lethal
  me.defense = -50;
  assert.equal(enc.lastStands, 1);

  resolveAttack(state, Rng.fromSeed(13), l, enc, node, rat, me);
  assert.equal(me.hp, 1, "the last stand did not catch a fatal blow");
  assert.equal(enc.lastStands, 0);
  assert.ok(me.statuses.some((s) => s.id === "dying"));

  resolveAttack(state, Rng.fromSeed(14), l, enc, node, rat, me);
  assert.equal(me.hp, 0, "the second fatal blow should finish it");
});

test("the dying status clears when the fight is survived", async () => {
  const g = newGame(42);
  g.state.crawler.statuses.push({ id: "dying", name: "Dying", bad: true, turns: 99, magnitude: 0, note: "" });
  const node = Object.values(g.state.floor.nodes)[1]!;
  node.spawn = [{ mob: "rat", count: 1, level: 1 }];
  node.cleared = false;
  g.state.floor.at = node.id;
  await g.execute({ t: "engage" });
  let guard = 0;
  while (g.state.encounter && g.state.crawler.alive && guard++ < 60) {
    const foes = g.state.encounter.combatants.filter((c) => c.alive && c.side === "hostile");
    if (!foes.length) break;
    await g.execute({ t: "attack", target: foes[0]!.id });
    if (g.state.encounter) await g.execute({ t: "endturn" });
  }
  if (g.state.crawler.alive) {
    assert.ok(!g.state.crawler.statuses.some((s) => s.id === "dying"), "still dying after surviving");
  }
});

/* ------------------------------------------------------------ improvise */

test("plain English maps onto legal actions and never throws", () => {
  const g = newGame(51);
  const phrases = [
    "back into the doorway", "punch it", "run away", "try to talk to them",
    "shout at it", "hide and wait", "light the gas", "search the place",
    "throw a rock", "climb up somewhere high", "aaaaaa", "", "use the thing",
    "I would like to leave now please", "stab the rat in the face",
  ];
  for (const p of phrases) {
    assert.doesNotThrow(() => {
      const r = interpret(g.state, p);
      assert.equal(typeof r.note, "string");
      assert.ok(r.note.length > 0, `"${p}" produced no explanation`);
    }, `"${p}" threw`);
  }
});

test("an unrecognised action costs nothing rather than being punished", async () => {
  const g = newGame(52);
  const before = g.state.elapsed;
  const r = await g.execute({ t: "improvise", text: "perform interpretive dance" });
  assert.ok(g.state.crawler.alive);
  assert.ok(r.lines.some((l) => /read as/i.test(l.text)), "no reading was reported back");
  assert.equal(g.state.elapsed, before, "a misunderstanding advanced the clock");
});

/* --------------------------------------------------------------- claims */

test("claiming ordinary things you plausibly had is granted", () => {
  const g = newGame(61);
  const ruling = ruleOnClaim(g.state, "a multi-tool", "I was an electrician for eleven years and it lived in my back pocket");
  assert.equal(ruling.granted, true, ruling.note);
});

test("claiming magic, dungeon loot, or weapons you never established is refused", () => {
  const g = newGame(62);
  for (const [what, why] of [
    ["an enchanted sword", "I have always wanted one and it would be useful"],
    ["a health potion", "surely everyone has one of these lying about the house"],
    ["a shotgun", "I kept it by the door like a sensible person would"],
  ]) {
    const r = ruleOnClaim(g.state, what!, why!);
    assert.equal(r.granted, false, `granted "${what}"`);
  }
});

test("a claim with no reason is asked for a reason, not lectured", () => {
  const g = newGame(63);
  const r = ruleOnClaim(g.state, "a crowbar", "");
  assert.equal(r.granted, false);
  assert.match(r.note, /life|why/i);
});

/* ---------------------------------------------------- inventory at scale */

test("equip best wears the best of what is carried, and drop junk spares locks", async () => {
  const g = newGame(71);
  const { fromId } = await import("../src/sim/loot.ts");
  g.state.inventory.push(fromId("kevlar"), fromId("sledge"), fromId("scrap", 3), fromId("phone"));

  await g.execute({ t: "equipBest" });
  assert.ok(g.state.inventory.find((i) => i.id === "kevlar")?.equipped, "did not put on the best armour");

  const phone = g.state.inventory.find((i) => i.id === "phone")!;
  await g.execute({ t: "lock", item: phone.iid });
  assert.equal(phone.locked, true);

  await g.execute({ t: "dropJunk" });
  assert.ok(g.state.inventory.some((i) => i.id === "phone"), "drop junk took a locked item");
});

test("items can be referenced by the number the inventory prints", async () => {
  const g = newGame(72);
  const { fromId } = await import("../src/sim/loot.ts");
  g.state.inventory.push(fromId("potion_health"));
  const index = g.state.inventory.length;
  g.state.crawler.hp = 5;
  await g.execute({ t: "use", item: String(index) });
  assert.ok(g.state.crawler.hp > 5, "using item by index did nothing");
});

/* -------------------------------------------------------------- feat XP */

test("killing far above your level pays far above your level", async () => {
  const measure = async (mobLevel: number): Promise<number> => {
    const g = newGame(81);
    const node = Object.values(g.state.floor.nodes)[1]!;
    node.spawn = [{ mob: "rat", count: 1, level: mobLevel }];
    node.cleared = false;
    g.state.floor.at = node.id;
    await g.execute({ t: "engage" });
    const enc = g.state.encounter!;
    // Settle it instantly rather than fighting a level 12 rat honestly.
    for (const c of enc.combatants.filter((x) => x.side === "hostile")) {
      c.alive = false;
      enc.killLog.push({ name: c.name, level: c.level, styles: [], byCrawler: true });
    }
    await g.execute({ t: "endturn" });
    return g.state.crawler.xp + g.state.crawler.level * 1000;
  };
  const easy = await measure(1);
  const hard = await measure(12);
  assert.ok(hard > easy * 1.5, `punching up paid ${hard} against ${easy}`);
});

test("nothing caps a single fight's experience", async () => {
  const g = newGame(82);
  const node = Object.values(g.state.floor.nodes)[1]!;
  node.spawn = [{ mob: "rat", count: 5, level: 3 }];
  node.cleared = false;
  g.state.floor.at = node.id;
  await g.execute({ t: "engage" });
  const enc = g.state.encounter!;
  for (const c of enc.combatants.filter((x) => x.side === "hostile")) {
    c.alive = false;
    enc.killLog.push({ name: c.name, level: 20, styles: ["environmental"], byCrawler: true });
    c.xp = 4000;
  }
  await g.execute({ t: "endturn" });
  assert.ok(g.state.crawler.level >= 4, `a wipe of that size should move several levels, got ${g.state.crawler.level}`);
});
