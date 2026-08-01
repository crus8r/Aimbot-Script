import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/sim/game.ts";
import { autoPlay } from "../tools/bot.ts";
import { Rng } from "../src/core/rng.ts";
import type { Intake } from "../src/sim/intake.ts";

/**
 * The tests that actually catch things.
 *
 * A hand-written test exercises the case you thought of. Forty complete runs
 * exercise the one on turn nine hundred where a collapsed ceiling orphaned a
 * position and the fight could never end. Both kinds are worth having; only
 * one of them found that.
 */

const PROFILES: Partial<Intake>[] = [
  { job: "electrician", hobby: "boxing", body: "fit", mind: "high", people: "mid", dress: "work", carried: ["tools"], companion: "cat" },
  { job: "accountant", hobby: "video games", body: "weak", mind: "vhigh", people: "low", dress: "bed", carried: [], companion: "none" },
  { job: "scaffolder", hobby: "powerlifting", body: "strong", mind: "low", people: "mid", dress: "casual", carried: ["weapon"], companion: "dog" },
  { job: "night nurse", hobby: "hiking", body: "average", mind: "mid", people: "high", dress: "work", carried: ["phone", "food"], companion: "person" },
  { job: "chef", hobby: "firework displays", body: "average", mind: "high", people: "mid", dress: "underdressed", carried: ["lighter"], companion: "none" },
];

test("forty complete runs finish without the simulation throwing", async () => {
  const outcomes: { floor: number; died: boolean; turns: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const seed = (900_000 + i * 7919) | 0;
    const game = Game.create(seed, { ...PROFILES[i % PROFILES.length]!, name: `C${i}` });
    // The cap has to clear a run that spends the whole backload ladder: three
    // deaths means playing the same floor four times, so a bound tight enough
    // for one life reports honest long runs as loops.
    const result = await autoPlay(game, { stopAtFloor: 5, maxTurns: 12_000 });
    outcomes.push({ floor: result.floor, died: result.died, turns: result.turns });

    assert.ok(result.turns < 12_000, `seed ${seed} hit the turn cap — something is looping`);
    // A run either ends in a body or in a descent. Nothing else is a valid stop.
    assert.ok(
      result.died || result.floor >= 5,
      `seed ${seed} stopped at floor ${result.floor} without dying`,
    );
    const s = game.state;
    assert.ok(s.elapsed > 0, `seed ${seed}: no time passed in an entire run`);
    assert.ok(Number.isFinite(s.crawler.hp), `seed ${seed}: health went non-finite`);
    assert.ok(s.crawler.hp >= 0, `seed ${seed}: negative health survived`);
    assert.equal(s.encounter, null, `seed ${seed}: a fight was left open`);
  }
  const reachedTwo = outcomes.filter((o) => o.floor >= 2).length;
  assert.ok(reachedTwo >= 8, `only ${reachedTwo}/40 crawlers cleared the tutorial floor — too punishing`);
});

test("the difficulty curve is a curve, not a cliff or a ramp", async () => {
  const reached: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const RUNS = 40;
  for (let i = 0; i < RUNS; i++) {
    const game = Game.create((550_000 + i * 5417) | 0, { ...PROFILES[i % PROFILES.length]!, name: `D${i}` });
    const r = await autoPlay(game, { stopAtFloor: 5, maxTurns: 12_000 });
    for (let f = 1; f <= 4; f++) if (r.floor >= f) reached[f]!++;
  }
  // Each floor should thin the field without wiping it. These bounds are
  // deliberately wide — they are a regression alarm, not a design target.
  assert.equal(reached[1], RUNS);
  assert.ok(reached[2]! >= RUNS * 0.2, `floor 1 killed ${RUNS - reached[2]!}/${RUNS} — far too lethal`);
  assert.ok(reached[2]! <= RUNS * 0.95, "floor 1 is not killing anybody");
  assert.ok(reached[3]! < reached[2]!, "floor 2 is not harder than floor 1");
  assert.ok(reached[4]! < reached[3]! + 1, "difficulty stopped increasing with depth");
});

