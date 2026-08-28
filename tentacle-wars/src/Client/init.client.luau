--!strict
-- Input and remote plumbing. All gameplay decisions live on the server; this
-- only translates pointer gestures into reach/cut requests and draws whatever
-- comes back.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Net = require(Shared.Net)

local Renderer = require(script.Renderer)

local player = Players.LocalPlayer
local renderer = Renderer.new(player:WaitForChild("PlayerGui"))

local RoundStart = Net.get("RoundStart")
local RoundOver = Net.get("RoundOver")
local Snapshot = Net.get("Snapshot")
local RequestConnect = Net.get("RequestConnect")
local RequestCut = Net.get("RequestCut")

local faction = Config.NEUTRAL
local dragSource: number? = nil

--=============================================================================
-- Remotes
--=============================================================================

RoundStart.OnClientEvent:Connect(function(payload)
	faction = payload.faction
	dragSource = nil
	renderer:setLayout(payload.cells, payload.factions, payload.faction, payload.limit)
end)

Snapshot.OnClientEvent:Connect(function(snapshot)
	renderer:applySnapshot(snapshot)
end)

RoundOver.OnClientEvent:Connect(function(payload)
	dragSource = nil
	renderer:endDrag()

	local elapsed = payload.elapsed or 0
	local clock = string.format("%d:%02d", elapsed // 60, elapsed % 60)

	if faction == Config.NEUTRAL then
		renderer:showBanner(`Faction {payload.winner} wins`, Config.colorOf(payload.winner))
	elseif payload.winner == faction then
		local award = if payload.timedOut then "on time" else `{payload.stars or 0}/3 stars`
		renderer:showBanner(`Zone cleared - {award} - {clock}`, Config.colorOf(faction))
	else
		local how = if payload.timedOut then "outgrown" else "overrun"
		renderer:showBanner(`Zone lost - {how} - {clock}`, Config.colorOf(payload.winner))
	end
end)

--=============================================================================
-- Pointer handling
--=============================================================================

local function pointerBoardPosition(input: InputObject): Vector2?
	return renderer:toBoard(Vector2.new(input.Position.X, input.Position.Y))
end

local function onPress(point: Vector2)
	if faction == Config.NEUTRAL then
		return
	end

	local cell = renderer:cellAt(point)
	if cell and renderer:ownerOf(cell.id) == faction then
		-- A cell's class is set by what it currently holds, so a starved cell
		-- may have no line to give.
		if renderer:freeSlots(cell.id) <= 0 or renderer:valueOf(cell.id) < 1 then
			return
		end
		dragSource = cell.id
		renderer:beginDrag(cell.id)
		renderer:updateDrag(point)
		return
	end

	-- Where along the chain you click is the cut: everything past it goes
	-- forward into the target, everything behind it reels home.
	local chainId, fraction = renderer:chainAt(point, faction)
	if chainId then
		RequestCut:FireServer(chainId, fraction)
	end
end

local function onRelease(point: Vector2?)
	local source = dragSource
	dragSource = nil
	renderer:endDrag()

	if not source or not point then
		return
	end
	local target = renderer:cellAt(point)
	if target and target.id ~= source then
		RequestConnect:FireServer(source, target.id)
	end
end

local function isPointerInput(input: InputObject): boolean
	return input.UserInputType == Enum.UserInputType.MouseButton1
		or input.UserInputType == Enum.UserInputType.Touch
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed or not isPointerInput(input) then
		return
	end
	local point = pointerBoardPosition(input)
	if point then
		onPress(point)
	end
end)

UserInputService.InputChanged:Connect(function(input)
	if not dragSource then
		return
	end
	if input.UserInputType ~= Enum.UserInputType.MouseMovement and input.UserInputType ~= Enum.UserInputType.Touch then
		return
	end
	local point = pointerBoardPosition(input)
	if point then
		renderer:updateDrag(point)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if not isPointerInput(input) then
		return
	end
	onRelease(pointerBoardPosition(input))
end)
