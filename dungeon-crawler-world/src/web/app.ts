import { Game, type Command } from "../sim/game.ts";
import type { GameState, Item, StatKey } from "../core/types.ts";
import { STAT_NAMES } from "../core/types.ts";
import type { RenderedLine } from "../voice/narrator.ts";
import { derive, carryCapacity, carriedWeight } from "../sim/character.ts";
import { currentNode } from "../sim/map.ts";
import { crawlerOf, living, zoneDistance, zoneOf } from "../sim/tactics.ts";
import { describeTraits } from "../sim/devices.ts";
import { SKILL_BY_ID } from "../data/skills.ts";
import { PRACTICE_BY_ID } from "../data/emergent.ts";
import { HOOK_LABEL } from "../core/hooks.ts";
import { BOX_BY_ID } from "../data/boxes.ts";
import { MOB_BY_ID, BOSS_BY_ID } from "../data/mobs.ts";
import { RACES } from "../data/paths.ts";
import { STATIONS, UPGRADES, SPACE_COST, RECIPES, BREWS } from "../data/recipes.ts";
import { transformMenu } from "../sim/transform.ts";
import { broadcastView, runRecord } from "../sim/broadcast.ts";
import { dossier, skillLines } from "../sim/dossier.ts";
import { sceneOf, situationLine } from "../sim/scene.ts";
import {
  junkHaul, packView, PACK_FILTERS, PACK_SORTS,
  type PackFilter, type PackSort,
} from "../sim/pack.ts";
import { LlmProposer, NoProposer } from "../voice/proposer.ts";
import { depositsHere, strainNote, strainStage } from "../sim/harvest.ts";
import type { Intake } from "../sim/intake.ts";

/**
 * The browser client.
 *
 * Same engine, same `Game.execute`, no privileged access — this file can only
 * ask questions and draw answers, exactly like the terminal one.
 *
 * Built for a phone first: one column, thumb-reachable controls, and every
 * action available as a tap so that typing is a power feature rather than the
 * price of entry. The freeform box is still there, because "shove the shelving
 * onto them" is the whole point of the game.
 */

const SAVE_KEY = "dcw:save:v2";
/** Kept out of the save on purpose: a shared run must not carry somebody's key. */
const DM_KEY = "dcw:dm-key";

/**
 * Whether this page can talk to anything at all.
 *
 * A published artifact runs under `connect-src 'self'`, which blocks every
 * external host outright — so offering to store an API key there would be
 * offering something that cannot work. Detected rather than assumed, because
 * the same build is meant to run in both places.
 */
function canReachTheNetwork(): boolean {
  try {
    // The artifact host frames the page; a standalone build does not. This is
    // a heuristic and it is allowed to be — being wrong costs a failed request
    // and a message saying so, which is what would have happened anyway.
    return window.top === window.self || location.protocol === "file:";
  } catch {
    return false;
  }
}

/** Restore the DM seat on boot if a key was left on this device. */
function restoreProposer(g: Game): void {
  try {
    const key = localStorage.getItem(DM_KEY);
    if (key && canReachTheNetwork()) g.proposer = new LlmProposer({ apiKey: key, browser: true });
  } catch {
    // Storage disabled. The game is complete without it.
  }
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel)!;
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let game: Game | null = null;
let busy = false;

/* ------------------------------------------------------------- storage */

function save(): void {
  if (!game) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game.save()));
  } catch {
    toast("Could not save — storage is full. Export your run from the menu.");
  }
}

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- log */

/**
 * A line of the transcript.
 *
 * Three things happen here that a plain text node cannot do, and all three are
 * the design's thesis rather than decoration:
 *
 *   THE ATTENTION RULE. Every line carries a left stripe whose weight encodes
 *   what the audience gave it, frozen at insert time and never recomputed.
 *   Scroll back through a run and the margin is a thickness graph of when the
 *   galaxy cared about you. It is a background rather than a border, so the
 *   weight varies without the text moving a pixel, and it costs no horizontal
 *   space at all — it lives inside padding that already existed.
 *
 *   THE MARK. When a line actually earned views, the price prints beneath it
 *   with the multiplier that paid. Silence is what makes the spikes mean
 *   anything, so most lines get nothing and a zero never prints.
 *
 *   THE STAMP. In the closing stage every line is timestamped against the
 *   collapse, so your own transcript ends up stamped against your death.
 */
function line(l: RenderedLine): void {
  const feed = $("#feed");
  const s = game?.state;

  if (s && s.flags.clockStage === "closing") {
    feed.appendChild(el("span", "stamp", `T−${s.floor.hoursLeft.toFixed(2).replace(".", ":")}`));
  }

  const node = el("div", `line ${l.channel}`);
  node.textContent = l.text;
  if (l.tone) node.dataset.tone = l.tone;
  // The System AI is clamped to two lines because it types rather than speaks.
  // That is a voice, not a licence to swallow the second half of a sentence, so
  // the clamp opens on a tap.
  if (l.channel === "system" && l.tone !== "announce") {
    node.addEventListener("click", () => {
      node.dataset.open = node.dataset.open === "true" ? "false" : "true";
    });
  }
  node.dataset.att = String(attention(l));
  feed.appendChild(node);

  if (l.score && l.score.views > 0) {
    const m = el("div", "mark");
    m.appendChild(el("span", "n", `+${l.score.views.toLocaleString()}`));
    if (l.score.because.length) {
      const why = l.score.multiplier > 1 ? `  ×${l.score.multiplier} ${l.score.because.join(" · ")}` : `  ${l.score.because.join(" · ")}`;
      m.appendChild(el("span", "why", why));
    }
    feed.appendChild(m);
  }

  while (feed.childElementCount > 400) feed.removeChild(feed.firstChild!);
  scrollToEnd();
}

/**
 * How loud this line was, bucketed against the run's own rolling maximum.
 *
 * Relative rather than absolute because the scale moves by two orders of
 * magnitude across eighteen floors — a spike worth noticing on floor one is
 * noise on floor twelve, and a fixed threshold would make the margin go solid
 * and stay solid.
 */
function attention(l: RenderedLine): 0 | 1 | 2 | 3 {
  const views = l.score?.views ?? 0;
  if (views <= 0) return 0;
  const top = Math.max(1, ...(game?.state.ratings.recent ?? [1]));
  const f = views / top;
  return f < 0.08 ? 0 : f < 0.25 ? 1 : f < 0.6 ? 2 : 3;
}

/**
 * Card stock dropped into a dark reading client.
 *
 * The discipline that makes it safe is the whole of it: institution-authored
 * terminal documents only, never narration, never combat, never loot, one on
 * screen at a time, and always dismissible. A document that turned up for a
 * potion would make every document meaningless.
 */
interface NoticeSpec {
  ref: string;
  title: string;
  body: string;
  foot?: string;
  actions?: { label: string; cmd?: Command; ghost?: boolean; disabled?: boolean }[];
  note?: string;
}

function notice(spec: NoticeSpec): void {
  const feed = $("#feed");
  // One at a time, ever. A second would turn a document into a notification.
  feed.querySelector(".notice:not(.notice--stub)")?.remove();

  const n = el("div", "notice");
  n.appendChild(el("div", "notice__ref", spec.ref));
  n.appendChild(el("div", "notice__title", spec.title));
  n.appendChild(el("div", "notice__body", spec.body));
  if (spec.foot) n.appendChild(el("div", "notice__foot", spec.foot));

  const acts = el("div", "notice__acts");
  for (const a of spec.actions ?? [{ label: "Acknowledge" }]) {
    const b = el("button", `ack${a.ghost ? " ack--ghost" : ""}`, a.label) as HTMLButtonElement;
    if (a.disabled) b.disabled = true;
    else {
      b.addEventListener("click", () => {
        const stub = el("div", "notice notice--stub");
        stub.appendChild(el("div", "notice__title", `${spec.title} — filed`));
        n.replaceWith(stub);
        if (a.cmd) void run(a.cmd);
      });
    }
    acts.appendChild(b);
  }
  n.appendChild(acts);
  if (spec.note) n.appendChild(el("div", "notice__note", spec.note));

  feed.appendChild(n);
  scrollToEnd();
}

/**
 * Get the newest line actually on screen.
 *
 * Setting scrollTop synchronously does not work, because the action rail below
 * the feed is about to be rebuilt at a different height and the feed will be
 * resized out from under the scroll position. Measured: the last line of an
 * Engage ended up 15px below the fold every single time. So this runs after
 * layout has settled, and in flow mode it scrolls the page rather than a pane
 * that no longer scrolls.
 */
