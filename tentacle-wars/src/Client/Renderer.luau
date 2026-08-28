--!strict
-- Draws the board. Owns every Instance the client creates and holds the last
-- snapshot so the input layer can hit-test against what the player can see.
--
-- All chain geometry is in segments measured from the source cell's edge; one
-- segment is Config.SEGMENT_LENGTH board units.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Types = require(ReplicatedStorage.Shared.Types)

local Renderer = {}
Renderer.__index = Renderer

export type CellLayout = { id: number, position: Vector2, radius: number }

local BOARD = Vector2.new(Config.BOARD_WIDTH, Config.BOARD_HEIGHT)
local PULSE_SIZE = 11
local CHAIN_THICKNESS = 7

local function scalePos(p: Vector2): UDim2
	return UDim2.fromScale(p.X / BOARD.X, p.Y / BOARD.Y)
end

local function scaleSize(width: number, height: number): UDim2
	return UDim2.fromScale(width / BOARD.X, height / BOARD.Y)
end

local function drawSegment(frame: Frame, a: Vector2, b: Vector2, thickness: number)
	local delta = b - a
	frame.Position = scalePos((a + b) / 2)
	frame.Size = scaleSize(math.max(delta.Magnitude, 1), thickness)
	frame.Rotation = math.deg(math.atan2(delta.Y, delta.X))
end

local function buildHud(gui: ScreenGui): (TextLabel, TextLabel)
	local status = Instance.new("TextLabel")
	status.Name = "Status"
	status.AnchorPoint = Vector2.new(0.5, 0)
	status.Position = UDim2.new(0.5, 0, 0, 12)
	status.Size = UDim2.new(0, 620, 0, 26)
	status.BackgroundTransparency = 1
	status.Font = Enum.Font.GothamMedium
	status.TextSize = 16
	status.TextColor3 = Color3.fromRGB(226, 226, 236)
	status.Text = "Connecting..."
	status.ZIndex = 10
	status.Parent = gui

	local hint = Instance.new("TextLabel")
	hint.Name = "Hint"
	hint.AnchorPoint = Vector2.new(0.5, 1)
	hint.Position = UDim2.new(0.5, 0, 1, -12)
	hint.Size = UDim2.new(0, 760, 0, 22)
	hint.BackgroundTransparency = 1
	hint.Font = Enum.Font.Gotham
	hint.TextSize = 14
	hint.TextColor3 = Color3.fromRGB(150, 150, 165)
	hint.Text = "Drag to reach out  -  click your own tentacle to cut it: everything past the cut goes forward, everything behind comes home"
	hint.ZIndex = 10
	hint.Parent = gui

	local banner = Instance.new("TextLabel")
	banner.Name = "Banner"
	banner.AnchorPoint = Vector2.new(0.5, 0.5)
	banner.Position = UDim2.fromScale(0.5, 0.42)
	banner.Size = UDim2.new(0, 640, 0, 60)
	banner.BackgroundTransparency = 1
	banner.Font = Enum.Font.GothamBold
	banner.TextSize = 32
	banner.TextColor3 = Color3.fromRGB(255, 255, 255)
	banner.Visible = false
	banner.ZIndex = 12
	banner.Parent = gui

	return status, banner
end

