import { describe, expect, it } from 'vitest';
import { downloadName, extensionOf, localDate, safeTitle } from './download-name.ts';

// Built from local time, so the expected date holds in any time zone.
const createdAt = new Date(2026, 10, 2, 18, 30).toISOString();

describe('downloadName', () => {
	it('names a single Segment by date and title', () => {
		expect(downloadName({ title: 'Episode 1', createdAt, extension: 'webm', part: 1, count: 1 })).toBe('2026-11-02 Episode 1.webm');
	});

	it('numbers the parts of a Recording with several Segments', () => {
		const name = (part: number) => downloadName({ title: 'Episode 1', createdAt, extension: 'mp4', part, count: 2 });
		expect(name(1)).toBe('2026-11-02 Episode 1 – part 1 of 2.mp4');
		expect(name(2)).toBe('2026-11-02 Episode 1 – part 2 of 2.mp4');
	});

	it('uses the date in the user’s time zone, not UTC', () => {
		const lateEvening = new Date(2026, 10, 2, 23, 50).toISOString();
		expect(downloadName({ title: 'Late', createdAt: lateEvening, extension: 'mp4', part: 1, count: 1 })).toBe('2026-11-02 Late.mp4');
	});
});

describe('safeTitle', () => {
	it('replaces characters file systems refuse', () => {
		expect(safeTitle('Q&A: what / why?')).toBe('Q&A what why');
		expect(safeTitle('a\\b*c"d<e>f|g')).toBe('a b c d e f g');
		expect(safeTitle('tab\there\nnewline')).toBe('tab here newline');
	});

	it('trims leading and trailing dots and spaces', () => {
		expect(safeTitle('  .hidden. ')).toBe('hidden');
		expect(safeTitle('Episode 1...')).toBe('Episode 1');
	});

	it('keeps dashes, accents and emoji', () => {
		expect(safeTitle('Café – take 2 🎙️')).toBe('Café – take 2 🎙️');
	});

	it('falls back to "Take" when nothing is left', () => {
		expect(safeTitle('???')).toBe('Take');
		expect(safeTitle('')).toBe('Take');
	});

	it('shortens very long titles', () => {
		expect(safeTitle('x'.repeat(300))).toHaveLength(120);
	});
});

describe('localDate and extensionOf', () => {
	it('pads months and days', () => {
		expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
	});

	it('reads the extension from a stored path', () => {
		expect(extensionOf('sessions/ses_1/rec_01/seg-01.mp4')).toBe('mp4');
		expect(extensionOf('sessions/ses_1/rec_01/seg-01')).toBe('');
	});
});
