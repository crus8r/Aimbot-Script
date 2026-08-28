--!strict
-- Authoritative game state. Pure Luau: no Instances, no remotes, no yielding.
-- The server owns one of these per round and steps it at a fixed rate; the
-- client never runs it (it only draws the snapshots that come out of it).

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Types = require(ReplicatedStorage.Shared.Types)

local Simulation = {}
Simulation.__index = Simulation

export type Simulation = typeof(setmetatable(
	{} :: {
		level: Types.Level,
		cells: { [number]: Types.Cell },
		cellIds: { number },
		tentacles: { [number]: Types.Tentacle },
		tentacleIds: { number },
		nextTentacleId: number,
		elapsed: number,
	},
	Simulation
))

function Simulation.new(level: Types.Level): Simulation
	local self = setmetatable({
		level = level,
		cells = {},
		cellIds = {},
		tentacles = {},
		tentacleIds = {},
		nextTentacleId = 1,
		elapsed = 0,
	}, Simulation)

	for _, spec in level.cells do
		local tier = Config.tierOf(spec.tier)
		self.cells[spec.id] = {
			id = spec.id,
			position = spec.position,
			tier = spec.tier,
			radius = tier.radius,
			capacity = tier.capacity,
			regen = tier.regen,
			slots = tier.slots,
			owner = spec.owner or Config.NEUTRAL,
			units = spec.units or 0,
		}
		table.insert(self.cellIds, spec.id)
	end

	return self
end

--=============================================================================
-- Queries
--=============================================================================

function Simulation.outboundCount(self: Simulation, cellId: number): number
	local count = 0
	for _, id in self.tentacleIds do
		if self.tentacles[id].from == cellId then
			count += 1
		end
	end
	return count
end

function Simulation.findTentacle(self: Simulation, fromId: number, toId: number): Types.Tentacle?
	for _, id in self.tentacleIds do
		local tentacle = self.tentacles[id]
		if tentacle.from == fromId and tentacle.to == toId then
			return tentacle
		end
	end
	return nil
end

-- Energy currently standing inside a tentacle: what a cut would dump forward.
function Simulation.payload(self: Simulation, tentacle: Types.Tentacle): number
	local total = 0
	for _, pulse in tentacle.pulses do
		total += pulse.amount
	end
	return total
end

-- Energy already committed toward a cell, so a caller does not over-invest in a
-- target that in-flight pulses are about to take anyway.
function Simulation.incoming(self: Simulation, cellId: number, owner: number): number
	local total = 0
	for _, id in self.tentacleIds do
		local tentacle = self.tentacles[id]
		if tentacle.to == cellId and tentacle.owner == owner then
			total += self:payload(tentacle)
		end
	end
	return total
end

function Simulation.cellCount(self: Simulation, owner: number): number
	local count = 0
	for _, id in self.cellIds do
		if self.cells[id].owner == owner then
			count += 1
		end
	end
	return count
end

-- A faction is alive while it holds a cell, or while a tentacle it launched is
-- still in flight and might yet capture one.
function Simulation.isAlive(self: Simulation, owner: number): boolean
	if self:cellCount(owner) > 0 then
		return true
	end
	for _, id in self.tentacleIds do
		if self.tentacles[id].owner == owner then
			return true
		end
	end
	return false
end

-- Returns the winning faction once exactly one is left, otherwise nil.
function Simulation.winner(self: Simulation): number?
	local survivor: number? = nil
	for _, faction in self.level.factions do
		if self:isAlive(faction) then
			if survivor then
				return nil
			end
			survivor = faction
		end
	end
	return survivor
end

-- Who is ahead right now: most cells, then most units banked. Used to settle a
-- round that hits the time limit rather than leaving it undecided.
function Simulation.leader(self: Simulation): number
	local bestFaction = self.level.factions[1]
	local bestCells, bestUnits = -1, -1

	for _, faction in self.level.factions do
		local cells, units = 0, 0
		for _, id in self.cellIds do
			local cell = self.cells[id]
			if cell.owner == faction then
				cells += 1
				units += cell.units
			end
		end
		if cells > bestCells or (cells == bestCells and units > bestUnits) then
			bestFaction, bestCells, bestUnits = faction, cells, units
		end
	end

	return bestFaction
end

function Simulation.timeRemaining(self: Simulation): number
	return math.max(0, Config.ROUND_TIME_LIMIT - self.elapsed)
end

