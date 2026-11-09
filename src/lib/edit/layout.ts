// A Project's Sessions laid end to end on the editor's timeline: where each
// starts, which one is at a moment, and how a range across them divides into
// one range per Session (a Cut never crosses into the next Session). Pure; µs.

import type { Range } from './cuts.ts';

/** One Session's place on the timeline. */
export interface Placed {
	offsetUs: number;
	durationUs: number;
}

/** Sessions of these lengths, end to end. */
export function layOut(durationsUs: number[]): Placed[] {
	let offsetUs = 0;
	return durationsUs.map((durationUs) => {
		const placed = { offsetUs, durationUs };
		offsetUs += durationUs;
		return placed;
	});
}

/** How long the timeline is. */
export function layoutDurationUs(layout: Placed[]): number {
	const last = layout.at(-1);
	return last ? last.offsetUs + last.durationUs : 0;
}

/** The Session at a moment on the timeline, and the moment in it; the end belongs to the last Session. */
export function sessionAt(layout: Placed[], timelineUs: number): { index: number; localUs: number } {
	if (layout.length === 0) return { index: -1, localUs: 0 };
	const index = layout.findIndex((p) => timelineUs < p.offsetUs + p.durationUs);
	const i = index < 0 ? layout.length - 1 : index;
	const placed = layout[i]!;
	return { index: i, localUs: Math.min(Math.max(0, timelineUs - placed.offsetUs), placed.durationUs) };
}

/** A range on the timeline as one range per Session it touches, each on that Session's own timeline. */
export function splitRange(layout: Placed[], range: Range): { index: number; startUs: number; endUs: number }[] {
	const parts: { index: number; startUs: number; endUs: number }[] = [];
	layout.forEach((placed, index) => {
		const startUs = Math.max(range.startUs, placed.offsetUs) - placed.offsetUs;
		const endUs = Math.min(range.endUs, placed.offsetUs + placed.durationUs) - placed.offsetUs;
		if (endUs > startUs) parts.push({ index, startUs, endUs });
	});
	return parts;
}
