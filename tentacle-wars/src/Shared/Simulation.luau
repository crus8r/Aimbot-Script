--!strict
-- Authoritative game state. Pure Luau: no Instances, no remotes, no yielding.
--
-- The economy in one paragraph: a cell pays to *build* a tentacle -- one energy
-- per two segments, drawn out as it extends -- and that spent energy is stored
-- in the chain. Once the chain reaches its target it pulses for free, at a rate
-- set by the source cell's current value. Reeling a chain in refunds it at the
-- same rate it cost. Cutting splits it at the cut point: the near half refunds
-- into the source, the far half discharges into the target. So a long attached
-- chain is a loaded weapon, and where you cut decides how much you keep versus
-- how much you throw.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Types = require(ReplicatedStorage.Shared.Types)

local Simulation = {}
Simulation.__index = Simulation

export type Simulation = typeof(setmetatable(
	{} :: {
		level: Types.Level,
		limit: number,
		cells: { [number]: Types.Cell },
		cellIds: { number },
		tentacles: { [number]: Types.Tentacle },
		tentacleIds: { number },
		collapses: { [number]: Types.Collapse },
		collapseIds: { number },
		nextId: number,
		sinceRegen: number,
		elapsed: number,
	},
	Simulation
))

function Simulation.new(level: Types.Level): Simulation
	local self = setmetatable({
		level = level,
		limit = level.powerLimit or Config.POWER_LIMIT,
		cells = {},
		cellIds = {},
		tentacles = {},
		tentacleIds = {},
		collapses = {},
		collapseIds = {},
		nextId = 1,
		sinceRegen = 0,
		elapsed = 0,
	}, Simulation)

	for _, spec in level.cells do
		self.cells[spec.id] = {
			id = spec.id,
			position = spec.position,
			radius = spec.radius or Config.CELL_RADIUS,
			owner = spec.owner or Config.NEUTRAL,
			value = spec.value or 0,
		}
		table.insert(self.cellIds, spec.id)
	end

	return self
end

local function claimId(self: Simulation): number
	local id = self.nextId
	self.nextId += 1
	return id
end

--=============================================================================
-- Queries
--=============================================================================

-- Segments of open space between two cells, edge to edge.
function Simulation.spanBetween(self: Simulation, fromId: number, toId: number): number
	local from = self.cells[fromId]
	local to = self.cells[toId]
	local gap = (to.position - from.position).Magnitude - from.radius - to.radius
	return math.max(1, gap / Config.SEGMENT_LENGTH)
end

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

-- The chain coming the other way down the same lane, if there is one.
function Simulation.opposing(self: Simulation, tentacle: Types.Tentacle): Types.Tentacle?
	return self:findTentacle(tentacle.to, tentacle.from)
end

-- Energy stored in a chain: what a cut at the very source would throw forward.
function Simulation.charge(self: Simulation, tentacle: Types.Tentacle): number
	return math.floor(Config.costOf(tentacle.length))
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

function Simulation.isAlive(self: Simulation, owner: number): boolean
	if self:cellCount(owner) > 0 then
		return true
	end
	for _, id in self.tentacleIds do
		if self.tentacles[id].owner == owner then
			return true
		end
	end
	-- A discharge still in the air can yet take a cell.
	for _, id in self.collapseIds do
		local collapse = self.collapses[id]
		if collapse.owner == owner and collapse.delivers then
			return true
		end
	end
	return false
end

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

function Simulation.leader(self: Simulation): number
	local bestFaction = self.level.factions[1]
	local bestCells, bestValue = -1, -1

	for _, faction in self.level.factions do
		local cells, value = 0, 0
		for _, id in self.cellIds do
			local cell = self.cells[id]
			if cell.owner == faction then
				cells += 1
				value += cell.value
			end
		end
		if cells > bestCells or (cells == bestCells and value > bestValue) then
			bestFaction, bestCells, bestValue = faction, cells, value
		end
	end

	return bestFaction
end

function Simulation.timeRemaining(self: Simulation): number
	return math.max(0, Config.ROUND_TIME_LIMIT - self.elapsed)
