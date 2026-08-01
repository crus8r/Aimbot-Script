import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, derived, hashString } from "../src/core/rng.ts";
import { article, bar, clamp, commaList, plural } from "../src/core/util.ts";
import { EventLog } from "../src/core/events.ts";

test("rng: same seed, same stream", () => {
  const a = Rng.fromSeed(1234);
  const b = Rng.fromSeed(1234);
  const xs = Array.from({ length: 200 }, () => a.next());
  const ys = Array.from({ length: 200 }, () => b.next());
  assert.deepEqual(xs, ys);
});

test("rng: different seeds diverge, including adjacent ones", () => {
  // Low-entropy seeds are the ones that expose a weak scramble, so check the
  // pathological case rather than a comfortable one.
  for (const [x, y] of [[1, 2], [0, 1], [100, 101]]) {
    const a = Rng.fromSeed(x).next();
    const b = Rng.fromSeed(y).next();
    assert.notEqual(a, b, `seeds ${x} and ${y} produced the same first value`);
  }
});

test("rng: save and restore resumes mid-stream exactly", () => {
  const a = Rng.fromSeed(99);
  for (let i = 0; i < 37; i++) a.next();
  const snapshot = a.save();
  const rest = Array.from({ length: 20 }, () => a.next());
  const b = new Rng(snapshot);
  assert.deepEqual(Array.from({ length: 20 }, () => b.next()), rest);
});

test("rng: d(sides) is a method and not shadowed by internal state", () => {
  // Regression. The sfc32 reference implementation names its state words
  // a/b/c/d; an instance field `d` silently shadows the `d(sides)` prototype
  // method, and every dice roll in the game throws at runtime.
  const r = Rng.fromSeed(7);
  assert.equal(typeof r.d, "function");
  for (let i = 0; i < 500; i++) {
    const v = r.d(20);
    assert.ok(v >= 1 && v <= 20, `d20 produced ${v}`);
  }
});

test("rng: int is inclusive at both ends and covers the range", () => {
  const r = Rng.fromSeed(11);
  const seen = new Set<number>();
  for (let i = 0; i < 3000; i++) {
    const v = r.int(1, 6);
    assert.ok(v >= 1 && v <= 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});

test("rng: dice notation", () => {
  const r = Rng.fromSeed(3);
  for (let i = 0; i < 400; i++) {
    assert.ok(r.roll("1d6") >= 1 && r.roll("1d6") <= 6);
    const v = r.roll("2d6+3");
    assert.ok(v >= 5 && v <= 15, `2d6+3 produced ${v}`);
    const neg = r.roll("1d4-1");
    assert.ok(neg >= 0 && neg <= 3);
  }
  assert.throws(() => r.roll("banana"));
});

test("rng: weighted respects zero weights absolutely", () => {
  const r = Rng.fromSeed(5);
  for (let i = 0; i < 500; i++) {
    const v = r.weighted([
      ["yes", 1],
      ["never", 0],
    ] as const);
    assert.equal(v, "yes");
  }
});

test("rng: sample returns distinct entries and never over-draws", () => {
  const r = Rng.fromSeed(21);
  const pool = ["a", "b", "c", "d"];
  const got = r.sample(pool, 10);
  assert.equal(got.length, 4);
  assert.equal(new Set(got).size, 4);
});

test("derived streams are stable and independent of call order", () => {
  const first = derived(42, "floor:3").next();
  const scratch = derived(42, "floor:1");
  for (let i = 0; i < 500; i++) scratch.next();
  const second = derived(42, "floor:3").next();
  assert.equal(first, second);
});

test("hashString is stable and order-sensitive", () => {
  assert.equal(hashString("floor:1"), hashString("floor:1"));
  assert.notEqual(hashString("floor:1"), hashString("floor:2"));
  assert.notEqual(hashString("ab"), hashString("ba"));
});

test("util: clamp, article, plural, commaList, bar", () => {
  assert.equal(clamp(5, 1, 3), 3);
  assert.equal(clamp(-5, 1, 3), 1);
  assert.equal(article("ogre"), "an ogre");
  assert.equal(article("rat"), "a rat");
  assert.equal(plural(1, "rat"), "rat");
  assert.equal(plural(2, "rat"), "rats");
  assert.equal(commaList(["a"]), "a");
  assert.equal(commaList(["a", "b"]), "a and b");
  assert.equal(commaList(["a", "b", "c"]), "a, b and c");
  assert.equal(bar(5, 10, 10), "█████░░░░░");
  assert.equal(bar(0, 0, 4), "░░░░");
});

test("event log stamps the clock and drains once", () => {
  let now = 0;
  const log = new EventLog(() => now);
  log.say("first");
  now = 2.5;
  log.say("second");
  const drained = log.drain();
  assert.equal(drained.length, 2);
  assert.equal(drained[0]!.at, 0);
  assert.equal(drained[1]!.at, 2.5);
  assert.equal(log.drain().length, 0);
});
