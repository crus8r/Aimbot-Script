import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { EventLog } from "../src/core/events.ts";
import { Game } from "../src/sim/game.ts";
import { interpret } from "../src/sim/improvise.ts";
import { beginEncounter } from "../src/sim/combat.ts";
import { currentNode } from "../src/sim/map.ts";
import { fromId } from "../src/sim/loot.ts";
import type { GameState } from "../src/core/types.ts";

/**
 * Reading what somebody actually typed.
 *
 * The old test here asserted only that a note came back non-empty, which is
 * why 89% of natural inputs could fall on the floor without anything going
 * red. These assert the command, because the command is the thing that either
 * respects the player or wastes their turn.
 */

function ready(): Game {
  const g = Game.create(7, { name: "T", job: "roofer", hobby: "distance running" });
  g.state.inventory.push(fromId("potion_health", 2, Rng.fromSeed(1)));
  return g;
}

function fighting(g: Game): void {
  const node = currentNode(g.state.floor);
  node.spawn = [{ mob: "rat", count: 2, level: 2 }];
  node.cleared = false;
  g.state.encounter = beginEncounter(g.state, Rng.fromSeed(3), new EventLog(() => 0), node);
}

const reads = (s: GameState, input: string): string | null => interpret(s, input).command?.t ?? null;

/* ------------------------------------------------------------ perception */

test("looking around is understood, which is the whole reason this module exists", () => {
  const s = ready().state;
  for (const input of [
    "look around",
    "i'm gonna look around, see what the walls and floor are made of",
    "examine the walls",
    "what's this place made of",
    "check my surroundings",
    "look at the ceiling",
    "describe the room",
    "what do I see",
    "tell me about the storm grate",
  ]) {
    assert.equal(reads(s, input), "examine", `"${input}" was not read as looking`);
  }
});

test("asking about the ceiling does not bring the ceiling down", () => {
  const g = ready();
  fighting(g);
  const r = interpret(g.state, "how high is the ceiling");
  assert.notEqual(r.command?.t, "feature", "a question spent a one-shot room feature");
});

test("questions about yourself are answered, not ignored", () => {
  const s = ready().state;
  for (const input of ["how am I doing", "am I hurt", "what am I carrying", "how much time do I have"]) {
    const r = interpret(s, input);
    assert.equal(r.command?.t, "examine", `"${input}" went nowhere`);
    assert.equal((r.command as { what?: string }).what, "me");
  }
});

/* --------------------------------------------------- never punish a miss */

test("an unrecognised line in combat never costs you the round", () => {
  const g = ready();
  fighting(g);
  for (const input of ["sing a song", "how am I doing", "what is the floor made of", "think about my life"]) {
    const t = reads(g.state, input);
    assert.notEqual(t, "endturn", `"${input}" handed the monster a free round`);
  }
});

test("passing the round is available, but only if you ask for it", () => {
  const g = ready();
  fighting(g);
  assert.equal(reads(g.state, "do nothing"), "endturn");
  assert.equal(reads(g.state, "pass"), "endturn");
});

test("out of combat the fallback describes the room and says so", () => {
  const s = ready().state;
  const r = interpret(s, "qwertyuiop");
  assert.equal(r.command?.t, "examine");
  assert.match(r.note, /free|no time/i, "the fallback did not say it cost nothing");
  assert.doesNotMatch(r.note, /has done nothing/i, "it still claims it did nothing while doing something");
});

/* ------------------------------------------- prefix matching was a trap */

test("short keywords match whole words, not prefixes", () => {
  const s = ready().state;
  // Every one of these used to fire the wrong branch: \brig on "right",
  // \bguard on "guardian", \bset on "sunset", \bup on "upgrade".
  assert.notEqual(reads(s, "go right"), "prep", '"go right" rigged a tripwire');
  assert.notEqual(reads(s, "attack the guardian"), "prep", '"the guardian" built a barricade');
  assert.equal(reads(s, "set a trap"), "prep", '"set a trap" should still rig a trap');
  assert.notEqual(reads(s, "upgrade my armour"), "move", '"upgrade" climbed to high ground');
});

/* --------------------------------------------------- naming is not using */

test("mentioning something you carry does not consume it", () => {
  const s = ready().state;
  const before = s.inventory.length;
  const r = interpret(s, "do I still have that health potion");
  assert.notEqual(r.command?.t, "use", "merely asking about a potion drank it");
  assert.equal(s.inventory.length, before);
  // But asking properly still works.
  assert.equal(reads(s, "drink the health potion"), "use");
});