function scrollToEnd(): void {
  const go = () => {
    const feed = $("#feed");
    if (document.documentElement.classList.contains("framed")) {
      const last = feed.lastElementChild as HTMLElement | null;
      last?.scrollIntoView({ block: "end", behavior: "auto" });
    } else {
      feed.scrollTop = feed.scrollHeight;
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
}

function say(text: string, channel: RenderedLine["channel"] = "system"): void {
  line({ channel, text });
}

function toast(text: string): void {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

/* --------------------------------------------------------------- turns */

async function run(cmd: Command): Promise<void> {
  if (!game || busy) return;
  if (!game.state.crawler.alive) return;
  busy = true;
  // Everything, not just Send — a second tap during an await was silently
  // dropped, which reads as an unresponsive button rather than a busy one.
  const live = [...document.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
  for (const b of live) b.setAttribute("disabled", "1");
  try {
    const result = await game.execute(cmd);
    for (const l of result.lines) line(l);
    save();
  } catch (err) {
    say(err instanceof Error ? err.message : String(err), "bad");
  } finally {
    busy = false;
    for (const b of live) b.removeAttribute("disabled");
    draw();
    // The sheet is drawing state the command just changed.
    redrawSheet();
  }
}

/* ----------------------------------------------------------------- HUD */

/**
 * A gauge: a ruled measure with printed ticks and the danger band silkscreened
 * on the track at full health, so you learn where the cliff is without ever
 * having been over it.
 *
 * One component for HP, mana, stamina, experience, carry load, strain and
 * clause compliance. `inverted` flips the semantic so that on load, fatigue,
 * hunger and strain a FILLING bar always means trouble — one meaning across
 * every measure in the game.
 */
function gauge(o: {
  label: string;
  value: number;
  max: number;
  band?: number;
  text?: string;
  hp?: boolean;
  inverted?: boolean;
  tall?: boolean;
}): HTMLElement {
  const f = o.max > 0 ? Math.max(0, Math.min(1, o.value / o.max)) : 0;
  const g = el("div", `gauge${o.hp ? " gauge--hp" : ""}${o.inverted ? " gauge--inverted" : ""}${o.tall ? " gauge--tall" : ""}`);
  if (o.band) {
    // The dangerous end is the LOW end on health and the HIGH end on load.
    const from = o.inverted ? o.band * 100 : 0;
    const to = o.inverted ? 100 : o.band * 100;
    g.style.setProperty("--band-from", `${from}%`);
    g.style.setProperty("--band-to", `${to}%`);
    // The threshold line goes on whichever edge of the band is the boundary.
    g.style.setProperty("--edge-at", o.inverted ? "left" : "right");
  }
  const danger = o.inverted ? f >= (o.band ?? 0.9) : f <= (o.band ?? 0);
  if (danger) g.dataset.state = "danger";

  const fill = el("div", "gauge__fill");
  fill.style.width = `${f * 100}%`;
  g.appendChild(fill);
  g.appendChild(el("div", "gauge__ticks"));
  g.appendChild(el("span", "gauge__label", o.label));
  g.appendChild(el("span", "gauge__num", o.text ?? `${Math.round(o.value)}/${Math.round(o.max)}`));
  return g;
}

function draw(): void {
  if (!game) return;
  const s = game.state;
  const c = s.crawler;
  const d = derive(s);
  const cast = broadcastView(s);
  const stage = (s.flags.clockStage as string) ?? "open";

  $("#app").dataset.stage = stage;

  /* ── the letterhead ─────────────────────────────────────────────── */
  $("#name").textContent = c.name;
  $("#sub").textContent = [
    `LV ${c.level}`,
    c.className ?? c.race ?? "unclassed",
    `${c.gold}G`,
    c.stars.length ? `${c.stars.length}★` : "",
  ].filter(Boolean).join(" · ");

  // Game hours, fractional, and the largest persistent number in the app.
  const left = s.floor.hoursLeft;
  const clockEl = $("#clock");
  clockEl.textContent = `F${s.floor.n} · ${left < 10 ? left.toFixed(1) : Math.round(left)}h`;
  clockEl.dataset.stage = stage;

  /* ── the collapse ruler: appears at a quarter left and never goes ── */
  const ruler = $("#ruler");
  const posted = stage !== "open";
  ruler.hidden = !posted;
  if (posted) {
    ruler.dataset.stage = stage;
    (ruler.firstElementChild as HTMLElement).style.setProperty(
      "--left", `${Math.max(0, Math.min(100, (left / Math.max(1, s.floor.hoursTotal)) * 100))}%`,
    );
  }

  /* ── vitals ─────────────────────────────────────────────────────── */
  const vitals = $("#vitals");
  vitals.replaceChildren();
  // Never print an empty measure: Intelligence 0 is reachable.
  const cols = d.manaMax > 0 ? 3 : 2;
  vitals.style.setProperty("--cols", String(cols));
  vitals.appendChild(gauge({ label: "HP", value: c.hp, max: d.hpMax, band: 0.34, hp: true }));
  if (d.manaMax > 0) vitals.appendChild(gauge({ label: "MP", value: c.mana, max: d.manaMax, band: 0.2 }));
  vitals.appendChild(gauge({ label: "ST", value: c.stamina, max: d.staminaMax, band: 0.25 }));

  /* ── the broadcast strip ────────────────────────────────────────── */
  const strip = $("#cast");
  strip.replaceChildren();
  if (!cast.live) {
    // Floor one is highlight reels only. That is the one mercy the format
    // offers and losing it on floor two should be a moment.
    strip.appendChild(el("span", "", "Not on air"));
    strip.appendChild(el("span", "spacer"));
    strip.appendChild(el("span", "", `Archived ${cast.viewsLabel}`));
  } else {
    strip.appendChild(el("span", "lamp"));
    strip.appendChild(el("span", "", "Live"));
    strip.appendChild(el("span", "watch", cast.watchingLabel));
    const arrow = el("span", "trend", { surging: "▲", rising: "▲", steady: "—", draining: "▼" }[cast.trend]);
    arrow.dataset.t = cast.trend;
    strip.appendChild(arrow);
    strip.appendChild(el("span", "spacer"));
    const b = el("div", "bounty");
    b.dataset.heat = String(cast.heat);
    b.appendChild(el("span", "", cast.bounty.toLocaleString()));
    // The label is the point: "4,200" tells nobody whether to be frightened.
    b.appendChild(el("span", "band", ` ${cast.bountyLabel}`));
    strip.appendChild(b);
  }
  $("#feed").dataset.live = String(cast.live);

  /* ── conditional bands: only when they mean something ───────────── */
  const strips = $("#strips");
  strips.replaceChildren();
  const warn: string[] = [];
  if (c.fatigue > 60) warn.push(`Fatigue ${Math.round(c.fatigue)}${c.fatigue > 85 ? " — taking two off everything" : ""}`);
  if (c.hunger > 60) warn.push(`Hunger ${Math.round(c.hunger)}${c.hunger > 85 ? " — starving" : ""}`);
  for (const st of c.statuses.filter((x) => x.bad)) warn.push(st.name);
  if (warn.length) {
    const row = el("div", "strip");
    row.appendChild(el("span", "", warn.join(" · ")));
    strips.appendChild(row);
  }
  for (const sp of cast.sponsors) {
    const row = el("div", "strip strip--clause");
    row.appendChild(el("span", "who", `${sp.name} §2`));
    row.appendChild(el("span", "", sp.clause));
    if (sp.strikes) row.appendChild(el("span", "", `· ${sp.strikes} strike`));
    strips.appendChild(row);
  }

  $("#where").textContent = currentNode(s.floor).name;
  drawActions();

  if (!c.alive) drawDeath();
}

/* ------------------------------------------------------------ actions */

/**
 * Legacy modifier words, translated once.
 *
 * Call sites all over this file say `"small good"` and `"danger"`. Rather than
 * touch sixty of them, the vocabulary is mapped here — and the mapping is a
 * statement about what each one MEANS in the new system, which is why `loot`
 * becomes `paid`: gold and the audience are the same colour because they are
 * the same thing.
 */
const CLS: Record<string, string> = {
  small: "act--small",
  good: "act--gain",
  gain: "act--gain",
  danger: "act--danger",
  loot: "act--paid",
  paid: "act--paid",
  feature: "act--danger",
  exit: "act--exit",
  panel: "act--panel",
  unknown: "act--unknown",
};

const classes = (cls: string): string =>
  cls.split(/\s+/).filter(Boolean).map((w) => CLS[w] ?? "").filter(Boolean).join(" ");

/**
 * A control, with its price against a clock that is trying to kill you.
 *
 * The cost column is the single most important thing in the rail. Every tap in
 * this game spends minutes off a floor timer, and until now nothing said so
 * until after you had spent them.
 */
function actionBtn(
  label: string,
  cmd: Command,
  cls = "",
  cost?: { text: string; fail?: boolean },
): HTMLElement {
  const b = el("button", `act ${classes(cls)}`);
  b.appendChild(el("span", "act__label", label));
  if (cost) {
    const c = el("span", `act__cost${cost.fail ? " act__cost--fail" : ""}`, cost.text);
    b.appendChild(c);
  }
  if (cost?.fail) {
    (b as HTMLButtonElement).disabled = true;
  } else {
    b.addEventListener("click", () => void run(cmd));
  }
  return b;
}

function drawActions(): void {
  const s = game!.state;
  const box = $("#acts");
  box.replaceChildren();
  if (!s.crawler.alive) return;

  const enc = s.encounter && !s.encounter.finished ? s.encounter : null;
  if (enc) return drawCombatActions(box);

  const node = currentNode(s.floor);
  const safe = node.kind === "safe_room" || node.kind === "guild";
  const hostile =
    !node.cleared && (node.spawn.length > 0 || (node.boss && !s.floor.bossesKilled.includes(node.boss)));

  if (hostile) {
    if (s.flags.undetected) {
      box.appendChild(el("div", "hint", "They have not seen you. This is the only free move you get."));
      box.appendChild(actionBtn("Set an ambush", { t: "prep", what: "ambush" }, "good", { text: "15 min" }));
      box.appendChild(actionBtn("Rig a trap", { t: "prep", what: "trap" }, "", { text: "20 min" }));
      box.appendChild(actionBtn("Barricade", { t: "prep", what: "barricade" }, "", { text: "30 min" }));
    }
    box.appendChild(actionBtn("Engage", { t: "engage" }, "danger"));
    const boss = node.boss && !s.floor.bossesKilled.includes(node.boss) ? BOSS_BY_ID[node.boss] : null;
    if (boss) box.appendChild(el("div", "hint", `${boss.name} — ${boss.rank} boss, ${boss.size}. ${boss.weakness}`));
  } else {
    if (!node.searched) box.appendChild(actionBtn("Search", { t: "search" }, "", { text: "~30 min" }));
    if (node.hasStairs && s.floor.stairsAnnounced) {
      box.appendChild(actionBtn("Descend", { t: "descend" }, "exit", { text: "the next floor" }));
    }
    // The walls, as an offer. Nobody would guess this was possible from a
    // freeform box, and a system you have to already know about is a system
    // most people never find.
    const seams = depositsHere(s, node);
    if (seams.length) box.appendChild(sheetBtn("Take the room apart", drawSeams));
  }

  if (safe) {
    if (s.boxes.length) box.appendChild(actionBtn(`Open ${s.boxes.length} boxes`, { t: "open" }, "loot"));
    if (s.crawler.hunger > 30) box.appendChild(actionBtn("Eat", { t: "eat" }, "gain", { text: "10 min" }));
    box.appendChild(actionBtn("Sleep", { t: "rest" }, "gain", { text: "7 h" }));
    box.appendChild(sheetBtn("Workshop", drawWorkshop));
    if (node.kind === "shop" || node.kind === "guild") box.appendChild(actionBtn("Shop", { t: "shop" }));
    box.appendChild(sheetBtn("Your room", drawSpace));
    if (s.crawler.points > 0) box.appendChild(sheetBtn(`Spend ${s.crawler.points} points`, drawSpend, "good"));
    if (node.kind === "guild" && s.floor.n >= 3 && !s.crawler.race) {
      box.appendChild(sheetBtn("Choose what you are", drawChoose, "loot"));
    }
  }
  if (node.kind === "shop") box.appendChild(actionBtn("Shop", { t: "shop" }));

  box.appendChild(el("div", "sect", "go"));
  for (const l of node.links) {
    const n = s.floor.nodes[l.to]!;
    const known = n.visited || s.flags[`scouted_${n.id}`] === true;
    const label = known ? n.name.replace(/^the /, "") : "unexplored";
    const marks: string[] = [];
    if (known && n.hasStairs && s.floor.stairsAnnounced) marks.push("stairs");
    if (known && n.kind === "safe_room") marks.push("safe room");
    if (known && n.kind === "guild") marks.push("guild");
    if (known && n.kind === "shop") marks.push("shop");
    if (known && n.cleared) marks.push("cleared");
    const row = el("div", "rowacts");
    // The minutes go in the cost column, not in the label. Every leg of travel
    // is priced against a floor timer, and the price belongs where every other
    // price in the app is.
    row.appendChild(actionBtn(
      marks.length ? `${label} — ${marks.join(", ")}` : label,
      { t: "go", to: l.to },
      known ? (n.hasStairs && s.floor.stairsAnnounced ? "exit" : "") : "unknown",
      { text: `${l.minutes} min` },
    ));
    if (!known) row.appendChild(actionBtn("Look first", { t: "scout", node: l.to }, "small"));
    box.appendChild(row);
  }
}

function drawCombatActions(box: HTMLElement): void {
  const s = game!.state;
  const enc = s.encounter!;
  const node = s.floor.nodes[enc.nodeId]!;
  const me = crawlerOf(enc);
  const foes = living(enc, "hostile");

  // The room, as positions. This is the whole game and it goes at the top.
  const map = el("div", "zones");
  for (const z of node.zones) {
    const here = z.id === me.zone;
    const dist = zoneDistance(node, me.zone, z.id);
    const occupants = living(enc).filter((x) => x.zone === z.id);
    const row = el("div", `zone${here ? " here" : ""}`);
    const tags: string[] = [];
    if (z.capacity <= 2) tags.push(`choke ${z.capacity}`);
    if (z.tags.includes("cover")) tags.push("cover");
    if (z.tags.includes("high")) tags.push("high");
    if (z.tags.includes("water")) tags.push("water");
    if (z.tags.includes("flammable")) tags.push("flammable");
    if (z.hazard) tags.push(z.hazard.kind);
    row.appendChild(el("div", "zname", z.name + (tags.length ? `  [${tags.join(" · ")}]` : "")));
    if (occupants.length) {
      row.appendChild(
        el("div", "zwho", occupants.map((o) => (o.side === "crawler" ? "you" : o.name)).join(", ")),
      );
    }
    for (const f of z.features.filter((x) => !x.spent)) {
      const b = el("button", "act feature", `✦ ${f.name}`);
      b.addEventListener("click", () => void run({ t: "feature", id: f.id }));
      row.appendChild(b);
    }
    if (!here && dist === 1 && enc.actions.move > 0) {
      const b = el("button", "act small", "move here");
      b.addEventListener("click", () => void run({ t: "move", zone: z.id }));
      row.appendChild(b);
    }
    map.appendChild(row);
  }
  box.appendChild(map);

  for (const f of foes) {
    const wrap = el("div", "foe");
    const reach = zoneDistance(node, me.zone, f.zone) <= me.reach;
    const head = el("div", "foehead");
    head.appendChild(el("span", "foename", `${f.name} lv${f.level}`));
    head.appendChild(el("span", "foehp", `${Math.round(f.hp)}/${f.hpMax}`));
    wrap.appendChild(head);
    wrap.appendChild(gauge({ label: "", value: f.hp, max: f.hpMax, hp: true, text: "" }));
    const traits = describeTraits(f);
    if (traits) wrap.appendChild(el("div", "hint", traits));
    const btns = el("div", "foebtns");
    if (reach && enc.actions.act > 0) {
      btns.appendChild(actionBtn("Attack", { t: "attack", target: f.id }, "danger"));
      btns.appendChild(actionBtn("Aimed shot", { t: "attack", target: f.id, called: true }, "small"));
      for (const dev of s.inventory.filter((i) => i.device)) {
        btns.appendChild(actionBtn(`${dev.name} →`, { t: "deploy", item: dev.iid, target: f.id }, "small loot"));
      }
    } else if (enc.actions.act > 0) {
      for (const dev of s.inventory.filter((i) => i.device && !i.device.placed)) {
        btns.appendChild(actionBtn(`Throw ${dev.name}`, { t: "deploy", item: dev.iid, target: f.id }, "small loot"));
      }
      btns.appendChild(el("span", "hint", "out of reach"));
    }
    wrap.appendChild(btns);
    box.appendChild(wrap);
  }

  const row = el("div", "rowacts");
  if (enc.actions.act > 0) {
    row.appendChild(actionBtn("Brace", { t: "brace" }));
    row.appendChild(actionBtn("Aim", { t: "aim" }));
    row.appendChild(actionBtn("Taunt", { t: "intimidate" }));
    row.appendChild(actionBtn("Talk", { t: "parley" }));
    for (const sp of Object.values(s.spellbook).filter((x) => x.mana <= s.crawler.mana && !s.cooldowns[x.id])) {
      row.appendChild(actionBtn(`${sp.name} (${sp.mana})`, { t: "cast", spell: sp.id }, "small"));
    }
    for (const it of s.inventory.filter((i) => i.use?.effect === "heal" || i.use?.effect === "bleed")) {
      row.appendChild(actionBtn(it.name, { t: "use", item: it.iid }, "small good"));
    }
  }
  row.appendChild(actionBtn("Flee", { t: "flee" }, "small"));
  row.appendChild(actionBtn("End turn", { t: "endturn" }, "small"));
  box.appendChild(row);
  box.appendChild(
    el("div", "hint", `Round ${enc.round} · ${enc.actions.move} move, ${enc.actions.act} action`),
  );
}

/* --------------------------------------------------------------- sheets */

/**
 * A button that opens a panel.
 *
 * Marked `panel` so it does not look like a button that spends your life. Every
 * control in the action rail was rendered identically whether it cost an hour
 * of the floor clock or merely showed you a list, which is a real thing to get
 * wrong in a game whose antagonist is a countdown.
 */
function sheetBtn(label: string, render: (body: HTMLElement) => void, cls = ""): HTMLElement {
  const b = el("button", `act act--panel ${classes(cls)}`);
  b.appendChild(el("span", "act__label", label));
  b.addEventListener("click", () => openSheet(label, render));
  return b;
}

/**
 * The open sheet, remembered.
 *
 * Every button inside a sheet runs a command and every command changes the
 * state the sheet is drawing — but nothing redrew it, so tapping "wear",
 * "sell", "+1" or "build" left the identical list sitting there and the game
 * looked broken. It was not broken; it just never said anything.
 */
let openPanel: { title: string; render: (body: HTMLElement) => void } | null = null;

function openSheet(title: string, render: (body: HTMLElement) => void): void {
  openPanel = { title, render };
  $("#sheet").classList.add("open");
  redrawSheet();
}

function redrawSheet(): void {
  if (!openPanel) return;
  $("#sheet-title").textContent = openPanel.title;
  const body = $("#sheet-body");
  const keep = body.scrollTop;
  body.replaceChildren();
  openPanel.render(body);
  body.scrollTop = keep;
}

function closeSheet(): void {
  openPanel = null;
  $("#sheet").classList.remove("open");
}

function row(body: HTMLElement, left: string, right = "", note = ""): void {
  const r = el("div", "srow");
  r.appendChild(el("span", "sleft", left));
  if (right) r.appendChild(el("span", "sright", right));
  body.appendChild(r);
  if (note) body.appendChild(el("div", "hint", note));
}

/**
 * §7 — THE MANIFEST.
 *
 * Declared cargo under a weight ceiling with no slot limit, so the design job
 * is WEIGHT, not slots. Everything here reads from `pack.ts`.
 *
 * The four things that make a two-hundred-item bag usable: what you are
 * wearing shown as slots INCLUDING the vacancies, a load gauge that prints
 * where the cliff is, slices and orders that carry their own counts, and — the
 * only fact that decides whether you tap anything — an inline differential
 * against what you have on.
 */
let packFilter: PackFilter = "all";
let packSort: PackSort = "relevance";
let packOpen: string | null = null;

/** Rarity as strokes, so it survives greyscale, colour-blindness and 13px. */
function rarityMark(r: string): HTMLElement {
  const strokes = { junk: 1, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 1, celestial: 1 }[r] ?? 1;
  const block = r === "legendary" || r === "celestial";
  const m = el("span", `rar${block ? " rar--block" : ""}`);
  m.dataset.r = r;
  for (let i = 0; i < strokes; i++) m.appendChild(el("i"));
  return m;
}

function drawInventory(body: HTMLElement): void {
  const s = game!.state;
  const view = packView(s, packFilter, packSort);
  const node = currentNode(s.floor);
  const vendor = node.kind === "shop" || node.kind === "guild";
  const d = derive(s);

  /* ── A. the load gauge ──────────────────────────────────────────── */
  body.appendChild(gauge({
    label: "Carried", value: view.kg, max: view.ceiling, band: 0.9,
    inverted: true, tall: true, text: `${view.kg} / ${view.ceiling} kg`,
  }));
  // The marginal value of Strength, which is the number that makes it legible
  // as the storage stat and which no label/value row has ever printed.
  const nextStr = Math.round(30 * Math.pow(Math.max(1, d.stats.str + 1) / 4, 1.6) - 30 * Math.pow(Math.max(1, d.stats.str) / 4, 1.6));
  body.appendChild(el("div", "hint", `No slot limit. Strength is the only gate — the next point buys about ${nextStr} kg.`));
  if (view.load > 0.9) {
    body.appendChild(el("div", "hint hint--bad", "Nothing else comes off the ground until something goes down."));
  }

  const tools = el("div", "rowacts");
  tools.appendChild(actionBtn("Equip best", { t: "equipBest" }, "small good"));
  const junk = junkHaul(s);
  if (junk.items.length) {
    tools.appendChild(actionBtn(`Drop junk`, { t: "dropJunk" }, "small", { text: `−${junk.kg} kg` }));
    if (vendor) tools.appendChild(actionBtn(`Sell junk`, { t: "sell", what: "junk" }, "small loot", { text: `${junk.gold}g` }));
  }
  body.appendChild(tools);

  /* ── B. schedule of worn equipment, vacancies included ──────────── */
  body.appendChild(el("div", "sect", "Worn"));
  for (const w of view.worn) {
    const r = el("div", `slotrow${w.item ? "" : " slotrow--vacant"}`);
    r.appendChild(el("span", "slotrow__label", w.label));
    const name = el("span", "slotrow__item", w.item ? w.item.name : "— vacant —");
    if (w.item) name.dataset.r = w.item.rarity;
    r.appendChild(name);
    if (w.item) {
      const off = actionBtn("Off", { t: "unequip", item: w.item.iid }, "small");
      r.appendChild(off);
    }
    body.appendChild(r);
  }

  /* ── F/G. order and slice ───────────────────────────────────────── */
  const sorts = el("div", "chiprow");
  for (const o of PACK_SORTS) {
    const c = el("button", "chip", o.label);
    c.setAttribute("aria-pressed", String(packSort === o.id));
    c.addEventListener("click", () => { packSort = o.id; redrawSheet(); });
    sorts.appendChild(c);
  }
  body.appendChild(sorts);

  const filters = el("div", "chiprow");
  for (const f of PACK_FILTERS) {
    const n = view.tally[f.id];
    if (!n && f.id !== "all") continue;
    const c = el("button", "chip");
    c.appendChild(el("span", "", f.label));
    c.appendChild(el("span", "n", ` ${n}`));
    c.setAttribute("aria-pressed", String(packFilter === f.id));
    c.addEventListener("click", () => { packFilter = f.id; redrawSheet(); });
    filters.appendChild(c);
  }
  body.appendChild(filters);

  /* ── D. the rows ────────────────────────────────────────────────── */
  body.appendChild(el("div", "sect", `Carried — ${view.shownCount} of ${view.carriedCount}`));
  if (!view.rows.length) body.appendChild(el("div", "hint", "Nothing here matches."));

  for (const { item: i, comparison } of view.rows) {
    const row = el("button", "mrow");
    if (i.weight * i.qty >= 25) row.dataset.bulk = "1";
    row.appendChild(rarityMark(i.rarity));
    const name = el("span", "mrow__name", `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.locked ? " ⌧" : ""}`);
    name.dataset.r = i.rarity;
    row.appendChild(name);
    const kg = Math.round(i.weight * i.qty * 10) / 10;
    row.appendChild(el("span", "mrow__kg", kg >= 0.1 ? String(kg) : "·"));
    row.appendChild(el("span", "mrow__val", `${i.value}g`));
    row.addEventListener("click", () => {
      packOpen = packOpen === i.iid ? null : i.iid;
      redrawSheet();
    });
    body.appendChild(row);

    if (packOpen !== i.iid) continue;

    /* ── H. the inline differential ───────────────────────────────── */
    const open = el("div", "diff");
    if (comparison.verdict !== "none") {
      const h = el("div", "diff__head", comparison.label);
      h.dataset.v = comparison.verdict;
      open.appendChild(h);
      const worn = s.inventory.find((x) => x.equipped && x.slot === i.slot);
      const grid = el("div", "diff__grid");
      // Only the rows that differ. A differential that prints unchanged lines
      // is a table, and a table is what this replaces.
      for (const [k, a, b] of modDeltas(i, worn)) {
        if (a === b) continue;
        grid.appendChild(el("span", "k", k));
        const v = el("span", "v", `${b - a > 0 ? "+" : ""}${Math.round((b - a) * 10) / 10}`);
        v.dataset.d = b - a > 0 ? "up" : "down";
        grid.appendChild(v);
      }
      const dw = Math.round((i.weight - (worn?.weight ?? 0)) * 10) / 10;
      if (dw !== 0) {
        grid.appendChild(el("span", "k", "weight"));
        const v = el("span", "v", `${dw > 0 ? "+" : ""}${dw} kg`);
        v.dataset.d = dw > 0 ? "down" : "up";
        grid.appendChild(v);
      }
      if (grid.childElementCount) open.appendChild(grid);
    }
    open.appendChild(el("div", "swhy", i.desc));
    if (i.device) open.appendChild(el("div", "swhy", i.device.note));

    const btns = el("div", "rowacts");
    if (i.slot) btns.appendChild(actionBtn("Wear", { t: "equip", item: i.iid }, "small" + (comparison.verdict === "better" || comparison.verdict === "empty" ? " good" : "")));
    if (i.use) btns.appendChild(actionBtn("Use", { t: "use", item: i.iid }, "small good"));
    if (i.device) btns.appendChild(actionBtn("Deploy", { t: "deploy", item: i.iid }, "small danger"));
    if (vendor) btns.appendChild(actionBtn("Sell", { t: "sell", what: i.iid }, "small loot", { text: `${Math.floor(i.value * 0.4)}g` }));
    btns.appendChild(actionBtn(i.locked ? "Unlock" : "Lock", { t: "lock", item: i.iid }, "small"));
    btns.appendChild(actionBtn("Drop", { t: "drop", item: i.iid }, "small"));
    open.appendChild(btns);
    body.appendChild(open);
  }

  if (s.boxes.length) {
    body.appendChild(el("div", "sect", "Unopened"));
    body.appendChild(el("div", "hint", "They open in a safe room, all at once, in tier order, whether you are ready or not."));
    for (const b of s.boxes) row(body, BOX_BY_ID[b.type]?.name ?? b.type, b.tier, b.why);
  }
}

/**
 * What a modifier is called to a person.
 *
 * The differential printed `stat +2`, which is the name of a field. Nobody has
 * ever wanted to know that a ring gives them "+2 stat".
 */
const MOD_NAME: Record<string, string> = {
  stat: "a stat", hp: "health", armor: "armour", accuracy: "accuracy",
  defense: "defence", damage: "damage", crit: "crit range", initiative: "initiative",
  carry: "carry", skill: "a skill", onKill: "on a kill", unstable: "instability",
  spectacle: "spectacle", resist: "resistance",
};

/** Every modifier either piece carries, paired for a differential. */
function modDeltas(a: Item, b?: Item): [string, number, number][] {
  const sum = (i: Item | undefined, k: string) =>
    (i?.mods ?? []).filter((m) => m.k === k).reduce((n, m) => n + ((m as { v?: number }).v ?? 0), 0);
  const keys = new Set([...(a.mods ?? []).map((m) => m.k), ...(b?.mods ?? []).map((m) => m.k)]);
  const out: [string, number, number][] = [];
  const dice = (i?: Item) => {
    const m = /^(\d*)d(\d+)/i.exec(i?.damage ?? "");
    return m ? Math.round(((parseInt(m[1] || "1", 10) * (parseInt(m[2]!, 10) + 1)) / 2) * 10) / 10 : 0;
  };
  if (dice(a) || dice(b)) out.push(["damage die", dice(b), dice(a)]);
  // Named for the stat where an item says which one, so "a stat +2" becomes
  // "Strength +2" — the difference between a field name and a fact.
  for (const k of keys) {
    const named = (a.mods ?? []).concat(b?.mods ?? []).find((m) => m.k === k) as { stat?: string; skill?: string } | undefined;
    const label = k === "stat" && named?.stat
      ? STAT_NAMES[named.stat as StatKey] ?? "a stat"
      : k === "skill" && named?.skill
        ? named.skill.replace(/_/g, " ")
        : MOD_NAME[k] ?? k;
    out.push([label, sum(b, k), sum(a, k)]);
  }
  return out;
}

function drawSkills(body: HTMLElement): void {
  const s = game!.state;
  for (const [id, k] of Object.entries(s.skills).sort((a, b) => b[1].level - a[1].level)) {
    const minted = s.minted[id];
    const def = SKILL_BY_ID[id];
    row(body, `${minted?.name ?? def?.name ?? id}${minted ? "  ✦" : ""}`, String(k.level), minted
      ? `${minted.origin} ${minted.hooks.map(HOOK_LABEL).join("; ")}`
      : def?.desc ?? "");
  }
  const watching = Object.entries(s.practice)
    .filter(([id, n]) => n >= 2 && !s.minted[id])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (watching.length) {
    body.appendChild(el("div", "sect", "being counted"));
    for (const [id, n] of watching) {
      const def = PRACTICE_BY_ID[id];
      if (def) row(body, def.origin, `${n}/${def.threshold}`);
    }
  }
}

function drawSpells(body: HTMLElement): void {
  const s = game!.state;
  const d = derive(s);
  body.appendChild(
    el("div", "hint", `${Math.round(s.crawler.mana)}/${d.manaMax} mana. The pool is your Intelligence, and it comes back at about ${Math.max(1, Math.round(d.stats.int * 3.6))} an hour.`),
  );
  const spells = Object.values(s.spellbook);
  if (!spells.length) body.appendChild(el("div", "hint", "Nothing. Spells come from tomes and shrines."));
  for (const sp of spells) row(body, `${sp.name}${sp.minted ? "  ✦" : ""}`, `${sp.mana} mana`, sp.desc);
}

function drawWorkshop(body: HTMLElement): void {
  const s = game!.state;
  body.appendChild(actionBtn("Experiment at the bench", { t: "experiment" }, "loot"));
  body.appendChild(el("div", "sect", "you know how to build"));
  for (const r of RECIPES.filter((x) => s.recipes.includes(x.id))) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", r.name));
    rr.appendChild(actionBtn("build", { t: "craft", what: r.id }, "small good"));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${r.materials.map((m) => `${m.qty}× ${m.id}`).join(", ")}${r.station ? ` · needs ${r.station}` : ""}`));
  }
  body.appendChild(el("div", "sect", "supplies"));
  for (const b of BREWS) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", b.name));
    rr.appendChild(actionBtn("brew", { t: "brew", what: b.id }, "small"));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${b.materials.map((m) => `${m.qty}× ${m.id}`).join(", ")} · needs ${b.station}`));
  }

  // What the substances in your pack could become. Listed even when they are
  // out of reach, because knowing that limestone becomes quicklime given nine
  // hundred degrees is the interesting half — the rest is shopping.
  const processes = transformMenu(s);
  if (processes.length) {
    body.appendChild(el("div", "sect", "what you are carrying could become"));
    for (const p of processes.slice(0, 12)) {
      const r = el("div", "srow");
      r.appendChild(el("span", "sleft", `${p.product.name} — ${p.rule.name.toLowerCase()} the ${p.input.name.toLowerCase()}`));
      if (p.ok) {
        r.appendChild(actionBtn("do it", { t: "transform", rule: p.rule.id, input: p.input.id }, "small good"));
      } else {
        r.appendChild(el("span", "sright", "not here"));
      }
      body.appendChild(r);
      body.appendChild(el("div", "hint", p.ok ? p.rule.because : `Wants ${p.missing.join("; ")}.`));
    }
  }
}

/**
 * What this room is physically made of, position by position, with the state
 * of the structure you have been attacking printed next to it. The warning is
 * the interesting part: a crawler who reads "the next thing out of this wall is
 * going to be an event" and keeps going has made a decision rather than an
 * error, and both are allowed.
 */
function drawSeams(body: HTMLElement): void {
  const s = game!.state;
  const node = currentNode(s.floor);
  const seams = depositsHere(s, node);
  if (!seams.length) {
    body.appendChild(el("div", "hint", "Nothing here is worth the hours it would take."));
    return;
  }
  for (const { zone, deposits } of seams) {
    body.appendChild(el("div", "sect", zone.name));
    const stage = strainStage(s, node, zone);
    if (stage !== "sound") {
      body.appendChild(el("div", `hint${stage === "critical" ? " bad" : ""}`, strainNote(stage)));
    }
    for (const d of deposits) {
      const r = el("div", "srow");
      r.appendChild(el("span", "sleft", `${d.left} × ${d.mat.name}`));
      r.appendChild(actionBtn("dig", { t: "harvest", what: d.mat.name.toLowerCase(), qty: 2, zone: zone.id }, "small"));
      body.appendChild(r);
      const wants = d.mat.tool ? `needs ${d.mat.tool === "percussion" ? "something heavy" : d.mat.tool === "lever" ? "a bar" : d.mat.tool === "cutting" ? "metal cutters" : d.mat.tool === "fine" ? "fine tools" : "an edge"}` : "bare hands";
      body.appendChild(el("div", "hint",
        `${d.mat.kg} kg each · ${d.mat.minutes ?? 8} min · ${wants}${d.mat.structural ? " · load-bearing" : ""} — ${d.mat.desc}`));
    }
  }
}

function drawSpace(body: HTMLElement): void {
  const s = game!.state;
  if (!s.space.owned) {
    body.appendChild(el("div", "hint", `A room of your own, off every safe room on every floor. ${SPACE_COST} gold. You have ${s.crawler.gold}.`));
    body.appendChild(actionBtn(`Buy it (${SPACE_COST}g)`, { t: "buySpace" }, "loot"));
    return;
  }
  body.appendChild(el("div", "sect", "benches"));
  for (const st of STATIONS) {
    const owned = s.space.stations.includes(st.id);
    const r = el("div", "srow");
    r.appendChild(el("span", "sleft", st.name));
    if (owned) r.appendChild(el("span", "sright", "installed"));
    else r.appendChild(actionBtn(`${st.cost}g`, { t: "install", what: st.id }, "small loot"));
    body.appendChild(r);
    body.appendChild(el("div", "hint", st.desc));
  }
  body.appendChild(el("div", "sect", "the room itself"));
  for (const u of UPGRADES) {
    const owned = s.space.upgrades.includes(u.id);
    const r = el("div", "srow");
    r.appendChild(el("span", "sleft", u.name));
    if (owned) r.appendChild(el("span", "sright", "owned"));
    else r.appendChild(actionBtn(`${u.cost}g`, { t: "upgrade", what: u.id }, "small loot"));
    body.appendChild(r);
    body.appendChild(el("div", "hint", u.desc));
  }
}

function drawSpend(body: HTMLElement): void {
  const s = game!.state;
  body.appendChild(el("div", "hint", `${s.crawler.points} to place. Constitution is the only one that stops a run ending.`));
  for (const [k, label] of [["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"], ["int", "Intelligence"], ["cha", "Charisma"]] as const) {
    const r = el("div", "srow");
    r.appendChild(el("span", "sleft", `${label}  ${s.crawler.stats[k]}`));
    r.appendChild(actionBtn("+1", { t: "spend", stat: k }, "small good"));
    body.appendChild(r);
  }
}

function drawChoose(body: HTMLElement): void {
  const s = game!.state;
  body.appendChild(el("div", "sect", "race"));
  for (const r of RACES) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", r.name));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${r.note} ${r.pros} — ${r.cons}`));
  }
  body.appendChild(el("div", "sect", "class"));
  body.appendChild(el("div", "hint", "Most of this list was assembled from your own record and is not on anybody else's."));
  for (const o of game!.classOptions()) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", `${o.name}${o.generated ? "  ✦" : ""}${o.recommended ? "  ★" : ""}`));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${o.note} Requires ${Object.entries(o.req).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(", ")}. ${o.pros}`));
    const picks = el("div", "rowacts");
    for (const race of ["human", "primal", "crocodilian", "tunnel_shrike", "quill_ogre", "vellum_wraith", "mycen", "cat_royal"]) {
      picks.appendChild(actionBtn(`as ${race}`, { t: "select", race, klass: o.id }, "small"));
    }
    body.appendChild(picks);
  }
}

