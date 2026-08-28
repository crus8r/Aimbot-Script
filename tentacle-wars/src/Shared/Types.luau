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
	-- Which AI profile drives a faction no player is seated in.
	ai: { [number]: string }?,
	-- Finish under starTimes[n] seconds to earn n stars. Descending.
	starTimes: { number }?,
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

-- A packet of energy in transit, positioned in board units from the source.
export type Pulse = {
	amount: number,
	position: number,
}

export type Tentacle = {
	id: number,
	from: number,
	to: number,
	owner: number,
	length: number,
	progress: number,
	connected: boolean,
	sinceEmit: number,
	pulses: { Pulse },
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
	payload: number,
	pulses: { number },
}
export type Snapshot = {
	cells: { CellState },
	tentacles: { TentacleState },
	remaining: number,
}

return {}
