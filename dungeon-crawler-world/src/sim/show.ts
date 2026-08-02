import type { GameState, Style } from "../core/types.ts";
import type { EventLog } from "../core/events.ts";
import type { Rng } from "../core/rng.ts";
import { derive } from "./character.ts";
import { CLAUSES, SPONSORS, SPONSOR_BY_ID, type FloorStats } from "../data/sponsors.ts";
import { clamp } from "../core/util.ts";

/**
 * The show.
 *
 * This is the load-bearing loop of the whole game and the thing the previous
 * design left as a number a language model typed. Here it is arithmetic:
 *
 *     spectacle  →  views  →  sponsors  →  boxes  →  power
 *                      ↘  bounty  →  hunters  →  you have a problem
 *
 * Efficiency pays badly. Killing a rat with a sword is worth almost nothing.
 * Killing it by dropping a vending machine on it, while outnumbered, at a
 * quarter health, with your hands, is worth an order of magnitude more — and
 * every point of that is also a point on the price of your head.
 *
 * There is no way to farm views safely. That is the design.
 */

const STYLE_MULTIPLIER: Record<Style, number> = {
  unarmed: 2.5,
  improvised: 1.8,
  environmental: 3.2,
  overkill: 1.4,
  outnumbered: 1.8,
  wounded: 2.0,
  punching_up: 2.5,
  chokepoint: 1.25,
  ambush: 1.4,
  ranged: 0.85, // the audience finds distance boring and says so
  finisher: 1.4,
  sparing: 1.9,
  flawless: 1.5,
  desperate: 2.2,
};

const STYLE_LABEL: Record<Style, string> = {
  unarmed: "bare hands",
  improvised: "improvised",
  environmental: "used the room",
  overkill: "excessive",
  outnumbered: "outnumbered",
  wounded: "badly hurt",
  punching_up: "punching up",
  chokepoint: "held the line",
  ambush: "never saw you",
  ranged: "at distance",
  finisher: "finished it",
  sparing: "let it live",
  flawless: "untouched",
  desperate: "desperate",
};

/** Floor 1 is not broadcast live — only highlight reels, at a twentieth of
 *  the rate. Everything after it is on air. */
export function broadcastMultiplier(floor: number): number {
  return floor === 1 ? 0.05 : 1 + (floor - 2) * 0.15;
}

export interface Spectacle {
  views: number;
  reasons: string[];
}

export function scoreKill(
  state: GameState,
  victimLevel: number,
  styles: readonly Style[],
): Spectacle {
  let views = 40 + victimLevel * 28;
  const reasons: string[] = [];
  const seen = new Set<Style>();
  for (const s of styles) {
    if (seen.has(s)) continue;
    seen.add(s);
    views *= STYLE_MULTIPLIER[s] ?? 1;
    reasons.push(STYLE_LABEL[s] ?? s);
  }
  views *= derive(state).spectacle;
  views *= broadcastMultiplier(state.floor.n);
  return { views: Math.round(views), reasons };
}

export function scoreEvent(state: GameState, base: number, reason: string): Spectacle {
  return {
    views: Math.round(base * derive(state).spectacle * broadcastMultiplier(state.floor.n)),
    reasons: [reason],
  };
}

export function applyViews(state: GameState, log: EventLog, spec: Spectacle): void {
  if (spec.views <= 0) return;
  const r = state.ratings;
  r.views += spec.views;
  r.peak = Math.max(r.peak, spec.views);
  r.followers = Math.round(r.views * 0.012);
  r.favourites = Math.round(r.views * 0.0025);

  // The shape of the audience, not just its size. Forty is enough to draw and
  // short enough that it never becomes a thing in the save file worth thinking
  // about.
  (r.recent ??= []).push(spec.views);
  while (r.recent.length > 40) r.recent.shift();
  r.lastSpikeAt = state.elapsed;

  const before = state.crawler.bounty;
  // Fame is a debt. The square root keeps it from running away, and the
  // multiplier keeps it from ever being free.
  state.crawler.bounty = Math.round(Math.sqrt(r.views) * 11);

  log.push({
    kind: "views",
    channel: "show",
    amount: spec.views,
    total: r.views,
    because: spec.reasons,
  });
  if (state.crawler.bounty - before >= 25) {
    log.push({
      kind: "bounty",
      channel: "show",
      value: state.crawler.bounty,
      delta: state.crawler.bounty - before,
    });
  }
}

/* ------------------------------------------------------------- sponsors */

export function considerSponsorOffer(state: GameState, rng: Rng, log: EventLog): void {
  if (state.floor.n < 2) return; // nobody is buying on a floor nobody is watching
  if (state.sponsors.length >= 3) return;
  if (state.offers.length >= 1) return;
  if (state.ratings.views < 4000) return;
  if (!rng.chance(0.22)) return;

  const taken = new Set([...state.sponsors.map((s) => s.id), ...state.offers.map((o) => o.sponsor)]);
  const eligible = SPONSORS.filter((s) => !taken.has(s.id) && s.wants(state.counters));
  if (!eligible.length) return;

  const s = rng.pick(eligible);
  const clause = CLAUSES[s.clause];
  state.offers.push({
    sponsor: s.id,
    terms: s.pitch,
    clause: clause.text,
    gives: `${s.gives.tier} ${s.gives.box} box on signing, and again every floor you keep to it`,
    expires: state.elapsed + 12,
  });
  log.push({
    kind: "sponsor_offer",
    channel: "show",
    sponsor: s.name,
    terms: `${s.pitch} ${clause.text}`,
    gives: `${s.gives.tier} box now, and one a floor while you hold up your end`,
  });
}

