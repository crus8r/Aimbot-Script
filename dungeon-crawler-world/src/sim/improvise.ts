import type { GameState } from "../core/types.ts";
import type { Command } from "./game.ts";
import { crawlerOf, hostilesOf, living, zoneDistance, zoneOf } from "./tactics.ts";

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

const has = (text: string, ...words: string[]): boolean =>
  words.some((w) => new RegExp(`\\b${w}`, "i").test(text));

export function interpret(state: GameState, raw: string): Interpretation {
  const text = raw.trim().toLowerCase();
  if (!text) return { command: null, note: "You would have to say what." };

  const enc = state.encounter && !state.encounter.finished ? state.encounter : null;
  const node = enc
    ? state.floor.nodes[enc.nodeId]!
    : state.floor.nodes[state.floor.at]!;
  const me = enc ? crawlerOf(enc) : null;

  /* --- something you are carrying, named directly ------------------------ */
  const item = state.inventory.find((i) => {
    const words = i.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
    return words.some((w) => text.includes(w));
  });
  if (item) {
    if (item.kind === "explosive" || has(text, "throw", "lob", "chuck", "hurl")) {
      if (item.kind === "explosive" || has(text, "throw", "lob", "chuck", "hurl")) {
        const zone = matchZone(node, text);
        return {
          command: { t: "throw", item: item.iid, zone },
          note: `Throwing ${item.name}${zone ? ` into ${zoneOf(node, zone).name}` : ""}.`,
          practice: "improvised_kill",
        };
      }
    }
    if (item.use && has(text, "drink", "use", "eat", "apply", "bandage", "patch", "dress", "swig", "take")) {
      return { command: { t: "use", item: item.iid }, note: `Using ${item.name}.` };
    }
    if (item.slot && has(text, "wear", "put on", "equip", "wield", "hold", "draw", "grab")) {
      return { command: { t: "equip", item: item.iid }, note: `Equipping ${item.name}.` };
    }
    if (item.use) return { command: { t: "use", item: item.iid }, note: `Using ${item.name}.` };
    if (item.slot) return { command: { t: "equip", item: item.iid }, note: `Equipping ${item.name}.` };
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
  if (enc) {
    const byKind = node.zones
      .flatMap((z) => z.features.filter((f) => !f.spent))
      .find(
        (f) =>
          (has(text, "burn", "light", "ignite", "fire", "torch") && (f.kind === "ignite" || f.kind === "gas")) ||
          (has(text, "collapse", "ceiling", "bring down", "demolish", "blow") && f.kind === "collapse") ||
          (has(text, "push", "topple", "tip", "shove over", "knock over", "drop") && f.kind === "topple") ||
          (has(text, "electr", "cable", "wire", "shock", "current") && f.kind === "electrify") ||
          (has(text, "winch", "hoist", "crane", "rope") && f.kind === "winch"),
      );
    if (byKind) {
      return {
        command: { t: "feature", id: byKind.id },
        note: `Taking that to mean ${byKind.name}.`,
        practice: "env_kill",
      };
    }
  }

  /* --- getting out, talking, shouting ------------------------------------ */
  if (has(text, "run", "flee", "leave", "escape", "get out", "retreat", "withdraw", "back off", "bail")) {
    if (enc) return { command: { t: "flee" }, note: "Breaking off.", practice: "flee_ok" };
    const exit = node.links[0];
    return exit
      ? { command: { t: "go", to: exit.to }, note: "Moving on." }
      : { command: { t: "look" }, note: "Nowhere to go from here." };
  }
  if (has(text, "talk", "negotiat", "surrender", "parley", "deal", "bargain", "plead", "reason", "offer")) {
    return enc
      ? { command: { t: "parley" }, note: "Trying to talk.", practice: "parley" }
      : { command: { t: "look" }, note: "There is nobody here to talk to." };
  }
  if (has(text, "shout", "yell", "threaten", "scare", "roar", "intimidat", "taunt", "insult", "scream")) {
    return enc
      ? { command: { t: "intimidate" }, note: "Making a noise at them." }
      : { command: { t: "look" }, note: "You shout. The room takes it well." };
  }

  /* --- posture ----------------------------------------------------------- */
  if (has(text, "hide", "sneak", "quiet", "conceal", "ambush", "wait for", "lie in wait")) {
    return enc
      ? { command: { t: "brace" }, note: "Nowhere to hide once it has started. Setting yourself instead." }
      : { command: { t: "prep", what: "ambush" }, note: "Getting low and going still.", practice: "ambush" };
  }
  if (has(text, "brace", "block", "guard", "defend", "shield", "hold the", "hold your", "dig in", "set")) {
    return enc
      ? { command: { t: "brace" }, note: "Bracing.", practice: "choke_fight" }
      : { command: { t: "prep", what: "barricade" }, note: "Closing a way in." };
  }
  if (has(text, "aim", "steady", "line up", "sight", "take your time")) {
    return enc ? { command: { t: "aim" }, note: "Steadying." } : { command: { t: "scout", node: node.links[0]?.to ?? "" }, note: "Taking a long look." };
  }
  if (has(text, "trap", "wire", "rig", "tripwire", "snare", "booby")) {
    return enc
      ? { command: { t: "brace" }, note: "No time to rig anything now." }
      : { command: { t: "prep", what: "trap" }, note: "Rigging something.", practice: "trap_kill" };
  }
  if (has(text, "search", "loot", "rummage", "ransack", "look through", "go through", "check the")) {
    return { command: { t: "search" }, note: "Turning the place over." };
  }
  if (has(text, "rest", "breath", "sit", "recover", "bandage myself", "patch up", "sleep")) {
    return { command: enc ? { t: "endturn" } : { t: "prep", what: "breather" }, note: "Taking a moment." };
  }
  if (has(text, "cast", "spell", "magic")) {
    const spell = Object.values(state.spellbook).find((sp) =>
      sp.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && text.includes(w)),
    );
    if (spell) return { command: { t: "cast", spell: spell.id }, note: `Casting ${spell.name}.` };
  }

  /* --- movement ---------------------------------------------------------- */
  const zone = matchZone(node, text);
  if (zone) {
    return enc
      ? { command: { t: "move", zone }, note: `Moving to ${zoneOf(node, zone).name}.` }
      : { command: { t: "look" }, note: "You shift position. Nothing is happening here." };
  }
  if (has(text, "climb", "up", "high ground", "above", "roof", "ledge", "gallery")) {
    const high = node.zones.find((z) => z.tags.includes("high"));
    if (high && enc) {
      return { command: { t: "move", zone: high.id }, note: `Getting up onto ${high.name}.`, practice: "high_ground" };
    }
  }
  if (has(text, "doorway", "door", "choke", "narrow", "corridor", "bottleneck", "funnel")) {
    const choke = node.zones.slice().sort((a, b) => a.capacity - b.capacity)[0];
    if (choke && enc) {
      return { command: { t: "move", zone: choke.id }, note: `Backing into ${choke.name}.`, practice: "choke_fight" };
    }
  }
  if (!enc) {
    const exit = node.links.find((l) => {
      const n = state.floor.nodes[l.to]!;
      return n.name.toLowerCase().split(/\s+/).some((w) => w.length > 4 && text.includes(w)) || text.includes(l.to);
    });
    if (exit) return { command: { t: "go", to: exit.to }, note: `Heading for ${state.floor.nodes[exit.to]!.name}.` };
  }

  /* --- you named a thing, and the thing is not here ---------------------- */
  // Reaching for scenery that does not exist should be told to you plainly.
  // Silently converting it into a punch is how a parser loses somebody's trust.
  if (has(text, "topple", "push over", "shove", "tip over", "knock over", "pull down", "light", "ignite", "set off", "burn", "collapse")) {
    const present = node.zones.flatMap((z) => z.features.filter((f) => !f.spent).map((f) => f.name));
    return {
      command: null,
      note: present.length
        ? `There is nothing here matching that. What is actually in this room: ${present.join(", ")}.`
        : "There is nothing in here to do that to. This room is bare, which is its own kind of bad news.",
    };
  }

  /* --- violence, named or implied ---------------------------------------- */
  if (enc && me) {
    const foes = hostilesOf(enc, me);
    const named = foes.find((f) =>
      f.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && text.includes(w)),
    );
    const unarmed = has(text, "punch", "kick", "headbutt", "bite", "elbow", "knee", "stamp", "strangle", "choke out", "grab", "tackle", "shove", "throttle", "claw");
    const anyViolence =
      unarmed || has(text, "attack", "hit", "strike", "stab", "slash", "swing", "shoot", "fight", "kill", "smash", "club", "cut");

    if (named || anyViolence) {
      const target = named ?? foes.filter((f) => zoneDistance(node, me.zone, f.zone) <= me.reach).sort((a, b) => a.hp - b.hp)[0] ?? foes[0];
      if (!target) return { command: { t: "endturn" }, note: "Nothing left to hit." };
      const gap = zoneDistance(node, me.zone, target.zone);
      if (gap > me.reach) {
        const step = zoneOf(node, me.zone).links.find(
          (l) => zoneDistance(node, l, target.zone) < gap,
        );
        if (step) {
          return {
            command: { t: "move", zone: step },
            note: `${target.name} is ${gap} away. Closing first — say it again to swing.`,
          };
        }
      }
      return {
        command: { t: "attack", target: target.id },
        note: unarmed ? `Going at ${target.name} with your hands.` : `Attacking ${target.name}.`,
        practice: unarmed ? "unarmed_kill" : undefined,
      };
    }
    return { command: { t: "endturn" }, note: "Nothing in that the dungeon can act on, so the round passes." };
  }

  return {
    command: { t: "look" },
    note: "Not something the dungeon knows how to resolve, so it has done nothing and charged you nothing. Try naming a thing in the room, a thing in your pockets, or a direction.",
  };
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
