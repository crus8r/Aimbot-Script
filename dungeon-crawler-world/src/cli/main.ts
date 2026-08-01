import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { Game, type Command } from "../sim/game.ts";
import type { GameState, StatKey } from "../core/types.ts";
import { ProceduralNarrator } from "../voice/narrator.ts";
import { LlmNarrator } from "../voice/llm.ts";
import { LlmProposer, NoProposer, type Proposer } from "../voice/proposer.ts";
import { Rng } from "../core/rng.ts";
import { RACES, CLASSES } from "../data/paths.ts";
import { SPONSOR_BY_ID } from "../data/sponsors.ts";
import type { Intake } from "../sim/intake.ts";
import {
  amber,
  blood,
  bold,
  bone,
  combatView,
  dim,
  hud,
  inventoryView,
  jade,
  mapView,
  memoryView,
  renderLines,
  roomView,
  rule,
  sheet,
  signal,
  skillsView,
  spellsView,
  wrap,
  type InvSort,
} from "./render.ts";

/**
 * The terminal client.
 *
 * It is a thin thing on purpose. Every decision lives behind `Game.execute`,
 * so this file can only ask questions and draw answers — which is what makes
 * the balance harness and the test suite play exactly the same game a person
 * does, rather than an approximation of it.
 */

const SAVE_PATH = process.env.DCW_SAVE ?? "./dcw-save.json";
const args = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const say = (s: string) => stdout.write(s + "\n");

/**
 * Input, which has to work two ways.
 *
 * Interactively it is a readline prompt. Piped — a demo script, a recorded
 * bug report, a smoke test — the stream closes the instant it is drained, and
 * readline's `close` fires long before the game has worked through the
 * commands. So a non-TTY run is read to the end up front and served from a
 * queue, which also makes `printf ... | npm run play` a reliable way to
 * reproduce anything.
 */
const interactive = Boolean(stdin.isTTY);
const rl = createInterface({ input: stdin, output: interactive ? stdout : undefined });
let queued: string[] | null = null;

async function prompt(text: string): Promise<string | null> {
  if (interactive) return rl.question(text);
  if (queued === null) {
    queued = [];
    for await (const line of rl) queued.push(line);
  }
  const next = queued.shift();
  if (next === undefined) return null;
  say(text + next);
  return next;
}

if (interactive) rl.on("close", () => process.exit(0));

async function main(): Promise<void> {
  let game: Game;

  const wantLoad = args.includes("--load");
  if (wantLoad) {
    const raw = await readFile(SAVE_PATH, "utf8").catch(() => null);
    if (!raw) {
      say(blood(`No save at ${SAVE_PATH}.`));
      rl.close();
      return;
    }
    game = Game.load(JSON.parse(raw) as GameState, makeNarrator(JSON.parse(raw).seed));
    game.proposer = makeProposer();
    say(amber(`Resumed. ${game.state.crawler.name}, floor ${game.state.floor.n}.`));
  } else {
    const seed = Number(argOf("seed") ?? (Date.now() & 0x7fffffff));
    const intake = args.includes("--quick") ? quickIntake() : await runIntake();
    game = Game.create(seed, intake, makeNarrator(seed));
    game.proposer = makeProposer();
    say(dim(`\n  seed ${seed} — the whole run replays from this number.\n`));
  }

  const first = await game.execute({ t: "look" });
  say(renderLines(first.lines));

  await loop(game);
  rl.close();
}

/**
 * The Dungeon Master seat, filled only when asked for.
 *
 * `--dm` is separate from `--llm` on purpose. The narrator is a camera and runs
 * after everything is decided; this runs BEFORE resolution on text the player
 * controls, which is a different thing to consent to even though the safety
 * argument holds either way. Somebody should be able to have one without the
 * other.
 */
function makeProposer(): Proposer {
  if (!args.includes("--dm")) return new NoProposer();
  if (!process.env.ANTHROPIC_API_KEY) {
    say(dim("  --dm requested but ANTHROPIC_API_KEY is not set. The keyword parser is on its own, which it is built to be."));
    return new NoProposer();
  }
  say(dim("  Dungeon Master on. It reads sentences the parser cannot and proposes what they mean; every number it leads to is still the engine's."));
  return new LlmProposer();
}

