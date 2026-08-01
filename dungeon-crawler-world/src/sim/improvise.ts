import type { GameState } from "../core/types.ts";
import type { Command } from "./game.ts";
import { crawlerOf, hostilesOf, living, zoneDistance, zoneOf } from "./tactics.ts";
import { BREWS, RECIPES } from "../data/recipes.ts";
import { depositsHere } from "./harvest.ts";
import { MATERIALS } from "../data/materials.ts";

/**
 * Plain English, taken in good faith.
 *
 * The failure mode this exists to kill: a player types something reasonable,
 * the game does not have a verb for it, and instead of finding the nearest
 * legal reading it argues. Beta feedback on the previous build was blunt about
 * this — disputes and item claims came back rules-lawyered when reading what
 * had actually been said would have settled it — and being argued with by a
 * parser is a worse experience than losing.
 *
 * So the default is yes. This interpreter takes an intent, finds the closest
 * thing the simulation can actually resolve, and *says what it understood* so
 * a misreading is visible and correctable in one line rather than being a
 * silent wasted turn. The engine still resolves the outcome; generosity is
 * about understanding you, never about letting you win.
 */

export interface Interpretation {
  command: Command | null;
  /** What the dungeon took you to mean. Always shown. */
  note: string;
  /** A signature to credit, so improvising is itself a thing you get better at. */
  practice?: string;
}

/**
 * Loose match — deliberately a prefix, for stems like "negotiat" or "electr"
 * that need to catch every ending.
 */
const has = (text: string, ...words: string[]): boolean =>
  words.some((w) => new RegExp(`\\b${w}`, "i").test(text));

/**
 * Strict match, both boundaries.
 *
 * `has` was doing all the work, and a prefix match on a short word is a trap:
 * `\bset` fired on "sunset" and "settle", `\brig` on "right", `\bguard` on
 * "guardian", `\bup` on "upgrade". "go right" built a tripwire. "attack the
 * guardian" put up a barricade. Anything short or common belongs here.
 */
const word = (text: string, ...words: string[]): boolean =>
  words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));

/**
 * Strip the way people actually talk down to the instruction underneath it.
 *
 * "i'm gonna look around" is not a different intent from "look around", and a
 * parser that treats it as one is a parser that punishes people for writing
 * naturally — which is the specific thing this module exists to not do.
 */
function normalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(?:ok(?:ay)?|alright|right|so|well|now|then|and|um+|hmm+|erm+)\b[\s,]*/g, "")
    // "can I X" and "let me X" are requests and get stripped to X. "should I X"
    // is not — it is asking whether, and executing it is how you sell the
    // potion somebody was thinking out loud about keeping. That one is caught
    // by DELIBERATIVE below, so it must survive this.
    .replace(
      /\b(?:i'?m gonna|i'?m going to|i am going to|i'?m gonna try|i wanna|i want to|i'?d like to|i would like to|let me|let'?s|i'?ll|i will|i try to|i'?m trying to|i attempt to|i attempt|can i|could i|may i|i think i'?ll|i guess i'?ll|time to|please|i decide to|i am going|i go and|go ahead and)\b\s*/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Somebody saying no is not somebody giving an order. */
const NEGATED = /\b(?:do not|don'?t|dont|won'?t|wont|never mind|nevermind|no need to|not going to|rather not|instead of|stop|hold off)\b/i;

/**
 * Wondering whether, which is not the same as deciding to.
 *
 * "should I sell the potion?" is somebody thinking out loud, and a parser that
 * sells the potion has taken a decision away from them — the same category of
 * mistake as arguing with them, just quieter and more expensive.
 */
const DELIBERATIVE = /^(?:should|shall|would|ought)\b|^(?:is|would) it (?:worth|better|smart|wise)\b|^what if\b|\bdo you (?:think|reckon)\b|\bany (?:point|good)\b|\bworth (?:it|doing|trying)\b/i;

/**
 * Getting a piece of the building out of the building.
 *
 * Long lists because there is no standard word for it and everybody reaches for
 * a different one. Somebody who says "chisel", somebody who says "prise off",
 * and somebody who says "I'll just smash a bit of the wall out" are all asking
 * for the same thing, and only one of those is a verb a parser would guess.
 */
const HARVEST_VERBS = [
  "break", "smash", "chip", "chisel", "pry", "prise", "lever", "crowbar", "jemmy",
  "knock", "dig", "quarr", "mine", "mining", "strip", "harvest", "gouge", "scrape",
  "hack", "cut", "pull", "rip", "tear", "salvage", "claw", "wrench", "lift",
];

/** Words that mean "the room itself" rather than anything standing in it. */
const FABRIC = [
  "wall", "walls", "floor", "floors", "ceiling", "roof", "pillar", "pillars", "column", "columns",
  "masonry", "brickwork", "stonework", "rubble", "seam", "seams", "vein", "veins",
  "joist", "joists", "beam", "beams", "girder", "girders", "pipework", "pipes", "plasterwork", "render",
];

/**
 * Taking something OUT OF the room's own fabric, which nothing else means.
 *
 * "take a pipe off the wall" needs no verb list to be unambiguous — the
 * preposition and the noun do all the work between them.
 */
const OUT_OF_THE_FABRIC =
  /\b(?:out of|off|from|outta)\s+(?:the|that|this|these|those|a|an|some)?\s*(?:wall|walls|floor|ceiling|roof|masonry|brickwork|stonework|pillar|column|rubble|ground|rock|stone|joint|joints|seam|render)\b/i;

/**
 * Does this line name that material?
 *
 * Generous in both directions on purpose. "pipe" has to reach Pipework and
 * "iron scale" has to be reachable by somebody who typed "scale", because a
 * player who describes the thing accurately and gets nothing has been told
 * their accurate description was the wrong password.
 */
function nameMatches(text: string, matName: string): boolean {
  const name = matName.toLowerCase();
  if (text.includes(name)) return true;
  return name
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .some((w) => new RegExp(`\\b${w.slice(0, Math.max(4, w.length - 4))}[a-z]*\\b`, "i").test(text));
}

/** "three blocks", "a couple of lengths", "as much as I can carry". */
function numberIn(text: string): number | undefined {
  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, couple: 2, pair: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12,
  };
  if (/\b(?:as much as|all the|everything|as many as|load of|loads of|whole lot)\b/i.test(text)) return 12;
  const digits = /\b(\d{1,2})\b/.exec(text);
  if (digits) return Math.max(1, Math.min(12, parseInt(digits[1]!, 10)));
  for (const [w, n] of Object.entries(words)) {
    if (w.length > 2 && new RegExp(`\\b${w}\\b`, "i").test(text)) return n;
  }
  return undefined;
}

export function interpret(state: GameState, raw: string): Interpretation {
  const whole = normalise(raw);
  if (!whole) return { command: null, note: "You would have to say what." };

  // One instruction at a time, but never silently: dropping the second half of
  // what somebody typed without telling them is how a turn gets wasted.
  const clauses = whole.split(/\s*(?:,|;|\bthen\b|\band then\b|\bafter that\b|\band after\b)\s*/).filter(Boolean);
  const text = clauses[0] ?? whole;
  const rest = clauses.slice(1).join(", ");
  const also = rest ? ` Doing the first part only — say "${rest}" next and it will happen.` : "";
  const out = (i: Interpretation): Interpretation => ({ ...i, note: i.note + also });

  const enc = state.encounter && !state.encounter.finished ? state.encounter : null;
  const node = enc
    ? state.floor.nodes[enc.nodeId]!
    : state.floor.nodes[state.floor.at]!;
  const me = enc ? crawlerOf(enc) : null;
  const featuresHere = () => node.zones.flatMap((z) => z.features.filter((f) => !f.spent).map((f) => f.name));

  if (NEGATED.test(text)) {
    return out({
      command: null,
      note: "Read that as you telling the dungeon not to. Nothing done, nothing spent, no time gone. Say what you do want instead.",
    });
  }

  if (DELIBERATIVE.test(text)) {
    return out({
      command: null,
      note: "Read that as you weighing it up rather than doing it, so nothing has happened. Say it as an instruction and it will.",
    });
  }

  /* --- looking at things ------------------------------------------------- */
  // First, before anything else, and that placement is load-bearing: lower down
  // it gets eaten by "check the" (search), "ceiling" (collapse the roof),
  // "door" (back into the doorway), and by the item block. Asking about the
  // ceiling is not asking to bring it down.
  if (
    word(text, "look", "examine", "inspect", "study", "survey", "observe", "scan", "peer", "describe", "read") ||
    has(text, "surroundings", "what do i see", "what does it", "what is this", "what's this", "what is it", "what's it",
      "what is the", "what's the", "what are the", "made of", "how big", "how far", "how high", "how deep", "how thick",
      "how wide", "how long is", "how many", "what colour", "what color", "tell me about", "size up", "get a look")
  ) {
    // "look through the wreckage" is rummaging. "look around" is looking.
    if (has(text, "look through", "go through", "rummage", "ransack", "look in the", "search")) {
      return out({ command: { t: "search" }, note: "Turning the place over properly." });
    }
    const subject = subjectOf(text);
    return out({
      command: { t: "examine", what: subject },
      note: subject ? `Taking a proper look at ${subject}.` : "Taking the room in.",
    });
  }

  /* --- asking how you are ------------------------------------------------ */
  if (
    has(text, "how am i", "am i hurt", "am i ok", "am i alright", "am i badly", "my health", "my hp", "how much health",
      "how hurt", "my mana", "my stamina", "my stats", "what level", "how am i doing", "my condition", "state of me",
      "what am i carrying", "what do i have", "my inventory", "in my bag", "in my pockets", "my gold", "how much gold",
      "what am i wearing", "my gear", "my kit", "how long do i have", "how much time")
  ) {
    return out({ command: { t: "examine", what: "me" }, note: "Taking stock." });
  }

  /* --- the things gold and a bench are for ------------------------------- */
  // Above the flee/talk branches on purpose: "leave" would steal "grab what I
  // need then leave", and "deal" would steal half of every shop sentence.
  if (!enc) {
    if (has(text, "open the box", "open my box", "open boxes", "open my loot", "loot box", "open the loot")) {
      return out({ command: { t: "open" }, note: "Opening what you have been carrying." });
    }
    if (has(text, "buy a room", "personal space", "buy the space", "my own room", "buy a space")) {
      return out({ command: { t: "buySpace" }, note: "Asking about a room of your own." });
    }
    if (has(text, "install", "set up a bench", "buy a bench", "buy the bench", "buy an alchemy", "buy an ordnance", "buy a forge")) {
      const bench = ["alchemy", "engineering", "ordnance", "forge"].find((b) => text.includes(b));
      return out({ command: { t: "install", what: bench ?? "" }, note: bench ? `Installing the ${bench} bench.` : "Which bench?" });
    }
    if (has(text, "upgrade")) {
      const up = ["bed", "stores", "garden", "armoury", "armory"].find((u) => text.includes(u));
      return out({ command: { t: "upgrade", what: up === "armory" ? "armoury" : up ?? "" }, note: up ? `Buying the ${up}.` : "Which upgrade?" });
    }
    if (has(text, "experiment", "mess about at the bench", "try to work out", "figure out a recipe")) {
      return out({ command: { t: "experiment" }, note: "Hours at the bench, burning materials, to find out something you did not know." });
    }
    if (has(text, "craft", "build", "make a", "make me", "assemble", "put together", "fabricate")) {
      const r = RECIPES.find((x) => x.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && text.includes(w)));
      if (r) return out({ command: { t: "craft", what: r.id }, note: `Building ${r.name}.` });
    }
    if (has(text, "brew", "distil", "distill", "cook up", "mix up")) {
      const b = BREWS.find((x) => x.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && text.includes(w)));
      return out(
        b
          ? { command: { t: "brew", what: b.id }, note: `Brewing ${b.name}.` }
          : { command: { t: "brew", what: "brew_health" }, note: "Brewing health potions, as the obvious default." },
      );
    }
    if (has(text, "sell everything", "sell the junk", "sell my junk", "sell all", "flog")) {
      return out({ command: { t: "sell", what: "junk" }, note: "Selling everything worthless and unlocked." });
    }
    if (has(text, "shop", "browse", "what's for sale", "whats for sale", "see the stock", "trader", "vendor")) {
      return out({ command: { t: "shop" }, note: "Seeing what is for sale." });
    }
    if (has(text, "buy")) {
      return out({ command: { t: "buy", what: text.replace(/.*\bbuy\b\s*(?:a|an|some|the)?\s*/, "").trim() }, note: "Buying." });
    }
    if (has(text, "equip the best", "wear the best", "best gear", "gear up", "kit up", "optimise my gear", "optimize my gear")) {
      return out({ command: { t: "equipBest" }, note: "Putting on the best of what you carry." });
    }
    if (has(text, "drop the junk", "drop junk", "bin the junk", "ditch the junk", "lighten the load", "too heavy")) {
      return out({ command: { t: "dropJunk" }, note: "Everything worthless and unlocked, on the floor." });
    }
    if (has(text, "go down", "take the stairs", "descend", "next floor", "downstairs", "head down")) {
      return out({ command: { t: "descend" }, note: "Taking the stairs down." });
    }
    if (has(text, "spend my points", "spend points", "level up my")) {
      const stat = (["str", "dex", "con", "int", "cha"] as const).find((k) => text.includes(k)) ??
        (has(text, "strength") ? "str" : has(text, "dexter") ? "dex" : has(text, "constitution", "health", "tough") ? "con"
          : has(text, "intellig", "smart") ? "int" : has(text, "charisma") ? "cha" : null);
      if (stat) return out({ command: { t: "spend", stat }, note: `A point into ${stat.toUpperCase()}.` });
    }
    if (has(text, "wait", "kill time", "pass the time", "hang about", "sit tight")) {
      return out({ command: { t: "wait", hours: 1 }, note: "An hour, gone." });
    }
  }

  /* --- taking the place apart -------------------------------------------- */
  // Above the item block on purpose. "take the pipe off the wall" while you are
  // already carrying a length of pipe must mean the one in the wall, and an
  // item match would quietly turn it into a question about the one in your bag.
  {
    // Match against the whole catalogue rather than only what happens to be in
    // this room. Naming limestone in a room with no limestone must reach the
    // verb and be told so by name, not silently become "have some brick" —
    // being quietly given something else is worse than being told no.
    const named = MATERIALS.find((mat) => nameMatches(text, mat.name));
    const here = named
      ? depositsHere(state, node).flatMap(({ deposits }) => deposits).find((d) => d.mat.id === named.id)
      : undefined;

    const verb = has(text, ...HARVEST_VERBS);
    const outOf = OUT_OF_THE_FABRIC.test(text);
    const fabric = word(text, ...FABRIC);
    const bare = /^(?:harvest|quarry|mine|salvage|dig)\b/.test(text);

    // Mid-fight the bar is much higher. "break" and "cut" and "pull" are also
    // how people describe hitting things, and a branch that eats those to
    // refuse them politely has still eaten them — so in an encounter only the
    // unmistakable phrasings come here and everything else falls through to
    // the attack and feature readings below.
    const explicit = bare || outOf;
    if (explicit || (!enc && ((verb && (named || fabric)) || (here && has(text, "take", "get", "grab", "collect", "gather"))))) {
      if (enc) {
        return out({
          command: null,
          note: "Not with something in the room trying to kill you — it wants both hands and a long time. Nothing spent, nothing lost. Finish this first.",
        });
      }
      return out({
        command: { t: "harvest", what: named?.name.toLowerCase(), qty: numberIn(text) },
        note: here
          ? `Working ${here.mat.name.toLowerCase()} out of ${here.mat.tags.includes("metal") ? "the fixings" : "the fabric of the place"}.`
          : named
            ? `Looking for ${named.name.toLowerCase()} in here.`
            : "Taking the most useful thing in here out of the wall it is part of.",
        practice: "quarrying",
      });
    }
  }

  /* --- something you are carrying, named with a verb --------------------- */
  const item = state.inventory.find((i) => {
    const words = i.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
    return words.some((w) => text.includes(w));
  });
  if (item) {
    if (has(text, "throw", "lob", "chuck", "hurl") || (item.kind === "explosive" && has(text, "use", "set off", "deploy", "light"))) {
      const zone = matchZone(node, text);
      return out({
        command: item.device ? { t: "deploy", item: item.iid } : { t: "throw", item: item.iid, zone },
        note: `Throwing ${item.name}${zone ? ` into ${zoneOf(node, zone).name}` : ""}.`,
        practice: "improvised_kill",
      });
    }
    if (item.use && has(text, "drink", "use", "eat", "apply", "bandage", "patch", "dress", "swig", "take", "quaff", "chug")) {
      return out({ command: { t: "use", item: item.iid }, note: `Using ${item.name}.` });
    }
    if (item.slot && has(text, "wear", "put on", "equip", "wield", "hold", "draw", "ready", "swap to", "switch to")) {
      return out({ command: { t: "equip", item: item.iid }, note: `Equipping ${item.name}.` });
    }
    if (has(text, "sell")) return out({ command: { t: "sell", what: item.iid }, note: `Selling ${item.name}.` });
    if (has(text, "drop", "bin", "ditch", "leave behind")) {
      return out({ command: { t: "drop", item: item.iid }, note: `Dropping ${item.name}.` });
    }
    if (has(text, "lock", "protect", "keep hold of")) {
      return out({ command: { t: "lock", item: item.iid }, note: `Locking ${item.name} against bulk operations.` });
    }
    // Named it and nothing else. Naming a thing is not using it — that rule
    // is why mentioning a potion no longer drinks it.
    return out({
      command: { t: "examine", what: item.iid },
      note: `You have ${item.name}${item.equipped ? ", equipped" : ""}. Say what to do with it — drink, wear, throw, sell, drop.`,
    });
  }

  /* --- something in the room -------------------------------------------- */
  const feature = node.zones
    .flatMap((z) => z.features.filter((f) => !f.spent))
    .find((f) => {
      const words = f.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
      return words.some((w) => text.includes(w));
    });
  if (feature) {
    return {
      command: enc ? { t: "feature", id: feature.id } : null,
      note: enc
        ? `Going for ${feature.name}.`
        : `${feature.name} is worth remembering, but there is nobody here to drop it on.`,
      practice: "env_kill",
    };
  }
  // Named the *kind* of thing rather than the thing: fire, collapse, water.
  // Every one of these needs a verb as well as the noun, because "how high is
  // the ceiling" must never bring the ceiling down.
  if (enc) {
    const byKind = node.zones
      .flatMap((z) => z.features.filter((f) => !f.spent))
      .find(
        (f) =>
          (has(text, "burn", "ignite", "set fire", "set light", "torch") && (f.kind === "ignite" || f.kind === "gas")) ||
          (has(text, "collapse", "bring down", "cave in", "demolish") && f.kind === "collapse") ||
          (has(text, "topple", "push over", "tip over", "knock over", "shove over", "pull down") && f.kind === "topple") ||
          (has(text, "electrif", "electrocut", "shock them", "live cable", "current") && f.kind === "electrify") ||
          (has(text, "winch", "hoist", "crane", "release the") && f.kind === "winch"),
      );
    if (byKind) {
      return out({
        command: { t: "feature", id: byKind.id },
        note: `Taking that to mean ${byKind.name}.`,
        practice: "env_kill",
      });
    }
  }

  /* --- getting out, talking, shouting ------------------------------------ */
  if (word(text, "run", "flee", "escape", "retreat", "withdraw", "bail", "leg it") || has(text, "get out", "back off", "get away", "leave the room", "leave the fight")) {
    if (enc) return out({ command: { t: "flee" }, note: "Breaking off.", practice: "flee_ok" });
    const exit = node.links[0];
    return out(
      exit
        ? { command: { t: "go", to: exit.to }, note: "Moving on." }
        : { command: { t: "look" }, note: "Nowhere to go from here." },
    );
  }
  if (word(text, "talk", "surrender", "parley", "bargain", "plead", "negotiate") || has(text, "negotiat", "make a deal", "reason with", "offer them", "give up")) {
    return out(
      enc
        ? { command: { t: "parley" }, note: "Trying to talk.", practice: "parley" }
        : { command: { t: "look" }, note: "There is nobody here to talk to." },
    );
  }
  if (word(text, "shout", "yell", "threaten", "scare", "roar", "taunt", "insult", "scream") || has(text, "intimidat")) {
    return out(
      enc
        ? { command: { t: "intimidate" }, note: "Making a noise at them." }
        : { command: { t: "look" }, note: "You shout. The room takes it well." },
    );
  }

  /* --- posture ----------------------------------------------------------- */
  if (word(text, "hide", "sneak", "conceal", "ambush") || has(text, "keep quiet", "stay quiet", "lie in wait", "wait for them")) {
    return out(
      enc
        ? { command: { t: "brace" }, note: "Nowhere to hide once it has started. Setting yourself instead." }
        : { command: { t: "prep", what: "ambush" }, note: "Getting low and going still.", practice: "ambush" },
    );
  }
  if (word(text, "brace", "block", "defend", "dodge", "duck", "parry", "evade", "barricade") || has(text, "hold the", "hold your", "dig in", "raise my shield", "shield up")) {
    return out(
      enc
        ? { command: { t: "brace" }, note: "Bracing.", practice: "choke_fight" }
        : { command: { t: "prep", what: "barricade" }, note: "Closing a way in." },
    );
  }
  if (word(text, "aim", "steady") || has(text, "line up", "take my time", "take aim")) {
    return out(
      enc
        ? { command: { t: "aim" }, note: "Steadying." }
        : { command: { t: "scout", node: node.links[0]?.to ?? "" }, note: "Taking a long look at what is ahead." },
    );
  }
  if (word(text, "trap", "tripwire", "snare", "rig") || has(text, "booby")) {
    return out(
      enc
        ? { command: { t: "brace" }, note: "No time to rig anything now. Setting yourself instead." }
        : { command: { t: "prep", what: "trap" }, note: "Rigging something.", practice: "trap_kill" },
    );
  }
  if (word(text, "search", "loot", "rummage", "ransack", "scavenge") || has(text, "look through", "go through", "check the", "turn the place")) {
    return out(
      enc
        ? { command: null, note: "Not while this is going on. Nothing spent — you can pick the place over once it is finished." }
        : { command: { t: "search" }, note: "Turning the place over." },
    );
  }
  if (word(text, "rest", "sleep", "nap", "recover", "recuperate") || has(text, "catch my breath", "get my breath", "patch up", "sit down", "take a breather")) {
    return out(
      enc
        ? { command: { t: "brace" }, note: "Not in the middle of this. Setting yourself instead." }
        : { command: { t: has(text, "sleep", "nap") ? "rest" : "prep", what: "breather" } as Command, note: "Taking a moment." },
    );
  }
  if (word(text, "eat", "food", "meal") || has(text, "hungry", "get something to eat")) {
    if (!enc) return out({ command: { t: "eat" }, note: "Eating." });
  }
  if (word(text, "cast", "spell", "magic", "conjure")) {
    const spell = Object.values(state.spellbook).find((sp) =>
      sp.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && text.includes(w)),
    );
    if (spell) return out({ command: { t: "cast", spell: spell.id }, note: `Casting ${spell.name}.` });
    const known = Object.values(state.spellbook);
    return out({
      command: null,
      note: known.length
        ? `Which one? You know ${known.map((sp) => sp.name).join(", ")}.`
        : "You do not know any spells. They come from tomes and shrines.",
    });
  }

  /* --- movement ---------------------------------------------------------- */
  const zone = matchZone(node, text);
  if (zone) {
    return out(
      enc
        ? { command: { t: "move", zone }, note: `Moving to ${zoneOf(node, zone).name}.` }
        : { command: { t: "examine", what: zone }, note: `Nothing is happening in here, so that is just a look at ${zoneOf(node, zone).name}.` },
    );
  }
  if (enc && (word(text, "climb", "above", "roof", "ledge", "gallery") || has(text, "high ground", "get up on", "get high"))) {
    const high = node.zones.find((z) => z.tags.includes("high"));
    if (high) {
      return out({ command: { t: "move", zone: high.id }, note: `Getting up onto ${high.name}.`, practice: "high_ground" });
    }
  }
  if (enc && (word(text, "doorway", "door", "choke", "narrow", "corridor", "bottleneck", "funnel") || has(text, "back into", "back up to"))) {
    const choke = node.zones.slice().sort((a, b) => a.capacity - b.capacity)[0];
    if (choke) {
      return out({ command: { t: "move", zone: choke.id }, note: `Backing into ${choke.name}.`, practice: "choke_fight" });
    }
  }
  if (!enc) {
    const exit = node.links.find((l) => {
      const n = state.floor.nodes[l.to]!;
      return n.name.toLowerCase().split(/\s+/).some((w) => w.length > 4 && text.includes(w)) || text.includes(l.to);
    });
    if (exit) return out({ command: { t: "go", to: exit.to }, note: `Heading for ${state.floor.nodes[exit.to]!.name}.` });
  }

  /* --- you named a thing, and the thing is not here ---------------------- */
  // Reaching for scenery that does not exist should be told to you plainly.
  // Silently converting it into a punch is how a parser loses somebody's trust.
  if (word(text, "topple", "ignite", "burn", "collapse") || has(text, "push over", "tip over", "knock over", "pull down", "set off", "set fire")) {
    const present = featuresHere();
    return out({
      command: null,
      note: present.length
        ? `There is nothing here matching that. What is actually in this room: ${present.join(", ")}. Nothing spent.`
        : "There is nothing in here to do that to. This room is bare, which is its own kind of bad news. Nothing spent.",
    });
  }

  /* --- violence, named or implied ---------------------------------------- */
  if (enc && me) {
    const foes = hostilesOf(enc, me);
    const named = foes.find((f) =>
      f.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && text.includes(w)),
    );
    const unarmed = word(text, "punch", "kick", "headbutt", "bite", "elbow", "knee", "stamp", "strangle", "tackle", "shove", "throttle", "claw") || has(text, "choke out", "bare hands", "with my hands");
    const anyViolence =
      unarmed ||
      word(text, "attack", "hit", "strike", "stab", "slash", "swing", "shoot", "fight", "kill", "smash", "club", "cut", "finish", "stick",
        // People do not say "attack". They say what they are doing to it, and a
        // parser that only knows the word "attack" is a parser that refuses
        // "break its legs" and then explains that it could have said "attack".
        "break", "bash", "batter", "beat", "chop", "cleave", "crush", "gut", "hack", "hammer", "impale",
        "jab", "lunge", "maim", "pierce", "rip", "run through", "skewer", "slam", "slice", "spear",
        "stomp", "thrust", "wallop", "whack", "wreck", "brain", "behead", "decapitate", "disembowel") ||
      has(text, "go for", "lay into", "keep fighting", "same again", "have another", "press the attack", "put it down", "take it down", "finish it");

    if (named || anyViolence) {
      const target = named ?? foes.filter((f) => zoneDistance(node, me.zone, f.zone) <= me.reach).sort((a, b) => a.hp - b.hp)[0] ?? foes[0];
      if (!target) return out({ command: { t: "endturn" }, note: "Nothing left to hit." });
      const gap = zoneDistance(node, me.zone, target.zone);
      if (gap > me.reach) {
        const step = zoneOf(node, me.zone).links.find(
          (l) => zoneDistance(node, l, target.zone) < gap,
        );
        if (step) {
          return out({
            command: { t: "move", zone: step },
            note: `${target.name} is ${gap} away. Closing first — say it again to swing.`,
          });
        }
      }
      // A called shot is somebody naming a PART. All of these are worse odds
      // and ignore armour, and the list is long because anatomy is long.
      const called =
        has(text, "aimed shot", "called shot", "point blank", "between the eyes", "hamstring", "kneecap") ||
        /\b(?:in|at|to|for|through)\s+(?:the|its|his|her|their)\s+\w+|\b(?:its|his|her|their)\s+(?:head|face|eye|eyes|throat|neck|leg|legs|knee|knees|arm|arms|hand|hands|wing|wings|tail|joint|joints|ankle|ankles|tendon|tendons|spine|back|gut|guts|belly|heart|mouth|jaw|skull|wound)\b/i.test(text);
      return out({
        command: { t: "attack", target: target.id, called },
        note: called
          ? `Aiming for something specific on ${target.name}. Much harder to land, and it ignores armour entirely.`
          : unarmed
            ? `Going at ${target.name} with your hands.`
            : `Attacking ${target.name}.`,
        practice: unarmed ? "unarmed_kill" : undefined,
      });
    }

    // The one place passing the round is the correct reading, and it has to be
    // asked for explicitly.
    if (word(text, "pass", "skip") || has(text, "do nothing", "wait and see", "hold my turn", "end my turn", "end turn")) {
      return out({ command: { t: "endturn" }, note: "Holding. The round passes." });
    }

    // Everything else: understood or not, it does NOT cost you the round.
    // Handing the monster a free swing because a sentence did not parse is the
    // worst thing this file could do, and it is what it used to do.
    const opts = [
      "attack something",
      enc.actions.move > 0 ? "move" : null,
      "brace",
      "aim",
      featuresHere().length ? `use ${featuresHere().join(" or ")}` : null,
      "talk",
      "break off",
    ].filter(Boolean);
    return out({
      command: null,
      note: `Not something that can be done to ${foes.map((f) => f.name).join(" or ")}. Nothing spent, and the round is still yours — you can ${opts.join(", ")}.`,
    });
  }

  // Swinging at an empty room. Say that, rather than shrugging.
  if (word(text, "attack", "hit", "kill", "fight", "punch", "kick", "stab", "shoot", "swing", "smash")) {
    const waiting = !node.cleared && (node.spawn.length > 0 || node.boss);
    return out({
      command: null,
      note: waiting
        ? "There is something in here, but the fight has not started. Engage first, and you get the opening move."
        : "There is nothing in here to fight. Nothing spent.",
    });
  }

  // Out of combat, the honest fallback is the room, and it should say that is
  // what it did rather than claiming it did nothing.
  const present = featuresHere();
  const ways = node.links
    .filter((l) => l.known || state.floor.nodes[l.to]!.visited)
    .map((l) => state.floor.nodes[l.to]!.name);
  return out({
    command: { t: "examine" },
    note: `Not sure what you meant, so here is the room again — free, and no time gone. ${
      present.length ? `In here: ${present.join(", ")}.` : "Nothing loose in here."
    }${ways.length ? ` Ways out: ${ways.join(", ")}.` : ""}`,
  });
}

