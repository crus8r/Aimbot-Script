import type { Hook, MintedSkill } from "../core/hooks.ts";

/**
 * Skills the dungeon works out for itself.
 *
 * The books are explicit that there are hundreds of skills and nobody has the
 * list. You cannot author that, and pretending to is how you end up with
 * forty-six entries where most are a name and a joke. So instead the engine
 * watches what you keep doing, and when a pattern is undeniable it starts
 * keeping track.
 *
 * A signature is a thing the simulation can observe without being told. Cross
 * the threshold with no existing skill covering it and a skill is minted, with
 * real hooks, permanently, and the System AI takes the credit.
 */

export interface PracticeDef {
  /** The signature the simulation increments. */
  id: string;
  /** How many times before the dungeon admits it is a pattern. */
  threshold: number;
  group: MintedSkill["group"];
  /** Name variants, so two crawlers who do the same thing rarely get the same
   *  word for it. A language model can override this; it is not required to. */
  names: string[];
  hooks: Hook[];
  desc: string;
  /** How the notification explains itself. */
  origin: string;
  /** If the crawler already has one of these, the pattern is already covered
   *  and nothing is minted. */
  coveredBy?: string[];
}

export const PRACTICE: readonly PracticeDef[] = [
  {
    id: "choke_fight", threshold: 6, group: "combat",
    names: ["Doorway Work", "Holding the Line", "Corridor Fighting", "The Narrow Place", "Threshold Discipline"],
    hooks: [{ k: "accuracy", when: "choke", v: 1 }, { k: "defense", when: "choke", v: 1 }],
    desc: "You fight better in a gap than in a room, and the difference is now measurable.",
    origin: "You keep putting your back in a doorway and making things come to you one at a time.",
    coveredBy: ["shield", "polearm"],
  },
  {
    id: "env_kill", threshold: 3, group: "combat",
    names: ["Structural Persuasion", "Applied Architecture", "Load-Bearing Opinions", "The Room Did It", "Site Safety"],
    hooks: [{ k: "feature", v: 2 }, { k: "spectacle", v: 0.08 }],
    desc: "You are unusually good at convincing a building to participate.",
    origin: "Three separate things have now been killed by the room rather than by you, which the audience has noticed.",
    coveredBy: ["demolitions", "engineering"],
  },
  {
    id: "outnumbered_win", threshold: 4, group: "combat",
    names: ["Crowd Control", "One Against Several", "Bad Odds", "Multiple Simultaneous Opinions"],
    hooks: [{ k: "defense", when: "outnumbered", v: 1 }, { k: "damage", when: "outnumbered", v: 1 }],
    desc: "Being surrounded has stopped being a surprise and started being a situation.",
    origin: "You keep winning fights you were losing on arithmetic.",
  },
  {
    id: "low_hp_win", threshold: 3, group: "survival",
    names: ["Last Legs", "Running on Fumes", "The Second Wind", "Spite", "Unfinished Business"],
    hooks: [{ k: "damage", when: "wounded", v: 2 }, { k: "lastStand", v: 1 }],
    desc: "You are more dangerous nearly dead than most people are healthy, which is a diagnosis rather than a compliment.",
    origin: "You have now finished three fights on health you could count on one hand.",
    coveredBy: ["pain_tolerance"],
  },
  {
    id: "punch_up", threshold: 3, group: "combat",
    names: ["Giant Killer", "Punching Up", "Weight Class Denial", "The Bigger They Are"],
    hooks: [{ k: "accuracy", when: "vs_higher", v: 1 }, { k: "damage", when: "vs_higher", v: 2 }],
    desc: "Things above your level have stopped being a category and started being a preference.",
    origin: "You have killed three things the arithmetic did not allow for.",
  },
  {
    id: "fire", threshold: 4, group: "craft",
    names: ["Arson", "Accelerant Familiarity", "The Fire Habit", "Combustion Studies"],
    hooks: [{ k: "damage", when: "fire", v: 2 }, { k: "resist", tag: "fire", v: 1 }],
    desc: "You keep reaching for fire, and fire has started reaching back less.",
    origin: "The system has been counting the fires. There have been a lot of fires.",
    coveredBy: ["alchemy"],
  },
  {
    id: "ambush", threshold: 4, group: "survival",
    names: ["Patient Work", "Opening Move", "The Long Wait", "First Contact"],
    hooks: [{ k: "damage", when: "hidden", v: 3 }, { k: "stealth", v: 1 }],
    desc: "The first thing you do in a fight has become the most important thing you do in a fight.",
    origin: "You have opened four fights before anybody knew there was one.",
    coveredBy: ["first_strike"],
  },
  {
    id: "flee_ok", threshold: 4, group: "survival",
    names: ["Tactical Withdrawal", "Knowing When", "Discretion", "The Exit Strategy", "Live To Be Boring"],
    hooks: [{ k: "flee", v: 3 }, { k: "initiative", v: 1 }],
    desc: "You have got very good at the part everybody else is too proud to practise.",
    origin: "Four clean escapes. The name of this skill is not up for negotiation.",
    coveredBy: ["sprint"],
  },
  {
    id: "improvised_kill", threshold: 5, group: "combat",
    names: ["Whatever Came To Hand", "Found Objects", "Improvised Ordnance", "The Nearest Heavy Thing"],
    hooks: [{ k: "damage", when: "improvised", v: 2 }, { k: "accuracy", when: "improvised", v: 1 }],
    desc: "A thing does not need to be a weapon. It needs to be nearby and heavy enough.",
    origin: "Five kills with objects that were manufactured for other purposes entirely.",
  },
  {
    id: "unarmed_kill", threshold: 4, group: "combat",
    names: ["Bare Knuckle", "Hands", "The Close Work", "Personal Attention"],
    hooks: [{ k: "damage", when: "unarmed", v: 2 }, { k: "spectacle", v: 0.1 }],
    desc: "The audience has a documented and unwholesome appetite for this and you are catering to it.",
    origin: "Four kills with nothing in your hands. There is a demographic for this.",
    coveredBy: ["brawling"],
  },
  {
    id: "parley", threshold: 3, group: "social",
    names: ["Terms", "The Reasonable Voice", "Mutual Interest", "Talking Down"],
    hooks: [{ k: "parley", v: 3 }, { k: "spectacle", v: 0.05 }],
    desc: "Three separate things have decided you were worth listening to.",
    origin: "You keep resolving fights without having them, which we consider a personal failing and are rewarding anyway.",
    coveredBy: ["negotiation"],
  },
  {
    id: "trap_kill", threshold: 3, group: "craft",
    names: ["Prepared Ground", "The Patient Wire", "Groundwork", "Set And Forget"],
    hooks: [{ k: "feature", v: 1 }, { k: "search", v: 1 }],
    desc: "Things you built while nobody was looking keep doing the work while you are elsewhere.",
    origin: "Three things have now walked into something you left behind for them.",
    coveredBy: ["engineering"],
  },
  {
    id: "heavy_haul", threshold: 6, group: "utility",
    names: ["Dead Lift", "The Removals Trade", "Load Bearing", "Getting Under It"],
    hooks: [{ k: "carry", v: 12 }],
    desc: "Getting a heavy thing off the ground for two seconds is a technique, and you have it.",
    origin: "You keep picking up things that a reasonable person would leave.",
    coveredBy: ["clean_lift"],
  },
  {
    id: "quarrying", threshold: 14, group: "utility",
    names: ["Winning the Face", "Quarry Work", "Reading the Grain", "Stripping Out", "The Extractive Trade"],
    hooks: [{ k: "search", v: 2 }, { k: "carry", v: 8 }],
    desc: "You have stopped seeing walls and started seeing what walls are made of.",
    origin: "Fourteen units of the dungeon are now in your bag rather than in the dungeon.",
    coveredBy: ["scavenging"],
  },
  {
    id: "demolition_work", threshold: 4, group: "utility",
    names: ["Controlled Demolition", "Load Path", "Bringing It Down", "Where It Wants to Fall"],
    hooks: [{ k: "feature", v: 3 }, { k: "spectacle", v: 0.06 }],
    desc: "You know which part of a room the rest of it is standing on, which is a much shorter list than people assume.",
    origin: "You have put two ceilings on the floor. The system declines to ask whether either was on purpose.",
    coveredBy: ["demolitions"],
  },
  {
    id: "scouting", threshold: 8, group: "survival",
    names: ["Reading a Room", "Threshold Sense", "The Long Look", "Advance Work"],
    hooks: [{ k: "stealth", v: 1 }, { k: "search", v: 2 }],
    desc: "You have stopped walking into rooms and started arriving in them.",
    origin: "Eight rooms read from the doorway before you committed to any of them.",
    coveredBy: ["tracking"],
  },
  {
    id: "boss_kill", threshold: 2, group: "combat",
    names: ["Big Game", "Against the Silhouette", "Apex Work", "The Long Fight"],
    hooks: [{ k: "damage", when: "vs_larger", v: 3 }, { k: "defense", when: "vs_larger", v: 1 }],
    desc: "You have killed two things that were built specifically to be unkillable by one person.",
    origin: "Two bosses. The system would like it on record that this is unusual.",
  },
  {
    id: "high_ground", threshold: 5, group: "combat",
    names: ["The High Line", "Elevation", "Overwatch", "Uphill Argument"],
    hooks: [{ k: "accuracy", when: "high_ground", v: 2 }],
    desc: "You keep finding the highest thing in the room and standing on it.",
    origin: "Five fights spent above everyone else's eyeline.",
    coveredBy: ["climbing"],
  },
  {
    id: "ranged_kill", threshold: 6, group: "combat",
    names: ["Distance", "The Long Answer", "Reach", "Nothing Personal"],
    hooks: [{ k: "accuracy", when: "ranged", v: 1 }, { k: "damage", when: "ranged", v: 1 }],
    desc: "Six things have died without ever getting close enough to argue.",
    origin: "The audience finds this boring. The system does not care what the audience finds boring.",
    coveredBy: ["marksmanship"],
  },
];

