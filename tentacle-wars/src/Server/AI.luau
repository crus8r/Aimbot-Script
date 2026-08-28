--!strict
-- A deliberately simple opponent: on a fixed think interval it looks for the
-- best (my cell -> somebody else's cell) pair it can currently afford, and
-- frees up slots that are feeding a cell it has already filled.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Simulation = require(ReplicatedStorage.Shared.Simulation)

local AI = {}
AI.__index = AI

export type Difficulty = "Easy" | "Normal" | "Hard"

local PROFILES = {
	Easy = { interval = 2.6, margin = 2.0, reserve = 0.45 },
	Normal = { interval = 1.6, margin = 1.5, reserve = 0.35 },
	Hard = { interval = 0.9, margin = 1.25, reserve = 0.25 },
}

-- Safety margins are what stop the AI throwing units away, but held to
-- strictly they also deadlock it: a board where every affordable attack is a
-- unit short of the margin never resolves, because cells sitting at capacity
-- stop regenerating and nothing changes again. After this long without a move,
-- the bot drops its standards and commits.
local DESPERATION_AFTER = 12
local DESPERATE_MARGIN = 1.05
local DESPERATE_RESERVE = 0.08

export type AI = typeof(setmetatable(
	{} :: {
		sim: Simulation.Simulation,
		owner: number,
		profile: { interval: number, margin: number, reserve: number },
		cooldown: number,
		idle: number,
	},
	AI
))

function AI.new(sim: Simulation.Simulation, owner: number, difficulty: Difficulty?): AI
	local profile = PROFILES[difficulty or "Normal"] or PROFILES.Normal
	return setmetatable({
		sim = sim,
		owner = owner,
		profile = profile,
		-- Stagger the first think so multiple AIs do not act in lockstep.
		cooldown = math.random() * profile.interval,
		idle = 0,
	}, AI)
end

-- Cost to take a cell: whatever is sitting in it, plus a flat premium so the AI
-- does not open a tentacle it can only just barely afford.
local function captureCost(target, owner: number): number
	if target.owner == owner then
		return math.max(0, target.capacity - target.units)
	end
	return target.units + 5
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

			local cost = captureCost(target, self.owner)
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

function AI.step(self: AI, dt: number)
	self.cooldown -= dt
	if self.cooldown > 0 then
		return
	end
	self.cooldown = self.profile.interval

	recycleFullTentacles(self)

	local move = bestMove(self)
	if move and self.sim:connect(self.owner, move.from, move.to) then
		self.idle = 0
	else
		self.idle += self.profile.interval
	end
end

return AI
