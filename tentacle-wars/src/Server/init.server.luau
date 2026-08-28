--!strict
-- Round manager. Owns the one authoritative Simulation, drives it on a fixed
-- timestep, hands unclaimed factions to the AI, and broadcasts snapshots.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Levels = require(Shared.Levels)
local Net = require(Shared.Net)
local Simulation = require(Shared.Simulation)

local AI = require(script.AI)

-- This is a board game played entirely in a ScreenGui. Without this a character
-- spawns behind the board and, in a place with no SpawnLocation, falls forever
-- and respawn-loops behind the backdrop.
Players.CharacterAutoLoads = false

Net.init()

local RoundStart = Net.get("RoundStart")
local RoundOver = Net.get("RoundOver")
local Snapshot = Net.get("Snapshot")
local RequestConnect = Net.get("RequestConnect")
local RequestCut = Net.get("RequestCut")

local STEP = 1 / Config.TICK_RATE
local SNAPSHOT_INTERVAL = 1 / Config.SNAPSHOT_RATE
local MIN_REQUEST_INTERVAL = 0.08

type Round = {
	sim: Simulation.Simulation,
	bots: { AI.AI },
	factionOf: { [Player]: number },
	playerOf: { [number]: Player },
	layout: { any },
	levelIndex: number,
	over: boolean,
}

local round: Round? = nil
local lastRequestAt: { [Player]: number } = {}

--=============================================================================
-- Round lifecycle
--=============================================================================

local function buildLayout(sim: Simulation.Simulation): { any }
	local layout = {}
	for _, id in sim.cellIds do
		local cell = sim.cells[id]
		table.insert(layout, { id = cell.id, position = cell.position, radius = cell.radius })
	end
	return layout
end

local function sendRoundStart(player: Player, current: Round)
	RoundStart:FireClient(player, {
		level = current.sim.level.name,
		factions = current.sim.level.factions,
		cells = current.layout,
		faction = current.factionOf[player] or Config.NEUTRAL,
		limit = current.sim.limit,
	})
end

local function startRound(levelIndex: number)
	local level = Levels.get(levelIndex)
	local sim = Simulation.new(level)

	local factionOf: { [Player]: number } = {}
	local playerOf: { [number]: Player } = {}
	local claimed: { [number]: boolean } = {}

	-- Seat players into factions in join order; whatever is left over is a bot.
	local players = Players:GetPlayers()
	for index, faction in level.factions do
		local player = players[index]
		if player then
			factionOf[player] = faction
			playerOf[faction] = player
			claimed[faction] = true
		end
	end

	local profiles = level.ai or {}
	local bots: { AI.AI } = {}
	for _, faction in level.factions do
		if not claimed[faction] then
			table.insert(bots, AI.new(sim, faction, profiles[faction]))
		end
	end

	local current: Round = {
		sim = sim,
		bots = bots,
		factionOf = factionOf,
		playerOf = playerOf,
		layout = buildLayout(sim),
		levelIndex = levelIndex,
		over = false,
	}
	round = current

	for _, player in players do
		sendRoundStart(player, current)
	end
end

local function endRound(current: Round, winner: number, timedOut: boolean?)
	current.over = true

	local stars = if timedOut then 0 else current.sim:stars()
	RoundOver:FireAllClients({
		winner = winner,
		timedOut = timedOut == true,
		stars = stars,
		elapsed = math.floor(current.sim.elapsed),
	})

	-- A zone cleared by a seated player advances the campaign; anything else
	-- (a bot win, or a round that ran out the clock) replays it.
	local clearedByPlayer = not timedOut and current.playerOf[winner] ~= nil
	local nextIndex = if clearedByPlayer then current.levelIndex + 1 else current.levelIndex

	task.delay(Config.ROUND_RESTART_DELAY, function()
		-- Only restart if nothing else already started a newer round.
		if round == current then
			startRound(nextIndex)
		end
	end)
end

--=============================================================================
-- Player commands
--=============================================================================

local function throttled(player: Player): boolean
	local now = os.clock()
	local last = lastRequestAt[player]
	if last and now - last < MIN_REQUEST_INTERVAL then
		return true
	end
	lastRequestAt[player] = now
	return false
end

local function factionFor(player: Player): number?
	local current = round
	if not current or current.over then
		return nil
	end
	local faction = current.factionOf[player]
	if not faction or faction == Config.NEUTRAL then
		return nil
	end
	return faction
end

RequestConnect.OnServerEvent:Connect(function(player, fromId, toId)
	if typeof(fromId) ~= "number" or typeof(toId) ~= "number" then
		return
	end
	if fromId ~= fromId or toId ~= toId then -- NaN
		return
	end
	if throttled(player) then
		return
	end
	local faction = factionFor(player)
	local current = round
	if not faction or not current then
		return
	end
	current.sim:connect(faction, fromId, toId)
end)

RequestCut.OnServerEvent:Connect(function(player, tentacleId, fraction)
	if typeof(tentacleId) ~= "number" or typeof(fraction) ~= "number" then
		return
	end
	-- NaN survives every comparison, so reject it before it reaches the sim.
	if fraction ~= fraction then
		return
	end
	if throttled(player) then
		return
	end
	local faction = factionFor(player)
	local current = round
	if not faction or not current then
		return
	end
	current.sim:cut(faction, tentacleId, math.clamp(fraction, 0, 1))
end)

--=============================================================================
-- Players joining and leaving
--=============================================================================

Players.PlayerAdded:Connect(function(player)
	local current = round
	if current then
		-- Mid-round arrivals spectate until the next round seats them.
		sendRoundStart(player, current)
	else
		startRound(1)
	end
end)

-- In Studio's play-solo the local player can exist before this script runs, so
-- PlayerAdded never fires for them.
for _, player in Players:GetPlayers() do
	if round then
		sendRoundStart(player, round)
	else
		startRound(1)
	end
end

Players.PlayerRemoving:Connect(function(player)
	lastRequestAt[player] = nil

	local current = round
	if not current then
		return
	end

	-- Hand the abandoned faction to a bot so the round can still resolve.
	local faction = current.factionOf[player]
	current.factionOf[player] = nil
	if faction then
		current.playerOf[faction] = nil
	end
	if faction and faction ~= Config.NEUTRAL and not current.over then
		local profiles = current.sim.level.ai or {}
		table.insert(current.bots, AI.new(current.sim, faction, profiles[faction]))
	end

	if #Players:GetPlayers() == 0 then
		round = nil
	end
end)

--=============================================================================
-- Fixed-step loop
--=============================================================================

local accumulator = 0
local sinceSnapshot = 0

RunService.Heartbeat:Connect(function(dt)
	local current = round
	if not current or current.over then
		return
	end

	-- Clamp so a hitch cannot make the sim spiral trying to catch up.
	accumulator = math.min(accumulator + dt, STEP * 6)
	while accumulator >= STEP do
		accumulator -= STEP
		current.sim:step(STEP)
		for _, bot in current.bots do
			bot:step(STEP)
		end
	end

	local winner = current.sim:winner()
	if winner then
		endRound(current, winner)
		return
	end
	if current.sim:timeRemaining() <= 0 then
		endRound(current, current.sim:leader(), true)
		return
	end

	sinceSnapshot += dt
	if sinceSnapshot >= SNAPSHOT_INTERVAL then
		sinceSnapshot = 0
		Snapshot:FireAllClients(current.sim:snapshot())
	end
end)