export function signSponsor(state: GameState, log: EventLog, sponsorId: string): boolean {
  const offer = state.offers.find((o) => o.sponsor === sponsorId);
  const def = SPONSOR_BY_ID[sponsorId];
  if (!offer || !def) return false;
  state.offers = state.offers.filter((o) => o.sponsor !== sponsorId);
  state.sponsors.push({
    id: def.id,
    name: def.name,
    terms: def.pitch,
    clause: def.clause,
    since: state.floor.n,
    strikes: 0,
  });
  state.boxes.push({
    bid: `sponsor_${def.id}_${state.floor.n}`,
    type: def.gives.box,
    tier: def.gives.tier,
    why: `Signed with ${def.name}`,
  });
  log.push({
    kind: "sponsor",
    channel: "show",
    sponsor: def.name,
    state: "signed",
    note: "Viewers will now see advertisements on your feed, and you will now see a clause on your character sheet.",
  });
  log.push({
    kind: "box_awarded",
    channel: "loot",
    tier: def.gives.tier,
    box: def.gives.box,
    why: `Signed with ${def.name}`,
  });
  return true;
}

/**
 * Called once when a floor ends. Every clause is checked against that floor's
 * tally and nothing else — a good floor does not buy forgiveness for a bad one.
 */
export function auditSponsors(state: GameState, log: EventLog, floorStats: FloorStats): void {
  for (const s of [...state.sponsors]) {
    const def = SPONSOR_BY_ID[s.id];
    if (!def) continue;
    const clause = CLAUSES[def.clause];
    if (clause.check(floorStats)) {
      state.boxes.push({
        bid: `sponsor_${s.id}_${state.floor.n}`,
        type: def.gives.box,
        tier: def.gives.tier,
        why: `${def.name} is satisfied`,
      });
      log.push({
        kind: "box_awarded",
        channel: "loot",
        tier: def.gives.tier,
        box: def.gives.box,
        why: `${def.name} is satisfied with the floor you just turned in`,
      });
      s.strikes = 0;
    } else {
      s.strikes++;
      if (s.strikes >= 2) {
        state.sponsors = state.sponsors.filter((x) => x.id !== s.id);
        log.push({
          kind: "sponsor",
          channel: "show",
          sponsor: def.name,
          state: "dropped",
          note: "They have terminated the arrangement, publicly, with a statement that goes out of its way to name you.",
        });
      } else {
        log.push({
          kind: "sponsor",
          channel: "show",
          sponsor: def.name,
          state: "signed",
          note: `First warning. ${clause.text} One more and they walk, loudly.`,
        });
      }
    }
  }
}

/* --------------------------------------------------------------- bounty */

/**
 * Fame draws people who read numbers for a living.
 *
 * The probability is per HOUR, not per action. Rolling it per command means a
 * crawler who searches four rooms gets hunted four times, which turns the
 * game's most interesting consequence into a random tax on playing carefully.
 */
export function hunterDue(state: GameState, rng: Rng, hours: number): boolean {
  if (state.floor.n < 2) return false;
  // Nobody catches you in the first hour on a new floor. They have to find you.
  if (state.floor.hoursTotal - state.floor.hoursLeft < 2) return false;
  const b = state.crawler.bounty;
  if (b < 400) return false;
  const perHour = clamp((b - 400) / 90_000, 0.004, 0.06);
  return rng.chance(1 - Math.pow(1 - perHour, Math.max(0.05, hours)));
}

/* ----------------------------------------------------------- world feed */

const NAMES = [
  "Imani", "Elle", "Bautista", "Katia", "Louis", "Florin", "Lucia", "Yolanda", "Brandon",
  "Hamed", "Miriam", "Zhang", "Li Jun", "Tserendolgor", "Agatha", "Signet", "Firas",
  "Nguyen", "Sofía", "Okafor", "Petra", "Halvard", "Rin", "Tomás", "Aoife", "Dmitri", "Nabila",
];

/**
 * The dungeon is not about you. Every hour that passes, several million people
 * you will never meet are having the worst day of their lives somewhere else on
 * this floor, and the crawler counter is the only obituary any of them get.
 */
export function worldTick(state: GameState, rng: Rng, hours: number): string[] {
  const feed: string[] = [];
  const rate = state.floor.n <= 2 ? 1 : 0.55;
  const drop = Math.round(rng.int(80, 900) * hours * rate * (state.floor.n <= 2 ? 4 : 1));
  if (drop > 0) {
    state.world.crawlersLeft = Math.max(1200, state.world.crawlersLeft - drop);
    if (rng.chance(0.4 * hours)) {
      feed.push(`Crawler count: ${state.world.crawlersLeft.toLocaleString()} remaining.`);
    }
  }
  if (rng.chance(0.18 * hours)) {
    const pool = NAMES.filter((n) => !state.world.dead.includes(n));
    if (pool.length) {
      const who = rng.pick(pool);
      state.world.dead.push(who);
      feed.push(`Named crawler down: ${who}. The notification is four words long and the system does not elaborate.`);
    }
  }
  if (rng.chance(0.14 * hours)) {
    feed.push(`${rng.pick(NAMES)} is climbing the leaderboard and collecting a bounty for the privilege.`);
  }
  if (rng.chance(0.1 * hours) && state.floor.n >= 2) {
    feed.push(`Somebody else's channel ran a clip with you in the background. ${rng.int(4, 90)} new followers.`);
  }
  if (rng.chance(0.08 * hours)) {
    feed.push(`A party of ${rng.int(3, 9)} is moving through this floor in roughly the direction you are.`);
  }
  state.world.feed = feed;
  return feed;
}
