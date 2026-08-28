--!strict

export type CellSpec = {
	id: number,
	position: Vector2,
	tier: number,
	owner: number?,
	units: number?,
}

export type Level = {
	name: string,
	factions: { number },
	cells: { CellSpec },
}

export type Cell = {
	id: number,
	position: Vector2,
	tier: number,
	radius: number,
	capacity: number,
	regen: number,
	slots: number,
	owner: number,
	units: number,
}

export type Tentacle = {
	id: number,
	from: number,
	to: number,
	owner: number,
	length: number,
	progress: number,
	connected: boolean,
}

-- Compact wire formats. Cell positions/tiers never change, so they are sent
-- once at round start and omitted from every snapshot.
export type CellState = { id: number, owner: number, units: number }
export type TentacleState = {
	id: number,
	from: number,
	to: number,
	owner: number,
	progress: number,
	connected: boolean,
}
export type Snapshot = {
	cells: { CellState },
	tentacles: { TentacleState },
	remaining: number,
}

return {}
