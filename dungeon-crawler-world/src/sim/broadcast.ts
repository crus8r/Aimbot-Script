import type { GameState } from "../core/types.ts";
import { SPONSOR_BY_ID } from "../data/sponsors.ts";

/**
 * The audience, as a thing you can feel rather than a number in a menu.
 *
 * The engine has always tracked views, followers, favourites, a peak and a
 * bounty, and the client showed two of them as table rows in a sheet nobody
 * opens — in a game whose entire premise is that you are broadcast live to
 * trillions. That is the setting's thesis going unexpressed.
 *
 * The important distinction this file draws, which the raw state does not:
 *
 *   VIEWS is cumulative. It only ever goes up, which makes it a scoreboard.
 *   WATCHING is how many are on you RIGHT NOW, and it moves — it surges when
 *   you do something worth watching and drains while you pick through a
 *   cupboard. That is what being broadcast actually feels like, and it is the
 *   number that belongs on screen.
 *
 * Everything here is DERIVED from state that already exists. Nothing is stored,
 * so nothing can desync, and a save from before this file works unchanged.
 */

/* ------------------------------------------------------------- audience */

/**
 * How many are watching this second.
 *
 * Two components, because attention has two parts. Your followers are a floor —
 * people who chose you and leave you on in the background. The surge on top is
 * whatever you just did, and it decays over about two hours of doing nothing,
 * which is roughly how long the audience will forgive you for inventory
 * management.
 */
export function watching(state: GameState): number {
  const r = state.ratings;
  const floor = Math.round(r.followers * 0.45);
  const spikes = r.recent ?? [];
  if (!spikes.length) return floor;

  // The last few spikes, weighted toward the newest.
  const tail = spikes.slice(-6);
  const surge = tail.reduce((n, v, i) => n + v * (i + 1), 0) / ((tail.length * (tail.length + 1)) / 2);

  const idle = Math.max(0, state.elapsed - (r.lastSpikeAt ?? state.elapsed));
  const decay = Math.exp(-idle / 2);
  return Math.max(floor, Math.round(floor + surge * decay));
}

/** Rising, holding or draining — the arrow next to the number. */
export function audienceTrend(state: GameState): "surging" | "rising" | "steady" | "draining" {
  const spikes = state.ratings.recent ?? [];
  if (spikes.length < 4) return "steady";
  const idle = Math.max(0, state.elapsed - (state.ratings.lastSpikeAt ?? state.elapsed));
  if (idle > 1.5) return "draining";
  const recent = spikes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const before = spikes.slice(-9, -3);
  const prior = before.length ? before.reduce((a, b) => a + b, 0) / before.length : recent;
  if (recent > prior * 2.2) return "surging";
  if (recent > prior * 1.1) return "rising";
  return "steady";
}

/**
 * Big numbers, the way a broadcast would write them.
 *
 * Never more than three significant figures — "11.4M" is a fact a person can
 * hold and "11,447,208" is a fact they have to parse.
 */
