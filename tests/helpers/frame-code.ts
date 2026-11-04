// Reads the frame counter the fixture draws along the bottom of every frame
// (see scripts/make-fixture.ts), from a frame of a recorded file. A mirrored
// recording reads as nonsense, since the bits land in the wrong boxes.

import { execFileSync } from 'node:child_process';
import { fixtureSpec as s } from '../fixtures/spec.ts';

const boxWidth = 60;
const boxHeight = 40;
const stripY = s.height - boxHeight - 20;

/**
 * The frame at `timeSeconds` as 8-bit grey pixels, row by row. Seeks after
 * decoding (slow but exact): seeking the input can land on the first frame.
 */
export function greyFrame(file: string, timeSeconds: number): Buffer {
	return execFileSync(
		'ffmpeg',
		['-v', 'error', '-i', file, '-ss', String(timeSeconds), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
}

/** The fixture frame number drawn in `frame` (s.width × s.height grey pixels). */
export function readFrameCode(frame: Buffer): number {
	let value = 0;
	for (let bit = 0; bit < s.frameCodeBits; bit++) {
		// Most significant bit on the left; sample the middle of each box.
		const x = 20 + (s.frameCodeBits - 1 - bit) * boxWidth + (boxWidth - 4) / 2;
		const y = stripY + boxHeight / 2;
		if (frame[y * s.width + x]! > 128) value |= 1 << bit;
	}
	return value;
}
