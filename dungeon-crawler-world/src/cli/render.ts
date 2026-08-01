import type { GameState, Item, MapNode } from "../core/types.ts";
import { SLOT_LABEL, SLOTS } from "../core/types.ts";
import type { RenderedLine } from "../voice/narrator.ts";
import { derive, carryCapacity, carriedWeight } from "../sim/character.ts";
import { currentNode } from "../sim/map.ts";
import { crawlerOf, living, zoneDistance, zoneOf } from "../sim/tactics.ts";
import { bar, hours as fmtHours } from "../core/util.ts";
import { SKILL_BY_ID } from "../data/skills.ts";
import { PRACTICE_BY_ID } from "../data/emergent.ts";
import { HOOK_LABEL } from "../core/hooks.ts";
import { BOX_BY_ID } from "../data/boxes.ts";
import { MOB_BY_ID, BOSS_BY_ID } from "../data/mobs.ts";

/**
 * The terminal presentation.
 *
 * Design brief: the HUD is alien corporate telemetry painted over somebody's
 * field of vision, so it is monospaced and amber — the colour of a warning
 * label. The prose is the only part of this that is for the player, so it gets
 * left alone. The signature element is the system notification: an amber rule,
 * a hard edge, and it arrives whether you wanted it or not.
 */

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);

export const dim = c("38;5;244");
export const amber = c("38;5;214");
export const blood = c("38;5;167");
export const jade = c("38;5;71");
export const ice = c("38;5;74");
export const signal = c("38;5;176");
export const bone = c("38;5;253");
export const bold = c("1");

const RARITY_COLOUR: Record<string, (s: string) => string> = {
  junk: dim,
  common: bone,
  uncommon: jade,
  rare: ice,
  epic: signal,
  legendary: amber,
  celestial: bold,
};

export const width = (): number => Math.min(Math.max(process.stdout.columns ?? 80, 60), 100);

export function rule(label = ""): string {
  const w = width();
  if (!label) return dim("─".repeat(w));
  const text = ` ${label} `;
  return dim("─".repeat(2) + text + "─".repeat(Math.max(0, w - text.length - 2)));
}

export function wrap(text: string, indent = 0): string {
  const w = width() - indent;
  const pad = " ".repeat(indent);
  return text
    .split("\n")
    .map((para) => {
      if (!para.trim()) return "";
      const words = para.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        if (line.length + word.length + 1 > w) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) lines.push(line);
      return lines.map((l) => pad + l).join("\n");
    })
    .join("\n");
}

/* ------------------------------------------------------------------ HUD */

export function hud(state: GameState): string {
  const s = state.crawler;
  const d = derive(state);
  const node = currentNode(state.floor);
  const out: string[] = [];

  const stars = s.stars.length ? amber(" ★".repeat(s.stars.length)) : "";
  const title = `${bold(bone(s.name))} ${dim("#" + s.number)}  ${amber(`lv ${s.level}`)}${stars}`;
  const identity = [s.race, s.klass].filter(Boolean).join(" ") || dim("unraced");
  out.push(`${title}  ${dim(identity)}  ${amber(`${s.gold}g`)}`);

  const hpBar = blood(bar(s.hp, d.hpMax, 18));
  const mpBar = ice(bar(s.mana, Math.max(1, d.manaMax), 10));
  const stBar = amber(bar(s.stamina, d.staminaMax, 10));
  out.push(
    `  ${hpBar} ${String(Math.round(s.hp)).padStart(4)}/${d.hpMax}   ` +
      `${mpBar} ${Math.round(s.mana)}/${d.manaMax} mp   ` +
      `${stBar} ${Math.round(s.stamina)}/${d.staminaMax} st`,
  );

  const clock = state.floor.hoursLeft;
  const clockColour = clock < 6 ? blood : clock < 18 ? amber : dim;
  out.push(
    `  ${dim("floor")} ${bone(String(state.floor.n))} ${dim(state.floor.name)}   ` +
      `${clockColour(`${clock.toFixed(1)}h to collapse`)}   ` +
      `${dim(timeOfDay(state))}`,
  );

  const body: string[] = [];
  if (s.fatigue > 55) body.push((s.fatigue > 85 ? blood : amber)(`fatigue ${Math.round(s.fatigue)}`));
  if (s.hunger > 55) body.push((s.hunger > 85 ? blood : amber)(`hunger ${Math.round(s.hunger)}`));
  for (const st of s.statuses) body.push((st.bad ? blood : jade)(st.name.toLowerCase()));
  if (state.boxes.length) body.push(signal(`${state.boxes.length} unopened ${state.boxes.length === 1 ? "box" : "boxes"}`));
  if (s.points > 0) body.push(jade(`${s.points} points to spend`));
  if (state.offers.length) body.push(signal(`${state.offers.length} sponsor offer`));
  if (body.length) out.push("  " + body.join(dim(" · ")));

  out.push(`  ${dim("at")} ${bone(node.name)}`);
  return out.join("\n");
}

