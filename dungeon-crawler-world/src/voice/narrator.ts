import type { EventChannel, GameEvent } from "../core/events.ts";
import type { GameState } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import * as L from "./lines.ts";
import { Voice } from "./lines.ts";
import { commaList, hours as fmtHours } from "../core/util.ts";

export interface RenderedLine {
  channel: EventChannel;
  text: string;
}

export interface Narrator {
  render(events: readonly GameEvent[], state: GameState): Promise<RenderedLine[]>;
  readonly name: string;
}

/**
 * Turns resolved facts into prose. It receives events that have already
 * happened and cannot change any of them — the worst thing a bug in here can
 * do is describe a fight badly, which is a categorically different class of
 * problem from describing a fight that did not occur.
 */
export class ProceduralNarrator implements Narrator {
  readonly name = "procedural";
  private voice: Voice;
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
    this.voice = new Voice(rng);
  }

  async render(events: readonly GameEvent[], state: GameState): Promise<RenderedLine[]> {
    const out: RenderedLine[] = [];
    for (const e of events) {
      const line = this.one(e, state);
      if (line) out.push(...(Array.isArray(line) ? line : [{ channel: e.channel, text: line }]));
    }
    return out;
  }

  private one(e: GameEvent, state: GameState): string | RenderedLine[] | null {
    const v = this.voice;
    switch (e.kind) {
      case "prose":
      case "system":
        return e.text;

      case "perceive":
        // Already assembled as facts by the resolver, because what is true
        // about a room is not the narrator's to invent.
        return e.facts.length
          ? `${e.subject}: ${e.facts.join(" ")}`
          : `${e.subject}. Nothing about it you can tell from here.`;

      case "travel":
        return `You move on. ${fmtHours(e.minutes / 60)} of picking through what used to be a street.`;

      case "arrive":
        return `${cap(e.node)}. ${e.description}`;

      case "search":
        return e.found.length
          ? `${v.say(L.SEARCH_FOUND)} ${commaList(e.found)}.`
          : v.say(L.SEARCH_NOTHING);

      case "scout":
        return e.success
          ? `You take your time at the threshold. ${e.revealed.length ? commaList(e.revealed) + " — and now you know before you commit." : "Nothing in there."}`
          : "You look, and you learn very little, and something in there may have looked back.";

      case "encounter_start": {
        const names = summarise(e.hostiles.map((h) => h.name));
        const lead =
          e.surprise === "crawler"
            ? "They have not seen you. That is worth more than any weapon you own."
            : e.surprise === "hostiles"
              ? "It was waiting, and it moves first."
              : v.say(L.ARRIVE_HOSTILE);
        return `${lead} ${cap(names)}.`;
      }

      case "round":
        return null; // the interface shows the round; the prose should not narrate a clock

      case "attack": {
        const part = this.rng.pick(L.BODY_PARTS);
        const ctx = {
          attacker: e.attacker,
          target: e.target,
          weapon: cap(e.weapon),
          damage: e.damage,
          part,
        };
        const mine = e.byCrawler;
        const atMe = e.target === state.crawler.name;
        if (!e.hit) {
          if (mine) return v.say(L.MISS, ctx, "miss");
          return atMe ? v.say(L.ENEMY_MISS, ctx, "emiss") : v.say(L.THIRD_MISS, ctx, "3miss");
        }
        if (!mine) {
          return atMe ? v.say(L.TAKE_HIT, ctx, "takehit") : v.say(L.THIRD_HIT, ctx, "3hit");
        }
        if (e.crit) return v.say(L.HIT_CRIT, ctx, "crit");
        const heavy = e.damage >= Math.max(6, e.targetHpMax * 0.2);
        return v.say(heavy ? L.HIT_SOLID : L.HIT_LIGHT, ctx, heavy ? "solid" : "light");
      }

      case "miss_reason":
        return e.reason;

      case "kill": {
        const ctx = { victim: e.victim, killer: e.killer };
        if (!e.byCrawler) return `${e.victim} is down.`;
        if (e.styles.includes("environmental")) return v.say(L.KILL_ENVIRONMENTAL, ctx, "kenv");
        if (e.styles.includes("unarmed")) return v.say(L.KILL_UNARMED, ctx, "kunarmed");
        if (e.styles.includes("punching_up")) return v.say(L.KILL_PUNCHING_UP, ctx, "kup");
        return v.say(L.KILL, ctx, "kill");
      }

      case "reposition":
        return e.disengaged
          ? `${e.who} breaks off and moves to ${e.to}. Turning your back is never free.`
          : `${e.who} moves to ${e.to}.`;

      case "feature": {
        if (!e.success) return `You go at ${e.feature} and it does not move. ${e.note}`;
        const who = e.affected.length ? ` ${commaList(e.affected)} ${e.affected.length === 1 ? "is" : "are"} underneath it.` : "";
        return `You ${e.verb} ${e.feature}.${who} ${e.note}`;
      }

      case "status":
        return e.applied
          ? `${e.who}: ${e.status}. ${e.note}`
          : `${e.who} is no longer ${e.status.toLowerCase()}.`;

      case "trap_sprung":
        return `${e.victim} puts a foot on ${e.trap}. ${e.damage} damage, and it was entirely avoidable if you were somebody else.`;

      case "flee":
        return e.note;

      case "combat_end": {
        if (e.outcome === "victory") {
          return `Clear. ${e.rounds} ${e.rounds === 1 ? "round" : "rounds"}, ${e.killed} down.`;
        }
        if (e.outcome === "fled") return "You are out, and the room keeps whatever was in it.";
        return null;
      }

      case "prep":
        return `${e.note} ${fmtHours(e.minutes / 60)} gone.`;

      case "harvest": {
        const got = e.units > 0
          ? `${e.units} of the ${e.material.toLowerCase()} out of ${e.zone}, and into the bag.`
          : `${e.material} is still in the wall.`;
        return `${fmtHours(e.minutes / 60)} of hard, boring, unglamorous work. ${got}${e.note ? ` ${e.note}` : ""}`;
      }

      case "mint":
        return [
          { channel: "loot", text: `${e.name}. ${fmtHours(e.minutes / 60)}, and ${e.from.join(", ")}.` },
          { channel: "system", text: e.because },
          // The derivation, always. A number the player cannot check is a
          // number they have to take on trust, and nothing else in this game
          // asks them to.
          { channel: "system", text: e.working },
        ];

      case "transform":
        return e.worked
          ? [
              { channel: "loot", text: `${fmtHours(e.minutes / 60)} at it. ${e.units} × ${e.product}.` },
              { channel: "system", text: e.because },
            ]
          : `${fmtHours(e.minutes / 60)} at it, and then not. ${e.because}`;

      case "collapse": {
        const lines: RenderedLine[] = [{ channel: "bad", text: e.note }];
        for (const h of e.hurt) {
          lines.push({
            channel: h.who === "you" ? "bad" : "good",
            text: h.killed
              ? `${cap(h.who)} did not get out from under it.`
              : `${cap(h.who)} ${h.who === "you" ? "take" : "takes"} ${h.amount} off it.`,
          });
        }
        return lines;
      }

      case "xp":
        return null; // shown on the HUD; narrating it every kill is noise

      case "level_up":
        return e.banked
          ? [
              { channel: "good", text: v.say(L.NOTIF_LEVEL, { level: e.level }, "lvl") },
              { channel: "system", text: v.say(L.NOTIF_BANKED, {}, "bank") },
            ]
          : v.say(L.NOTIF_LEVEL, { level: e.level }, "lvl");

      case "skill_up":
        return `${e.skill} is at ${e.level}.${e.note ? ` ${e.note}` : ""}`;

      case "stat_spent":
        return `${e.stat} is now ${e.value}.`;

      case "select":
        return `You are a ${e.race} ${e.klass}. ${e.points} points unlock, and they are yours to place.`;

      case "gold":
        return e.amount === 0 ? null : `${e.amount > 0 ? "+" : ""}${e.amount} gold. ${e.reason}`;

      case "loot":
        return `${e.from}: ${commaList(e.items)}.`;

      case "box_awarded":
        return [
          { channel: "loot", text: `You've received a ${e.tier} ${e.box}! ${e.why}.` },
          { channel: "system", text: v.say(L.NOTIF_BOX_LOCKED, {}, "boxlock") },
        ];

      case "box_opened":
        return `${e.tier} ${e.box}: ${commaList(e.items)}${e.gold ? `, and ${e.gold} gold` : ""}.`;

      case "equip":
        return e.removed ? `${e.item} on, ${e.removed} off.` : `${e.item} equipped.`;

      case "use_item":
        return `${e.item}. ${e.effect}`;

      case "craft":
        return `You build ${e.item} out of ${commaList(e.from)}. ${fmtHours(e.minutes / 60)}.`;

      case "trade":
        return e.verb === "buy"
          ? `Bought ${e.item} for ${e.gold} gold.`
          : `Sold ${e.item} for ${e.gold} gold.`;

      case "time":
        return null; // the HUD carries the clock

      case "rest":
        return `You sleep the way people sleep when they have run out of the ability not to. ${e.hours} hours, and the floor timer takes every one of them.`;

      case "body":
        return e.note;

      case "heal":
        return `+${e.amount}. ${e.source}`;

      case "views":
        return `+${e.amount.toLocaleString()} views${e.because.length ? ` — ${commaList(e.because)}` : ""}.`;

      case "bounty":
        return `Your bounty is ${e.value.toLocaleString()}. It went up because you were interesting.`;

      case "sponsor_offer":
        return `${e.sponsor} is offering. ${e.terms} They send: ${e.gives}.`;

      case "sponsor":
        return `${e.sponsor}: ${e.state === "signed" ? "signed" : "terminated"}. ${e.note}`;

      case "achievement":
        return [
          { channel: "loot", text: `New achievement! ${e.name}` },
          { channel: "system", text: e.text },
        ];

      case "feed":
        return e.text;

      case "hunter":
        return `${e.name}, level ${e.level}. ${e.note}`;

      case "floor":
        return `Floor ${e.n}: ${e.name}. ${e.hours} hours on the clock. ${e.note}`;

      case "stairs":
        return e.found ? `There is a way down from here.` : v.say(L.NOTIF_STAIRS, {}, "stairs");

      case "death":
        return `${v.say(L.DEATH, {}, "death")} ${e.cause}`;

      case "companion":
        return `${e.who} ${e.what}. ${e.note}`;

      case "parley":
        return e.success
          ? `${e.with} stands down. ${e.terms}`
          : `${e.with} listens to all of it and then does not care.`;

      default:
        return null;
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "three Dungeon Rats and a Rat Shaman" rather than a list of eight names. */
function summarise(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const base = n.replace(/\s+[αβγδεζηθ\d]+$/u, "");
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([n, c]) =>
    c === 1 ? `a ${n}` : `${numberWord(c)} ${n}${n.endsWith("s") ? "" : "s"}`,
  );
  return commaList(parts);
}

const WORDS = ["no", "a", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number): string => WORDS[n] ?? String(n);
