/**
 * The event stream is the spine of the whole build.
 *
 * Nothing in this game "narrates and then applies effects". The simulation
 * resolves, emits a fact, and every other system is a reader: the System AI's
 * voice, the achievement triggers, the ratings engine, the UI, and — if you
 * turned it on — the language model. None of them can write back.
 *
 * That inversion is the entire reason this build has no effect validator, no
 * tier authoriser and no appeals process. There is nothing to police.
 */

export type EventChannel =
  | "narration" // prose describing the world
  | "system" // the dungeon's own voice, snide, in a box
  | "good"
  | "bad"
  | "loot"
  | "show"; // ratings, sponsors, the audience

export interface BaseEvent {
  kind: string;
  channel: EventChannel;
  /** Elapsed hours on the run clock when this happened. */
  at: number;
}

export type Style =
  | "unarmed"
  | "improvised"
  | "environmental"
  | "overkill"
  | "outnumbered"
  | "wounded"
  | "punching_up"
  | "chokepoint"
  | "ambush"
  | "ranged"
  | "finisher"
  | "sparing"
  | "flawless"
  | "desperate";

export type GameEvent =
  // ---- movement and place
  | (BaseEvent & { kind: "travel"; from: string; to: string; minutes: number; firstVisit: boolean })
  | (BaseEvent & { kind: "arrive"; node: string; nodeKind: string; description: string })
  | (BaseEvent & { kind: "search"; node: string; found: string[]; minutes: number })
  | (BaseEvent & { kind: "scout"; node: string; revealed: string[]; success: boolean; minutes: number })
  // ---- combat
  | (BaseEvent & {
      kind: "encounter_start";
      room: string;
      hostiles: { name: string; level: number }[];
      surprise: "none" | "crawler" | "hostiles";
    })
  | (BaseEvent & { kind: "round"; n: number })
  | (BaseEvent & {
      kind: "attack";
      attacker: string;
      target: string;
      weapon: string;
      /** Who swung. Explicit, because inferring it from the channel or from a
       *  name comparison gets enemy misses attributed to the player. */
      byCrawler: boolean;
      hit: boolean;
      crit: boolean;
      graze: boolean;
      damage: number;
      targetHp: number;
      targetHpMax: number;
      styles: Style[];
    })
  | (BaseEvent & { kind: "miss_reason"; attacker: string; reason: string })
  | (BaseEvent & {
      kind: "kill";
      victim: string;
      victimLevel: number;
      byCrawler: boolean;
      killer: string;
      method: string;
      styles: Style[];
    })
  | (BaseEvent & { kind: "reposition"; who: string; from: string; to: string; disengaged: boolean })
  | (BaseEvent & {
      kind: "feature";
      actor: string;
      feature: string;
      verb: string;
      success: boolean;
      affected: string[];
      damage: number;
      note: string;
    })
  | (BaseEvent & { kind: "status"; who: string; status: string; applied: boolean; note: string })
  | (BaseEvent & { kind: "flee"; who: string; success: boolean; note: string })
  | (BaseEvent & {
      kind: "combat_end";
      outcome: "victory" | "fled" | "defeat" | "parley";
      rounds: number;
      killed: number;
    })
  | (BaseEvent & { kind: "parley"; with: string; success: boolean; terms: string })
  // ---- preparation
  | (BaseEvent & { kind: "prep"; what: string; zone: string; minutes: number; note: string })
  | (BaseEvent & { kind: "trap_sprung"; victim: string; trap: string; damage: number })
  // ---- taking the place apart
  | (BaseEvent & {
      kind: "harvest";
      material: string;
      units: number;
      zone: string;
      minutes: number;
      /** How the position is holding up now. */
      strain: "sound" | "working" | "sagging" | "critical" | "down";
      note: string;
    })
  | (BaseEvent & {
      kind: "mint";
      name: string;
      family: string;
      /** Derived by the engine. The proposer never wrote this number. */
      power: number;
      vital: boolean;
      from: string[];
      minutes: number;
      /** How the power was arrived at, term by term. A minted device that
       *  cannot be audited is a minted device nobody should trust. */
      working: string;
      because: string;
    })
  | (BaseEvent & {
      kind: "transform";
      rule: string;
      input: string;
      product: string;
      /** Zero when the batch was ruined, which costs the materials either way. */
      units: number;
      minutes: number;
      worked: boolean;
      /** Why it works, in plain terms. Shown; never parsed. */
      because: string;
    })
  | (BaseEvent & {
      kind: "collapse";
      zone: string;
      /** Everyone the ceiling found, including the crawler. */
      hurt: { who: string; amount: number; killed: boolean }[];
      /** Deliberate or an accident. Both happen; only one is a plan. */
      caused: "harvest" | "charge" | "feature";
      note: string;
    })
  // ---- progression
  | (BaseEvent & { kind: "xp"; amount: number; total: number })
  | (BaseEvent & { kind: "level_up"; level: number; points: number; banked: boolean })
  | (BaseEvent & { kind: "skill_up"; skill: string; level: number; note: string })
  | (BaseEvent & { kind: "stat_spent"; stat: string; value: number })
  | (BaseEvent & { kind: "select"; race: string; klass: string; points: number })
  // ---- things
  | (BaseEvent & { kind: "gold"; amount: number; total: number; reason: string })
  | (BaseEvent & { kind: "loot"; items: string[]; from: string })
  | (BaseEvent & { kind: "box_awarded"; tier: string; box: string; why: string })
  | (BaseEvent & { kind: "box_opened"; tier: string; box: string; items: string[]; gold: number })
  | (BaseEvent & { kind: "equip"; item: string; slot: string; removed: string | null })
  | (BaseEvent & { kind: "use_item"; item: string; effect: string })
  | (BaseEvent & { kind: "craft"; item: string; from: string[]; minutes: number })
  | (BaseEvent & { kind: "trade"; verb: "buy" | "sell"; item: string; gold: number; vendor: string })
  // ---- the clock and the body
  | (BaseEvent & { kind: "time"; hours: number; reason: string; remaining: number })
  | (BaseEvent & { kind: "rest"; hours: number; where: string })
  | (BaseEvent & { kind: "body"; what: "exhausted" | "starving" | "fed" | "rested"; note: string })
  | (BaseEvent & { kind: "heal"; amount: number; hp: number; source: string })
  // ---- the show
  | (BaseEvent & {
      kind: "views";
      amount: number;
      total: number;
      because: string[];
      /** The composed style multiplier the resolver actually applied. */
      multiplier: number;
      /**
       * What the audience was paying for.
       *
       * Load-bearing, and not obvious: the kill log is drained at END OF
       * COMBAT, so the event stream reads `kill, kill, attack, kill,
       * combat_end, views, views, views`. Anything that attributes a views
       * spike to the line before it credits every one of them to "Clear. 3
       * rounds, 2 down." — which looks plausible enough to ship and is wrong.
       */
      victim?: string;
    })
  | (BaseEvent & { kind: "bounty"; value: number; delta: number })
  | (BaseEvent & { kind: "sponsor_offer"; sponsor: string; terms: string; gives: string })
  | (BaseEvent & { kind: "sponsor"; sponsor: string; state: "signed" | "dropped"; note: string })
  | (BaseEvent & { kind: "achievement"; id: string; name: string; text: string; box: string | null })
  | (BaseEvent & { kind: "feed"; text: string })
  | (BaseEvent & { kind: "hunter"; name: string; level: number; note: string })
  // ---- structure
  | (BaseEvent & { kind: "floor"; n: number; name: string; hours: number; note: string })
  | (BaseEvent & { kind: "stairs"; found: boolean; node: string })
  | (BaseEvent & { kind: "death"; cause: string; floor: number; level: number })
  | (BaseEvent & { kind: "companion"; who: string; what: string; note: string })
  | (BaseEvent & { kind: "system"; text: string })
  /**
   * Somebody looked at something and the dungeon answered.
   *
   * Deliberately not an `arrive` — that one prefixes the room name and reads as
   * walking back in, and it is the event both clients fire at boot. Looking at
   * the pillar you are standing next to is a different act from entering.
   */
  | (BaseEvent & {
      kind: "perceive";
      subject: string;
      scope: "room" | "zone" | "feature" | "item" | "target" | "self";
      facts: string[];
    })
  | (BaseEvent & { kind: "prose"; text: string });

export type EventKind = GameEvent["kind"];

/**
 * An event as a caller writes it — the clock is stamped on by the log.
 *
 * Distributive on purpose. A plain `Omit<GameEvent, "at">` collapses the union
 * down to the keys every variant shares, which is `kind` and `channel` and
 * nothing else, and then quietly rejects every real event in the codebase.
 */
export type Unstamped<T> = T extends unknown ? Omit<T, "at"> : never;

/** Collects a turn's worth of events. Systems push; nobody reads mid-turn. */
export class EventLog {
  private events: GameEvent[] = [];
  private clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  push(e: Unstamped<GameEvent>): void {
    this.events.push({ ...e, at: this.clock() } as GameEvent);
  }

  say(text: string): void {
    this.push({ kind: "system", channel: "system", text });
  }

  prose(text: string): void {
    this.push({ kind: "prose", channel: "narration", text });
  }

  drain(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  peek(): readonly GameEvent[] {
    return this.events;
  }
}

export function eventsOf<K extends EventKind>(
  events: readonly GameEvent[],
  kind: K,
): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e) => e.kind === kind) as Extract<GameEvent, { kind: K }>[];
}