function makeNarrator(seed: number) {
  const local = new ProceduralNarrator(Rng.fromSeed(seed ^ 0x5f3759df));
  if (!args.includes("--llm")) return local;
  if (!process.env.ANTHROPIC_API_KEY) {
    say(dim("  --llm requested but ANTHROPIC_API_KEY is not set. Using the local voice."));
    return local;
  }
  say(dim("  Language model narration on. It renders prose only; it cannot touch a single number."));
  return new LlmNarrator(local);
}

/* ------------------------------------------------------------- intake */

function quickIntake(): Partial<Intake> {
  return {
    name: "Crawler",
    job: "electrician",
    hobby: "boxing",
    body: "average",
    mind: "mid",
    people: "mid",
    dress: "casual",
    carried: ["phone", "keys", "lighter"],
    companion: "cat",
  };
}

async function ask(q: string, hint: string, fallback: string): Promise<string> {
  say("");
  say(bold(bone("  " + q)));
  if (hint) say(dim(wrap(hint, 2)));
  const answer = (await prompt(amber("  > ")))?.trim();
  return answer || fallback;
}

async function choose<T extends string>(
  q: string,
  options: { v: T; l: string }[],
  fallback: T,
): Promise<T> {
  say("");
  say(bold(bone("  " + q)));
  options.forEach((o, i) => say(dim(`    ${i + 1}) `) + o.l));
  const answer = (await prompt(amber("  > ")))?.trim() ?? "";
  const n = parseInt(answer, 10);
  if (n >= 1 && n <= options.length) return options[n - 1]!.v;
  const byName = options.find((o) => o.v === answer.toLowerCase());
  return byName?.v ?? fallback;
}

async function runIntake(): Promise<Partial<Intake>> {
  say("");
  say(rule("DUNGEON CRAWLER WORLD — SEASON: EARTH"));
  say(
    wrap(
      "Eighteen floors, a timer on each, and an audience of trillions who can see your health bar and have opinions about it. Death is permanent, the dungeon has never once been talked out of anything, and there is no reload.\n\n" +
        "There are no classes to pick yet. The dungeon did not ask what you wanted to be — it took whoever was outside. Eight questions about the hour before, and the system will decide what that made you. Race and class come on the third floor, if you get there.",
    ),
  );

  const name = await ask("What should the notifications call you?", "", "Crawler");
  const job = await ask(
    "What did you do for money?",
    "Be specific. Specific jobs make specific skills, and the algorithm doing the translating has no respect for any of them.",
    "nothing in particular",
  );
  const hobby = await ask(
    "And when you weren't doing that?",
    "The dungeon does not care whether it sounds impressive.",
    "nothing in particular",
  );
  const body = await choose<Intake["body"]>(
    "Physically, honestly.",
    [
      { v: "weak", l: "I got winded on stairs" },
      { v: "average", l: "Average. Fine. Unremarkable" },
      { v: "fit", l: "I trained a few times a week" },
      { v: "strong", l: "Strength was the whole point" },
    ],
    "average",
  );
  const mind = await choose<Intake["mind"]>(
    "Something in your house breaks. You:",
    [
      { v: "low", l: "Call someone. That is what money is for" },
      { v: "mid", l: "Look it up and have a go" },
      { v: "high", l: "Take it apart to see how it failed" },
      { v: "vhigh", l: "Already knew why it broke" },
    ],
    "mid",
  );
  const people = await choose<Intake["people"]>(
    "A room full of strangers. You:",
    [
      { v: "low", l: "Find a wall and hold it" },
      { v: "mid", l: "Talk to two people, leave early" },
      { v: "high", l: "Work the room. It is easy" },
      { v: "vhigh", l: "By the end, it is my room" },
    ],
    "mid",
  );
  const dress = await choose<Intake["dress"]>(
    "It happened at three in the morning. You were:",
    [
      { v: "underdressed", l: "Outside in my underwear. Do not ask" },
      { v: "bed", l: "In whatever I sleep in, barefoot" },
      { v: "casual", l: "Dressed. Shoes on, even" },
      { v: "work", l: "In work clothes, mid-shift" },
    ],
    "casual",
  );
  say("");
  say(bold(bone("  What was actually on you?")));
  say(dim("  Comma-separated, any of: phone, keys, lighter, food, tools, weapon. Blank for nothing at all, which is its own achievement."));
  const carriedRaw = (await prompt(amber("  > ")))?.trim() ?? "";
  const carried = carriedRaw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => ["phone", "keys", "lighter", "food", "tools", "weapon"].includes(x));

  const companion = await choose<Intake["companion"]>(
    "Who came down with you?",
    [
      { v: "none", l: "Nobody. I was alone" },
      { v: "cat", l: "A cat" },
      { v: "dog", l: "A dog" },
      { v: "person", l: "Another person" },
    ],
    "none",
  );

  return { name, job, hobby, body, mind, people, dress, carried, companion };
}

