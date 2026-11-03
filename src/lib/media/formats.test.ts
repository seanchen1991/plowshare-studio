import { describe, expect, it } from 'vitest';
import { chooseMimeType, codecsFromMimeType, finishedContainer } from './formats.ts';

describe('chooseMimeType', () => {
	it('prefers H.264, then VP9, then VP8', () => {
		expect(chooseMimeType(() => true)).toBe('video/webm;codecs=h264,opus');
		expect(chooseMimeType((t) => !t.includes('h264'))).toBe('video/webm;codecs=vp9,opus');
		expect(chooseMimeType((t) => t.includes('vp8'))).toBe('video/webm;codecs=vp8,opus');
	});

	it("lets the browser choose when it supports none of them", () => {
		expect(chooseMimeType(() => false)).toBe('');
	});
});

describe('codecsFromMimeType', () => {
	it("reads Chromium's Matroska H.264", () => {
		expect(codecsFromMimeType('video/x-matroska;codecs=avc1,opus')).toEqual({ video: 'avc', audio: 'opus' });
	});

	it('reads WebM VP8, VP9 and AV1', () => {
		expect(codecsFromMimeType('video/webm;codecs=vp8,opus').video).toBe('vp8');
		expect(codecsFromMimeType('video/webm; codecs="vp09.00.10.08, opus"').video).toBe('vp9');
		expect(codecsFromMimeType('video/webm;codecs=av01,opus').video).toBe('av1');
	});

	it('reads audio-only Opus', () => {
		expect(codecsFromMimeType('audio/webm;codecs=opus')).toEqual({ video: null, audio: 'opus' });
	});

	it('knows nothing when no codecs are named', () => {
		expect(codecsFromMimeType('video/webm')).toEqual({ video: null, audio: null });
	});
});

describe('finishedContainer', () => {
	it('finishes H.264 as MP4 and everything else as WebM (ADR 0003)', () => {
		expect(finishedContainer('avc')).toBe('mp4');
		expect(finishedContainer('vp8')).toBe('webm');
		expect(finishedContainer('vp9')).toBe('webm');
		expect(finishedContainer(null)).toBe('webm');
	});
});
