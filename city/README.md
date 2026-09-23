# Port Solana

An open-world city in the browser, built to be the stage for the Playhouse
studio: a screenplay in, a directed film out. The city comes first because a
film needs a world that already works: people who walk, sit, lie down,
talk, drive; rooms with things in them; a sun that sets.

Live build: https://claude.ai/artifact/VsMsf26hgf7kmQ2apbZccT

## What is in it

- **A coastal city**: a 5×4 grid of blocks between downtown towers and an
  art-deco beachfront, Ocean Drive, a Copacabana-style promenade, a beach
  with loungers and lifeguard towers, a pier, a park with a fountain, a
  basketball court, a parking lot. Day/night cycle with lit windows, neon,
  street lamps and stars.
- **Six walk-in interiors**, no loading screens: the Sunny Side Diner, a 24/7
  store, an apartment (living room, kitchen, bedroom, bathroom), the Neon
  Lounge (bar, dance floor, stage with a playable piano), a boutique with a
  wardrobe that changes your outfit, and an office.
- **Things to use**: seats of every height (chairs, stools, sofas, benches,
  booths, fountain rim), beds and beach loungers to lie on, TVs with
  channels, lamps, a jukebox that plays a synthesised tune, fridges that give
  you a drink you can sip and drop.
- **~90 people** with routines: walking the sidewalks and waiting for the
  walk signal, sitting on benches, sunbathing, chatting in pairs, staff
  behind counters who greet you, patrons in booths, dancers. They look at you
  when you pass, complain when you bump them, wave back when you wave, and
  answer when you talk to them.
- **Traffic**: cars on a lane network through signalled intersections, parked
  cars, and any car can be driven (F). The pink Ferrari by the spawn is yours.
- **Type-to-speak**: press T, type, and your character says it aloud with a
  speech bubble, in one of four voices (adult male, adult female, boy, girl),
  with talking gestures and (on the suited man) a moving mouth.

## Controls

WASD walk · Shift run · C toggle jog · Space jump · mouse look (click first)
· E use/sit/talk · F car · T talk · 1–0, -, = emotes (G lists them) · Q drop
· M map · H help · Esc menu (character, time of day, graphics, sound).
Phones get a thumbstick, drag-to-look and buttons.

## Running it

```
npm install
npm run build          # dist/ (models are also written as base64 .txt, see below)
npm run serve          # http://127.0.0.1:8080
```

URL options: `?quality=low|medium|high`, `?people=0.5`, `?cars=10`,
`?nocars`, `?nopeople`, `?world=test` (a small yard for checking movement),
`?model=michelle|girl|soldier|mannequin`.

## Checking it (headless, with screenshots)

Every visual claim here was checked by rendering, not by reading code.

```
node tools/scenarios.mjs tour      # spawn, streets, park, downtown, beach, pier, aerial, night
node tools/scenarios.mjs rooms     # walk into all six interiors through their doors
node tools/scenarios.mjs hooks     # TV, sofa, lamp, fridge+drink, jukebox, stool, piano, wardrobe
node tools/scenarios.mjs people    # counts, talk to an NPC, the reply, a wave
node tools/scenarios.mjs drive     # get in the Ferrari, drive, crash, get out
node tools/scenarios.mjs light     # frame luminance across times of day (COMBOS env to sweep)
node tools/scenarios.mjs yard      # movement, chair, bed, stairs, jump, emotes (?world=test)
node tools/lab-shot.mjs "?sheet=sit@1,lie@1&view=side" out.png   # pose contact sheet, all rigs
```

Scenarios step the game manually (deterministic) and render only the final
frame of each step batch: software GL is slow and a frame backlog makes
screenshots time out.

## How it is built

```
src/core/     rig.js        Rig: any humanoid in one canonical space; retargetClip
              pose.js       pose descriptions -> bone rotations (aims, IK, hands)
              clips.js      the authored motion library (sit, lie, wave, drive...)
              cast.js       models, recolouring, clip cache, stride measurement
              actor.js      Actor: body + verbs (sit, stand, lieDown, emote, say, lookAt)
src/engine/   physics.js    oriented boxes, stepping, character motion, camera rays
              camera.js     third-person camera with wall avoidance, chase cam
              sky.js        sun, sky, fog, night dome, exposure, shadows
src/world/    layout.js     the plan (pure data: roads, blocks, lots, interiors)
              roads.js, buildings.js, interiors.js, furniture.js, props.js,
              nature.js, models.js, materials.js, textures.js, build.js
src/game/     game.js       loop, culling, quality, game-time scheduler (later)
              npcs.js, navgraph.js, lines.js    people and what they say
              traffic.js, vehicles.js           lanes, signals, AI, driving
              speech.js, audio.js, hooks.js, seats.js, interact.js, player.js
src/ui/       hud.js, touch.js
```

**Motion is authored as descriptions, not keyframes.** A pose says "hips
10cm above a 46cm seat, feet a thigh-length forward on the floor, hands on
the thighs"; `PoseSolver` turns that into rotations for whichever body it is
given, with two-bone IK and body measurements. That is why one `sit` fits a
bar stool and a sofa, a 1.66m woman and a 1.80m man. Mocap (walk, run, idle,
samba) is shared across all five models by `retargetClip`, which moves motion
as world-space rotation from rest after bending each rig's rest pose to a
common T-pose (naive clip sharing turned three of five characters upside
down).

**Every behaviour is a verb on Actor.** The keyboard, an NPC routine and (next)
a script all call the same `walk/sit/stand/lieDown/emote/say/lookAt`. The
studio needs nothing the game doesn't already exercise.