function Renderer.new(parent: Instance)
	local gui = Instance.new("ScreenGui")
	gui.Name = "TentacleWars"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = parent

	local backdrop = Instance.new("Frame")
	backdrop.Size = UDim2.fromScale(1, 1)
	backdrop.BackgroundColor3 = Color3.fromRGB(12, 10, 20)
	backdrop.BorderSizePixel = 0
	backdrop.Parent = gui

	local board = Instance.new("Frame")
	board.Name = "Board"
	board.AnchorPoint = Vector2.new(0.5, 0.5)
	board.Position = UDim2.fromScale(0.5, 0.5)
	board.Size = UDim2.fromScale(1, 1)
	board.BackgroundColor3 = Color3.fromRGB(20, 17, 34)
	board.BorderSizePixel = 0
	board.Parent = backdrop

	-- Bound on both axes so the board letterboxes rather than overflowing.
	local ratio = Instance.new("UIAspectRatioConstraint")
	ratio.AspectRatio = BOARD.X / BOARD.Y
	ratio.AspectType = Enum.AspectType.FitWithinMaxSize
	ratio.Parent = board

	local function layer(name: string, z: number): Frame
		local frame = Instance.new("Frame")
		frame.Name = name
		frame.Size = UDim2.fromScale(1, 1)
		frame.BackgroundTransparency = 1
		frame.ZIndex = z
		frame.Parent = board
		return frame
	end

	local chainLayer = layer("Chains", 2)
	local pulseLayer = layer("Pulses", 3)
	local cellLayer = layer("Cells", 4)
	local chargeLayer = layer("Charges", 6)

	local range = Instance.new("Frame")
	range.AnchorPoint = Vector2.new(0.5, 0.5)
	range.BackgroundTransparency = 1
	range.Visible = false
	range.ZIndex = 1
	range.Parent = board
	local rangeCorner = Instance.new("UICorner")
	rangeCorner.CornerRadius = UDim.new(1, 0)
	rangeCorner.Parent = range
	local rangeStroke = Instance.new("UIStroke")
	rangeStroke.Color = Color3.fromRGB(255, 255, 255)
	rangeStroke.Transparency = 0.82
	rangeStroke.Parent = range

	local drag = Instance.new("Frame")
	drag.AnchorPoint = Vector2.new(0.5, 0.5)
	drag.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	drag.BackgroundTransparency = 0.45
	drag.BorderSizePixel = 0
	drag.Visible = false
	drag.ZIndex = 5
	drag.Parent = board

	local status, banner = buildHud(gui)

	return setmetatable({
		gui = gui,
		board = board,
		chainLayer = chainLayer,
		pulseLayer = pulseLayer,
		cellLayer = cellLayer,
		chargeLayer = chargeLayer,
		rangeFrame = range,
		dragFrame = drag,
		statusLabel = status,
		bannerLabel = banner,

		layout = {} :: { [number]: CellLayout },
		layoutOrder = {} :: { number },
		cellState = {} :: { [number]: Types.CellState },
		tentacles = {} :: { Types.TentacleState },
		collapses = {} :: { Types.CollapseState },
		cellFrames = {} :: { [number]: Frame },
		chainPool = {} :: { Frame },
		pulsePool = {} :: { Frame },
		chargePool = {} :: { TextLabel },
		factions = {} :: { number },
		faction = Config.NEUTRAL,
		remaining = Config.ROUND_TIME_LIMIT,
		limit = Config.POWER_LIMIT,
		selected = nil :: number?,
	}, Renderer)
end

--=============================================================================
-- Geometry
--=============================================================================

-- Where the chain leaves the source, and the unit direction it runs in.
function Renderer.chainBasis(self: any, fromId: number, toId: number): (Vector2, Vector2)
	local from = self.layout[fromId]
	local to = self.layout[toId]
	local delta = to.position - from.position
	local length = delta.Magnitude
	local direction = if length > 1e-6 then delta / length else Vector2.new(1, 0)
	return from.position + direction * from.radius, direction
end

local function at(origin: Vector2, direction: Vector2, segments: number): Vector2
	return origin + direction * (segments * Config.SEGMENT_LENGTH)
end

--=============================================================================
-- Layout
--=============================================================================

function Renderer.setLayout(self: any, cells: { CellLayout }, factions: { number }, faction: number, limit: number)
	for _, frame in self.cellFrames do
		frame:Destroy()
	end
	for _, pool in { self.chainPool, self.pulsePool, self.chargePool } do
		for _, instance in pool do
			instance.Visible = false
		end
	end

	self.cellFrames = {}
	self.layout = {}
	self.layoutOrder = {}
	self.cellState = {}
	self.tentacles = {}
	self.collapses = {}
	self.factions = factions
	self.faction = faction
	self.limit = limit
	self.selected = nil
	self:hideBanner()

	for _, cell in cells do
		self.layout[cell.id] = cell
		table.insert(self.layoutOrder, cell.id)

		local frame = Instance.new("Frame")
		frame.Name = `Cell{cell.id}`
		frame.AnchorPoint = Vector2.new(0.5, 0.5)
		frame.Position = scalePos(cell.position)
		frame.Size = scaleSize(cell.radius * 2, cell.radius * 2)
		frame.BackgroundColor3 = Config.colorOf(Config.NEUTRAL)
		frame.BorderSizePixel = 0
		frame.ZIndex = 4
		frame.Parent = self.cellLayer

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(1, 0)
		corner.Parent = frame

		local stroke = Instance.new("UIStroke")
		stroke.Name = "Outline"
		stroke.Color = Color3.fromRGB(255, 255, 255)
		stroke.Transparency = 1
		stroke.Thickness = 3
		stroke.Parent = frame

		local label = Instance.new("TextLabel")
		label.Name = "Value"
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.GothamBold
		label.TextScaled = true
		label.TextColor3 = Color3.fromRGB(255, 255, 255)
		label.Text = "0"
		label.ZIndex = 5
		label.Parent = frame

		local padding = Instance.new("UIPadding")
		local inset = UDim.new(0.26, 0)
		padding.PaddingTop, padding.PaddingBottom = inset, inset
		padding.PaddingLeft, padding.PaddingRight = inset, inset
		padding.Parent = label

		self.cellFrames[cell.id] = frame
	end
