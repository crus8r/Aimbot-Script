--!strict
-- Opponent brains. The economy the bot is playing: building a chain costs
-- energy up front and buys a free, permanent stream of pulses whose rate
-- depends on the source cell's value. So the questions each think are:
-- can I afford to reach anything, is anything about to fall to a cut, and is
-- any line of mine no longer worth the space it occupies?
--
-- Red plays it straight. Purple cuts -- which is worth roughly a third off the
-- time to take a cell, and is the whole difference between the two strains.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Simulation = require(ReplicatedStorage.Shared.Simulation)

local AI = {}
AI.__index = AI

export type Profile = {
	interval: number,
	reserve: number, -- energy kept back after paying to build
	cuts: boolean,
}

local PROFILES: { [string]: Profile } = {
	Red = { interval = 1.6, reserve = 8, cuts = false },
	Purple = { interval = 0.9, reserve = 5, cuts = true },
}

-- A bot with no affordable move for this long stops holding energy back.
local DESPERATION_AFTER = 14

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
		cooldown = math.random() * profile.interval,
		idle = 0,
	}, AI)
end

-- Cut at the source so the entire chain discharges into a target it can kill.
local function cutForKills(self: AI)
	local sim = self.sim
	for _, id in table.clone(sim.tentacleIds) do
		local tentacle = sim.tentacles[id]
		if not tentacle or tentacle.owner ~= self.owner or not tentacle.attached then
			continue
		end
		local target = sim.cells[tentacle.to]
		if target.owner ~= self.owner and sim:charge(tentacle) > target.value then
			sim:cut(self.owner, id, 0)
		end
	end
end

-- Reel in anything that is no longer doing work: a line held off by an opposing
-- chain, or one feeding a cell that is already full. The energy comes back.
local function recycle(self: AI)
	local sim = self.sim
	for _, id in table.clone(sim.tentacleIds) do
		local tentacle = sim.tentacles[id]
		if not tentacle or tentacle.owner ~= self.owner or tentacle.retracting then
			continue
		end

		local target = sim.cells[tentacle.to]
		if tentacle.attached and target.owner == self.owner and target.value >= sim.limit then
			sim:retract(self.owner, id)
		elseif not tentacle.attached and tentacle.length > tentacle.span * 0.25 then
			-- Deadlocked in the lane: take the refund and spend it elsewhere.
			-- The length guard keeps a chain that has only just set out from
			-- being recycled before it has had a chance to grow at all.
			local other = sim:opposing(tentacle)
			if other and tentacle.length + other.length >= tentacle.span - 1 then
				sim:retract(self.owner, id)
			end
		end
	end
end

local function bestMove(self: AI): ({ from: number, to: number }?)
	local sim = self.sim
	local desperate = self.idle >= DESPERATION_AFTER
	local reserve = if desperate then 1 else self.profile.reserve

	local best: { from: number, to: number }? = nil
	local bestScore = -math.huge

	for _, fromId in sim.cellIds do
		local source = sim.cells[fromId]
		if source.owner ~= self.owner then
			continue
		end
		if sim:outboundCount(fromId) >= Config.slotsFor(source.value) then
			continue
		end

		for _, toId in sim.cellIds do
			if toId == fromId then
				continue
			end
			local target = sim.cells[toId]
			if target.owner == self.owner or sim:findTentacle(fromId, toId) then
				continue
			end
			if (target.position - source.position).Magnitude > Config.MAX_CONNECT_DISTANCE then
				continue
			end

			-- If their chain already owns most of the lane there is no room to
			-- grow into, and opening one here just burns energy shoving.
			local span = sim:spanBetween(fromId, toId)
			local blocker = sim:findTentacle(toId, fromId)
			if blocker and blocker.length >= span * 0.6 then
				continue
			end

			-- Reaching costs this much up front, and stranding a chain halfway
			-- wastes the lot, so never start one the cell cannot finish.
			local build = Config.costOf(span)
			if source.value - build < reserve then
				continue
			end

			-- Cheap to reach and cheap to take, with neutral cells worth extra
			-- because taking one hands over a garrison outright.
			local score = -(build * 1.4 + target.value)
			if target.owner == Config.NEUTRAL then
				score += Config.NEUTRAL_CAPTURE_BONUS
			end
			if score > bestScore then
				bestScore = score
				best = { from = fromId, to = toId }
			end
		end
	end

	return best
end

-- Feeding your own cells raises their class, so they pulse faster and hold more
-- lines. Worth doing, but never at the cost of an attack the bot could make.
local function bestFeed(self: AI): ({ from: number, to: number }?)
	local sim = self.sim
	local best: { from: number, to: number }? = nil
	local bestScore = -math.huge

	for _, fromId in sim.cellIds do
		local source = sim.cells[fromId]
		if source.owner ~= self.owner or source.value < sim.limit * 0.85 then
			continue
		end
		if sim:outboundCount(fromId) >= Config.slotsFor(source.value) - 1 then
			continue
		end

		for _, toId in sim.cellIds do
			local target = sim.cells[toId]
			if toId == fromId or target.owner ~= self.owner then
				continue
			end
			if target.value >= sim.limit * 0.5 or sim:findTentacle(fromId, toId) then
				continue
			end
			if (target.position - source.position).Magnitude > Config.MAX_CONNECT_DISTANCE then
				continue
			end

			local build = Config.costOf(sim:spanBetween(fromId, toId))
			if source.value - build < self.profile.reserve then
				continue
			end

			local score = -(build + target.value)
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
	recycle(self)

	local move = bestMove(self) or bestFeed(self)
	if move and self.sim:connect(self.owner, move.from, move.to) then
		self.idle = 0
	else
		self.idle += self.profile.interval
	end
end

return AI
