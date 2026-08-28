--!strict
-- Opening zone: one green antibody against one red infection, mirrored across
-- the board, with a fat neutral cell in the middle. Reaching the centre costs
-- almost everything a starting cell has, so the first decision is whether to
-- overreach for it or take the cheap flanks first.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Types = require(ReplicatedStorage.Shared.Types)

local level: Types.Level = {
	name = "Incision",
	factions = { 1, 2 },
	ai = { [2] = "Red" },
	starTimes = { 150, 250, 360 },
	powerLimit = 60,
	cells = {
		{ id = 1, position = Vector2.new(150, 300), owner = 1, value = 25 },
		{ id = 2, position = Vector2.new(850, 300), owner = 2, value = 25 },

		-- The centre prize: reachable, but only just.
		{ id = 3, position = Vector2.new(500, 300), value = 22, radius = 34 },

		-- Cheap mirrored stepping stones.
		{ id = 4, position = Vector2.new(350, 170), value = 6 },
		{ id = 5, position = Vector2.new(350, 430), value = 6 },
		{ id = 6, position = Vector2.new(650, 170), value = 6 },
		{ id = 7, position = Vector2.new(650, 430), value = 6 },

		{ id = 8, position = Vector2.new(500, 80), value = 10 },
		{ id = 9, position = Vector2.new(500, 520), value = 10 },
	},
}

return level
