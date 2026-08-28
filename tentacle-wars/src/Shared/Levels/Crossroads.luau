--!strict
-- Three factions on a 1000x600 board. Faction 1 (the player) starts on the
-- west edge with a short lane to the fat centre cell; the two AI factions
-- start east and have to fight each other for the same prize.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Types = require(ReplicatedStorage.Shared.Types)

local level: Types.Level = {
	name = "Crossroads",
	factions = { 1, 2, 3 },
	cells = {
		-- Faction homes.
		{ id = 1, position = Vector2.new(140, 300), tier = 3, owner = 1, units = 24 },
		{ id = 2, position = Vector2.new(860, 160), tier = 3, owner = 2, units = 24 },
		{ id = 3, position = Vector2.new(860, 440), tier = 3, owner = 3, units = 24 },

		-- The centre prize, and the stepping stones either side of it.
		{ id = 4, position = Vector2.new(500, 300), tier = 3, units = 28 },
		{ id = 5, position = Vector2.new(300, 300), tier = 1, units = 6 },
		{ id = 6, position = Vector2.new(680, 300), tier = 2, units = 14 },

		-- Northern flank.
		{ id = 7, position = Vector2.new(320, 140), tier = 2, units = 12 },
		{ id = 8, position = Vector2.new(500, 90), tier = 1, units = 8 },
		{ id = 9, position = Vector2.new(690, 120), tier = 1, units = 9 },

		-- Southern flank.
		{ id = 10, position = Vector2.new(320, 460), tier = 2, units = 12 },
		{ id = 11, position = Vector2.new(500, 510), tier = 1, units = 8 },
		{ id = 12, position = Vector2.new(690, 480), tier = 1, units = 9 },

		-- Shared eastern chokepoint the two AI factions both want.
		{ id = 13, position = Vector2.new(860, 300), tier = 1, units = 10 },
	},
}

return level
