// Waveform peaks: the loudest sample in each short bin of a Segment's audio,
// across all its channels, stored as one byte on a decibel scale (linear bytes
// would leave quiet speech a pixel tall and too coarse to find pauses in).
// Pure; the peaks worker feeds it decoded audio a block at a time, so a long
// Segment never sits in memory.

/** Bins per second of audio: fine enough to zoom in to a few seconds across the screen. */
export const peaksPerSecond = 100;

/** The quietest level a peak can hold; anything quieter is stored as 0. */
export const peakFloorDb = -90;

/** A sample level (0–1, louder clipped) as a peak byte: 0 at the floor or below, 255 at full scale. */
export function peakByte(level: number): number {
	if (level <= 0) return 0;
	const db = 20 * Math.log10(Math.min(level, 1));
	return Math.max(0, Math.round(((db - peakFloorDb) / -peakFloorDb) * 255));
}

/** A peak byte back in dBFS; the floor for 0. */
export function peakDb(byte: number): number {
	return peakFloorDb + (byte / 255) * -peakFloorDb;
}

/** The quietest level the waveform shows: anything below draws as the thinnest line. */
const shownFromDb = -60;

/** How tall a peak draws, as a share of the lane's half-height (0–1). */
export function barHeight(byte: number): number {
	return Math.min(1, Math.max(0, (peakDb(byte) - shownFromDb) / -shownFromDb));
}

/** How many bins a Segment of this length has. */
export function peakCount(durationUs: number, perSecond = peaksPerSecond): number {
	return Math.ceil((durationUs / 1e6) * perSecond);
}

export class PeakBuilder {
	readonly peaks: Uint8Array<ArrayBuffer>;

	constructor(
		count: number,
		private readonly sampleRate: number,
		private readonly perSecond = peaksPerSecond
	) {
		this.peaks = new Uint8Array(count);
	}

	/**
	 * Adds a block of audio that starts `timestamp` seconds into the Segment, one
	 * array per channel. Returns the bins it touched, `from` up to but not including `to`.
	 */
	add(timestamp: number, channels: Float32Array[]): { from: number; to: number } {
		const frames = channels[0]?.length ?? 0;
		const start = Math.round(timestamp * this.sampleRate);
		const binOf = (sample: number) => Math.floor((sample * this.perSecond) / this.sampleRate);
		const from = Math.max(0, binOf(start));
		const to = Math.min(this.peaks.length, binOf(start + frames - 1) + 1);

		for (let bin = from; bin < to; bin++) {
			// The block's frames that fall in this bin.
			const first = Math.max(0, Math.ceil((bin * this.sampleRate) / this.perSecond) - start);
			const end = Math.min(frames, Math.ceil(((bin + 1) * this.sampleRate) / this.perSecond) - start);
			let loudest = 0;
			for (const samples of channels) {
				for (let i = first; i < end; i++) {
					const level = Math.abs(samples[i]!);
					if (level > loudest) loudest = level;
				}
			}
			const peak = peakByte(loudest);
			if (peak > this.peaks[bin]!) this.peaks[bin] = peak;
		}
		return { from, to: Math.max(from, to) };
	}
}

/** The loudest peak byte from bin `from` up to `to` (fractions allowed); 0 for an empty range. */
export function loudestIn(peaks: Uint8Array, from: number, to: number): number {
	const first = Math.max(0, Math.floor(from));
	const end = Math.min(peaks.length, Math.max(first + 1, Math.ceil(to)));
	let loudest = 0;
	for (let i = first; i < end; i++) if (peaks[i]! > loudest) loudest = peaks[i]!;
	return loudest;
}
