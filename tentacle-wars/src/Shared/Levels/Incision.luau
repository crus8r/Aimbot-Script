--!strict
-- Opening zone: one green antibody against one red infection, mirrored across
-- the board, with a fat neutral cell in the middle worth fighting for. Short
-- enough to teach the loop -- draw, charge, cut -- without a second front.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Types = require(ReplicatedStorage.Shared.Types)

local level: Types.Level = {
	name = "Incision",
	factions = { 1, 2 },
	ai = { [2] = "Red" },
	starTimes = { 75, 130, 200 },
	cells = {
		{ id = 1, position = Vector2.new(150, 300), tier = 2, owner = 1, units = 20 },
		{ id = 2, position = Vector2.new(850, 300), tier = 2, owner = 2, units = 20 },

		-- The centre prize.
		{ id = 3, position = Vector2.new(500, 300), tier = 3, units = 22 },

		-- Mirrored stepping stones.
		{ id = 4, position = Vector2.new(350, 170), tier = 1, units = 6 },
		{ id = 5, position = Vector2.new(350, 430), tier = 1, units = 6 },
		{ id = 6, position = Vector2.new(650, 170), tier = 1, units = 6 },
		{ id = 7, position = Vector2.new(650, 430), tier = 1, units = 6 },

		-- Contested north and south, reachable from either home but only just.
		{ id = 8, position = Vector2.new(500, 80), tier = 2, units = 10 },
		{ id = 9, position = Vector2.new(500, 520), tier = 2, units = 10 },
	},
}

return level
