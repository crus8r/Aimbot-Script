# Tentacle Wars (Roblox vertical slice)

A playable slice of the cell-and-tentacle RTS loop, built in Luau for Roblox.
You play the **green** antibodies against **red** infection and the smarter
**purple** strain. Cells hold energy and regenerate. You drag from a cell you
own to any cell in range; a tentacle *grows* across the board, and once it lands
it starts pushing energy — reinforcing the target if it is yours, eating into it
if it is not. A cell drained to zero flips to the attacker.

This is an original implementation of the genre, not a port: no assets, level
layouts, or names are taken from any existing game.

## The economy

A tentacle is not free to extend. It is built out of the source cell's own
energy — one point per two segments, drawn down as it grows — so reaching across
the board visibly empties the cell that reached. Stretch further than you can
afford and the chain runs you to zero and is dragged home. Reeling in refunds
every point, so retreating costs only time.

That means the energy you spent on length is **stored in the chain**.

Once a chain arrives it pulses for free, forever: the source paid once, up
front, and the pulse rate is set by whatever the source is holding *now*. This
is why feeding your own cells matters — a fed cell is a faster cell, and can
hold more lines open.

## The cut

Cutting splits a chain at the point you click and collapses both halves outward.
Everything **past** the cut discharges into the target. Everything **behind** it
reels home and is refunded. So the cut point is the decision:

- Cut at the source and the whole column goes forward — a burst worth far more
  than the pulse trickle, which is how a defended cell actually falls. Surround
  one and cut every chain at once and it cannot regenerate through it.
- Cut at the far end and it all comes back — a clean retreat when a second enemy
  starts on you and you need the energy at home.
- Cut in the middle and split it.

Two consequences fall out of the same model:

- Two chains cannot share a lane. Growing into an occupied one **shoves it
  back**, refunding its owner while the pusher pays to advance, and they settle
  near the middle.
- A chain shoved off its target is not touching anything, so its cut has nowhere
  to discharge. Pushing back is how you defuse a loaded chain.

## Running it

Requires [Rojo](https://rojo.space). The version is pinned in `rokit.toml`, so
with [Rokit](https://github.com/rojo-rbx/rokit) installed:

```sh
rokit install         # installs the pinned Rojo
rojo plugin install   # installs the Studio plugin, once
rojo serve            # then connect from the Rojo plugin in Studio
```

Rokit puts tools on your PATH at install time, so **open a new terminal** before
the first `rokit` command — an already-open shell still has the old PATH.

Press Play. You are seated as green; every faction without a player becomes a
bot. Clearing a zone advances to the next one; losing it, or running out the
clock, replays it.

## Controls

| Action | Input |
| --- | --- |
| Reach out | Drag from one of your cells to a target cell |
| Cut | Click your own tentacle — **where** you click is where it cuts |

While dragging, the ring shows how far that cell can reach; reaching the far
edge of it costs most of what a starting cell holds. The number on your own
chains is their stored charge — exactly what a cut at the source would throw.

How many lines a cell can hold open is a function of what it is holding right
now, not its size: under 15 it manages one, and it earns more as it is fed.

## Layout

```
src/Shared/      Config, Types, Net, Simulation, Levels/   (both sides)
src/Server/      init.server.luau (round manager), AI.luau
src/Client/      init.client.luau (input), Renderer.luau   (all the UI)
tests/           headless simulation tests
```

`Simulation.luau` is the whole game: pure Luau, no Instances, no yielding, no
knowledge of who is playing. The server owns one instance and steps it at a
fixed 20 Hz; the client never runs it, it only draws the snapshots that come out
of it. Clients send `RequestConnect` / `RequestCut` intents and nothing else, so
every rule is enforced server-side.

Snapshots go out at 15 Hz on an `UnreliableRemoteEvent` and carry only what
changes — ownership, unit counts, tentacle progress, and the position of every
pulse in flight. Cell positions and sizes are sent once at round start.

Rendering is pure `ScreenGui`: a 1000x600 virtual board, aspect-locked, with
cells as circular `Frame`s, tentacles as rotated `Frame`s clipped to the two cell
edges, and pulses as pooled dots riding along them. Because the board mapping is
uniform, board-space angles and distances survive the conversion to pixels
unchanged, which is what makes the hit-testing in `Renderer.cellAt` /
`tentacleAt` straightforward.

## The two enemies

`AI.luau` has one brain and two profiles. **Red** plays it straight: it opens
the best attack it can afford, supports a starving cell when there is no attack
worth making, and drops a line whose source is running dry — losing the column.
**Purple** thinks faster, commits harder, and knows about cutting: it severs a
tentacle the moment its charge would finish the target, and salvages the column
when it retreats instead of throwing it away.

That difference is measured, not asserted: on a fixed test board purple takes
the same cell in ~11s against red's ~16s, purely from cutting.

## Tuning

Everything worth tweaking lives in `src/Shared/Config.luau`: growth speed, pulse
speed and spacing, flow rate, cell tiers (capacity, regeneration, slots), connect
range, and the round clock. Levels are plain data — copy
`src/Shared/Levels/Incision.luau` and add it to `Levels/init.luau`.

Three constants are load-bearing and interact:

- `SEGMENTS_PER_ENERGY` (2) is the exchange rate between distance and energy. It
  sets what every board position is worth and how far a cell can reach.
- `PULSE_CLASSES` versus `REGEN_INTERVAL` (1.4s) decides whether a single line
  can ever win. A cell in the 35+ band pulses every 0.75s against a defender
  regenerating every 1.4s — about a third of a point per second of net progress.
  That is deliberately marginal: one line is pressure, not a kill. The kill is
  the cut.
- `MAX_CONNECT_DISTANCE` (430) caps the longest chain, and so caps both the
  biggest reach and the biggest possible cut.

## Tests

```sh
tests/run.sh          # needs the luau CLI on PATH, or LUAU=/path/to/luau
```

`tests/bundle.py` stitches the Instance-free modules (Config, Types, Simulation,
the levels, the AI) into one standalone script with a small `Vector2`/`Color3`
shim, so the simulation runs outside Roblox. The runner also parse-checks every
source file, including the Roblox-only ones.

71 assertions: build cost, overreach and refund, free pulsing, pulse and slot
classes, all three cut positions (source / middle / far end) measured against the
charge, a surround-and-cut volley taking a defended cell, lane clashing and
shove-back, capture rules including the neutral bonus, regeneration and the
limit, round bookkeeping, red-versus-purple, and 50 seeded AI matches across both
levels that must all resolve inside the clock.

Those tests have earned their keep repeatedly. The clash tests caught a chain
keeping its `attached` flag after being shoved off its target, which would have
let a defused chain still pulse and still cut. The match tests caught a bot
re-opening the same blocked lane 656 times in one round — fixing that roughly
halved match length. Earlier versions of this suite caught a margin deadlock, a
capture flip-flop, and a dead reinforcement branch.

## Not in this slice

- Two zones, not eighty. No menus, level select, or persistence — stars are
  reported at the end of a round but not saved.
- No vaccines (the scarce instant-capture consumable).
- Chains only interact head-on in the same lane. Two chains crossing at an angle
  pass through each other.
- No matchmaking beyond "players in the server take factions in join order".
- No sound, particles, or juice of any kind.
