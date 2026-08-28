--!nocheck
-- Headless tests for the authoritative simulation. Run with:
--   python3 tests/bundle.py /tmp/bundle.luau && luau /tmp/bundle.luau
-- See tests/bundle.py for how the Roblox-free bundle is produced.

local Config = Modules.Config
local Simulation = Modules.Simulation
local Crossroads = Modules.Crossroads
local AI = Modules.AI

local passed, failed = 0, 0

local function check(name: string, condition: boolean, detail: string?)
	if condition then
		passed += 1
		print(`  ok   {name}`)
	else
		failed += 1
		print(`  FAIL {name}{if detail then " -- " .. detail else ""}`)
	end
end

local function near(a: number, b: number, tolerance: number): boolean
	return math.abs(a - b) <= tolerance
end

local STEP = 1 / Config.TICK_RATE

local function advance(sim, seconds: number)
	for _ = 1, math.floor(seconds / STEP) do
		sim:step(STEP)
	end
end

local function fresh()
	return Simulation.new(Crossroads)
end

--=============================================================================
print("level data")
--=============================================================================
do
	local sim = fresh()
	check("every cell loads", #sim.cellIds == #Crossroads.cells)
	check("faction 1 starts on cell 1", sim.cells[1].owner == 1 and sim.cells[1].units == 24)
	check("cell 5 starts neutral", sim.cells[5].owner == Config.NEUTRAL)
	check("tier 3 cell gets 4 slots", sim.cells[1].slots == 4)

	local ids = {}
	local duplicate = false
	for _, spec in Crossroads.cells do
		if ids[spec.id] then
			duplicate = true
		end
		ids[spec.id] = true
	end
	check("cell ids are unique", not duplicate)

	-- Every faction needs at least one reachable target or it can never move.
	local stranded = nil
	for _, faction in Crossroads.factions do
		for _, spec in Crossroads.cells do
			if spec.owner == faction then
				local reachable = 0
				for _, other in Crossroads.cells do
					if other.id ~= spec.id then
						local distance = (other.position - spec.position).Magnitude
						if distance <= Config.MAX_CONNECT_DISTANCE then
							reachable += 1
						end
					end
				end
				if reachable == 0 then
					stranded = faction
				end
			end
		end
	end
	check("no faction starts stranded", stranded == nil, `faction {tostring(stranded)} has no target in range`)
end

--=============================================================================
print("connect validation")
--=============================================================================
do
	local sim = fresh()

	check("owner can connect in range", (sim:connect(1, 1, 5)))
	check("duplicate is rejected", not (sim:connect(1, 1, 5)))
	check("self connect is rejected", not (sim:connect(1, 1, 1)))
	check("unowned source is rejected", not (sim:connect(2, 1, 7)))
	check("missing cell is rejected", not (sim:connect(1, 1, 999)))

	local _, reason = sim:connect(1, 1, 2)
	check("out of range is rejected", reason == "out of range", tostring(reason))

	-- Cell 1 is tier 3 (4 slots) and already spent one on cell 5.
	sim:connect(1, 1, 7)
	sim:connect(1, 1, 10)
	sim:connect(1, 1, 4)
	local ok, slotReason = sim:connect(1, 1, 5)
	check("slot limit is enforced", not ok, tostring(slotReason))
	check("slot count matches tier", sim:outboundCount(1) == 4)
end

--=============================================================================
print("tentacle growth")
--=============================================================================
do
	local sim = fresh()
	sim:connect(1, 1, 5)
	local tentacle = sim.tentacles[1]
	local expected = tentacle.length / Config.TENTACLE_GROWTH_SPEED

	advance(sim, expected * 0.5)
	check("still growing at half time", not tentacle.connected and tentacle.progress > 0.4)

	advance(sim, expected * 0.5 + STEP * 2)
	check("connects on schedule", tentacle.connected, `progress {tentacle.progress}`)
	check("progress is clamped", tentacle.progress == 1)

	-- Nothing should have been transferred before the tentacle landed.
	local sim2 = fresh()
	sim2:connect(1, 1, 5)
	advance(sim2, (sim2.tentacles[1].length / Config.TENTACLE_GROWTH_SPEED) * 0.5)
	check("no flow while growing", sim2.cells[5].units == 6)
end

--=============================================================================
print("flow and capture")
--=============================================================================
do
	local sim = fresh()
	sim:connect(1, 1, 5)
	local travel = sim.tentacles[1].length / Config.TENTACLE_GROWTH_SPEED

	advance(sim, travel + STEP)
	local before = sim.cells[1].units
	advance(sim, 1)
	check("source drains while flowing", sim.cells[1].units < before)
	check("neutral target loses units", sim.cells[5].units < 6)

	-- 6 units at 3.2/sec is a shade under two seconds to flip.
	advance(sim, 2)
	check("neutral cell flips owner", sim.cells[5].owner == 1, `owner {sim.cells[5].owner}`)
	check("captured cell holds overflow", sim.cells[5].units > 0)
	check("captured cell then reinforces", (function()
		local held = sim.cells[5].units
		advance(sim, 1)
		return sim.cells[5].units > held
	end)())
end

do
	local sim = fresh()
	-- Neutral cells sit inert; owned cells regenerate up to their cap.
	local neutral = sim.cells[5].units
	sim.cells[7].owner = 1
	sim.cells[7].units = 1
	advance(sim, 5)
	check("neutral cells do not regenerate", sim.cells[5].units == neutral)
	check("owned cells regenerate", sim.cells[7].units > 1)

	sim.cells[7].units = sim.cells[7].capacity
	advance(sim, 10)
	check("regeneration stops at capacity", near(sim.cells[7].units, sim.cells[7].capacity, 1e-6))
end

--=============================================================================
print("capture side effects")
--=============================================================================
do
	local sim = fresh()

	-- Faction 2 owns cell 5 and is pumping out of it; faction 1 takes it.
	sim.cells[5].owner = 2
	sim.cells[5].units = 4
	sim:connect(2, 5, 4)
	local outbound = sim.tentacles[1]
	check("victim has an outbound tentacle", outbound ~= nil and outbound.owner == 2)

	sim:connect(1, 1, 5)
	advance(sim, 30)

	check("attacker takes the cell", sim.cells[5].owner == 1)
	check("previous owner's tentacle is severed", sim.tentacles[outbound.id] == nil)
	check("tentacle index stays consistent", #sim.tentacleIds == (function()
		local counted = 0
		for _ in sim.tentacles do
			counted += 1
		end
		return counted
	end)())