function drawMap(body: HTMLElement): void {
  const s = game!.state;
  const nodes = Object.values(s.floor.nodes).filter((n) => n.visited || n.sensed);
  body.appendChild(el("div", "hint", `${Object.values(s.floor.nodes).filter((n) => n.visited).length} of ${Object.keys(s.floor.nodes).length} places entered`));
  for (const n of nodes) {
    const marks: string[] = [];
    if (n.id === s.floor.at) marks.push("you are here");
    if (n.hasStairs && s.floor.stairsAnnounced) marks.push("stairs");
    if (n.kind === "safe_room") marks.push("safe");
    if (n.kind === "guild") marks.push("guild");
    if (n.kind === "shop") marks.push("shop");
    if (n.boss && !s.floor.bossesKilled.includes(n.boss)) marks.push(BOSS_BY_ID[n.boss]?.name ?? "boss");
    if (n.cleared && n.visited) marks.push("cleared");
    const r = el("div", "srow");
    r.appendChild(el("span", "sleft", n.visited ? n.name : "somewhere through there"));
    r.appendChild(el("span", "sright", marks.join(" · ")));
    body.appendChild(r);
  }
}

/**
 * §3 — THE PERSONNEL FILE.
 *
 * Five sections so nothing is a wall, all of it from `dossier()`, which already
 * groups by the question each group answers and already carries the meaning of
 * every number. Those strings are read here, never re-authored.
 */
