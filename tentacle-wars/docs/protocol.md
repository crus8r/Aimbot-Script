# Build contract — v2 overhaul

Single source of truth for the four implementation tracks. Nobody deviates
from a [K] contract without renegotiating here. Field names are exact.

## File ownership (no track edits another track's files)

- **SIM**: `src/Shared/Simulation.luau`, `src/Shared/Config.luau`,
  `src/Shared/Types.luau`, `src/Shared/Net.luau`, `src/Shared/Levels/*`,
  `src/Server/AI.luau`, `tests/*`.
- **SRV**: `src/Server/init.server.luau`, NEW `src/Server/Progress.luau`.
- **BOARD**: `src/Client/Renderer.luau`.
- **UI**: NEW `src/Client/UI/Theme.luau`, `src/Client/UI/Hud.luau`,
  `src/Client/UI/Screens.luau`, NEW `src/Client/Sfx.luau`,
  `src/Client/init.client.luau`.

## [K0] Mechanics decisions (SIM implements; others rely on behavior)

1. **Clash fix** (the freeze): in `extend()`, shoving an opposing chain back
   DESTROYS the shoved segments (no refund) — pass-through flag on `reelIn`.
   Voluntary `retract` and forced bankruptcy retreat still refund. A shove
   drops only pulses beyond the new length (`pulse > length`), never clears
   all pulses. A chain whose `length < span` is not `attached`.
2. **Pacing** (Config): `REGEN_INTERVAL = 2.6`; `PULSE_CLASSES =
   {from=35, 0.45}, {from=15, 0.70}, {from=2, 1.15}` (v<=1 cannot pulse);
   `GROW_RATE = 13`; `COLLAPSE_RATE = 26`; `PULSE_SPEED = 26` (keep);
   `SEGMENT_LENGTH = 6`, `SEGMENTS_PER_ENERGY = 2`, `NEUTRAL_CAPTURE_BONUS
   = 10`, `ROUND_TIME_LIMIT = 600` (keep).
3. **Capture**: when a defended cell is captured, each of its outbound
   tentacles becomes a REFUND collapse whose energy reels INTO the captured
   cell for the NEW owner (original behavior), not deleted. Neutral capture
   sets value 10 (needle: 20). Overflow rule unchanged otherwise.
4. **Slot classes** (player + purple): <15 -> 1, 15+ -> 2, 35+ -> 3,
   60+ -> 4 (keep). Red AI additionally self-caps at 2 chains/cell.
5. **EMB cells**: `kind = "EMB"` (default `"ATT"`). No outbound chains
   (connect from an EMB is rejected: "not an attacker"). Half regen
   (+1 per 2*REGEN_INTERVAL). Mobile: `Simulation.moveEmb(owner, cellId,
   target: Vector2) -> boolean` starts an exponential glide, position
   closes half the remaining gap every 0.2s, stops within 4 units; while
   moving costs 1 value per 0.64s (drops below 1 -> stops, cannot restart
   until >= 2). On contact with ANY other cell (center distance <= sum of
   radii + 8): the EMB is removed and its whole value applies to the touched
   cell as a lump (same color: heal capped at limit; different: damage with
   capture rules as in cut payloads). EMBs do NOT count for win/lose.
6. **Win/lose** (original rule): a faction is alive iff it owns >= 1
   `kind=="ATT"` cell. Winner = last faction alive. Timeout tiebreak
   unchanged (`leader()`).
7. **Needles** (server-owned count, sim applies): `Simulation.inject(owner,
   cellId) -> boolean` starts a drip: 30 points at 22/s (~1.36s); own cell
   heals (capped), any other loses; on crossing below 0 converts to the
   injector: neutral -> value 20, enemy -> |overflow| with the
   capture-refund rule from (3). While dripping, the cell's `CellState`
   carries `injected = true`. One active injection per cell.
8. **Cut**: unchanged from current (`cut(owner, id, fraction)`), only own
   chains, discharge half `delivers` only when `attached`.
9. **Campaign**: 7 ORIGINAL zone layouts (design fresh; do NOT copy any
   coordinates from the reference), following this difficulty arc: cap 70,
   70, 80, 80, 90, 90, 90; Zone1 = gentle 1v1 intro vs a passive-leaning
   red, Zone2 = 1v1 + first neutrals, Zone3 = introduces EMBs both sides,
   Zone4 = player outnumbered + a 0-value neutral gift, Zone5 = symmetric
   pitched battle on crossing diagonals, Zone6 = player swarm of weak cells
   vs one giant, Zone7 = three-camp FFA with Purple. Each level:
   `powerLimit`, ascending `starTimes` (base off AI-mirror medians ~110s:
   easy {140,240,360}, three-way {170,280,420}, scale by zone size).