end

--=============================================================================
-- Pools
--=============================================================================

local function poolFrame(self: any, pool: { Frame }, layer: Frame, index: number, size: number?): Frame
	local frame = pool[index]
	if frame then
		return frame
	end
	frame = Instance.new("Frame")
	frame.AnchorPoint = Vector2.new(0.5, 0.5)
	frame.BorderSizePixel = 0
	frame.ZIndex = layer.ZIndex
	frame.Parent = layer
	if size then
		frame.Size = scaleSize(size, size)
	end
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = frame
	pool[index] = frame
	return frame
end

function Renderer.chargeLabel(self: any, index: number): TextLabel
	local label = self.chargePool[index]
	if label then
		return label
	end
	label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Size = UDim2.new(0, 44, 0, 16)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextSize = 13
	label.TextStrokeTransparency = 0.35
	label.ZIndex = 6
	label.Parent = self.chargeLayer
	self.chargePool[index] = label
	return label
end

--=============================================================================
-- Snapshot
--=============================================================================

-- Energy stored in a chain: what a cut at the source would throw forward.
local function chargeOf(length: number): number
	return math.floor(length / Config.SEGMENTS_PER_ENERGY)
end

function Renderer.applySnapshot(self: any, snapshot: Types.Snapshot)
	for _, state in snapshot.cells do
		self.cellState[state.id] = state
		local frame = self.cellFrames[state.id]
		if frame then
			frame.BackgroundColor3 = Config.colorOf(state.owner)
			local label = frame:FindFirstChild("Value") :: TextLabel?
			if label then
				label.Text = tostring(state.value)
			end
		end
	end

	self.tentacles = snapshot.tentacles
	self.collapses = snapshot.collapses
	self.remaining = snapshot.remaining or 0
	self.limit = snapshot.limit or self.limit

	local chains, pulses, charges = 0, 0, 0

	for _, state in snapshot.tentacles do
		if not self.layout[state.from] or not self.layout[state.to] then
			continue
		end
		local origin, direction = self:chainBasis(state.from, state.to)
		local color = Config.colorOf(state.owner)

		chains += 1
		local frame = poolFrame(self, self.chainPool, self.chainLayer, chains)
		drawSegment(frame, origin, at(origin, direction, state.length), CHAIN_THICKNESS)
		frame.BackgroundColor3 = color
		-- Attached reads solid; still reaching (or shoved off) reads faded.
		frame.BackgroundTransparency = if state.attached then 0.05 else 0.4
		frame.Visible = true

		for _, position in state.pulses do
			pulses += 1
			local dot = poolFrame(self, self.pulsePool, self.pulseLayer, pulses, PULSE_SIZE)
			dot.Position = scalePos(at(origin, direction, position))
			dot.BackgroundColor3 = color
			dot.Visible = true
		end

		local charge = chargeOf(state.length)
		if state.owner == self.faction and charge >= 1 then
			charges += 1
			local label = self:chargeLabel(charges)
			label.Position = scalePos(at(origin, direction, state.length / 2))
			label.Text = tostring(charge)
			label.TextColor3 = color
			label.Visible = true
		end
	end

	-- Collapsing halves of a cut chain, still travelling.
	for _, state in snapshot.collapses do
		if not self.layout[state.from] or not self.layout[state.to] then
			continue
		end
		local origin, direction = self:chainBasis(state.from, state.to)
		local inner = if state.mode == "refund" then 0 else state.outer - state.remaining
		local outer = if state.mode == "refund" then state.remaining else state.outer

		chains += 1
		local frame = poolFrame(self, self.chainPool, self.chainLayer, chains)
		drawSegment(frame, at(origin, direction, inner), at(origin, direction, outer), CHAIN_THICKNESS)
		frame.BackgroundColor3 = Config.colorOf(state.owner)
		frame.BackgroundTransparency = 0.25
		frame.Visible = true
	end

	for index = chains + 1, #self.chainPool do
		self.chainPool[index].Visible = false
	end
	for index = pulses + 1, #self.pulsePool do
		self.pulsePool[index].Visible = false
	end
	for index = charges + 1, #self.chargePool do
		self.chargePool[index].Visible = false
	end

	self:refreshSelection()
	self:refreshStatus()
end