-- Stars are purely a speed award: three for a fast clear, none for a slow one.
function Simulation.stars(self: Simulation): number
	local thresholds = self.level.starTimes
	if not thresholds then
		return 0
	end
	for index, limit in thresholds do
		if self.elapsed <= limit then
			return #thresholds - index + 1
		end
	end
	return 0
end

--=============================================================================
-- Commands
--=============================================================================

-- Returns true if the tentacle was started, or false plus a reason string.
-- Every caller is untrusted, so this validates the whole request.
function Simulation.connect(self: Simulation, owner: number, fromId: number, toId: number): (boolean, string?)
	if fromId == toId then
		return false, "same cell"
	end

	local from = self.cells[fromId]
	local to = self.cells[toId]
	if not from or not to then
		return false, "no such cell"
	end
	if from.owner ~= owner then
		return false, "source not owned"
	end
	if self:findTentacle(fromId, toId) then
		return false, "already connected"
	end
	if self:outboundCount(fromId) >= from.slots then
		return false, "no free slots"
	end

	local length = (to.position - from.position).Magnitude
	if length > Config.MAX_CONNECT_DISTANCE then
		return false, "out of range"
	end

	local id = self.nextTentacleId
	self.nextTentacleId += 1
	self.tentacles[id] = {
		id = id,
		from = fromId,
		to = toId,
		owner = owner,
		length = length,
		progress = 0,
		connected = false,
		sinceEmit = 0,
		pulses = {},
	}
	table.insert(self.tentacleIds, id)
	return true, nil
end

function Simulation.removeTentacle(self: Simulation, tentacleId: number)
	if not self.tentacles[tentacleId] then
		return
	end
	self.tentacles[tentacleId] = nil
	local index = table.find(self.tentacleIds, tentacleId)
	if index then
		table.remove(self.tentacleIds, index)
	end
end

--=============================================================================
-- Energy delivery
--=============================================================================

-- When a cell changes hands, anything the previous owner was pumping out of it
-- dies with the cell. Incoming tentacles survive and simply start attacking the
-- new owner on the next step.
local function onCaptured(self: Simulation, cell: Types.Cell, newOwner: number)
	cell.owner = newOwner

	local doomed = {}
	for _, id in self.tentacleIds do
		local tentacle = self.tentacles[id]
		if tentacle.from == cell.id and tentacle.owner ~= newOwner then
			table.insert(doomed, id)
		end
	end
	for _, id in doomed do
		self:removeTentacle(id)
	end
end

local function deliver(self: Simulation, tentacle: Types.Tentacle, amount: number)
	if amount <= 0 then
		return
	end
	local target = self.cells[tentacle.to]

	if target.owner == tentacle.owner then
		target.units = math.min(target.capacity, target.units + amount)
		return
	end

	target.units -= amount
	if target.units <= 0 then
		-- Overflow carries into the captured cell rather than being lost.
		target.units = math.min(target.capacity, -target.units)
		onCaptured(self, target, tentacle.owner)
	end
end

-- Severing a tentacle at the source end pushes its whole standing column
-- forward at once instead of letting it trickle. This is the game's signature
-- move: charge a long tentacle, then cut to land the burst.
function Simulation.cut(self: Simulation, owner: number, tentacleId: number): boolean
	local tentacle = self.tentacles[tentacleId]
	if not tentacle or tentacle.owner ~= owner then
		return false
	end

	deliver(self, tentacle, self:payload(tentacle))
	self:removeTentacle(tentacleId)
	return true
end

-- Abandon a tentacle without flushing it: the column is lost. This is how a
-- cell stops feeding a line it can no longer afford, and it is deliberately
-- worse than cutting -- cutting is the skilled move.
function Simulation.detach(self: Simulation, owner: number, tentacleId: number): boolean
	local tentacle = self.tentacles[tentacleId]
	if not tentacle or tentacle.owner ~= owner then
		return false
	end
	self:removeTentacle(tentacleId)
	return true
end

--=============================================================================
-- Step
--=============================================================================

local function regenerate(self: Simulation, dt: number)
	for _, id in self.cellIds do
		local cell = self.cells[id]
		local inert = cell.owner == Config.NEUTRAL and not Config.NEUTRAL_REGENERATES
		if not inert and cell.units < cell.capacity then
			cell.units = math.min(cell.capacity, cell.units + cell.regen * dt)
		end
	end
end

