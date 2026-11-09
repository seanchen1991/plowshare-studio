import { describe, expect, it } from 'vitest';
import type { Cut } from '../storage/project-file.ts';
import {
	addCut,
	canRedo,
	canUndo,
	clampCut,
	cutAt,
	editDurationUs,
	keptRanges,
	newHistory,
	record,
	redo,
	restoreCut,
	toEditTime,
	toSessionTime,
	undo
} from './cuts.ts';

const s = 1_000_000;
const manual = (startS: number, endS: number): Cut => ({ startUs: startS * s, endUs: endS * s, reason: 'manual', accepted: true });
const suggested = (startS: number, endS: number): Cut => ({ startUs: startS * s, endUs: endS * s, reason: 'gap', accepted: false });

describe('clampCut', () => {
	it("keeps a Cut inside its Session's timeline", () => {
		expect(clampCut(manual(-2, 3), 60 * s)).toEqual(manual(0, 3));
		expect(clampCut(manual(58, 70), 60 * s)).toEqual(manual(58, 60));
	});

	it('orders the ends of a Cut dragged right to left', () => {
		expect(clampCut({ ...manual(0, 0), startUs: 9 * s, endUs: 4 * s }, 60 * s)).toEqual(manual(4, 9));
	});

	it('drops a Cut with nothing left in it', () => {
		expect(clampCut(manual(70, 80), 60 * s)).toBeNull();
		expect(clampCut(manual(5, 5), 60 * s)).toBeNull();
	});

	it('rounds to whole microseconds', () => {
		expect(clampCut({ ...manual(0, 0), startUs: 1.4, endUs: 2000.6 }, 60 * s)).toMatchObject({ startUs: 1, endUs: 2001 });
	});
});

describe('addCut', () => {
	it('adds a Cut, keeping the list in order', () => {
		expect(addCut([manual(20, 30)], manual(5, 10), 60 * s)).toEqual([manual(5, 10), manual(20, 30)]);
	});

	it('merges Cuts that overlap or touch', () => {
		expect(addCut([manual(5, 10), manual(20, 30)], manual(8, 22), 60 * s)).toEqual([manual(5, 30)]);
		expect(addCut([manual(5, 10)], manual(10, 12), 60 * s)).toEqual([manual(5, 12)]);
		expect(addCut([manual(5, 10)], manual(6, 7), 60 * s)).toEqual([manual(5, 10)]);
	});

	it('clamps the new Cut to the Session, and ignores an empty one', () => {
		expect(addCut([], manual(55, 90), 60 * s)).toEqual([manual(55, 60)]);
		expect(addCut([manual(1, 2)], manual(3, 3), 60 * s)).toEqual([manual(1, 2)]);
	});

	it('leaves Suggested cuts alone', () => {
		expect(addCut([suggested(5, 10)], manual(8, 12), 60 * s)).toEqual([suggested(5, 10), manual(8, 12)]);
	});

	it("doesn't change the list it was given", () => {
		const cuts = [manual(5, 10)];
		addCut(cuts, manual(8, 12), 60 * s);
		expect(cuts).toEqual([manual(5, 10)]);
	});
});

describe('cutAt and restoreCut', () => {
	const cuts = [manual(5, 10), suggested(20, 25), manual(30, 40)];

	it('finds the accepted Cut at a time, from its start up to its end', () => {
		expect(cutAt(cuts, 5 * s)).toEqual(manual(5, 10));
		expect(cutAt(cuts, 39 * s)).toEqual(manual(30, 40));
		expect(cutAt(cuts, 10 * s)).toBeNull();
		expect(cutAt(cuts, 22 * s)).toBeNull();
	});

	it('restores a Cut by removing it', () => {
		expect(restoreCut(cuts, manual(5, 10))).toEqual([suggested(20, 25), manual(30, 40)]);
		expect(restoreCut(cuts, manual(6, 9))).toEqual(cuts);
	});
});

describe('keptRanges', () => {
	it('is what lies between the accepted Cuts', () => {
		expect(keptRanges([manual(0, 5), suggested(12, 14), manual(20, 30)], 60 * s)).toEqual([
			{ startUs: 5 * s, endUs: 20 * s },
			{ startUs: 30 * s, endUs: 60 * s }
		]);
	});

	it('is the whole Session with no Cuts, and nothing when all of it is cut', () => {
		expect(keptRanges([], 60 * s)).toEqual([{ startUs: 0, endUs: 60 * s }]);
		expect(keptRanges([manual(0, 60)], 60 * s)).toEqual([]);
	});
});

describe('edit time', () => {
	const cuts = [manual(10, 20), suggested(25, 28), manual(40, 45)];

	it('is Session time with the accepted Cuts before it taken out', () => {
		expect(toEditTime(cuts, 5 * s)).toBe(5 * s);
		expect(toEditTime(cuts, 30 * s)).toBe(20 * s);
		expect(toEditTime(cuts, 50 * s)).toBe(35 * s);
	});

	it('puts a time inside a Cut where the Cut was taken out', () => {
		expect(toEditTime(cuts, 15 * s)).toBe(10 * s);
		expect(toEditTime(cuts, 42 * s)).toBe(30 * s);
	});

	it('maps back to Session time, after any Cut at that point', () => {
		expect(toSessionTime(cuts, 5 * s)).toBe(5 * s);
		expect(toSessionTime(cuts, 10 * s)).toBe(20 * s);
		expect(toSessionTime(cuts, 20 * s)).toBe(30 * s);
		expect(toSessionTime(cuts, 35 * s)).toBe(50 * s);
	});

	it('round-trips every kept moment', () => {
		for (let us = 0; us <= 60 * s; us += 250_000) {
			if (cutAt(cuts, us)) continue;
			expect(toSessionTime(cuts, toEditTime(cuts, us))).toBe(us);
		}
	});

	it('gives the length of the edit', () => {
		expect(editDurationUs(cuts, 60 * s)).toBe(45 * s);
		expect(editDurationUs([], 60 * s)).toBe(60 * s);
	});
});

describe('history', () => {
	it('undoes and redoes changes in order', () => {
		let history = newHistory<number[]>([]);
		expect(canUndo(history)).toBe(false);
		history = record(history, [1]);
		history = record(history, [1, 2]);
		history = undo(history);
		expect(history.present).toEqual([1]);
		expect(canRedo(history)).toBe(true);
		history = redo(history);
		expect(history.present).toEqual([1, 2]);
		history = undo(undo(history));
		expect(history.present).toEqual([]);
		expect(canUndo(history)).toBe(false);
		expect(undo(history)).toBe(history);
	});

	it('drops what could be redone once a new change is made', () => {
		let history = record(record(newHistory<number[]>([]), [1]), [1, 2]);
		history = record(undo(history), [1, 3]);
		expect(canRedo(history)).toBe(false);
		expect(redo(history)).toBe(history);
		expect(undo(history).present).toEqual([1]);
	});

	it('keeps the last 200 changes', () => {
		let history = newHistory(0);
		for (let i = 1; i <= 250; i++) history = record(history, i);
		while (canUndo(history)) history = undo(history);
		expect(history.present).toBe(50);
	});
});
