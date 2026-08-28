--!strict

export type CellSpec = {
	id: number,
	position: Vector2,
	owner: number?,
	value: number?,
	radius: number?,
}

export type Level = {
	name: string,
	factions: { number },
	ai: { [number]: string }?,
	starTimes: { number }?,
	powerLimit: number?,
	cells: { CellSpec },
}

export type Cell = {
	id: number,
	position: Vector2,
	radius: number,
	owner: number,
	value: number,
}

-- All chain measurements are in segments, not board units. One segment is
-- Config.SEGMENT_LENGTH long and every Config.SEGMENTS_PER_ENERGY of them cost
-- the source one energy to extend.
export type Tentacle = {
	id: number,
	from: number,
	to: number,
	owner: number,
	span: number, -- segments from source edge to target edge
	length: number, -- segments currently extended
	attached: boolean,
	retracting: boolean,
	spendDebt: number,
	refundDebt: number,
	sinceEmit: number,
	pulses: { number }, -- positions in segments from the source
}

-- One half of a cut chain, reeling itself in. A refund pays back into `from`;
-- a discharge empties into `to`, but only if the chain had actually reached it.
export type Collapse = {
	id: number,
	from: number,
	to: number,
	owner: number,
	mode: string, -- "refund" | "discharge"
	delivers: boolean,
	remaining: number, -- segments left
	outer: number, -- outer edge, in segments from the source
	credit: number,
}

export type CellState = { id: number, owner: number, value: number }
export type TentacleState = {
	id: number,
	from: number,
	to: number,
	owner: number,
	span: number,
	length: number,
	attached: boolean,
	retracting: boolean,
	pulses: { number },
}
export type CollapseState = {
	id: number,
	from: number,
	to: number,
	owner: number,
	mode: string,
	remaining: number,
	outer: number,
}
export type Snapshot = {
	cells: { CellState },
	tentacles: { TentacleState },
	collapses: { CollapseState },
	remaining: number,
	limit: number,
}

return {}
