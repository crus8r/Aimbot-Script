import type { GameState } from "../core/types.ts";
import { STAT_KEYS, STAT_NAMES } from "../core/types.ts";
import { derive, skillLevel, xpForLevel } from "./character.ts";
import { SKILL_BY_ID } from "../data/skills.ts";
import { RACE_BY_ID, CLASS_BY_ID } from "../data/paths.ts";
import { HOOK_LABEL } from "../core/hooks.ts";
import { knownSpells } from "./spells.ts";

/**
 * The crawler, organised to be scanned rather than read.
 *
 * The old sheet was twelve label/value rows in struct order, which is a data
 * dump wearing a hat: Level, Strength, Dexterity, Constitution, Intelligence,
 * Charisma, Accuracy, Defence, Armour, Weapon, Views, Bounty. Nothing about
 * that ordering tells you anything, and the two most interesting facts about
 * any crawler — what this run turned them into, and what they owe — were
 * missing entirely.
 *
 * Grouped here by the question each group answers:
 *
 *   WHO       identity, and the fact that the system files you as a number
 *   BODY      the things that run out, with what running out costs
 *   HITTING   what happens when you swing
 *   SURVIVING what happens when something swings at you
 *   MADE      what this run invented, which no other crawler has
 *   OWED      sponsors, clauses, and how close each is to dropping you
 *
 * Every number carries a `why` where a number alone would be uninterpretable.
 * "Fatigue 88" is not information. "Fatigue 88 — past the line, taking two off
 * everything" is.
 */

export interface Stat {
  label: string;
  value: string;
  /** What the number means, when the number alone means nothing. */
  why?: string;
  /** 0..1 when the thing is a proportion of something. */
  fill?: number;
  tone?: "good" | "bad" | "warn";
}

export interface DossierGroup {
  title: string;
  lines: Stat[];
}

export interface Dossier {
  name: string;
  number: number;
  level: number;
  xp: { have: number; need: number; fill: number };
  identity: string;
  /** Unspent points, which are a decision the sheet should nag about. */
  points: number;
  banked: number;
  groups: DossierGroup[];
  /** Skills the dungeon invented for this crawler, and what they do. */
  minted: { name: string; level: number; desc: string; effects: string[]; origin: string }[];
  /** Spells nobody authored. */
  invented: { name: string; mana: number; desc: string }[];
  /** Sponsors, with how close each is to walking. */
  owed: { name: string; clause: string; strikes: number; note: string }[];
  /** Backloads. The reason the stakes are real and the game is still fair. */
  backloads: { room: boolean; floor: boolean; note: string };
  seed: number;
}

