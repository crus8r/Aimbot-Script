import { Game, type Command } from "../sim/game.ts";
import type { GameState, Item } from "../core/types.ts";
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

function line(l: RenderedLine): void {
  const feed = $("#feed");
  const node = el("div", `line ${l.channel}`);
  node.textContent = l.text;
  feed.appendChild(node);
  while (feed.childElementCount > 400) feed.removeChild(feed.firstChild!);
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

function bar(value: number, max: number): string {
  return `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
}

function draw(): void {
  if (!game) return;
  const s = game.state;
  const c = s.crawler;
  const d = derive(s);

  $("#name").textContent = c.name;
  $("#sub").textContent =
    `lv ${c.level} · ${c.className ?? c.race ?? "unraced"} · ${c.gold}g` +
    (c.stars.length ? ` · ${"★".repeat(Math.min(5, c.stars.length))}` : "");

  ($("#hp-fill") as HTMLElement).style.width = bar(c.hp, d.hpMax);
  $("#hp-text").textContent = `${Math.round(c.hp)}/${d.hpMax}`;
  ($("#mp-fill") as HTMLElement).style.width = bar(c.mana, Math.max(1, d.manaMax));
  $("#mp-text").textContent = `${Math.round(c.mana)}/${d.manaMax}`;

  const clock = s.floor.hoursLeft;
  const clockEl = $("#clock");
  clockEl.textContent = `F${s.floor.n} · ${clock.toFixed(1)}h`;
  clockEl.className = clock < 6 ? "clock urgent" : clock < 18 ? "clock warn" : "clock";

  const chips = $("#chips");
  chips.replaceChildren();
  const chip = (text: string, cls = "") => chips.appendChild(el("span", `chip ${cls}`, text));
  for (const st of c.statuses) chip(st.name, st.bad ? "bad" : "good");
  if (c.fatigue > 60) chip(`fatigue ${Math.round(c.fatigue)}`, c.fatigue > 85 ? "bad" : "");
  if (c.hunger > 60) chip(`hunger ${Math.round(c.hunger)}`, c.hunger > 85 ? "bad" : "");
  if (s.boxes.length) chip(`${s.boxes.length} boxes`, "loot");
  if (c.points) chip(`${c.points} points`, "good");
  if (s.offers.length) chip("sponsor offer", "loot");
  if (!s.restores.room && !s.restores.floor) chip("no backloads left", "bad");

  $("#where").textContent = currentNode(s.floor).name;
  drawActions();

  if (!c.alive) drawDeath();
}

/* ------------------------------------------------------------ actions */

function actionBtn(label: string, cmd: Command, cls = ""): HTMLElement {
  const b = el("button", `act ${cls}`, label);
  b.addEventListener("click", () => void run(cmd));
  return b;
}

function drawActions(): void {
  const s = game!.state;
  const box = $("#actions");
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
      box.appendChild(actionBtn("Set an ambush", { t: "prep", what: "ambush" }, "good"));
      box.appendChild(actionBtn("Rig a trap", { t: "prep", what: "trap" }));
      box.appendChild(actionBtn("Barricade", { t: "prep", what: "barricade" }));
    }
    box.appendChild(actionBtn("Engage", { t: "engage" }, "danger"));
    const boss = node.boss && !s.floor.bossesKilled.includes(node.boss) ? BOSS_BY_ID[node.boss] : null;
    if (boss) box.appendChild(el("div", "hint", `${boss.name} — ${boss.rank} boss, ${boss.size}. ${boss.weakness}`));
  } else {
    if (!node.searched) box.appendChild(actionBtn("Search", { t: "search" }));
    if (node.hasStairs && s.floor.stairsAnnounced) {
      box.appendChild(actionBtn("Descend", { t: "descend" }, "good"));
    }
  }

  if (safe) {
    if (s.boxes.length) box.appendChild(actionBtn(`Open ${s.boxes.length} boxes`, { t: "open" }, "loot"));
    if (s.crawler.hunger > 30) box.appendChild(actionBtn("Eat", { t: "eat" }));
    box.appendChild(actionBtn("Sleep (7h)", { t: "rest" }));
    box.appendChild(sheetBtn("Workshop", drawWorkshop));
    if (node.kind === "shop" || node.kind === "guild") box.appendChild(actionBtn("Shop", { t: "shop" }));
    box.appendChild(sheetBtn("Your room", drawSpace));
    if (s.crawler.points > 0) box.appendChild(sheetBtn(`Spend ${s.crawler.points} points`, drawSpend, "good"));
    if (node.kind === "guild" && s.floor.n >= 3 && !s.crawler.race) {
      box.appendChild(sheetBtn("Choose what you are", drawChoose, "loot"));
    }
  }
  if (node.kind === "shop") box.appendChild(actionBtn("Shop", { t: "shop" }));

  box.appendChild(el("div", "sep", "go"));
  for (const l of node.links) {
    const n = s.floor.nodes[l.to]!;
    const known = n.visited || s.flags[`scouted_${n.id}`] === true;
    const label = known ? n.name.replace(/^the /, "") : "unexplored";
    const marks: string[] = [`${l.minutes}m`];
    if (known && n.hasStairs && s.floor.stairsAnnounced) marks.push("stairs");
    if (known && n.kind === "safe_room") marks.push("safe");
    if (known && n.kind === "guild") marks.push("guild");
    if (known && n.kind === "shop") marks.push("shop");
    const row = el("div", "gorow");
    row.appendChild(actionBtn(`${label} (${marks.join(", ")})`, { t: "go", to: l.to }, known ? "" : "unknown"));
    if (!known) row.appendChild(actionBtn("look", { t: "scout", node: l.to }, "small"));
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
    const track = el("div", "minibar");
    const fill = el("div", "minifill");
    (fill as HTMLElement).style.width = bar(f.hp, f.hpMax);
    track.appendChild(fill);
    wrap.appendChild(track);
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

  const row = el("div", "actrow");
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

function sheetBtn(label: string, render: (body: HTMLElement) => void, cls = ""): HTMLElement {
  const b = el("button", `act ${cls}`, label);
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

function drawInventory(body: HTMLElement): void {
  const s = game!.state;
  const tools = el("div", "actrow");
  tools.appendChild(actionBtn("Equip best", { t: "equipBest" }, "small good"));
  tools.appendChild(actionBtn("Drop junk", { t: "dropJunk" }, "small"));
  const node = currentNode(s.floor);
  if (node.kind === "shop" || node.kind === "guild") {
    tools.appendChild(actionBtn("Sell junk", { t: "sell", what: "junk" }, "small loot"));
  }
  body.appendChild(tools);
  body.appendChild(el("div", "hint", `${carriedWeight(s)} kg carried · lift ceiling ${carryCapacity(s)} kg`));

  const worn = s.inventory.filter((i) => i.equipped);
  if (worn.length) {
    body.appendChild(el("div", "sep", "worn"));
    for (const i of worn) row(body, i.name, i.slot ?? "", i.desc);
  }
  body.appendChild(el("div", "sep", "carried"));
  const rest = s.inventory.filter((i) => !i.equipped);
  if (!rest.length) body.appendChild(el("div", "hint", "Nothing."));
  for (const i of rest) {
    const r = el("div", `srow r-${i.rarity}`);
    r.appendChild(el("span", "sleft", `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.locked ? " 🔒" : ""}`));
    const btns = el("span", "sright");
    if (i.slot) btns.appendChild(actionBtn("wear", { t: "equip", item: i.iid }, "small"));
    if (i.use) btns.appendChild(actionBtn("use", { t: "use", item: i.iid }, "small"));
    if (node.kind === "shop" || node.kind === "guild") {
      btns.appendChild(actionBtn("sell", { t: "sell", what: i.iid }, "small"));
    }
    btns.appendChild(actionBtn(i.locked ? "unlock" : "lock", { t: "lock", item: i.iid }, "small"));
    r.appendChild(btns);
    body.appendChild(r);
    body.appendChild(el("div", "hint", i.desc));
  }
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
    body.appendChild(el("div", "sep", "being counted"));
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
  body.appendChild(el("div", "sep", "you know how to build"));
  for (const r of RECIPES.filter((x) => s.recipes.includes(x.id))) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", r.name));
    rr.appendChild(actionBtn("build", { t: "craft", what: r.id }, "small good"));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${r.materials.map((m) => `${m.qty}× ${m.id}`).join(", ")}${r.station ? ` · needs ${r.station}` : ""}`));
  }
  body.appendChild(el("div", "sep", "supplies"));
  for (const b of BREWS) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", b.name));
    rr.appendChild(actionBtn("brew", { t: "brew", what: b.id }, "small"));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${b.materials.map((m) => `${m.qty}× ${m.id}`).join(", ")} · needs ${b.station}`));
  }
}

function drawSpace(body: HTMLElement): void {
  const s = game!.state;
  if (!s.space.owned) {
    body.appendChild(el("div", "hint", `A room of your own, off every safe room on every floor. ${SPACE_COST} gold. You have ${s.crawler.gold}.`));
    body.appendChild(actionBtn(`Buy it (${SPACE_COST}g)`, { t: "buySpace" }, "loot"));
    return;
  }
  body.appendChild(el("div", "sep", "benches"));
  for (const st of STATIONS) {
    const owned = s.space.stations.includes(st.id);
    const r = el("div", "srow");
    r.appendChild(el("span", "sleft", st.name));
    if (owned) r.appendChild(el("span", "sright", "installed"));
    else r.appendChild(actionBtn(`${st.cost}g`, { t: "install", what: st.id }, "small loot"));
    body.appendChild(r);
    body.appendChild(el("div", "hint", st.desc));
  }
  body.appendChild(el("div", "sep", "the room itself"));
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
  body.appendChild(el("div", "sep", "race"));
  for (const r of RACES) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", r.name));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${r.note} ${r.pros} — ${r.cons}`));
  }
  body.appendChild(el("div", "sep", "class"));
  body.appendChild(el("div", "hint", "Most of this list was assembled from your own record and is not on anybody else's."));
  for (const o of game!.classOptions()) {
    const rr = el("div", "srow");
    rr.appendChild(el("span", "sleft", `${o.name}${o.generated ? "  ✦" : ""}${o.recommended ? "  ★" : ""}`));
    body.appendChild(rr);
    body.appendChild(el("div", "hint", `${o.note} Requires ${Object.entries(o.req).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(", ")}. ${o.pros}`));
    const picks = el("div", "actrow");
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

function drawSheet(body: HTMLElement): void {
  const s = game!.state;
  const d = derive(s);
  row(body, "Level", String(s.crawler.level));
  for (const [k, label] of [["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"], ["int", "Intelligence"], ["cha", "Charisma"]] as const) {
    row(body, label, String(d.stats[k]));
  }
  row(body, "Accuracy", `+${d.accuracy}`);
  row(body, "Defence", String(d.defense));
  row(body, "Armour", String(d.armor));
  row(body, "Weapon", `${d.weaponDamage}+${d.damageBonus} — ${d.weaponName}`);
  row(body, "Views", s.ratings.views.toLocaleString());
  row(body, "Bounty", s.crawler.bounty.toLocaleString());
  row(body, "Backloads", `${[s.restores.room && "room", s.restores.floor && "floor"].filter(Boolean).join(", ") || "none left"}`);
  if (s.sponsors.length) {
    body.appendChild(el("div", "sep", "patrons"));
    for (const sp of s.sponsors) row(body, sp.name, sp.strikes ? `${sp.strikes} strike` : "", sp.clause);
  }
  if (s.companions.length) {
    body.appendChild(el("div", "sep", "party"));
    for (const cm of s.companions) {
      row(body, cm.alive ? cm.name : `${cm.name} — dead`, cm.alive ? `${Math.round(cm.hp)}/${cm.hpMax}` : "");
      if (cm.alive) {
        const picks = el("div", "actrow");
        for (const st of ["aggressive", "defensive", "support", "hide"] as const) {
          picks.appendChild(actionBtn(st, { t: "stance", who: cm.name, stance: st }, "small"));
        }
        body.appendChild(picks);
      }
    }
  }
  body.appendChild(el("div", "sep", "the run"));
  body.appendChild(el("div", "hint", `Seed ${s.seed}. The whole run replays from that number.`));
}

/* ---------------------------------------------------------------- death */

function drawDeath(): void {
  const s = game!.state;
  openSheet("Crawler terminated", (body) => {
    body.appendChild(el("div", "death", s.crawler.name));
    body.appendChild(
      el("div", "hint", `Level ${s.crawler.level}, floor ${s.floor.n}, after ${s.elapsed.toFixed(1)} hours. ${s.crawler.death?.cause ?? ""}`),
    );
    if (s.pendingDeath?.outs.length) {
      body.appendChild(el("div", "sep", "for the record"));
      for (const o of s.pendingDeath.outs) body.appendChild(el("div", "hint", o));
    }

    const canRoom = game!.canRestore("room");
    const canFloor = game!.canRestore("floor");
    if (canRoom || canFloor) {
      body.appendChild(el("div", "sep", "backloads"));
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
      body.appendChild(el("div", "sep", "that is the run"));
      body.appendChild(el("div", "hint", "No backloads left. The feed has cut to a sponsor message."));
    }

    body.appendChild(el("div", "sep", ""));
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
  $("#tab-inv").addEventListener("click", () => openSheet("Inventory", drawInventory));
  $("#tab-sheet").addEventListener("click", () => openSheet("Crawler", drawSheet));
  $("#tab-skills").addEventListener("click", () => openSheet("Skills", drawSkills));
  $("#tab-spells").addEventListener("click", () => openSheet("Spells", drawSpells));
  $("#tab-map").addEventListener("click", () => openSheet("Floor", drawMap));
  $("#tab-craft").addEventListener("click", () => openSheet("Workshop", drawWorkshop));
  $("#tab-menu").addEventListener("click", () => openSheet("Menu", drawMenu));
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

  body.appendChild(el("div", "sep", ""));
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
