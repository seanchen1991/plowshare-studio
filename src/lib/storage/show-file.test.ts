import { describe, expect, it } from 'vitest';
import { showNameProblem, showOf, sortShows, type Show } from './show-file.ts';

const show = (id: string, name: string): Show => ({ id, name, createdAt: '2026-11-06T12:00:00.000Z' });
const shows = [show('show_1', 'Tilling Our Commons'), show('show_2', 'apple pie')];

describe('showNameProblem', () => {
	it('accepts a new name', () => {
		expect(showNameProblem('  Field Notes ', shows)).toBeNull();
	});

	it('refuses an empty or very long name', () => {
		expect(showNameProblem('   ', shows)).toBe('Give the show a name.');
		expect(showNameProblem('x'.repeat(101), shows)).toMatch(/under 100 characters/);
	});

	it('refuses a name already taken, ignoring case, except by the Show being renamed', () => {
		expect(showNameProblem('tilling our commons', shows)).toBe('There\'s already a show called “Tilling Our Commons”.');
		expect(showNameProblem('TILLING OUR COMMONS', shows, 'show_1')).toBeNull();
	});
});

describe('sortShows and showOf', () => {
	it('sorts by name, ignoring case', () => {
		expect(sortShows(shows).map((s) => s.name)).toEqual(['apple pie', 'Tilling Our Commons']);
	});

	it('finds a take’s Show, or none when it was deleted or never set', () => {
		expect(showOf('show_2', shows)?.name).toBe('apple pie');
		expect(showOf('show_gone', shows)).toBeNull();
		expect(showOf(null, shows)).toBeNull();
		expect(showOf(undefined, shows)).toBeNull();
	});
});
