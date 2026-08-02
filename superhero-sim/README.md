# VANGUARD — Superhero Squad Simulator

A browser-based, mobile-first superhero action game. Five custom heroes, one open
city, a tier-6 arch nemesis, and two ways to play: a top-down **Campaign** and a
side-on **Versus** mode. No engine, no build step, no assets — everything (city,
characters, effects, sound) is generated procedurally in plain JavaScript and
drawn to a single 2D canvas.

**Test build.** The campaign wants a large map, plenty of basic enemies at
levels 1–5, instant hero swapping, easy respawning, and a button that
force-triggers a hero's greater form on demand. Versus mode shows the same
fighters side-on, so you can actually see the character designs and their
powers, and pits you against **Deathbringer** or one of your own squad.

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

## Two modes

**CAMPAIGN** — top-down, open city, swarms of enemies, boss arenas.

**VERSUS** — side-on 1v1, best of three rounds, MK-style. Pick your fighter,
pick your opponent (Deathbringer by default, or any teammate), pick a
difficulty. The fighters here are **real 3D models** — built from primitives,
lit per face, depth-sorted and rendered through a small polygon renderer
written for this mode. The character select shows them on a live turntable.

The two modes share one engine. Entities already carried `x / y / z` and drew at
`(x, y − z)`; Versus pins both fighters to a single `y` lane, which turns that
same convention into a true side view. So the hero kits, damage, statuses,
projectiles, hazards, VFX and even Deathbringer's AI are the *same code* in both
modes — only the camera, the art and the round rules differ.

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
| Stick **up** / **down** (Versus) | Jump / guard — guarding soaks ~78% of a hit and feeds Surge |

### Keyboard
`WASD`/arrows move · `J`/`Space` attack · `K` ability 1 · `L` ability 2 ·
`Shift` dash · `Q`/`E` Surge Form · `F` force form · `1`–`5` or `Tab` swap hero ·
`C` extra action (Savior's element) · `Esc` pause

In Versus, `W`/`↑` jumps and `S`/`↓` guards.

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
| 6 | **Deathbringer** | Arch nemesis. See below. Waits in **THE BLIGHT**, the grove on the east edge. |

### DEATHBRINGER — tier 6

A pitch-black ent the size of a house, sheeted in viscous living mucus that
drips off him constantly, with two burning orange eyes set in a hollow face and
a splintered maw. He manipulates darkness and kills by touch, and he is the arch
nemesis of all five heroes.

Deliberately **not** a health sponge — he is a challenge, not a slog. He hits
far harder than the Colossus and dies sooner:

- **Death Touch** — a telegraphed lunge. Heavy damage plus **Wither**: a rotting
  damage-over-time that also cuts *all* your healing to 30% while it lasts.
- **Grasp of the Grove** — tendrils erupt in a wide ring and **root** you in place.
- **Root Surge** — black spears erupt from the ground where you're standing,
  in a spreading pattern (five at once once he's enraged).
- **Mucus Spit** — an arcing glob that leaves a black pool: damage over time and heavy slow.
- **Darkness** — he blinds the arena, and shadow orbs hunt you through it.
- At 50% HP the grove wakes: faster, harder, permanently dimmed.

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
  src/gfx3d.js      the 3D renderer: matrix stack, primitives, lighting
  src/models3d.js   the six fighters, built from primitives
  src/sideview.js   side-on stage art + camera
  src/versus.js     1v1 rounds, difficulty, and the opponent AI
  src/hud.js        DOM HUD, roster, minimap, menus, versus HUD
  src/game.js       main loop, squad, spawn director
```

Plain `<script>` tags in dependency order, everything under a single `SH`
namespace — no bundler, no dependencies. Performance is adaptive: the spawn cap
lowers itself if the frame rate drops.

## How the 3D works

Versus needed more presence than flat vector art could give, so it renders
actual geometry. `gfx3d.js` is a compact immediate-mode renderer — a matrix
stack, tapered prisms / boxes / spheres, per-face lighting with a key light,
ambient and rim term, painter's-algorithm depth sorting, and canvas 2D as the
rasteriser. No dependencies and no build step, same as everything else here.

`models3d.js` assembles each fighter from those primitives and poses them with
the *same* joint angles the rest of the game already computes, so walking,
jumping, guarding, attacking and the KO fall all drive the 3D skeleton for
free. The projection is anchored so depth 0 lines up exactly with the painted
2D stage, which is why the models stand correctly inside it. Everything outside
Versus — the whole top-down campaign — is unchanged.

## How the AI opponent works

A hero is normally driven by the global input singleton. Each `Hero` now holds a
reference to *a* controller instead, so an AI opponent gets a synthetic one and
plays the identical kit — same cooldowns, same Surge, same forms — with no
duplicated ability code. Difficulty scales its reaction time, aggression,
damage and durability. Deathbringer instead reuses the campaign enemy AI
verbatim, because his attacks are all range/AoE checks that work unchanged when
everything shares a `y`.

## Possible next steps

Real multiplayer, per-hero progression, mission objectives beyond "clear the
zone", more enemy tiers, squad AI for the benched heroes, and per-character
intro/win animations for Versus.
