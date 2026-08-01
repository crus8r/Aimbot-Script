import type { SpellDef, SpellEffect } from "../core/hooks.ts";
import type { Rng } from "../core/rng.ts";

export type { SpellDef, SpellEffect };

/**
 * Spells.
 *
 * The mana pool is Intelligence, one point for one, and it comes back at
 * roughly a point an hour for somebody who never invested — which is the
 * canon rule and the reason a low-Intelligence crawler simply does not cast.
 * When you can only afford one spell a fight, every spell has to be worth a
 * whole turn.
 *
 * Like skills, the authored list is a seed rather than a catalogue. Tomes turn
 * up in boxes carrying spells nobody wrote, composed from the same closed set
 * of effects the resolver reads. There is no ceiling on how many exist.
 */

export const SPELLS: readonly SpellDef[] = [
  {
    id: "magic_missile", name: "Magic Missile", mana: 3, tags: ["attack"],
    effects: [{ k: "damage", dice: "2d4+2", tag: "force", scope: "one" }],
    desc: "Reliable, unglamorous, and it does not miss. Every caster's first and least favourite spell.",
  },
  {
    id: "sear", name: "Sear", mana: 5, tags: ["attack", "fire"],
    effects: [
      { k: "damage", dice: "2d6", tag: "fire", scope: "zone" },
      { k: "status", id: "burning", turns: 3, scope: "zone" },
    ],
    desc: "A short cone of fire across one position. Loud, bright, and popular with everyone except the people in it.",
  },
  {
    id: "frost_nail", name: "Frost Nail", mana: 4, tags: ["attack"],
    effects: [
      { k: "damage", dice: "1d8+2", tag: "cold", scope: "one" },
      { k: "status", id: "staggered", turns: 1, scope: "one" },
    ],
    desc: "One target, and it loses the round it was about to have.",
  },
  {
    id: "shock_lace", name: "Shock Lace", mana: 6, tags: ["attack"],
    effects: [{ k: "damage", dice: "3d6", tag: "shock", scope: "zone" }],
    desc: "Arcs between everything in one position. Devastating in water, embarrassing in a dry room.",
  },
  {
    id: "heal", name: "Heal", mana: 6, tags: ["support"],
    effects: [{ k: "heal", dice: "3d8+6", scope: "self" }],
    desc: "Restores health to something you can touch, including yourself, which is usually the pressing case.",
  },
  {
    id: "protective_shell", name: "Protective Shell", mana: 5, tags: ["defense"],
    effects: [{ k: "ward", v: 4, turns: 4 }],
    desc: "A shell that stops one significant thing, or four unimpressive ones.",
  },
  {
    id: "puddle_jumper", name: "Puddle Jumper", mana: 4, cooldown: 4, tags: ["mobility"],
    effects: [{ k: "blink", zones: 2 }],
    desc: "Two positions, instantly, through anything in between. The cooldown means you get one per fight, and probably not the fight you wanted.",
  },
  {
    id: "torch", name: "Torch", mana: 1, tags: ["utility"],
    effects: [{ k: "reveal" }],
    desc: "Light. The most-used spell in the dungeon and nobody admits to it.",
  },
  {
    id: "stone_skin", name: "Stone Skin", mana: 7, tags: ["defense"],
    effects: [{ k: "buff", hook: { k: "armor", when: "always", v: 4 }, turns: 5 }],
    desc: "Flat damage reduction. Halves nothing, stops everything a little.",
  },
  {
    id: "bellow", name: "Bellow", mana: 5, tags: ["social", "attack"],
    effects: [{ k: "status", id: "staggered", turns: 1, scope: "zone" }],
    desc: "Everything in one position loses its round. There is no damage and it wins fights anyway.",
  },
  {
    id: "second_wind", name: "Second Wind", mana: 8, cooldown: 8, tags: ["support"],
    effects: [
      { k: "heal", dice: "2d6", scope: "self" },
      { k: "buff", hook: { k: "damage", when: "wounded", v: 3 }, turns: 4 },
    ],
    desc: "Not much health. A great deal of conviction.",
  },
  {
    id: "brand", name: "Brand", mana: 3, tags: ["utility"],
    effects: [{ k: "status", id: "marked", turns: 6, scope: "one" }],
    desc: "Marks one thing so that everything you do to it lands a little better, and so that it cannot leave quietly.",
  },
];

