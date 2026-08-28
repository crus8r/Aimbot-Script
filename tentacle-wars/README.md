# Tentacle Wars (Roblox vertical slice)

A playable slice of the cell-and-tentacle RTS loop, built in Luau for Roblox.
You play the **green** antibodies against **red** infection and the smarter
**purple** strain. Cells hold energy and regenerate. You drag from a cell you
own to any cell in range; a tentacle *grows* across the board, and once it lands
it starts pushing energy — reinforcing the target if it is yours, eating into it
if it is not. A cell drained to zero flips to the attacker.

This is an original implementation of the genre, not a port: no assets, level
layouts, or names are taken from any existing game.

## The cut

Energy does not teleport. It leaves the source in discrete pulses and then has
to physically travel the tentacle, slowly. A long connected tentacle is
therefore a **loaded pipe** — it can hold more energy in transit than most cells
hold at rest.

Cutting a tentacle severs it at the source and shoves that entire column forward
at once. That is the signature move: attach, let it charge, then cut to land a
burst far bigger than the trickle would have delivered. The number drawn on your
own connected tentacles is the standing charge — exactly what a cut would land,
so it is the number the decision hangs on.

Two consequences fall out of the same model:

- Tentacles running opposite directions between the same two cells **annihilate**
  where their columns meet, so a mutual attack can deadlock a lane completely.
- Losing the source cell mid-flight destroys the column. Only a deliberate cut
  pushes it forward, which is why cutting is a skill and being cut off is a loss.

## Running it

Requires [Rojo](https://rojo.space).

```sh
rojo serve            # then connect from the Rojo plugin in Studio
# or build a place file:
rojo build -o TentacleWars.rbxlx
```

Press Play. You are seated as green; every faction without a player becomes a
bot. Clearing a zone advances to the next one; losing it, or running out the
clock, replays it.

## Controls

| Action | Input |
| --- | --- |
| Attach a tentacle | Drag from one of your cells to a target cell |
| Cut (and land the charge) | Click one of your own tentacles |

While dragging, the ring shows how far that cell can reach. A cell can only run
as many outbound tentacles as it has slots (2/3/4 by size) — cut one to free a
slot.

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

- `PULSE_SPEED` (85) sets how much a tentacle holds, and therefore how strong
  cutting is. Raise it and cutting stops mattering.
- `FLOW_RATE` (3.2) versus a tier-3 cell's `regen` (2.0) leaves only 1.2/sec of
  net damage, so a lone trickle barely beats a big cell's regeneration. This is
  deliberate — it is what forces you to cut — but it also means the value is
  delicate. Raising flow to 4.0 shortened three-way matches but pushed symmetric
  1v1 boards into stalemate 7 times in 25.
- `MAX_CONNECT_DISTANCE` (430) caps the longest pipe, and so caps the biggest
  possible burst at roughly `FLOW_RATE * 430 / PULSE_SPEED`.

## Tests

```sh
tests/run.sh          # needs the luau CLI on PATH, or LUAU=/path/to/luau
```

`tests/bundle.py` stitches the Instance-free modules (Config, Types, Simulation,
the levels, the AI) into one standalone script with a small `Vector2`/`Color3`
shim, so the simulation runs outside Roblox. The runner also parse-checks every
source file, including the Roblox-only ones.

79 assertions: connect validation, growth and transit timing, cut-to-burst
(including a control proving the cut is strictly faster than waiting),
annihilation (a mirrored duel neither side can win, paired with the same attack
landing when unopposed), capture side effects, regeneration rules, win detection,
the timeout tiebreak, star thresholds, snapshot shape, red-versus-purple, and 50
seeded AI matches across both levels that must all resolve inside the clock.

Those match tests have now caught three real defects: a deadlock where a faction
holding 12 of 13 cells could not finish because every affordable attack was a
unit short of its own margin; a flip-flop where bots stripped their own cells to
zero, so every capture landed with no garrison and immediately reverted; and a
dead branch where the cost function knew how to price reinforcement but the move
search skipped friendly cells entirely, so bots never supported their own front.

## Not in this slice

- Two zones, not eighty. No menus, level select, or persistence — stars are
  reported at the end of a round but not saved.
- No vaccines (the scarce instant-capture consumable).
- Tentacles pass through each other; there is no crossing or blocking rule, and
  no colour-mixing system.
- No matchmaking beyond "players in the server take factions in join order".
- No sound, particles, or juice of any kind.
