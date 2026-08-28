--!strict
-- Tuning constants shared by the server simulation and the client renderer.
-- Everything is expressed in "board units": a fixed 1000x600 virtual play field
-- that the client scales to whatever screen it is running on.

local Config = {}

Config.BOARD_WIDTH = 1000
Config.BOARD_HEIGHT = 600

-- Simulation runs at a fixed step; snapshots go out less often than we tick.
Config.TICK_RATE = 20
Config.SNAPSHOT_RATE = 15

Config.NEUTRAL = 0

-- Cell tiers. Bigger cells hold more, regenerate faster, and support more
-- outbound tentacles -- the slot count is what stops a single fat cell from
-- feeding the whole map at once.
Config.CELL_TIERS = {
	{ radius = 26, capacity = 30, regen = 0.90, slots = 2 },
	{ radius = 34, capacity = 55, regen = 1.40, slots = 3 },
	{ radius = 44, capacity = 90, regen = 2.00, slots = 4 },
}

-- A tentacle extends at a constant board-units/second rate, so distant targets
-- take proportionally longer to reach. This delay is the core tension of the
-- game: you commit to an attack well before it lands.
Config.TENTACLE_GROWTH_SPEED = 150
Config.TENTACLE_THICKNESS = 7

-- Units transferred per second down a connected tentacle.
Config.FLOW_RATE = 3.2

-- Neutral cells sit inert until somebody takes them.
Config.NEUTRAL_REGENERATES = false

Config.MAX_CONNECT_DISTANCE = 430

Config.ROUND_RESTART_DELAY = 5

-- Hard stop on a round. Without it a board can genuinely lock up: cells at
-- capacity stop regenerating, so two evenly matched factions can sit forever.
-- On timeout the faction holding the most ground wins.
Config.ROUND_TIME_LIMIT = 420

Config.FACTION_COLORS = {
	[0] = Color3.fromRGB(150, 150, 158),
	[1] = Color3.fromRGB(168, 85, 247),
	[2] = Color3.fromRGB(239, 68, 68),
	[3] = Color3.fromRGB(56, 189, 248),
	[4] = Color3.fromRGB(250, 204, 21),
}

function Config.tierOf(tier: number)
	return Config.CELL_TIERS[tier] or Config.CELL_TIERS[1]
end

function Config.colorOf(owner: number): Color3
	return Config.FACTION_COLORS[owner] or Config.FACTION_COLORS[0]
end

return Config
