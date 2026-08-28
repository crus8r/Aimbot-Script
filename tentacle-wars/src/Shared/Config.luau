--!strict
-- Tuning constants shared by the server simulation and the client renderer.
-- Everything is expressed in "board units": a fixed 1000x600 virtual play field
-- that the client scales to whatever screen it is running on.

local Config = {}

Config.BOARD_WIDTH = 1000
Config.BOARD_HEIGHT = 600

Config.TICK_RATE = 20
Config.SNAPSHOT_RATE = 15

Config.NEUTRAL = 0

Config.CELL_RADIUS = 26

-- Every cell on a level shares one ceiling. Levels override it; low limits make
-- for slow, careful boards and high ones for fast, violent boards.
Config.POWER_LIMIT = 60

-- All owned cells tick up together. Neutral cells sit inert until taken.
Config.REGEN_INTERVAL = 1.4

-- Taking a neutral cell hands you a garrison outright rather than leaving you
-- holding an empty cell.
Config.NEUTRAL_CAPTURE_BONUS = 10

--=============================================================================
-- Tentacles
--
-- A tentacle is a physical chain of segments that the source cell pays to
-- build: every SEGMENTS_PER_ENERGY segments extended costs one energy, drawn
-- out of the source as it grows. Run out mid-reach and the chain is forced to
-- reel back in. Reeling in refunds at exactly the same rate, so retreating
-- costs you nothing but time.
--
-- The energy spent on length is therefore *stored in the chain*. Cutting it
-- splits the chain at the cut point and collapses both halves outward: the near
-- half refunds into the source, the far half discharges into the target. That
-- is the whole game -- a long chain is a loaded weapon, and where you cut
-- decides how much of it you keep versus how much you throw.
--=============================================================================

Config.SEGMENT_LENGTH = 6
Config.SEGMENTS_PER_ENERGY = 2

Config.GROW_RATE = 12 -- segments/sec while extending (6 energy/sec)
Config.COLLAPSE_RATE = 30 -- segments/sec while reeling in or discharging

Config.MAX_CONNECT_DISTANCE = 430

--=============================================================================
-- Cell classes
--
-- A cell's capability is a function of what it is holding right now, not of any
-- fixed size. Starve a cell and it drops a class; feed one and it gains one.
-- This is why pumping energy into your own cells is worth doing: a fed cell
-- attacks faster and can hold more lines open.
--=============================================================================

-- Seconds between pulses, by the source cell's current value. A cell at 1 or
-- below cannot pulse at all.
Config.PULSE_CLASSES = {
	{ from = 60, interval = 0.55 },
	{ from = 35, interval = 0.75 },
	{ from = 15, interval = 1.05 },
	{ from = 2, interval = 1.60 },
}

-- Simultaneous outbound tentacles, by the source cell's current value.
Config.SLOT_CLASSES = {
	{ from = 60, slots = 4 },
	{ from = 35, slots = 3 },
	{ from = 15, slots = 2 },
	{ from = 0, slots = 1 },
}

-- How fast a pulse travels its chain, in segments/sec.
Config.PULSE_SPEED = 26

Config.ROUND_RESTART_DELAY = 6
-- A single attacking line nets only about a third of a point per second
-- against a defended cell, so rounds are genuinely long unless somebody cuts.
Config.ROUND_TIME_LIMIT = 600

-- Green is the player's antibody colour; red is the standard infection and
-- purple is the smarter strain that cuts its own tentacles.
Config.FACTION_COLORS = {
	[0] = Color3.fromRGB(148, 148, 156),
	[1] = Color3.fromRGB(74, 222, 128),
	[2] = Color3.fromRGB(239, 68, 68),
	[3] = Color3.fromRGB(168, 85, 247),
	[4] = Color3.fromRGB(250, 204, 21),
}

function Config.colorOf(owner: number): Color3
	return Config.FACTION_COLORS[owner] or Config.FACTION_COLORS[0]
end

-- Seconds between pulses for a cell holding `value`, or nil if it cannot pulse.
function Config.pulseInterval(value: number): number?
	for _, class in Config.PULSE_CLASSES do
		if value >= class.from then
			return class.interval
		end
	end
	return nil
end

function Config.slotsFor(value: number): number
	for _, class in Config.SLOT_CLASSES do
		if value >= class.from then
			return class.slots
		end
	end
	return 1
end

-- Energy needed to span a given number of segments.
function Config.costOf(segments: number): number
	return segments / Config.SEGMENTS_PER_ENERGY
end

return Config