## Measured, not guessed

- Shadows: the sun's shadow camera never had `updateProjectionMatrix()`
  called, so shadows existed only in a 10m box. Found by measuring shadow
  contrast in a test yard.
- Exposure: bloom on linear HDR hazed noon white even at threshold 3.5; bloom
  is night-only. Noon clipped 30% of pixels; a sun-height exposure curve and
  ambient that falls as the sun rises bring it to 1.5% with golden hour intact.
- Draw calls: one material per building colour made 1317 city meshes. Vertex
  tints + a shared shopfront atlas + 152m chunks: 550. Frame total 821 -> ~550.
- CPU: ~1.5ms per frame for 90 people, traffic and physics (without render).
- Walk speed: each walk/run clip's natural speed is measured from its planted
  foot, and playback rate follows real ground speed, so feet don't slide.

## Hosting note

The artifact host serves `.js`, images and text but not `.glb`, so the build
writes every model as base64 text (`name.glb.txt`), decoded by
`src/core/loadglb.js`. The Ferrari is Draco-compressed and decoded with the
plain-JS Draco decoder, not WASM, in case the viewer forbids compiling it.

## Known limits

- Voices come from the viewer's system (Web Speech). They differ per OS; with
  none installed you get bubbles and mouthing only. The menu lists which
  system voice each preset got. Speech can't be recorded into a video file
  from the browser; the studio will need a TTS it can capture.
- Faces don't act: only the suited man's mouth opens.
- NPC cars have silhouettes, not people, behind tinted glass.
- Left turns are skipped at signalled junctions (no protected phase).
- Sitting on the left edge of a bed isn't supported (lie_down turns the head
  to the character's left).

## Sunny Lane: the life-sim

`homes.html` is a second game on the same engine: a street of three preset
houses (Starter Cottage, Family House, Beach Bungalow) with a household of
three who live in whichever one you pick.

Live build: https://claude.ai/artifact/XJ7aB3S2jg1ZUynM7NcckL

- **Live**: click a thing for what you can do with it (pie menu), click the
  floor to walk. Six needs (hunger, energy, bladder, hygiene, fun, social)
  drift down; idle sims pick something that helps, weighted by how badly
  they need it and how far it is. Beds, sofas, TV, fridge, stove, shower,
  bath, toilet, piano, computer, stereo, grill, loungers, mailbox, wardrobe.
  Sims chat, joke, wave and dance with each other. **Talk** (T) makes the
  selected sim say what you type in one of the four voices; say a
  housemate's name and they answer.
- **Buy**: ~80 catalogue pieces in nine categories (indoor and yard), with
  rendered thumbnails. A ghost follows the pointer, snaps to a 25cm grid,
  turns in quarter (or eighth) turns, and says why it won't fit (a wall, a
  doorway, another piece, the lot line). Paintings snap to walls, lamps and
  vases to table tops. Move, turn, duplicate, sell, undo.
- **Build**: paint any wall side (or a whole room), lay floors, change the
  siding and roof, cut doors, windows and archways, or wall them up.
- Walls cut away in front of rooms (or all up, or all down), roofs toggle,
  trees in front of the house fade out. Day and night, with room lights.
- Lots save in the browser; **Export** gives a lot as JSON (plan, finishes,
  every piece and where it is), which is also what a studio "set" will be.

How it is built (`src/homes/`):

```
house.js     rooms (rectangles) -> wall runs with two paintable sides, doors,
             windows, floors, hip roofs, cutaway; merged into one mesh per finish
plans.js     the three preset houses, their furnishing and yards; the household
catalog.js   the buy catalogue (furniture.js, props.js, models + new yard pieces)
items.js     placed pieces: colliders, seats, TVs/lamps/music, validity, snapping,
             one merged mesh per material for everything placed
nav.js       25cm occupancy grid from the physics boxes, A*, string pulling
sims.js      Sim (needs, queue) and Task: steps go/sit/lie/stand/anim/wait/say
actions.js   what each thing offers, socials, free will, typed-line replies
buildmode.js buy and build tools, undo/redo
view.js      orbit camera, mouse/keyboard/touch gestures
ui.js        HUD, pie menu, catalogue, swatches, chat, menu
```

Tasks are data (`go -> sit -> wait`), so the studio can build the same lists
from a screenplay line. Checked headlessly with `node tools/homes-shots.mjs
<tour|actions|actions2|presets|persist|showcase|phone>`: every action on all
three lots completes, every preset piece passes the buy rules, every seat is
reachable, and saving, moving house, export/import and undo round-trip.

Measured: merging placed furniture and walls per material took the Family
House from 1041 draw calls to 531. Also fixed on the way: a seated character
who spoke crashed the `sit_talk` clip (it wrote to a `twist` table the sit
pose never makes), and bubbles now stack instead of covering each other.

## Next: the studio

The city is the stage. The Playhouse plan (see git history on the
`claude/sims-design-cinematic-assessment-y1s146` branch, `playhouse/HANDOFF.md`)
becomes, here:

1. **A scene timeline** of actor commands (`at 2.0s: Maya sits at the diner
   booth; at 3.5s: Maya says "..."`), played on the game-time scheduler so it
   replays identically.
2. **Cameras with shot grammar**: a free director camera and named shots
   (wide, two-shot, over-the-shoulder, close-up) solved against actor
   positions, ported from Playhouse.
3. **Record to video** (canvas capture + a TTS that renders to audio).
4. **The LLM bridge**: a screenplay page in, a timeline out, validated against
   the verbs, places, seats and clips this city actually has.