10. **AI**: `Red` = original grammar: ~4.5s opening grace, thinks ~1.1/s,
    reserve 10 after build cost, targets grays first (highest value first)
    then cheapest enemies, 2-chain cap, retracts chains when starving
    (value <= 6), assists: opens a support chain to an allied ATT below 8
    (zones 4+, `assist = true` in the level's ai config), controls EMBs
    (one in flight at a time, targets weakest affordable). `Purple` = same
    senses but faster cadence, uses slot classes (no 2-cap), CUTS at the
    source when charge > target value + 2, salvages via cut when retreating.
    `Dormant` = never acts (Zone1 tutorial feel). Keep a desperation
    fallback so seeded matches always resolve. Keep the lane-deadlock
    recycle consistent with the open-gate (fix per freeze report).

## [K1] Remotes (SIM adds names to Net.luau RELIABLE; SRV/UI use them)

Existing: RoundStart, RoundOver, RequestConnect, RequestCut, Snapshot
(unreliable). New RELIABLE:

| Remote | Dir | Payload |
|---|---|---|
| RequestStartLevel | C->S | `(levelIndex: number)` host only, validated |
| RequestPause | C->S | `(paused: boolean)` solo human only |
| RequestQuitToMenu | C->S | `()` host only |
| RequestMoveEmb | C->S | `(cellId: number, x: number, y: number)` |
| RequestInject | C->S | `(cellId: number)` spends one needle |
| ProgressSync | S->C | `{unlocked: number, stars: {number}, levelCount: number, needles: number}` |
| LobbyState | S->C | `{state: "lobby"|"playing"|"results", hostUserId: number, hostName: string, seatedUserIds: {number}}` |
| PauseState | S->C | `{paused: boolean, byUserId: number}` |

**RoundStart v2**: `{level: string, levelIndex: number, factions: {number},
cells: {{id, position: Vector2, radius: number, kind: string}}, faction:
number, limit: number, starTimes: {number}?, timeLimit: number}`.
**RoundOver v2** (fire per client): `{winner: number, timedOut: boolean,
stars: number, elapsed: number, levelIndex: number, unlockedNext: boolean,
bestStars: number}`.
**Snapshot v2**: cells entries `{id, owner, value, injected: boolean?,
x: number?, y: number?}` (x/y sent ONLY for kind=="EMB" cells, board
units); tentacles/collapses/remaining/limit unchanged.

## [K3] Renderer v2 API (BOARD implements; UI consumes)

Keeps: `new(parent)`, `setLayout(cells, factions, faction, limit)` (cells
now carry `kind`), `applySnapshot(snapshot)`, `beginDrag/updateDrag/endDrag`,
`toBoard`, `cellAt`, `chainAt` (tolerance 12), `ownerOf`, `valueOf`,
`freeSlots`, `kindOf(cellId) -> string`.
Adds: `showCutPreview(chainId, fraction)`, `hideCutPreview()`,
`setDimmed(bool)`, `setVisible(bool)`, and `renderer.events = {onCapture =
nil, onSignalLand = nil, onAttach = nil, onClash = nil}` optional callbacks.
Removes: `refreshStatus`, `showBanner`, `hideBanner`, statusLabel,
bannerLabel (HUD owns all text now). EMB cells: triangle-behind-circle rig,
position updated per snapshot from `x/y`. `cellAt` must hit-test EMBs at
their LIVE positions. Injection: bright ring while `injected`.

## [K4] HUD/Screens API (UI implements)

`Hud.new(gui) -> hud`; `hud:update(model)` where `model = {levelIndex,
levelName, limit, remaining, timeLimit, starTimes, score, faction,
isSpectator, needles, needleArmed}`; `hud:tick(now)`; `hud:setVisible(v)`;
callbacks `hud.onPause: ()->()`, `hud.onNeedleToggle: ()->()`.
`Screens.new(gui) -> screens`: `showTitle{onPlay}`,
`showLevelSelect{levelCount, unlocked, stars, isHost, hostName,
onPick(levelIndex), onBack}`, `showWin{levelIndex, stars, elapsed,
bestStars, unlockedNext, isHost, hostName, onNext, onReplay, onMenu}`,
`showLose{timedOut, isHost, hostName, onRetry, onMenu}`,
`showPause{soloPause, onResume, onRestart, onQuit}`, `hideAll()`.
Star math client-side must match `Simulation.stars`: `elapsed = timeLimit -
remaining`; stars = for first i with `elapsed <= starTimes[i]` ->
`#starTimes - i + 1`, else 0. Score = sum of own cells' values.

## [K5] Progress API (SRV internal)

`Progress.init()`, `Progress.get(player) -> {unlocked, stars, needles}`,
`Progress.recordClear(player, levelIndex, stars) -> (changed, unlockedNext,
bestStars)` (also grants +1 needle for levelIndex >= 4),
`Progress.spendNeedle(player) -> boolean`, `Progress.flush(player)`.
DataStore `TentacleWarsProgress_v1`, key `"u"..UserId`, schema `{v=1,
unlocked, stars, needles}`, every call pcall'd, in-memory fallback,
autosave 60s + PlayerRemoving + BindToClose.

## [K6] Sfx API (UI implements)

`Sfx.play(name)`, name in {attach, cut, capture, signalLand, clash, win,
lose, uiClick, starLost, uiHover}. Empty SoundId = silent no-op.

## Input flow (UI implements in init.client.luau)

- Press own ATT cell (has slots + value>=1) -> chain drag -> release on cell
  -> RequestConnect.
- Press own EMB -> move drag -> release anywhere on board -> RequestMoveEmb.
- Mouse hover over own chain (no drag active) -> showCutPreview; click
  confirms RequestCut at previewed fraction. Touch: press on chain arms the
  preview, slide along re-projects, release on chain confirms, off cancels.
- Needle: HUD needle button toggles armed; next click on any cell ->
  RequestInject + disarm; click empty space disarms.
- Solo pause via HUD pause -> RequestPause.

## Server flow (SRV)

States lobby|playing|results. NO auto-start/auto-restart. Host = earliest
seated player present; re-elect on leave; broadcast LobbyState on any
change. ProgressSync on join + after changes. RequestStartLevel validated
(host, state ~= playing, 1 <= i <= Levels.count(), i <= unlocked,
type/NaN, throttle). RoundOver per-client with recordClear for seated
winners. Keep `Players.CharacterAutoLoads = false`. Solo pause: skip
sim/bot stepping while paused, drain accumulator. Needles: RequestInject
validates owner seat + Progress.spendNeedle before sim:inject; refund the
needle if sim:inject returns false. RequestMoveEmb validates types/NaN +
board bounds (0..1000, 0..600) + ownership via sim.
