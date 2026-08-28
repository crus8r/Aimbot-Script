--!strict
-- Draws the board. Owns every Instance the client creates and holds the last
-- snapshot so the input layer can hit-test against what the player can see.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Types = require(ReplicatedStorage.Shared.Types)

local Renderer = {}
Renderer.__index = Renderer

export type CellLayout = {
	id: number,
	position: Vector2,
	tier: number,
	radius: number,
	capacity: number,
	slots: number,
}

local BOARD = Vector2.new(Config.BOARD_WIDTH, Config.BOARD_HEIGHT)
local PULSE_SIZE = 12

-- Board units -> UDim2 scale. The board frame is aspect-locked to 1000x600, so
-- this mapping is uniform in pixels and angles survive it unchanged.
local function scalePos(p: Vector2): UDim2
	return UDim2.fromScale(p.X / BOARD.X, p.Y / BOARD.Y)
end

local function scaleSize(width: number, height: number): UDim2
	return UDim2.fromScale(width / BOARD.X, height / BOARD.Y)
end

local function distanceToSegment(point: Vector2, a: Vector2, b: Vector2): number
	local ab = b - a
	local lengthSq = ab:Dot(ab)
	if lengthSq <= 1e-6 then
		return (point - a).Magnitude
	end
	local t = math.clamp((point - a):Dot(ab) / lengthSq, 0, 1)
	return (point - (a + ab * t)).Magnitude
end

-- Builds the two HUD labels that live outside the board frame.
local function buildHud(gui: ScreenGui): (TextLabel, TextLabel)
	local status = Instance.new("TextLabel")
	status.Name = "Status"
	status.AnchorPoint = Vector2.new(0.5, 0)
	status.Position = UDim2.new(0.5, 0, 0, 12)
	status.Size = UDim2.new(0, 460, 0, 26)
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
	hint.Size = UDim2.new(0, 620, 0, 22)
	hint.BackgroundTransparency = 1
	hint.Font = Enum.Font.Gotham
	hint.TextSize = 14
	hint.TextColor3 = Color3.fromRGB(150, 150, 165)
	hint.Text = "Drag to attach a tentacle  -  let it charge, then click it to cut and dump the whole charge"
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
	backdrop.Name = "Backdrop"
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

	-- Treat the parent size as a bound on both axes so the board letterboxes
	-- rather than overflowing on tall phone screens.
	local ratio = Instance.new("UIAspectRatioConstraint")
	ratio.AspectRatio = BOARD.X / BOARD.Y
	ratio.AspectType = Enum.AspectType.FitWithinMaxSize
	ratio.Parent = board

	-- Tentacles render under cells so the numbers stay readable.
	local tentacleLayer = Instance.new("Frame")
	tentacleLayer.Name = "Tentacles"
	tentacleLayer.Size = UDim2.fromScale(1, 1)
	tentacleLayer.BackgroundTransparency = 1
	tentacleLayer.ZIndex = 2
	tentacleLayer.Parent = board

	local cellLayer = Instance.new("Frame")
	cellLayer.Name = "Cells"
	cellLayer.Size = UDim2.fromScale(1, 1)
	cellLayer.BackgroundTransparency = 1
	cellLayer.ZIndex = 3
	cellLayer.Parent = board

	-- Energy in transit draws above the tentacles but below the cells.
	local pulseLayer = Instance.new("Frame")
	pulseLayer.Name = "Pulses"
	pulseLayer.Size = UDim2.fromScale(1, 1)
	pulseLayer.BackgroundTransparency = 1
	pulseLayer.ZIndex = 2
	pulseLayer.Parent = board

	local chargeLayer = Instance.new("Frame")
	chargeLayer.Name = "Charges"
	chargeLayer.Size = UDim2.fromScale(1, 1)
	chargeLayer.BackgroundTransparency = 1
	chargeLayer.ZIndex = 5
	chargeLayer.Parent = board

	-- Ring showing how far the selected cell can reach.
	local range = Instance.new("Frame")
	range.Name = "Range"
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
	rangeStroke.Thickness = 1
	rangeStroke.Parent = range

	local drag = Instance.new("Frame")
	drag.Name = "DragGhost"
	drag.AnchorPoint = Vector2.new(0.5, 0.5)
	drag.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	drag.BackgroundTransparency = 0.45
	drag.BorderSizePixel = 0
	drag.Visible = false
	drag.ZIndex = 4
	drag.Parent = board

	local status, banner = buildHud(gui)

	return setmetatable({
		gui = gui,
		board = board,
		tentacleLayer = tentacleLayer,
		pulseLayer = pulseLayer,
		chargeLayer = chargeLayer,
		cellLayer = cellLayer,
		rangeFrame = range,
		dragFrame = drag,
		statusLabel = status,
		bannerLabel = banner,

		layout = {} :: { [number]: CellLayout },
		layoutOrder = {} :: { number },
		cellState = {} :: { [number]: Types.CellState },
		tentacleState = {} :: { [number]: Types.TentacleState },
		tentacleOrder = {} :: { number },
		cellFrames = {} :: { [number]: Frame },
		tentacleFrames = {} :: { [number]: Frame },
		pulsePool = {} :: { Frame },
		chargePool = {} :: { TextLabel },
		factions = {} :: { number },
		faction = Config.NEUTRAL,
		remaining = Config.ROUND_TIME_LIMIT,
		selected = nil :: number?,
	}, Renderer)