end

do
	-- Losing the source cell kills the tentacle it launched.
	local sim = fresh()
	sim.cells[5].owner = 1
	sim.cells[5].units = 3
	sim:connect(1, 5, 4)
	sim.cells[5].owner = 2 -- simulate the cell flipping mid-flight
	advance(sim, 1)
	check("orphaned tentacle is dropped", next(sim.tentacles) == nil)
end

--=============================================================================
print("win condition")
--=============================================================================
do
	local sim = fresh()
	check("no winner at the start", sim:winner() == nil)

	for _, id in sim.cellIds do
		if sim.cells[id].owner ~= Config.NEUTRAL then
			sim.cells[id].owner = 1
		end
	end
	check("last faction standing wins", sim:winner() == 1)

	-- A faction with no cells but a tentacle still in flight is not dead yet.
	local sim2 = fresh()
	sim2:connect(2, 2, 13)
	sim2.cells[2].owner = 1
	check("in-flight tentacle keeps a faction alive", sim2:winner() == nil)
end

--=============================================================================
print("snapshot")
--=============================================================================
do
	local sim = fresh()
	sim:connect(1, 1, 5)
	local snapshot = sim:snapshot()
	check("snapshot covers every cell", #snapshot.cells == #sim.cellIds)
	check("snapshot covers every tentacle", #snapshot.tentacles == 1)
	check("snapshot units are integers", snapshot.cells[1].units % 1 == 0)
	check("snapshot omits static fields", snapshot.cells[1].position == nil)
	check("snapshot carries the clock", snapshot.remaining == Config.ROUND_TIME_LIMIT)
end

--=============================================================================
print("round clock and tiebreak")
--=============================================================================
do
	local sim = fresh()
	check("clock starts full", near(sim:timeRemaining(), Config.ROUND_TIME_LIMIT, 1e-6))
	advance(sim, 10)
	check("clock counts down", near(sim:timeRemaining(), Config.ROUND_TIME_LIMIT - 10, 0.05))

	sim.elapsed = Config.ROUND_TIME_LIMIT + 50
	check("clock clamps at zero", sim:timeRemaining() == 0)

	-- Most cells wins the tiebreak outright.
	local byCells = fresh()
	byCells.cells[7].owner = 2
	byCells.cells[10].owner = 2
	check("leader is whoever holds most cells", byCells:leader() == 2)

	-- Equal cell counts fall through to banked units.
	local byUnits = fresh()
	for _, id in byUnits.cellIds do
		byUnits.cells[id].owner = Config.NEUTRAL
	end
	byUnits.cells[1].owner = 1
	byUnits.cells[1].units = 10
	byUnits.cells[2].owner = 2
	byUnits.cells[2].units = 40
	check("units break a cell-count tie", byUnits:leader() == 2)
end

--=============================================================================
print("full AI match")
--=============================================================================
do
	-- Three bots left alone must actually resolve the board, not stalemate.
	local resolved = 0
	local longest = 0
	local SEEDS = 40

	for seed = 1, SEEDS do
		math.randomseed(seed)
		local sim = fresh()
		local bots = {}
		for _, faction in Crossroads.factions do
			table.insert(bots, AI.new(sim, faction, "Normal"))
		end

		local elapsed = 0
		local winner = nil
		while elapsed < 600 and not winner do
			sim:step(STEP)
			for _, bot in bots do
				bot:step(STEP)
			end
			elapsed += STEP
			winner = sim:winner()
		end

		if winner then
			resolved += 1
			longest = math.max(longest, elapsed)
		end
	end

	check("every AI match resolves", resolved == SEEDS, `{resolved}/{SEEDS} resolved`)
	check(
		"matches finish inside the round clock",
		longest < Config.ROUND_TIME_LIMIT,
		`longest {math.floor(longest)}s`
	)
	print(`  ..   longest match {math.floor(longest)}s`)
end

print(`\n{passed} passed, {failed} failed`)
if failed > 0 then
	error(`{failed} test(s) failed`, 0)
end
