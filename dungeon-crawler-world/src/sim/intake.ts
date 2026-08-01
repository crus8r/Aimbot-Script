import type { Item, Stats } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";
import { clamp } from "../core/util.ts";
import { fromId } from "./loot.ts";

/**
 * Intake.
 *
 * The dungeon did not ask what class you wanted to be. It took whoever was
 * outside at three in the morning. So character creation is eight questions
 * about the hour before the Collapse, and the system converts that life into
 * numbers — badly, and with opinions.
 *
 * There is a ceiling on the total and deliberately no floor. Somebody who got
 * winded on stairs and calls a repairman when the boiler goes should arrive
 * measurably worse at this than somebody who trains and takes things apart,
 * and the character sheet should say so out loud rather than quietly
 * normalising them back to equal.
 */

export interface Intake {
  name: string;
  job: string;
  hobby: string;
  body: "weak" | "average" | "fit" | "strong";
  mind: "low" | "mid" | "high" | "vhigh";
  people: "low" | "mid" | "high" | "vhigh";
  dress: "underdressed" | "bed" | "casual" | "work";
  carried: string[];
  companion: "none" | "cat" | "dog" | "person";
}

export const DEFAULT_INTAKE: Intake = {
  name: "Crawler",
  job: "nothing in particular",
  hobby: "nothing in particular",
  body: "average",
  mind: "mid",
  people: "mid",
  dress: "casual",
  carried: ["phone", "keys"],
  companion: "none",
};

const JOB_SKILLS: [RegExp, string[]][] = [
  [/electric|technician|engineer|mechanic|repair|hvac|plumb|fitter/i, ["electrical", "engineering", "smithing"]],
  [/nurse|doctor|medic|paramedic|hospital|care|dentist|\bvet\b/i, ["field_dressing", "pain_tolerance", "alchemy"]],
  [/chef|cook|kitchen|baker|butcher|restaurant|barista/i, ["blades", "butchery", "pain_tolerance"]],
  [/teach|professor|lecturer|tutor|school/i, ["negotiation", "appraisal"]],
  [/driver|delivery|courier|truck|taxi|logistics|warehouse/i, ["sprint", "clean_lift", "tracking"]],
  [/soldier|military|army|marine|navy|police|security|guard|firefight/i, ["blades", "pain_tolerance", "first_strike", "tracking"]],
  [/construction|builder|labour|labor|mover|roofer|scaffold|dock|site/i, ["clean_lift", "bludgeon", "climbing"]],
  [/account|insurance|finance|analyst|clerk|lawyer|legal|audit|bank/i, ["appraisal", "negotiation"]],
  [/sales|retail|server|waiter|waitress|bartend|shop|cashier|market/i, ["negotiation", "performance"]],
  [/programm|developer|software|coder|\bit\b|sysadmin|data/i, ["electrical", "appraisal", "engineering"]],
  [/artist|designer|musician|actor|photograph|writer|journalist|dancer/i, ["performance", "negotiation"]],
  [/farm|garden|landscap|forest|ranch|shepherd/i, ["butchery", "tracking", "climbing"]],
  [/athlete|trainer|coach|fitness|\bgym\b/i, ["dodge", "sprint", "pain_tolerance"]],
  [/fisher|sailor|boat|diver|lifeguard/i, ["climbing", "engineering", "pain_tolerance"]],
  [/clean|janitor|custodian|caretaker/i, ["scavenging", "climbing"]],
  [/smith|weld|machinist|fabricat|metal/i, ["smithing", "engineering", "clean_lift"]],
  [/chemist|\blab\b|pharmac|scien/i, ["alchemy", "demolitions", "appraisal"]],
  [/lock|locksmith|burglar|thief/i, ["lockpicking", "stealth"]],
];

const HOBBY_SKILLS: [RegExp, string[]][] = [
  [/climb|hike|mountain|outdoor|camp|bushcraft|scout/i, ["climbing", "tracking", "stealth"]],
  [/run|marathon|track|jog|cycl|bike/i, ["sprint", "dodge"]],
  [/swim|dive|surf|kayak|row/i, ["climbing", "pain_tolerance"]],
  [/gam|video ?game|dnd|d&d|chess|puzzle|board game/i, ["appraisal", "tracking"]],
  [/box|mma|martial|karate|judo|wrestl|jiu|muay|fight/i, ["brawling", "dodge", "parry"]],
  [/gun|shoot|archery|hunt|rifle|bow/i, ["marksmanship", "throwing", "tracking"]],
  [/cook|bak|grill|barbec/i, ["butchery", "blades"]],
  [/garden|plant|botan/i, ["alchemy", "scavenging"]],
  [/read|book|study|histor|languag/i, ["appraisal", "negotiation"]],
  [/craft|woodwork|sew|knit|model|3d print|electronics|solder/i, ["engineering", "electrical", "smithing"]],
  [/music|sing|guitar|piano|band|drum|\bdj\b/i, ["performance", "negotiation"]],
  [/car|motorcycle|motorbike|engine|wrench|restor/i, ["engineering", "electrical"]],
  [/dog|\bcat\b|pet|animal|horse|falcon/i, ["tracking", "stealth"]],
  [/lift|weight|powerlift|strongman|crossfit/i, ["clean_lift", "bludgeon"]],
  [/paint|draw|art|sculpt|photo/i, ["performance", "appraisal"]],
  [/yoga|dance|gymnast|parkour|skate/i, ["dodge", "sprint", "climbing"]],
  [/firework|explos|pyro|rocket|chem/i, ["demolitions", "electrical"]],
  [/magic trick|sleight|card|poker/i, ["stealth", "negotiation"]],
];