function timeOfDay(state: GameState): string {
  const h = Math.floor((3 + state.elapsed) % 24);
  const band =
    h < 5 ? "the small hours" : h < 8 ? "early" : h < 12 ? "morning" : h < 14 ? "midday"
      : h < 18 ? "afternoon" : h < 21 ? "evening" : "night";
  return `${String(h).padStart(2, "0")}:00, ${band}`;
}

/* ---------------------------------------------------------------- lines */

export function renderLines(lines: readonly RenderedLine[]): string {
  const out: string[] = [];
  for (const l of lines) {
    if (!l.text.trim()) continue;
    switch (l.channel) {
      case "narration":
        out.push(wrap(l.text));
        out.push("");
        break;
      case "system":
        out.push(`${amber("│")} ${wrap(dim(l.text), 2).trimStart()}`);
        break;
      case "good":
        out.push(`${jade("│")} ${wrap(l.text, 2).trimStart()}`);
        break;
      case "bad":
        out.push(`${blood("│")} ${wrap(l.text, 2).trimStart()}`);
        break;
      case "loot":
        out.push(`${signal("│")} ${wrap(signal(l.text), 2).trimStart()}`);
        break;
      case "show":
        out.push(`${signal("│")} ${wrap(dim(l.text), 2).trimStart()}`);
        break;
    }
  }
  return out.join("\n");
}

/* -------------------------------------------------------------- combat */

export function combatView(state: GameState): string {
  const enc = state.encounter;
  if (!enc || enc.finished) return "";
  const node = state.floor.nodes[enc.nodeId]!;
  const me = crawlerOf(enc);
  const out: string[] = [rule(`round ${enc.round}`)];

  // The room, drawn as positions. Where you are standing is the decision.
  for (const z of node.zones) {
    const here = z.id === me.zone;
    const occupants = living(enc).filter((x) => x.zone === z.id);
    const tags: string[] = [];
    if (z.capacity <= 1) tags.push("choke·1");
    else if (z.capacity <= 2) tags.push(`choke·${z.capacity}`);
    if (z.tags.includes("cover")) tags.push("cover");
    if (z.tags.includes("high")) tags.push("high");
    if (z.tags.includes("water")) tags.push("water");
    if (z.tags.includes("flammable")) tags.push("flammable");
    if (z.barricaded) tags.push("barricaded");
    if (z.traps.length) tags.push(`${z.traps.length} trap`);
    if (z.hazard) tags.push(`${z.hazard.kind}!`);

    const marker = here ? amber("▶") : dim(" ");
    const dist = zoneDistance(node, me.zone, z.id);
    const label = here ? bone(z.name) : dim(z.name);
    const who = occupants
      .map((o) =>
        o.side === "hostile"
          ? blood(o.name)
          : o.side === "crawler"
            ? amber("you")
            : jade(o.name),
      )
      .join(dim(", "));
    out.push(
      `${marker} ${label}${tags.length ? dim(` [${tags.join(" ")}]`) : ""}` +
        `${dist > 0 ? dim(`  ${dist} away`) : ""}` +
        `${who ? `\n    ${who}` : ""}`,
    );
    const feats = z.features.filter((f) => !f.spent);
    if (feats.length) {
      out.push(dim(`    ✦ ${feats.map((f) => f.name).join(", ")}`));
    }
  }

  out.push("");
  const foes = living(enc, "hostile");
  foes.forEach((h, i) => {
    const frac = h.hp / h.hpMax;
    const colour = frac > 0.6 ? bone : frac > 0.25 ? amber : blood;
    const reach = zoneDistance(node, me.zone, h.zone) <= me.reach ? jade("in reach") : dim("out of reach");
    const extras = [
      h.hidden ? dim("hidden") : "",
      h.fleeing ? amber("breaking") : "",
      ...h.statuses.map((st) => (st.bad ? blood(st.name.toLowerCase()) : jade(st.name.toLowerCase()))),
    ].filter(Boolean);
    out.push(
      `  ${dim(`${i + 1})`)} ${colour(h.name)} ${dim(`lv${h.level}`)} ` +
        `${blood(bar(h.hp, h.hpMax, 10))} ${Math.round(h.hp)}/${h.hpMax}  ${reach}` +
        (extras.length ? "  " + extras.join(dim("·")) : ""),
    );
  });

  const allies = living(enc, "ally");
  for (const a of allies) {
    out.push(`  ${jade(a.name)} ${jade(bar(a.hp, a.hpMax, 8))} ${Math.round(a.hp)}/${a.hpMax}`);
  }

  out.push("");
  out.push(
    dim("  actions: ") +
      (enc.actions.move > 0 ? jade(`move ×${enc.actions.move}`) : dim("move spent")) +
      dim(" | ") +
      (enc.actions.act > 0 ? jade("action available") : dim("action spent")),
  );
  return out.join("\n");
}

