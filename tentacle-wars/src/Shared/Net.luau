--!strict
-- Lazily builds the remote objects on the server and waits for them on the
-- client, so neither side needs them checked into the place file.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local RELIABLE = {
	"RoundStart", -- server -> client: static level layout + assigned faction
	"RoundOver", -- server -> client: winning faction
	"RequestConnect", -- client -> server: grow a tentacle fromId -> toId
	"RequestCut", -- client -> server: sever one of my tentacles
}

local UNRELIABLE = {
	"Snapshot", -- server -> client: per-tick mutable state
}

local function container(): Folder
	if RunService:IsServer() then
		local existing = ReplicatedStorage:FindFirstChild("TentacleWarsNet")
		if existing then
			return existing :: Folder
		end
		local folder = Instance.new("Folder")
		folder.Name = "TentacleWarsNet"
		folder.Parent = ReplicatedStorage
		return folder
	end
	return ReplicatedStorage:WaitForChild("TentacleWarsNet") :: Folder
end

local Net = {}
local cache: { [string]: any } = {}
local root: Folder? = nil

local function remote(name: string, className: string): any
	if cache[name] then
		return cache[name]
	end
	if not root then
		root = container()
	end
	local folder = root :: Folder

	local instance
	if RunService:IsServer() then
		instance = folder:FindFirstChild(name)
		if not instance then
			instance = Instance.new(className)
			instance.Name = name
			instance.Parent = folder
		end
	else
		instance = folder:WaitForChild(name)
	end

	cache[name] = instance
	return instance
end

function Net.get(name: string): any
	if table.find(RELIABLE, name) then
		return remote(name, "RemoteEvent")
	elseif table.find(UNRELIABLE, name) then
		return remote(name, "UnreliableRemoteEvent")
	end
	error(`unknown remote "{name}"`)
end

-- Called once on the server so clients never race a WaitForChild.
function Net.init()
	for _, name in RELIABLE do
		Net.get(name)
	end
	for _, name in UNRELIABLE do
		Net.get(name)
	end
end

return Net
