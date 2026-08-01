import type { Combatant, EncounterState, GameState, MapNode } from "../core/types.ts";
import type { SpellDef, SpellEffect } from "../core/hooks.ts";
import type { Rng } from "../core/rng.ts";
import type { EventLog } from "../core/events.ts";
import { makeStatus } from "../data/statuses.ts";
import { SPELLS, SPELL_BY_ID, generateSpell } from "../data/spells.ts";
import { crawlerOf, hostilesOf, living, zoneDistance, zoneOf } from "./tactics.ts";
import { derive } from "./character.ts";
import { clamp } from "../core/util.ts";

/**
 * Casting.
 *
 * The economics are the interesting part and they come straight from canon:
 * the pool is Intelligence one for one, and it refills at about a point an
 * hour unless you invested. A crawler with 5 Intelligence gets one Magic
 * Missile a fight and then they are out for the rest of the day, which makes
 * "is this the moment" a real question rather than a resource bar to drain.
 */

export function knownSpells(state: GameState): SpellDef[] {
  return Object.values(state.spellbook);
}

export function learnSpell(state: GameState, spell: SpellDef, log: EventLog): boolean {
  if (state.spellbook[spell.id]) return false;
  state.spellbook[spell.id] = spell;
  log.push({
    kind: "skill_up",
    channel: "loot",
    skill: spell.name,
    level: 1,
    note: `${spell.mana} mana. ${spell.desc}`,
  });
  return true;
}

/** What a tome found on this floor teaches. Mostly invented, sometimes one of
 *  the ones everybody knows. */
export function spellFromTome(state: GameState, rng: Rng, prefer?: string[]): SpellDef {
  const unknownAuthored = SPELLS.filter((s) => !state.spellbook[s.id]);
  if (unknownAuthored.length && rng.chance(0.35)) return rng.pick(unknownAuthored);
  let spell = generateSpell(rng, state.floor.n, prefer);
  let guard = 0;
  while (state.spellbook[spell.id] && guard++ < 8) spell = generateSpell(rng, state.floor.n, prefer);
  return spell;
}

export interface CastResult {
  ok: boolean;
  reason?: string;
}

export function castSpell(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState | null,
  node: MapNode | null,
  spellId: string,
  targetRef?: string,
): CastResult {
  const spell = state.spellbook[spellId] ?? SPELL_BY_ID[spellId];
  if (!spell) return { ok: false, reason: "You do not know anything by that name." };
  if (!state.spellbook[spell.id]) return { ok: false, reason: `You have heard of ${spell.name}. You cannot cast it.` };

  if ((state.cooldowns[spell.id] ?? 0) > 0) {
    return { ok: false, reason: `${spell.name} is not ready. ${state.cooldowns[spell.id]} rounds.` };
  }
  if (state.crawler.mana < spell.mana) {
    return {
      ok: false,
      reason: `${spell.name} costs ${spell.mana} and you have ${Math.floor(state.crawler.mana)}. Mana comes back at about ${Math.max(1, Math.round(derive(state).stats.int * 3.6))} an hour, so that is a decision about the clock rather than about the fight.`,
    };
  }

  state.crawler.mana -= spell.mana;
  if (spell.cooldown) state.cooldowns[spell.id] = spell.cooldown;

  const me = enc ? crawlerOf(enc) : null;
  for (const effect of spell.effects) {
    applyEffect(state, rng, log, enc, node, spell, effect, me, targetRef);
  }
  return { ok: true };
}

