import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/sim/game.ts";
import type { GameState } from "../src/core/types.ts";
import { scoreKill, applyViews, auditSponsors, broadcastMultiplier } from "../src/sim/show.ts";
import { ProceduralNarrator } from "../src/voice/narrator.ts";
import { Rng } from "../src/core/rng.ts";
import { ACHIEVEMENTS } from "../src/data/achievements.ts";
import { EventLog, type GameEvent } from "../src/core/events.ts";

const newGame = (seed = 1234) =>
  Game.create(seed, {
    name: "Tess",
    job: "electrician",
    hobby: "boxing",
    body: "fit",
    mind: "high",
    people: "mid",
    dress: "work",
    carried: ["tools", "lighter"],
    companion: "cat",
  });

/* ---------------------------------------------------------- the surface */

test("a bad command costs a sentence, never the run", async () => {
  const g = newGame();
  const before = JSON.stringify(g.state);
  for (const cmd of [
    { t: "go", to: "nowhere-at-all" },
    { t: "attack", target: "the moon" },
    { t: "use", item: "a sandwich I do not have" },
    { t: "descend" },
    { t: "open" },
    { t: "spend", stat: "str" },
    { t: "select", race: "human", klass: "rogue" },
    { t: "equip", item: "nothing" },
  ] as const) {
    const r = await g.execute(cmd);
    assert.ok(g.state.crawler.alive, `${cmd.t} killed the crawler`);
    assert.ok(r.lines.length > 0, `${cmd.t} produced no feedback at all`);
  }
  // None of those should have moved the world on.
  assert.equal(g.state.elapsed, JSON.parse(before).elapsed);
});

test("boxes only open in a safe room, and then all of them at once", async () => {
  const g = newGame(7);
  assert.ok(g.state.boxes.length > 0, "entry achievements should have paid out");
  const refused = await g.execute({ t: "open" });
  assert.ok(refused.lines.some((l) => /safe room/i.test(l.text)));
  assert.ok(g.state.boxes.length > 0, "boxes opened outside a safe room");

  // Teleport to a safe room rather than walking there; this is a rules test.
  const safe = Object.values(g.state.floor.nodes).find((n) => n.kind === "safe_room")!;
  g.state.floor.at = safe.id;
  const count = g.state.boxes.length;
  const opened = await g.execute({ t: "open" });
  assert.equal(g.state.boxes.length, 0, "some boxes survived the opening");
  assert.equal(g.state.counters.boxesOpened, count);
  assert.ok(opened.events.some((e) => e.kind === "box_opened"));
});

test("stat points only spend in a safe room", async () => {
  const g = newGame(8);
  g.state.crawler.points = 3;
  const before = g.state.crawler.stats.con;
  await g.execute({ t: "spend", stat: "con" });
  assert.equal(g.state.crawler.stats.con, before, "points were spent in the open");

  const safe = Object.values(g.state.floor.nodes).find((n) => n.kind === "safe_room")!;
  g.state.floor.at = safe.id;
  await g.execute({ t: "spend", stat: "con" });
  assert.equal(g.state.crawler.stats.con, before + 1);
  assert.equal(g.state.crawler.points, 2);
});

test("descending needs stairs, and a lair's boss standing in the way stops you", async () => {
  const g = newGame(9);
  g.state.floor.stairsAnnounced = true;
  const lair = Object.values(g.state.floor.nodes).find((n) => n.boss && n.hasStairs)!;
  g.state.floor.at = lair.id;
  const blocked = await g.execute({ t: "descend" });
  assert.equal(g.state.floor.n, 1, "walked past a living boss onto the stairs");
  assert.ok(blocked.lines.some((l) => /between you and the stairs/i.test(l.text)));

  g.state.floor.bossesKilled.push(lair.boss!);
  await g.execute({ t: "descend" });
  assert.equal(g.state.floor.n, 2);
  assert.equal(g.state.crawler.hp, g.state.crawler.hpMax, "stairwells refill health");
});

test("the floor timer is the one thing that cannot be argued with", async () => {
  const g = newGame(10);
  g.state.floor.hoursLeft = 0.4;
  await g.execute({ t: "wait", hours: 1 });
  assert.equal(g.state.crawler.alive, false);
  assert.match(g.state.crawler.death!.cause, /collapse/i);
});