export const SPELL_BY_ID: Record<string, SpellDef> = Object.fromEntries(SPELLS.map((s) => [s.id, s]));

/* ======================================================================== */

const CORES = [
  { noun: "Bolt", effects: (d: string): SpellEffect[] => [{ k: "damage", dice: d, tag: "force", scope: "one" }] },
  { noun: "Lance", effects: (d: string): SpellEffect[] => [{ k: "damage", dice: d, tag: "force", scope: "one" }] },
  { noun: "Bloom", effects: (d: string): SpellEffect[] => [{ k: "damage", dice: d, tag: "fire", scope: "zone" }] },
  { noun: "Wash", effects: (d: string): SpellEffect[] => [{ k: "damage", dice: d, tag: "cold", scope: "zone" }] },
  { noun: "Arc", effects: (d: string): SpellEffect[] => [{ k: "damage", dice: d, tag: "shock", scope: "zone" }] },
  { noun: "Mending", effects: (d: string): SpellEffect[] => [{ k: "heal", dice: d, scope: "self" }] },
  { noun: "Ward", effects: (): SpellEffect[] => [{ k: "ward", v: 4, turns: 4 }] },
  { noun: "Step", effects: (): SpellEffect[] => [{ k: "blink", zones: 2 }] },
  { noun: "Hush", effects: (): SpellEffect[] => [{ k: "status", id: "staggered", turns: 1, scope: "zone" }] },
  { noun: "Sight", effects: (): SpellEffect[] => [{ k: "reveal" }] },
];

const QUALIFIERS = [
  "Lesser", "Hobgoblin", "Second-Hand", "Borrowed", "Unlicensed", "Provisional",
  "Kua-Tin", "Discount", "Refurbished", "Grey-Market", "Field-Expedient", "Ninth-Edition",
];

const OF = [
  "", "", "", "of the Ending Sun", "of Small Hours", "of the Long Argument",
  "of Patient Company", "of Quiet Rooms", "of Bad Ideas", "of the Third Shift",
];

const NOTES = [
  "Somebody wrote this down once and never explained why.",
  "The tome it came out of had three previous owners and no forwarding address.",
  "It works. The description declines to say at whose expense.",
  "Translated twice, badly, and it still functions, which is either impressive or worrying.",
  "There is a clause in the middle of this you should have read.",
  "Cheap to cast, which the system considers its own reward.",
];

/**
 * A spell that did not exist before this box was opened. Magnitude comes from
 * the floor, so a tome found on the fourth floor is worth carrying; the name
 * and the joke are cosmetic and the effects are not.
 */
export function generateSpell(rng: Rng, floor: number, prefer?: string[]): SpellDef {
  let pool = CORES.slice();
  if (prefer?.length) {
    const biased = pool.filter((cr) =>
      (prefer.includes("caster") && true) ||
      (prefer.includes("heal") && cr.noun === "Mending") ||
      (prefer.includes("explosive") && ["Bloom", "Arc"].includes(cr.noun)) ||
      (prefer.includes("stealth") && ["Step", "Sight", "Hush"].includes(cr.noun)),
    );
    if (biased.length) pool = biased;
  }
  const core = rng.pick(pool);
  const power = Math.max(1, Math.round(1 + floor * 0.7));
  const dice = `${power}d6${floor > 2 ? `+${floor}` : ""}`;
  const effects = core.effects(dice);

  const qualifier = rng.chance(0.65) ? `${rng.pick(QUALIFIERS)} ` : "";
  const tail = rng.pick(OF);
  const name = `${qualifier}${core.noun}${tail ? ` ${tail}` : ""}`.trim();

  const scope = effects.find((e) => "scope" in e) as { scope?: string } | undefined;
  const mana = Math.max(1, Math.round(2 + floor * 0.8 + (scope?.scope === "zone" ? 2 : 0)));

  return {
    id: `spell_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    name,
    mana,
    effects,
    desc: rng.pick(NOTES),
    tags: ["generated", ...(effects.some((e) => e.k === "damage") ? ["attack"] : ["utility"])],
    minted: true,
  };
}
