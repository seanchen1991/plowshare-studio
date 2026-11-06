import { describe, expect, it } from 'vitest';
import { formatTimeLeft, minimumSecondsToStart, recordingTimeLeftSeconds, safetyMarginBytes, warningDue } from './time-left.ts';

const GB = 1e9;
// 1080p: 6 Mbps video and 160 kbps audio, 770 kB a second.
const bitsPerSecond = 6_160_000;

describe('recordingTimeLeftSeconds', () => {
	it('halves the free space after the margin, for the finished copy', () => {
		const seconds = recordingTimeLeftSeconds({ quota: 10 * GB, usage: 0, rawBytes: 0 }, bitsPerSecond);
		expect(seconds).toBeCloseTo((10 * GB - safetyMarginBytes) / 2 / 770_000, 6);
		// About 1 h 43 m: an hour of 1080p takes about 2.8 GB, twice over.
		expect(seconds / 3600).toBeCloseTo(1.71, 2);
	});

	it('counts raw files still waiting to be finished as space already spoken for', () => {
		const free = recordingTimeLeftSeconds({ quota: 10 * GB, usage: 3 * GB, rawBytes: 0 }, bitsPerSecond);
		const owed = recordingTimeLeftSeconds({ quota: 10 * GB, usage: 3 * GB, rawBytes: 3 * GB }, bitsPerSecond);
		expect(free - owed).toBeCloseTo(3 * GB / 2 / 770_000, 6);
	});

	it('runs out exactly when the raw file and its copy would no longer fit with the margin', () => {
		// 1 GB recorded so far (in usage and owed a copy); 1 GB plus the margin free.
		const measure = { quota: 2 * GB + safetyMarginBytes, usage: 1 * GB, rawBytes: 1 * GB };
		expect(recordingTimeLeftSeconds(measure, bitsPerSecond)).toBe(0);
		expect(recordingTimeLeftSeconds({ ...measure, quota: measure.quota - GB }, bitsPerSecond)).toBe(0);
	});

	it('is longer at a lower bitrate', () => {
		const measure = { quota: 10 * GB, usage: 0, rawBytes: 0 };
		expect(recordingTimeLeftSeconds(measure, 3_660_000)).toBeGreaterThan(recordingTimeLeftSeconds(measure, bitsPerSecond));
	});

	it('refuses a tiny quota', () => {
		expect(recordingTimeLeftSeconds({ quota: 0.12 * GB, usage: 0, rawBytes: 0 }, bitsPerSecond)).toBeLessThan(minimumSecondsToStart);
	});
});

describe('warningDue', () => {
	it('warns at 15 minutes, then at 5', () => {
		expect(warningDue(20 * 60)).toBeNull();
		expect(warningDue(15 * 60)).toBe(15 * 60);
		expect(warningDue(6 * 60)).toBe(15 * 60);
		expect(warningDue(5 * 60)).toBe(5 * 60);
		expect(warningDue(0)).toBe(5 * 60);
	});
});

describe('formatTimeLeft', () => {
	it('shows hours and minutes, rounded down', () => {
		expect(formatTimeLeft(4 * 3600 + 10 * 60 + 59)).toBe('about 4 h 10 m');
		expect(formatTimeLeft(2 * 3600 + 30)).toBe('about 2 h');
		expect(formatTimeLeft(35 * 60 + 59)).toBe('about 35 m');
		expect(formatTimeLeft(59)).toBe('less than a minute');
	});
});
