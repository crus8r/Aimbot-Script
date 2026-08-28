--!strict
-- Three-way board. Green starts west with the shortest lane to the fat centre
-- cell; red and purple start east and have to fight each other for it too.
-- Purple is the strain that cuts its own tentacles.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Types = require(ReplicatedStorage.Shared.Types)

local level: Types.Level = {
	name = "Crossroads",
	factions = { 1, 2, 3 },
	ai = { [2] = "Red", [3] = "Purple" },
	starTimes = { 180, 290, 400 },
	powerLimit = 70,
	cells = {
		{ id = 1, position = Vector2.new(140, 300), owner = 1, value = 28 },
		{ id = 2, position = Vector2.new(860, 160), owner = 2, value = 28 },
		{ id = 3, position = Vector2.new(860, 440), owner = 3, value = 28 },

		{ id = 4, position = Vector2.new(500, 300), value = 26, radius = 34 },
		{ id = 5, position = Vector2.new(300, 300), value = 6 },
		{ id = 6, position = Vector2.new(680, 300), value = 14 },

		{ id = 7, position = Vector2.new(320, 140), value = 12 },
		{ id = 8, position = Vector2.new(500, 90), value = 8 },
		{ id = 9, position = Vector2.new(690, 120), value = 9 },

		{ id = 10, position = Vector2.new(320, 460), value = 12 },
		{ id = 11, position = Vector2.new(500, 510), value = 8 },
		{ id = 12, position = Vector2.new(690, 480), value = 9 },

		{ id = 13, position = Vector2.new(860, 300), value = 10 },
	},
}

return level
