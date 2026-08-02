import type {
  Combatant,
  Companion,
  EncounterState,
  GameState,
  Item,
  MapNode,
  StatKey,
  Style,
  Zone,
} from "../core/types.ts";
import { STAT_NAMES } from "../core/types.ts";
import { EventLog, type GameEvent } from "../core/events.ts";
import { Rng } from "../core/rng.ts";
import { article, clamp, commaList } from "../core/util.ts";
import { ProceduralNarrator, type Narrator, type RenderedLine } from "../voice/narrator.ts";
import { generateFloor, currentNode, revealFrom, route } from "./map.ts";
import {
  advanceToCrawler,
  attemptFlee,
  beginEncounter,
  checkEnd,
  moveTo,
  resolveAttack,
  useFeature,
} from "./combat.ts";
import { byId, crawlerOf, hostilesOf, living, stepToward, zoneDistance, zoneOf } from "./tactics.ts";
import { carriedWeight, carryCapacity, derive, grantXp, regenPerHour, skillLevel, trainSkill, xpForLevel } from "./character.ts";
import { fromId, makeItem, openBox, usageTags } from "./loot.ts";
import { BOSS_BY_ID, MOB_BY_ID, RANK_STAR } from "../data/mobs.ts";
import { RANK_TIER, TIERS, BOX_BY_ID, type Tier } from "../data/boxes.ts";
import { makeStatus, STATUS_BY_ID } from "../data/statuses.ts";
import { ACHIEVEMENTS, ENTRY_ACHIEVEMENTS } from "../data/achievements.ts";
import { SKILL_BY_ID, skillMilestone } from "../data/skills.ts";
import { CLASS_BY_ID, RACE_BY_ID } from "../data/paths.ts";
import { floorDef } from "../data/floors.ts";
import {
  applyViews,
  auditSponsors,
  considerSponsorOffer,
  hunterDue,
  scoreEvent,
  scoreKill,
  signSponsor,
  worldTick,
} from "./show.ts";
import { buildFromIntake, DEFAULT_INTAKE, type Intake } from "./intake.ts";
import {
  brew, buySpace, buyPrice, buyUpgrade, canCraft, craft, experiment, installStation,
  inSafeRoom, rollShopStock, sellPrice, startingRecipes, stationsHere,
  BREWS, RECIPES, RECIPE_BY_ID, SPACE_COST, STATIONS, STATION_BY_ID, UPGRADES,
} from "./craft.ts";
import { calledShotModifier, deliverDevice, describeTraits, traitsOf } from "./devices.ts";
import { checkMinting, generateClassOptions, hookBonus, hookFraction, notePractice, type ClassOption } from "./emergent.ts";
import { castSpell, knownSpells, learnSpell, spellFromTome, tickCooldowns } from "./spells.ts";
import { interpret, ruleOnClaim } from "./improvise.ts";
import { depositsHere, harvest, materialOf, strainNote, strainStage, type Deposit } from "./harvest.ts";
import { checkTransform, readTransform, runTransform, transformMenu } from "./transform.ts";
import { TRANSFORM_BY_ID } from "../data/transforms.ts";
import { mint } from "./propose.ts";
import { NoProposer, type Proposer } from "../voice/proposer.ts";
import type { Proposal } from "../core/proposal.ts";
import { generateSpell } from "../data/spells.ts";

/**
 * The facade. One class, one state object, one method that takes a command
 * and returns what happened.
 *
 * Everything above this line is a pure system. Everything below it is a user
 * interface. Nothing in a UI can reach past this into the simulation, which
 * means the terminal client, the balance harness and the test suite are all
 * playing exactly the same game.
 */

export type Command =
  // ------- exploring
  | { t: "look" }
  /**
   * Looking at something properly. Free, in and out of combat, and strictly a
   * view over what standing here already tells you — never a reveal.
   */
  | { t: "examine"; what?: string }
  | { t: "go"; to: string }
  | { t: "search" }
  | { t: "scout"; node: string }
  | { t: "wait"; hours: number }
  | { t: "descend" }
  // ------- setting up
  | { t: "prep"; what: "barricade" | "trap" | "ambush" | "breather"; zone?: string }
  /** Take a substance out of the room it is part of. */
  | { t: "harvest"; what?: string; qty?: number; zone?: string }
  /** Do something to a substance until it is a different substance. */
  | { t: "transform"; rule?: string; input?: string; batches?: number; said?: string }
  | { t: "engage" }
  // ------- fighting
  | { t: "attack"; target: string; called?: boolean }
  | { t: "move"; zone: string }
  | { t: "feature"; id: string }
  | { t: "throw"; item: string; zone?: string }
  | { t: "brace" }
  | { t: "aim" }
  | { t: "intimidate" }
  | { t: "parley" }
  | { t: "flee" }
  | { t: "endturn" }
  // ------- housekeeping
  | { t: "use"; item: string }
  | { t: "equip"; item: string }
  | { t: "unequip"; item: string }
  | { t: "drop"; item: string }
  | { t: "rest" }
  | { t: "eat" }
  | { t: "open" }
  | { t: "spend"; stat: StatKey }
  | { t: "select"; race: string; klass: string }
  | { t: "sign"; sponsor: string }
  // ------- the parts that grow
  | { t: "cast"; spell: string; target?: string }
  | { t: "improvise"; text: string }
  | { t: "claim"; what: string; why: string }
  // ------- keeping a very large inventory usable
  | { t: "equipBest" }
  | { t: "dropJunk" }
  | { t: "lock"; item: string }
  | { t: "stance"; who: string; stance: "aggressive" | "defensive" | "support" | "hide" }
  // ------- building things, and spending the money on doing so
  | { t: "craft"; what: string }
  | { t: "brew"; what: string }
  | { t: "experiment" }
  | { t: "deploy"; item: string; target?: string }
  | { t: "shop" }
  | { t: "buy"; what: string }
  | { t: "sell"; what: string }
  | { t: "buySpace" }
  | { t: "install"; what: string }
  | { t: "upgrade"; what: string };

export interface TurnResult {
  lines: RenderedLine[];
  events: GameEvent[];
}

const HOURS_PER_ROUND = 0.02; // ~70 seconds a round, and it adds up

export class Game {
  state: GameState;
  private rng: Rng;
  private log: EventLog;
  narrator: Narrator;
  /**
   * The Dungeon Master seat, empty by default.
   *
   * Every path it opens is reachable without it. Assigning one widens the range
   * of sentences the game can read; it cannot widen the range of things the
   * game can do, because everything mechanical downstream is derived by
   * `src/sim/propose.ts` from quantities the engine already owns.
   */
  proposer: Proposer;

  private constructor(state: GameState, narrator?: Narrator, proposer?: Proposer) {
    this.state = state;
    this.rng = new Rng(state.rng);
    this.log = new EventLog(() => this.state.elapsed);
    this.narrator = narrator ?? new ProceduralNarrator(Rng.fromSeed(state.seed ^ 0x5f3759df));
    this.proposer = proposer ?? new NoProposer();
  }

  static create(seed: number, intake: Partial<Intake> = {}, narrator?: Narrator): Game {
    const full: Intake = { ...DEFAULT_INTAKE, ...intake };
    const rng = Rng.fromSeed(seed);
    const build = buildFromIntake(rng, full);

    const companions: Companion[] = [];
    if (full.companion !== "none") {
      const base = {
        cat: { name: "the cat", species: "Cat", stats: { str: 2, dex: 8, con: 2, int: 2, cha: 7 }, note: "Small, furious, and entirely unbothered by the end of the world." },
        dog: { name: "the dog", species: "Dog", stats: { str: 5, dex: 5, con: 5, int: 2, cha: 5 }, note: "Has decided all of this is survivable because you are here." },
        person: { name: "the other survivor", species: "Human", stats: { str: 4, dex: 4, con: 4, int: 4, cha: 4 }, note: "Came down the same stairwell. Neither of you has decided yet whether that makes you a party." },
      }[full.companion];
      companions.push({
        id: full.companion,
        name: base.name,
        species: base.species,
        sapient: full.companion === "person",
        level: 1,
        hp: 18 + base.stats.con * 5,
        hpMax: 18 + base.stats.con * 5,
        stats: base.stats,
        stance: "defensive",
        trust: 10,
        mood: "wary",
        alive: true,
        note: base.note,
      });
    }

    const stats = build.stats;
    const state: GameState = {
      version: 1,
      seed,
      rng: rng.save(),
      elapsed: 0,
      crawler: {
        name: full.name,
        number: rng.int(1000, 99999),
        level: 1,
        xp: 0,
        stats,
        banked: 0,
        points: 0,
        hp: 30 + stats.con * 8 + 6,
        hpMax: 30 + stats.con * 8 + 6,
        mana: stats.int,
        manaMax: stats.int,
        stamina: 40 + stats.con * 2 + stats.str * 2,
        staminaMax: 40 + stats.con * 2 + stats.str * 2,
        fatigue: 0,
        hunger: 0,
        gold: 0,
        bounty: 0,
        race: null,
        klass: null,
        skillCap: 15,
        statuses: [],
        stars: [],
        alive: true,
        origin: { job: full.job, hobby: full.hobby, dress: full.dress, carried: full.carried },
      },
      inventory: build.items,
      skills: Object.fromEntries(Object.entries(build.skills).map(([k, v]) => [k, { level: v, xp: 0 }])),
      boxes: [],
      companions,
      sponsors: [],
      offers: [],
      ratings: { views: 0, followers: 0, favourites: 0, peak: 0, recent: [], floorStart: 0, lastSpikeAt: 0 },
      counters: {
        kills: 0, bossKills: 0, unarmedKills: 0, environmentalKills: 0, punchingUpKills: 0,
        npcKills: 0, fled: 0, parleys: 0, boxesOpened: 0, roomsCleared: 0, trapsSet: 0,
        damageTaken: 0, damageDealt: 0, nearDeaths: 0, crawlersMet: 0, spared: 0,
      },
      floorTally: blankTally(),
      achievements: [],
      floor: generateFloor(seed, 1),
      encounter: null,
      memory: [],
      world: { crawlersLeft: 12_800_000, feed: [], dead: [] },
      flags: {},
      history: [],
      practice: {},
      minted: {},
      spellbook: {},
      cooldowns: {},
      claims: 0,
      recipes: [],
      dug: {},
      space: { owned: false, stations: [], upgrades: [] },
      shop: null,
      restores: { room: true, floor: true },
      checkpoints: { room: null, floor: null },
      pendingDeath: null,
    };

    state.recipes = startingRecipes(state);
    const game = new Game(state, narrator);
    game.openingBeats(full, build.verdict);
    game.takeCheckpoint("floor");
    return game;
  }

  static load(state: GameState, narrator?: Narrator): Game {
    // A save written before the material layer existed has no record of what
    // has been dug out of anything, which is correct: nothing had been.
    state.dug ??= {};
    state.ratings.recent ??= [];
    state.ratings.floorStart ??= 0;
    state.ratings.lastSpikeAt ??= 0;
    return new Game(state, narrator);
  }

  save(): GameState {
    this.state.rng = this.rng.save();
    return this.state;
  }

  /* ------------------------------------------------------------ opening */

  private openingBeats(intake: Intake, verdict: string): void {
    const s = this.state;
    revealFrom(s.floor, s.floor.at);
    this.log.prose(
      `The stairwell is still warm.\n\n` +
        `An hour ago there was a street above this, and a sky, and the specific ordinary weight of being ${article(intake.job.toLowerCase())}. ` +
        `Then every roofed structure on Earth went down at once — not toppled, withdrawn, like a hand closing — and the ground opened in a hundred and fifty thousand places, and a voice that was very pleased with itself explained the rules.\n\n` +
        `You came down ${dressLine(intake.dress)}. There is rock overhead now and a corridor ahead that smells of wet stone and something organic that stopped being urgent about being dead a while ago. Behind you, the stairs are gone.`,
    );
    this.log.say(
      `Welcome, Crawler #${s.crawler.number}. We had just under thirteen million of you through the gates. We are already under ten. Please enjoy your stay, and remember that the audience can always tell when you are not trying.`,
    );
    this.log.say(verdict);

    for (const a of ENTRY_ACHIEVEMENTS) {
      if (!a.test({ dress: intake.dress, carried: intake.carried, companion: intake.companion })) continue;
      this.award(a.id, a.name, a.text, a.box);
    }
    this.log.say(
      "Your boxes are locked. They stay locked until you reach a safe room, at which point every one of them opens at once whether you are ready or not. This is not a punishment. It is a business model.",
    );
  }

  /* ------------------------------------------------------------ commands */

  async execute(cmd: Command): Promise<TurnResult> {
    if (!this.state.crawler.alive) {
      this.log.say("You are dead. The feed has moved on and so, frankly, have we.");
      return this.finish();
    }

    try {
      // Freeform text is resolved before dispatch because the Dungeon Master
      // seat is asynchronous and everything downstream of it is not. The
      // deterministic interpreter always runs first and is always enough on
      // its own; the model is only consulted when it came back empty-handed.
      const resolved = cmd.t === "improvise" ? await this.readFreeform(cmd.text) : cmd;
      if (resolved) this.dispatch(resolved);
    } catch (err) {
      // A bad command should cost the player a sentence, never the run.
      this.log.say(err instanceof Error ? err.message : String(err));
    }

    this.syncDerived();
    // The dungeon works out whether what you keep doing deserves a name.
    checkMinting(this.state, this.rng, this.log);
    this.checkAchievements();
    this.state.rng = this.rng.save();
    return this.finish();
  }

  /**
   * Stat drift and swapped gear move the real maxima underneath the stored
   * ones. Recomputing them once per command keeps the displayed sheet honest
   * and stops health or mana sitting above a cap that quietly moved.
   */
  private syncDerived(): void {
    const d = derive(this.state);
    const c = this.state.crawler;
    c.hpMax = d.hpMax;
    c.manaMax = d.manaMax;
    c.staminaMax = d.staminaMax;
    c.hp = clamp(c.hp, 0, d.hpMax);
    c.mana = clamp(c.mana, 0, d.manaMax);
    c.stamina = clamp(c.stamina, 0, d.staminaMax);
  }

  private async finish(): Promise<TurnResult> {
    const events = this.log.drain();
    const lines = await this.narrator.render(events, this.state);
    return { lines, events };
  }