/* --------------------------------------------------------------- loop */

async function loop(game: Game): Promise<void> {
  let invFilter = "all";
  let invSort: InvSort = "relevance";

  for (;;) {
    const s = game.state;
    if (!s.crawler.alive) {
      say(obituary(s));
      return;
    }

    say("");
    say(hud(s));
    if (s.encounter && !s.encounter.finished) say(combatView(s));
    say("");

    const line = await prompt(amber("› "));
    if (line === null) {
      // A piped script ran out. Save and leave quietly rather than hanging.
      await save(game);
      say(dim("\n  End of input. Saved."));
      return;
    }
    const raw = line.trim();
    if (!raw) continue;

    const [verb, ...rest] = raw.split(/\s+/);
    const arg = rest.join(" ");
    const v = (verb ?? "").toLowerCase();

    // --- client-side views: these never touch the simulation
    if (["quit", "exit", "q"].includes(v)) {
      await save(game);
      say(dim("Saved. The dungeon will still be here."));
      return;
    }
    if (v === "save") {
      await save(game);
      say(jade(`Saved to ${SAVE_PATH}.`));
      continue;
    }
    if (["help", "?", "h"].includes(v)) {
      say(helpText(!!(s.encounter && !s.encounter.finished)));
      continue;
    }
    if (["sheet", "char", "c"].includes(v)) {
      say(sheet(s));
      continue;
    }
    if (["inv", "inventory", "i", "bag"].includes(v)) {
      if (arg) invFilter = arg.toLowerCase();
      say(inventoryView(s, invFilter, invSort));
      continue;
    }
    if (v === "sort") {
      const legal: InvSort[] = ["relevance", "value", "weight", "rarity", "name", "recent"];
      const picked = legal.find((x) => x.startsWith(arg.toLowerCase()));
      if (picked) invSort = picked;
      say(inventoryView(s, invFilter, invSort));
      continue;
    }
    if (["compare", "cmp"].includes(v) && arg) {
      say(inventoryView(s, "all", invSort));
      continue;
    }
    if (["map", "m"].includes(v)) {
      say(mapView(s));
      continue;
    }
    if (["memory", "log"].includes(v)) {
      say(memoryView(s));
      continue;
    }
    if (["room", "here"].includes(v)) {
      say(roomView(s));
      continue;
    }
    if (["spells", "book", "grimoire"].includes(v)) {
      say(spellsView(s));
      continue;
    }
    if (["skills", "sk"].includes(v)) {
      say(skillsView(s));
      continue;
    }
    if (v === "races") {
      for (const r of RACES) {
        say(`  ${bone(r.name.padEnd(16))} ${dim(r.note)}`);
        say(`    ${jade(r.pros)}`);
        say(`    ${blood(r.cons)}`);
      }
      continue;
    }
    if (v === "classes") {
      // Most of this menu did not exist before this crawler played.
      const menu = game.classOptions();
      say(rule("the menu"));
      say(dim(wrap("Three the system recommends and the rest behind them. The ones marked ASSEMBLED were built out of your own record — they are not on anybody else's list and they are exactly as permanent as the ones that were written down in advance.", 2)));
      for (const k of menu) {
        const req = Object.entries(k.req).map(([a, b]) => `${a.toUpperCase()} ${b}`).join(", ");
        const badge = k.recommended ? amber(" ★ recommended") : "";
        const src = k.generated ? signal(" ASSEMBLED") : dim(" standard");
        say(`  ${bone(k.name)}${src}${badge}  ${dim(`requires ${req || "nothing"}`)}`);
        say(dim(wrap(k.note, 4)));
        if (k.pros) say(jade(wrap(k.pros, 4)));
        if (k.cons) say(blood(wrap(k.cons, 4)));
        say(dim(`    select <race> ${k.id}`));
      }
      continue;
    }
    if (v === "offers") {
      if (!s.offers.length) say(dim("  Nobody is offering you anything."));
      for (const o of s.offers) {
        const def = SPONSOR_BY_ID[o.sponsor];
        say(`  ${signal(def?.name ?? o.sponsor)} ${dim(`(sign ${o.sponsor})`)}`);
        say(wrap(o.terms, 4));
        say(blood(wrap(o.clause, 4)));
        say(jade(wrap(o.gives, 4)));
      }
      continue;
    }

    // Two-word conveniences before the single-verb table.
    const twoWord =
      v === "equip" && /^best$/i.test(arg) ? ({ t: "equipBest" } as Command)
      : v === "drop" && /^junk|rubbish|trash$/i.test(arg) ? ({ t: "dropJunk" } as Command)
      : null;

    // Anything the verb table does not recognise is handed to the interpreter
    // rather than refused. Being argued with by a parser is a worse experience
    // than losing, and "I shove it into the fire" is a perfectly clear
    // instruction that no sensible verb list was ever going to contain.
    const cmd = twoWord ?? parse(v, arg, s) ?? ({ t: "improvise", text: raw } as Command);

    const result = await game.execute(cmd);
    const text = renderLines(result.lines);
    if (text.trim()) say("\n" + text);

    // Arriving somewhere is the one moment you always want the room drawn.
    if (result.events.some((e) => e.kind === "arrive" || e.kind === "combat_end")) {
      if (!(game.state.encounter && !game.state.encounter.finished)) say(roomView(game.state));
    }
  }
}