test("a full run replays identically from its seed", async () => {
  const play = async () => {
    const g = Game.create(123_456, { ...PROFILES[0]!, name: "Replay" });
    await autoPlay(g, { stopAtFloor: 3, maxTurns: 800 });
    return JSON.stringify(g.save());
  };
  assert.equal(await play(), await play());
});

test("the crawler's numbers stay inside their own bounds all run", async () => {
  for (let i = 0; i < 12; i++) {
    const game = Game.create((77_000 + i * 313) | 0, { ...PROFILES[i % PROFILES.length]!, name: `B${i}` });
    await autoPlay(game, {
      stopAtFloor: 4,
      maxTurns: 1500,
      onTurn: (_cmd, _lines, s) => {
        assert.ok(s.crawler.hp <= s.crawler.hpMax + 1, `health ${s.crawler.hp} exceeded max ${s.crawler.hpMax}`);
        assert.ok(s.crawler.hp >= 0, "negative health");
        assert.ok(s.crawler.mana >= 0 && s.crawler.mana <= s.crawler.manaMax + 1, "mana out of bounds");
        assert.ok(s.crawler.fatigue >= 0 && s.crawler.fatigue <= 100, "fatigue out of bounds");
        assert.ok(s.crawler.hunger >= 0 && s.crawler.hunger <= 100, "hunger out of bounds");
        assert.ok(s.crawler.gold >= 0, "negative gold");
        assert.ok(s.floor.hoursLeft <= s.floor.hoursTotal, "the floor timer went backwards");
        for (const item of s.inventory) {
          assert.ok(item.qty > 0, `${item.name} is in the inventory at quantity ${item.qty}`);
        }
      },
    });
  }
});

test("no encounter can run forever, even in a stand-off", async () => {
  // Deliberately construct the worst case: a crawler with no reach against
  // something that will not close, in a room it cannot cross.
  const g = Game.create(4242, { ...PROFILES[1]!, name: "Standoff" });
  const node = Object.values(g.state.floor.nodes).find((n) => n.zones.length >= 3)!;
  node.spawn = [{ mob: "goblin", count: 3, level: 3 }];
  node.cleared = false;
  g.state.floor.at = node.id;
  await g.execute({ t: "engage" });

  let turns = 0;
  while (g.state.encounter && g.state.encounter.finished === null && turns < 500) {
    await g.execute({ t: "endturn" });
    turns++;
  }
  assert.ok(turns < 500, "a fight ran past five hundred turns of doing nothing");
});

test("intake actually differentiates people", () => {
  const strong = Game.create(9, { ...PROFILES[2]!, name: "S" }).state;
  const frail = Game.create(9, { ...PROFILES[1]!, name: "F" }).state;
  assert.ok(strong.crawler.stats.str > frail.crawler.stats.str, "the scaffolder is not stronger than the accountant");
  assert.ok(frail.crawler.stats.int > strong.crawler.stats.int, "the accountant is not cleverer than the scaffolder");
  assert.ok(strong.crawler.hpMax > frail.crawler.hpMax);
  // And the answers reach the skill sheet, not just the stat block.
  assert.ok(Object.keys(strong.skills).length >= 2);
});

test("a hundred generated floors all hold together", () => {
  const rng = Rng.fromSeed(1);
  for (let i = 0; i < 100; i++) {
    const g = Game.create(rng.int(1, 2 ** 30), {});
    const floor = g.state.floor;
    for (const node of Object.values(floor.nodes)) {
      assert.ok(node.zones.length >= 2, `${node.name} has fewer than two positions`);
      assert.ok(node.entry && node.zones.some((z) => z.id === node.entry), `${node.name} has no valid entry`);
      for (const z of node.zones) {
        assert.ok(z.capacity >= 1, `${z.name} admits nobody`);
        for (const link of z.links) {
          assert.ok(node.zones.some((o) => o.id === link), `${z.name} links to a position that does not exist`);
        }
      }
    }
  }
});
