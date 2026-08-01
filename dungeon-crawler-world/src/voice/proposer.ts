import type { GameState, MapNode } from "../core/types.ts";
import type { Proposal } from "../core/proposal.ts";
import { FAMILIES, REQUIREMENT_KINDS } from "../core/proposal.ts";
import { MAT_TAGS } from "../data/materials.ts";
import { materialOf } from "../sim/harvest.ts";
import { availableTransforms } from "../sim/transform.ts";
import { capabilityOf } from "../sim/transform.ts";
import { clean } from "../sim/propose.ts";

/**
 * The Dungeon Master seat.
 *
 * The narrator was a camera: it saw a turn that had already happened and
 * rewrote the prose. This is a different job and a more dangerous one — it runs
 * BEFORE resolution, on a sentence the deterministic parser could not read, and
 * it is allowed to answer.
 *
 * What makes it safe is not that it is watched. It is that it can only speak in
 * a vocabulary that has no dangerous words in it. A proposal is a
 * CLASSIFICATION and a BILL OF MATERIALS — "this is a caustic burn, it wants
 * sustained heat, it eats three units of limestone" — and never a description
 * of an outcome. It cannot write a damage number because there is no field for
 * one. It cannot invent a tag because tags come from a closed table the engine
 * owns. It cannot conjure materials because the bill is checked against the
 * pack. Everything mechanical is derived by `src/sim/propose.ts` from
 * quantities the engine already had.
 *
 * And it is strictly optional. Every path this opens is reachable offline: the
 * transformation table already turns limestone into quicklime, and the keyword
 * interpreter already reads most sentences. A model here widens the range of
 * SENTENCES the game understands. It does not widen the range of THINGS the
 * game can do — that is the line, and it is drawn in the type system rather
 * than in a policy document.
 */

export interface ProposalContext {
  /** What the player actually typed. */
  said: string;
  state: GameState;
  node: MapNode;
}

export interface Proposer {
  readonly name: string;
  readonly available: boolean;
  propose(ctx: ProposalContext): Promise<Proposal | null>;
}

/** No model attached. The game is complete without one; this says so. */
export class NoProposer implements Proposer {
  readonly name = "none";
  readonly available = false;
  async propose(): Promise<Proposal | null> {
    return null;
  }
}

/* ------------------------------------------------------------- the brief */

export const SYSTEM_BRIEF = `You are the Dungeon Master of a text roguelike. A player has typed something the game's keyword parser could not read, and your job is to work out what they meant and answer in the game's own vocabulary.

You are NOT resolving the action. The engine does that. You classify and you bill; it prices and it pays. There is deliberately no field anywhere in your output for damage, power, value, weight, rarity, gold, experience, or a tag of your own invention — those are all derived from what you say it costs.

Return ONE JSON object and nothing else. No markdown fence, no commentary.

THREE SHAPES:

1. A reading — the player asked for something the game already does, in words it did not recognise.
   {"kind":"reading","intent":"<engine verb>","argument":"<optional>","note":"<what you understood, one sentence, in the game's voice>"}

2. A transformation — the player is making something out of things they are carrying.
   {"kind":"transform","name":"<what to call it, max 48 chars>","desc":"<one or two sentences>","family":"<one of the families>","inputs":[{"id":"<material id from THEIR PACK>","qty":<1-20>}],"needs":[<requirements>],"under":"<skill id>","because":"<why this works, plainly, 1-3 sentences — shown to the player>"}

3. A decline — it genuinely is not a thing that can be done here.
   {"kind":"decline","note":"<why, one sentence, without being smug about it>"}

FAMILIES (pick the closest; this is your only lever on how it behaves):
${FAMILIES.join(", ")}

REQUIREMENTS — the only conditions you may demand, and the ONLY route to a strong result. A proposal scores on how hard its requirements are, and every one of them is checked against the world before anything happens. Claiming a big number does not buy power; it buys a refusal until the player can meet it. Be honest about what the real process actually needs:
  {"k":"heat","minC":<40-20000>,"holdHours":<0-48>}   {"k":"flame"}
  {"k":"immersion","medium":"water|acid|alkali|oil"}   {"k":"vessel","kind":"open|sealed|pressure"}
  {"k":"station","id":"alchemy|engineering|ordnance|forge"}
  {"k":"tool","klass":"edge|lever|percussion|cutting|fine"}
  {"k":"skill","id":"<skill id>","level":<0-20>}       {"k":"hours","n":<0-48>}
  {"k":"ventilation","kind":"open|confined"}           {"k":"current"}   {"k":"freezing"}

RULES:
- Inputs must be material ids the player is ACTUALLY CARRYING, from the list you are given. A material that is not in the pack does not exist.
- Prefer a reading over a transformation. Most sentences are somebody asking for something the game already does.
- Be generous about what the player meant and honest about what it would take. If their idea is real chemistry or real physics, say what it really requires — the engine will tell them what they are short of, and that is a good answer, not a refusal.
- Never argue with the player about whether their idea is clever. It is not your call and it is not interesting.
- Do not invent enemies, loot, rooms, injuries, or outcomes. You are not narrating.`;