type BodyTab = "body" | "stats" | "effects" | "record" | "show";
let bodyTab: BodyTab = "body";

function drawSheet(body: HTMLElement): void {
  const s = game!.state;
  const dos = dossier(s);

  const tabs = el("div", "subtabs");
  for (const [id, label] of [
    ["body", "Body"], ["stats", "Stats"], ["effects", "Effects"],
    ["record", "Record"], ["show", "Show"],
  ] as [BodyTab, string][]) {
    const b = el("button", "", label);
    b.setAttribute("aria-current", String(bodyTab === id));
    b.addEventListener("click", () => { bodyTab = id; redrawSheet(); });
    tabs.appendChild(b);
  }
  body.appendChild(tabs);

  ({ body: bodyPane, stats: statsPane, effects: effectsPane, record: recordPane, show: showPane })[bodyTab](body, dos);
}

function bodyPane(body: HTMLElement, dos: ReturnType<typeof dossier>): void {
  const s = game!.state;
  const d = derive(s);
  const c = s.crawler;

  row(body, "Licence no.", String(dos.number));
  row(body, "Classification", dos.identity);
  body.appendChild(el("div", "sect", `Level ${dos.level}`));
  body.appendChild(gauge({ label: "XP", value: dos.xp.have, max: dos.xp.need, text: `${dos.xp.have}/${dos.xp.need}` }));
  if (dos.points) body.appendChild(actionBtn(`Spend ${dos.points} points`, { t: "spend", stat: "str" }, "small good"));
  if (dos.banked) body.appendChild(el("div", "hint", `${dos.banked} points banked and unspendable until the third floor gives you a race and a class.`));

  body.appendChild(el("div", "sect", "Condition"));
  body.appendChild(gauge({ label: "HP", value: c.hp, max: d.hpMax, band: 0.34, hp: true, tall: true }));
  if (d.manaMax > 0) body.appendChild(gauge({ label: "MP", value: c.mana, max: d.manaMax, band: 0.2, tall: true }));
  body.appendChild(gauge({ label: "ST", value: c.stamina, max: d.staminaMax, band: 0.25, tall: true }));
  // Inverted, so a filling bar always means trouble. One semantic everywhere.
  body.appendChild(gauge({ label: "Fatigue", value: c.fatigue, max: 100, band: 0.6, inverted: true, tall: true, text: String(Math.round(c.fatigue)) }));
  body.appendChild(gauge({ label: "Hunger", value: c.hunger, max: 100, band: 0.6, inverted: true, tall: true, text: String(Math.round(c.hunger)) }));

  for (const g of dos.groups.filter((x) => x.title === "the body")) {
    for (const l of g.lines) if (l.why) body.appendChild(el("div", "swhy", `${l.label}: ${l.why}`));
  }

  body.appendChild(el("div", "sect", "Backloads"));
  const tok = el("div", "tokens");
  for (const [label, live] of [["Room", dos.backloads.room], ["Floor", dos.backloads.floor]] as const) {
    tok.appendChild(el("span", `token${live ? "" : " token--spent"}`));
    tok.appendChild(el("span", "sright", label));
  }
  body.appendChild(tok);
  body.appendChild(el("div", "swhy", dos.backloads.note));
}