export function audienceShort(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/* --------------------------------------------------------------- danger */

/**
 * What your bounty has actually bought you.
 *
 * Fame is a debt in this game — the bounty is what makes other crawlers come
 * looking — so it wants a label rather than a raw integer, because "4,200" does
 * not tell anybody whether to be frightened.
 */
export function bountyBand(state: GameState): { label: string; heat: 0 | 1 | 2 | 3 | 4 } {
  const b = state.crawler.bounty;
  if (b < 250) return { label: "beneath notice", heat: 0 };
  if (b < 1200) return { label: "worth a detour", heat: 1 };
  if (b < 4000) return { label: "worth a plan", heat: 2 };
  if (b < 12_000) return { label: "worth a team", heat: 3 };
  return { label: "worth the whole floor", heat: 4 };
}

/* ------------------------------------------------------------- the view */

export interface BroadcastView {
  live: boolean;
  /** Why not, when it is not. Floor one is highlights only, which is canon. */
  liveNote: string;
  watching: number;
  watchingLabel: string;
  trend: "surging" | "rising" | "steady" | "draining";
  views: number;
  viewsLabel: string;
  followers: number;
  followersLabel: string;
  favourites: number;
  peak: number;
  peakLabel: string;
  /** Views drawn since this floor opened. A floor is scored on its own. */
  thisFloor: number;
  thisFloorLabel: string;
  bounty: number;
  bountyLabel: string;
  heat: 0 | 1 | 2 | 3 | 4;
  /** Normalised 0..1 spikes, oldest first, for a sparkline. */
  spark: number[];
  sponsors: { name: string; clause: string; strikes: number }[];
  /** Crawlers left alive, which only ever falls. */
  crawlersLeft: number;
}

export function broadcastView(state: GameState): BroadcastView {
  const r = state.ratings;
  const now = watching(state);
  const band = bountyBand(state);
  const spikes = r.recent ?? [];
  const top = Math.max(1, ...spikes);

  return {
    // Floor one is highlight reels only. That is the one mercy the format
    // offers and it should be visible, because losing it on floor two is a
    // moment.
    live: state.floor.n >= 2,
    liveNote: state.floor.n >= 2 ? "" : "Highlights only. Nobody is watching this live, which is the only mercy on offer.",
    watching: now,
    watchingLabel: audienceShort(now),
    trend: audienceTrend(state),
    views: r.views,
    viewsLabel: audienceShort(r.views),
    followers: r.followers,
    followersLabel: audienceShort(r.followers),
    favourites: r.favourites,
    peak: r.peak,
    peakLabel: audienceShort(r.peak),
    thisFloor: Math.max(0, r.views - (r.floorStart ?? 0)),
    thisFloorLabel: audienceShort(Math.max(0, r.views - (r.floorStart ?? 0))),
    bounty: state.crawler.bounty,
    bountyLabel: band.label,
    heat: band.heat,
    spark: spikes.map((v) => Math.min(1, v / top)),
    sponsors: state.sponsors.map((s) => ({
      name: s.name,
      clause: SPONSOR_BY_ID[s.id]?.clause ?? s.clause,
      strikes: s.strikes,
    })),
    crawlersLeft: state.world.crawlersLeft,
  };
}

/* ------------------------------------------------------------ the record */

export interface RecordLine {
  label: string;
  value: string;
  /** Set when the number is worth remarking on rather than merely true. */
  note?: string;
}

/**
 * Sixteen counters are tracked and none of them have ever been shown.
 *
 * Grouped by what they say about the person rather than by where they live in
 * the struct — how they fight, what they survived, and what they did that
 * nobody had to.
 */
export function runRecord(state: GameState): { group: string; lines: RecordLine[] }[] {
  const c = state.counters;
  const n = (x: number) => x.toLocaleString();

  return [
    {
      group: "how you fight",
      lines: [
        { label: "Kills", value: n(c.kills) },
        { label: "Bosses", value: n(c.bossKills), note: c.bossKills >= 2 ? "The system considers this unusual." : undefined },
        { label: "With your hands", value: n(c.unarmedKills), note: c.unarmedKills >= 4 ? "The audience has a documented appetite for this." : undefined },
        { label: "With the room", value: n(c.environmentalKills), note: c.environmentalKills >= 3 ? "Killed by architecture." : undefined },
        { label: "Above your weight", value: n(c.punchingUpKills) },
        { label: "Traps set", value: n(c.trapsSet) },
      ],
    },
    {
      group: "what you survived",
      lines: [
        { label: "Damage dealt", value: n(c.damageDealt) },
        { label: "Damage taken", value: n(c.damageTaken) },
        {
          label: "Nearly died",
          value: n(c.nearDeaths),
          note: c.nearDeaths >= 3 ? "Three times upright at zero. That is a habit, not luck." : undefined,
        },
        { label: "Walked away", value: n(c.fled), note: c.fled === 0 && c.kills > 20 ? "Never once. Noted." : undefined },
        { label: "Rooms cleared", value: n(c.roomsCleared) },
      ],
    },
    {
      group: "what nobody made you do",
      lines: [
        { label: "Talked down", value: n(c.parleys) },
        { label: "Spared", value: n(c.spared), note: c.spared > 0 ? "The audience did not enjoy it. It is on the record anyway." : undefined },
        { label: "Crawlers met", value: n(c.crawlersMet) },
        { label: "People killed", value: n(c.npcKills), note: c.npcKills > 0 ? "They had names and the system kept them." : undefined },
        { label: "Boxes opened", value: n(c.boxesOpened) },
      ],
    },
  ];
}
