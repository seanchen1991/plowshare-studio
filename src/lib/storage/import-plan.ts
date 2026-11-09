// Opening a recording from a file on disk: what to call it, whether it fits,
// and whether it can be kept as it is or must be remuxed. Pure; the copying
// itself is in import.ts.

import { safetyMarginBytes, type StorageMeasure } from './time-left.ts';

/** A take's title from its file name: without the extension, or a plain name if nothing's left. */
export function titleFromFileName(name: string): string {
	const title = name.replace(/\.[^.]*$/, '').trim();
	return title || 'Opened file';
}

/** Room for a file of `bytes`, after what's stored, raw files' finished copies still owed, and the margin. */
export function roomForFileBytes({ quota, usage, rawBytes }: StorageMeasure): number {
	return Math.max(0, quota - usage - rawBytes - safetyMarginBytes);
}

export type ImportPlan =
	/** Copied byte for byte. */
	| { kind: 'copy'; extension: 'mp4' | 'webm' }
	/** Rewritten into a container the editor and browsers play; the audio re-encoded to Opus if it must be. */
	| { kind: 'remux'; container: 'mp4' | 'webm'; audioToOpus: boolean }
	| { kind: 'unsupported'; reason: 'no-audio' | 'video-codec' };

/** Video codecs each finished container holds; H.264 and HEVC go in MP4, the rest in WebM. */
const mp4Video = ['avc', 'hevc'];
const webmVideo = ['vp8', 'vp9', 'av1'];
/** Audio codecs each container holds that Chrome and Firefox both play. */
const mp4Audio = ['aac', 'opus', 'mp3'];
const webmAudio = ['opus', 'vorbis'];

/**
 * How to bring in a file: MP4 and WebM are kept as they are; anything else is
 * remuxed into MP4 (for H.264 and HEVC video) or WebM (VP8, VP9, AV1 or no video).
 * A file needs sound to be a take.
 */
export function planImport(container: 'mp4' | 'webm' | 'other', video: string | null, audio: string | null): ImportPlan {
	if (!audio) return { kind: 'unsupported', reason: 'no-audio' };
	if (video && !mp4Video.includes(video) && !webmVideo.includes(video)) return { kind: 'unsupported', reason: 'video-codec' };
	if (container !== 'other') return { kind: 'copy', extension: container };
	const target = video && mp4Video.includes(video) ? 'mp4' : 'webm';
	return { kind: 'remux', container: target, audioToOpus: !(target === 'mp4' ? mp4Audio : webmAudio).includes(audio) };
}