/* ----------------------------------------------------------- exploring */

export function roomView(state: GameState): string {
  const node = currentNode(state.floor);
  const out: string[] = [rule(node.name)];

  if (node.note) out.push(wrap(dim(node.note), 2));

  const hostile = !node.cleared && (node.spawn.length > 0 || (node.boss && !state.floor.bossesKilled.includes(node.boss)));
  if (hostile) {
    const what: string[] = [];
    for (const g of node.spawn) {
      const def = MOB_BY_ID[g.mob];
      if (def) what.push(`${g.count} × ${def.name}${g.level ? ` (lv ${g.level})` : ""}`);
    }
    if (node.boss && !state.floor.bossesKilled.includes(node.boss)) {
      const b = BOSS_BY_ID[node.boss];
      if (b) what.unshift(blood(`${b.name} — ${b.rank} boss, ${b.size}`));
    }
    const known = state.flags[`scouted_${node.id}`] === true;
    out.push(
      "  " +
        (known || node.visited
          ? blood(`Hostile: ${what.join(", ")}`)
          : blood("Something is in here with you.")),
    );
    if (state.flags.undetected) {
      out.push("  " + jade("They have not seen you yet.") + dim("  (prep ambush / prep trap / engage / go back)"));
    }
  }

  const feats = node.zones.flatMap((z) => z.features.filter((f) => !f.spent).map((f) => ({ f, z })));
  if (feats.length) {
    out.push(dim("  ✦ " + feats.map(({ f, z }) => `${f.name} (${z.name})`).join(dim(" · "))));
  }

  if (node.hasStairs && state.floor.stairsAnnounced) {
    out.push("  " + amber("There is a stairwell here. `descend` when you are ready."));
  }
  if (node.loot.length && !node.searched) {
    out.push(dim("  Not searched."));
  }

  out.push("");
  out.push(dim("  exits:"));
  for (const l of currentNode(state.floor).links) {
    const n = state.floor.nodes[l.to]!;
    const seen = n.visited;
    const scouted = state.flags[`scouted_${n.id}`] === true;
    const label = seen || scouted ? bone(n.name) : dim("somewhere you have not been");
    const marks: string[] = [`${l.minutes}m`];
    if (n.hasStairs && state.floor.stairsAnnounced && (seen || scouted)) marks.push(amber("stairs"));
    if (n.kind === "safe_room" && (seen || scouted)) marks.push(jade("safe room"));
    if (n.kind === "guild" && (seen || scouted)) marks.push(jade("guild hall"));
    if (n.cleared && seen) marks.push(dim("cleared"));
    out.push(`    ${amber(n.id)}  ${label} ${dim(`(${marks.join(", ")})`)}`);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------ sheets */

export function sheet(state: GameState): string {
  const s = state.crawler;
  const d = derive(state);
  const out: string[] = [rule("crawler")];
  out.push(
    `  ${bone(s.name)}, crawler #${s.number} · level ${s.level} (${s.xp} xp) · ` +
      `${s.race ?? dim("unraced")} ${s.klass ?? ""}`,
  );
  out.push(
    `  STR ${pad(d.stats.str)}  DEX ${pad(d.stats.dex)}  CON ${pad(d.stats.con)}  ` +
      `INT ${pad(d.stats.int)}  CHA ${pad(d.stats.cha)}` +
      (s.points ? jade(`   ${s.points} unspent`) : "") +
      (s.banked ? dim(`   ${s.banked} banked until the third floor`) : ""),
  );
  out.push(
    `  accuracy ${sign(d.accuracy)}  defence ${d.defense}  armour ${d.armor}  ` +
      `damage ${d.weaponDamage}${d.damageBonus ? sign(d.damageBonus) : ""} with ${d.weaponName}` +
      (d.reach > 1 ? dim(`  (reach ${d.reach})`) : ""),
  );
  out.push(
    dim(`  lift ceiling ${carryCapacity(state)} kg — carrying ${carriedWeight(state)} kg across ${state.inventory.length} things. No slot limit; Strength is the only gate.`),
  );

  out.push("");
  out.push(dim("  skills"));
  const skills = Object.entries(state.skills).sort((a, b) => b[1].level - a[1].level);
  if (!skills.length) out.push(dim("    none"));
  for (const [id, k] of skills) {
    const def = SKILL_BY_ID[id];
    out.push(`    ${bone((def?.name ?? id).padEnd(18))} ${amber(String(k.level).padStart(2))}  ${dim((def?.desc ?? "").slice(0, width() - 30))}`);
  }

  out.push("");
  out.push(dim("  the show"));
  out.push(
    `    ${state.ratings.views.toLocaleString()} views · ${state.ratings.followers.toLocaleString()} followers · ` +
      `bounty ${blood(state.crawler.bounty.toLocaleString())}`,
  );
  if (state.sponsors.length) {
    for (const sp of state.sponsors) {
      out.push(`    ${signal(sp.name)} ${dim(`— ${sp.clause}${sp.strikes ? ` (${sp.strikes} strike)` : ""}`)}`);
    }
  }
  if (state.companions.length) {
    out.push("");
    out.push(dim("  party"));
    for (const comp of state.companions) {
      out.push(
        `    ${comp.alive ? jade(comp.name) : blood(comp.name + " — dead")} ${dim(comp.species)} ` +
          (comp.alive ? `${Math.round(comp.hp)}/${comp.hpMax} ${dim(comp.stance)}` : ""),
      );
    }
  }
  if (state.achievements.length) {
    out.push("");
    out.push(dim(`  ${state.achievements.length} achievements: `) + state.achievements.map((a) => a.name).join(dim(" · ")));
  }
  return out.join("\n");
}

const pad = (n: number) => String(n).padStart(2);
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export type InvSort = "relevance" | "value" | "weight" | "rarity" | "name" | "recent";

export function inventoryView(state: GameState, filter = "all", sort: InvSort = "relevance"): string {
  const out: string[] = [rule("inventory")];
  const worn = SLOTS.map((slot) => {
    const item = state.inventory.find((i) => i.equipped && i.slot === slot);
    return `    ${dim(SLOT_LABEL[slot].padEnd(9))} ${item ? RARITY_COLOUR[item.rarity]!(item.name) : dim("—")}`;
  });
  out.push(dim("  worn"));
  out.push(...worn);
  out.push("");
  // Numbers are the crawler-facing handle: `use 4`, `equip 11`, `lock 2`.
  // After four floors of looting, nobody should be typing full item names.
  const numbered = state.inventory.map((item, n) => ({ item, n: n + 1 }));
  const matching = numbered.filter(({ item }) => !item.equipped && matchesFilter(item, filter));
  const ordered = sortItems(state, matching, sort);

  out.push(
    dim(`  carried — ${matching.length} of ${numbered.filter((x) => !x.item.equipped).length} shown`) +
      dim(`  [filter: ${filter} · sort: ${sort}]`),
  );
  if (!ordered.length) out.push(dim("    nothing here matches"));
  for (const { item: i, n } of ordered) {
    const colour = RARITY_COLOUR[i.rarity] ?? bone;
    const better = comparison(state, i);
    out.push(
      `  ${dim(String(n).padStart(3) + ")")} ${colour(i.name)}${i.qty > 1 ? amber(` ×${i.qty}`) : ""}` +
        (i.locked ? amber(" 🔒") : "") +
        dim(`  ${i.rarity} ${i.kind} · ${i.weight}kg · ${i.value}g`) +
        (better ? "  " + better : ""),
    );
    out.push(dim(wrap(i.desc, 8)));
  }
  if (state.boxes.length) {
    out.push("");
    out.push(dim("  unopened boxes ") + dim("(they open in a safe room, all at once, in tier order)"));
    for (const b of state.boxes) {
      out.push(`    ${amber(b.tier)} ${bone(BOX_BY_ID[b.type]?.name ?? b.type)} ${dim(`— ${b.why}`)}`);
    }
  }
  out.push("");
  out.push(dim(`  ${carriedWeight(state)} kg carried · lift ceiling ${carryCapacity(state)} kg`));
  out.push(dim("  inv <weapons|armour|consumables|materials|junk|new|all> · sort <value|weight|rarity|name|recent> · equip best · drop junk · lock <n>"));
  return out.join("\n");
}

function matchesFilter(item: Item, filter: string): boolean {
  switch (filter) {
    case "weapons":
      return item.kind === "weapon" || item.kind === "explosive";
    case "armour":
    case "armor":
      return item.kind === "armor" || item.kind === "jewelry";
    case "consumables":
      return item.kind === "potion" || item.kind === "food" || !!item.use;
    case "materials":
      return item.kind === "material" || item.tags.includes("craft");
    case "junk":
      return item.rarity === "junk" && !item.use;
    case "new":
      return item.rarity !== "junk";
    default:
      return true;
  }
}

function sortItems(
  state: GameState,
  rows: { item: Item; n: number }[],
  sort: InvSort,
): { item: Item; n: number }[] {
  const rarityRank = (i: Item) =>
    ["junk", "common", "uncommon", "rare", "epic", "legendary", "celestial"].indexOf(i.rarity);
  const copy = rows.slice();
  switch (sort) {
    case "value":
      return copy.sort((a, b) => b.item.value - a.item.value);
    case "weight":
      return copy.sort((a, b) => b.item.weight - a.item.weight);
    case "rarity":
      return copy.sort((a, b) => rarityRank(b.item) - rarityRank(a.item));
    case "name":
      return copy.sort((a, b) => a.item.name.localeCompare(b.item.name));
    case "recent":
      return copy.reverse();
    default: {
      // Relevance: things you could wear right now, then healing when hurt,
      // then rarity. Built for a bag with two hundred things in it.
      const hurt = state.crawler.hp / Math.max(1, state.crawler.hpMax) < 0.7;
      const score = (i: Item) => {
        let v = rarityRank(i) * 10;
        if (i.slot && !state.inventory.some((x) => x.equipped && x.slot === i.slot)) v += 60;
        if (hurt && i.use?.effect === "heal") v += 80;
        if (i.use) v += 20;
        if (i.rarity === "junk") v -= 40;
        return v;
      };
      return copy.sort((a, b) => score(b.item) - score(a.item));
    }
  }
}

/** A one-glance answer to "is this better than what I have on?". */
function comparison(state: GameState, item: Item): string {
  if (!item.slot) return "";
  const worn = state.inventory.find((i) => i.equipped && i.slot === item.slot);
  if (!worn) return jade("empty slot");
  const score = (i: Item) => {
    const mods = (i.mods ?? []).reduce((n, m) => n + (typeof (m as { v?: number }).v === "number" ? (m as { v: number }).v : 0), 0);
    const dice = i.damage ? (parseInt(i.damage.split("d")[0] || "1", 10) * (parseInt(i.damage.split("d")[1] || "4", 10) + 1)) / 2 : 0;
    return mods + dice * 1.6;
  };
  const delta = score(item) - score(worn);
  if (Math.abs(delta) < 0.5) return dim(`≈ ${worn.name}`);
  return delta > 0 ? jade(`▲ better than ${worn.name}`) : dim(`▼ worse than ${worn.name}`);
}

/** Skills, with the minted ones called out — they are the record of what this
 *  run turned this person into and they should read like it. */
export function skillsView(state: GameState): string {
  const out: string[] = [rule("what you can do")];
  const rows = Object.entries(state.skills).sort((a, b) => b[1].level - a[1].level);
  if (!rows.length) out.push(dim("  Nothing yet."));

  for (const [id, k] of rows) {
    const minted = state.minted[id];
    const def = SKILL_BY_ID[id];
    const name = minted?.name ?? def?.name ?? id;
    const cap = k.level >= state.crawler.skillCap ? blood(" at cap") : "";
    out.push(
      `  ${(minted ? signal : bone)(name.padEnd(22))} ${amber(String(k.level).padStart(2))}${cap}` +
        (minted ? signal("   ← this run made this one") : ""),
    );
    out.push(dim(wrap(minted?.desc ?? def?.desc ?? "", 6)));
    if (minted) {
      out.push(dim(wrap(minted.origin, 6)));
      out.push(jade(wrap(minted.hooks.map(HOOK_LABEL).join("; "), 6)));
    }
  }

  // What the dungeon is currently watching but has not committed to yet.
  const watching = Object.entries(state.practice)
    .filter(([id, n]) => n >= 2 && !state.minted[id])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  if (watching.length) {
    out.push("");
    out.push(dim("  the system is keeping a count of a few things and has not decided yet"));
    for (const [id, n] of watching) {
      const def = PRACTICE_BY_ID[id];
      if (!def) continue;
      out.push(dim(`    ${String(n).padStart(2)}/${def.threshold}  ${def.origin}`));
    }
  }
  return out.join("\n");
}

export function spellsView(state: GameState): string {
  const out: string[] = [rule("what you know")];
  const spells = Object.values(state.spellbook);
  const d = derive(state);
  out.push(
    dim(`  ${Math.round(state.crawler.mana)}/${d.manaMax} mana. The pool is your Intelligence, one for one, and it comes back at about ${Math.max(1, Math.round(d.stats.int * 3.6))} an hour — so a spell is a decision about the day, not about the round.`),
  );
  if (!spells.length) {
    out.push(dim("  Nothing. Spells come out of tomes, and tomes come out of boxes."));
    return out.join("\n");
  }
  for (const sp of spells) {
    const cd = state.cooldowns[sp.id];
    const afford = state.crawler.mana >= sp.mana;
    out.push(
      `  ${(sp.minted ? signal : bone)(sp.name.padEnd(30))} ${(afford ? amber : dim)(`${sp.mana} mana`)}` +
        (cd ? blood(`  ${cd} rounds`) : "") +
        (sp.minted ? signal("  ← nobody wrote this one down") : ""),
    );
    out.push(dim(wrap(sp.desc, 6)));
    out.push(dim(wrap(sp.effects.map(describeEffect).join("; "), 6)));
  }
  return out.join("\n");
}

function describeEffect(e: { k: string } & Record<string, unknown>): string {
  switch (e.k) {
    case "damage":
      return `${e.dice} ${e.tag ?? "force"} damage to ${e.scope === "zone" ? "everything in one position" : "one target"}`;
    case "heal":
      return `${e.dice} health back`;
    case "status":
      return `${e.id} on ${e.scope === "zone" ? "everything in a position" : "one target"} for ${e.turns} rounds`;
    case "buff":
      return `a hold-for-${e.turns}-rounds edge`;
    case "blink":
      return `move ${e.zones} positions instantly`;
    case "ward":
      return `+${e.v} defence for ${e.turns} rounds`;
    case "reveal":
      return "light, and the room stops keeping things back";
    default:
      return e.k as string;
  }
}

export function mapView(state: GameState): string {
  const floor = state.floor;
  const out: string[] = [rule(`floor ${floor.n} — ${floor.name}`)];
  const nodes = Object.values(floor.nodes);
  const seen = nodes.filter((n) => n.visited || n.sensed);
  out.push(
    dim(`  ${nodes.filter((n) => n.visited).length} of ${nodes.length} places entered · ` +
      `${floor.hoursLeft.toFixed(1)}h left of ${floor.hoursTotal}`),
  );
  out.push("");
  for (const n of seen.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    const marks: string[] = [];
    if (n.id === floor.at) marks.push(amber("you are here"));
    if (n.hasStairs && floor.stairsAnnounced) marks.push(amber("stairs"));
    if (n.kind === "safe_room") marks.push(jade("safe"));
    if (n.kind === "guild") marks.push(jade("guild"));
    if (n.kind === "shop") marks.push(ice("shop"));
    if (n.kind === "vault") marks.push(signal("vault"));
    if (n.boss && !floor.bossesKilled.includes(n.boss)) marks.push(blood(BOSS_BY_ID[n.boss]?.name ?? "boss"));
    if (n.cleared && n.visited) marks.push(dim("cleared"));
    if (!n.visited) marks.push(dim("not entered"));
    out.push(`  ${amber(n.id.padEnd(4))} ${(n.visited ? bone : dim)(n.name.padEnd(34))} ${marks.join(dim(" · "))}`);
  }
  return out.join("\n");
}

export function memoryView(state: GameState): string {
  const out: string[] = [rule("what you remember")];
  if (!state.memory.length) out.push(dim("  Nothing worth writing down yet."));
  for (const m of state.memory.slice(-20)) {
    out.push(`  ${dim(`f${m.floor} ${fmtHours(m.at)}`)} ${bone(m.node)}`);
    out.push(dim(wrap(m.summary, 6)));
  }
  if (state.world.feed.length) {
    out.push("");
    out.push(dim("  elsewhere on this floor"));
    for (const f of state.world.feed) out.push(dim(wrap(f, 4)));
  }
  return out.join("\n");
}
