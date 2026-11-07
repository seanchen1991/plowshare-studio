// A Session's timeline in the editor: how long it is, which Segment plays at
// a given moment, and where the ruler's marks go. Pure; times in microseconds.

import { recordingDurationUs, type Session } from '../storage/session-file.ts';

/** A finished Segment, as the editor places and plays it. */
export interface PlacedSegment {
	index: number;
	path: string;
	startUs: number;
	durationUs: number;
}

/** A Recording's finished Segments, in timeline order. */
export function placedSegments(segments: { index: number; path: string | null; startUs: number; durationUs: number | null }[]): PlacedSegment[] {
	return segments
		.filter((s): s is PlacedSegment => s.path !== null && s.durationUs !== null)
		.map(({ index, path, startUs, durationUs }) => ({ index, path, startUs, durationUs }))
		.sort((a, b) => a.startUs - b.startUs);
}

/** The Session's length: where its longest Recording ends. */
export function sessionDurationUs(session: Session): number {
	return Math.max(0, ...session.recordings.map((r) => recordingDurationUs(r) ?? 0));
}

export type Position =
	| { kind: 'segment'; segment: PlacedSegment; offsetUs: number }
	/** A Capture gap, or before the first Segment: `nextStartUs` is where the next one starts. */
	| { kind: 'gap'; nextStartUs: number }
	| { kind: 'end' };

/** What plays at `timeUs`. A Segment runs from its start up to, not including, its end. */
export function locate(segments: PlacedSegment[], timeUs: number): Position {
	for (const segment of segments) {
		if (timeUs < segment.startUs) return { kind: 'gap', nextStartUs: segment.startUs };
		if (timeUs < segment.startUs + segment.durationUs) return { kind: 'segment', segment, offsetUs: timeUs - segment.startUs };
	}
	return { kind: 'end' };
}

/** Steps between ruler marks, in seconds. */
const rulerSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Times of the ruler's marks: the smallest step that keeps them `minSpacingPx` apart. */
export function rulerMarks(durationUs: number, widthPx: number, minSpacingPx = 80): number[] {
	if (durationUs <= 0 || widthPx <= 0) return [0];
	const pxPerSecond = widthPx / (durationUs / 1e6);
	const step = rulerSteps.find((s) => s * pxPerSecond >= minSpacingPx) ?? rulerSteps.at(-1)!;
	const marks: number[] = [];
	for (let us = 0; us <= durationUs; us += step * 1e6) marks.push(us);
	return marks;
}