function statsPane(body: HTMLElement, dos: ReturnType<typeof dossier>): void {
  for (const g of dos.groups) {
    body.appendChild(el("div", "sect", g.title));
    for (const l of g.lines) {
      row(body, l.label, l.value);
      if (l.why) body.appendChild(el("div", "swhy", l.why));
    }
  }
}

/**
 * Statuses drawn on the floor clock's own axis.
 *
 * "Bleeding ends in three hours, the floor collapses in five point eight" is
 * one picture instead of two numbers and a subtraction — and the decision to
 * spend seven hours asleep becomes something you look at rather than compute.
 * `Status.turns` is hours out of combat and rounds in one, so the axis says
 * which it is rather than quietly meaning both.
 */
function effectsPane(body: HTMLElement): void {
  const s = game!.state;
  const fighting = !!s.encounter && !s.encounter.finished;
  const span = fighting ? Math.max(6, ...s.crawler.statuses.map((x) => x.turns)) : s.floor.hoursLeft;

  body.appendChild(el("div", "hint", fighting
    ? "Rounds, because a fight is happening. The floor clock is not the axis while something is trying to kill you."
    : `Hours, against the ${s.floor.hoursLeft.toFixed(1)} left on this floor.`));

  const rows = [...s.crawler.statuses]
    .map((st) => ({ name: st.name, turns: st.turns, bad: st.bad, note: st.note }))
    .sort((a, b) => (a.turns < 0 ? 1e9 : a.turns) - (b.turns < 0 ? 1e9 : b.turns));

  if (!rows.length) body.appendChild(el("div", "hint", "Nothing on you, good or bad."));

  for (const st of rows) {
    const r = el("div", `tl${st.bad ? " tl--bad" : ""}`);
    r.appendChild(el("span", "tl__name", st.name));
    const track = el("div", "tl__track");
    const b = el("div", "tl__bar");
    b.style.setProperty("--w", st.turns < 0 ? "100%" : `${Math.min(100, (st.turns / Math.max(0.1, span)) * 100)}%`);
    track.appendChild(b);
    r.appendChild(track);
    r.appendChild(el("span", "tl__num", st.turns < 0 ? "until removed" : fighting ? `${Math.round(st.turns)}r` : `${st.turns.toFixed(1)}h`));
    body.appendChild(r);
    if (st.note) body.appendChild(el("div", "swhy", st.note));
  }

  if (!fighting) {
    const r = el("div", "tl tl--clock");
    r.appendChild(el("span", "tl__name", "Floor closes"));
    const track = el("div", "tl__track");
    const b = el("div", "tl__bar");
    b.style.setProperty("--w", "100%");
    track.appendChild(b);
    r.appendChild(track);
    r.appendChild(el("span", "tl__num", `${s.floor.hoursLeft.toFixed(1)}h`));
    body.appendChild(r);
  }
}