function parse(v: string, arg: string, s: GameState): Command | null {
  const fighting = s.encounter !== null && s.encounter.finished === null;

  switch (v) {
    case "look":
    case "l":
      return { t: "look" };
    case "go":
    case "walk":
    case "travel":
      return arg ? { t: "go", to: arg } : null;
    case "scout":
    case "peek":
      return arg ? { t: "scout", node: arg } : null;
    case "search":
    case "loot":
      return { t: "search" };
    case "wait":
      return { t: "wait", hours: Number(arg) || 1 };
    case "descend":
    case "down":
    case "stairs":
      return { t: "descend" };
    case "prep":
    case "setup": {
      const what = arg.toLowerCase();
      if (what.startsWith("amb")) return { t: "prep", what: "ambush" };
      if (what.startsWith("tra")) return { t: "prep", what: "trap" };
      if (what.startsWith("bar")) return { t: "prep", what: "barricade" };
      if (what.startsWith("bre") || what.startsWith("rest")) return { t: "prep", what: "breather" };
      return null;
    }
    case "engage":
    case "fight":
      return { t: "engage" };

    case "attack":
    case "a":
    case "hit":
      return arg ? { t: "attack", target: arg } : null;
    case "move":
    case "mv":
      return arg ? (fighting ? { t: "move", zone: arg } : { t: "go", to: arg }) : null;
    case "feature":
    case "f":
    case "pull":
    case "topple":
      return arg ? { t: "feature", id: arg } : null;
    case "throw": {
      const [item, ...where] = arg.split(/\s+at\s+|\s+/);
      return item ? { t: "throw", item, zone: where.join(" ") || undefined } : null;
    }
    case "brace":
      return { t: "brace" };
    case "aim":
      return { t: "aim" };
    case "taunt":
    case "intimidate":
      return { t: "intimidate" };
    case "talk":
    case "parley":
    case "negotiate":
      return { t: "parley" };
    case "flee":
    case "run":
      return { t: "flee" };
    case "end":
    case "endturn":
    case "e":
      return { t: "endturn" };

    case "use":
    case "u":
    case "drink":
      return arg ? { t: "use", item: arg } : null;
    case "equip":
    case "eq":
    case "wear":
    case "wield":
      return arg ? { t: "equip", item: arg } : null;
    case "unequip":
    case "remove":
      return arg ? { t: "unequip", item: arg } : null;
    case "drop":
      return arg ? { t: "drop", item: arg } : null;
    case "rest":
    case "sleep":
      return { t: "rest" };
    case "eat":
      return { t: "eat" };
    case "open":
    case "boxes":
      return { t: "open" };
    case "spend": {
      const k = arg.slice(0, 3).toLowerCase() as StatKey;
      return ["str", "dex", "con", "int", "cha"].includes(k) ? { t: "spend", stat: k } : null;
    }
    case "select":
    case "become": {
      const [race, klass] = arg.split(/\s+/);
      return race && klass ? { t: "select", race, klass } : null;
    }
    case "sign":
      return arg ? { t: "sign", sponsor: arg } : null;

    case "cast": {
      const [spell, ...rest2] = arg.split(/\s+at\s+|\s+on\s+/);
      return spell ? { t: "cast", spell: spell.trim(), target: rest2.join(" ").trim() || undefined } : null;
    }
    case "claim": {
      // "claim a multi-tool because I am an electrician" — the reason is the
      // whole ruling, so it is parsed generously and never demanded twice.
      const m = /^(.*?)\s+(?:because|since|as|—|-)\s+(.*)$/i.exec(arg);
      if (m) return { t: "claim", what: m[1]!.trim(), why: m[2]!.trim() };
      return arg ? { t: "claim", what: arg, why: "" } : null;
    }
    case "do":
    case "try":
    case "say":
      return arg ? { t: "improvise", text: arg } : null;
    case "lock":
    case "unlock":
      return arg ? { t: "lock", item: arg } : null;
    case "stance": {
      const [who, st] = arg.split(/\s+/);
      const legal = ["aggressive", "defensive", "support", "hide"] as const;
      const found = legal.find((x) => x.startsWith((st ?? who ?? "").toLowerCase()));
      return found ? { t: "stance", who: st ? who! : "", stance: found } : null;
    }
    case "equip_best":
      return { t: "equipBest" };
    case "drop_junk":
      return { t: "dropJunk" };
    default:
      return null;
  }
}