  private dispatch(cmd: Command): void {
    const enc = this.state.encounter;
    const fighting = enc !== null && enc.finished === null;

    if (fighting) {
      switch (cmd.t) {
        case "attack": return this.cmdAttack(cmd.target, cmd.called === true);
        case "move": return this.cmdMove(cmd.zone);
        case "feature": return this.cmdFeature(cmd.id);
        case "throw": return this.cmdThrow(cmd.item, cmd.zone);
        case "brace": return this.cmdBrace();
        case "aim": return this.cmdAim();
        case "intimidate": return this.cmdIntimidate();
        case "parley": return this.cmdParley();
        case "flee": return this.cmdFlee();
        case "endturn": return this.endTurn();
        case "use": return this.cmdUse(cmd.item, true);
        case "cast": return this.cmdCast(cmd.spell, cmd.target);
        case "improvise": return this.cmdImprovise(cmd.text);
        case "look": return this.cmdLook();
        case "examine": return this.cmdExamine(cmd.what);
        case "lock": return this.cmdLock(cmd.item);
        case "deploy": return this.cmdDeploy(cmd.item, cmd.target);
        default:
          throw new Error("Not while something is trying to kill you.");
      }
    }

    switch (cmd.t) {
      case "look": return this.cmdLook();
      case "examine": return this.cmdExamine(cmd.what);
      case "go": return this.cmdGo(cmd.to);
      case "search": return this.cmdSearch();
      case "scout": return this.cmdScout(cmd.node);
      case "wait": return this.cmdWait(cmd.hours);
      case "descend": return this.cmdDescend();
      case "prep": return this.cmdPrep(cmd.what, cmd.zone);
      case "harvest": return this.cmdHarvest(cmd.what, cmd.qty, cmd.zone);
      case "transform": return this.cmdTransform(cmd);
      case "engage": return this.cmdEngage();
      case "use": return this.cmdUse(cmd.item, false);
      case "equip": return this.cmdEquip(cmd.item);
      case "unequip": return this.cmdUnequip(cmd.item);
      case "drop": return this.cmdDrop(cmd.item);
      case "rest": return this.cmdRest();
      case "eat": return this.cmdEat();
      case "open": return this.cmdOpenBoxes();
      case "spend": return this.cmdSpend(cmd.stat);
      case "select": return this.cmdSelect(cmd.race, cmd.klass);
      case "sign": return this.cmdSign(cmd.sponsor);
      case "cast": return this.cmdCast(cmd.spell, cmd.target);
      case "improvise": return this.cmdImprovise(cmd.text);
      case "claim": return this.cmdClaim(cmd.what, cmd.why);
      case "equipBest": return this.cmdEquipBest();
      case "dropJunk": return this.cmdDropJunk();
      case "lock": return this.cmdLock(cmd.item);
      case "stance": return this.cmdStance(cmd.who, cmd.stance);
      case "craft": return this.cmdCraft(cmd.what);
      case "brew": return this.cmdBrew(cmd.what);
      case "experiment": return this.cmdExperiment();
      case "deploy": return this.cmdDeploy(cmd.item, cmd.target);
      case "shop": return this.cmdShop();
      case "buy": return this.cmdBuy(cmd.what);
      case "sell": return this.cmdSell(cmd.what);
      case "buySpace": return this.cmdBuySpace();
      case "install": return this.cmdInstall(cmd.what);
      case "upgrade": return this.cmdUpgrade(cmd.what);
      default:
        throw new Error("There is nothing to fight here.");
    }
  }

  /* -------------------------------------------------------- exploration */

  private cmdLook(): void {
    const node = currentNode(this.state.floor);
    this.log.push({
      kind: "arrive",
      channel: "narration",
      node: node.name,
      nodeKind: node.kind,
      // Join rather than choose. `||` meant that any room with an authored note
      // — vaults, lairs, shrines, shops, stairwells, safe rooms, guild halls —
      // never listed what was standing in it, which is precisely where the
      // things you can drop on a boss live.
      description: [node.note, describeRoom(node)].filter(Boolean).join(" "),
    });
  }

  /**
   * Looking at something properly.
   *
   * Two rules hold this together. It is FREE — no minutes, no combat action,
   * never a reason to be punished for asking a question mid-fight — and it is
   * a VIEW OVER ALREADY-REVEALED STATE, never a reveal. Standing in a room
   * tells you what is standing in it; it does not tell you what is in the
   * cupboards, what is waiting in the next room, or who is holding their
   * breath behind the shelving. Those cost `search`, `scout` and being wrong.
   *
   * Getting that boundary right is what stops "examine" becoming free scouting.
   */
  private cmdExamine(what?: string): void {
    const node = currentNode(this.state.floor);
    const enc = this.state.encounter && !this.state.encounter.finished ? this.state.encounter : null;
    const ref = (what ?? "").trim().toLowerCase();

    const say = (subject: string, scope: "room" | "zone" | "feature" | "item" | "target" | "self", facts: string[]) =>
      this.log.push({ kind: "perceive", channel: scope === "self" ? "system" : "narration", subject, scope, facts });

    if (!ref || /^(room|here|around|place|surroundings|it)$/.test(ref)) return this.examineRoom(node, enc, say);
    if (/^(me|myself|self|my ?self)$/.test(ref)) return this.examineSelf(say);

    // The same nearest-legal-reading ladder the interpreter uses: a position,
    // then a thing in the room, then a thing in your hands, then a thing
    // trying to kill you.
    const zone = node.zones.find((z) => {
      const words = z.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return z.id === ref || words.some((w) => ref.includes(w));
    });
    if (zone) {
      const here = enc ? crawlerOf(enc).zone === zone.id : false;
      const facts = [describeZone(zone)];
      if (enc) {
        const there = living(enc).filter((c) => c.zone === zone.id);
        if (there.length) facts.push(`${commaList(there.map((c) => (c.side === "crawler" ? "you" : c.name)))} ${there.length === 1 ? "is" : "are"} in it.`);
        const gap = zoneDistance(node, crawlerOf(enc).zone, zone.id);
        facts.push(here ? "You are standing in it." : `${gap} ${gap === 1 ? "position" : "positions"} from you.`);
      }
      return say(zone.name.replace(/^the /, "The "), "zone", facts);
    }

    const feature = node.zones
      .flatMap((z) => z.features.map((f) => ({ f, z })))
      .find(({ f }) => {
        const words = f.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
        return f.id === ref || words.some((w) => ref.includes(w));
      });
    if (feature) {
      const { f, z } = feature;
      const facts = [f.note];
      if (f.spent) facts.push("It has already been used. There is nothing left in it.");
      else {
        const need = f.check.stat
          ? `${STAT_NAMES[f.check.stat]} — yours is ${derive(this.state).stats[f.check.stat]}`
          : f.check.skill
            ? `${SKILL_BY_ID[f.check.skill]?.name ?? f.check.skill} — yours is ${skillLevel(this.state, f.check.skill)}`
            : "nothing but the nerve to try it";
        facts.push(`Using it wants ${need}, against a difficulty of ${f.dc}.`);
        if (f.primes?.length) {
          facts.push(`It sets something up rather than finishing it: anything ${commaList(f.primes)} afterwards lands very differently.`);
        }
        facts.push(`It is in ${z.name}.`);
      }
      return say(f.name.replace(/^the /, "The "), "feature", facts);
    }

    const item = this.state.inventory.find((i) => {
      const words = i.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
      return i.iid === ref || i.name.toLowerCase() === ref || words.some((w) => ref.includes(w));
    });
    if (item) {
      const facts = [item.desc];
      if (item.damage) facts.push(`It does ${item.damage}.`);
      if (item.mods?.length) facts.push(`It carries ${commaList(item.mods.map((m) => `${m.k}${typeof m.v === "number" ? ` ${m.v > 0 ? "+" : ""}${m.v}` : ""}`))}.`);
      if (item.device) facts.push(`Built: ${item.device.note}${item.device.vital ? " It goes through things." : ""}`);
      facts.push(`${item.weight} kg, worth about ${item.value} gold, ${item.rarity}${item.equipped ? ", and you are wearing it" : ""}.`);
      return say(item.name, "item", facts);
    }

    if (enc) {
      const foe = living(enc, "hostile").find((c) =>
        c.id === ref || c.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && ref.includes(w)),
      );
      if (foe) {
        const facts = [MOB_BY_ID[foe.sourceId]?.desc ?? BOSS_BY_ID[foe.sourceId]?.desc ?? ""];
        facts.push(`Level ${foe.level}, ${Math.round(foe.hp)} of ${foe.hpMax} health left, armoured ${foe.armor}, reach ${foe.reach}.`);
        const traits = describeTraits(foe);
        if (traits) facts.push(`It is ${traits}.`);
        const gap = zoneDistance(node, crawlerOf(enc).zone, foe.zone);
        facts.push(gap === 0 ? "It is close enough to touch." : `${gap} ${gap === 1 ? "position" : "positions"} away, in ${zoneOf(node, foe.zone).name}.`);
        return say(foe.name, "target", facts.filter(Boolean));
      }
    }

