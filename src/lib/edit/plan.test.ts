import { describe, expect, it } from 'vitest';
import type { Cut } from '../storage/project-file.ts';
import { editToSession, pieceAt, planDurationUs, planEdit, sessionToEdit, type Piece } from './plan.ts';
import type { PlacedSegment } from './timeline.ts';

const s = 1_000_000;
const segment = (index: number, startS: number, durationS: number): PlacedSegment => ({
	index,
	path: `seg-0${index}.mp4`,
	startUs: startS * s,
	durationUs: durationS * s
});
const cut = (startS: number, endS: number, accepted = true): Cut => ({ startUs: startS * s, endUs: endS * s, reason: 'manual', accepted });

/** Pieces as [session, editStart, sessionStart, duration, segment index or null, fileStart], in seconds. */
const brief = (pieces: Piece[]) =>
	pieces.map((p) => [p.session, p.editStartUs / s, p.sessionStartUs / s, p.durationUs / s, p.segment?.index ?? null, p.fileStartUs / s]);

describe('planEdit', () => {
	it('plays a Session with no Cuts as its one Segment', () => {
		expect(brief(planEdit([{ segments: [segment(1, 0, 30)], durationUs: 30 * s, cuts: [] }]))).toEqual([[0, 0, 0, 30, 1, 0]]);
	});

	it('skips accepted Cuts, starting the next piece further into the file', () => {
		const pieces = planEdit([{ segments: [segment(1, 0, 30)], durationUs: 30 * s, cuts: [cut(5, 10), cut(20, 22, false)] }]);
		expect(brief(pieces)).toEqual([
			[0, 0, 0, 5, 1, 0],
			[0, 5, 10, 20, 1, 10]
		]);
	});

	it('splits at Segment boundaries and keeps Capture gaps as pieces with no Segment', () => {
		const pieces = planEdit([{ segments: [segment(1, 0, 10), segment(2, 14, 6)], durationUs: 20 * s, cuts: [cut(8, 9)] }]);
		expect(brief(pieces)).toEqual([
			[0, 0, 0, 8, 1, 0],
			[0, 8, 9, 1, 1, 9],
			[0, 9, 10, 4, null, 0],
			[0, 13, 14, 6, 2, 0]
		]);
	});

	it('drops a Capture gap that a Cut removes, joining the Segments', () => {
		const pieces = planEdit([{ segments: [segment(1, 0, 10), segment(2, 14, 6)], durationUs: 20 * s, cuts: [cut(9, 15)] }]);
		expect(brief(pieces)).toEqual([
			[0, 0, 0, 9, 1, 0],
			[0, 9, 15, 5, 2, 1]
		]);
	});

	it('lays Sessions end to end, each with its own Cuts', () => {
		const pieces = planEdit([
			{ segments: [segment(1, 0, 10)], durationUs: 10 * s, cuts: [cut(0, 2)] },
			{ segments: [segment(1, 0, 5)], durationUs: 5 * s, cuts: [cut(4, 5)] }
		]);
		expect(brief(pieces)).toEqual([
			[0, 0, 2, 8, 1, 2],
			[1, 8, 0, 4, 1, 0]
		]);
		expect(planDurationUs(pieces)).toBe(12 * s);
	});

	it('has nothing to play when everything is cut', () => {
		expect(planEdit([{ segments: [segment(1, 0, 10)], durationUs: 10 * s, cuts: [cut(0, 10)] }])).toEqual([]);
		expect(planDurationUs([])).toBe(0);
	});
});

describe('finding places', () => {
	const pieces = planEdit([
		{ segments: [segment(1, 0, 10)], durationUs: 10 * s, cuts: [cut(4, 6)] },
		{ segments: [segment(1, 0, 5)], durationUs: 5 * s, cuts: [] }
	]);

	it('finds the piece at an edit time', () => {
		expect(pieceAt(pieces, 0)).toBe(0);
		expect(pieceAt(pieces, 4 * s)).toBe(1);
		expect(pieceAt(pieces, 8 * s)).toBe(2);
		expect(pieceAt(pieces, 13 * s - 1)).toBe(2);
		expect(pieceAt(pieces, 13 * s)).toBe(-1);
	});

	it('maps edit time to a place in a Session', () => {
		expect(editToSession(pieces, 3 * s)).toEqual({ session: 0, sessionUs: 3 * s });
		expect(editToSession(pieces, 4 * s)).toEqual({ session: 0, sessionUs: 6 * s });
		expect(editToSession(pieces, 9 * s)).toEqual({ session: 1, sessionUs: 1 * s });
		expect(editToSession(pieces, 13 * s)).toEqual({ session: 1, sessionUs: 5 * s });
	});

	it('maps a place in a Session to edit time, landing after a Cut', () => {
		expect(sessionToEdit(pieces, 0, 3 * s)).toBe(3 * s);
		expect(sessionToEdit(pieces, 0, 5 * s)).toBe(4 * s);
		expect(editToSession(pieces, sessionToEdit(pieces, 0, 5 * s))).toEqual({ session: 0, sessionUs: 6 * s });
		expect(sessionToEdit(pieces, 1, 2 * s)).toBe(10 * s);
		expect(sessionToEdit(pieces, 1, 5 * s)).toBe(13 * s);
	});

	it('maps the cut-off end of a Session to the start of the next', () => {
		const tailCut = planEdit([
			{ segments: [segment(1, 0, 10)], durationUs: 10 * s, cuts: [cut(8, 10)] },
			{ segments: [segment(1, 0, 5)], durationUs: 5 * s, cuts: [] }
		]);
		expect(sessionToEdit(tailCut, 0, 9 * s)).toBe(8 * s);
		expect(editToSession(tailCut, 8 * s)).toEqual({ session: 1, sessionUs: 0 });
	});
});
