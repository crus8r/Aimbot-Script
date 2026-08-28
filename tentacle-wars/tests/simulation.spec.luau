--!nocheck
-- Headless tests for the authoritative simulation. Run with tests/run.sh.

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

-- Runs until `predicate` holds, returning the seconds taken (or nil on timeout).
local function advanceUntil(sim, seconds: number, predicate): number?
	local elapsed = 0
	while elapsed < seconds do
		sim:step(STEP)
		elapsed += STEP
		if predicate() then
			return elapsed
		end
	end
	return nil
end

local function custom(cells, factions, extra)
	local level = { name = "Test", factions = factions, cells = cells, powerLimit = 60 }
	for key, value in extra or {} do
		level[key] = value
	end
	return level
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

	-- Every faction needs a home that can afford to reach something, or it can
	-- never make a move at all.
	local broke = nil
	for _, faction in level.factions do
		local canReach = false
		for _, spec in level.cells do
			if spec.owner == faction then
				for _, other in level.cells do
					if other.id ~= spec.id then
						local distance = (other.position - spec.position).Magnitude
						if distance <= Config.MAX_CONNECT_DISTANCE then
							local cost = Config.costOf(sim:spanBetween(spec.id, other.id))
							if (spec.value or 0) - cost >= 1 then
								canReach = true
							end
						end
					end
				end
			end
		end
		if not canReach then
			broke = faction
		end
	end
	check(`{level.name}: every faction can afford a first move`, broke == nil, `faction {tostring(broke)}`)
	check(`{level.name}: starting values fit the limit`, (function()
		for _, spec in level.cells do
			if (spec.value or 0) > (level.powerLimit or Config.POWER_LIMIT) then
				return false
			end
		end
		return true
	end)())
end

--=============================================================================
print("building a chain costs the source")
--=============================================================================
do
	local sim = Simulation.new(Incision)
	local span = sim:spanBetween(1, 4)
	local cost = Config.costOf(span)
	local before = sim.cells[1].value

	check("connect is accepted", (sim:connect(1, 1, 4)))
	local reached = advanceUntil(sim, 20, function()
		return sim.tentacles[1] and sim.tentacles[1].attached
	end)
	check("chain reaches the target", reached ~= nil, "never attached")
	check(
		"the source paid for the length",
		near(sim.cells[1].value, before - cost, 3), -- regeneration runs during the build
		`spent {before - sim.cells[1].value}, expected ~{cost}`
	)
	check("chain length equals the span", near(sim.tentacles[1].length, span, 0.001))
	check("stored charge matches what was spent", near(sim:charge(sim.tentacles[1]), cost, 1))
end

do
	-- Overreach: not enough energy to span the gap. It stretches, empties the
	-- cell, is forced home, and refunds everything on the way back.
	local board = {
		{ id = 1, position = Vector2.new(100, 300), owner = 1, value = 5 },
		{ id = 2, position = Vector2.new(500, 300), value = 20 },
	}
	local sim = Simulation.new(custom(board, { 1 }))
	sim:connect(1, 1, 2)

	advance(sim, 0.5)
	check("stretching drains the cell as it goes", sim.cells[1].value < 5, `value {sim.cells[1].value}`)
	check("it has not reached", sim.tentacles[1] ~= nil and not sim.tentacles[1].attached)

	local emptied = advanceUntil(sim, 10, function()
		return sim.tentacles[1] ~= nil and sim.tentacles[1].retracting
	end)
	check("running dry forces it home", emptied ~= nil)

	local gone = advanceUntil(sim, 20, function()
		return next(sim.tentacles) == nil
	end)
	check("the chain reels all the way in", gone ~= nil)
	check("the target was never touched", sim.cells[2].value == 20)
	-- Regeneration runs during all this, so it should be at least what it was.
	check("the energy came back", sim.cells[1].value >= 5, `value {sim.cells[1].value}`)
end