function recordPane(body: HTMLElement): void {
  for (const g of runRecord(game!.state)) {
    body.appendChild(el("div", "sect", g.group));
    for (const l of g.lines) {
      row(body, l.label, l.value);
      if (l.note) body.appendChild(el("div", "swhy", l.note));
    }
  }
}

/**
 * One sparkline, not five. Five is what you draw when you have not decided
 * which number matters. `Ratings.recent` has carried a comment since the day it
 * was added saying it is meant to be drawn, and it never has been.
 */
function showPane(body: HTMLElement): void {
  const s = game!.state;
  const v = broadcastView(s);

  if (!v.live) body.appendChild(el("div", "hint", v.liveNote));

  body.appendChild(el("div", "sect", "Watching"));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 40 24");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("aria-hidden", "true");
  if (v.spark.length > 1) {
    const pts = v.spark.map((y, i) => `${(i / (v.spark.length - 1)) * 40},${24 - y * 22}`).join(" ");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", pts);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "var(--sponsor)");
    line.setAttribute("stroke-width", "1");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
  }
  body.appendChild(svg);
  row(body, "Watching now", `${v.watchingLabel} ${{ surging: "▲", rising: "▲", steady: "—", draining: "▼" }[v.trend]}`);
  row(body, "Peak", v.peakLabel);
  row(body, "This floor", v.thisFloorLabel);
  row(body, "Views, all time", v.views.toLocaleString());
  row(body, "Followers", v.followers.toLocaleString());
  row(body, "Favourites", v.favourites.toLocaleString());

  body.appendChild(el("div", "sect", "Bounty"));
  row(body, v.bounty.toLocaleString(), v.bountyLabel);
  body.appendChild(el("div", "swhy", "Fame is a debt. The bounty is what makes other crawlers come looking."));

  body.appendChild(el("div", "sect", "Patrons"));
  if (!v.sponsors.length) body.appendChild(el("div", "hint", "Nobody is paying to be associated with you."));
  for (const sp of v.sponsors) {
    row(body, sp.name, sp.strikes ? `${sp.strikes} strike` : "held");
    body.appendChild(el("div", "swhy", sp.clause));
  }

  body.appendChild(el("div", "sect", "The season"));
  row(body, "Crawlers left", v.crawlersLeft.toLocaleString());
}