function applyEffect(
  state: GameState,
  rng: Rng,
  log: EventLog,
  enc: EncounterState | null,
  node: MapNode | null,
  spell: SpellDef,
  effect: SpellEffect,
  me: Combatant | null,
  targetRef?: string,
): void {
  switch (effect.k) {
    case "heal": {
      const d = derive(state);
      const amount = rng.roll(effect.dice);
      state.crawler.hp = clamp(state.crawler.hp + amount, 0, d.hpMax);
      if (me) me.hp = state.crawler.hp;
      log.push({ kind: "heal", channel: "good", amount, hp: Math.round(state.crawler.hp), source: spell.name });
      break;
    }
    case "ward": {
      if (!me) break;
      me.statuses.push({ ...makeStatus("braced", effect.turns), name: `${spell.name} shell`, magnitude: 0 });
      log.push({ kind: "status", channel: "good", who: me.name, status: `${spell.name}`, applied: true, note: `+${effect.v} defence while it holds.` });
      break;
    }
    case "buff": {
      if (!me) break;
      me.statuses.push({ ...makeStatus("adrenaline", effect.turns), name: spell.name, magnitude: 0 });
      log.push({ kind: "status", channel: "good", who: me.name, status: spell.name, applied: true, note: "It holds for a few rounds." });
      break;
    }
    case "blink": {
      if (!enc || !node || !me) break;
      const reachable = node.zones.filter(
        (z) => zoneDistance(node, me.zone, z.id) <= effect.zones && z.id !== me.zone && !z.barricaded,
      );
      if (!reachable.length) break;
      const wanted = targetRef
        ? reachable.find((z) => z.id === targetRef || z.name.toLowerCase().includes(targetRef.toLowerCase()))
        : reachable.sort((a, b) => a.capacity - b.capacity)[0];
      const dest = wanted ?? reachable[0]!;
      me.zone = dest.id;
      log.push({ kind: "reposition", channel: "good", who: me.name, from: "where you were", to: dest.name, disengaged: false });
      break;
    }
    case "reveal": {
      if (node) {
        const feats = node.zones.flatMap((z) => z.features.filter((f) => !f.spent).map((f) => f.name));
        log.say(
          feats.length
            ? `Light, and the room stops keeping things back: ${feats.join(", ")}.`
            : "Light. There is nothing in here you had not already found, which is its own answer.",
        );
      }
      break;
    }
    case "damage":
    case "status": {
      if (!enc || !node || !me) break;
      const targets = resolveTargets(state, enc, node, me, effect.scope, targetRef);
      if (!targets.length) {
        log.say("Nothing in range. The mana is gone regardless; that is how mana works.");
        break;
      }
      for (const t of targets) {
        if (effect.k === "damage") {
          const raw = rng.roll(effect.dice);
          const dealt = Math.max(1, raw - Math.floor(t.armor / 2));
          t.hp = Math.max(0, t.hp - dealt);
          state.counters.damageDealt += dealt;
          log.push({
            kind: "attack",
            channel: t.side === "crawler" ? "bad" : "good",
            attacker: state.crawler.name,
            target: t.name,
            weapon: spell.name,
            byCrawler: true,
            hit: true,
            crit: false,
            graze: false,
            damage: dealt,
            targetHp: t.hp,
            targetHpMax: t.hpMax,
            styles: effect.tag === "fire" ? ["environmental"] : [],
          });
          if (effect.tag === "fire") t.statuses.push(makeStatus("burning", 2));
        } else {
          if (!t.statuses.some((x) => x.id === effect.id)) {
            t.statuses.push(makeStatus(effect.id, effect.turns));
            log.push({ kind: "status", channel: "good", who: t.name, status: effect.id, applied: true, note: spell.name });
          }
        }
      }
      break;
    }
  }
}

function resolveTargets(
  state: GameState,
  enc: EncounterState,
  node: MapNode,
  me: Combatant,
  scope: "one" | "zone" | "self",
  targetRef?: string,
): Combatant[] {
  if (scope === "self") return [me];
  const foes = hostilesOf(enc, me);
  if (!foes.length) return [];

  if (scope === "one") {
    if (targetRef) {
      const idx = parseInt(targetRef, 10);
      if (!Number.isNaN(idx) && foes[idx - 1]) return [foes[idx - 1]!];
      const named = foes.find((f) => f.name.toLowerCase().includes(targetRef.toLowerCase()));
      if (named) return [named];
    }
    return [foes.slice().sort((a, b) => a.hp - b.hp)[0]!];
  }

  // Zone: whichever position holds the most of them, or the one named.
  let zoneId = targetRef;
  if (zoneId) {
    const z = node.zones.find((x) => x.id === zoneId || x.name.toLowerCase().includes(zoneId!.toLowerCase()));
    zoneId = z?.id;
  }
  if (!zoneId) {
    let best = "";
    let count = -1;
    for (const z of node.zones) {
      if (z.id === me.zone) continue; // never centre a blast on yourself
      const n = foes.filter((f) => f.zone === z.id).length;
      if (n > count) {
        count = n;
        best = z.id;
      }
    }
    zoneId = best;
  }
  if (zoneId === me.zone) return [];
  return living(enc).filter((c) => c.zone === zoneId && c.side !== "crawler");
}

export function tickCooldowns(state: GameState): void {
  for (const [id, n] of Object.entries(state.cooldowns)) {
    if (n <= 1) delete state.cooldowns[id];
    else state.cooldowns[id] = n - 1;
  }
}

export { zoneOf };