function helpText(fighting: boolean): string {
  const out: string[] = [rule("what you can do")];
  if (fighting) {
    out.push(bone("  in a fight"));
    out.push(dim("    attack <n|name>   ") + "swing at something. Numbers on the left work.");
    out.push(dim("    move <zone>       ") + "reposition. A chokepoint is worth more than a weapon.");
    out.push(dim("    feature <name>    ") + "use the room. Topple the bus, light the gas, drop the cable.");
    out.push(dim("    throw <item> [at] ") + "an explosive at a cluster.");
    out.push(dim("    brace / aim       ") + "spend the turn on defence, or on three points of accuracy.");
    out.push(dim("    taunt             ") + "force a morale check. Broken things run.");
    out.push(dim("    talk              ") + "only works on things that negotiate.");
    out.push(dim("    cast <spell> [at n]") + " mana is your Intelligence and it does not come back quickly.");
    out.push(dim("    use <item>        ") + "a potion, a bandage. Costs your action.");
    out.push(dim("    flee              ") + "you keep your life. You keep nothing else.");
    out.push(dim("    end               ") + "end the turn.");
  } else {
    out.push(bone("  moving about"));
    out.push(dim("    go <id|name>      ") + "travel. Costs real minutes off the floor timer.");
    out.push(dim("    scout <id>        ") + "look into somewhere next door before you commit. Cheap, and the best action in the game.");
    out.push(dim("    search            ") + "turn the place over. Twenty-odd minutes.");
    out.push(dim("    descend           ") + "take the stairs, if there are stairs.");
    out.push("");
    out.push(bone("  before a fight, if they have not seen you"));
    out.push(dim("    prep ambush       ") + "get low. Opens with a first strike.");
    out.push(dim("    prep trap         ") + "wire something. It does not need you awake.");
    out.push(dim("    prep barricade    ") + "close a way in.");
    out.push(dim("    engage            ") + "start it on your terms.");
    out.push("");
    out.push(bone("  keeping going"));
    out.push(dim("    rest / eat        ") + "safe rooms only. Sleeping costs seven hours.");
    out.push(dim("    open              ") + "boxes, all of them, in tier order, safe rooms only.");
    out.push(dim("    spend <stat>      ") + "safe rooms only.");
    out.push(dim("    select <race> <class>") + dim("  at a guild hall from the third floor. Permanent."));
    out.push(dim("    equip / use / drop <item>") + dim("   — or the number the inventory prints"));
    out.push(dim("    equip best        ") + "wear the best of what you are carrying, in one command.");
    out.push(dim("    drop junk         ") + "everything worthless and unlocked, on the floor. Locked items stay.");
    out.push(dim("    lock <n>          ") + "protect something from bulk operations.");
    out.push(dim("    claim <thing> because <why>") + dim("   — something ordinary you had in your pockets all along."));
  }
  out.push("");
  out.push("");
  out.push(bone("  saying it in your own words"));
  out.push(dim("    Anything the verb list does not recognise is read as an instruction rather than refused."));
  out.push(dim("    \"shove the shelving onto them\" · \"back into the doorway\" · \"set the gas off\" · \"try to talk to it\""));
  out.push(dim("    It always tells you what it understood, so a misreading costs a line and not a turn."));
  out.push("");
  out.push(bone("  looking at things") + dim("   sheet · inv [filter] · sort <by> · skills · spells · map · room · memory · races · classes · offers"));
  out.push(bone("  the machine") + dim("         save · quit · help"));
  return out.join("\n");
}

