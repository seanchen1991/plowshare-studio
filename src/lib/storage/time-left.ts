// Recording time left (Handoff brief, Storage): how much longer capture can run
// before the disk can no longer hold both the raw and the finished copy. Pure.

/** Kept free beyond what the takes need, for Session files and the browser's own bookkeeping. */
export const safetyMarginBytes = 500_000_000;
/** Recording doesn't start with less room than this. */
export const minimumSecondsToStart = 10 * 60;
/** Warnings while Capturing, most urgent last. */
export const warningSeconds = [15 * 60, 5 * 60] as const;

export interface StorageMeasure {
	/** What the browser lets this site store, and what it stores now (`navigator.storage.estimate()`). */
	quota: number;
	usage: number;
	/**
	 * Raw files still waiting for their finished copy (Finalizing, Interrupted, or
	 * the take being captured). Each copy is about as big as its raw file.
	 */
	rawBytes: number;
}

/**
 * Seconds of capture at `bitsPerSecond` that still fit: (free − margin − room
 * owed to finished copies) ÷ 2, since every byte recorded also needs its copy.
 */
export function recordingTimeLeftSeconds({ quota, usage, rawBytes }: StorageMeasure, bitsPerSecond: number): number {
	const room = quota - usage - rawBytes - safetyMarginBytes;
	return Math.max(0, room / 2 / (bitsPerSecond / 8));
}

/** The warning due at `secondsLeft` (the most urgent threshold reached), or null above them all. */
export function warningDue(secondsLeft: number): (typeof warningSeconds)[number] | null {
	return warningSeconds.filter((threshold) => secondsLeft <= threshold).at(-1) ?? null;
}

/** "about 4 h 10 m", "about 35 m", or "less than a minute". Rounded down: it is room left. */
export function formatTimeLeft(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	if (minutes < 1) return 'less than a minute';
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `about ${m} m`;
	return m === 0 ? `about ${h} h` : `about ${h} h ${m} m`;
}
