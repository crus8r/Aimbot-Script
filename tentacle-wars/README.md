# Tentacle Wars (Roblox vertical slice)

A playable slice of the cell-and-tentacle RTS loop, built in Luau for Roblox.
Cells hold units and regenerate. You drag from a cell you own to any cell in
range; a tentacle *grows* across the board over a second or two, and only once
it lands do units start flowing — reinforcing the target if it is yours, eating
into it if it is not. A cell that hits zero flips to the attacker.

This is an original implementation of the genre, not a port: no assets, level
layouts, or names are taken from any existing game.

## Running it

Requires [Rojo](https://rojo.space).

```sh
rojo serve            # then connect from the Rojo plugin in Studio
# or build a place file:
rojo build -o TentacleWars.rbxlx
```

Press Play. The round starts automatically: you are faction 1 (purple) and the
two unclaimed factions are filled by AI.

## Controls

| Action | Input |
| --- | --- |
| Grow a tentacle | Drag from one of your cells to a target cell |
| Cut a tentacle | Click one of your own tentacles |

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
fixed 20 Hz; the client never runs it, it only draws the snapshots that come
out of it. Clients send `RequestConnect` / `RequestCut` intents and nothing
else, so every rule is enforced server-side.

Snapshots go out at 15 Hz on an `UnreliableRemoteEvent` and carry only what
changes — ownership, unit counts, tentacle progress. Cell positions and sizes
are sent once at round start.

Rendering is pure `ScreenGui`: a 1000x600 virtual board, aspect-locked, with
cells as circular `Frame`s and tentacles as rotated `Frame`s clipped to the two
cell edges. Because the board mapping is uniform, board-space angles and
distances survive the conversion to pixels unchanged, which is what makes the
hit-testing in `Renderer.cellAt` / `tentacleAt` straightforward.

## Tuning

Everything worth tweaking lives in `src/Shared/Config.luau`: growth speed, flow
rate, cell tiers (capacity, regeneration, slots), connect range, and the round
clock. Levels are plain data — copy `src/Shared/Levels/Crossroads.luau` and add
it to `Levels/init.luau`.

Two constants are load-bearing and interact: `FLOW_RATE` (3.2 units/sec) versus
a tier-3 cell's `regen` (2.0/sec). A single tentacle from a *drained* cell only
delivers at the source's regeneration rate, so if you raise tier-3 regen to
meet flow rate, one attacker can never take a big cell alone.

## Tests

```sh
tests/run.sh          # needs the luau CLI on PATH, or LUAU=/path/to/luau
```

`tests/bundle.py` stitches the Instance-free modules (Config, Types,
Simulation, the level, the AI) into one standalone script with a small
`Vector2`/`Color3` shim, so the simulation runs outside Roblox. The runner also
parse-checks every source file, including the Roblox-only ones.

Coverage: connect validation, growth timing, flow and capture arithmetic,
capture side effects (severing the previous owner's tentacles, orphaned
tentacles), regeneration rules, win detection, the timeout tiebreak, snapshot
shape, and 40 seeded AI-vs-AI-vs-AI matches that must all resolve.

That last one earns its keep: it caught a real deadlock where a faction holding
12 of 13 cells could not finish, because every attack it could afford was a
unit short of its own safety margin and cells sitting at capacity stop
regenerating, so the board never changed again. Hence `DESPERATION_AFTER` in
`AI.luau` (a bot that has been stuck for 12s drops its standards) and
`ROUND_TIME_LIMIT` in `Config.luau` (a timed-out round goes to whoever holds
the most ground).

## Not in this slice

- One level, and the two AI factions are always "Normal" difficulty.
- No menus, progression, level select, or persistence.
- No matchmaking beyond "players in the server take factions in join order".
- Tentacles pass through each other; there is no crossing or blocking rule.
- No sound, particles, or juice of any kind.
