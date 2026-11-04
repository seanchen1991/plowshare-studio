// The mic level meter's arithmetic: level with a gentle fall, peak hold,
// clipping, and whether the level is too quiet. Pure; level-meter.ts feeds it
// one peak per animation frame.

/** Levels are in dBFS: 0 is full scale, the meter's floor is -60. */
export const floorDb = -60;
/** A sample this close to full scale counts as clipping (about -0.1 dBFS). */
export const clipAmplitude = 0.99;
/** Speech whose loudest moments stay below this is too quiet to record well. */
export const quietDb = -30;
/** How far back "too quiet" looks: long enough to cover a pause between words. */
export const quietWindowMs = 3000;
export const peakHoldMs = 1500;
export const clipHoldMs = 2000;
/** How fast the level and the held peak fall, in dB per second. */
export const fallDbPerSecond = 30;

export type LevelStatus = 'good' | 'quiet' | 'clipping';

export interface MeterState {
	levelDb: number;
	peakDb: number;
	peakAt: number;
	clippedAt: number | null;
	/** Peaks of the last few seconds, oldest first. */
	recent: { at: number; db: number }[];
	updatedAt: number;
}

export function toDb(amplitude: number): number {
	return amplitude > 0 ? Math.max(floorDb, 20 * Math.log10(amplitude)) : floorDb;
}

/** Where a level sits on the meter, 0 (floor) to 1 (full scale). */
export function meterPosition(db: number): number {
	return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}

export function emptyMeter(now: number): MeterState {
	return { levelDb: floorDb, peakDb: floorDb, peakAt: now, clippedAt: null, recent: [], updatedAt: now };
}

/** The meter after one more peak (the largest absolute sample since the last update). */
export function updateMeter(state: MeterState, peak: number, now: number): MeterState {
	const db = toDb(Math.abs(peak));
	const fallen = (fallDbPerSecond * (now - state.updatedAt)) / 1000;
	const levelDb = Math.max(db, state.levelDb - fallen);

	let { peakDb, peakAt } = state;
	if (db >= peakDb) {
		peakDb = db;
		peakAt = now;
	} else if (now - peakAt > peakHoldMs) {
		peakDb = Math.max(levelDb, peakDb - fallen);
	}

	const clippedAt = Math.abs(peak) >= clipAmplitude ? now : state.clippedAt;
	const recent = state.recent.filter((p) => p.at > now - quietWindowMs);
	recent.push({ at: now, db });
	return { levelDb, peakDb, peakAt, clippedAt, recent, updatedAt: now };
}

export function isClipping(state: MeterState, now: number): boolean {
	return state.clippedAt !== null && now - state.clippedAt <= clipHoldMs;
}

/** Clipping in the last two seconds wins; otherwise too quiet if nothing in the last three reached -30 dBFS. */
export function levelStatus(state: MeterState, now: number): LevelStatus {
	if (isClipping(state, now)) return 'clipping';
	const loudest = Math.max(floorDb, ...state.recent.filter((p) => p.at > now - quietWindowMs).map((p) => p.db));
	return loudest < quietDb ? 'quiet' : 'good';
}