/**
 * What somebody is looking at, once the looking words are taken off the front.
 * "examine the ruptured gas main" → "the ruptured gas main".
 *
 * Conservative on purpose. "i look around and see what the walls and floors are
 * made of" is one sentence with a verb in the middle of it, and taking
 * everything after the first "look" as the name of an object produced
 * `You look for "and see what the walls and floors are"` — technically a
 * faithful reading, and useless. When in doubt this returns nothing, which
 * means the whole room, which is the answer that sentence wanted.
 */
function subjectOf(text: string): string | undefined {
  const m = /\b(?:look(?:ing)?(?: at| in| inside| over)?|examine|inspect|study|survey|observe|scan|check|describe|read|what(?:'s| is| are)|tell me about|size up)\b\s*(.*)$/i.exec(text);
  let rest = (m?.[1] ?? "")
    // A new verb ends the noun phrase. Everything past it is a second thought.
    .replace(/\b(?:and|then|so|to)\s+(?:see|tell|check|look|find|know|work out|figure)\b.*$/i, "")
    .replace(/\b(?:made of|made from|look like|looks like|consist)\b.*$/i, "")
    .replace(/\b(?:is|are|was|were)\b\s*$/i, "")
    .replace(/[?.!]+$/, "")
    .trim();

  // Leading filler comes off in a loop, because "at the" and "in this" stack.
  let prev = "";
  while (rest !== prev) {
    prev = rest;
    rest = rest.replace(/^(?:at|the|a|an|my|this|that|these|those|is|are|it|to|into|in|on|around|about|and|of|for)\b\s*/i, "").trim();
  }

  if (!rest) return undefined;
  if (/^(around|round|about|here|room|place|everything|things|stuff|it|anything|something)$/i.test(rest)) return undefined;
  // A name, not a sentence. Anything longer is somebody thinking out loud.
  if (rest.split(/\s+/).length > 4) return undefined;
  return rest;
}

function matchZone(node: { zones: { id: string; name: string }[] }, text: string): string | undefined {
  const z = node.zones.find((zz) => {
    const words = zz.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => text.includes(w));
  });
  return z?.id;
}

/* ---------------------------------------------------------------- claims */

export interface ClaimRuling {
  granted: boolean;
  note: string;
}

const MAGICAL = /enchant|magic|spell|rune|blessed|cursed|glowing|arcane|holy|divine/i;
const DUNGEON = /potion|scroll|tome|loot box|dungeon|gold coin|mana/i;
const SERIOUS_WEAPON = /\b(gun|pistol|rifle|shotgun|revolver|grenade|explosive|dynamite|c4|sword|katana|machete|axe|crossbow|taser)\b/i;

/**
 * Emptying your pockets.
 *
 * The default is YES and it is not close. Everybody was carrying a dozen
 * unremarkable objects when the buildings came down and almost none of them
 * were itemised at intake: a wallet has cards and a photograph, keys have a
 * bottle opener, a coat has a pen and an old ticket, a smoker has a lighter, a
 * tradesman has the small tool they always had.
 *
 * The test that matters is whether the justification describes their LIFE or
 * their PREDICAMENT. A life gets a yes. A crowbar requested in the exact
 * minute they met a stuck door gets a no, and it is allowed to enjoy saying so.
 * Being the fourth thing asked for is not grounds; people have full pockets.
 */
export function ruleOnClaim(state: GameState, what: string, why: string): ClaimRuling {
  const item = what.trim();
  const reason = why.trim();
  const both = `${item} ${reason}`;

  if (MAGICAL.test(item) || DUNGEON.test(item)) {
    return {
      granted: false,
      note: "No. That came from down here, or from somewhere stranger, and the only way you get one of those is the way everybody else does.",
    };
  }
  if (SERIOUS_WEAPON.test(item) && !new RegExp(SERIOUS_WEAPON.source, "i").test(state.crawler.origin.job + state.crawler.origin.hobby)) {
    return {
      granted: false,
      note: "No. You did not walk out of your house at three in the morning with that, and the intake form agrees with me.",
    };
  }

  // Reverse-engineered from the room in front of them rather than from a life.
  const node = state.floor.nodes[state.floor.at]!;
  const roomWords = `${node.name} ${node.zones.flatMap((z) => z.features.map((f) => f.name)).join(" ")}`.toLowerCase();
  const solvesThisExactProblem =
    reason.length < 12 ||
    item
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.length > 4 && roomWords.includes(w));
  if (solvesThisExactProblem && reason.length < 12) {
    return {
      granted: false,
      note: "Tell me about your life, not about your afternoon. Why did you have it, not why do you want it.",
    };
  }

  if (state.claims >= 4) {
    return {
      granted: false,
      note: "Four already. Your pockets are not a category error, they are trousers. Ask again on the next floor.",
    };
  }

  state.claims++;
  return {
    granted: true,
    note: `Fine. Of course you had ${/^(a|an|the|some|my)\b/i.test(item) ? item : `a ${item}`}. It is now a logged asset of Dungeon Crawler World, which is the single most humiliating thing to have happened to it.`,
  };
}
