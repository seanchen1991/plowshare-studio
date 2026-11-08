import { describe, expect, it } from 'vitest';
import type { Recording, Session } from '../storage/session-file.ts';
import { locate, placedSegments, rulerMarks, sessionDurationUs } from './timeline.ts';

const segment = (index: number, startUs: number, durationUs: number | null, path: string | null = `seg-0${index}.mp4`) => ({
	index,
	path,
	startUs,
	durationUs
});

describe('placedSegments', () => {
	it('keeps finished Segments in timeline order', () => {
		expect(placedSegments([segment(2, 15_000_000, 5_000_000), segment(1, 0, 10_000_000), segment(3, 30_000_000, null, null)])).toEqual([
			segment(1, 0, 10_000_000),
			segment(2, 15_000_000, 5_000_000)
		]);
	});
});

describe('sessionDurationUs', () => {
	const recording = (segments: Recording['segments']) => ({ segments }) as Recording;
	const seg = (startUs: number, durationUs: number | null) => ({ ...segment(1, startUs, durationUs), rawPath: null, manifestPath: null, downloaded: false, frames: null });

	it('is where the longest Recording ends, Capture gaps included', () => {
		const session = { recordings: [recording([seg(0, 10_000_000), seg(15_000_000, 5_000_000)]), recording([seg(0, 12_000_000)])] } as Session;
		expect(sessionDurationUs(session)).toBe(20_000_000);
	});

	it('is 0 before any Segment has a duration', () => {
		expect(sessionDurationUs({ recordings: [recording([seg(0, null)])] } as Session)).toBe(0);
	});
});

describe('locate', () => {
	const segments = placedSegments([segment(1, 0, 10_000_000), segment(2, 15_000_000, 5_000_000)]);

	it('finds the Segment and how far into it', () => {
		expect(locate(segments, 0)).toEqual({ kind: 'segment', segment: segments[0], offsetUs: 0 });
		expect(locate(segments, 9_999_999)).toEqual({ kind: 'segment', segment: segments[0], offsetUs: 9_999_999 });
		expect(locate(segments, 16_000_000)).toEqual({ kind: 'segment', segment: segments[1], offsetUs: 1_000_000 });
	});

	it('reports a Capture gap with where the next Segment starts', () => {
		expect(locate(segments, 10_000_000)).toEqual({ kind: 'gap', nextStartUs: 15_000_000 });
		expect(locate(segments, 14_999_999)).toEqual({ kind: 'gap', nextStartUs: 15_000_000 });
	});

	it('reports the end at and after the last Segment', () => {
		expect(locate(segments, 20_000_000)).toEqual({ kind: 'end' });
		expect(locate([], 0)).toEqual({ kind: 'end' });
	});

	it('treats time before a late first Segment as a gap', () => {
		expect(locate(placedSegments([segment(1, 2_000_000, 1_000_000)]), 0)).toEqual({ kind: 'gap', nextStartUs: 2_000_000 });
	});
});

describe('rulerMarks', () => {
	it('uses the smallest step that keeps marks apart', () => {
		// 30 s across 1000 px: 33 px a second, so 5 s steps (167 px) are the first at least 80 px apart.
		expect(rulerMarks(30_000_000, 1000)).toEqual([0, 5, 10, 15, 20, 25, 30].map((s) => s * 1e6));
	});

	it('steps in minutes for long takes', () => {
		const marks = rulerMarks(60 * 60e6, 1000);
		expect(marks[1]).toBe(300e6);
		expect(marks.at(-1)).toBe(3600e6);
	});

	it('has just the start for an empty timeline', () => {
		expect(rulerMarks(0, 1000)).toEqual([0]);
		expect(rulerMarks(10e6, 0)).toEqual([0]);
	});
});