/* -------------------------------------------------------------- negation */

test("saying no is not taken as an order", () => {
  const s = ready().state;
  for (const input of ["don't search the room", "I'd rather not go in there", "do not attack it"]) {
    assert.equal(interpret(s, input).command, null, `"${input}" was executed anyway`);
  }
});

/* ------------------------------------------------ the way people talk */

test("conversational framing is stripped rather than punished", () => {
  const s = ready().state;
  assert.equal(reads(s, "let me search the room"), "search");
  assert.equal(reads(s, "can I take the stairs down"), "descend");
  assert.equal(reads(s, "I want to sell my junk"), "sell");
  assert.equal(reads(s, "ok now I'll rest"), "prep");
  assert.equal(reads(s, "i try to hide"), "prep");
});

test("a second clause is kept, not silently dropped", () => {
  const s = ready().state;
  const r = interpret(s, "look around, then head for the stairs");
  assert.equal(r.command?.t, "examine");
  assert.match(r.note, /head for the stairs/, "the rest of the sentence vanished without a word");
});

/* --------------------------------------------- the systems gold pays for */

test("the things you spend money and hours on are reachable in plain English", () => {
  const s = ready().state;
  const expect: [string, string][] = [
    ["craft a pipe charge", "craft"],
    ["brew some health potions", "brew"],
    ["buy a room of my own", "buySpace"],
    ["install the ordnance bench", "install"],
    ["open my loot boxes", "open"],
    ["experiment at the bench", "experiment"],
    ["equip the best gear I have", "equipBest"],
    ["drop the junk", "dropJunk"],
    ["go down the stairs", "descend"],
    ["sell everything worthless", "sell"],
  ];
  for (const [input, want] of expect) {
    assert.equal(reads(s, input), want, `"${input}" did not reach ${want}`);
  }
});

test("a called shot can be asked for in words", () => {
  const g = ready();
  fighting(g);
  const r = interpret(g.state, "shoot it in the head");
  assert.equal(r.command?.t, "attack");
  assert.equal((r.command as { called?: boolean }).called, true, "aiming at the head was not a called shot");
});

/* ------------------------------------------------------ what looking says */

test("examining a room reports what standing in it tells you, and nothing more", async () => {
  const g = ready();
  const node = currentNode(g.state.floor);
  node.searched = false;
  node.loot = [fromId("potion_health", 1, Rng.fromSeed(2))];
  const r = await g.execute({ t: "examine" });
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /not searched/i, "it did not say whether the room had been searched");
  assert.doesNotMatch(text, /Health Potion/, "examining revealed unsearched loot — that is free searching");
});

test("examining is free, in and out of a fight", async () => {
  const g = ready();
  const before = g.state.elapsed;
  await g.execute({ t: "examine" });
  assert.equal(g.state.elapsed, before, "looking cost time");

  fighting(g);
  const round = g.state.encounter!.round;
  const acts = g.state.encounter!.actions.act;
  await g.execute({ t: "examine", what: "me" });
  assert.equal(g.state.encounter!.round, round, "looking cost a round");
  assert.equal(g.state.encounter!.actions.act, acts, "looking cost an action");
});

/* ------------------------------------------------- wondering vs deciding */

test("asking whether to do something does not do it", () => {
  const s = ready().state;
  const before = s.inventory.filter((i) => i.id === "potion_health").reduce((n, i) => n + i.qty, 0);
  for (const input of [
    "should I sell the health potion?",
    "should I drink the potion",
    "is it worth searching here",
    "what if I set fire to it",
    "do you think I should rest",
  ]) {
    assert.equal(interpret(s, input).command, null, `"${input}" was carried out rather than considered`);
  }
  assert.equal(s.inventory.filter((i) => i.id === "potion_health").reduce((n, i) => n + i.qty, 0), before);

  // But asking permission is still asking for the thing.
  assert.equal(reads(s, "can I take the stairs down"), "descend");
  assert.equal(reads(s, "sell the health potion"), "sell");
});

test("rummaging mid-fight is refused for free rather than thrown or charged", () => {
  const g = ready();
  fighting(g);
  const r = interpret(g.state, "check the bodies");
  assert.equal(r.command, null, "searching during a fight was dispatched");
  assert.match(r.note, /nothing spent/i);
});
