--!strict

local Levels = {
	script.Crossroads,
}

local Module = {}

function Module.count(): number
	return #Levels
end

function Module.get(index: number)
	local module = Levels[((index - 1) % #Levels) + 1]
	return require(module)
end

return Module
