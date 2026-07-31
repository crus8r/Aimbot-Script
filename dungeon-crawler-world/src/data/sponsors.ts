import type { Counters } from "../core/types.ts";
import type { Tier } from "./boxes.ts";

/**
 * Sponsors are the only system in the game that pays you for changing how you
 * play, and the only one that can take itself away. A patron watches for a
 * pattern, offers you gear for it, and then holds you to a clause that is
 * checked against the simulation at the end of every floor.
 *
 * That is the whole design: the offer is tempting, the clause is a leash, and
 * the leash is enforced by arithmetic rather than by anybody's judgement.
 */

export interface FloorStats {
  kills: number;
  unarmedKills: number;
  environmentalKills: number;
  fled: number;
  parleys: number;
  spared: number;
  npcKills: number;
  damageTaken: number;
  bossKills: number;
  roomsCleared: number;
}

export type ClauseId =
  | "no_flee"
  | "kill_quota"
  | "unarmed_share"
  | "spare_someone"
  | "no_npc_kills"
  | "take_damage"
  | "environmental_quota"
  | "clear_rooms";

export interface Clause {
  id: ClauseId;
  text: string;
  /** Checked at the end of every floor against that floor's tally alone. */
  check: (f: FloorStats) => boolean;
}

export const CLAUSES: Record<ClauseId, Clause> = {
  no_flee: {
    id: "no_flee",
    text: "You do not run. Not once, not from anything, not for any reason they will accept.",
    check: (f) => f.fled === 0,
  },
  kill_quota: {
    id: "kill_quota",
    text: "Twelve kills a floor, minimum. They are buying footage and footage is a volume business.",
    check: (f) => f.kills >= 12,
  },
  unarmed_share: {
    id: "unarmed_share",
    text: "At least a third of what you kill, you kill with your hands. They have a demographic in mind.",
    check: (f) => f.kills === 0 || f.unarmedKills / f.kills >= 0.33,
  },
  spare_someone: {
    id: "spare_someone",
    text: "Resolve at least one confrontation without killing anything. Once a floor. They will check.",
    check: (f) => f.parleys + f.spared >= 1,
  },
  no_npc_kills: {
    id: "no_npc_kills",
    text: "You do not kill NPCs. They have families, allegedly, and the sponsor has an image.",
    check: (f) => f.npcKills === 0,
  },
  take_damage: {
    id: "take_damage",
    text: "Bleed for it. A floor where nothing touched you is a floor nobody watched.",
    check: (f) => f.damageTaken >= 60,
  },
  environmental_quota: {
    id: "environmental_quota",
    text: "Two kills a floor using the room rather than a weapon. They sell the room.",
    check: (f) => f.environmentalKills >= 2,
  },
  clear_rooms: {
    id: "clear_rooms",
    text: "Clear six places a floor. They are paying for progress, not for a siege.",
    check: (f) => f.roomsCleared >= 6,
  },
};

export interface SponsorDef {
  id: string;
  name: string;
  budget: Tier;
  agenda: string;
  /** What draws their eye in the first place. */
  wants: (c: Counters) => boolean;
  clause: ClauseId;
  /** What they send when you sign, and again each floor you keep the clause. */
  gives: { box: string; tier: Tier };
  pitch: string;
}

export const SPONSORS: readonly SponsorDef[] = [
  {
    id: "valtay", name: "Valtay Corporation", budget: "Gold",
    agenda: "Long-game manipulation. The gear is genuinely useful and the strings do not become visible for three floors.",
    wants: (c) => c.bossKills >= 1,
    clause: "clear_rooms",
    gives: { box: "benefactor", tier: "Silver" },
    pitch: "They have been watching since your first boss and they would like to be helpful. That is the word they use.",
  },
  {
    id: "oipan", name: "Open Intellect Pacifist Action Network", budget: "Platinum",
    agenda: "Anti-violence advocates who will spend an obscene sum at exactly the right moment and then ask you to stop.",
    wants: (c) => c.parleys + c.spared >= 1,
    clause: "spare_someone",
    gives: { box: "pacifist", tier: "Gold" },
    pitch: "They noticed you let something live. They would like to make that a habit, and they are prepared to pay for the habit.",
  },
  {
    id: "titan", name: "Titan Conglomerate", budget: "Gold",
    agenda: "Heavy industry. Sends armour and machinery and expects to see you survive visibly inside it.",
    wants: (c) => c.damageTaken >= 150,
    clause: "take_damage",
    gives: { box: "benefactor", tier: "Silver" },
    pitch: "Their products are rated for punishment and you appear to be a testing environment.",
  },
  {
    id: "guild_suffering", name: "The Guild of Suffering", budget: "Gold",
    agenda: "Believes hardship is the point. Rewards you for taking the hit rather than avoiding it.",
    wants: (c) => c.nearDeaths >= 2,
    clause: "no_flee",
    gives: { box: "heavy", tier: "Silver" },
    pitch: "You have nearly died more than once and stayed anyway. They consider that a form of worship.",
  },
  {
    id: "plenty", name: "Plenty", budget: "Silver",
    agenda: "Food conglomerate. Their products are edible and their advertising is relentless.",
    wants: (c) => c.roomsCleared >= 4,
    clause: "kill_quota",
    gives: { box: "apothecary", tier: "Silver" },
    pitch: "They want volume, they want it on camera, and they want you eating something branded while you do it.",
  },
  {
    id: "prism", name: "Prism Industries", budget: "Gold",
    agenda: "Optics and precision instruments. Wants demonstrations of their equipment under fire.",
    wants: (c) => c.environmentalKills >= 2,
    clause: "environmental_quota",
    gives: { box: "mechanic", tier: "Gold" },
    pitch: "Somebody in procurement watched you drop a bus on something and has requested a repeat performance.",
  },
  {
    id: "dnadia", name: "Princess D'nadia", budget: "Gold",
    agenda: "An individual patron with taste, patience, and an agenda entirely her own.",
    wants: (c) => c.unarmedKills >= 3,
    clause: "unarmed_share",
    gives: { box: "savage", tier: "Gold" },
    pitch: "She finds the weaponry vulgar. She has said so, publicly, in a way that moved the market.",
  },
  {
    id: "secs", name: "Society for the Eradication of Cocker Spaniels", budget: "Bronze",
    agenda: "Exactly what it says. Nobody has established where the money comes from.",
    wants: (c) => c.kills >= 20,
    clause: "no_npc_kills",
    gives: { box: "fan", tier: "Silver" },
    pitch: "They will not explain the name. They will not be drawn on the name. The offer is real.",
  },
];

export const SPONSOR_BY_ID: Record<string, SponsorDef> = Object.fromEntries(
  SPONSORS.map((s) => [s.id, s]),
);