export function dossier(state: GameState): Dossier {
  const c = state.crawler;
  const d = derive(state);
  const need = xpForLevel(c.level);

  const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);

  /* -------------------------------------------------------------- body */
  const body: Stat[] = [
    {
      label: "Health", value: `${Math.round(c.hp)} / ${d.hpMax}`,
      fill: pct(c.hp, d.hpMax),
      tone: c.hp < d.hpMax * 0.34 ? "bad" : undefined,
      why: c.hp < d.hpMax * 0.34 ? "Below a third. Wounded, and everything that keys on wounded is live." : undefined,
    },
  ];
  if (d.manaMax > 0) {
    body.push({
      label: "Mana", value: `${Math.round(c.mana)} / ${d.manaMax}`,
      fill: pct(c.mana, d.manaMax),
      why: "Your pool is your Intelligence. Think about that before relying on it.",
    });
  }
  body.push({
    label: "Stamina", value: `${Math.round(c.stamina)} / ${d.staminaMax}`,
    fill: pct(c.stamina, d.staminaMax),
  });
  body.push({
    label: "Fatigue", value: String(Math.round(c.fatigue)),
    fill: pct(c.fatigue, 100),
    tone: c.fatigue > 85 ? "bad" : c.fatigue > 60 ? "warn" : undefined,
    why: c.fatigue > 85 ? "Past the line. Taking two off everything." : c.fatigue > 60 ? "Climbing. Sleep costs seven hours you may not have." : undefined,
  });
  body.push({
    label: "Hunger", value: String(Math.round(c.hunger)),
    fill: pct(c.hunger, 100),
    tone: c.hunger > 85 ? "bad" : c.hunger > 60 ? "warn" : undefined,
    why: c.hunger > 85 ? "Starving, and it shows in every roll." : undefined,
  });
  body.push({
    label: "Carrying", value: `${Math.round(carried(state) * 10) / 10} / ${d.carry} kg`,
    fill: pct(carried(state), d.carry),
    tone: carried(state) > d.carry * 0.9 ? "warn" : undefined,
    why: "No slot limit. Strength is the only gate, which is why the vending machine is possible.",
  });

  /* ------------------------------------------------------------ hitting */
  const hitting: Stat[] = [
    { label: "Weapon", value: d.weaponName, why: `${d.weaponDamage}${d.damageBonus ? ` +${d.damageBonus}` : ""}${d.twoHanded ? ", two-handed" : ""}` },
    { label: "Accuracy", value: `+${d.accuracy}`, why: "Added to a d20 against their defence." },
    { label: "Damage bonus", value: `+${d.damageBonus}` },
    { label: "Crit on", value: `${d.critRange}+`, why: d.critRange < 20 ? "Widened by your gear." : undefined },
    { label: "Reach", value: `${d.reach} ${d.reach === 1 ? "position" : "positions"}`, why: d.reach > 1 ? "You can hit things that cannot hit you." : undefined },
  ];

  /* ---------------------------------------------------------- surviving */
  const surviving: Stat[] = [
    { label: "Defence", value: String(d.defense), why: "What they roll against." },
    { label: "Armour", value: String(d.armor), why: "Subtracted from every hit. Vital damage ignores it entirely." },
    { label: "Initiative", value: `+${d.initiative}` },
  ];
  if (d.unstable > 0) {
    surviving.push({
      label: "Unstable", value: `${Math.round(d.unstable * 100)}%`, tone: "bad",
      why: "Something you are carrying does not want to be carried.",
    });
  }
  if (c.statuses.length) {
    for (const st of c.statuses) {
      surviving.push({ label: st.name, value: st.turns < 0 ? "until removed" : `${st.turns}`, tone: st.bad ? "bad" : "good", why: st.note });
    }
  }

  /* --------------------------------------------------------------- made */
  const minted = Object.entries(state.minted)
    .filter(([, m]) => m !== null)
    .map(([id, m]) => ({
      name: m!.name,
      level: skillLevel(state, id),
      desc: m!.desc,
      effects: m!.hooks.map((h) => HOOK_LABEL(h)),
      origin: m!.origin,
    }));

  const invented = knownSpells(state)
    .filter((s) => s.minted)
    .map((s) => ({ name: s.name, mana: s.mana, desc: s.desc }));

  return {
    name: c.name,
    number: c.number,
    level: c.level,
    xp: { have: c.xp, need, fill: pct(c.xp, need) },
    identity:
      [c.race ? RACE_BY_ID[c.race]?.name ?? c.race : null, c.className ?? (c.klass ? CLASS_BY_ID[c.klass]?.name : null)]
        .filter(Boolean)
        .join(" ") || "unraced, unclassed — the third floor decides both",
    points: c.points,
    banked: c.banked,
    groups: [
      {
        title: "what you are made of",
        lines: STAT_KEYS.map((k) => ({
          label: STAT_NAMES[k],
          value: String(d.stats[k]),
          why: d.stats[k] !== c.stats[k] ? `${c.stats[k]} of it is yours; the rest is gear.` : undefined,
        })),
      },
      { title: "the body", lines: body },
      { title: "hitting things", lines: hitting },
      { title: "being hit", lines: surviving },
    ],
    minted,
    invented,
    owed: state.sponsors.map((s) => ({
      name: s.name,
      clause: s.clause,
      strikes: s.strikes,
      note: s.strikes >= 1
        ? "One more floor like the last one and they drop you, publicly, by name."
        : "Held up so far. A box a floor while it lasts.",
    })),
    backloads: {
      room: state.restores.room,
      floor: state.restores.floor,
      note:
        state.restores.room && state.restores.floor
          ? "Both. Death rewinds you to the start of the room, then to the start of the floor, and then it is a death."
          : state.restores.floor
            ? "The floor only. The room is spent."
            : state.restores.room
              ? "The room only. After that there is nothing between you and the end of the run."
              : "None. The next one is the run.",
    },
    seed: state.seed,
  };
}

/** Skills, ordered so the ones this run invented lead. */
export function skillLines(state: GameState): {
  id: string; name: string; level: number; desc: string; minted: boolean; capped: boolean; effects: string[];
}[] {
  return Object.entries(state.skills)
    .map(([id, k]) => {
      const m = state.minted[id];
      const def = SKILL_BY_ID[id];
      return {
        id,
        name: m?.name ?? def?.name ?? id,
        level: k.level,
        desc: m?.desc ?? def?.desc ?? "",
        minted: !!m,
        capped: k.level >= state.crawler.skillCap,
        effects: (m?.hooks ?? []).map((h) => HOOK_LABEL(h)),
      };
    })
    .sort((a, b) => Number(b.minted) - Number(a.minted) || b.level - a.level || a.name.localeCompare(b.name));
}

const carried = (state: GameState): number =>
  state.inventory.reduce((n, i) => n + i.weight * i.qty, 0);
