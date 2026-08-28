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
-- take proportionally longer to reach. This delay is the first half of the core
-- tension: you commit to an attack well before it can land.
Config.TENTACLE_GROWTH_SPEED = 150
Config.TENTACLE_THICKNESS = 7

-- Energy leaves the source at FLOW_RATE, in discrete pulses, and then has to
-- physically travel the length of the tentacle at PULSE_SPEED. Because
-- PULSE_SPEED is slow, a long connected tentacle is a loaded pipe: it can hold
-- more energy in transit than most cells hold at rest.
--
-- That standing charge is the point. Cutting a tentacle severs it at the source
-- and shoves the entire column forward into the target at once, which is the
-- signature move -- see Simulation.cut.
Config.FLOW_RATE = 3.2
Config.PULSE_SPEED = 85
Config.PULSE_INTERVAL = 0.25

-- Two tentacles running opposite directions between the same pair of cells
-- shoot past each other; where columns meet, they annihilate.
Config.PULSE_COLLISION_RADIUS = 16

-- Neutral cells sit inert until somebody takes them.
Config.NEUTRAL_REGENERATES = false

Config.MAX_CONNECT_DISTANCE = 430

Config.ROUND_RESTART_DELAY = 6

-- Hard stop on a round. Without it a board can genuinely lock up: cells at
-- capacity stop regenerating, so two evenly matched factions can sit forever.
-- On timeout the faction holding the most ground wins.
Config.ROUND_TIME_LIMIT = 420

-- Green is the player's antibody colour; red is the standard infection and
-- purple is the smarter strain that cuts its own tentacles.
Config.FACTION_COLORS = {
	[0] = Color3.fromRGB(148, 148, 156),
	[1] = Color3.fromRGB(74, 222, 128),
	[2] = Color3.fromRGB(239, 68, 68),
	[3] = Color3.fromRGB(168, 85, 247),
	[4] = Color3.fromRGB(250, 204, 21),
}

function Config.tierOf(tier: number)
	return Config.CELL_TIERS[tier] or Config.CELL_TIERS[1]
end

function Config.colorOf(owner: number): Color3
	return Config.FACTION_COLORS[owner] or Config.FACTION_COLORS[0]
end

return Config