function obituary(s: GameState): string {
  const out: string[] = ["", rule("CRAWLER TERMINATED")];
  out.push(bold(blood(`  ${s.crawler.name}`)));
  out.push(
    wrap(
      `Crawler #${s.crawler.number}. Level ${s.crawler.level}. Died on floor ${s.floor.n} after ${s.elapsed.toFixed(1)} hours. ${s.crawler.death?.cause ?? ""}`,
      2,
    ),
  );
  out.push("");
  const rows: [string, string | number][] = [
    ["floors survived", s.floor.n - 1],
    ["level reached", s.crawler.level],
    ["kills", s.counters.kills],
    ["bosses", s.counters.bossKills],
    ["places cleared", s.counters.roomsCleared],
    ["boxes opened", s.counters.boxesOpened],
    ["achievements", s.achievements.length],
    ["views", s.ratings.views.toLocaleString()],
    ["bounty at death", s.crawler.bounty.toLocaleString()],
    ["crawlers still alive", s.world.crawlersLeft.toLocaleString()],
  ];
  for (const [k, val] of rows) out.push(`  ${dim(k.padEnd(22))} ${bone(String(val))}`);
  const lost = s.companions.filter((cm) => !cm.alive);
  if (lost.length) out.push(`  ${dim("lost".padEnd(22))} ${blood(lost.map((cm) => cm.name).join(", "))}`);
  out.push("");
  out.push(dim(wrap(`Seed ${s.seed}. The whole run replays from that number, exactly, if you ever want to know whether it was you or the dice.`, 2)));
  return out.join("\n");
}

async function save(game: Game): Promise<void> {
  await writeFile(SAVE_PATH, JSON.stringify(game.save()), "utf8");
}

await main();
