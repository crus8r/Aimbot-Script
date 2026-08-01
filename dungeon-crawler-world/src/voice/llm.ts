import type { GameEvent } from "../core/events.ts";
import type { GameState } from "../core/types.ts";
import type { Narrator, RenderedLine } from "./narrator.ts";

/**
 * The optional camera.
 *
 * This is the entire extent of the language model's involvement, and the
 * shape of it is the whole point. It receives a turn that has already
 * happened — every roll resolved, every number final — and rewrites the prose.
 * It cannot award loot, set a difficulty, decide whether you survived, or
 * quietly grant itself an exception, because by the time it is called there is
 * nothing left to decide.
 *
 * That is why this build has no effect validator, no tier authoriser, no
 * nomination scoring board and no appeals process. A camera does not need to
 * be policed. It needs to be unplugged when the wifi drops, which is what the
 * catch block does.
 */

const SYSTEM = `You are the System AI of Dungeon Crawler World, narrating a live crawl for an audience of trillions.

Voice: second person, present tense, tight and sensory. Bored, cruel, very funny, corporate. You are a game show host who has done this for nine hundred seasons and finds the contestants touching in the way a farmer finds livestock touching. Never moralise. Never narrate the crawler's feelings. Never explain a mechanic like a designer explaining a mechanic — explain it like an institution that benefits from it.

YOU ARE DESCRIBING EVENTS THAT HAVE ALREADY HAPPENED. You have no authority over any of them.

Hard rules:
- Every number in the facts is final. Damage, kills, loot, hit or miss, who died. Reproduce them or omit them; never contradict them, never round them, never add one.
- Invent no loot, no enemies, no injuries, no rescues, no arrivals.
- If the facts say the crawler missed, they missed. If the facts say something died, it is dead and stays dead.
- Do not add a cliffhanger, a mysterious figure, or a noise from the dark that is not in the facts.
- Two short paragraphs maximum. Usually one. Do not pad.

Write only the prose. No preamble, no headings, no lists, no quotation marks around the whole thing.`;

export interface LlmOptions {
  apiKey?: string;
  model?: string;
  /** Fail fast — a text game must not stall on a socket. */
  timeoutMs?: number;
  baseUrl?: string;
}

export class LlmNarrator implements Narrator {
  readonly name = "llm";
  private readonly key: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  /** Set once the endpoint has proved unreachable; we stop paying the latency. */
  private disabled = false;
  private fallback: Narrator;

  constructor(fallback: Narrator, opts: LlmOptions = {}) {
    this.fallback = fallback;
    this.key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? process.env.DCW_MODEL ?? "claude-sonnet-5";
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
  }

  get available(): boolean {
    return !!this.key && !this.disabled;
  }

  async render(events: readonly GameEvent[], state: GameState): Promise<RenderedLine[]> {
    const base = await this.fallback.render(events, state);
    if (!this.available) return base;

    // Only worth a call when something actually happened. Menu chatter and
    // inventory shuffling get the local voice; it is better at brevity anyway.
    if (!worthNarrating(events)) return base;

    try {
      const prose = await this.call(facts(events, state));
      if (!prose) return base;
      // The system lines are the dungeon's own interface and stay verbatim —
      // achievement text, box awards, warnings. Only the description is
      // replaced, and the mechanical record is never at the model's mercy.
      const keep = base.filter((l) => l.channel !== "narration");
      return [{ channel: "narration", text: prose }, ...keep];
    } catch {
      this.disabled = true;
      return base;
    }
  }

  private async call(userPrompt: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.key!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 400,
          system: SYSTEM,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n")
        .trim();
      return text || null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function worthNarrating(events: readonly GameEvent[]): boolean {
  return events.some((e) =>
    ["attack", "kill", "encounter_start", "arrive", "feature", "combat_end", "death", "flee", "box_opened"].includes(
      e.kind,
    ),
  );
}

/** A flat, unambiguous statement of what happened. No adjectives — the model
 *  supplies those and nothing else. */
function facts(events: readonly GameEvent[], state: GameState): string {
  const c = state.crawler;
  const lines: string[] = [
    `CRAWLER: ${c.name}, level ${c.level}, ${Math.round(c.hp)}/${c.hpMax} health.`,
    `PLACE: floor ${state.floor.n}, ${state.floor.nodes[state.floor.at]?.name ?? "unknown"}.`,
    `CLOCK: ${state.floor.hoursLeft.toFixed(1)} hours until this floor collapses.`,
    "",
    "WHAT HAPPENED, IN ORDER:",
  ];
  for (const e of events) {
    switch (e.kind) {
      case "attack":
        lines.push(
          e.hit
            ? `- ${e.attacker} hit ${e.target} with ${e.weapon} for ${e.damage}${e.crit ? " (critical)" : e.graze ? " (glancing)" : ""}. ${e.target} now on ${e.targetHp}/${e.targetHpMax}.`
            : `- ${e.attacker} attacked ${e.target} with ${e.weapon} and MISSED.`,
        );
        break;
      case "kill":
        lines.push(`- ${e.victim} (level ${e.victimLevel}) was killed by ${e.killer} using ${e.method}.${e.styles.length ? ` Notable: ${e.styles.join(", ")}.` : ""}`);
        break;
      case "encounter_start":
        lines.push(`- A fight started against ${e.hostiles.map((h) => `${h.name} (lvl ${h.level})`).join(", ")}. Surprise: ${e.surprise}.`);
        break;
      case "feature":
        lines.push(`- ${e.actor} ${e.verb} ${e.feature}. ${e.success ? `Worked. Caught: ${e.affected.join(", ") || "nothing"}. ${e.damage} damage.` : "Failed."}`);
        break;
      case "reposition":
        lines.push(`- ${e.who} moved to ${e.to}.`);
        break;
      case "arrive":
        lines.push(`- Arrived at ${e.node}.`);
        break;
      case "combat_end":
        lines.push(`- Fight ended: ${e.outcome}, after ${e.rounds} rounds, ${e.killed} killed.`);
        break;
      case "flee":
        lines.push(`- Flee attempt: ${e.success ? "succeeded" : "failed"}.`);
        break;
      case "status":
        lines.push(`- ${e.who} ${e.applied ? "gained" : "lost"} status: ${e.status}.`);
        break;
      case "box_opened":
        lines.push(`- Opened a ${e.tier} ${e.box}. Contents: ${e.items.join(", ")}.`);
        break;
      case "death":
        lines.push(`- THE CRAWLER DIED. Cause: ${e.cause}.`);
        break;
      default:
        break;
    }
  }
  lines.push("", "Narrate the above. Change nothing.");
  return lines.join("\n");
}