function drawDeath(): void {
  const s = game!.state;
  openSheet("Crawler terminated", (body) => {
    body.appendChild(el("div", "death", s.crawler.name));
    body.appendChild(
      el("div", "hint", `Level ${s.crawler.level}, floor ${s.floor.n}, after ${s.elapsed.toFixed(1)} hours. ${s.crawler.death?.cause ?? ""}`),
    );
    if (s.pendingDeath?.outs.length) {
      body.appendChild(el("div", "sect", "for the record"));
      for (const o of s.pendingDeath.outs) body.appendChild(el("div", "hint", o));
    }

    const canRoom = game!.canRestore("room");
    const canFloor = game!.canRestore("floor");
    if (canRoom || canFloor) {
      body.appendChild(el("div", "sect", "backloads"));
      body.appendChild(
        el("div", "hint", "Two a floor, and they come back on the way down. After both, the next one is the run."),
      );
      if (canRoom) {
        const b = el("button", "act good", "Back to the start of this room");
        b.addEventListener("click", () => {
          game!.restore("room");
          save();
          closeSheet();
          say("Back to the doorway.", "good");
          draw();
        });
        body.appendChild(b);
      }
      if (canFloor) {
        const b = el("button", "act", "Back to the start of this floor");
        b.addEventListener("click", () => {
          game!.restore("floor");
          save();
          closeSheet();
          say("Back to the landing.", "good");
          draw();
        });
        body.appendChild(b);
      }
    } else {
      body.appendChild(el("div", "sect", "that is the run"));
      body.appendChild(el("div", "hint", "No backloads left. The feed has cut to a sponsor message."));
    }

    body.appendChild(el("div", "sect", ""));
    const nb = el("button", "act danger", "New crawler");
    nb.addEventListener("click", () => {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    });
    body.appendChild(nb);
  });
}

/* ------------------------------------------------------------- intake */

const INTAKE: Partial<Intake> = {};

function startIntake(): void {
  const wrap = $("#intake");
  wrap.classList.add("open");
  const body = $("#intake-body");

  const steps: (() => void)[] = [];
  let step = 0;
  const next = () => {
    body.replaceChildren();
    if (step >= steps.length) {
      wrap.classList.remove("open");
      begin(Math.floor(Math.random() * 0x7fffffff), INTAKE);
      return;
    }
    steps[step++]!();
  };

  const ask = (q: string, hint: string, key: "name" | "job" | "hobby", fallback: string) => () => {
    body.appendChild(el("h2", "", q));
    if (hint) body.appendChild(el("div", "hint", hint));
    const input = el("input", "field") as HTMLInputElement;
    input.placeholder = fallback;
    body.appendChild(input);
    const b = el("button", "act good", "Next");
    b.addEventListener("click", () => {
      (INTAKE as Record<string, unknown>)[key] = input.value.trim() || fallback;
      next();
    });
    body.appendChild(b);
    input.focus();
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") b.click();
    });
  };

  const choose = <K extends keyof Intake>(q: string, key: K, opts: [Intake[K], string][]) => () => {
    body.appendChild(el("h2", "", q));
    for (const [v, label] of opts) {
      const b = el("button", "act", label);
      b.addEventListener("click", () => {
        (INTAKE as Record<string, unknown>)[key as string] = v;
        next();
      });
      body.appendChild(b);
    }
  };

  steps.push(() => {
    body.appendChild(el("h2", "", "Dungeon Crawler World"));
    body.appendChild(
      el("div", "hint", "Eighteen floors, a timer on each, permadeath, and an audience of trillions who can see your health bar. There are no classes to pick yet — the dungeon did not ask what you wanted to be, it took whoever was outside. Eight questions about the hour before."),
    );
    const b = el("button", "act good", "Begin");
    b.addEventListener("click", next);
    body.appendChild(b);
  });
  steps.push(ask("What should the notifications call you?", "", "name", "Crawler"));
  steps.push(ask("What did you do for money?", "Be specific. Specific jobs make specific skills.", "job", "nothing in particular"));
  steps.push(ask("And when you weren't doing that?", "The dungeon does not care whether it sounds impressive.", "hobby", "nothing in particular"));
  steps.push(choose("Physically, honestly.", "body", [
    ["weak", "I got winded on stairs"], ["average", "Average. Unremarkable"],
    ["fit", "I trained a few times a week"], ["strong", "Strength was the whole point"],
  ]));
  steps.push(choose("Something in your house breaks. You:", "mind", [
    ["low", "Call someone"], ["mid", "Look it up and have a go"],
    ["high", "Take it apart to see how it failed"], ["vhigh", "Already knew why it broke"],
  ]));
  steps.push(choose("A room full of strangers. You:", "people", [
    ["low", "Find a wall and hold it"], ["mid", "Talk to two people, leave early"],
    ["high", "Work the room"], ["vhigh", "By the end, it is my room"],
  ]));
  steps.push(choose("It happened at three in the morning. You were:", "dress", [
    ["underdressed", "Outside in my underwear"], ["bed", "In what I sleep in, barefoot"],
    ["casual", "Dressed. Shoes on"], ["work", "In work clothes, mid-shift"],
  ]));
  steps.push(() => {
    body.appendChild(el("h2", "", "What was actually on you?"));
    const chosen = new Set<string>();
    for (const opt of ["phone", "keys", "lighter", "food", "tools", "weapon"]) {
      const b = el("button", "act", opt);
      b.addEventListener("click", () => {
        if (chosen.has(opt)) {
          chosen.delete(opt);
          b.classList.remove("on");
        } else {
          chosen.add(opt);
          b.classList.add("on");
        }
      });
      body.appendChild(b);
    }
    const done = el("button", "act good", "Next");
    done.addEventListener("click", () => {
      INTAKE.carried = [...chosen];
      next();
    });
    body.appendChild(done);
  });
  steps.push(choose("Who came down with you?", "companion", [
    ["none", "Nobody. I was alone"], ["cat", "A cat"], ["dog", "A dog"], ["person", "Another person"],
  ]));

  next();
}

