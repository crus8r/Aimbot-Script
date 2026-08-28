--!strict
-- Opponent brains. On a fixed think interval a bot looks for the best
-- (my cell -> somebody else's cell) attack it can currently afford, frees up
-- slots feeding a cell it has already filled, and -- if its profile allows --
-- cuts a loaded tentacle to land a finishing burst.
--
-- The two profiles map onto the two enemy strains: red plays it straight,
-- purple thinks faster, commits harder, and knows about cutting.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Simulation = require(ReplicatedStorage.Shared.Simulation)

local AI = {}
AI.__index = AI

export type Profile = {
	interval: number,
	margin: number,
	reserve: number,
	cuts: boolean,
}

local PROFILES: { [string]: Profile } = {
	Red = { interval = 1.8, margin = 1.50, reserve = 0.35, cuts = false },
	Purple = { interval = 1.0, margin = 1.25, reserve = 0.22, cuts = true },
}

-- Safety margins are what stop a bot throwing units away, but held to strictly
-- they also deadlock it: a board where every affordable attack is a unit short
-- of the margin never resolves, because cells sitting at capacity stop
-- regenerating and nothing changes again. After this long without a move, the
-- bot drops its standards and commits.
local DESPERATION_AFTER = 12
local DESPERATE_MARGIN = 1.05
local DESPERATE_RESERVE = 0.08

export type AI = typeof(setmetatable(
	{} :: {
		sim: Simulation.Simulation,
		owner: number,
		profile: Profile,
		cooldown: number,
		idle: number,
	},
	AI
))

function AI.new(sim: Simulation.Simulation, owner: number, profileName: string?): AI
	local profile = PROFILES[profileName or "Red"] or PROFILES.Red
	return setmetatable({
		sim = sim,
		owner = owner,
		profile = profile,
		-- Stagger the first think so multiple bots do not act in lockstep.
		cooldown = math.random() * profile.interval,
		idle = 0,
	}, AI)
end

-- Reinforcing is always available and always safe. Scored against attacks it
-- wins far too often and the bot turtles, so it is a strict fallback instead:
-- only a near-full cell may give, only a starving cell may receive, and only
-- when there is no attack on the board worth making.
local REINFORCE_FROM = 0.9
local REINFORCE_TO = 0.3

-- Fraction of a cell's capacity a bot wants to land on top of a capture. Taking
-- a cell with nothing left in it just hands it straight back to the next
-- trickle, which is how boards used to grind to a standstill.
local GARRISON = 0.2

-- What it would still cost to take and *hold* a cell, discounting energy
-- already in the pipe toward it. Never returns zero: committed energy can be
-- annihilated in transit, so a target is never written off as already won.
local function captureCost(self: AI, target): number
	local sim = self.sim
	if target.owner == self.owner then
		return math.max(0, target.capacity - target.units)
	end

	local committed = sim:incoming(target.id, self.owner)
	return math.max(0, target.units - committed) + target.capacity * GARRISON + 5
end

-- Stop feeding a line the source can no longer afford. Without this the reserve
-- is only an entry condition: a bot opens an attack it can afford, then drains
-- the source to zero anyway and loses the cell to any passing pulse.
local function manageSupply(self: AI)
	local sim = self.sim
	local floor = self.profile.reserve * 0.5

	for _, id in table.clone(sim.tentacleIds) do
		local tentacle = sim.tentacles[id]
		if not tentacle or tentacle.owner ~= self.owner or not tentacle.connected then
			continue
		end

		local source = sim.cells[tentacle.from]
		if source.units < source.capacity * floor then
			if self.profile.cuts then
				sim:cut(self.owner, id) -- purple salvages the column on the way out
			else
				sim:detach(self.owner, id)
			end
		end
	end
end

-- Purple's trick: a tentacle holding more than its target has left is a kill,
-- so sever it and land the whole column at once.
local function cutForKills(self: AI)
	local sim = self.sim
	for _, id in table.clone(sim.tentacleIds) do
		local tentacle = sim.tentacles[id]
		if not tentacle or tentacle.owner ~= self.owner or not tentacle.connected then
			continue
		end
		local target = sim.cells[tentacle.to]
		if target.owner ~= self.owner and sim:payload(tentacle) > target.units + 2 then
			sim:cut(self.owner, id)
		end
	end
end

local function recycleFullTentacles(self: AI)
	local sim = self.sim
	for _, id in table.clone(sim.tentacleIds) do
		local tentacle = sim.tentacles[id]
		if tentacle and tentacle.owner == self.owner and tentacle.connected then
			local target = sim.cells[tentacle.to]
			if target.owner == self.owner and target.units >= target.capacity * 0.95 then
				sim:cut(self.owner, id)
			end
		end
	end
end

local function bestMove(self: AI): ({ from: number, to: number }?)
	local sim = self.sim
	local profile = self.profile

	local desperate = self.idle >= DESPERATION_AFTER
	local margin = if desperate then DESPERATE_MARGIN else profile.margin
	local reserve = if desperate then DESPERATE_RESERVE else profile.reserve

	local best: { from: number, to: number }? = nil
	local bestScore = -math.huge

	for _, fromId in sim.cellIds do
		local source = sim.cells[fromId]
		if source.owner ~= self.owner then
			continue
		end
		if sim:outboundCount(fromId) >= source.slots then
			continue
		end

		-- Never spend below the reserve: a stripped cell is a free capture.
		local spendable = source.units - source.capacity * reserve
		if spendable <= 0 then
			continue
		end

		for _, toId in sim.cellIds do
			if toId == fromId then
				continue
			end
			local target = sim.cells[toId]
			if target.owner == self.owner then
				continue
			end

			local distance = (target.position - source.position).Magnitude
			if distance > Config.MAX_CONNECT_DISTANCE then
				continue
			end
			if sim:findTentacle(fromId, toId) then
				continue
			end

			local cost = captureCost(self, target)
			if spendable < cost * margin then
				continue
			end

			-- Cheap, close, and high-value (bigger tier) targets win.
			local score = -(cost * 1.2 + distance * 0.05) + target.capacity * 0.35
			if score > bestScore then
				bestScore = score
				best = { from = fromId, to = toId }
			end
		end
	end

	return best
end

-- Late in a round the rear of a big territory is out of range of anything
-- hostile and just sits at capacity while the front starves. Pushing that
-- surplus forward is the only move left, but it must never crowd out an attack.
local function bestReinforce(self: AI): ({ from: number, to: number }?)
	local sim = self.sim
	local best: { from: number, to: number }? = nil
	local bestScore = -math.huge

	for _, fromId in sim.cellIds do
		local source = sim.cells[fromId]
		if source.owner ~= self.owner or source.units < source.capacity * REINFORCE_FROM then
			continue
		end
		-- Never spend a cell's last slot on support; keep it free for an attack.
		if sim:outboundCount(fromId) >= source.slots - 1 then
			continue
		end

		for _, toId in sim.cellIds do
			if toId == fromId then
				continue
			end
			local target = sim.cells[toId]
			if target.owner ~= self.owner or target.units >= target.capacity * REINFORCE_TO then
				continue
			end
			if (target.position - source.position).Magnitude > Config.MAX_CONNECT_DISTANCE then
				continue
			end
			if sim:findTentacle(fromId, toId) then
				continue
			end

			-- Feed whoever is emptiest.
			local score = -(target.units / target.capacity)
			if score > bestScore then
				bestScore = score
				best = { from = fromId, to = toId }
			end
		end
	end

	return best
end

function AI.step(self: AI, dt: number)
	self.cooldown -= dt
	if self.cooldown > 0 then
		return
	end
	self.cooldown = self.profile.interval

	if self.profile.cuts then
		cutForKills(self)
	end
	manageSupply(self)
	recycleFullTentacles(self)

	local move = bestMove(self) or bestReinforce(self)
	if move and self.sim:connect(self.owner, move.from, move.to) then
		self.idle = 0
	else
		self.idle += self.profile.interval
	end
end

return AI