test("achievements fire exactly once each", async () => {
  const g = newGame(11);
  g.state.counters.kills = 100;
  g.state.counters.bossKills = 2;
  await g.execute({ t: "look" });
  const after = g.state.achievements.length;
  await g.execute({ t: "look" });
  await g.execute({ t: "look" });
  assert.equal(g.state.achievements.length, after, "an achievement re-fired");
  const ids = g.state.achievements.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate achievement ids");
});

test("every achievement predicate is safe against a fresh state", () => {
  const g = newGame(12);
  for (const a of ACHIEVEMENTS) {
    assert.doesNotThrow(() => a.test(g.state), `${a.id} threw on a fresh crawler`);
  }
});

/* ------------------------------------------------------------ save/load */

test("save round-trips through JSON and resumes the same stream", async () => {
  const a = newGame(4242);
  for (let i = 0; i < 6; i++) {
    const node = a.state.floor.nodes[a.state.floor.at]!;
    await a.execute({ t: "go", to: node.links[0]!.to });
  }
  const saved = JSON.parse(JSON.stringify(a.save())) as GameState;
  const b = Game.load(saved);

  assert.deepEqual(b.state.crawler, a.state.crawler);
  assert.deepEqual(b.state.floor.at, a.state.floor.at);

  // And the two continue identically, which is the part that actually matters.
  const cmds = [{ t: "search" }, { t: "wait", hours: 1 }, { t: "look" }] as const;
  for (const c of cmds) {
    await a.execute(c);
    await b.execute(c);
  }
  assert.equal(JSON.stringify(a.save()), JSON.stringify(b.save()));
});

test("same seed and same commands produce the same run", async () => {
  const script = [
    { t: "search" },
    { t: "wait", hours: 2 },
    { t: "look" },
    { t: "wait", hours: 3 },
  ] as const;
  const a = newGame(31337);
  const b = newGame(31337);
  for (const c of script) {
    await a.execute(c);
    await b.execute(c);
  }
  assert.equal(JSON.stringify(a.save()), JSON.stringify(b.save()));
});

/* ---------------------------------------------------------------- show */

test("spectacle pays for style, not for efficiency", () => {
  const g = newGame(13);
  g.state.floor.n = 2; // floor one is not broadcast live
  const boring = scoreKill(g.state, 3, []).views;
  const flashy = scoreKill(g.state, 3, ["environmental", "unarmed", "outnumbered"]).views;
  assert.ok(flashy > boring * 5, `style paid ${flashy} against a plain ${boring}`);

  const distant = scoreKill(g.state, 3, ["ranged"]).views;
  assert.ok(distant < boring, "the audience should find distance boring");
});

test("floor one is not broadcast live and everything after it is", () => {
  assert.ok(broadcastMultiplier(1) < 0.1);
  assert.ok(broadcastMultiplier(2) >= 1);
  assert.ok(broadcastMultiplier(4) > broadcastMultiplier(2));
});

test("views raise the bounty, which is the cost of being watchable", () => {
  const g = newGame(14);
  const log = new EventLog(() => 0);
  applyViews(g.state, log, { views: 250_000, reasons: ["test"] });
  assert.ok(g.state.crawler.bounty > 0);
  assert.ok(g.state.ratings.followers > 0);
});

test("a sponsor clause is audited against the floor just finished, and only that floor", () => {
  const g = newGame(15);
  const log = new EventLog(() => 0);
  g.state.sponsors.push({ id: "oipan", name: "OIPAN", terms: "", clause: "spare_someone", since: 1, strikes: 0 });

  // Kept: they asked for one resolution without killing, they got one.
  auditSponsors(g.state, log, { ...blankTally(), parleys: 1 });
  assert.equal(g.state.sponsors[0]!.strikes, 0);
  assert.ok(g.state.boxes.some((b) => /satisfied/i.test(b.why)));

  // Broken twice, and they walk, loudly.
  auditSponsors(g.state, log, blankTally());
  assert.equal(g.state.sponsors[0]!.strikes, 1, "a broken clause should be a warning first");
  auditSponsors(g.state, log, blankTally());
  assert.equal(g.state.sponsors.length, 0, "two strikes and they should have terminated it");
});