local function emit(self: Simulation, tentacle: Types.Tentacle, dt: number)
	local source = self.cells[tentacle.from]
	tentacle.sinceEmit += dt

	while tentacle.sinceEmit >= Config.PULSE_INTERVAL do
		tentacle.sinceEmit -= Config.PULSE_INTERVAL
		local amount = math.min(Config.FLOW_RATE * Config.PULSE_INTERVAL, source.units)
		if amount <= 0 then
			break
		end
		source.units -= amount
		table.insert(tentacle.pulses, { amount = amount, position = 0 })
	end
end

local function advance(self: Simulation, tentacle: Types.Tentacle, dt: number)
	local index = 1
	while index <= #tentacle.pulses do
		local pulse = tentacle.pulses[index]
		pulse.position += Config.PULSE_SPEED * dt
		if pulse.position >= tentacle.length then
			table.remove(tentacle.pulses, index)
			deliver(self, tentacle, pulse.amount)
		else
			index += 1
		end
	end
end

-- Opposing columns on the same line annihilate where they overlap.
local function annihilate(a: Types.Tentacle, b: Types.Tentacle)
	local i = 1
	while i <= #a.pulses do
		local pa = a.pulses[i]
		local consumed = false

		local j = 1
		while j <= #b.pulses do
			local pb = b.pulses[j]
			-- b runs the other way, so measure its pulse from a's source.
			local gap = math.abs(pa.position - (a.length - pb.position))
			if gap <= Config.PULSE_COLLISION_RADIUS then
				local hit = math.min(pa.amount, pb.amount)
				pa.amount -= hit
				pb.amount -= hit

				if pb.amount <= 1e-6 then
					table.remove(b.pulses, j)
				else
					j += 1
				end
				if pa.amount <= 1e-6 then
					table.remove(a.pulses, i)
					consumed = true
					break
				end
			else
				j += 1
			end
		end

		if not consumed then
			i += 1
		end
	end
end

local function resolveCollisions(self: Simulation)
	local ids = self.tentacleIds
	for i = 1, #ids do
		local a = self.tentacles[ids[i]]
		if not a or #a.pulses == 0 then
			continue
		end
		for j = i + 1, #ids do
			local b = self.tentacles[ids[j]]
			if b and #b.pulses > 0 and a.from == b.to and a.to == b.from and a.owner ~= b.owner then
				annihilate(a, b)
			end
		end
	end
end

local function stepTentacles(self: Simulation, dt: number)
	-- Snapshot the id list: capture handlers mutate it while we iterate.
	local ids = table.clone(self.tentacleIds)
	local doomed: { number } = {}

	for _, id in ids do
		local tentacle = self.tentacles[id]
		if not tentacle then
			continue
		end

		-- The source flipped to somebody else. The tentacle collapses backward
		-- and its column is lost -- only a deliberate cut pushes it forward.
		if self.cells[tentacle.from].owner ~= tentacle.owner then
			table.insert(doomed, id)
			continue
		end

		if not tentacle.connected then
			tentacle.progress = math.min(1, tentacle.progress + (Config.TENTACLE_GROWTH_SPEED * dt) / tentacle.length)
			if tentacle.progress >= 1 then
				tentacle.connected = true
			end
			continue
		end

		emit(self, tentacle, dt)
		advance(self, tentacle, dt)
	end

	for _, id in doomed do
		self:removeTentacle(id)
	end

	resolveCollisions(self)
end

function Simulation.step(self: Simulation, dt: number)
	self.elapsed += dt
	regenerate(self, dt)
	stepTentacles(self, dt)
end

--=============================================================================
-- Replication
--=============================================================================

function Simulation.snapshot(self: Simulation): Types.Snapshot
	local cells: { Types.CellState } = table.create(#self.cellIds)
	for _, id in self.cellIds do
		local cell = self.cells[id]
		table.insert(cells, {
			id = cell.id,
			owner = cell.owner,
			-- Units are only ever displayed as whole numbers; flooring here
			-- keeps the packet small and the client honest about rounding.
			units = math.floor(cell.units),
		})
	end

	local tentacles: { Types.TentacleState } = table.create(#self.tentacleIds)
	for _, id in self.tentacleIds do
		local tentacle = self.tentacles[id]

		local positions = table.create(#tentacle.pulses)
		for _, pulse in tentacle.pulses do
			table.insert(positions, pulse.position)
		end

		table.insert(tentacles, {
			id = tentacle.id,
			from = tentacle.from,
			to = tentacle.to,
			owner = tentacle.owner,
			progress = tentacle.progress,
			connected = tentacle.connected,
			payload = math.floor(self:payload(tentacle)),
			pulses = positions,
		})
	end

	return { cells = cells, tentacles = tentacles, remaining = self:timeRemaining() }
end

return Simulation