export const PRACTICE_BY_ID: Record<string, PracticeDef> = Object.fromEntries(
  PRACTICE.map((p) => [p.id, p]),
);

/* ========================================================================
   GENERATED CLASSES
   ========================================================================
   The third-floor menu shows three the system recommends and hides the rest
   behind them. Canonically the hidden list runs to hundreds, so most of what
   a crawler sees has to be assembled on the spot out of what they actually
   did — including the skills the dungeon minted for them, which is how you get
   a class nobody has ever been offered before.
   ======================================================================== */

export const CLASS_STEMS: readonly { theme: string; words: string[]; hooks: Hook[] }[] = [
  { theme: "choke", words: ["Gatekeeper", "Doorwarden", "Threshold Sergeant", "Chokeman", "Bottleneck"],
    hooks: [{ k: "defense", when: "choke", v: 2 }, { k: "accuracy", when: "choke", v: 1 }] },
  { theme: "env", words: ["Demolitionist", "Site Foreman", "Structural Critic", "Wrecker", "Load-Bearer"],
    hooks: [{ k: "feature", v: 3 }, { k: "spectacle", v: 0.12 }] },
  { theme: "stealth", words: ["Nightjar", "Quiet Man", "Doorstep Killer", "Silent Partner", "The Unannounced"],
    hooks: [{ k: "damage", when: "hidden", v: 4 }, { k: "stealth", v: 2 }] },
  { theme: "brawl", words: ["Prizefighter", "Bare-Knuckle Artist", "Close Worker", "Pit Regular", "Hands"],
    hooks: [{ k: "damage", when: "unarmed", v: 3 }, { k: "spectacle", v: 0.18 }] },
  { theme: "ranged", words: ["Marksman", "Long Answer", "Sharpshooter", "The Patient Barrel"],
    hooks: [{ k: "accuracy", when: "ranged", v: 2 }, { k: "damage", when: "ranged", v: 2 }] },
  { theme: "social", words: ["Fixer", "Negotiator", "Provocateur", "The Reasonable Voice", "Broker"],
    hooks: [{ k: "parley", v: 4 }, { k: "intimidate", v: 3 }, { k: "spectacle", v: 0.2 }] },
  { theme: "survival", words: ["Cockroach", "Attrition Specialist", "The Persistent", "Late Finisher"],
    hooks: [{ k: "lastStand", v: 1 }, { k: "damage", when: "wounded", v: 3 }] },
  { theme: "craft", words: ["Sapper", "Field Engineer", "Tinker", "Quartermaster", "Scrap Smith"],
    hooks: [{ k: "feature", v: 2 }, { k: "carry", v: 40 }, { k: "search", v: 2 }] },
  { theme: "pack", words: ["Beast Master", "Handler", "Pack Leader", "The Whistle"],
    hooks: [{ k: "initiative", v: 3 }, { k: "onKill", effect: "stam", v: 10 }] },
  { theme: "show", words: ["Stunt Double", "Headliner", "Camera Magnet", "Fan Favourite"],
    hooks: [{ k: "spectacle", v: 0.35 }, { k: "onKill", effect: "views", v: 300 }] },
];

/** Prefixes and suffixes the class namer combines, so a generated class reads
 *  like something a bored institution named rather than a fantasy title. */
export const CLASS_QUALIFIERS: readonly string[] = [
  "Compensated", "Licensed", "Provisional", "Unregistered", "Contracted", "Certified",
  "Bonded", "Freelance", "Retained", "Seconded",
];

export const CLASS_TAILS: readonly string[] = [
  "", "", "", "of the Third Shift", "(Earth Variant)", "of No Fixed Abode",
  "Second Class", "with Distinction", "of the Long Hour",
];
