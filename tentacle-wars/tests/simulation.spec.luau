--!nocheck
-- Headless tests for the authoritative simulation. Run with tests/run.sh.
-- See tests/bundle.py for how the Roblox-free bundle is produced.

local Config = Modules.Config
local Simulation = Modules.Simulation
local Crossroads = Modules.Crossroads
local Incision = Modules.Incision
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

-- Builds a throwaway level so a test can state exactly the board it needs.
local function custom(cells, factions, ai)
	return { name = "Test", factions = factions, ai = ai, cells = cells }
end

--=============================================================================
print("level data")
--=============================================================================
for _, level in { Incision, Crossroads } do
	local sim = Simulation.new(level)
	check(`{level.name}: every cell loads`, #sim.cellIds == #level.cells)

	local ids, duplicate = {}, false
	for _, spec in level.cells do
		if ids[spec.id] then
			duplicate = true
		end
		ids[spec.id] = true
	end
	check(`{level.name}: cell ids are unique`, not duplicate)

	-- Every faction needs a home and at least one reachable target, or it can
	-- never make a move.
	local homeless, stranded = nil, nil
	for _, faction in level.factions do
		local homes = 0
		for _, spec in level.cells do
			if spec.owner == faction then
				homes += 1
				local reachable = 0
				for _, other in level.cells do
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
		if homes == 0 then
			homeless = faction
		end
	end
	check(`{level.name}: every faction has a home`, homeless == nil, `faction {tostring(homeless)}`)
	check(`{level.name}: no faction starts stranded`, stranded == nil, `faction {tostring(stranded)}`)

	local descending = true
	for index = 2, #(level.starTimes or {}) do
		if level.starTimes[index] <= level.starTimes[index - 1] then
			descending = false
		end
	end
	check(`{level.name}: star times ascend`, descending)

	-- A faction with no player and no AI profile silently does nothing.
	local badProfile = nil
	for faction, name in level.ai or {} do
		if name ~= "Red" and name ~= "Purple" then
			badProfile = name
		end
	end
	check(`{level.name}: ai profiles are known`, badProfile == nil, tostring(badProfile))
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
	check("nothing is emitted while growing", #tentacle.pulses <= 1)
end

--=============================================================================
print("energy in transit")
--=============================================================================
do
	local sim = fresh()
	sim:connect(1, 1, 4) -- 360 board units: a long, slow pipe
	local tentacle = sim.tentacles[1]
	local growth = tentacle.length / Config.TENTACLE_GROWTH_SPEED
	local transit = tentacle.length / Config.PULSE_SPEED

	advance(sim, growth + STEP)
	local sourceBefore = sim.cells[1].units
	advance(sim, transit * 0.6)

	check("source pays on emission", sim.cells[1].units < sourceBefore)
	check("target is untouched while energy is in flight", sim.cells[4].units == 28)
	check("pulses are in the pipe", #tentacle.pulses > 0)
	check(
		"payload matches what was emitted",
		near(sim:payload(tentacle), Config.FLOW_RATE * transit * 0.6, Config.FLOW_RATE * Config.PULSE_INTERVAL * 2),
		`payload {sim:payload(tentacle)}`
	)
	check("incoming reports committed energy", near(sim:incoming(4, 1), sim:payload(tentacle), 1e-6))

	-- And it does eventually land.
	advance(sim, transit)
	check("energy arrives after the transit delay", sim.cells[4].units < 28)
end

--=============================================================================
print("cut to burst")
--=============================================================================
do
	-- 420 units apart, so the pipe holds far more than the target has left. The
	-- target is neutral so it cannot regenerate: any change to it is delivery.
	local board = {
		{ id = 1, position = Vector2.new(150, 300), tier = 3, owner = 1, units = 90 },
		{ id = 2, position = Vector2.new(570, 300), tier = 1, units = 8 },
	}

	local sim = Simulation.new(custom(board, { 1 }))
	sim:connect(1, 1, 2)
	local tentacle = sim.tentacles[1]
	local growth = tentacle.length / Config.TENTACLE_GROWTH_SPEED
	local transit = tentacle.length / Config.PULSE_SPEED

	advance(sim, growth + transit * 0.85)
	local charge = sim:payload(tentacle)

	check(
		"charge builds without arriving",
		sim.cells[2].units == 8 and sim.cells[2].owner == Config.NEUTRAL and charge > 8,
		`charge {charge}, target {sim.cells[2].units}`
	)

	check("cut lands the whole column", sim:cut(1, 1) and sim.cells[2].owner == 1)
	check("cut consumes the tentacle", sim.tentacles[1] == nil)

	-- Control: the identical attack, left to trickle, has not landed yet.
	local control = Simulation.new(custom(board, { 1 }))
	control:connect(1, 1, 2)
	advance(control, growth + transit * 0.85)
	check("uncut attack has not landed at the same moment", control.cells[2].owner == Config.NEUTRAL)

	-- ...and takes measurably longer to finish.
	local elapsed = growth + transit * 0.85
	while control.cells[2].owner == Config.NEUTRAL and elapsed < 120 do
		control:step(STEP)
		elapsed += STEP
	end
	check("cutting is strictly faster than waiting", elapsed > growth + transit * 0.85, `trickle took {math.floor(elapsed)}s`)
	print(`  ..   cut landed at {math.floor(growth + transit * 0.85)}s, trickle at {math.floor(elapsed)}s`)
end

do
	-- Cutting a tentacle into a cell you own is a reinforcement burst.
	local sim = fresh()
	sim.cells[5].owner = 1
	sim.cells[5].units = 2
	sim:connect(1, 1, 5)
	local tentacle = sim.tentacles[1]
	advance(sim, tentacle.length / Config.TENTACLE_GROWTH_SPEED + 1)

	local before = sim.cells[5].units
	local charge = sim:payload(tentacle)
	sim:cut(1, tentacle.id)
	check("cutting into an ally reinforces it", near(sim.cells[5].units, before + charge, 1e-6))
end

do
	-- Cutting a tentacle that never connected costs nothing and delivers nothing.
	local sim = fresh()
	sim:connect(1, 1, 4)
	advance(sim, 0.5)
	check("cutting mid-growth delivers nothing", sim:cut(1, 1) and sim.cells[4].units == 28)
	check("foreign tentacles cannot be cut", not sim:cut(2, 1))
end

--=============================================================================
print("opposing pulses annihilate")
--=============================================================================
do
	-- Two identical tier-3 cells firing at each other. Columns meet dead centre
	-- and cancel, so neither side can ever land a hit.
	local mirror = {
		{ id = 1, position = Vector2.new(300, 300), tier = 3, owner = 1, units = 90 },
		{ id = 2, position = Vector2.new(700, 300), tier = 3, owner = 2, units = 90 },
	}

	local sim = Simulation.new(custom(mirror, { 1, 2 }))
	sim:connect(1, 1, 2)
	sim:connect(2, 2, 1)
	advance(sim, 150)

	check("neither side is captured in a mirrored duel", sim.cells[1].owner == 1 and sim.cells[2].owner == 2)
	check("the duel is still live", sim.tentacles[1] ~= nil and sim.tentacles[2] ~= nil)
	check(
		"columns stay bounded rather than piling up",
		sim:payload(sim.tentacles[1]) < Config.FLOW_RATE * (400 / Config.PULSE_SPEED) + 1
	)

	-- Same board, no counter-attack: the attack lands. Proves the test above is
	-- measuring annihilation and not just a board nobody can win.
	local unopposed = Simulation.new(custom(mirror, { 1, 2 }))
	unopposed:connect(1, 1, 2)
	advance(unopposed, 150)
	check("the same attack lands when unopposed", unopposed.cells[2].owner == 1)
end

--=============================================================================
print("capture and regeneration")
--=============================================================================
do
	local sim = fresh()
	sim:connect(1, 1, 5)
	advance(sim, 30)
	check("neutral cell flips owner", sim.cells[5].owner == 1, `owner {sim.cells[5].owner}`)
	check("captured cell then reinforces", (function()
		sim.cells[5].units = 1 -- it has long since filled; drain it to watch regen
		advance(sim, 2)
		return sim.cells[5].units > 1
	end)())
	check("captured cell never exceeds capacity", sim.cells[5].units <= sim.cells[5].capacity)
end

do
	local sim = fresh()
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
	advance(sim, 40)

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
	-- Losing the source cell kills the tentacle and the column dies with it;
	-- only a deliberate cut pushes energy forward.
	local sim = fresh()
	sim.cells[5].owner = 1
	sim.cells[5].units = 30
	sim:connect(1, 5, 4)
	advance(sim, 2)
	local inFlight = sim:payload(sim.tentacles[1])
	local targetBefore = sim.cells[4].units

	sim.cells[5].owner = 2 -- simulate the cell flipping mid-flight
	advance(sim, 1)
	check("orphaned tentacle is dropped", next(sim.tentacles) == nil)
	check("its column is lost, not delivered", sim.cells[4].units == targetBefore, `in flight was {inFlight}`)
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
print("round clock, tiebreak and stars")
--=============================================================================
do
	local sim = fresh()
	check("clock starts full", near(sim:timeRemaining(), Config.ROUND_TIME_LIMIT, 1e-6))
	advance(sim, 10)
	check("clock counts down", near(sim:timeRemaining(), Config.ROUND_TIME_LIMIT - 10, 0.05))

	sim.elapsed = Config.ROUND_TIME_LIMIT + 50
	check("clock clamps at zero", sim:timeRemaining() == 0)

	local byCells = fresh()
	byCells.cells[7].owner = 2
	byCells.cells[10].owner = 2
	check("leader is whoever holds most cells", byCells:leader() == 2)

	local byUnits = fresh()
	for _, id in byUnits.cellIds do
		byUnits.cells[id].owner = Config.NEUTRAL
	end
	byUnits.cells[1].owner = 1
	byUnits.cells[1].units = 10
	byUnits.cells[2].owner = 2
	byUnits.cells[2].units = 40
	check("units break a cell-count tie", byUnits:leader() == 2)

	local stars = fresh()
	local times = Crossroads.starTimes
	stars.elapsed = times[1] - 1
	check("fast clear earns three stars", stars:stars() == 3)
	stars.elapsed = times[2] - 1
	check("middling clear earns two stars", stars:stars() == 2)
	stars.elapsed = times[3] - 1
	check("slow clear earns one star", stars:stars() == 1)
	stars.elapsed = times[3] + 1
	check("crawling clear earns none", stars:stars() == 0)
end

--=============================================================================
print("snapshot")
--=============================================================================
do
	local sim = fresh()
	sim:connect(1, 1, 4)
	advance(sim, 6)

	local snapshot = sim:snapshot()
	check("snapshot covers every cell", #snapshot.cells == #sim.cellIds)
	check("snapshot covers every tentacle", #snapshot.tentacles == 1)
	check("snapshot units are integers", snapshot.cells[1].units % 1 == 0)
	check("snapshot omits static fields", snapshot.cells[1].position == nil)
	check("snapshot carries the clock", near(snapshot.remaining, Config.ROUND_TIME_LIMIT - 6, 0.1))
	check("snapshot carries pulse positions", #snapshot.tentacles[1].pulses > 0)
	check("snapshot carries the standing charge", snapshot.tentacles[1].payload > 0)

	local ordered = true
	local previous = math.huge
	for _, position in snapshot.tentacles[1].pulses do
		if position > previous then
			ordered = false
		end
		previous = position
	end
	check("pulses are ordered oldest first", ordered)
end

--=============================================================================
print("purple cuts, red does not")
--=============================================================================
do
	local board = {
		{ id = 1, position = Vector2.new(150, 300), tier = 3, owner = 3, units = 90 },
		{ id = 2, position = Vector2.new(500, 300), tier = 1, owner = 1, units = 10 },
	}

	local function timeToCapture(profile: string): number
		math.randomseed(7)
		local sim = Simulation.new(custom(board, { 1, 3 }, { [3] = profile }))
		local bot = AI.new(sim, 3, profile)
		local elapsed = 0
		while sim.cells[2].owner ~= 3 and elapsed < 120 do
			sim:step(STEP)
			bot:step(STEP)
			elapsed += STEP
		end
		return elapsed
	end

	local red = timeToCapture("Red")
	local purple = timeToCapture("Purple")

	check("red eventually takes the cell", red < 120, `{math.floor(red)}s`)
	check("purple takes it too", purple < 120, `{math.floor(purple)}s`)
	check("purple is faster because it cuts", purple < red, `purple {math.floor(purple)}s vs red {math.floor(red)}s`)
	print(`  ..   purple {string.format("%.1f", purple)}s vs red {string.format("%.1f", red)}s`)
end

--=============================================================================
print("full AI matches")
--=============================================================================
for _, level in { Incision, Crossroads } do
	local resolved, longest = 0, 0
	local SEEDS = 25

	for seed = 1, SEEDS do
		math.randomseed(seed)
		local sim = Simulation.new(level)
		local bots = {}
		for _, faction in level.factions do
			table.insert(bots, AI.new(sim, faction, (level.ai or {})[faction]))
		end

		local elapsed, winner = 0, nil
		while elapsed < Config.ROUND_TIME_LIMIT and not winner do
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

	check(`{level.name}: every AI match resolves`, resolved == SEEDS, `{resolved}/{SEEDS} resolved`)
	check(
		`{level.name}: matches finish inside the round clock`,
		longest < Config.ROUND_TIME_LIMIT,
		`longest {math.floor(longest)}s`
	)
	print(`  ..   {level.name}: longest {math.floor(longest)}s of {Config.ROUND_TIME_LIMIT}s`)
end

print(`\n{passed} passed, {failed} failed`)
if failed > 0 then
	error(`{failed} test(s) failed`, 0)
end