/* -------------------------------------------------------------- the facts */

/**
 * What the model is told.
 *
 * Only what somebody standing in the room would know. No hidden loot, no
 * unvisited rooms, no monster health, no seeds — a model that can see through
 * walls will eventually mention what is behind one.
 */
export function brief(ctx: ProposalContext): string {
  const { state, node, said } = ctx;
  const cap = capabilityOf(state, node);

  const pack = state.inventory
    .map((i) => {
      const m = materialOf(i);
      return m ? `  ${m.id} — ${i.qty} × ${m.name} (${m.tags.join(", ")})` : null;
    })
    .filter(Boolean);

  const gear = state.inventory
    .filter((i) => !materialOf(i))
    .slice(0, 20)
    .map((i) => `  ${i.name}${i.equipped ? " (worn)" : ""}`);

  const skills = Object.entries(state.skills)
    .filter(([, v]) => v.level > 0)
    .map(([k, v]) => `${k} ${v.level}`);

  const already = availableTransforms(state)
    .map(({ rule, inputs }) => `  ${rule.id}: ${rule.name} — ${inputs.map((i) => i.mat.id).join(", ")}`);

  return [
    `THE PLAYER TYPED: ${JSON.stringify(said)}`,
    "",
    `WHERE: floor ${state.floor.n}, ${node.name}, a ${node.kind}. Positions: ${node.zones.map((z) => `${z.name} [${z.tags.join(",")}]`).join("; ")}.`,
    `CLOCK: ${state.floor.hoursLeft.toFixed(1)} hours before this floor closes.`,
    state.encounter && !state.encounter.finished ? "IN A FIGHT RIGHT NOW — long processes are not possible." : "Not in a fight.",
    "",
    "MATERIALS IN THE PACK (only these ids may be used as inputs):",
    pack.length ? pack.join("\n") : "  none",
    "",
    "OTHER THINGS CARRIED:",
    gear.length ? gear.join("\n") : "  nothing worth listing",
    "",
    `SKILLS: ${skills.length ? skills.join(", ") : "none above zero"}`,
    `BENCHES REACHABLE HERE: ${cap.stations.length ? cap.stations.join(", ") : "none"}`,
    `HEAT AVAILABLE: ${cap.heatC ? `${cap.heatC}°C from ${cap.heatFrom}` : "nothing that burns"}. Water: ${cap.water ? "yes" : "no"}. Ventilation: ${cap.ventilated ? "yes" : "no"}.`,
    "",
    "PROCESSES THE ENGINE ALREADY KNOWS FOR WHAT THEY CARRY — prefer a reading pointing at one of these over inventing anything:",
    already.length ? already.join("\n") : "  none",
    "",
    `ENGINE VERBS for a reading: look, examine, search, scout, go, descend, wait, rest, eat, engage, attack, move, feature, throw, brace, aim, intimidate, parley, flee, use, equip, unequip, drop, cast, craft, brew, experiment, harvest, transform, deploy, shop, buy, sell, open, spend, lock, prep, equipBest, dropJunk.`,
    "",
    `MATERIAL PROPERTIES that exist in this world: ${MAT_TAGS.join(", ")}.`,
    `REQUIREMENT KINDS: ${REQUIREMENT_KINDS.join(", ")}.`,
  ].join("\n");
}

