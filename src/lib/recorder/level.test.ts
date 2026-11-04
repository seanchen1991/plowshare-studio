import { describe, expect, it } from 'vitest';
import { emptyMeter, floorDb, levelStatus, meterPosition, toDb, updateMeter, type MeterState } from './level.ts';

/** Feeds one peak per 20 ms frame, starting at `from`. */
function feed(state: MeterState, peaks: number[], from: number): MeterState {
	return peaks.reduce((s, peak, i) => updateMeter(s, peak, from + i * 20), state);
}

describe('toDb and meterPosition', () => {
	it('maps amplitude to dBFS with a floor', () => {
		expect(toDb(1)).toBe(0);
		expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
		expect(toDb(0)).toBe(floorDb);
		expect(toDb(1e-9)).toBe(floorDb);
	});

	it('places levels on the meter from floor to full scale', () => {
		expect(meterPosition(floorDb)).toBe(0);
		expect(meterPosition(-30)).toBe(0.5);
		expect(meterPosition(0)).toBe(1);
		expect(meterPosition(-90)).toBe(0);
	});
});

describe('updateMeter', () => {
	it('jumps up at once and falls gently', () => {
		let s = updateMeter(emptyMeter(0), 0.5, 0);
		expect(s.levelDb).toBeCloseTo(-6, 0);
		s = updateMeter(s, 0, 100);
		// 30 dB per second for 100 ms.
		expect(s.levelDb).toBeCloseTo(-9, 0);
	});

	it('holds the peak for 1.5 s, then lets it fall', () => {
		let s = updateMeter(emptyMeter(0), 0.5, 0);
		s = updateMeter(s, 0.01, 1000);
		expect(s.peakDb).toBeCloseTo(-6, 0);
		s = updateMeter(s, 0.01, 1600);
		expect(s.peakDb).toBeLessThan(-20);
	});
});

describe('levelStatus', () => {
	const speech = (seconds: number, peak: number) => Array.from({ length: seconds * 50 }, (_, i) => (i % 10 === 0 ? peak : peak / 4));

	it('is good when speech peaks reach -30 dBFS', () => {
		const s = feed(emptyMeter(0), speech(3, 0.1), 0); // -20 dBFS
		expect(levelStatus(s, 3000)).toBe('good');
	});

	it('is too quiet when nothing in the last 3 s reached -30 dBFS', () => {
		const s = feed(emptyMeter(0), speech(3, 0.02), 0); // -34 dBFS
		expect(levelStatus(s, 3000)).toBe('quiet');
	});

	it('forgets loud moments after 3 s', () => {
		let s = feed(emptyMeter(0), speech(1, 0.3), 0);
		s = feed(s, speech(4, 0.005), 1000);
		expect(levelStatus(s, 5000)).toBe('quiet');
	});

	it('flags clipping for 2 s after a sample reaches full scale', () => {
		let s = feed(emptyMeter(0), speech(1, 0.3), 0);
		s = updateMeter(s, -1, 1000);
		expect(levelStatus(s, 1000)).toBe('clipping');
		s = feed(s, speech(2, 0.3), 1020);
		expect(levelStatus(s, 3000)).toBe('clipping');
		s = feed(s, speech(1, 0.3), 3040);
		expect(levelStatus(s, 4040)).toBe('good');
	});

	it('does not call 0.98 clipping', () => {
		const s = updateMeter(emptyMeter(0), 0.98, 0);
		expect(levelStatus(s, 0)).toBe('good');
	});
});
