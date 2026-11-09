// The cut list of one Session's timeline, and the undo history the editor
// keeps of it. Pure, with no browser APIs; integer microseconds throughout.
// Only accepted Cuts remove time; Suggested cuts sit in the list unaccepted.

import type { Cut } from '../storage/project-file.ts';

/** A stretch of a Session's timeline, from `startUs` up to `endUs`. */
export interface Range {
	startUs: number;
	endUs: number;
}

const byStart = (a: Range, b: Range) => a.startUs - b.startUs;

/** The accepted Cuts, in timeline order. */
function accepted(cuts: Cut[]): Cut[] {
	return cuts.filter((c) => c.accepted).sort(byStart);
}

/** A Cut kept inside its Session's timeline, ends in order; null if nothing is left of it. */
export function clampCut(cut: Cut, durationUs: number): Cut | null {
	const startUs = Math.round(Math.max(0, Math.min(cut.startUs, cut.endUs)));
	const endUs = Math.round(Math.min(durationUs, Math.max(cut.startUs, cut.endUs)));
	return endUs > startUs ? { ...cut, startUs, endUs } : null;
}

/**
 * Adds a Cut, clamped to the Session. An accepted Cut merges with the accepted
 * Cuts it overlaps or touches, taking on its own reason. Returns a new list in order.
 */
export function addCut(cuts: Cut[], cut: Cut, durationUs: number): Cut[] {
	const added = clampCut(cut, durationUs);
	if (!added) return cuts;
	if (!added.accepted) return [...cuts, added].sort(byStart);
	let merged = added;
	const others: Cut[] = [];
	for (const other of cuts) {
		if (other.accepted && other.startUs <= merged.endUs && other.endUs >= merged.startUs) {
			merged = { ...merged, startUs: Math.min(merged.startUs, other.startUs), endUs: Math.max(merged.endUs, other.endUs) };
		} else {
			others.push(other);
		}
	}
	return [...others, merged].sort(byStart);
}

/** The accepted Cut at `timeUs`, from its start up to its end; null if none. */
export function cutAt(cuts: Cut[], timeUs: number): Cut | null {
	return cuts.find((c) => c.accepted && timeUs >= c.startUs && timeUs < c.endUs) ?? null;
}

/** Restores a Cut: the list without it. */
export function restoreCut(cuts: Cut[], cut: Cut): Cut[] {
	return cuts.filter((c) => !(c.startUs === cut.startUs && c.endUs === cut.endUs && c.accepted === cut.accepted));
}

/** The Kept ranges: what lies between the accepted Cuts, in order. */
export function keptRanges(cuts: Cut[], durationUs: number): Range[] {
	const kept: Range[] = [];
	let from = 0;
	for (const cut of accepted(cuts)) {
		if (cut.startUs > from) kept.push({ startUs: from, endUs: cut.startUs });
		from = Math.max(from, cut.endUs);
	}
	if (durationUs > from) kept.push({ startUs: from, endUs: durationUs });
	return kept;
}

/** How long the Session plays with its Cuts taken out. */
export function editDurationUs(cuts: Cut[], durationUs: number): number {
	return keptRanges(cuts, durationUs).reduce((sum, r) => sum + r.endUs - r.startUs, 0);
}

/** Session time as edit time: the accepted Cuts before it taken out. A time inside a Cut is where that Cut was. */
export function toEditTime(cuts: Cut[], sessionUs: number): number {
	let removed = 0;
	for (const cut of accepted(cuts)) {
		if (cut.startUs >= sessionUs) break;
		removed += Math.min(cut.endUs, sessionUs) - cut.startUs;
	}
	return sessionUs - removed;
}

/** Edit time as Session time; where a Cut was taken out, the moment after it. */
export function toSessionTime(cuts: Cut[], editUs: number): number {
	let sessionUs = editUs;
	for (const cut of accepted(cuts)) {
		if (cut.startUs > sessionUs) break;
		sessionUs += cut.endUs - cut.startUs;
	}
	return sessionUs;
}

/** An undo history: the states before the present one, and those undone after it. */
export interface History<T> {
	past: T[];
	present: T;
	future: T[];
}

/** How many changes can be undone. */
const historyLimit = 200;

export function newHistory<T>(present: T): History<T> {
	return { past: [], present, future: [] };
}

/** A new change: it can be undone, and what was undone can no longer be redone. */
export function record<T>(history: History<T>, present: T): History<T> {
	return { past: [...history.past, history.present].slice(-historyLimit), present, future: [] };
}

export const canUndo = <T>(history: History<T>) => history.past.length > 0;
export const canRedo = <T>(history: History<T>) => history.future.length > 0;

export function undo<T>(history: History<T>): History<T> {
	if (!canUndo(history)) return history;
	return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
	if (!canRedo(history)) return history;
	return { past: [...history.past, history.present], present: history.future[0]!, future: history.future.slice(1) };
}