--=============================================================================
print("pulsing is free")
--=============================================================================
do
	local board = {
		{ id = 1, position = Vector2.new(150, 300), owner = 1, value = 40 },
		{ id = 2, position = Vector2.new(400, 300), owner = 2, value = 40 },
	}
	local sim = Simulation.new(custom(board, { 1, 2 }))
	sim:connect(1, 1, 2)
	advanceUntil(sim, 20, function()
		return sim.tentacles[1].attached
	end)

	local sourceAtAttach = sim.cells[1].value
	local targetAtAttach = sim.cells[2].value
	advance(sim, 12)

	-- The source is not spending to pulse, so regeneration only pushes it up.
	check(
		"the source does not drain while pulsing",
		sim.cells[1].value >= sourceAtAttach,
		`{sourceAtAttach} -> {sim.cells[1].value}`
	)
	check("pulses land on the target", sim.cells[2].value < targetAtAttach)
	check("pulses are in flight", #sim.tentacles[1].pulses > 0)
end

do
	-- Pulse rate is a function of the source's current value, so a fed cell
	-- attacks measurably faster than a starved one.
	local function rateAt(value: number): number
		local board = {
			{ id = 1, position = Vector2.new(150, 300), owner = 1, value = value },
			-- Close enough that even a starved cell can afford to reach it.
			{ id = 2, position = Vector2.new(280, 300), owner = 2, value = 55 },
		}
		local sim = Simulation.new(custom(board, { 1, 2 }))
		sim:connect(1, 1, 2)
		advanceUntil(sim, 20, function()
			return sim.tentacles[1] ~= nil and sim.tentacles[1].attached
		end)
		sim.cells[1].value = value -- hold the class steady
		local landed = 0
		for _ = 1, math.floor(20 / STEP) do
			local before = sim.cells[2].value
			sim:step(STEP)
			sim.cells[1].value = value
			if sim.cells[2].value < before then
				landed += 1
			end
		end
		return landed
	end

	local low, high = rateAt(10), rateAt(60)
	check("a fed cell pulses faster than a starved one", high > low, `{low} vs {high} hits`)
	check("class bands are ordered", Config.pulseInterval(60) < Config.pulseInterval(10))
	check("a cell at 1 cannot pulse", Config.pulseInterval(1) == nil)
end

do
	check("a starved cell holds one line", Config.slotsFor(5) == 1)
	check("15 buys a second line", Config.slotsFor(15) == 2)
	check("slots keep climbing", Config.slotsFor(60) > Config.slotsFor(35))

	local board = {
		{ id = 1, position = Vector2.new(150, 300), owner = 1, value = 8 },
		{ id = 2, position = Vector2.new(300, 300), value = 5 },
		{ id = 3, position = Vector2.new(150, 450), value = 5 },
	}
	local sim = Simulation.new(custom(board, { 1 }))
	check("first line opens", (sim:connect(1, 1, 2)))
	local ok, reason = sim:connect(1, 1, 3)
	check("a low cell cannot open a second", not ok, tostring(reason))
end

--=============================================================================
print("cutting")
--=============================================================================
do
	local function attached(value: number)
		local board = {
			{ id = 1, position = Vector2.new(150, 300), owner = 1, value = value },
			-- Neutral, so it neither regenerates nor spends: every point of
			-- change to it is something this chain delivered.
			{ id = 2, position = Vector2.new(520, 300), value = 40 },
		}
		local sim = Simulation.new(custom(board, { 1 }))
		sim:connect(1, 1, 2)
		advanceUntil(sim, 25, function()
			return sim.tentacles[1].attached
		end)
		return sim
	end

	-- Cut at the source: the whole column goes forward.
	local sim = attached(50)
	local charge = sim:charge(sim.tentacles[1])
	local targetBefore = sim.cells[2].value
	local sourceBefore = sim.cells[1].value
	check("there is a charge worth throwing", charge > 10, `charge {charge}`)

	sim:cut(1, 1, 0)
	check("the chain is gone", next(sim.tentacles) == nil)
	advance(sim, 6)
	check(
		"cutting at the source discharges into the target",
		near(targetBefore - sim.cells[2].value, charge, 3),
		`dealt {targetBefore - sim.cells[2].value}, charge {charge}`
	)
	check("and refunds the source nothing", sim.cells[1].value <= sourceBefore + 5)

	-- Cut at the far end: it all comes home instead.
	local sim2 = attached(50)
	local charge2 = sim2:charge(sim2.tentacles[1])
	local source2 = sim2.cells[1].value
	local target2 = sim2.cells[2].value
	sim2:cut(1, 1, 1)
	advance(sim2, 6)
	check(
		"cutting at the target refunds the source",
		sim2.cells[1].value >= source2 + charge2 - 3,
		`{source2} -> {sim2.cells[1].value}, charge {charge2}`
	)
	check("and leaves the target alone", sim2.cells[2].value >= target2)

	-- Cut in the middle: half each way.
	local sim3 = attached(50)
	local charge3 = sim3:charge(sim3.tentacles[1])
	local source3 = sim3.cells[1].value
	local target3 = sim3.cells[2].value
	sim3:cut(1, 1, 0.5)
	advance(sim3, 6)
	check(
		"cutting halfway splits the column",
		near(target3 - sim3.cells[2].value, charge3 / 2, 3),
		`dealt {target3 - sim3.cells[2].value}, half of {charge3}`
	)
	check("and refunds the other half", sim3.cells[1].value >= source3 + charge3 / 2 - 3)
end

do
	-- Surrounding a cell and cutting all at once is the finishing move: three
	-- chains land their columns faster than the target can regenerate.
	local board = {
		{ id = 1, position = Vector2.new(500, 120), owner = 1, value = 55 },
		{ id = 2, position = Vector2.new(320, 420), owner = 1, value = 55 },
		{ id = 3, position = Vector2.new(680, 420), owner = 1, value = 55 },
		{ id = 4, position = Vector2.new(500, 320), owner = 2, value = 28, radius = 34 },
	}
	local sim = Simulation.new(custom(board, { 1, 2 }))
	for _, from in { 1, 2, 3 } do
		sim:connect(1, from, 4)
	end
	advanceUntil(sim, 30, function()
		for _, id in sim.tentacleIds do
			if not sim.tentacles[id].attached then
				return false
			end
		end
		return true
	end)

	check("all three reach", #sim.tentacleIds == 3)
	for _, id in table.clone(sim.tentacleIds) do
		sim:cut(1, id, 0)
	end
	local taken = advanceUntil(sim, 15, function()
		return sim.cells[4].owner == 1
	end)
	check("a simultaneous cut takes a defended cell", taken ~= nil, "survived the volley")
end

--=============================================================================
print("clashing")
--=============================================================================
do
	local board = {
		{ id = 1, position = Vector2.new(250, 300), owner = 1, value = 55 },
		{ id = 2, position = Vector2.new(650, 300), owner = 2, value = 55 },
	}
	local sim = Simulation.new(custom(board, { 1, 2 }))
	sim:connect(1, 1, 2)
	sim:connect(2, 2, 1)
	advance(sim, 12)

	local a, b = sim.tentacles[1], sim.tentacles[2]
	check("both chains are still out", a ~= nil and b ~= nil)
	check("neither reaches the other", not a.attached and not b.attached)
	check("they share the lane exactly", a.length + b.length <= a.span + 0.001, `{a.length} + {b.length} vs {a.span}`)
	check("they meet near the middle", near(a.length, b.length, a.span * 0.25), `{a.length} vs {b.length}`)
	check("nobody is losing cells", sim.cells[1].owner == 1 and sim.cells[2].owner == 2)

	-- A chain held off is not touching anything, so cutting it throws nothing.
	-- Checked on the collapse itself: the target cell is also paying to extend
	-- its own chain, so its value is not a clean measure of what arrived.
	sim:cut(1, a.id, 0)
	local discharge = nil
	for _, id in sim.collapseIds do
		if sim.collapses[id].mode == "discharge" then
			discharge = sim.collapses[id]
		end
	end
	check("cutting a blocked chain throws nothing", discharge ~= nil and not discharge.delivers)
end

do
	-- Pushing back costs the pusher and refunds the pushed.
	local board = {
		{ id = 1, position = Vector2.new(250, 300), owner = 1, value = 55 },
		{ id = 2, position = Vector2.new(650, 300), owner = 2, value = 55 },
	}
	local sim = Simulation.new(custom(board, { 1 }))
	sim:connect(1, 1, 2)
	advanceUntil(sim, 25, function()
		return sim.tentacles[1].attached
	end)

	local reach = sim.tentacles[1].length
	sim.cells[2].owner = 2
	sim:connect(2, 2, 1)
	advance(sim, 5)
	check("the counter-chain shoves the attacker back", sim.tentacles[1].length < reach, `{reach} -> {sim.tentacles[1].length}`)
	check("being shoved off breaks the attachment", not sim.tentacles[1].attached)
end

--=============================================================================
print("capture")
--=============================================================================
do
	local board = {
		{ id = 1, position = Vector2.new(150, 300), owner = 1, value = 55 },
		{ id = 2, position = Vector2.new(430, 300), value = 6 },
	}
	local sim = Simulation.new(custom(board, { 1 }))
	sim:connect(1, 1, 2)
	local taken = advanceUntil(sim, 40, function()
		return sim.cells[2].owner == 1
	end)
	check("a neutral cell falls", taken ~= nil)
	check(
		"taking a neutral hands over a garrison",
		sim.cells[2].value >= Config.NEUTRAL_CAPTURE_BONUS - 1,
		`value {sim.cells[2].value}`
	)
end

do
	local board = {
		{ id = 1, position = Vector2.new(150, 300), owner = 1, value = 55 },
		{ id = 2, position = Vector2.new(430, 300), owner = 2, value = 4 },
		{ id = 3, position = Vector2.new(430, 550), value = 20 },
	}
	local sim = Simulation.new(custom(board, { 1, 2 }))
	sim:connect(2, 2, 3) -- the victim is pumping out of the cell about to fall
	sim:connect(1, 1, 2)
	local victimChain = sim.tentacles[1]

	local taken = advanceUntil(sim, 60, function()
		return sim.cells[2].owner == 1
	end)
	check("a defended cell falls", taken ~= nil)
	check("its outbound chain dies with it", sim.tentacles[victimChain.id] == nil)
	check("the attacker only keeps the overflow", sim.cells[2].value < Config.NEUTRAL_CAPTURE_BONUS)
end

--=============================================================================
print("regeneration and limit")
--=============================================================================
do
	local board = {
		{ id = 1, position = Vector2.new(150, 300), owner = 1, value = 10 },
		{ id = 2, position = Vector2.new(500, 300), value = 10 },
	}
	local sim = Simulation.new(custom(board, { 1 }))
	advance(sim, Config.REGEN_INTERVAL * 5 + 0.05)
	check("owned cells tick up", near(sim.cells[1].value, 15, 1), `value {sim.cells[1].value}`)
	check("neutral cells sit inert", sim.cells[2].value == 10)

	sim.cells[1].value = sim.limit
	advance(sim, 10)
	check("the limit is a ceiling", sim.cells[1].value == sim.limit)
	check("the level sets the limit", Simulation.new(Crossroads).limit == Crossroads.powerLimit)
end

--=============================================================================
print("round bookkeeping")
--=============================================================================
do
	local sim = Simulation.new(Incision)
	check("no winner at the start", sim:winner() == nil)
	sim.cells[2].owner = 1
	check("last faction standing wins", sim:winner() == 1)

	local byCells = Simulation.new(Incision)
	byCells.cells[4].owner = 2
	check("leader is whoever holds most cells", byCells:leader() == 2)

	local stars = Simulation.new(Incision)
	local times = Incision.starTimes
	stars.elapsed = times[1] - 1
	check("fast clear earns three stars", stars:stars() == 3)
	stars.elapsed = times[3] + 1
	check("crawling clear earns none", stars:stars() == 0)

	local snap = Simulation.new(Incision)
	snap:connect(1, 1, 4)
	advance(snap, 3)
	local snapshot = snap:snapshot()
	check("snapshot covers every cell", #snapshot.cells == #snap.cellIds)
	check("snapshot carries the chain", #snapshot.tentacles == 1 and snapshot.tentacles[1].length > 0)
	check("snapshot carries the limit", snapshot.limit == snap.limit)
	snap:cut(1, 1, 0.5)
	check("snapshot carries collapsing halves", #snap:snapshot().collapses == 2)
end

--=============================================================================
print("purple cuts, red does not")
--=============================================================================
do
	local board = {
		{ id = 1, position = Vector2.new(150, 300), owner = 3, value = 55 },
		{ id = 2, position = Vector2.new(520, 300), owner = 1, value = 22 },
	}

	local function timeToCapture(profile: string): number
		math.randomseed(11)
		local sim = Simulation.new(custom(board, { 1, 3 }, { ai = { [3] = profile } }))
		local bot = AI.new(sim, 3, profile)
		local elapsed = 0
		while sim.cells[2].owner ~= 3 and elapsed < 200 do
			sim:step(STEP)
			bot:step(STEP)
			elapsed += STEP
		end
		return elapsed
	end

	local red, purple = timeToCapture("Red"), timeToCapture("Purple")
	check("red takes the cell", red < 200, `{math.floor(red)}s`)
	check("purple takes the cell", purple < 200, `{math.floor(purple)}s`)
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
	print(`  ..   {level.name}: longest {math.floor(longest)}s of {Config.ROUND_TIME_LIMIT}s`)
end

print(`\n{passed} passed, {failed} failed`)
if failed > 0 then
	error(`{failed} test(s) failed`, 0)
end