/* --------------------------------------------------------------- boot */

async function begin(seed: number, intake: Partial<Intake>): Promise<void> {
  game = Game.create(seed, intake);
  restoreProposer(game);
  $("#feed").replaceChildren();
  const first = await game.execute({ t: "look" });
  for (const l of first.lines) line(l);
  save();
  draw();
}

function wire(): void {
  $("#send").addEventListener("click", submit);
  const input = $("#input") as HTMLInputElement;
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") submit();
  });
  $("#sheet-close").addEventListener("click", closeSheet);
  // A 33px Close button was the only exit. Give it two more.
  document.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") closeSheet();
  });
  $("#sheet").addEventListener("click", (e) => {
    if (e.target === $("#sheet")) closeSheet();
  });
  $("#tab-inv").addEventListener("click", () => openSheet("§7 The manifest", drawInventory));
  $("#tab-sheet").addEventListener("click", () => openSheet("§3 Personnel file", drawSheet));
  $("#tab-skills").addEventListener("click", () => openSheet("§5 Competencies", drawSkills));
  $("#tab-spells").addEventListener("click", () => openSheet("§6 Permitted workings", drawSpells));
  $("#tab-map").addEventListener("click", () => openSheet("§1 The survey", drawMap));
  $("#tab-craft").addEventListener("click", () => openSheet("§8 Works and materials", drawWorkshop));
  $("#tab-menu").addEventListener("click", () => openSheet("§12 Administration", drawMenu));
}

function submit(): void {
  const input = $("#input") as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  line({ channel: "system", text: `› ${text}` });
  // Everything typed goes through the interpreter, which finds the nearest
  // legal reading and says what it understood.
  void run({ t: "improvise", text });
}

function drawMenu(body: HTMLElement): void {
  body.appendChild(el("div", "hint", "The run saves after every action, on this device."));
  const exp = el("button", "act", "Copy save to clipboard");
  exp.addEventListener("click", () => {
    const text = JSON.stringify(game!.save());
    // Never claim this worked without knowing it did. Somebody who believes
    // they have a backup is one tap from "Abandon this crawler".
    const fallback = () => {
      body.appendChild(el("div", "hint", "The clipboard is not available here. Select the text below and copy it by hand."));
      const area = el("textarea", "field") as HTMLTextAreaElement;
      area.value = text;
      area.readOnly = true;
      body.appendChild(area);
      area.focus();
      area.select();
    };
    if (!navigator.clipboard?.writeText) return fallback();
    navigator.clipboard.writeText(text).then(
      () => toast("Copied. Paste it somewhere safe."),
      () => fallback(),
    );
  });
  body.appendChild(exp);

  const imp = el("button", "act", "Paste a save in");
  imp.addEventListener("click", () => {
    const area = el("textarea", "field") as HTMLTextAreaElement;
    area.placeholder = "Paste an exported run here";
    body.appendChild(area);
    const go = el("button", "act good", "Load it");
    go.addEventListener("click", () => {
      try {
        game = Game.load(JSON.parse(area.value) as GameState);
        restoreProposer(game);
        save();
        closeSheet();
        $("#feed").replaceChildren();
        say("Run loaded.", "good");
        draw();
      } catch {
        toast("That would not parse.");
      }
    });
    body.appendChild(go);
  });
  body.appendChild(imp);

  /* ---------------------------------------------------- the DM seat */

  body.appendChild(el("div", "sect", "dungeon master"));
  body.appendChild(el("div", "hint",
    "Optional. The game reads plain English on its own and every process it knows works with nothing attached — " +
    "this only widens the range of SENTENCES it can read. Whatever a model proposes, the engine still prices: " +
    "it cannot write a damage number, invent a property, or bill you for something you are not carrying.",
  ));

  if (!canReachTheNetwork()) {
    body.appendChild(el("div", "hint",
      "This page is embedded somewhere that blocks outbound requests entirely, so a key would not reach anything. " +
      "Open the standalone build if you want this.",
    ));
  } else {
    const stored = localStorage.getItem(DM_KEY) ?? "";
    body.appendChild(el("div", "hint", stored
      ? "A key is stored on this device only. It is never sent anywhere but Anthropic."
      : "Paste an Anthropic API key. Stored on this device only, in this browser, and sent nowhere else."));

    const key = el("input", "field") as HTMLInputElement;
    key.type = "password";
    key.placeholder = stored ? "•••• stored — paste a new one to replace it" : "sk-ant-...";
    key.autocomplete = "off";
    body.appendChild(key);

    const on = el("button", "act good", stored ? "Replace the key" : "Turn it on");
    on.addEventListener("click", () => {
      const v = key.value.trim();
      if (!v) return toast("Nothing pasted.");
      localStorage.setItem(DM_KEY, v);
      if (game) game.proposer = new LlmProposer({ apiKey: v, browser: true });
      key.value = "";
      toast("Dungeon Master on.");
    });
    body.appendChild(on);

    if (stored) {
      const off = el("button", "act", "Forget the key");
      off.addEventListener("click", () => {
        localStorage.removeItem(DM_KEY);
        if (game) game.proposer = new NoProposer();
        closeSheet();
        toast("Key deleted from this device.");
      });
      body.appendChild(off);
    }
  }

  body.appendChild(el("div", "sect", ""));
  const nb = el("button", "act danger", "Abandon this crawler");
  nb.addEventListener("click", () => {
    if (!confirm("Delete this run? There is no second copy.")) return;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });
  body.appendChild(nb);
}

/**
 * Work out what kind of page this is before anything paints.
 *
 * Two things the document cannot assume when a host has wrapped it: that its
 * `<meta name="viewport">` survived being moved into the body (it does not
 * count there), and that it owns the window at all.
 */
function situate(): void {
  const root = document.documentElement;

  // A viewport meta only counts in the head. Without one iOS lays the page out
  // at 980px and shows you the left half of it.
  if (!document.querySelector("head meta[name=viewport]")) {
    const m = document.createElement("meta");
    m.name = "viewport";
    m.content = "width=device-width, initial-scale=1, viewport-fit=cover";
    document.head.appendChild(m);
  }

  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true; // cross-origin parent — framed by definition
  }
  root.classList.toggle("framed", framed);

  if (framed) {
    // Viewport units are useless here. A host that sizes its frame from our
    // scrollHeight, while we size ourselves from the frame, is a fixed point
    // at whatever height it opened with — measured: stuck at 300px forever,
    // with a 155px feed. `screen` is the one height that is not part of that
    // loop, because it describes the device rather than the box.
    const device = window.screen?.availHeight || window.screen?.height || 800;
    const h = Math.round(Math.max(560, Math.min(device, 1000)));
    root.style.setProperty("--framed-height", `${h}px`);
  }
}

export function boot(): void {
  situate();
  wire();
  const saved = loadSaved();
  if (saved && saved.crawler) {
    game = Game.load(saved);
    restoreProposer(game);
    say(`Resumed. ${saved.crawler.name}, floor ${saved.floor.n}.`, "good");
    draw();
  } else {
    startIntake();
  }
}

declare global {
  interface Window {
    __dcwBoot?: () => void;
  }
}
window.__dcwBoot = boot;
