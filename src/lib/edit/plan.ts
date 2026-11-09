// The edit as something to play: the Kept ranges of each Session in the
// Project, end to end, split wherever the source changes (a Segment file, a
// Capture gap, the next Session). Preview and export both walk this list.
// Pure; integer microseconds.

import type { Cut } from '../storage/project-file.ts';
import { keptRanges } from './cuts.ts';
import type { PlacedSegment } from './timeline.ts';

/** One Session as the plan needs it: its lead Track's Segments, its length and its Cuts. */
export interface PlanSession {
	segments: PlacedSegment[];
	durationUs: number;
	cuts: Cut[];
}

/** A stretch of the edit that plays from one place. */
export interface Piece {
	/** Which Session, by its place in the Project. */
	session: number;
	/** Where it starts in the edit, and in its Session. */
	editStartUs: number;
	sessionStartUs: number;
	durationUs: number;
	/** The Segment it plays from, or null in a Capture gap (black and silent). */
	segment: PlacedSegment | null;
	/** Where in the Segment's file it starts; 0 in a gap. */
	fileStartUs: number;
}

/** The pieces of the edit, in order. */
export function planEdit(sessions: PlanSession[]): Piece[] {
	const pieces: Piece[] = [];
	let editUs = 0;
	sessions.forEach((session, index) => {
		for (const kept of keptRanges(session.cuts, session.durationUs)) {
			let at = kept.startUs;
			while (at < kept.endUs) {
				// The Segment playing at `at`, or the gap up to the next one.
				const segment = session.segments.find((s) => at >= s.startUs && at < s.startUs + s.durationUs) ?? null;
				const next = session.segments.find((s) => s.startUs > at);
				const endUs = Math.min(kept.endUs, segment ? segment.startUs + segment.durationUs : (next?.startUs ?? kept.endUs));
				pieces.push({
					session: index,
					editStartUs: editUs,
					sessionStartUs: at,
					durationUs: endUs - at,
					segment,
					fileStartUs: segment ? at - segment.startUs : 0
				});
				editUs += endUs - at;
				at = endUs;
			}
		}
	});
	return pieces;
}

/** How long the edit plays. */
export function planDurationUs(pieces: Piece[]): number {
	const last = pieces.at(-1);
	return last ? last.editStartUs + last.durationUs : 0;
}

/** The index of the piece playing at `editUs`, or -1 at or past the end. */
export function pieceAt(pieces: Piece[], editUs: number): number {
	// Binary search: an hour with many Cuts has many pieces.
	let low = 0;
	let high = pieces.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const piece = pieces[middle]!;
		if (editUs < piece.editStartUs) high = middle - 1;
		else if (editUs >= piece.editStartUs + piece.durationUs) low = middle + 1;
		else return middle;
	}
	return -1;
}

/** Edit time as a place in a Session; the end of the edit is the end of the last piece. */
export function editToSession(pieces: Piece[], editUs: number): { session: number; sessionUs: number } {
	const index = pieceAt(pieces, editUs);
	if (index < 0) {
		const last = pieces.at(-1);
		return last ? { session: last.session, sessionUs: last.sessionStartUs + last.durationUs } : { session: 0, sessionUs: 0 };
	}
	const piece = pieces[index]!;
	return { session: piece.session, sessionUs: piece.sessionStartUs + editUs - piece.editStartUs };
}

/**
 * A place in a Session as edit time. Inside a Cut it's where the Cut was taken
 * out, so playing from there continues after the Cut; past every kept moment of
 * the Session, the start of the next Session's edit.
 */
export function sessionToEdit(pieces: Piece[], session: number, sessionUs: number): number {
	let editUs = 0;
	for (const piece of pieces) {
		if (piece.session < session) {
			editUs = piece.editStartUs + piece.durationUs;
			continue;
		}
		if (piece.session > session) return piece.editStartUs;
		if (sessionUs < piece.sessionStartUs) return piece.editStartUs;
		if (sessionUs < piece.sessionStartUs + piece.durationUs) return piece.editStartUs + sessionUs - piece.sessionStartUs;
		editUs = piece.editStartUs + piece.durationUs;
	}
	return editUs;
}
