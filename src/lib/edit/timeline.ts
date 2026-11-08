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

/**
 * Times of the ruler's marks between `fromUs` and `toUs` (the part on screen),
 * at the smallest step that keeps them `minSpacingPx` apart at this zoom.
 */
export function rulerMarks(fromUs: number, toUs: number, pxPerSecond: number, minSpacingPx = 80): number[] {
	if (toUs <= fromUs || pxPerSecond <= 0) return [0];
	const step = (rulerSteps.find((s) => s * pxPerSecond >= minSpacingPx) ?? rulerSteps.at(-1)!) * 1e6;
	const marks: number[] = [];
	for (let us = Math.floor(Math.max(0, fromUs) / step) * step; us <= toUs; us += step) marks.push(us);
	return marks;
}

/** Each zoom step doubles or halves how much of the timeline is on screen. */
export const zoomStep = 2;

/**
 * How far in the timeline can zoom, as a multiple of fitting it all in `widthPx`:
 * down to 5 s across, or more when that would draw more bars than there are peaks.
 */
export function maxZoom(durationUs: number, widthPx: number, barStepPx: number, peaksPerSecond: number): number {
	const closestUs = Math.max(5e6, (widthPx / barStepPx / peaksPerSecond) * 1e6);
	return Math.max(1, durationUs / closestUs);
}

/**
 * Following the playhead while it plays: once it runs off the right edge of the
 * view, turn the page so it sits near the left. Returns where to scroll, or null to stay.
 * A playhead the user has scrolled away from isn't followed.
 */
export function followPlayhead(fromPx: number, toPx: number, scrollPx: number, viewPx: number): number | null {
	const end = scrollPx + viewPx;
	if (fromPx >= scrollPx && fromPx <= end && toPx > end) return toPx - viewPx * 0.1;
	return null;
}

/** Bringing a playhead that jumped out of view back into it, centred; null when it's in view. */
export function revealPlayhead(px: number, scrollPx: number, viewPx: number): number | null {
	return px < scrollPx || px > scrollPx + viewPx ? px - viewPx / 2 : null;
}
