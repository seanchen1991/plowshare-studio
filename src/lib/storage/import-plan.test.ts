import { describe, expect, it } from 'vitest';
import { planImport, roomForFileBytes, titleFromFileName } from './import-plan.ts';
import { safetyMarginBytes } from './time-left.ts';

describe('titleFromFileName', () => {
	it('drops the extension', () => {
		expect(titleFromFileName('Episode 3 – take 2.mp4')).toBe('Episode 3 – take 2');
		expect(titleFromFileName('interview.final.webm')).toBe('interview.final');
		expect(titleFromFileName('notes')).toBe('notes');
	});

	it('has a plain name when nothing is left', () => {
		expect(titleFromFileName('.mp4')).toBe('Opened file');
		expect(titleFromFileName('  .wav')).toBe('Opened file');
	});
});

describe('roomForFileBytes', () => {
	it('is what is free after raw files owed a copy and the margin', () => {
		expect(roomForFileBytes({ quota: 10e9, usage: 2e9, rawBytes: 1e9 })).toBe(7e9 - safetyMarginBytes);
		expect(roomForFileBytes({ quota: 1e9, usage: 9e8, rawBytes: 0 })).toBe(0);
	});
});

describe('planImport', () => {
	it('keeps MP4 and WebM files as they are', () => {
		expect(planImport('mp4', 'avc', 'aac')).toEqual({ kind: 'copy', extension: 'mp4' });
		expect(planImport('webm', 'vp9', 'opus')).toEqual({ kind: 'copy', extension: 'webm' });
		expect(planImport('webm', null, 'opus')).toEqual({ kind: 'copy', extension: 'webm' });
	});

	it('remuxes H.264 and HEVC from other containers into MP4, keeping audio MP4 holds', () => {
		expect(planImport('other', 'avc', 'aac')).toEqual({ kind: 'remux', container: 'mp4', audioToOpus: false });
		expect(planImport('other', 'hevc', 'mp3')).toEqual({ kind: 'remux', container: 'mp4', audioToOpus: false });
		expect(planImport('other', 'avc', 'pcm-s16')).toEqual({ kind: 'remux', container: 'mp4', audioToOpus: true });
	});

	it('remuxes VP8, VP9, AV1 and audio-only files into WebM, re-encoding audio WebM players lack', () => {
		expect(planImport('other', 'vp8', 'vorbis')).toEqual({ kind: 'remux', container: 'webm', audioToOpus: false });
		expect(planImport('other', null, 'pcm-s16')).toEqual({ kind: 'remux', container: 'webm', audioToOpus: true });
		expect(planImport('other', null, 'aac')).toEqual({ kind: 'remux', container: 'webm', audioToOpus: true });
	});

	it('refuses a file with no sound, or video in a codec it can\'t keep', () => {
		expect(planImport('mp4', 'avc', null)).toEqual({ kind: 'unsupported', reason: 'no-audio' });
		expect(planImport('other', 'mpeg4', 'aac')).toEqual({ kind: 'unsupported', reason: 'video-codec' });
	});
});