end

--=============================================================================
-- Layout
--=============================================================================

function Renderer.setLayout(self: any, cells: { CellLayout }, factions: { number }, faction: number)
	for _, frame in self.cellFrames do
		frame:Destroy()
	end
	for _, frame in self.tentacleFrames do
		frame:Destroy()
	end

	for _, frame in self.pulsePool do
		frame.Visible = false
	end
	for _, label in self.chargePool do
		label.Visible = false
	end

	self.cellFrames = {}
	self.tentacleFrames = {}
	self.layout = {}
	self.layoutOrder = {}
	self.cellState = {}
	self.tentacleState = {}
	self.tentacleOrder = {}
	self.factions = factions
	self.faction = faction
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
		frame.ZIndex = 3
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
		label.Name = "Units"
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.GothamBold
		label.TextScaled = true
		label.TextColor3 = Color3.fromRGB(255, 255, 255)
		label.Text = "0"
		label.ZIndex = 4
		label.Parent = frame

		local padding = Instance.new("UIPadding")
		local inset = UDim.new(0.24, 0)
		padding.PaddingTop = inset
		padding.PaddingBottom = inset
		padding.PaddingLeft = inset
		padding.PaddingRight = inset
		padding.Parent = label

		self.cellFrames[cell.id] = frame
	end
end

--=============================================================================
-- Snapshot
--=============================================================================

-- Where a tentacle visually starts and ends right now, clipped to the two cell
-- edges so it reads as a connection rather than a line through the middle.
function Renderer.tentacleEndpoints(self: any, state: Types.TentacleState): (Vector2, Vector2)
	local from = self.layout[state.from]
	local to = self.layout[state.to]
	local delta = to.position - from.position
	local length = delta.Magnitude
	local direction = if length > 1e-6 then delta / length else Vector2.new(1, 0)

	local start = from.position + direction * from.radius
	local usable = math.max(0, length - from.radius - to.radius)
	local finish = start + direction * (usable * math.clamp(state.progress, 0, 1))
	return start, finish
end

local function drawSegment(frame: Frame, a: Vector2, b: Vector2, thickness: number)
	local delta = b - a
	local midpoint = (a + b) / 2
	frame.Position = scalePos(midpoint)
	frame.Size = scaleSize(math.max(delta.Magnitude, 1), thickness)
	frame.Rotation = math.deg(math.atan2(delta.Y, delta.X))
end

function Renderer.applySnapshot(self: any, snapshot: Types.Snapshot)
	for _, state in snapshot.cells do
		self.cellState[state.id] = state
		local frame = self.cellFrames[state.id]
		if frame then
			frame.BackgroundColor3 = Config.colorOf(state.owner)
			local label = frame:FindFirstChild("Units") :: TextLabel?
			if label then
				label.Text = tostring(state.units)
			end
		end
	end

	local seen: { [number]: boolean } = {}
	self.tentacleState = {}
	self.tentacleOrder = {}

	for _, state in snapshot.tentacles do
		seen[state.id] = true
		self.tentacleState[state.id] = state
		table.insert(self.tentacleOrder, state.id)

		local frame = self.tentacleFrames[state.id]
		if not frame then
			frame = Instance.new("Frame")
			frame.Name = `Tentacle{state.id}`
			frame.AnchorPoint = Vector2.new(0.5, 0.5)
			frame.BorderSizePixel = 0
			frame.ZIndex = 2
			frame.Parent = self.tentacleLayer

			local corner = Instance.new("UICorner")
			corner.CornerRadius = UDim.new(1, 0)
			corner.Parent = frame

			self.tentacleFrames[state.id] = frame
		end

		local start, finish = self:tentacleEndpoints(state)
		drawSegment(frame, start, finish, Config.TENTACLE_THICKNESS)
		frame.BackgroundColor3 = Config.colorOf(state.owner)
		-- Still growing reads as faded; connected and flowing reads as solid.
		frame.BackgroundTransparency = if state.connected then 0.05 else 0.45
	end

	for id, frame in self.tentacleFrames do
		if not seen[id] then
			frame:Destroy()
			self.tentacleFrames[id] = nil
		end
	end

	self.remaining = snapshot.remaining or 0
	self:drawTransit(snapshot)
	self:refreshSelection()
	self:refreshStatus()
