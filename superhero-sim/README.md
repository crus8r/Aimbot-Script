# VANGUARD — Superhero Squad Simulator

A browser-based, mobile-first superhero action game. Five custom heroes, one open
city, temporary "Surge Forms". No engine, no build step, no assets — everything
(city, characters, effects, sound) is generated procedurally in ~4,000 lines of
plain JavaScript and drawn to a single 2D canvas.

**First iteration / test build.** The goal was a large map, plenty of basic
enemies at levels 1–5, instant hero swapping, easy respawning, and a button that
force-triggers a hero's greater form on demand.

---

## Play it

**Online:** enable GitHub Pages for this repository (Settings → Pages → deploy
from branch), then open:

```
https://<your-username>.github.io/Aimbot-Script/superhero-sim/
```

**Locally:** just open `superhero-sim/index.html` in a browser — it runs
straight off the filesystem, offline, with no server and no install.

Best on a phone in landscape, but portrait and desktop both work.

---

## Controls

### Touch
| Input | Action |
|---|---|
| Drag anywhere on the **left half** | Move (the stick appears wherever you touch) |
| Big button, bottom right | Attack — hold to keep swinging |
| Two round buttons | The hero's two abilities (some are hold-to-use) |
| Small `»` button | Dash |
| **Drag off any action button** | Aim it manually; released without dragging it auto-targets the nearest enemy |
| Portrait chips, top left | Swap hero instantly, any time |
| ★ button | Surge Form (lit when the bar is full) |
| ⚡ **FORCE** | Fills the Surge bar and triggers the form immediately — test-build override |

### Keyboard
`WASD`/arrows move · `J`/`Space` attack · `K` ability 1 · `L` ability 2 ·
`Shift` dash · `Q`/`E` Surge Form · `F` force form · `1`–`5` or `Tab` swap hero ·
`C` extra action (Savior's element) · `Esc` pause

---

## The squad

All five are seventeen. You control one at a time; the other four recover HP on
the bench, so swapping is both a tactic and a heal.

### SAVIOR — *The Crystal Blade*
White-and-grey armour with green accents and a crystal sigil on the chest;
armoured, not padded. Fights with a sleek shortsword.
- **Crystal Edge** — three-hit sword combo; the finisher throws a crystal crescent.
- **Absorb** (hold) — raises a field that nullifies incoming damage *and* eats
  enemy projectiles, converting everything into stored Energy.
- **Release** — spends Energy on an element: fire cone, ice shard spread, or
  chain lightning. Tap the element chip to cycle.
- **RADIANT ASCENSION** — glows, becomes invulnerable (every hit taken is
  devoured as energy), floats above the ground and fires a sustained radiant beam.

### EXODUS — *The Green Streak*
Speedster. Black roguish tech-weave, sleek goggles, lower face mask, long black
hair loose. Twin green electric whips, smoky green trails.
- **Whip Lash** — fast alternating whip strikes that arc lightning to a second target.
- **Blitz** (hold) — phases through crowds at extreme speed, damaging everything
  he passes through, spending Boost.
- **Charge** — lobs a mote of green energy that *sticks* to whatever it hits and
  detonates a beat later (3 charges).
- **CRYO OVERDRIVE** — the green burns out to blue: frost trails freeze the ground
  behind him and every charge detonates as a flash-freeze.

### PARAGON — *The Gilded Fist*
Super strength with a half-learned angelic side. Blue-and-gold armour, open face,
simple domino mask, short blond hair, war hammer. Gold bursts on heavy hits.
- **Hammer** — slow three-hit combo; the finisher erupts in gold light.
- **Leap / Glide** — tap to leap enormous distances; **hold** at the top to glide.
  Landing is a shockwave. He can land and stand on rooftops.
- **Judgment** — overhead smash sending a radiant cone forward.
- **ASCENDED HOST** — wings of gold light, true flight, and the hammer becomes a
  radiant **spear** he can hurl straight through a crowd.

### DOMINUS — *The Hollow Hood*
Shadow manipulation. Tight dark weave, long cape, hood that magically swallows
his face completely. Reads like a villain.
- **Shadow Blades** — twin daggers; heavy bonus damage from behind.
- **Umbral Step** — short-range teleport (2 charges) leaving a decoy that detonates.
- **Shadow Armory** — summons spectral blades that orbit and hunt targets; press
  again to fire them all at once.
- **TEMPEST OF THE VOID** — the violet burns to deep blue: a storm follows him,
  striking enemies with lightning, and every teleport calls down a bolt.

### VITALITY — *The Amber Warden*
Face-plate mask, long brown hair, amber powers — constructs like ice, plus
serious regeneration.
- **Amber Shards** — ranged crystalline shards that chill on hit. Her strikes leech life.
- **Spires** — erupts a wall of amber crystal that damages, blocks and walls enemies off.
- **Mend** — burst heal plus a lingering healing field; also tops up the bench.
- **AMBER ETERNAL** — massive regeneration, hardened skin, bigger constructs — and
  it lasts **26 seconds**, far longer than anyone else's form.

---

## The city and its enemies

The map is 6400×4800. Threat scales with distance from the central plaza —
level 1 in the middle, level 4 at the edges — and six marked arenas hold a level 5
boss. Each tier has its own trick:

| Lv | Enemy | Gimmick |
|---|---|---|
| 1 | **Husk** | Weak melee, but swarms |
| 2 | **Lancer** | Keeps its distance, fires bolts — which Savior can absorb |
| 3 | **Bulwark** | Front shield blocks ~88% of damage; flank it, or break it with heavy knockback |
| 4 | **Stalker** | Blinks in behind you, dodges attacks, leaves slowing shadow pools |
| 5 | **Colossus** | Boss: telegraphed slams, expanding shockwaves, summons adds, enrages at 50% HP |

Airborne heroes clear buildings and dodge ground attacks — but ranged enemies
lead their shots upward, so flight is an advantage, not immunity.

**Surge** fills as you deal damage. Fill the bar to unlock a hero's form, or hit
FORCE to trigger it outright. Downed heroes are never a run-ender: tag in a
teammate from the overlay, or revive the whole squad.

---

## Project layout

```
superhero-sim/
  index.html        markup, HUD, menus
  css/style.css     HUD, touch controls, responsive layout
  src/util.js       math, spatial hash grid, geometry
  src/audio.js      procedural WebAudio SFX (no audio files)
  src/input.js      virtual stick, buttons with drag-to-aim, keyboard
  src/entities.js   particles, projectiles, hazards, structures, combat resolution
  src/world.js      procedural city, threat zones, boss arenas
  src/heroes.js     the five kits, abilities and Surge Forms
  src/enemies.js    the five enemy tiers and their AI
  src/render.js     camera, 2.5D city, procedural character art, VFX
  src/hud.js        DOM HUD, roster, minimap, menus
  src/game.js       main loop, squad, spawn director
```

Plain `<script>` tags in dependency order, everything under a single `SH`
namespace — no bundler, no dependencies. Performance is adaptive: the spawn cap
lowers itself if the frame rate drops.

## Possible next steps

Real multiplayer, per-hero progression, mission objectives beyond "clear the
zone", more enemy tiers, and squad AI for the benched heroes.
