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

function Simulation.cut(self: Simulation, owner: number, tentacleId: number): boolean
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

local function stepTentacles(self: Simulation, dt: number)
	-- Snapshot the id list: capture handlers mutate it while we iterate.
	local ids = table.clone(self.tentacleIds)
	local doomed: { number } = {}

	for _, id in ids do
		local tentacle = self.tentacles[id]
		if not tentacle then
			continue
		end

		local source = self.cells[tentacle.from]
		-- The source flipped to somebody else while this tentacle was growing.
		if source.owner ~= tentacle.owner then
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

		local amount = math.min(Config.FLOW_RATE * dt, source.units)
		if amount <= 0 then
			continue
		end
		source.units -= amount

		local target = self.cells[tentacle.to]
		if target.owner == tentacle.owner then
			target.units = math.min(target.capacity, target.units + amount)
		else
			target.units -= amount
			if target.units <= 0 then
				-- Overflow carries into the captured cell rather than being lost.
				target.units = -target.units
				onCaptured(self, target, tentacle.owner)
			end
		end
	end

	for _, id in doomed do
		self:removeTentacle(id)
	end
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
		table.insert(tentacles, {
			id = tentacle.id,
			from = tentacle.from,
			to = tentacle.to,
			owner = tentacle.owner,
			progress = tentacle.progress,
			connected = tentacle.connected,
		})
	end

	return { cells = cells, tentacles = tentacles, remaining = self:timeRemaining() }
end

return Simulation
