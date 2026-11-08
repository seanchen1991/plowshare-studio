import { describe, expect, it } from 'vitest';
import { barHeight, loudestIn, PeakBuilder, peakByte, peakCount, peakDb } from './peaks.ts';

const rate = 1000;
const perSecond = 10; // 100 samples per bin

/** `seconds` of silence with a spike of `level` at each of `spikes` (seconds). */
function signal(seconds: number, spikes: [at: number, level: number][]): Float32Array {
	const samples = new Float32Array(seconds * rate);
	for (const [at, level] of spikes) samples[Math.round(at * rate)] = level;
	return samples;
}

describe('peakCount', () => {
	it('rounds up, so the last part-filled bin counts', () => {
		expect(peakCount(1_000_000, 10)).toBe(10);
		expect(peakCount(1_050_000, 10)).toBe(11);
		expect(peakCount(0, 10)).toBe(0);
	});
});

describe('peakByte and peakDb', () => {
	it('store a level in decibels, from the -90 dB floor (0) to full scale (255)', () => {
		expect(peakByte(1)).toBe(255);
		expect(peakByte(0.1)).toBe(198); // -20 dB
		expect(peakByte(0.001)).toBe(85); // -60 dB
		expect(peakByte(10 ** (-90 / 20))).toBe(0);
		expect(peakByte(1e-6)).toBe(0);
		expect(peakByte(0)).toBe(0);
		expect(peakByte(3)).toBe(255);
	});

	it('read back within 0.2 dB', () => {
		for (const db of [0, -6, -20, -45, -60, -89]) expect(Math.abs(peakDb(peakByte(10 ** (db / 20))) - db)).toBeLessThan(0.2);
		expect(peakDb(0)).toBe(-90);
	});
});

describe('barHeight', () => {
	it('draws -60 dB and below as nothing, full scale as the whole height', () => {
		expect(barHeight(peakByte(1))).toBe(1);
		expect(barHeight(peakByte(10 ** (-30 / 20)))).toBeCloseTo(0.5, 1);
		expect(barHeight(peakByte(10 ** (-60 / 20)))).toBeCloseTo(0, 1);
		expect(barHeight(0)).toBe(0);
	});

	it('shows quiet speech clearly, where a linear scale would draw it a pixel tall', () => {
		// Peaks around -25 dBFS, normal for speech, use more than half the height.
		expect(barHeight(peakByte(0.056))).toBeGreaterThan(0.55);
	});
});

describe('PeakBuilder', () => {
	it('keeps the loudest sample in each bin', () => {
		const builder = new PeakBuilder(10, rate, perSecond);
		builder.add(0, [signal(1, [[0.05, 0.5], [0.25, -1], [0.26, 0.2], [0.99, 0.1]])]);
		expect(Array.from(builder.peaks)).toEqual([peakByte(0.5), 0, 255, 0, 0, 0, 0, 0, 0, peakByte(0.1)]);
	});

	it('gives the same peaks however the audio is split into blocks', () => {
		const audio = signal(2, [[0.1, 0.3], [0.199, 0.9], [0.2, 0.4], [1.55, -0.7], [1.999, 0.2]]);
		const whole = new PeakBuilder(20, rate, perSecond);
		whole.add(0, [audio]);

		const split = new PeakBuilder(20, rate, perSecond);
		for (let start = 0; start < audio.length; start += 37) {
			split.add(start / rate, [audio.subarray(start, start + 37)]);
		}
		expect(Array.from(split.peaks)).toEqual(Array.from(whole.peaks));
	});

	it('takes the loudest of all channels', () => {
		const builder = new PeakBuilder(2, rate, perSecond);
		builder.add(0, [signal(0.2, [[0.05, 0.2]]), signal(0.2, [[0.06, -0.6], [0.15, 0.4]])]);
		expect(Array.from(builder.peaks)).toEqual([peakByte(0.6), peakByte(0.4)]);
	});

	it('places audio by its timestamp, leaving untouched bins silent', () => {
		const builder = new PeakBuilder(10, rate, perSecond);
		const range = builder.add(0.5, [signal(0.2, [[0, 1], [0.15, 0.5]])]);
		expect(range).toEqual({ from: 5, to: 7 });
		expect(Array.from(builder.peaks)).toEqual([0, 0, 0, 0, 0, 255, peakByte(0.5), 0, 0, 0]);
	});

	it('ignores audio before the start or past the end, and clips levels above 1', () => {
		const builder = new PeakBuilder(3, rate, perSecond);
		builder.add(-0.1, [signal(0.2, [[0.05, 0.9], [0.15, 2]])]);
		builder.add(0.25, [signal(0.2, [[0.15, 0.9]])]);
		expect(Array.from(builder.peaks)).toEqual([255, 0, 0]);
	});

	it('reports no bins for an empty block', () => {
		const builder = new PeakBuilder(3, rate, perSecond);
		expect(builder.add(0.1, [new Float32Array(0)])).toEqual({ from: 1, to: 1 });
	});
});

describe('loudestIn', () => {
	const peaks = Uint8Array.from([0, 51, 255, 102, 0]);

	it('is the loudest bin the range touches', () => {
		expect(loudestIn(peaks, 0, 2)).toBe(51);
		expect(loudestIn(peaks, 1.5, 2.2)).toBe(255);
		expect(loudestIn(peaks, 3, 5)).toBe(102);
	});

	it('reads at least one bin, and nothing outside the peaks', () => {
		expect(loudestIn(peaks, 3.2, 3.4)).toBe(102);
		expect(loudestIn(peaks, 9, 12)).toBe(0);
		expect(loudestIn(peaks, -3, 0.5)).toBe(0);
	});
});
