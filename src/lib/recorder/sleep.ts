// Telling that the computer slept during a take. Nothing runs while it sleeps,
// so on waking the wall clock has jumped ahead: of the gap MediaRecorder's
// chunks should arrive at, and (where the browser's monotonic clock stops
// during sleep, as on macOS) of the monotonic clock.

export interface ClockReading {
	/** `Date.now()`: keeps counting through sleep. */
	wallMs: number;
	/** `performance.now()`: may stop during sleep. */
	monoMs: number;
}

/** MediaRecorder hands over a chunk every 2 s, even in a hidden tab; this long without one means the computer slept. */
export const chunkGapMs = 10_000;
/** The wall clock running this far ahead of the monotonic one means it slept. */
export const clockJumpMs = 5_000;

export function readClocks(): ClockReading {
	return { wallMs: Date.now(), monoMs: performance.now() };
}

function jump(from: ClockReading, to: ClockReading): number {
	return to.wallMs - from.wallMs - (to.monoMs - from.monoMs);
}

export function watchForSleep(read: () => ClockReading = readClocks) {
	let lastChunk = read();
	let lastTick = lastChunk;
	return {
		/** Call when a chunk arrives; true if the computer slept since the last one. */
		chunk(): boolean {
			const now = read();
			const slept = now.wallMs - lastChunk.wallMs > chunkGapMs || jump(lastChunk, now) > clockJumpMs;
			lastChunk = now;
			return slept;
		},
		/** Call from a timer; true if the computer slept since the last tick. A throttled timer alone doesn't count. */
		tick(): boolean {
			const now = read();
			const slept = jump(lastTick, now) > clockJumpMs;
			lastTick = now;
			return slept;
		}
	};
}