function Renderer.refreshStatus(self: any)
	if not self.statusLabel then
		return
	end
	if self.faction == Config.NEUTRAL then
		self.statusLabel.Text = "Spectating - you will be seated next round"
		self.statusLabel.TextColor3 = Color3.fromRGB(180, 180, 190)
		return
	end

	local parts = {}
	for _, faction in self.factions do
		local cells, value = 0, 0
		for _, state in self.cellState do
			if state.owner == faction then
				cells += 1
				value += state.value
			end
		end
		table.insert(parts, `{if faction == self.faction then "You" else `F{faction}`} {cells}c / {value}`)
	end

	local seconds = math.max(0, math.floor(self.remaining))
	table.insert(parts, `limit {self.limit}`)
	table.insert(parts, string.format("%d:%02d", seconds // 60, seconds % 60))

	self.statusLabel.Text = table.concat(parts, "    ")
	self.statusLabel.TextColor3 = Config.colorOf(self.faction)
end

--=============================================================================
-- Selection and drag feedback
--=============================================================================

function Renderer.refreshSelection(self: any)
	for id, frame in self.cellFrames do
		local stroke = frame:FindFirstChild("Outline") :: UIStroke?
		if stroke then
			local mine = self.cellState[id] and self.cellState[id].owner == self.faction
			stroke.Transparency = if id == self.selected then 0 elseif mine then 0.55 else 1
		end
	end
end

function Renderer.beginDrag(self: any, cellId: number)
	self.selected = cellId
	local cell = self.layout[cellId]
	if cell then
		self.rangeFrame.Position = scalePos(cell.position)
		self.rangeFrame.Size = scaleSize(Config.MAX_CONNECT_DISTANCE * 2, Config.MAX_CONNECT_DISTANCE * 2)
		self.rangeFrame.Visible = true
	end
	self.dragFrame.Visible = true
	self:refreshSelection()
end

function Renderer.updateDrag(self: any, pointer: Vector2)
	local cell = self.layout[self.selected]
	if cell then
		drawSegment(self.dragFrame, cell.position, pointer, 4)
	end
end

function Renderer.endDrag(self: any)
	self.selected = nil
	self.dragFrame.Visible = false
	self.rangeFrame.Visible = false
	self:refreshSelection()
end

--=============================================================================
-- Hit testing
--=============================================================================

function Renderer.toBoard(self: any, pixel: Vector2): Vector2?
	local origin = self.board.AbsolutePosition
	local size = self.board.AbsoluteSize
	if size.X <= 0 or size.Y <= 0 then
		return nil
	end
	local relative = pixel - origin
	return Vector2.new(relative.X / size.X * BOARD.X, relative.Y / size.Y * BOARD.Y)
end

function Renderer.cellAt(self: any, point: Vector2): CellLayout?
	local best, bestDistance = nil, math.huge
	for _, id in self.layoutOrder do
		local cell = self.layout[id]
		local distance = (point - cell.position).Magnitude
		if distance <= cell.radius + 8 and distance < bestDistance then
			best, bestDistance = cell, distance
		end
	end
	return best
end

-- Returns the chain under the pointer and how far along it the pointer sits,
-- as a fraction from the source. That fraction *is* the cut: everything past
-- it discharges forward, everything behind it comes home.
function Renderer.chainAt(self: any, point: Vector2, owner: number): (number?, number)
	local bestId, bestFraction, bestDistance = nil, 0, math.huge

	for _, state in self.tentacles do
		if state.owner ~= owner or state.length <= 0 then
			continue
		end
		if not self.layout[state.from] or not self.layout[state.to] then
			continue
		end

		local origin, direction = self:chainBasis(state.from, state.to)
		local span = state.length * Config.SEGMENT_LENGTH
		local along = math.clamp((point - origin):Dot(direction), 0, span)
		local distance = (point - (origin + direction * along)).Magnitude

		if distance <= CHAIN_THICKNESS + 7 and distance < bestDistance then
			bestId, bestFraction, bestDistance = state.id, along / span, distance
		end
	end

	return bestId, bestFraction
end

function Renderer.ownerOf(self: any, cellId: number): number
	local state = self.cellState[cellId]
	return if state then state.owner else Config.NEUTRAL
end

function Renderer.valueOf(self: any, cellId: number): number
	local state = self.cellState[cellId]
	return if state then state.value else 0
end

-- A cell's class is read from what it is holding right now.
function Renderer.freeSlots(self: any, cellId: number): number
	local used = 0
	for _, state in self.tentacles do
		if state.from == cellId then
			used += 1
		end
	end
	return Config.slotsFor(self:valueOf(cellId)) - used
end

--=============================================================================
-- Banner
--=============================================================================

function Renderer.showBanner(self: any, text: string, color: Color3)
	self.bannerLabel.Text = text
	self.bannerLabel.TextColor3 = color
	self.bannerLabel.Visible = true
end

function Renderer.hideBanner(self: any)
	if self.bannerLabel then
		self.bannerLabel.Visible = false
	end
end

return Renderer