const HANDS_ON =
  /electric|mechanic|repair|chef|cook|butcher|smith|weld|machinist|surgeon|dentist|craft|sew|knit|paint|guitar|piano|sleight|solder|carpent|tattoo/i;

export interface BuildResult {
  stats: Stats;
  skills: Record<string, number>;
  items: Item[];
  verdict: string;
}

export function buildFromIntake(rng: Rng, intake: Intake): BuildResult {
  const stats: Stats = { str: 4, dex: 4, con: 4, int: 4, cha: 4 };

  ({
    weak: () => {
      stats.str -= 2;
      stats.con -= 2;
      stats.dex -= 1;
    },
    average: () => {},
    fit: () => {
      stats.str += 1;
      stats.con += 1;
      stats.dex += 1;
    },
    strong: () => {
      stats.str += 3;
      stats.con += 2;
      stats.dex -= 1;
    },
  })[intake.body]();

  ({
    low: () => {
      stats.int -= 2;
    },
    mid: () => {},
    high: () => {
      stats.int += 2;
    },
    vhigh: () => {
      stats.int += 3;
      stats.str -= 1;
    },
  })[intake.mind]();

  ({
    low: () => {
      stats.cha -= 2;
    },
    mid: () => {},
    high: () => {
      stats.cha += 2;
    },
    vhigh: () => {
      stats.cha += 3;
      stats.con -= 1;
    },
  })[intake.people]();

  const text = `${intake.job} ${intake.hobby}`;
  if (HANDS_ON.test(text)) stats.dex += 2;
  if (intake.carried.includes("tools")) stats.dex += 1;
  if (intake.carried.includes("weapon")) stats.str += 1;
  if (/lift|weight|strongman|labour|labor|construction|mover/i.test(text)) stats.str += 1;
  if (/marathon|endurance|swim|cycl|hike|climb/i.test(text)) stats.con += 1;

  // A point of jitter each way so two identical forms are not identical
  // people, never enough to drown out the answers themselves.
  for (const k of ["str", "dex", "con", "int", "cha"] as const) {
    stats[k] = clamp(stats[k] + rng.int(-1, 1), 2, 9);
  }
  // Below 2 Intelligence the tutorial classifies you as a pet rather than a
  // crawler, which is not a playable opening.
  stats.int = Math.max(2, stats.int);

  const skills: Record<string, number> = {};
  const add = (id: string, level: number) => {
    skills[id] = Math.max(skills[id] ?? 0, level);
  };
  for (const [re, ids] of JOB_SKILLS) {
    if (re.test(intake.job)) ids.forEach((id, i) => add(id, i === 0 ? rng.int(5, 7) : rng.int(2, 4)));
  }
  for (const [re, ids] of HOBBY_SKILLS) {
    if (re.test(intake.hobby)) ids.forEach((id, i) => add(id, i === 0 ? rng.int(3, 5) : rng.int(1, 3)));
  }
  if (intake.body === "strong") add("clean_lift", rng.int(3, 5));
  if (intake.body === "fit") add("sprint", rng.int(2, 4));
  if (intake.people === "high" || intake.people === "vhigh") add("negotiation", rng.int(2, 4));
  if (intake.mind === "high" || intake.mind === "vhigh") add("appraisal", rng.int(2, 4));
  if (Object.keys(skills).length < 2) {
    add("sprint", rng.int(1, 3));
    add("scavenging", rng.int(1, 3));
  }

  // Nobody arrives good at everything. Six, best first.
  const trimmed: Record<string, number> = {};
  for (const [k, v] of Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    trimmed[k] = v;
  }

  const items: Item[] = [];
  const has = (x: string) => intake.carried.includes(x);
  if (has("phone")) items.push(fromId("phone", 1, rng));
  if (has("keys")) items.push(fromId("keys", 1, rng));
  if (has("lighter")) items.push(fromId("lighter", 1, rng));
  if (has("food")) items.push(fromId("cereal_bar", rng.int(1, 2), rng));
  if (has("tools")) items.push(fromId("toolkit", 1, rng));
  if (has("weapon")) items.push(fromId(rng.pick(["knife_kitchen", "crowbar", "pipe"]), 1, rng));
  if (intake.dress === "casual" || intake.dress === "work") {
    const boots = fromId("work_boots", 1, rng);
    boots.equipped = true;
    items.push(boots);
  }
  if (intake.dress === "work") {
    const jacket = fromId("leather_jacket", 1, rng);
    jacket.equipped = true;
    items.push(jacket);
  }

  return { stats, skills: trimmed, items, verdict: verdictFor(rng, intake, stats) };
}

const VERDICTS = [
  "Intake complete. You are, statistically, extremely average, which historically correlates with dying inside eleven hours.",
  "We have run the numbers on your entire life and converted them into five of them. You are not going to like the fourth one.",
  "Processed. The audience enjoys an underdog and you have generously volunteered.",
  "Registered. Your profession has been translated into skills by an algorithm with no respect for it whatsoever.",
  "Assessment complete. Nothing here suggests you reach the third floor, which is precisely what makes it watchable.",
  "Filed. Somewhere in this building a machine has just decided what you are worth, and it did it in under a second.",
];

function verdictFor(rng: Rng, intake: Intake, stats: Stats): string {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total <= 16) {
    return "Intake complete. We have checked these figures twice. You were an indoor animal and it is all here in the numbers.";
  }
  if (total >= 32) {
    return "Intake complete. Unusually solid. The audience will expect things of you now, and the audience is not kind about disappointment.";
  }
  if (intake.companion === "none") {
    return "Intake complete. No companion, no backup, nobody to notice you have stopped moving. Bold.";
  }
  return rng.pick(VERDICTS);
}