end

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
	if from.value < 1 then
		return false, "nothing to spend"
	end
	if self:findTentacle(fromId, toId) then
		return false, "already connected"
	end
	-- Class is read live: a starved cell loses the right to open a second line.
	if self:outboundCount(fromId) >= Config.slotsFor(from.value) then
		return false, "no free slots"
	end
	if (to.position - from.position).Magnitude > Config.MAX_CONNECT_DISTANCE then
		return false, "out of range"
	end

	local id = claimId(self)
	self.tentacles[id] = {
		id = id,
		from = fromId,
		to = toId,
		owner = owner,
		span = self:spanBetween(fromId, toId),
		length = 0,
		attached = false,
		retracting = false,
		spendDebt = 0,
		refundDebt = 0,
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

local function removeCollapse(self: Simulation, collapseId: number)
	self.collapses[collapseId] = nil
	local index = table.find(self.collapseIds, collapseId)
	if index then
		table.remove(self.collapseIds, index)
	end
end

local function addCollapse(self: Simulation, collapse: Types.Collapse)
	self.collapses[collapse.id] = collapse
	table.insert(self.collapseIds, collapse.id)
end

-- Cut a chain at `fraction` of its current length, measured from the source.
-- Cut at 0 and the entire chain discharges into the target; cut at 1 and the
-- entire chain refunds into the source (which is just a retreat).
function Simulation.cut(self: Simulation, owner: number, tentacleId: number, fraction: number): boolean
	local tentacle = self.tentacles[tentacleId]
	if not tentacle or tentacle.owner ~= owner then
		return false
	end

	local near = tentacle.length * math.clamp(fraction, 0, 1)
	local far = tentacle.length - near
	self:removeTentacle(tentacleId)

	if near > 0 then
		addCollapse(self, {
			id = claimId(self),
			from = tentacle.from,
			to = tentacle.to,
			owner = owner,
			mode = "refund",
			delivers = true,
			remaining = near,
			outer = near,
			credit = 0,
		})
	end

	if far > 0 then
		addCollapse(self, {
			id = claimId(self),
			from = tentacle.from,
			to = tentacle.to,
			owner = owner,
			mode = "discharge",
			-- A chain held off by an opposing one is not touching anything, so
			-- its far half has nowhere to go. This is why being pushed back
			-- neutralises the threat of a cut.
			delivers = tentacle.attached,
			remaining = far,
			outer = tentacle.length,
			credit = 0,
		})
	end

	return true
end

-- Reel the whole chain home. Costs nothing but the time.
function Simulation.retract(self: Simulation, owner: number, tentacleId: number): boolean
	local tentacle = self.tentacles[tentacleId]
	if not tentacle or tentacle.owner ~= owner then
		return false
	end
	tentacle.retracting = true
	tentacle.attached = false
	table.clear(tentacle.pulses)
	return true
end

--=============================================================================
-- Value changes
--=============================================================================

local function forceDropOutbound(self: Simulation, cellId: number, newOwner: number)
	local doomed = {}
	for _, id in self.tentacleIds do
		local tentacle = self.tentacles[id]
		if tentacle.from == cellId and tentacle.owner ~= newOwner then
			table.insert(doomed, id)
		end
	end
	-- The chains die with the cell; their stored energy is simply lost.
	for _, id in doomed do
		self:removeTentacle(id)
	end
end

-- Applies one unit of effect to a cell from `owner`. Reinforcement is capped at
-- the level limit; damage never is.
local function applyUnit(self: Simulation, cell: Types.Cell, owner: number)
	if cell.owner == owner then
		cell.value = math.min(self.limit, cell.value + 1)
		return
	end

	cell.value -= 1
	if cell.value >= 0 then
		return
	end

	local wasNeutral = cell.owner == Config.NEUTRAL
	forceDropOutbound(self, cell.id, owner)
	cell.owner = owner
	-- Taking a neutral cell hands you a garrison; taking a defended one leaves
	-- you only the overflow you punched through with.
	cell.value = if wasNeutral then Config.NEUTRAL_CAPTURE_BONUS else math.min(self.limit, -cell.value)
end

--=============================================================================
-- Step
--=============================================================================

local function regenerate(self: Simulation, dt: number)
	self.sinceRegen += dt
	while self.sinceRegen >= Config.REGEN_INTERVAL do
		self.sinceRegen -= Config.REGEN_INTERVAL
		for _, id in self.cellIds do
			local cell = self.cells[id]
			if cell.owner ~= Config.NEUTRAL and cell.value < self.limit then
				cell.value += 1
			end
		end
	end
end

-- Reels a chain in by `amount` segments, refunding its owner as it goes.
local function reelIn(self: Simulation, tentacle: Types.Tentacle, amount: number)
	local taken = math.min(amount, tentacle.length)
	tentacle.length -= taken
	tentacle.refundDebt += taken

	-- Shoved off the target: it is no longer touching anything, so it stops
	-- pulsing and a cut has nowhere to discharge.
	if tentacle.attached and tentacle.length < tentacle.span then
		tentacle.attached = false
		table.clear(tentacle.pulses)
	end

	local source = self.cells[tentacle.from]
	while tentacle.refundDebt >= Config.SEGMENTS_PER_ENERGY do
		tentacle.refundDebt -= Config.SEGMENTS_PER_ENERGY
		-- Nothing to refund into if the cell changed hands underneath us.
		if source.owner == tentacle.owner and source.value < self.limit then
			source.value += 1
		end
	end
end

local function extend(self: Simulation, tentacle: Types.Tentacle, dt: number)
	local source = self.cells[tentacle.from]
	local wanted = math.min(Config.GROW_RATE * dt, tentacle.span - tentacle.length)
	if wanted <= 0 then
		tentacle.attached = true
		return
	end

	-- Two chains cannot occupy the same lane. Growing into an occupied one
	-- shoves it back toward its own cell, refunding its owner as it retreats.
	local other = self:opposing(tentacle)
	local room = tentacle.span - tentacle.length - (if other then other.length else 0)
	if room < wanted and other and other.length > 0 then
		reelIn(self, other, math.min(wanted - room, other.length))
		room = tentacle.span - tentacle.length - other.length
	end

	local grown = math.max(0, math.min(wanted, room))
	if grown <= 0 then
		return
	end

	tentacle.length += grown
	tentacle.spendDebt += grown
	while tentacle.spendDebt >= Config.SEGMENTS_PER_ENERGY do
		tentacle.spendDebt -= Config.SEGMENTS_PER_ENERGY
		source.value -= 1
	end

	if source.value <= 0 then
		-- Stretched further than the cell could afford: it has to come home.
		source.value = math.max(0, source.value)
		tentacle.retracting = true
	end

	if tentacle.length >= tentacle.span then
		tentacle.length = tentacle.span
		tentacle.attached = true
	end
end

local function pulse(self: Simulation, tentacle: Types.Tentacle, dt: number)
	local source = self.cells[tentacle.from]
	local interval = Config.pulseInterval(source.value)

	if interval then
		tentacle.sinceEmit += dt
		while tentacle.sinceEmit >= interval do
			tentacle.sinceEmit -= interval
			-- Pulsing is free. The source paid once, to build the chain.
			table.insert(tentacle.pulses, 0)
		end
	else
		tentacle.sinceEmit = 0
	end

	local index = 1
	while index <= #tentacle.pulses do
		local position = tentacle.pulses[index] + Config.PULSE_SPEED * dt
		if position >= tentacle.span then
			table.remove(tentacle.pulses, index)
			applyUnit(self, self.cells[tentacle.to], tentacle.owner)
		else
			tentacle.pulses[index] = position
			index += 1
		end
	end
end

local function stepTentacles(self: Simulation, dt: number)
	local ids = table.clone(self.tentacleIds)

	for _, id in ids do
		local tentacle = self.tentacles[id]
		if not tentacle then
			continue
		end

		-- Losing the source kills the chain outright.
		if self.cells[tentacle.from].owner ~= tentacle.owner then
			self:removeTentacle(id)
			continue
		end

		if tentacle.retracting then
			reelIn(self, tentacle, Config.COLLAPSE_RATE * dt)
			if tentacle.length <= 0 then
				self:removeTentacle(id)
			end
			continue
		end

		if not tentacle.attached then
			extend(self, tentacle, dt)
		end

		if tentacle.attached and not tentacle.retracting then
			pulse(self, tentacle, dt)
		end
	end
end

local function stepCollapses(self: Simulation, dt: number)
	for _, id in table.clone(self.collapseIds) do
		local collapse = self.collapses[id]
		if not collapse then
			continue
		end

		local taken = math.min(Config.COLLAPSE_RATE * dt, collapse.remaining)
		collapse.remaining -= taken
		collapse.credit += taken

		while collapse.credit >= Config.SEGMENTS_PER_ENERGY do
			collapse.credit -= Config.SEGMENTS_PER_ENERGY
			if collapse.delivers then
				if collapse.mode == "refund" then
					local source = self.cells[collapse.from]
					if source.owner == collapse.owner and source.value < self.limit then
						source.value += 1
					end
				else
					applyUnit(self, self.cells[collapse.to], collapse.owner)
				end
			end
		end

		if collapse.remaining <= 0 then
			removeCollapse(self, id)
		end
	end
end

function Simulation.step(self: Simulation, dt: number)
	self.elapsed += dt
	regenerate(self, dt)
	stepTentacles(self, dt)
	stepCollapses(self, dt)
end

--=============================================================================
-- Replication
--=============================================================================

function Simulation.snapshot(self: Simulation): Types.Snapshot
	local cells: { Types.CellState } = table.create(#self.cellIds)
	for _, id in self.cellIds do
		local cell = self.cells[id]
		table.insert(cells, { id = cell.id, owner = cell.owner, value = math.floor(cell.value) })
	end

	local tentacles: { Types.TentacleState } = table.create(#self.tentacleIds)
	for _, id in self.tentacleIds do
		local tentacle = self.tentacles[id]
		table.insert(tentacles, {
			id = tentacle.id,
			from = tentacle.from,
			to = tentacle.to,
			owner = tentacle.owner,
			span = tentacle.span,
			length = tentacle.length,
			attached = tentacle.attached,
			retracting = tentacle.retracting,
			pulses = table.clone(tentacle.pulses),
		})
	end

	local collapses: { Types.CollapseState } = table.create(#self.collapseIds)
	for _, id in self.collapseIds do
		local collapse = self.collapses[id]
		table.insert(collapses, {
			id = collapse.id,
			from = collapse.from,
			to = collapse.to,
			owner = collapse.owner,
			mode = collapse.mode,
			remaining = collapse.remaining,
			outer = collapse.outer,
		})
	end

	return {
		cells = cells,
		tentacles = tentacles,
		collapses = collapses,
		remaining = self:timeRemaining(),
		limit = self.limit,
	}
end

return Simulation
