import { describe, expect, it } from 'vitest';
import { durationMatches, manifestLine, parseManifest, type ManifestEntry } from './manifest.ts';

const header: ManifestEntry = {
	kind: 'header',
	version: 1,
	sessionId: 'ses_1',
	recordingId: 'rec_01',
	segmentIndex: 1,
	mimeType: 'video/webm;codecs=vp8,opus',
	startedAt: '2026-11-03T12:00:00.000Z'
};

const lines = (...entries: ManifestEntry[]) => entries.map(manifestLine).join('');

describe('parseManifest', () => {
	it('reads the header, chunks and state', () => {
		const manifest = parseManifest(
			lines(
				header,
				{ kind: 'chunk', offset: 0, bytes: 100, timestampUs: 2_000_000 },
				{ kind: 'chunk', offset: 100, bytes: 50, timestampUs: 4_000_000 },
				{ kind: 'state', state: 'finalizing' }
			)
		);
		expect(manifest.header).toEqual(header);
		expect(manifest.chunks).toHaveLength(2);
		expect(manifest.state).toBe('finalizing');
		expect(manifest.endOffset).toBe(150);
		expect(manifest.lastTimestampUs).toBe(4_000_000);
	});

	it('is still Capturing when no state line was written', () => {
		expect(parseManifest(lines(header)).state).toBe('capturing');
	});

	it('has no chunks and ends at zero before the first chunk', () => {
		const manifest = parseManifest(lines(header));
		expect(manifest.endOffset).toBe(0);
		expect(manifest.lastTimestampUs).toBe(0);
	});

	it('ignores a last line cut off by a crash', () => {
		const text = lines(header, { kind: 'chunk', offset: 0, bytes: 100, timestampUs: 2_000_000 }) + '{"kind":"chunk","off';
		const manifest = parseManifest(text);
		expect(manifest.chunks).toHaveLength(1);
		expect(manifest.endOffset).toBe(100);
	});

	it('ignores a complete-looking last line with no newline', () => {
		const text = lines(header) + JSON.stringify({ kind: 'chunk', offset: 0, bytes: 100, timestampUs: 1 });
		expect(parseManifest(text).chunks).toHaveLength(0);
	});

	it('rejects chunks that are not contiguous', () => {
		const text = lines(
			header,
			{ kind: 'chunk', offset: 0, bytes: 100, timestampUs: 1 },
			{ kind: 'chunk', offset: 120, bytes: 10, timestampUs: 2 }
		);
		expect(() => parseManifest(text)).toThrow(/expected 100/);
	});

	it('rejects a manifest with no header', () => {
		expect(() => parseManifest('')).toThrow(/no header/);
	});
});

describe('durationMatches', () => {
	it('allows 1.5 s of slack on short takes', () => {
		expect(durationMatches(29_000_000, 30_000_000)).toBe(true);
		expect(durationMatches(28_000_000, 30_000_000)).toBe(false);
	});

	it('allows 1% on long takes', () => {
		const hour = 3_600_000_000;
		expect(durationMatches(hour - 30_000_000, hour)).toBe(true);
		expect(durationMatches(hour - 40_000_000, hour)).toBe(false);
	});
});
