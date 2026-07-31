import type { GameState, MapNode } from "../core/types.ts";
import { SLOT_LABEL, SLOTS } from "../core/types.ts";
import type { RenderedLine } from "../voice/narrator.ts";
import { derive, carryCapacity, carriedWeight } from "../sim/character.ts";
import { currentNode } from "../sim/map.ts";
import { crawlerOf, living, zoneDistance, zoneOf } from "../sim/tactics.ts";
import { bar, hours as fmtHours } from "../core/util.ts";
import { SKILL_BY_ID } from "../data/skills.ts";
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

export function inventoryView(state: GameState): string {
  const out: string[] = [rule("inventory")];
  const worn = SLOTS.map((slot) => {
    const item = state.inventory.find((i) => i.equipped && i.slot === slot);
    return `    ${dim(SLOT_LABEL[slot].padEnd(9))} ${item ? RARITY_COLOUR[item.rarity]!(item.name) : dim("—")}`;
  });
  out.push(dim("  worn"));
  out.push(...worn);
  out.push("");
  out.push(dim("  carried"));
  const carried = state.inventory.filter((i) => !i.equipped);
  if (!carried.length) out.push(dim("    nothing"));
  for (const i of carried) {
    const colour = RARITY_COLOUR[i.rarity] ?? bone;
    out.push(
      `    ${colour(i.name)}${i.qty > 1 ? amber(` ×${i.qty}`) : ""} ` +
        dim(`${i.rarity} ${i.kind} · ${i.weight}kg · ${i.value}g`),
    );
    out.push(dim(wrap(i.desc, 6)));
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
  return out.join("\n");
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
