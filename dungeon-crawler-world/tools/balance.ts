import { Game } from "../src/sim/game.ts";
import { autoPlay, type BotResult } from "./bot.ts";
import { Rng } from "../src/core/rng.ts";

/**
 * Balance harness.
 *
 * `npm run sim -- --runs 200 --floors 3`
 *
 * Plays N complete runs with a competent policy and reports what actually
 * happened. Tuning a damage formula by reading it is guesswork; tuning it by
 * watching two hundred crawlers die is engineering. Every run is seeded, so
 * any outlier here is reproducible with `npm run play -- --seed <n>`.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const RUNS = flag("runs", 120);
const STOP_FLOOR = flag("floors", 4);
const BASE_SEED = flag("seed", 20260731);

const JOBS = [
  ["electrician", "boxing", "fit"],
  ["night nurse", "reading", "average"],
  ["scaffolder", "powerlifting", "strong"],
  ["accountant", "video games", "weak"],
  ["chef", "hiking", "average"],
  ["software developer", "rock climbing", "fit"],
  ["bartender", "guitar", "average"],
  ["nothing, currently", "nothing in particular", "weak"],
] as const;

const results: BotResult[] = [];
const seedRng = Rng.fromSeed(BASE_SEED);

const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  const profile = JOBS[i % JOBS.length]!;
  const seed = (BASE_SEED + i * 7919) | 0;
  const game = Game.create(seed, {
    name: `Crawler ${i}`,
    job: profile[0],
    hobby: profile[1],
    body: profile[2] as "weak" | "average" | "fit" | "strong",
    mind: seedRng.pick(["low", "mid", "high", "vhigh"]),
    people: seedRng.pick(["low", "mid", "high"]),
    dress: seedRng.pick(["underdressed", "bed", "casual", "work"]),
    carried: seedRng.sample(["phone", "keys", "lighter", "food", "tools", "weapon"], seedRng.int(0, 4)),
    companion: seedRng.pick(["none", "cat", "dog", "person"]),
  });
  results.push(await autoPlay(game, { stopAtFloor: STOP_FLOOR, maxTurns: 4000 }));
  if ((i + 1) % 20 === 0) process.stderr.write(`  ${i + 1}/${RUNS}\n`);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

/* ----------------------------------------------------------- reporting */

const pct = (n: number) => `${((n / RUNS) * 100).toFixed(0)}%`;
const avg = (f: (r: BotResult) => number) => (results.reduce((s, r) => s + f(r), 0) / RUNS).toFixed(1);
const median = (f: (r: BotResult) => number) => {
  const xs = results.map(f).sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)]!.toFixed(1);
};

const died = results.filter((r) => r.died);
const reached = (n: number) => results.filter((r) => r.floor >= n).length;

console.log(`\n  ${RUNS} runs, stopping at floor ${STOP_FLOOR}, in ${elapsed}s\n`);

console.log("  SURVIVAL");
console.log(`    died                ${died.length}  (${pct(died.length)})`);
for (let f = 1; f <= STOP_FLOOR; f++) {
  console.log(`    reached floor ${f}     ${reached(f)}  (${pct(reached(f))})`);
}

console.log("\n  WHERE IT ENDED");
const causes = new Map<string, number>();
for (const r of died) {
  const key = r.cause.split(".")[0]!.slice(0, 58);
  causes.set(key, (causes.get(key) ?? 0) + 1);
}
for (const [cause, n] of [...causes].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${String(n).padStart(3)}  ${cause}`);
}

console.log("\n  PROGRESSION            mean    median");
const row = (label: string, f: (r: BotResult) => number) =>
  console.log(`    ${label.padEnd(20)} ${avg(f).padStart(6)}  ${median(f).padStart(6)}`);
row("level", (r) => r.level);
row("best skill", (r) => r.topSkill);
row("hours elapsed", (r) => r.hours);
row("kills", (r) => r.kills);
row("boss kills", (r) => r.bossKills);
row("rooms cleared", (r) => r.roomsCleared);
row("times fled", (r) => r.fled);
row("boxes opened", (r) => r.boxesOpened);
row("achievements", (r) => r.achievements);
row("gold", (r) => r.gold);
row("views (thousands)", (r) => r.views / 1000);
row("turns taken", (r) => r.turns);

console.log("\n  SANITY");
const noKills = results.filter((r) => r.kills === 0).length;
const neverFought = results.filter((r) => r.roomsCleared === 0).length;
const stalled = results.filter((r) => r.turns >= 3999).length;
console.log(`    runs with zero kills        ${noKills}  ${noKills > RUNS * 0.1 ? "<-- combat is not happening" : "ok"}`);
console.log(`    runs that cleared nothing   ${neverFought}  ${neverFought > RUNS * 0.1 ? "<-- exploration is stuck" : "ok"}`);
console.log(`    runs that hit the turn cap  ${stalled}  ${stalled > 0 ? "<-- policy is looping" : "ok"}`);
console.log("");