function blankTally() {
  return {
    kills: 0, unarmedKills: 0, environmentalKills: 0, fled: 0, parleys: 0,
    spared: 0, npcKills: 0, damageTaken: 0, bossKills: 0, roomsCleared: 0,
  };
}

/* ------------------------------------------------------------- narrator */

test("the narrator renders every event kind without throwing", async () => {
  const g = newGame(16);
  const n = new ProceduralNarrator(Rng.fromSeed(1));
  const samples: GameEvent[] = [
    { kind: "travel", channel: "narration", at: 0, from: "a", to: "b", minutes: 10, firstVisit: true },
    { kind: "arrive", channel: "narration", at: 0, node: "somewhere", nodeKind: "chamber", description: "d" },
    { kind: "search", channel: "loot", at: 0, node: "x", found: ["a thing"], minutes: 20 },
    { kind: "search", channel: "narration", at: 0, node: "x", found: [], minutes: 20 },
    { kind: "scout", channel: "good", at: 0, node: "x", revealed: ["2 rats"], success: true, minutes: 12 },
    { kind: "encounter_start", channel: "bad", at: 0, room: "r", hostiles: [{ name: "Rat", level: 1 }], surprise: "none" },
    { kind: "attack", channel: "good", at: 0, attacker: "Tess", target: "Rat", weapon: "a pipe", byCrawler: true, hit: true, crit: false, graze: false, damage: 5, targetHp: 2, targetHpMax: 7, styles: [] },
    { kind: "attack", channel: "bad", at: 0, attacker: "Rat", target: "Tess", weapon: "teeth", byCrawler: false, hit: false, crit: false, graze: false, damage: 0, targetHp: 60, targetHpMax: 60, styles: [] },
    { kind: "kill", channel: "good", at: 0, victim: "Rat", victimLevel: 1, byCrawler: true, killer: "Tess", method: "a pipe", styles: ["environmental"] },
    { kind: "feature", channel: "good", at: 0, actor: "Tess", feature: "the bus", verb: "brings down", success: true, affected: ["Rat"], damage: 20, note: "n" },
    { kind: "combat_end", channel: "good", at: 0, outcome: "victory", rounds: 3, killed: 1 },
    { kind: "level_up", channel: "good", at: 0, level: 2, points: 3, banked: true },
    { kind: "box_awarded", channel: "loot", at: 0, tier: "Bronze", box: "Adventurer Box", why: "reasons" },
    { kind: "box_opened", channel: "loot", at: 0, tier: "Bronze", box: "Adventurer Box", items: ["rope"], gold: 4 },
    { kind: "achievement", channel: "loot", at: 0, id: "x", name: "A Thing", text: "t", box: null },
    { kind: "death", channel: "bad", at: 0, cause: "c", floor: 1, level: 3 },
    { kind: "views", channel: "show", at: 0, amount: 100, total: 100, because: ["style"] },
    { kind: "rest", channel: "good", at: 0, hours: 7, where: "a safe room" },
    { kind: "floor", channel: "good", at: 0, n: 2, name: "The Second Floor", hours: 144, note: "note" },
  ];
  const lines = await n.render(samples, g.state);
  assert.ok(lines.length >= samples.length - 4, "several events rendered to nothing");
  for (const l of lines) assert.equal(typeof l.text, "string");
});

test("the narrator attributes a miss to whoever actually swung", async () => {
  const g = newGame(17);
  const n = new ProceduralNarrator(Rng.fromSeed(2));
  const enemyMiss: GameEvent = {
    kind: "attack", channel: "good", at: 0, attacker: "Rat", target: "Tess",
    weapon: "teeth", byCrawler: false, hit: false, crit: false, graze: false,
    damage: 0, targetHp: 60, targetHpMax: 60, styles: [],
  };
  const [line] = await n.render([enemyMiss], g.state);
  // The channel says "good" because a miss against you IS good news; the
  // prose must still be about the rat swinging, not about you swinging.
  assert.match(line!.text, /Rat/, `enemy miss rendered as the player's attack: "${line!.text}"`);
});
