import { describe, expect, it } from 'vitest';
import { layOut, layoutDurationUs, sessionAt, splitRange } from './layout.ts';

const s = 1_000_000;
const layout = layOut([10 * s, 5 * s, 20 * s]);

describe('layOut', () => {
	it('lays Sessions end to end', () => {
		expect(layout).toEqual([
			{ offsetUs: 0, durationUs: 10 * s },
			{ offsetUs: 10 * s, durationUs: 5 * s },
			{ offsetUs: 15 * s, durationUs: 20 * s }
		]);
		expect(layoutDurationUs(layout)).toBe(35 * s);
		expect(layoutDurationUs([])).toBe(0);
	});
});

describe('sessionAt', () => {
	it('finds the Session at a moment, from its start up to its end', () => {
		expect(sessionAt(layout, 0)).toEqual({ index: 0, localUs: 0 });
		expect(sessionAt(layout, 10 * s)).toEqual({ index: 1, localUs: 0 });
		expect(sessionAt(layout, 17 * s)).toEqual({ index: 2, localUs: 2 * s });
	});

	it('gives the end of the timeline to the last Session', () => {
		expect(sessionAt(layout, 35 * s)).toEqual({ index: 2, localUs: 20 * s });
		expect(sessionAt(layout, 99 * s)).toEqual({ index: 2, localUs: 20 * s });
		expect(sessionAt([], 5)).toEqual({ index: -1, localUs: 0 });
	});
});

describe('splitRange', () => {
	it('keeps a range inside one Session as it is, on that Session\'s timeline', () => {
		expect(splitRange(layout, { startUs: 11 * s, endUs: 13 * s })).toEqual([{ index: 1, startUs: 1 * s, endUs: 3 * s }]);
	});

	it('divides a range across boundaries, one part per Session', () => {
		expect(splitRange(layout, { startUs: 8 * s, endUs: 17 * s })).toEqual([
			{ index: 0, startUs: 8 * s, endUs: 10 * s },
			{ index: 1, startUs: 0, endUs: 5 * s },
			{ index: 2, startUs: 0, endUs: 2 * s }
		]);
	});

	it('leaves out a Session the range only touches at its edge', () => {
		expect(splitRange(layout, { startUs: 5 * s, endUs: 10 * s })).toEqual([{ index: 0, startUs: 5 * s, endUs: 10 * s }]);
	});
});
