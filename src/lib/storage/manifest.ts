// A raw Segment's manifest: an append-only JSON Lines file kept next to the
// raw file during Capturing and Finalizing. A chunk is appended only after its
// bytes have been flushed to the raw file, so every listed chunk is on disk.
// A crash can only leave a partial last line, which parsing ignores.

import type { RecordingState } from './session-file.ts';

export interface ManifestHeader {
	kind: 'header';
	version: 1;
	sessionId: string;
	recordingId: string;
	segmentIndex: number;
	mimeType: string;
	startedAt: string;
}

export interface ManifestChunk {
	kind: 'chunk';
	/** Byte offset of the chunk in the raw file. */
	offset: number;
	bytes: number;
	/** Time since capture started when the chunk arrived. */
	timestampUs: number;
}

export interface ManifestStateChange {
	kind: 'state';
	state: RecordingState;
}

export type ManifestEntry = ManifestHeader | ManifestChunk | ManifestStateChange;

export interface Manifest {
	header: ManifestHeader;
	chunks: ManifestChunk[];
	state: RecordingState;
	/** Bytes of the raw file covered by listed chunks. */
	endOffset: number;
	/** Arrival time of the last listed chunk, roughly the captured length. */
	lastTimestampUs: number;
}

export function manifestLine(entry: ManifestEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

export function parseManifest(text: string): Manifest {
	// Only newline-terminated lines are complete.
	const lines = text.split('\n').slice(0, -1);
	let header: ManifestHeader | null = null;
	const chunks: ManifestChunk[] = [];
	let state: RecordingState = 'capturing';

	for (const line of lines) {
		let entry: ManifestEntry;
		try {
			entry = JSON.parse(line) as ManifestEntry;
		} catch {
			break;
		}
		if (entry.kind === 'header') header = entry;
		else if (entry.kind === 'state') state = entry.state;
		else if (entry.kind === 'chunk') {
			const expected = chunks.length === 0 ? 0 : chunks.at(-1)!.offset + chunks.at(-1)!.bytes;
			if (entry.offset !== expected) throw new Error(`Manifest chunk at ${entry.offset}, expected ${expected}`);
			chunks.push(entry);
		}
	}

	if (!header) throw new Error('Manifest has no header');
	const last = chunks.at(-1);
	return {
		header,
		chunks,
		state,
		endOffset: last ? last.offset + last.bytes : 0,
		lastTimestampUs: last ? last.timestampUs : 0
	};
}

/**
 * Whether a finished file's duration is close enough to what the manifest
 * says was captured. Chunks are timestamped on arrival, so allow some slack.
 */
export function durationMatches(finishedUs: number, manifestUs: number): boolean {
	const toleranceUs = Math.max(1_500_000, manifestUs * 0.01);
	return Math.abs(finishedUs - manifestUs) <= toleranceUs;
}