/* ------------------------------------------------------------ transports */

export interface ProposerOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  baseUrl?: string;
  /** Sent by a browser build; the API requires it explicitly. */
  browser?: boolean;
}

/**
 * Anthropic's API, spoken to directly.
 *
 * Works from Node with a key in the environment, and from a self-hosted page
 * with the browser header set. It does NOT work from a published artifact —
 * that page's content security policy is `connect-src 'self'`, so no external
 * host is reachable from it at all. That is a fact about where the page is
 * hosted rather than a fault in this file, and `PasteProposer` below exists
 * because of it.
 */
export class LlmProposer implements Proposer {
  readonly name = "llm";
  private readonly key: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly browser: boolean;
  private disabled = false;

  constructor(opts: ProposerOptions = {}) {
    this.key = opts.apiKey ?? (typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : undefined);
    this.model = opts.model ?? (typeof process !== "undefined" ? process.env?.DCW_MODEL : undefined) ?? "claude-opus-5";
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.browser = opts.browser ?? typeof window !== "undefined";
  }

  get available(): boolean {
    return !!this.key && !this.disabled;
  }

  async propose(ctx: ProposalContext): Promise<Proposal | null> {
    if (!this.available) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": this.key!,
        "anthropic-version": "2023-06-01",
      };
      if (this.browser) headers["anthropic-dangerous-direct-browser-access"] = "true";

      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1200,
          system: SYSTEM_BRIEF,
          messages: [{ role: "user", content: brief(ctx) }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      return parseProposal(text, ctx.state);
    } catch {
      // A text game must never stall on a socket. One failure and the seat is
      // empty for the session; the deterministic path was always underneath.
      this.disabled = true;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The bridge for somewhere with no network at all.
 *
 * A published artifact cannot reach any external host, so if somebody wants a
 * model in that seat the only honest route is for them to be the transport:
 * the page hands them a prompt, they paste it into a chat, they paste the
 * answer back. Clunky, entirely under their control, and it works in the one
 * environment where nothing else can.
 */
export class PasteProposer implements Proposer {
  readonly name = "paste";
  /** Shows the prompt and takes an answer. Resolves with what was pasted, or null. */
  private readonly ask: (prompt: string) => Promise<string | null>;

  constructor(ask: (prompt: string) => Promise<string | null>) {
    this.ask = ask;
  }

  get available(): boolean {
    return true;
  }

  /** The prompt a player would paste, for a copy button. */
  promptFor(ctx: ProposalContext): string {
    return `${SYSTEM_BRIEF}\n\n---\n\n${brief(ctx)}`;
  }

  async propose(ctx: ProposalContext): Promise<Proposal | null> {
    const answer = await this.ask(this.promptFor(ctx));
    return answer ? parseProposal(answer, ctx.state) : null;
  }
}

/* --------------------------------------------------------------- parsing */

/**
 * Whatever came back, turned into a proposal or into nothing.
 *
 * Models fence JSON, prefix it with "Here is", and occasionally return two
 * objects. Extracting the first balanced object is worth the twenty lines; a
 * dropped proposal because of a markdown fence is a bad answer for a reason
 * that has nothing to do with the game.
 */
export function parseProposal(raw: string, state: GameState): Proposal | null {
  const json = firstObject(raw);
  if (!json) return null;
  try {
    return clean(JSON.parse(json), state);
  } catch {
    return null;
  }
}

function firstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