    // Named something that is not a distinct object here — "the walls", "the
    // floor", "the ceiling". Those are not nothing: they are the room, and the
    // room report already knows what it is made of. Answering the question
    // that was asked beats being technically correct about the noun.
    this.examineRoom(node, enc, (subject, scope, facts) =>
      say(subject, scope, [`Nothing here is called "${what}" in particular, so: the room.`, ...facts]),
    );
  }

  private examineRoom(
    node: MapNode,
    enc: EncounterState | null,
    say: (s: string, scope: "room" | "zone" | "feature" | "item" | "target" | "self", f: string[]) => void,
  ): void {
    const facts: string[] = [];
    if (node.note) facts.push(node.note);

    const features = node.zones.flatMap((z) => z.features.filter((f) => !f.spent));
    if (features.length) {
      facts.push(`Worth knowing about: ${commaList(features.map((f) => f.name))}.`);
    }

    // What the place is made of, answered only from tags that the resolver
    // actually reads. No inventing stone and iron.
    const material = new Set<string>();
    for (const z of node.zones) {
      if (z.tags.includes("water")) material.add("standing water, which carries a current a great deal better than air does");
      if (z.tags.includes("flammable")) material.add("something that will take a light and keep it");
      if (z.tags.includes("rubble")) material.add("broken ground you cannot move quickly across");
      if (z.tags.includes("dark")) material.add("dark enough that nothing at range is reliable");
      if (z.hazard) material.add(`${z.hazard.kind}, active, right now`);
    }
    if (material.size) facts.push(`The room itself: ${commaList([...material])}.`);

    // What it is BUILT OF, as opposed to what it is like to fight in. This is
    // the sentence the whole material layer exists to be able to say, and
    // saying it is what turns a wall from scenery into an offer.
    const seams = depositsHere(this.state, node);
    if (seams.length) {
      facts.push(
        `Made of: ${seams
          .map(({ zone, deposits }) => `${zone.name} — ${commaList(deposits.map((d) => `${d.left} ${d.mat.name.toLowerCase()}`))}`)
          .join("; ")}.`,
      );
      for (const { zone } of seams) {
        const stage = strainStage(this.state, node, zone);
        if (stage !== "sound" && stage !== "working") facts.push(`${capitalise(zone.name)}: ${strainNote(stage)}`);
      }
    }

    const chokes = node.zones.filter((z) => z.capacity <= 2);
    if (chokes.length) {
      facts.push(
        capitalise(
          `${commaList(chokes.map((z) => `${z.name} takes ${z.capacity}`))} at a time — that is where being outnumbered stops mattering.`,
        ),
      );
    }
    const high = node.zones.filter((z) => z.tags.includes("high"));
    if (high.length) facts.push(capitalise(`${commaList(high.map((z) => z.name))} is above the rest of it.`));

    facts.push(node.searched ? "You have already been through this place properly." : "You have not searched it.");
    if (node.hasStairs && this.state.floor.stairsAnnounced) facts.push("There is a way down from here.");

    // Exits: only what walking in has already told you.
    const known = node.links.filter((l) => l.known || this.state.floor.nodes[l.to]!.visited);
    if (known.length) {
      facts.push(
        `Ways out: ${commaList(known.map((l) => {
          const n = this.state.floor.nodes[l.to]!;
          return `${n.visited ? n.name : "somewhere unvisited"} (${l.minutes} minutes)`;
        }))}.`,
      );
    }
    if (enc) {
      const me = crawlerOf(enc);
      facts.push(`You are in ${zoneOf(node, me.zone).name}.`);
    }
    say(node.name.replace(/^the /, "The "), "room", facts);
  }

  private examineSelf(
    say: (s: string, scope: "room" | "zone" | "feature" | "item" | "target" | "self", f: string[]) => void,
  ): void {
    const s = this.state;
    const c = s.crawler;
    const d = derive(s);
    const facts: string[] = [];

    facts.push(`${Math.round(c.hp)} of ${d.hpMax} health.`);
    facts.push(`${s.floor.hoursLeft.toFixed(1)} hours before this floor closes.`);
    const left = [s.restores.room && "the room", s.restores.floor && "the floor"].filter(Boolean) as string[];
    facts.push(left.length ? `Backloads left: ${commaList(left)}.` : "No backloads left. The next death is the run.");
    facts.push(`Level ${c.level}. Accuracy +${d.accuracy}, defence ${d.defense}, armour ${d.armor}, ${d.weaponName} at ${d.weaponDamage}+${d.damageBonus}.`);
    if (d.manaMax > 0) facts.push(`${Math.round(c.mana)} of ${d.manaMax} mana.`);

    // Fatigue and hunger as what they cost you, not as integers nobody can price.
    if (c.fatigue > 60) facts.push(`Fatigue ${Math.round(c.fatigue)}${c.fatigue > 85 ? " — past the line, and it is taking two off everything" : ", and climbing"}.`);
    if (c.hunger > 60) facts.push(`Hunger ${Math.round(c.hunger)}${c.hunger > 85 ? " — starving, and it shows in every roll" : ""}.`);
    if (c.statuses.length) facts.push(`${commaList(c.statuses.map((x) => x.name))}.`);
    if (c.points > 0) facts.push(`${c.points} unspent points.`);
    if (s.boxes.length) facts.push(`${s.boxes.length} unopened ${s.boxes.length === 1 ? "box" : "boxes"}, waiting for a safe room.`);
    const heals = s.inventory.filter((i) => i.use?.effect === "heal").reduce((n, i) => n + i.qty, 0);
    facts.push(heals ? `${heals} healing item${heals === 1 ? "" : "s"} in the bag.` : "Nothing in the bag that heals you.");
    facts.push(`${carriedWeight(s)} kg carried against a ${carryCapacity(s)} kg ceiling.`);

    say("You", "self", facts);
  }

  private cmdGo(to: string): void {
    const floor = this.state.floor;
    const here = currentNode(floor);
    const target = this.resolveNode(to);
    const direct = here.links.find((l) => l.to === target.id);

    if (!direct) {
      const path = route(floor, here.id, target.id);
      if (!path) throw new Error("You do not know a way there from here.");
      // Multi-leg travel: real minutes on every leg, and the world keeps
      // moving through all of them.
      for (let i = 1; i < path.length; i++) {
        const leg = floor.nodes[path[i - 1]!]!.links.find((l) => l.to === path[i])!;
        this.travelLeg(floor.nodes[path[i]!]!, leg.minutes);
        if (!this.state.crawler.alive || this.state.encounter) return;
      }
      return;
    }
    this.travelLeg(target, direct.minutes);
  }

  private travelLeg(target: MapNode, minutes: number): void {
    const floor = this.state.floor;
    const first = !target.visited;
    this.advanceTime(minutes / 60, "travel");
    if (!this.state.crawler.alive) return;

    floor.at = target.id;
    revealFrom(floor, target.id);
    // Before anything in the new room gets a turn.
    this.takeCheckpoint("room");
    this.log.push({ kind: "travel", channel: "narration", from: "", to: target.name, minutes, firstVisit: first });
    this.log.push({
      kind: "arrive",
      channel: "narration",
      node: target.name,
      nodeKind: target.kind,
      description: [target.note, describeRoom(target)].filter(Boolean).join(" "),
    });
    if (target.hasStairs && floor.stairsAnnounced) {
      this.log.push({ kind: "stairs", channel: "good", found: true, node: target.name });
    }

    this.state.flags.undetected = false;
    if (this.hostilePresence(target)) this.arriveOnHostiles(target);
  }

  private hostilePresence(node: MapNode): boolean {
    if (node.cleared) return false;
    if (node.boss && !this.state.floor.bossesKilled.includes(node.boss)) return true;
    return node.spawn.length > 0;
  }

  private arriveOnHostiles(node: MapNode): void {
    const count = node.spawn.reduce((n, g) => n + g.count, 0) + (node.boss ? 3 : 0);
    const scouted = this.state.flags[`scouted_${node.id}`] === true;
    const roll = this.rng.d(20) + skillLevel(this.state, "stealth") + (scouted ? 4 : 0);
    const dc = 11 + count * 2;

    if (roll >= dc) {
      this.state.flags.undetected = true;
      this.log.say(
        `Nothing in here has noticed you yet. That is worth more than any weapon you own, and it will not last. ` +
          `You can set something up, or you can walk in.`,
      );
      return;
    }
    this.startEncounter(node, false);
  }

  private cmdScout(nodeRef: string): void {
    const floor = this.state.floor;
    const here = currentNode(floor);
    const target = this.resolveNode(nodeRef);
    if (!here.links.some((l) => l.to === target.id)) {
      throw new Error("You can only scout somewhere you could walk into from here.");
    }

    this.advanceTime(0.2, "scouting");
    if (!this.state.crawler.alive) return;

    const roll = this.rng.d(20) + skillLevel(this.state, "stealth") + derive(this.state).stats.dex;
    const success = roll >= 12;
    const revealed: string[] = [];
    if (success) {
      this.state.flags[`scouted_${target.id}`] = true;
      target.sensed = true;
      for (const g of target.spawn) {
        const def = MOB_BY_ID[g.mob];
        if (def) revealed.push(`${g.count} × ${def.name}`);
      }
      if (target.boss && !floor.bossesKilled.includes(target.boss)) {
        revealed.push(`something the local mob is giving a wide berth: ${BOSS_BY_ID[target.boss]?.name ?? "a boss"}`);
      }
      for (const z of target.zones) {
        for (const f of z.features) if (!f.spent) revealed.push(`${f.name}, at ${z.name}`);
      }
      trainSkill(this.state, "stealth", 1);
      notePractice(this.state, "scouting");
    }
    this.log.push({
      kind: "scout",
      channel: success ? "good" : "bad",
      node: target.name,
      revealed,
      success,
      minutes: 12,
    });
  }

  private cmdSearch(): void {
    const node = currentNode(this.state.floor);
    if (this.hostilePresence(node)) throw new Error("Not with that still in the room.");
    if (node.searched) throw new Error("You have been through this place already.");

    const minutes = this.rng.int(22, 40);
    this.advanceTime(minutes / 60, "searching");
    if (!this.state.crawler.alive) return;

    node.searched = true;

    // A shrine is the one place a spell is guaranteed rather than hoped for.
    // Without it, a crawler who never sees a tome never casts anything, and a
    // whole system sits behind a drop rate.
    if (node.kind === "shrine" && !this.state.flags[`shrine_${node.id}`]) {
      this.state.flags[`shrine_${node.id}`] = true;
      const spell = spellFromTome(this.state, this.rng, usageTags(this.state.inventory.filter((i) => i.equipped), this.state.skills));
      if (learnSpell(this.state, spell, this.log)) {
        this.log.say(
          `Something here was owed something, and you have paid it by turning up. ${spell.name} is yours — ${spell.mana} mana, and your pool is your Intelligence, so think about that before you rely on it.`,
        );
      }
    }

    const scav = skillLevel(this.state, "scavenging");
    const extra = scav > 0 && this.rng.chance(clamp(scav * 0.09, 0, 0.6));
    if (extra) node.loot.push(makeItem(this.rng, { floor: this.state.floor.n, quality: 1 }));

    const found: string[] = [];
    for (const item of node.loot) {
      if (this.pickUp(item)) found.push(item.name);
    }
    node.loot = [];
    if (extra) trainSkill(this.state, "scavenging", 1);
    this.log.push({ kind: "search", channel: found.length ? "loot" : "narration", node: node.name, found, minutes });
  }

  private cmdWait(h: number): void {
    const hours = clamp(h, 0.25, 8);
    this.advanceTime(hours, "waiting");
    if (this.state.crawler.alive) {
      this.log.say(`${hours} hours gone. The clock does not care what you were doing with them.`);
    }
  }

  /* ------------------------------------------------------------- prep */

  private cmdPrep(what: "barricade" | "trap" | "ambush" | "breather", zoneRef?: string): void {
    const node = currentNode(this.state.floor);
    const minutes = { barricade: 30, trap: 20, ambush: 15, breather: 60 }[what];
    const zone = zoneRef
      ? node.zones.find((z) => z.id === zoneRef || z.name.includes(zoneRef)) ?? node.zones[0]!
      : node.zones[0]!;

    if (what === "breather") {
      this.advanceTime(1, "catching your breath");
      if (!this.state.crawler.alive) return;
      this.log.push({ kind: "prep", channel: "good", what, zone: zone.name, minutes, note: "An hour sitting still. Not sleep, but it puts something back." });
      return;
    }

    if (what === "trap") {
      const skill = Math.max(skillLevel(this.state, "engineering"), skillLevel(this.state, "electrical"));
      const wire = this.consume("wire") || this.consume("scrap");
      if (!wire && skill < 3) {
        throw new Error("You have nothing to build it from and not enough skill to improvise.");
      }
      zone.traps.push({
        name: "a tripwire and something heavy",
        damage: `${1 + Math.floor(skill / 3)}d6`,
        status: skill >= 5 ? "bleeding" : undefined,
        hidden: true,
      });
      this.state.counters.trapsSet++;
      notePractice(this.state, "trap_kill");
      trainSkill(this.state, "engineering", 2);
    } else if (what === "barricade") {
      if (skillLevel(this.state, "engineering") < 1 && !node.zones.some((z) => z.features.some((f) => f.kind === "barricade_stock"))) {
        throw new Error("Nothing here to build with, and you would not know how to use it if there were.");
      }
      zone.barricaded = true;
      trainSkill(this.state, "engineering", 2);
    } else {
      this.state.flags.ambushReady = true;
      trainSkill(this.state, "stealth", 2);
    }

    this.advanceTime(minutes / 60, what);
    if (!this.state.crawler.alive) return;

    this.log.push({
      kind: "prep",
      channel: "good",
      what,
      zone: zone.name,
      minutes,
      note: {
        barricade: `You close ${zone.name} with everything you can drag. Whatever comes through now comes through slowly.`,
        trap: `You rig ${zone.name}. It is crude and it is patient and it does not need you to be awake.`,
        ambush: `You get low and stop moving. The room settles back into thinking it is empty.`,
        breather: "",
      }[what],
    });

    // The longer you fiddle, the likelier something wanders over to see what
    // the noise is. This is what stops preparation from being free.
    if (this.state.flags.undetected && this.hostilePresence(node)) {
      const count = node.spawn.reduce((n, g) => n + g.count, 0);
      if (this.rng.d(20) + skillLevel(this.state, "stealth") < 9 + count) {
        this.log.say("Something in here stops what it was doing and looks directly at where you are.");
        this.startEncounter(node, false);
      }
    }
  }

  /**
   * Taking a piece of the dungeon with you.
   *
   * The resolution ladder is the same one everything else in here uses: name a
   * material and you get that material, name a position and you get the best
   * thing in it, name nothing and you get the most useful thing in the room.
   * A crawler who says "knock some limestone out of the wall" and a crawler who
   * says "harvest" both end up somewhere sensible, because being made to guess
   * the magic word is the thing this whole layer exists to stop.
   */
  private cmdHarvest(what?: string, qty?: number, zoneRef?: string): void {
    const node = currentNode(this.state.floor);
    const ref = (what ?? "").trim().toLowerCase();
    const here = depositsHere(this.state, node);

    if (!here.length) {
      throw new Error(
        "There is nothing in this room worth taking out of it — nothing loose, nothing seamed, nothing you could not find more easily somewhere else.",
      );
    }

    // A named position is honoured or refused, never silently swapped. Digging
    // somewhere else because the place you pointed at was empty is the exact
    // species of helpfulness that makes a game feel like it is not listening.
    let pool = here;
    if (zoneRef) {
      const named = node.zones.find(
        (z) => z.id === zoneRef || z.name.toLowerCase().includes(zoneRef.toLowerCase()),
      );
      pool = here.filter(({ zone }) => zone === named);
      if (!pool.length) {
        throw new Error(
          named
            ? strainStage(this.state, node, named) === "down"
              ? `${capitalise(named.name)} has already come down. Whatever was in that wall is under it.`
              : `There is nothing left worth taking out of ${named.name}.`
            : `There is no ${zoneRef} in this room.`,
        );
      }
    }

    // Name-matching is generous on purpose: "limestone", "the limestone",
    // "some stone" and "lime" all reach the same block in the wall.
    let found: { zone: Zone; deposit: Deposit } | null = null;
    if (ref) {
      for (const { zone, deposits } of pool) {
        for (const deposit of deposits) {
          const id = deposit.mat.id;
          const name = deposit.mat.name.toLowerCase();
          const words = name.split(/\s+/).filter((w) => w.length > 3);
          if (ref === id || ref.includes(name) || name.includes(ref) || words.some((w) => ref.includes(w))) {
            found = { zone, deposit };
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        const menu = pool.flatMap(({ deposits }) => deposits.map((d) => d.mat.name.toLowerCase()));
        throw new Error(
          `There is no ${ref} in here. What there is: ${commaList([...new Set(menu)])}.`,
        );
      }
    } else {
      // Nothing named. Take the most valuable thing you can actually shift.
      const all = pool.flatMap(({ zone, deposits }) => deposits.map((deposit) => ({ zone, deposit })));
      all.sort((a, b) => b.deposit.mat.value * b.deposit.left - a.deposit.mat.value * a.deposit.left);
      found = all[0]!;
    }

    const wanted = Math.max(1, Math.min(qty ?? 2, 12));
    const before = this.state.crawler.hp;
    const r = harvest(this.state, this.rng, this.log, node, found.zone, found.deposit.mat.id, wanted);
    if (!r.ok) throw new Error(r.reason!);

    if (r.minutes) {
      this.advanceTime(r.minutes / 60, `working ${found.deposit.mat.name.toLowerCase()} out of the wall`);
      if (!this.state.crawler.alive) return;
    }

    // Noise. An hour of hitting a wall with a bar is not a stealth operation,
    // and a room that has something in it will eventually come and look.
    if (this.state.flags.undetected && this.hostilePresence(node) && r.minutes) {
      const heard = this.rng.d(20) + skillLevel(this.state, "stealth") < 8 + Math.round(r.minutes / 8);
      if (heard) {
        this.log.say("You have been hammering at a wall for a while now, and something in here has been listening to all of it.");
        this.startEncounter(node, false);
      }
    }

    if (this.state.crawler.hp < before && this.state.crawler.hp <= 0) this.die("brought a ceiling down on yourself");
  }

  /**
   * Doing something to a substance until it is a different substance.
   *
   * The refusal path matters more than the success path here. Somebody who has
   * worked out that burning limestone gives them quicklime is RIGHT, and being
   * told "you can't do that" when the only thing missing is four hundred
   * degrees is the exact failure this whole layer was built to stop. So a
   * refusal always names the physical thing that is missing, and it never
   * argues about whether the idea was any good.
   */
  private cmdTransform(cmd: { rule?: string; input?: string; batches?: number; said?: string }): void {
    const node = currentNode(this.state.floor);

    let rule = cmd.rule ? TRANSFORM_BY_ID[cmd.rule] : undefined;
    let input = cmd.input
      ? this.state.inventory.map(materialOf).find((m) => m?.id === cmd.input || m?.name.toLowerCase() === cmd.input!.toLowerCase())
      : undefined;

    if ((!rule || !input) && cmd.said) {
      const read = readTransform(this.state, cmd.said);
      rule ??= read?.rule;
      input ??= read?.input;
    }

    if (!rule || !input) {
      const menu = transformMenu(this.state).slice(0, 6);
      if (!menu.length) {
        throw new Error(
          "There is nothing in your pack that can be turned into anything else. That changes the moment you start taking rooms apart — say what the walls are made of and go from there.",
        );
      }
      throw new Error(
        `Not sure which process you meant. What you are carrying could become: ${commaList(
          menu.map((m) => `${m.product.name} (${m.rule.name.toLowerCase()} the ${m.input.name.toLowerCase()}${m.ok ? "" : " — not here"})`),
        )}.`,
      );
    }

    const batches = Math.max(1, Math.min(cmd.batches ?? 1, 6));
    const check = checkTransform(this.state, node, rule, input, batches);
    if (!check.ok) {
      // Say what it WOULD make, so the refusal is a shopping list rather than
      // a dead end. Being told what you are missing is being helped.
      // Semicolons rather than a comma list: half of these phrases contain
      // their own "and", and a shopping list you have to parse twice is a
      // worse answer than a short one.
      throw new Error(
        `${rule.name} the ${input.name.toLowerCase()} would give you ${check.product.name}. ` +
        `It wants ${check.missing.join("; ")}. ${rule.because}`,
      );
    }

    const r = runTransform(this.state, this.rng, this.log, node, rule.id, input.id, batches);
    if (!r.ok) throw new Error(r.reason!);
    if (r.minutes) {
      this.advanceTime(r.minutes / 60, `${rule.name.toLowerCase()} ${input.name.toLowerCase()}`);
    }
  }

  private cmdEngage(): void {
    const node = currentNode(this.state.floor);
    if (!this.hostilePresence(node)) throw new Error("There is nothing here to fight.");
    const ambush = this.state.flags.undetected === true && this.state.flags.ambushReady === true;
    this.startEncounter(node, ambush);
  }

  private startEncounter(node: MapNode, ambush: boolean): void {
    this.state.flags.undetected = false;
    this.state.flags.ambushReady = false;
    this.state.encounter = beginEncounter(this.state, this.rng, this.log, node, { ambush });
    this.afterCombatStep();
  }

  /* ----------------------------------------------------------- fighting */

  private enc() {
    const e = this.state.encounter;
    if (!e || e.finished) throw new Error("There is no fight in progress.");
    return e;
  }

  private node(): MapNode {
    return this.state.floor.nodes[this.enc().nodeId]!;
  }

  private cmdAttack(ref: string, called = false): void {
    const enc = this.enc();
    if (enc.actions.act <= 0) throw new Error("You have already acted this round. End the turn.");
    const target = this.resolveCombatant(ref);
    const me = crawlerOf(enc);
    const d = derive(this.state);

    // Refuse rather than silently burn the action. Discovering you were out of
    // reach by losing a round to it is a interface failure, not a tactical one.
    const gap = zoneDistance(this.node(), me.zone, target.zone);
    if (gap > me.reach) {
      throw new Error(
        `${target.name} is ${gap} ${gap === 1 ? "position" : "positions"} away and ${d.weaponName} reaches ${me.reach}. Move, or throw something.`,
      );
    }

    // A called shot: much harder, ignores armour, and triples what the weapon
    // does. A firearm or a bow ends an ordinary mob outright — which is what
    // happened to every crawler who came down the stairs holding one — without
    // ever being able to one-shot something built out of a building.
    const shot = called ? calledShotModifier(this.state, me, target) : null;
    if (shot?.note) this.log.say(shot.note);
    resolveAttack(this.state, this.rng, this.log, enc, this.node(), me, target, {
      improvised: this.equippedWeapon()?.tags.includes("improvised") ?? false,
      extraAccuracy: shot?.accuracy ?? 0,
      calledShot: shot ? { multiplier: shot.multiplier, ignoresArmour: shot.ignoresArmour } : undefined,
      label: called ? `${d.weaponName}, aimed` : undefined,
    });
    enc.actions.act--;

    const weaponSkill = this.weaponSkillId();
    trainSkill(this.state, weaponSkill, 1);
    if (d.weaponName === "your bare hands") trainSkill(this.state, "brawling", 1);
    this.afterCombatStep();
  }

  private cmdMove(zoneRef: string): void {
    const enc = this.enc();
    if (enc.actions.move <= 0) throw new Error("You have no movement left this round.");
    const node = this.node();
    const zone = node.zones.find((z) => z.id === zoneRef || z.name.toLowerCase().includes(zoneRef.toLowerCase()));
    if (!zone) throw new Error("There is nowhere here by that name.");
    if (moveTo(this.state, this.rng, this.log, enc, node, crawlerOf(enc), zone.id)) {
      enc.actions.move--;
      this.afterCombatStep();
    }
  }

  private cmdFeature(id: string): void {
    const enc = this.enc();
    if (enc.actions.act <= 0) throw new Error("You have already acted this round.");
    const node = this.node();
    // Word-based, because "topple the bus onto them" is a perfectly clear
    // instruction and demanding the exact string "bus" is the parser being
    // difficult for no reason anybody benefits from.
    const live = node.zones.flatMap((z) => z.features).filter((f) => !f.spent);
    const lower = id.toLowerCase();
    const words = lower.split(/\s+/).filter((w) => w.length > 2);
    const match =
      live.find((f) => f.id === lower) ??
      live.find((f) => f.name.toLowerCase().includes(lower)) ??
      live.find((f) => words.some((w) => f.id === w || f.name.toLowerCase().includes(w)));
    if (!match) {
      throw new Error(
        live.length
          ? `Nothing here called "${id}". What is here: ${live.map((f) => f.name).join(", ")}.`
          : "Everything in this room that could be used against somebody already has been.",
      );
    }
    useFeature(this.state, this.rng, this.log, enc, node, crawlerOf(enc), match.id);
    enc.actions.act--;
    if (match.check.skill) trainSkill(this.state, match.check.skill, 2);
    this.afterCombatStep();
  }

  private cmdThrow(itemRef: string, zoneRef?: string): void {
    const enc = this.enc();
    if (enc.actions.act <= 0) throw new Error("You have already acted this round.");
    const item = this.findItem(itemRef);
    if (item.kind !== "explosive") throw new Error(`${item.name} is not something you throw at people. Not usefully.`);

    const node = this.node();
    const me = crawlerOf(enc);
    const zone = zoneRef
      ? node.zones.find((z) => z.id === zoneRef || z.name.toLowerCase().includes(zoneRef.toLowerCase()))
      : node.zones
          .slice()
          .sort(
            (a, b) =>
              hostilesOf(enc, me).filter((h) => h.zone === b.id).length -
              hostilesOf(enc, me).filter((h) => h.zone === a.id).length,
          )[0];
    if (!zone) throw new Error("Nowhere to put it.");

    if (zone.id === me.zone) {
      this.log.say("You consider it, and then reconsider, because you are standing there.");
      return;
    }

    const accuracy = this.rng.d(20) + skillLevel(this.state, "throwing") + derive(this.state).stats.dex;
    const scattered = accuracy < 10;
    const landing = scattered ? this.rng.pick([zone.id, ...zone.links]) : zone.id;
    const caught = living(enc).filter((c) => c.zone === landing);

    this.consumeItem(item);
    trainSkill(this.state, "throwing", 2);

    for (const c of caught) {
      const dmg = Math.max(1, this.rng.roll(item.damage ?? "3d6") - Math.floor(c.armor / 2));
      c.hp = Math.max(0, c.hp - dmg);
      this.log.push({
        kind: "attack",
        channel: c.side === "crawler" ? "bad" : "good",
        attacker: this.state.crawler.name,
        target: c.name,
        weapon: item.name,
        byCrawler: true,
        hit: true,
        crit: false,
        graze: false,
        damage: dmg,
        targetHp: c.hp,
        targetHpMax: c.hpMax,
        styles: ["improvised"],
      });
      if (item.tags.includes("fire")) c.statuses.push(makeStatus("burning", 3));
      if (c.hp <= 0) {
        c.alive = false;
        enc.killsThisFight++;
        this.log.push({
          kind: "kill",
          channel: c.side === "crawler" ? "bad" : "good",
          victim: c.name,
          victimLevel: c.level,
          byCrawler: c.side !== "crawler",
          killer: this.state.crawler.name,
          method: item.name,
          styles: ["improvised", "environmental"],
        });
      }
    }
    if (item.tags.includes("fire")) {
      zoneOf(this.node(), landing).hazard = { kind: "fire", turns: 3, damage: "1d6" };
    }
    if (scattered) this.log.say("It does not land where you sent it. Throwing is a skill and you have not been practising.");

    enc.actions.act--;
    this.afterCombatStep();
  }

  private cmdBrace(): void {
    const enc = this.enc();
    const me = crawlerOf(enc);
    me.braced = true;
    me.statuses.push(makeStatus("braced", 2));
    this.log.say("You set yourself. The next thing that runs at you is going to have a worse time than it planned.");
    enc.actions.act = 0;
    this.endTurn();
  }

  private cmdAim(): void {
    const enc = this.enc();
    crawlerOf(enc).aiming = true;
    this.log.say("You steady it and wait. Three points of accuracy for a round you did not spend hitting anybody.");
    enc.actions.act = 0;
    this.endTurn();
  }

  private cmdIntimidate(): void {
    const enc = this.enc();
    if (enc.actions.act <= 0) throw new Error("You have already acted this round.");
    const d = derive(this.state);
    const skill = skillLevel(this.state, "intimidation");
    let broke = 0;
    for (const h of living(enc, "hostile")) {
      if (h.tags.includes("boss")) continue;
      const def = MOB_BY_ID[h.sourceId];
      const morale = def?.morale ?? 60;
      if (this.rng.d(20) + d.stats.cha + skill >= 10 + morale / 6 + h.level / 2) {
        h.fleeing = true;
        broke++;
      }
    }
    this.log.say(
      broke > 0
        ? `You say something short. ${broke} of them decide this is not their fight and start looking for the door.`
        : "You say something short, and it lands in the room like a coin in a well.",
    );
    if (broke) {
      trainSkill(this.state, "intimidation", 2);
      applyViews(this.state, this.log, scoreEvent(this.state, 220 * broke, "made them run"));
    }
    enc.actions.act--;
    this.afterCombatStep();
  }

  private cmdParley(): void {
    const enc = this.enc();
    const sapient = living(enc, "hostile").filter((h) => h.tags.includes("sapient"));
    if (!sapient.length) throw new Error("Nothing in here negotiates. You can tell by looking at it.");

    const d = derive(this.state);
    const skill = skillLevel(this.state, "negotiation");
    const avg = sapient.reduce((s, h) => s + h.level, 0) / sapient.length;
    const roll = this.rng.d(20) + d.stats.cha + skill;
    const dc = 13 + Math.round(avg / 2) + living(enc, "hostile").length;

    if (roll >= dc) {
      enc.finished = "parley";
      this.state.counters.parleys++;
      this.state.floorTally.parleys++;
      notePractice(this.state, "parley");
      this.state.counters.spared += living(enc, "hostile").length;
      trainSkill(this.state, "negotiation", 3);
      const gold = this.rng.int(10, 40) * this.state.floor.n;
      this.state.crawler.gold += gold;
      this.log.push({
        kind: "parley",
        channel: "good",
        with: sapient[0]!.name,
        success: true,
        terms: `They want you gone more than they want you dead, and they are willing to pay ${gold} gold for the difference.`,
      });
      applyViews(this.state, this.log, scoreEvent(this.state, 900, "talked your way out"));
      this.state.floor.nodes[enc.nodeId]!.spawn = [];
      this.state.floor.nodes[enc.nodeId]!.cleared = true;
      this.log.push({ kind: "combat_end", channel: "system", outcome: "parley", rounds: enc.roundsTaken, killed: 0 });
      this.state.encounter = null;
      return;
    }

    this.log.push({ kind: "parley", channel: "bad", with: sapient[0]!.name, success: false, terms: "" });
    enc.actions.act = 0;
    this.endTurn();
  }

  private cmdFlee(): void {
    const enc = this.enc();
    const fled = attemptFlee(this.state, this.rng, this.log, enc, this.node());
    if (fled) {
      this.state.floorTally.fled++;
      notePractice(this.state, "flee_ok");
      this.state.encounter = null;
      this.advanceTime(0.1, "getting out");
      return;
    }
    enc.actions.act = 0;
    this.endTurn();
  }

  private endTurn(): void {
    const enc = this.enc();
    tickCooldowns(this.state);
    enc.actions.move = 0;
    enc.actions.act = 0;
    advanceToCrawler(this.state, this.rng, this.log, enc, this.node());
    this.afterCombatStep();
  }

  /** Called after every combat action: syncs the crawler, moves bosses through
   *  their phases, ends the round if the player is spent, and resolves. */
  private afterCombatStep(): void {
    const enc = this.state.encounter;
    if (!enc) return;
    const me = crawlerOf(enc);
    this.state.crawler.hp = me.hp;
    this.state.crawler.statuses = me.statuses;

    this.updateBossPhase(enc);

    if (enc.finished === null && enc.actions.move <= 0 && enc.actions.act <= 0) {
      advanceToCrawler(this.state, this.rng, this.log, enc, this.node());
      this.state.crawler.hp = crawlerOf(enc).hp;
    }

    checkEnd(this.state, this.log, enc);
    if (enc.finished !== null) this.finishEncounter(enc.finished);
  }

  private updateBossPhase(enc: { combatants: Combatant[] }): void {
    const boss = enc.combatants.find((c) => c.alive && c.tags.includes("boss"));
    if (!boss) return;
    const def = BOSS_BY_ID[boss.sourceId];
    if (!def) return;
    const frac = boss.hp / boss.hpMax;
    const phase = def.phases.filter((p) => frac <= p.at).pop() ?? def.phases[0]!;
    if (boss.behavior !== phase.behavior) {
      boss.behavior = phase.behavior;
      this.log.say(`${boss.name} — ${phase.name}. ${phase.note}`);
    }
  }

  private finishEncounter(outcome: "victory" | "fled" | "defeat" | "parley"): void {
    const enc = this.state.encounter!;
    const node = this.state.floor.nodes[enc.nodeId]!;

    // Record the death before the clock moves. Otherwise advanceTime notices
    // zero health first and files it under "bled out unattended", which is a
    // demonstrably worse epitaph than the truth.
    if (outcome === "defeat" || this.state.crawler.hp <= 0) {
      this.die(`Killed in ${node.name}, by ${lastAttacker(enc) ?? "something that got there first"}.`);
      this.state.encounter = null;
      return;
    }

    this.advanceTime(enc.roundsTaken * HOURS_PER_ROUND, "fighting");
    if (!this.state.crawler.alive) {
      this.state.encounter = null;
      return;
    }

    if (outcome === "victory") {
      const dead = enc.combatants.filter((c) => c.side === "hostile" && !c.alive);
      let xp = 0;
      const drops: string[] = [];
      const me0 = crawlerOf(enc);

      for (const v of dead) {
        // Killing far above your level pays far above your level. There is no
        // cap and there is not supposed to be one: doing something absurd and
        // ending up ahead of the curve for it is the point of the format, and
        // flattening that is how a progression system stops being a story.
        const gap = v.level - this.state.crawler.level;
        const mult = gap > 0 ? 1 + gap * 0.35 : 1;
        xp += Math.round(v.xp * mult);
        this.state.counters.kills++;
        this.state.floorTally.kills++;
        if (v.tags.includes("npc")) {
          this.state.counters.npcKills++;
          this.state.floorTally.npcKills++;
        }
        const def = MOB_BY_ID[v.sourceId];
        for (const d of def?.drops ?? []) {
          if (!this.rng.chance(d.chance)) continue;
          const qty = d.qty ? this.rng.int(d.qty[0], d.qty[1]) : 1;
          const item = fromId(d.id, qty, this.rng);
          if (this.pickUp(item)) drops.push(item.name);
        }
      }

      // Style is scored per kill, from the record the resolver kept as each
      // blow landed. A fight lasting eight turns still pays out on the
      // flourish in round one.
      for (const k of enc.killLog) {
        if (!k.byCrawler) continue;
        if (k.styles.includes("unarmed")) {
          this.state.counters.unarmedKills++;
          this.state.floorTally.unarmedKills++;
        }
        if (k.styles.includes("environmental")) {
          this.state.counters.environmentalKills++;
          this.state.floorTally.environmentalKills++;
        }
        if (k.styles.includes("punching_up")) this.state.counters.punchingUpKills++;
        applyViews(this.state, this.log, scoreKill(this.state, k.level, k.styles));
      }

      // A wipe is worth more than the sum of its bodies.
      if (dead.length >= 4) xp = Math.round(xp * (1 + (dead.length - 3) * 0.12));
      if (enc.killLog.some((k) => k.byCrawler && k.styles.includes("environmental")) && dead.length >= 3) {
        xp = Math.round(xp * 1.25);
        this.log.say("The room did most of that, and the room does not get experience. You do.");
      }
      const expected = xpForLevel(this.state.crawler.level);
      if (xp > expected * 1.5) {
        this.log.say(
          `${xp} experience off one fight. That is not on the curve, and we would like it on record that nobody planned for it.`,
        );
      }

      // What this run keeps teaching the crawler about itself.
      const stylesSeen = new Set(enc.killLog.filter((k) => k.byCrawler).flatMap((k) => k.styles));
      if (stylesSeen.has("chokepoint")) notePractice(this.state, "choke_fight");
      if (stylesSeen.has("outnumbered")) notePractice(this.state, "outnumbered_win");
      if (stylesSeen.has("wounded")) notePractice(this.state, "low_hp_win");
      if (stylesSeen.has("punching_up")) notePractice(this.state, "punch_up");
      if (stylesSeen.has("environmental")) notePractice(this.state, "env_kill");
      if (stylesSeen.has("unarmed")) notePractice(this.state, "unarmed_kill");
      if (stylesSeen.has("improvised")) notePractice(this.state, "improvised_kill");
      if (stylesSeen.has("ranged")) notePractice(this.state, "ranged_kill");
      if (stylesSeen.has("ambush")) notePractice(this.state, "ambush");
      if (zoneOf(node, me0.zone).tags.includes("high")) notePractice(this.state, "high_ground");

      // Whatever a minted skill or generated class promised on a kill.
      const healBack = hookBonus(this.state, "onKill") * enc.killLog.filter((k) => k.byCrawler).length;
      if (healBack > 0) {
        this.state.crawler.hp = clamp(this.state.crawler.hp + healBack, 0, derive(this.state).hpMax);
      }

      const me = crawlerOf(enc);
      if (me.hp / me.hpMax < 0.05) {
        this.state.counters.nearDeaths++;
        applyViews(this.state, this.log, scoreEvent(this.state, 1400, "should not have survived that"));
      }

      const lvl = grantXp(this.state, xp, () => this.rng.int(0, 9999));
      this.log.push({ kind: "xp", channel: "good", amount: xp, total: this.state.crawler.xp });
      for (let i = 0; i < lvl.levels; i++) {
        this.log.push({
          kind: "level_up",
          channel: "good",
          level: this.state.crawler.level - lvl.levels + i + 1,
          points: 3,
          banked: lvl.banked,
        });
      }
      if (drops.length) this.log.push({ kind: "loot", channel: "loot", items: drops, from: "Off the bodies" });

      // A boss dying is the single largest event on a floor and it pays like it.
      const bossDown = enc.combatants.find((c) => c.tags.includes("boss") && !c.alive);
      if (bossDown && node.boss) {
        const def = BOSS_BY_ID[node.boss]!;
        this.state.floor.bossesKilled.push(node.boss);
        this.state.counters.bossKills++;
        notePractice(this.state, "boss_kill");
        this.state.floorTally.bossKills++;
        this.state.crawler.stars.push(def.rank);
        const tier = RANK_TIER[def.rank] ?? "Bronze";
        this.state.boxes.push({ bid: `boss_${def.id}`, type: "boss", tier, why: `${def.name} is down` });
        this.log.push({ kind: "box_awarded", channel: "loot", tier, box: "Boss Box", why: `${def.name} is down` });
        this.log.say(
          `${def.rank} Boss. A ${RANK_STAR[def.rank]} star now follows your name in every notification you will ever receive, including the one about your death.`,
        );
        applyViews(this.state, this.log, scoreEvent(this.state, 4000 + def.level * 400, `killed ${def.name}`));
      }

      node.spawn = [];
      node.cleared = true;
      this.state.counters.roomsCleared++;
      this.state.floorTally.roomsCleared++;
      this.remember(node, `Cleared. ${dead.length} down, ${drops.length} things worth taking.`);
    }

    if (outcome === "fled") {
      this.remember(node, "Left in a hurry. Whatever was in here is still in here.");
    }

    // You are off your knees. The status was for that fight only.
    this.state.crawler.statuses = this.state.crawler.statuses.filter((x) => x.id !== "dying");
    this.state.cooldowns = {};
    this.state.encounter = null;
    considerSponsorOffer(this.state, this.rng, this.log);
  }

  /* ------------------------------------------------------ housekeeping */

  private cmdUse(ref: string, inCombat: boolean): void {
    const item = this.findItem(ref);
    if (!item.use) throw new Error(`${item.name} is not something you use from a menu. Do something with it instead.`);
    const c = this.state.crawler;
    const d = derive(this.state);
    let effect = "";

    switch (item.use.effect) {
      case "heal": {
        const amount = item.use.v + skillLevel(this.state, "field_dressing") * 2;
        c.hp = clamp(c.hp + amount, 0, d.hpMax);
        effect = `+${amount} health.`;
        if (this.state.encounter) crawlerOf(this.state.encounter).hp = c.hp;
        break;
      }
      case "mana":
        c.mana = clamp(c.mana + item.use.v, 0, d.manaMax);
        effect = `+${item.use.v} mana.`;
        break;
      case "stamina":
        c.stamina = clamp(c.stamina + item.use.v, 0, d.staminaMax);
        effect = "Stamina back, and a heart rate you will regret.";
        break;
      case "cure":
        c.statuses = c.statuses.filter((s) => s.id !== "poisoned");
        effect = "Poison neutralised.";
        break;
      case "bleed":
        c.statuses = c.statuses.filter((s) => s.id !== "bleeding");
        effect = "Bleeding stopped. That is more lives saved than any weapon you own.";
        trainSkill(this.state, "field_dressing", 1);
        break;
      case "feed":
        c.hunger = clamp(c.hunger - item.use.v, 0, 100);
        effect = "Eaten. It was not good.";
        break;
    }

    this.consumeItem(item);
    this.log.push({ kind: "use_item", channel: "good", item: item.name, effect });
    if (inCombat && this.state.encounter) {
      this.state.encounter.actions.act--;
      this.afterCombatStep();
    }
  }

  private cmdEquip(ref: string): void {
    const item = this.findItem(ref);
    if (!item.slot) throw new Error(`${item.name} is not something you can wear or wield.`);
    const removed = this.state.inventory.find((i) => i.equipped && i.slot === item.slot);
    if (removed) removed.equipped = false;
    item.equipped = true;
    this.state.crawler.hpMax = derive(this.state).hpMax;
    this.log.push({ kind: "equip", channel: "good", item: item.name, slot: item.slot, removed: removed?.name ?? null });
  }

  private cmdUnequip(ref: string): void {
    const item = this.findItem(ref);
    item.equipped = false;
    this.log.say(`${item.name} off.`);
  }

  private cmdDrop(ref: string): void {
    const item = this.findItem(ref);
    this.state.inventory = this.state.inventory.filter((i) => i.iid !== item.iid);
    currentNode(this.state.floor).loot.push(item);
    currentNode(this.state.floor).searched = false;
    this.log.say(`${item.name} dropped. The dungeon does not pick things up for you.`);
  }

  private cmdRest(): void {
    const node = currentNode(this.state.floor);
    if (node.kind !== "safe_room" && node.kind !== "guild") {
      throw new Error("You do not sleep in the open on this floor. Find a safe room.");
    }
    const hours = 7;
    this.advanceTime(hours, "sleeping");
    if (!this.state.crawler.alive) return;
    const c = this.state.crawler;
    const d = derive(this.state);
    c.hp = d.hpMax;
    c.mana = d.manaMax;
    c.stamina = d.staminaMax;
    c.fatigue = 0;
    c.statuses = c.statuses.filter((s) => s.id !== "exhausted");
    const bed = this.state.space.owned && this.state.space.upgrades.includes("bed");
    if (!c.statuses.some((s) => s.id === "rested")) c.statuses.push(makeStatus("rested", bed ? 18 : 8));
    if (bed) this.log.say("Your own bed, in your own room, behind your own door. It holds for twice as long.");
    for (const comp of this.state.companions) if (comp.alive) comp.hp = comp.hpMax;
    this.log.push({ kind: "rest", channel: "good", hours, where: node.name });
  }

  private cmdEat(): void {
    const node = currentNode(this.state.floor);
    const inSafeRoom = node.kind === "safe_room" || node.kind === "guild";
    if (inSafeRoom) {
      // Free on the tutorial floors, because starving crawlers make bad
      // television. Priced everywhere after that, because they stop caring.
      const cost = this.state.floor.n <= 2 ? 0 : 15 * this.state.floor.n;
      if (cost <= this.state.crawler.gold) {
        this.state.crawler.gold -= cost;
        this.advanceTime(0.4, "eating");
        if (!this.state.crawler.alive) return;
        this.state.crawler.hunger = 0;
        this.state.crawler.statuses = this.state.crawler.statuses.filter((s) => s.id !== "starving");
        if (!this.state.crawler.statuses.some((s) => s.id === "well_fed")) {
          this.state.crawler.statuses.push(makeStatus("well_fed", 10));
        }
        this.log.say(
          cost === 0
            ? "Safe room food, free on the tutorial floors, because starving crawlers make bad television. Well Fed."
            : `A hot meal, ${cost} gold. The pricing changed the moment you stopped being a novelty. Well Fed.`,
        );
        return;
      }
    }
    const food = this.state.inventory.find((i) => i.kind === "food");
    if (!food) {
      throw new Error(
        inSafeRoom
          ? `A meal here is ${15 * this.state.floor.n} gold and you have ${this.state.crawler.gold}.`
          : "You have nothing to eat and nowhere to get any.",
      );
    }
    this.cmdUse(food.iid, false);
  }

  private cmdOpenBoxes(): void {
    const node = currentNode(this.state.floor);
    if (node.kind !== "safe_room" && node.kind !== "guild") {
      throw new Error("Boxes open in a safe room. All of them, at once, in tier order, and you do not get to choose.");
    }
    if (!this.state.boxes.length) throw new Error("You have nothing waiting.");

    const sorted = this.state.boxes
      .slice()
      .sort((a, b) => TIERS.indexOf(a.tier as Tier) - TIERS.indexOf(b.tier as Tier));
    const tags = usageTags(this.state.inventory.filter((i) => i.equipped), this.state.skills);

    for (const box of sorted) {
      const minted = Object.values(this.state.minted).filter(Boolean)[0];
      const result = openBox(this.rng, box.type, box.tier as Tier, {
        floor: this.state.floor.n,
        usesTags: tags,
        tailor: {
          name: this.state.crawler.name,
          job: this.state.crawler.origin.job,
          lastBoss: this.state.floor.bossesKilled.length
            ? BOSS_BY_ID[this.state.floor.bossesKilled[this.state.floor.bossesKilled.length - 1]!]?.name
            : undefined,
          mintedSkill: minted?.name,
          floor: this.state.floor.n,
        },
      });
      const got: string[] = [];
      for (const item of result.items) {
        // A tome is not an item you carry around, it is a thing you read once.
        if (item.kind === "book" || item.tags.includes("tome")) {
          const spell = spellFromTome(this.state, this.rng, tags);
          if (learnSpell(this.state, spell, this.log)) {
            got.push(`${item.name} — and it taught you ${spell.name}`);
            continue;
          }
        }
        if (this.pickUp(item)) got.push(`${item.name}${item.qty > 1 ? ` ×${item.qty}` : ""}`);
      }
      this.state.crawler.gold += result.gold;
      this.state.counters.boxesOpened++;
      this.log.push({
        kind: "box_opened",
        channel: "loot",
        tier: box.tier,
        box: BOX_BY_ID[box.type]?.name ?? box.type,
        items: got,
        gold: result.gold,
      });
    }
    this.state.boxes = [];
    this.advanceTime(0.3, "opening boxes");
  }

  private cmdSpend(stat: StatKey): void {
    const node = currentNode(this.state.floor);
    if (node.kind !== "safe_room" && node.kind !== "guild") {
      throw new Error("Stat points can only be spent inside a safe room. That is a rule, not an inconvenience.");
    }
    if (this.state.crawler.points < 1) throw new Error("You have no points to spend.");
    this.state.crawler.points--;
    this.state.crawler.stats[stat]++;
    this.state.crawler.hpMax = derive(this.state).hpMax;
    this.state.crawler.manaMax = derive(this.state).manaMax;
    this.log.push({ kind: "stat_spent", channel: "good", stat: STAT_NAMES[stat], value: this.state.crawler.stats[stat] });
  }

  /**
   * Three the system recommends and seven behind them, most of which did not
   * exist before this crawler played. Rolled once and then frozen on the save,
   * so the menu cannot be rerolled by walking out and back in.
   */
  classOptions(): ClassOption[] {
    if (!this.state.classMenu) {
      this.state.classMenu = generateClassOptions(this.state, this.rng);
      this.state.rng = this.rng.save();
    }
    return this.state.classMenu as ClassOption[];
  }

  private cmdSelect(raceId: string, klassId: string): void {
    const node = currentNode(this.state.floor);
    if (node.kind !== "guild") throw new Error("Race and class are chosen at a Guild Hall, and nowhere else.");
    if (this.state.floor.n < 3) throw new Error("Not until the third floor. The training levels have to end first.");
    if (this.state.crawler.race) throw new Error("You have already chosen. It was permanent when we said it was permanent.");

    const race = RACE_BY_ID[raceId];
    if (!race) throw new Error(`No such race: ${raceId}. Try \`races\`.`);

    // The menu holds authored classes and ones assembled for this crawler; a
    // generated class is chosen exactly the same way and is exactly as real.
    const menu = this.classOptions();
    const lower = klassId.toLowerCase();
    const option =
      menu.find((o) => o.id === klassId) ??
      menu.find((o) => o.name.toLowerCase() === lower) ??
      menu.find((o) => o.name.toLowerCase().includes(lower));
    if (!option) {
      throw new Error(`No such class: ${klassId}. Try \`classes\` to see what is on offer for you specifically.`);
    }
    const authored = CLASS_BY_ID[option.id];
    if (authored?.primalOnly && race.id !== "primal") {
      throw new Error(`${authored.name} is Earth-flavoured. Only a Primal sees it on the menu.`);
    }
    const klass = {
      id: option.id,
      name: option.name,
      req: option.req,
      skills: option.skills,
      hooks: option.hooks,
    };

    const c = this.state.crawler;
    c.race = race.id;
    c.klass = klass.id;
    c.className = klass.name;
    c.classHooks = klass.hooks;
    c.skillCap = race.skillCap;
    for (const [k, v] of Object.entries(race.stats)) c.stats[k as StatKey] += v as number;
    c.points = Math.max(0, c.banked + race.points);
    c.banked = 0;
    for (const s of klass.skills) {
      const cur = this.state.skills[s.id]?.level ?? 0;
      this.state.skills[s.id] = { level: Math.max(cur, s.level), xp: 0 };
    }
    c.hpMax = derive(this.state).hpMax;
    c.manaMax = derive(this.state).manaMax;

    this.log.push({ kind: "select", channel: "good", race: race.name, klass: klass.name, points: c.points });
    if (option.generated) {
      this.log.say(
        `${klass.name} is not on anybody else's list. It was assembled out of your own record about ninety seconds ago, and it is exactly as permanent as the ones that were written down in advance.`,
      );
    }
    const unmet = Object.entries(klass.req).filter(([k, v]) => c.stats[k as StatKey] < (v as number));
    if (unmet.length) {
      this.log.say(
        `${klass.name} requires ${unmet.map(([k, v]) => `${STAT_NAMES[k as StatKey]} ${v}`).join(", ")}. You do not have it. You will be meeting that out of the points you just unlocked, and it is going to hurt.`,
      );
    }
  }

  private cmdCast(spellRef: string, target?: string): void {
    const enc = this.state.encounter && !this.state.encounter.finished ? this.state.encounter : null;
    if (enc && enc.actions.act <= 0) throw new Error("You have already acted this round.");

    const lower = spellRef.toLowerCase();
    const spell =
      this.state.spellbook[spellRef] ??
      knownSpells(this.state).find((sp) => sp.name.toLowerCase() === lower) ??
      knownSpells(this.state).find((sp) => sp.name.toLowerCase().includes(lower));
    if (!spell) {
      const known = knownSpells(this.state);
      throw new Error(
        known.length
          ? `You do not know anything called "${spellRef}". You know: ${known.map((k) => k.name).join(", ")}.`
          : "You do not know any spells. They come out of tomes, and tomes come out of boxes.",
      );
    }

    const node = enc ? this.state.floor.nodes[enc.nodeId]! : currentNode(this.state.floor);
    const result = castSpell(this.state, this.rng, this.log, enc, node, spell.id, target);
    if (!result.ok) throw new Error(result.reason ?? "It does not work.");

    if (spell.tags.includes("fire")) notePractice(this.state, "fire");
    if (enc) {
      enc.actions.act--;
      this.afterCombatStep();
    } else {
      this.advanceTime(0.05, "casting");
    }
  }

  /**
   * Plain English. The interpreter finds the nearest legal reading and says
   * what it understood, so a misreading costs one line rather than a turn.
   */
  /**
   * Whatever somebody typed, turned into something the engine can resolve.
   *
   * The keyword interpreter goes first, always, and its answer stands whenever
   * it has one. A Dungeon Master is consulted only for the sentences it could
   * not read — which is the whole design in one line: the model widens the
   * range of SENTENCES understood, never the range of THINGS possible. Pull the
   * network out and the only thing that changes is how many ways you can phrase
   * the same instruction.
   */
  private async readFreeform(text: string): Promise<Command | null> {
    const reading = interpret(this.state, text);

    if (reading.command && reading.command.t !== "improvise" && !reading.weak) {
      this.log.say(`Read as: ${reading.note}`);
      if (reading.practice) notePractice(this.state, reading.practice);
      return reading.command;
    }

    // Nothing legal came back. This is the seat.
    if (this.proposer.available) {
      const node = currentNode(this.state.floor);
      const proposal = await this.proposer.propose({ said: text, state: this.state, node });
      if (proposal) {
        const command = this.applyProposal(proposal, node);
        if (command !== undefined) return command;
      }
    }

    this.log.say(`Read as: ${reading.note}`);
    if (reading.practice) notePractice(this.state, reading.practice);
    return reading.command && reading.command.t !== "improvise" ? reading.command : null;
  }

  /**
   * What a proposal is allowed to become.
   *
   * Three outcomes and no fourth. A reading turns into an engine command that
   * has to survive the same validation as one that was typed. A transformation
   * turns into a priced device — priced by the engine, from the bill of
   * materials, never by the proposer. A decline turns into a sentence.
   *
   * Returns `undefined` to mean "not handled, fall back", which is different
   * from `null` — "handled, and the answer was that nothing happens".
   */
  private applyProposal(p: Proposal, node: MapNode): Command | null | undefined {
    if (p.kind === "decline") {
      this.log.say(`${p.note} Nothing spent.`);
      return null;
    }

    if (p.kind === "reading") {
      // A verb the model named is still only a verb. It goes through the same
      // dispatch, the same checks, and the same refusals as one somebody typed.
      const command = commandFromIntent(p.intent, p.argument);
      if (!command) return undefined;
      this.log.say(`Read as: ${p.note}`);
      return command;
    }

    const r = mint(this.state, this.rng, this.log, node, p);
    if (!r.ok) {
      this.log.say(r.reason!);
      return null;
    }
    if (r.priced?.minutes) {
      this.advanceTime(r.priced.minutes / 60, `building ${p.name.toLowerCase()}`);
    }
    return null;
  }

  private cmdImprovise(text: string): void {
    // Reached only when something inside the engine dispatches `improvise`
    // rather than a player typing it — the async path above handles that case
    // and this one must never recurse into it.
    const reading = interpret(this.state, text);
    this.log.say(`Read as: ${reading.note}`);
    if (reading.practice) notePractice(this.state, reading.practice);
    if (!reading.command || reading.command.t === "improvise") return;
    this.dispatch(reading.command);
  }

  private cmdClaim(what: string, why: string): void {
    if (!what.trim()) throw new Error("Claim what?");
    const ruling = ruleOnClaim(this.state, what, why);
    if (!ruling.granted) {
      this.log.say(ruling.note);
      return;
    }
    const item = makeEarthObject(what.trim(), this.rng);
    if (!this.pickUp(item)) return;
    this.log.push({ kind: "loot", channel: "loot", items: [item.name], from: "Your own pockets" });
    this.log.say(ruling.note);
  }

  /* -------------------------------------------- keeping a big bag usable */

  private cmdEquipBest(): void {
    let swaps = 0;
    // Repeat, because equipping one thing can change what counts as better in
    // another slot once its modifiers are live.
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (const item of this.state.inventory) {
        if (item.equipped || !item.slot) continue;
        const worn = this.state.inventory.find((i) => i.equipped && i.slot === item.slot);
        if (worn && gearScore(this.state, worn) >= gearScore(this.state, item)) continue;
        if (worn) worn.equipped = false;
        item.equipped = true;
        this.log.push({
          kind: "equip",
          channel: "good",
          item: item.name,
          slot: item.slot,
          removed: worn?.name ?? null,
        });
        swaps++;
        changed = true;
      }
      if (!changed) break;
    }
    this.syncDerived();
    this.log.say(
      swaps === 0
        ? "Nothing in the bag beats what is already on you. Enjoy the moment."
        : `${swaps} ${swaps === 1 ? "change" : "changes"}. You are wearing the best of what you are carrying, which is not the same as being well equipped.`,
    );
  }

  private cmdDropJunk(): void {
    const node = currentNode(this.state.floor);
    const doomed = this.state.inventory.filter(
      (i) => !i.equipped && !i.locked && i.rarity === "junk" && !i.use && !i.tags.includes("craft"),
    );
    if (!doomed.length) {
      this.log.say("Nothing in there is junk, or everything that is is locked, or you are carrying useful rubbish. Either way, no.");
      return;
    }
    for (const item of doomed) {
      this.state.inventory = this.state.inventory.filter((i) => i.iid !== item.iid);
      node.loot.push(item);
    }
    node.searched = false;
    this.log.say(
      `${doomed.length} things on the floor: ${doomed.slice(0, 6).map((d) => d.name).join(", ")}${doomed.length > 6 ? ", and more" : ""}. Locked items and anything drinkable were left alone.`,
    );
  }

  private cmdLock(ref: string): void {
    const item = this.findItem(ref);
    item.locked = !item.locked;
    this.log.say(
      item.locked
        ? `${item.name} is locked. Bulk operations will step around it.`
        : `${item.name} unlocked.`,
    );
  }

  private cmdStance(who: string, stance: "aggressive" | "defensive" | "support" | "hide"): void {
    const lower = who.toLowerCase();
    const comp =
      this.state.companions.find((c) => c.alive && c.name.toLowerCase().includes(lower)) ??
      this.state.companions.find((c) => c.alive);
    if (!comp) throw new Error("There is nobody with you.");
    comp.stance = stance;
    this.log.push({
      kind: "companion",
      channel: "good",
      who: comp.name,
      what: `is now ${stance}`,
      note: {
        aggressive: "They go in first and they do not check whether you followed.",
        defensive: "They stay near you and pick their moments.",
        support: "They harass, distract, and keep out of reach.",
        hide: "They stay out of it entirely, which is sometimes the whole plan.",
      }[stance],
    });
  }

  /* ------------------------------------------------ building and buying */

  private cmdCraft(what: string): void {
    const node = currentNode(this.state.floor);
    if (!what) {
      this.listWorkshop(node);
      return;
    }
    const lower = what.toLowerCase();
    const recipe =
      RECIPE_BY_ID[lower] ??
      RECIPES.find((r) => r.name.toLowerCase() === lower) ??
      RECIPES.find((r) => r.name.toLowerCase().includes(lower));
    if (!recipe) {
      // A brew by the same name is almost certainly what they meant.
      const b = BREWS.find((x) => x.name.toLowerCase().includes(lower) || x.id === lower);
      if (b) return this.cmdBrew(b.id);
      throw new Error(`Nothing called "${what}". Try \`craft\` on its own for the list.`);
    }
    const { item, minutes } = craft(this.state, this.rng, this.log, node, recipe.id);
    if (item && !this.pickUp(item)) return;
    this.advanceTime(minutes / 60, "building");
  }

  private cmdBrew(what: string): void {
    const node = currentNode(this.state.floor);
    const lower = what.toLowerCase();
    const b = BREWS.find((x) => x.id === lower || x.name.toLowerCase().includes(lower));
    if (!b) throw new Error(`Nothing called "${what}". Try \`craft\` for the list.`);
    const { items, minutes } = brew(this.state, this.log, node, b.id, this.rng);
    for (const i of items) this.pickUp(i);
    this.advanceTime(minutes / 60, "brewing");
  }

  private cmdExperiment(): void {
    const node = currentNode(this.state.floor);
    const { minutes } = experiment(this.state, this.rng, this.log, node);
    this.advanceTime(minutes / 60, "at the bench");
  }

  private listWorkshop(node: MapNode): void {
    const stations = stationsHere(this.state, node);
    this.log.say(
      stations.length
        ? `Benches to hand: ${stations.map((x) => STATION_BY_ID[x]!.name).join(", ")}.`
        : "No bench here. Guild halls keep a communal one; the good ones you buy and put in your own room.",
    );
    for (const r of RECIPES) {
      if (!this.state.recipes.includes(r.id)) continue;
      const check = canCraft(this.state, node, r.id);
      this.log.say(
        `${r.name} — ${r.materials.map((m) => `${m.qty}× ${m.id}`).join(", ")}${r.station ? `, ${STATION_BY_ID[r.station]!.name}` : ""}. ` +
          (check.ok ? (check.improvised ? "You could improvise it, slowly, and it might not work." : "Ready.") : check.reason),
      );
    }
    for (const b of BREWS) {
      if (skillLevel(this.state, b.skill.id) < b.skill.level) continue;
      this.log.say(`${b.name} — ${b.materials.map((m) => `${m.qty}× ${m.id}`).join(", ")}, ${STATION_BY_ID[b.station]!.name}.`);
    }
    const unknown = RECIPES.filter((r) => !this.state.recipes.includes(r.id)).length;
    if (unknown) {
      this.log.say(`There are ${unknown} things you have not worked out. A bench and some materials you can afford to waste is how that changes — try \`experiment\`.`);
    }
  }

  private cmdDeploy(ref: string, targetRef?: string): void {
    const enc = this.state.encounter && !this.state.encounter.finished ? this.state.encounter : null;
    if (!enc) throw new Error("There is nothing here to use it on, and you are not wasting it.");
    if (enc.actions.act <= 0) throw new Error("You have already acted this round.");
    const item = this.findItem(ref);
    if (!item.device) throw new Error(`${item.name} is not something you deploy. Try \`throw\`.`);

    const node = this.node();
    const me = crawlerOf(enc);
    const target = targetRef ? this.resolveCombatant(targetRef) : this.bestDeviceTarget(enc, item);
    const zoneId = target ? target.zone : me.zone;

    this.consumeItem(item);
    const result = deliverDevice(this.state, this.rng, this.log, enc, node, item, target, zoneId);
    notePractice(this.state, "improvised_kill");
    if (item.device.tags.includes("fire")) notePractice(this.state, "fire");
    if (result.killed) notePractice(this.state, "env_kill");
    trainSkill(this.state, "throwing", 2);
    enc.actions.act--;
    this.afterCombatStep();
  }

  /** The thing a charge is worth spending on: biggest, or whatever it counters. */
  private bestDeviceTarget(enc: NonNullable<GameState["encounter"]>, item: Item): Combatant | null {
    const me = crawlerOf(enc);
    const foes = hostilesOf(enc, me);
    if (!foes.length) return null;
    return foes
      .slice()
      .sort((a, b) => b.hpMax - a.hpMax)[0]!;
  }

  private cmdShop(): void {
    const node = currentNode(this.state.floor);
    if (node.kind !== "shop" && node.kind !== "guild") {
      throw new Error("Nobody here is selling anything.");
    }
    if (!this.state.shop || this.state.shop.node !== node.id) {
      this.state.shop = { node: node.id, stock: rollShopStock(this.state, this.rng) };
    }
    this.log.say(`${this.state.crawler.gold} gold on you.`);
    this.state.shop.stock.forEach((it, n) => {
      this.log.say(`${n + 1}) ${it.name}${it.qty > 1 ? ` ×${it.qty}` : ""} — ${buyPrice(this.state, it)} gold. ${it.desc}`);
    });
    this.log.say(
      "`buy <n>` and `sell <item>`. Selling is where the money actually comes from, which is why you have been carrying all that.",
    );
  }

  private cmdBuy(what: string): void {
    const node = currentNode(this.state.floor);
    if (!this.state.shop || this.state.shop.node !== node.id) this.cmdShop();
    const shop = this.state.shop!;
    const index = parseInt(what, 10);
    const item =
      (!Number.isNaN(index) ? shop.stock[index - 1] : undefined) ??
      shop.stock.find((i) => i.name.toLowerCase().includes(what.toLowerCase()));
    if (!item) throw new Error(`Nothing on the shelf called "${what}".`);
    const price = buyPrice(this.state, item);
    if (this.state.crawler.gold < price) {
      throw new Error(`${item.name} is ${price} gold. You have ${this.state.crawler.gold}.`);
    }
    this.state.crawler.gold -= price;
    shop.stock = shop.stock.filter((i) => i.iid !== item.iid);
    this.pickUp(item);
    trainSkill(this.state, "negotiation", 1);
    this.log.push({ kind: "trade", channel: "loot", verb: "buy", item: item.name, gold: price, vendor: node.name });
  }

  private cmdSell(what: string): void {
    const node = currentNode(this.state.floor);
    if (node.kind !== "shop" && node.kind !== "guild") throw new Error("Nobody here is buying.");
    if (what.toLowerCase() === "junk") return this.sellJunk(node);
    const item = this.findItem(what);
    if (item.equipped) throw new Error("Take it off first.");
    if (item.locked) throw new Error(`${item.name} is locked.`);
    const price = sellPrice(this.state, item) * item.qty;
    this.state.inventory = this.state.inventory.filter((i) => i.iid !== item.iid);
    this.state.crawler.gold += price;
    trainSkill(this.state, "negotiation", 1);
    this.log.push({ kind: "trade", channel: "loot", verb: "sell", item: item.name, gold: price, vendor: node.name });
  }

  private sellJunk(node: MapNode): void {
    const doomed = this.state.inventory.filter(
      (i) => !i.equipped && !i.locked && !i.use && !i.device && !i.tags.includes("craft") && i.rarity === "junk",
    );
    if (!doomed.length) throw new Error("Nothing worthless and unlocked to sell.");
    let total = 0;
    for (const item of doomed) {
      total += sellPrice(this.state, item) * item.qty;
      this.state.inventory = this.state.inventory.filter((i) => i.iid !== item.iid);
    }
    this.state.crawler.gold += total;
    trainSkill(this.state, "negotiation", 2);
    this.log.push({ kind: "trade", channel: "loot", verb: "sell", item: `${doomed.length} pieces of rubbish`, gold: total, vendor: node.name });
  }

  private cmdBuySpace(): void {
    const node = currentNode(this.state.floor);
    if (!inSafeRoom(node)) throw new Error("You buy one from a safe room, which is the only place the door exists.");
    buySpace(this.state, this.log);
  }

  private cmdInstall(what: string): void {
    const node = currentNode(this.state.floor);
    if (!inSafeRoom(node)) throw new Error("Your room opens off a safe room. You have to be in one.");
    if (!what) {
      for (const st of STATIONS) {
        const owned = this.state.space.stations.includes(st.id);
        this.log.say(`${st.id} — ${st.name}, ${st.cost} gold${owned ? " (installed)" : ""}. ${st.desc}`);
      }
      return;
    }
    installStation(this.state, this.log, what.toLowerCase());
  }

  private cmdUpgrade(what: string): void {
    const node = currentNode(this.state.floor);
    if (!inSafeRoom(node)) throw new Error("Your room opens off a safe room. You have to be in one.");
    if (!what) {
      this.log.say(
        this.state.space.owned
          ? `Your room: ${this.state.space.stations.length ? this.state.space.stations.join(", ") : "empty"}. Upgrades held: ${this.state.space.upgrades.join(", ") || "none"}.`
          : `You do not have a room. ${SPACE_COST} gold, from a safe room, with \`space\`.`,
      );
      for (const u of UPGRADES) {
        this.log.say(`${u.id} — ${u.name}, ${u.cost} gold${this.state.space.upgrades.includes(u.id) ? " (owned)" : ""}. ${u.desc}`);
      }
      return;
    }
    buyUpgrade(this.state, this.log, what.toLowerCase());
  }

  private cmdSign(sponsorId: string): void {
    if (!signSponsor(this.state, this.log, sponsorId)) {
      throw new Error("Nobody by that name is offering you anything.");
    }
  }

  private cmdDescend(): void {
    const floor = this.state.floor;
    const node = currentNode(floor);
    if (!node.hasStairs) throw new Error("There are no stairs here.");
    if (!floor.stairsAnnounced) throw new Error("The stairwells have not been seeded yet. Nobody is going anywhere.");
    if (node.boss && !floor.bossesKilled.includes(node.boss)) {
      throw new Error(`${BOSS_BY_ID[node.boss]?.name ?? "Something"} is standing between you and the stairs, and it has noticed you looking at them.`);
    }

    auditSponsors(this.state, this.log, this.state.floorTally);

    const next = floor.n + 1;
    const def = floorDef(next);
    this.state.floor = generateFloor(this.state.seed, next);
    this.state.floorTally = blankTally();
    // A floor is scored on its own, so the audience it drew is measured from here.
    this.state.ratings.floorStart = this.state.ratings.views;
    this.state.claims = 0;
    this.state.shop = null;
    revealFrom(this.state.floor, this.state.floor.at);
    // Both backloads come back on the way down. That is the whole reason the
    // descent feels like the safest moment in the game.
    this.state.restores = { room: true, floor: true };

    // What the room pays out, quietly, while you were being hit elsewhere.
    if (this.state.space.owned) {
      if (this.state.space.upgrades.includes("garden")) {
        const grown = fromId("reagent", 2, this.rng);
        if (this.pickUp(grown)) this.log.say("The lamps have been on the whole time. Two reagents, waiting for you.");
      }
      if (this.state.space.upgrades.includes("armoury")) {
        this.dispatch({ t: "equipBest" });
      }
    }
    this.takeCheckpoint("floor");

    const d = derive(this.state);
    this.state.crawler.hp = d.hpMax; // stairwells refill health, always have
    this.state.crawler.statuses = this.state.crawler.statuses.filter((s) => !STATUS_BY_ID[s.id]?.bad);
    this.advanceTime(0.5, "descending");

    this.log.push({
      kind: "floor",
      channel: "good",
      n: next,
      name: def.name,
      hours: def.days * 24,
      note: def.theme,
    });
    if (next === 3) {
      this.log.say("The training levels have concluded. Find a Guild Hall and choose what you are. It is permanent, and you have been earning points for it since level one.");
    }
  }

  /* ------------------------------------------------------------- clock */

  private advanceTime(hours: number, reason: string): void {
    if (hours <= 0) return;
    const s = this.state;
    const c = s.crawler;

    // Zero is zero. Out-of-combat regeneration below would otherwise quietly
    // heal somebody who is already finished — an hour of resting is not a
    // treatment for having none left.
    if (c.hp <= 0) {
      this.die("Bled out on the floor of a room nobody was filming, an hour after it stopped mattering.");
      return;
    }

    s.elapsed += hours;
    s.floor.hoursLeft -= hours;

    c.fatigue = clamp(c.fatigue + hours * 4.2, 0, 100);
    c.hunger = clamp(c.hunger + hours * 3.4, 0, 100);

    if (c.fatigue > 85 && !c.statuses.some((x) => x.id === "exhausted")) {
      c.statuses.push(makeStatus("exhausted", 99));
      this.log.push({ kind: "body", channel: "bad", what: "exhausted", note: "You have been awake too long and it is now costing you two of everything. Find a safe room." });
    }
    if (c.hunger > 85 && !c.statuses.some((x) => x.id === "starving")) {
      c.statuses.push(makeStatus("starving", 99));
      this.log.push({ kind: "body", channel: "bad", what: "starving", note: "Starving. Safe room food is free on these floors and there is no excuse for this." });
    }

    // Out of combat only. Nothing regenerates while something is chewing on you.
    if (!s.encounter) {
      const regen = regenPerHour(s);
      const d = derive(s);
      const before = c.hp;
      c.hp = clamp(c.hp + regen.hp * hours, 0, d.hpMax);
      c.mana = clamp(c.mana + regen.mana * hours, 0, d.manaMax);
      c.stamina = clamp(c.stamina + regen.stamina * hours, 0, d.staminaMax);
      const healed = Math.round(c.hp - before);
      if (healed >= 5) {
        this.log.push({ kind: "heal", channel: "good", amount: healed, hp: Math.round(c.hp), source: "Time, and a Constitution score." });
      }

      // Bleeding you ignore for six hours is bleeding that kills you.
      for (const st of c.statuses) {
        if (st.magnitude > 0 && STATUS_BY_ID[st.id]?.bad) {
          const dmg = Math.round(st.magnitude * hours);
          if (dmg > 0) {
            c.hp = Math.max(0, c.hp - dmg);
            this.log.say(`${st.name}: ${dmg} damage while you were busy. Deal with it.`);
          }
        }
      }
      c.statuses = c.statuses.filter((st) => {
        if (st.turns === 99 || st.turns < 0) return true;
        st.turns -= hours;
        return st.turns > 0;
      });
    }

    for (const line of worldTick(s, this.rng, hours)) {
      this.log.push({ kind: "feed", channel: "show", text: line });
    }

    // Floor one seeds its stairwells about a third of the way through.
    if (!s.floor.stairsAnnounced && s.floor.hoursLeft <= s.floor.hoursTotal * 0.66) {
      s.floor.stairsAnnounced = true;
      this.log.push({ kind: "stairs", channel: "system", found: false, node: "" });
    }

    if (hunterDue(s, this.rng, hours) && !s.encounter) this.spawnHunter();

    if (c.hp <= 0) {
      this.die("Bled out, unattended, somewhere nobody was filming.");
      return;
    }
    if (s.floor.hoursLeft <= 0) {
      this.die("Caught on the floor at collapse. The ceiling came down exactly on schedule.");
      return;
    }
    if (s.floor.hoursLeft < 6 && !s.flags.collapseWarned) {
      s.flags.collapseWarned = true;
      this.log.say(`Under six hours. The floor is closing and it is not a metaphor. Find a stairwell.`);
    }
  }

  private spawnHunter(): void {
    const node = currentNode(this.state.floor);
    if (node.kind === "safe_room" || node.kind === "guild") return;
    // Scaled to the crawler, and the level is actually passed through. A
    // bounty hunter is meant to be a fair fight you did not ask for, not a
    // level-40 stranger arriving to end a level-4 run.
    const level = clamp(this.state.crawler.level + this.rng.int(-1, 2), 2, 40);
    node.spawn.push({ mob: "hunter_crawler", count: this.rng.chance(0.3) ? 2 : 1, level });
    node.cleared = false;
    this.state.counters.crawlersMet++;
    this.log.push({
      kind: "hunter",
      channel: "bad",
      name: "A bounty crawler",
      level,
      note: "Somebody read your number, did the arithmetic, and walked here. They are between you and everywhere.",
    });
    this.startEncounter(node, false);
  }

  private die(cause: string): void {
    const c = this.state.crawler;
    if (!c.alive) return;
    c.alive = false;
    c.hp = 0;
    c.death = { cause, floor: this.state.floor.n, at: this.state.elapsed };

    // What was in reach and unused. The point is not to soften the death — it
    // is that a death you can see the shape of is a death you can learn from,
    // and the alternative is a screen that just says no.
    const outs: string[] = [];
    const heals = this.state.inventory.filter((i) => i.use?.effect === "heal");
    if (heals.length) {
      outs.push(`${heals.reduce((n, i) => n + i.qty, 0)} healing item${heals.length > 1 ? "s" : ""} you were carrying and did not drink`);
    }
    const bandages = this.state.inventory.filter((i) => i.use?.effect === "bleed");
    if (bandages.length && c.statuses.some((x) => x.id === "bleeding")) {
      outs.push("a bandage, while you were bleeding");
    }
    const devices = this.state.inventory.filter((i) => i.device);
    if (devices.length) outs.push(`${devices.length} built device${devices.length > 1 ? "s" : ""} still in the bag`);
    const castable = Object.values(this.state.spellbook).filter((sp) => sp.mana <= c.mana);
    if (castable.length) outs.push(`${castable[0]!.name}, which you could afford`);

    this.log.push({ kind: "death", channel: "bad", cause, floor: this.state.floor.n, level: c.level });
    this.state.pendingDeath = { cause, outs };
    if (outs.length) {
      this.log.say(`For the record, and only for the record: ${commaList(outs)}.`);
    }
  }

  /* ----------------------------------------------------------- backloads */

  /**
   * Two per floor and then it is a death.
   *
   * The reason this exists is so the simulation never has to pull a punch. A
   * game with permadeath and no backloads has to be careful with you or it is
   * cruel; a game with infinite ones has no stakes. Room, then floor, then
   * that is the run — and both come back on the way down.
   */
  takeCheckpoint(kind: "room" | "floor"): void {
    const { checkpoints, ...rest } = this.state as GameState & { checkpoints: unknown };
    const snapshot = JSON.stringify({ ...rest, rng: this.rng.save(), pendingDeath: null });
    this.state.checkpoints[kind] = snapshot;
    if (kind === "floor") this.state.checkpoints.room = snapshot;
  }

  canRestore(kind: "room" | "floor"): boolean {
    return this.state.restores[kind] && this.state.checkpoints[kind] !== null;
  }

  restore(kind: "room" | "floor"): boolean {
    if (!this.canRestore(kind)) return false;
    const snapshot = JSON.parse(this.state.checkpoints[kind]!) as GameState;
    const restores = { ...this.state.restores, [kind]: false };
    // Going back to the start of the floor gives you the room back with it.
    if (kind === "floor") restores.room = true;
    const keptCheckpoints = { ...this.state.checkpoints };

    this.state = { ...snapshot, restores, checkpoints: keptCheckpoints, pendingDeath: null };
    this.rng = new Rng(this.state.rng);
    this.log = new EventLog(() => this.state.elapsed);
    this.state.crawler.alive = true;
    delete this.state.crawler.death;

    const left = [restores.room && "the room", restores.floor && "the floor"].filter(Boolean);
    this.log.say(
      kind === "room"
        ? `Back to the doorway of ${currentNode(this.state.floor).name}, with everything you had when you walked in and nothing you learned since. ${left.length ? `${commaList(left as string[])} left.` : "Nothing left after this one. The next death is the run."}`
        : `Back to the landing on floor ${this.state.floor.n}. Every hour since is gone, along with everything in it. ${left.length ? `${commaList(left as string[])} left.` : "Nothing left. The next death is the run."}`,
    );
    return true;
  }

  /* ------------------------------------------------------------ helpers */

  private award(id: string, name: string, text: string, box?: [string, string]): void {
    if (this.state.achievements.some((a) => a.id === id)) return;
    this.state.achievements.push({ id, name, text, floor: this.state.floor.n, at: this.state.elapsed });
    this.log.push({
      kind: "achievement",
      channel: "loot",
      id,
      name,
      text,
      box: box ? `${box[1]} ${BOX_BY_ID[box[0]]?.name ?? box[0]}` : null,
    });
    if (box) {
      this.state.boxes.push({ bid: `ach_${id}`, type: box[0], tier: box[1], why: name });
      this.log.push({ kind: "box_awarded", channel: "loot", tier: box[1], box: BOX_BY_ID[box[0]]?.name ?? box[0], why: name });
    }
  }

  private checkAchievements(): void {
    for (const a of ACHIEVEMENTS) {
      if (this.state.achievements.some((x) => x.id === a.id)) continue;
      if (!a.test(this.state)) continue;
      this.award(a.id, a.name, a.text, a.box);
    }
  }

  /**
   * Canon, and the best inventory rule in the source material: there is no
   * slot limit. The only question is whether you can get it off the ground for
   * the two seconds the interface needs.
   *
   * Both halves of that are checked, which they were not. The single-item test
   * was here from the start; the running total was computed, printed on the
   * sheet in both clients, and then never consulted by anything — so the
   * ceiling was a decoration and you could carry nine vending machines. It
   * matters much more now that a wall can be turned into a bag of four-kilo
   * blocks: a limit nobody enforces is a limit that makes the limestone free.
   */
  private pickUp(item: Item): boolean {
    if (item.weight > carryCapacity(this.state)) {
      this.log.say(`${item.name} will not come off the ground. That is a Strength problem and there is no way around it but Strength.`);
      return false;
    }
    const load = item.weight * item.qty;
    const ceiling = carryCapacity(this.state);
    if (carriedWeight(this.state) + load > ceiling) {
      this.log.say(
        `${item.name} is ${round1(load)} kg and you are already at ${carriedWeight(this.state)} of ${ceiling}. ` +
        `Something has to go on the floor first — try dropping the junk.`,
      );
      return false;
    }
    if (item.weight >= 20) notePractice(this.state, "heavy_haul");
    const stack = this.state.inventory.find(
      (i) => !i.equipped && i.id === item.id && ["potion", "food", "material", "explosive", "junk"].includes(i.kind),
    );
    if (stack) stack.qty += item.qty;
    else this.state.inventory.push(item);
    return true;
  }

  private consume(id: string): boolean {
    const item = this.state.inventory.find((i) => i.id === id && !i.equipped);
    if (!item) return false;
    this.consumeItem(item);
    return true;
  }

  private consumeItem(item: Item): void {
    if (item.qty > 1) item.qty--;
    else this.state.inventory = this.state.inventory.filter((i) => i.iid !== item.iid);
  }

  /**
   * Generous on purpose. An id, an index from the printed inventory, an exact
   * name, a partial name, or any word from the name — after four floors of
   * looting nobody should have to type "Reinforced Recurve of Bad Ideas" in
   * full to drink a potion.
   */
  private findItem(ref: string): Item {
    const lower = ref.trim().toLowerCase();
    const index = parseInt(lower.replace(/^#/, ""), 10);
    if (!Number.isNaN(index) && this.state.inventory[index - 1]) {
      return this.state.inventory[index - 1]!;
    }
    const words = lower.split(/\s+/).filter(Boolean);
    const found =
      this.state.inventory.find((i) => i.iid === ref) ??
      this.state.inventory.find((i) => i.name.toLowerCase() === lower) ??
      this.state.inventory.find((i) => i.name.toLowerCase().includes(lower)) ??
      this.state.inventory.find((i) => {
        const name = i.name.toLowerCase();
        return words.every((w) => name.includes(w));
      }) ??
      this.state.inventory.find((i) => words.some((w) => w.length > 3 && i.name.toLowerCase().includes(w)));
    if (!found) {
      const near = this.state.inventory.slice(0, 6).map((i, n) => `${n + 1}) ${i.name}`).join(", ");
      throw new Error(`Nothing called "${ref}" in there.${near ? ` You have: ${near}${this.state.inventory.length > 6 ? ", and more — try \`inv\`" : ""}.` : ""}`);
    }
    return found;
  }

  private resolveNode(ref: string): MapNode {
    const floor = this.state.floor;
    const direct = floor.nodes[ref];
    if (direct) return direct;
    const lower = ref.toLowerCase();
    const here = currentNode(floor);
    const near = here.links
      .map((l) => floor.nodes[l.to]!)
      .find((n) => n.name.toLowerCase().includes(lower));
    if (near) return near;
    const any = Object.values(floor.nodes).find((n) => n.visited && n.name.toLowerCase().includes(lower));
    if (any) return any;
    throw new Error(`You do not know anywhere called "${ref}".`);
  }

  private resolveCombatant(ref: string): Combatant {
    const enc = this.enc();
    const lower = ref.toLowerCase();
    const pool = living(enc, "hostile");
    const asIndex = parseInt(ref, 10);
    if (!Number.isNaN(asIndex) && pool[asIndex - 1]) return pool[asIndex - 1]!;
    const found =
      pool.find((c) => c.id === ref) ??
      pool.find((c) => c.name.toLowerCase() === lower) ??
      pool.find((c) => c.name.toLowerCase().includes(lower));
    if (!found) throw new Error(`Nothing here called "${ref}".`);
    return found;
  }

  private equippedWeapon(): Item | undefined {
    return this.state.inventory.find((i) => i.equipped && i.kind === "weapon");
  }

  private weaponSkillId(): string {
    const w = this.equippedWeapon();
    if (!w) return "brawling";
    if (w.tags.includes("ranged")) return "marksmanship";
    if (w.tags.includes("polearm")) return "polearm";
    if (w.tags.includes("blades")) return "blades";
    if (w.tags.includes("bludgeon")) return "bludgeon";
    return "brawling";
  }

  private remember(node: MapNode, summary: string): void {
    this.state.memory.push({ floor: this.state.floor.n, node: node.name, summary, at: this.state.elapsed });
    if (this.state.memory.length > 40) this.state.memory.shift();
  }
}

/* ------------------------------------------------------------- helpers */

/** Whoever is still standing and hostile when the crawler stops being. */
function lastAttacker(enc: { combatants: Combatant[] }): string | null {
  const alive = enc.combatants.filter((c) => c.side === "hostile" && c.alive);
  return alive.length ? alive.sort((a, b) => b.level - a.level)[0]!.name : null;
}

/** Rough worth of a piece of gear, for `equip best`. Deliberately simple: it
 *  is a convenience, not an oracle, and a player who cares should compare. */
function gearScore(state: GameState, item: Item): number {
  const mods = (item.mods ?? []).reduce((n, m) => n + (typeof (m as { v?: number }).v === "number" ? (m as { v: number }).v : 0), 0);
  const dice = item.damage ? avgOf(item.damage) : 0;
  const rarity = ["junk", "common", "uncommon", "rare", "epic", "legendary", "celestial"].indexOf(item.rarity);
  return mods + dice * 1.6 + rarity;
}

function avgOf(spec: string): number {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(spec);
  if (!m) return 0;
  const n = m[1] ? parseInt(m[1], 10) : 1;
  return n * ((parseInt(m[2]!, 10) + 1) / 2) + (m[3] ? parseInt(m[3], 10) : 0);
}

/** An ordinary object off a dead planet. No statistics, no rarity, no combat
 *  value — what it is worth is whatever a clever crawler makes it do. */
function makeEarthObject(name: string, rng: Rng): Item {
  const clean = name.replace(/^(a|an|the|my|some)\s+/i, "").slice(0, 48);
  return {
    iid: `claim_${Math.floor(rng.next() * 0xffffffff).toString(36)}`,
    id: `earth_${clean.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    name: clean.charAt(0).toUpperCase() + clean.slice(1),
    kind: "junk",
    rarity: "junk",
    weight: 0.3,
    value: 1,
    qty: 1,
    tags: ["earth", "claimed"],
    desc: "Yours, from before. It has no statistics and the system has logged it anyway, because the system logs everything.",
  };
}

function blankTally() {
  return {
    kills: 0, unarmedKills: 0, environmentalKills: 0, fled: 0, parleys: 0, spared: 0,
    npcKills: 0, damageTaken: 0, bossKills: 0, roomsCleared: 0,
  };
}

function dressLine(dress: string): string {
  return {
    underdressed: "in your underwear, barefoot on freezing stone",
    bed: "in whatever you sleep in, barefoot",
    casual: "dressed, shoes on, which puts you ahead of a great many of them",
    work: "still in your work clothes, mid-shift",
  }[dress] ?? "dressed";
}

function describeRoom(node: MapNode): string {
  const features = node.zones.flatMap((z) => z.features.filter((f) => !f.spent).map((f) => f.name));
  const bits: string[] = [];
  if (features.length) bits.push(`You can see ${features.join(", ")}.`);
  const chokes = node.zones.filter((z) => z.tags.includes("choke"));
  if (chokes.length) bits.push(`${chokes[0]!.name.replace(/^the /, "The ")} is narrow enough to hold.`);
  return bits.join(" ") || "Stone, water noise, and the specific silence of somewhere that used to have a ceiling of its own.";
}

export { skillMilestone, SKILL_BY_ID };
export type { Style };

/** What a position is, in the terms the combat resolver actually reads. */
function describeZone(z: { name: string; capacity: number; tags: string[]; barricaded?: boolean; traps?: unknown[]; hazard?: { kind: string } | null }): string {
  const bits: string[] = [`${z.capacity} can reach you in there at once.`];
  const meaning: Record<string, string> = {
    choke: "narrow",
    cover: "something to get behind",
    high: "above the rest of the room",
    water: "standing water",
    flammable: "it will burn",
    exposed: "open ground, nothing to hide behind",
    confined: "tight",
    dark: "dark",
    rubble: "broken underfoot",
  };
  const said = z.tags.map((t) => meaning[t]).filter(Boolean);
  if (said.length) bits.push(`${said.join(", ")}.`);
  if (z.barricaded) bits.push("It has been barricaded.");
  if (z.traps?.length) bits.push("Something is rigged in it.");
  if (z.hazard) bits.push(`There is ${z.hazard.kind} in it right now.`);
  return bits.join(" ");
}

/**
 * An engine verb named by a Dungeon Master, turned into a command.
 *
 * Deliberately a hand-written table rather than a cast. A `Reading` arrives as
 * an arbitrary string and this is the only door it comes through, so the door
 * lists every verb it opens and nothing else gets in — no `improvise` (which
 * would recurse), no `select` or `sign` or `spend` (which are irreversible
 * character decisions and are not a Dungeon Master's to make), and nothing at
 * all that was not written here on purpose.
 */
export function commandFromIntent(intent: string, arg?: string): Command | null {
  const a = (arg ?? "").trim();
  switch (intent) {
    case "look": return { t: "look" };
    case "examine": return { t: "examine", what: a || undefined };
    case "search": return { t: "search" };
    case "scout": return a ? { t: "scout", node: a } : null;
    case "go": return a ? { t: "go", to: a } : null;
    case "descend": return { t: "descend" };
    case "wait": return { t: "wait", hours: 1 };
    case "rest": return { t: "rest" };
    case "eat": return { t: "eat" };
    case "engage": return { t: "engage" };
    case "attack": return { t: "attack", target: a, called: false };
    case "move": return a ? { t: "move", zone: a } : null;
    case "feature": return a ? { t: "feature", id: a } : null;
    case "throw": return a ? { t: "throw", item: a } : null;
    case "brace": return { t: "brace" };
    case "aim": return { t: "aim" };
    case "intimidate": return { t: "intimidate" };
    case "parley": return { t: "parley" };
    case "flee": return { t: "flee" };
    case "endturn": return { t: "endturn" };
    case "use": return a ? { t: "use", item: a } : null;
    case "equip": return a ? { t: "equip", item: a } : null;
    case "unequip": return a ? { t: "unequip", item: a } : null;
    case "drop": return a ? { t: "drop", item: a } : null;
    case "lock": return a ? { t: "lock", item: a } : null;
    case "cast": return a ? { t: "cast", spell: a } : null;
    case "craft": return a ? { t: "craft", what: a } : null;
    case "brew": return { t: "brew", what: a || "brew_health" };
    case "experiment": return { t: "experiment" };
    case "harvest": return { t: "harvest", what: a || undefined };
    case "transform": return { t: "transform", said: a || undefined };
    case "deploy": return a ? { t: "deploy", item: a } : null;
    case "shop": return { t: "shop" };
    case "buy": return a ? { t: "buy", what: a } : null;
    case "sell": return { t: "sell", what: a || "junk" };
    case "open": return { t: "open" };
    case "equipBest": return { t: "equipBest" };
    case "dropJunk": return { t: "dropJunk" };
    case "prep":
      return ["barricade", "trap", "ambush", "breather"].includes(a)
        ? { t: "prep", what: a as "barricade" | "trap" | "ambush" | "breather" }
        : { t: "prep", what: "breather" };
    default:
      return null;
  }
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const round1 = (n: number): number => Math.round(n * 10) / 10;