end

-- Pooled: the number of in-flight pulses churns every frame, so frames are
-- reused and the tail is hidden rather than destroyed and rebuilt.
function Renderer.pulseFrame(self: any, index: number): Frame
	local frame = self.pulsePool[index]
	if frame then
		return frame
	end

	frame = Instance.new("Frame")
	frame.Name = `Pulse{index}`
	frame.AnchorPoint = Vector2.new(0.5, 0.5)
	frame.Size = scaleSize(PULSE_SIZE, PULSE_SIZE)
	frame.BorderSizePixel = 0
	frame.ZIndex = 2
	frame.Parent = self.pulseLayer

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = frame

	self.pulsePool[index] = frame
	return frame
end

function Renderer.chargeLabel(self: any, index: number): TextLabel
	local label = self.chargePool[index]
	if label then
		return label
	end

	label = Instance.new("TextLabel")
	label.Name = `Charge{index}`
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Size = UDim2.new(0, 44, 0, 16)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextSize = 13
	label.TextStrokeTransparency = 0.4
	label.ZIndex = 5
	label.Parent = self.chargeLayer

	self.chargePool[index] = label
	return label
end

-- Draws the energy travelling inside every tentacle, plus a readout of the
-- standing charge on the player's own connected tentacles -- that number is
-- exactly what a cut would land, so it is the number the decision hangs on.
function Renderer.drawTransit(self: any, snapshot: Types.Snapshot)
	local pulses = 0
	local charges = 0

	for _, state in snapshot.tentacles do
		local from = self.layout[state.from]
		local to = self.layout[state.to]
		if not from or not to then
			continue
		end

		local delta = to.position - from.position
		local length = delta.Magnitude
		local direction = if length > 1e-6 then delta / length else Vector2.new(1, 0)
		local start = from.position + direction * from.radius
		local finish = to.position - direction * to.radius
		local color = Config.colorOf(state.owner)

		for _, position in state.pulses do
			pulses += 1
			local frame = self:pulseFrame(pulses)
			local fraction = if length > 1e-6 then math.clamp(position / length, 0, 1) else 0
			frame.Position = scalePos(start + (finish - start) * fraction)
			frame.BackgroundColor3 = color
			frame.Visible = true
		end

		if state.owner == self.faction and state.connected and state.payload >= 1 then
			charges += 1
			local label = self:chargeLabel(charges)
			label.Position = scalePos((start + finish) / 2)
			label.Text = tostring(state.payload)
			label.TextColor3 = color
			label.Visible = true
		end
	end

	for index = pulses + 1, #self.pulsePool do
		self.pulsePool[index].Visible = false
	end
	for index = charges + 1, #self.chargePool do
		self.chargePool[index].Visible = false
	end
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
		local cells = 0
		local units = 0
		for _, state in self.cellState do
			if state.owner == faction then
				cells += 1
				units += state.units
			end
		end
		local tag = if faction == self.faction then "You" else `F{faction}`
		table.insert(parts, `{tag} {cells}c / {units}u`)
	end

	local seconds = math.max(0, math.floor(self.remaining))
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
			if id == self.selected then
				stroke.Transparency = 0
			elseif mine then
				stroke.Transparency = 0.55
			else
				stroke.Transparency = 1
			end
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
	if not cell then
		return
	end
	drawSegment(self.dragFrame, cell.position, pointer, 4)
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

-- Screen pixels -> board units. Returns nil when the pointer is off the board.
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
	local best: CellLayout? = nil
	local bestDistance = math.huge
	for _, id in self.layoutOrder do
		local cell = self.layout[id]
		local distance = (point - cell.position).Magnitude
		-- Small forgiveness margin so touch input is not punishing.
		if distance <= cell.radius + 8 and distance < bestDistance then
			best = cell
			bestDistance = distance
		end
	end
	return best
end

function Renderer.tentacleAt(self: any, point: Vector2, owner: number): number?
	local best: number? = nil
	local bestDistance = math.huge
	for _, id in self.tentacleOrder do
		local state = self.tentacleState[id]
		if state.owner ~= owner then
			continue
		end
		local start, finish = self:tentacleEndpoints(state)
		local distance = distanceToSegment(point, start, finish)
		if distance <= Config.TENTACLE_THICKNESS + 6 and distance < bestDistance then
			best = id
			bestDistance = distance
		end
	end
	return best
end

function Renderer.ownerOf(self: any, cellId: number): number
	local state = self.cellState[cellId]
	return if state then state.owner else Config.NEUTRAL
end

function Renderer.freeSlots(self: any, cellId: number): number
	local cell = self.layout[cellId]
	if not cell then
		return 0
	end
	local used = 0
	for _, id in self.tentacleOrder do
		if self.tentacleState[id].from == cellId then
			used += 1
		end
	end
	return cell.slots - used
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
