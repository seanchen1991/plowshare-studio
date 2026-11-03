// Container/codec combinations to probe in each browser's MediaRecorder.

export interface Candidate {
	mimeType: string;
	/** Video codec string for MediaCapabilities.encodingInfo, or null for audio-only. */
	videoCodec: string | null;
	audioCodec: string;
}

export const candidates: Candidate[] = [
	{ mimeType: 'video/webm;codecs=vp8,opus', videoCodec: 'video/webm;codecs=vp8', audioCodec: 'audio/webm;codecs=opus' },
	{ mimeType: 'video/webm;codecs=vp9,opus', videoCodec: 'video/webm;codecs=vp9', audioCodec: 'audio/webm;codecs=opus' },
	{ mimeType: 'video/webm;codecs=av01,opus', videoCodec: 'video/webm;codecs=av01.0.08M.08', audioCodec: 'audio/webm;codecs=opus' },
	{ mimeType: 'video/webm;codecs=h264,opus', videoCodec: 'video/webm;codecs=avc1.42E028', audioCodec: 'audio/webm;codecs=opus' },
	{ mimeType: 'video/webm;codecs=avc1,opus', videoCodec: 'video/webm;codecs=avc1.42E028', audioCodec: 'audio/webm;codecs=opus' },
	{ mimeType: 'video/x-matroska;codecs=avc1,opus', videoCodec: 'video/x-matroska;codecs=avc1.42E028', audioCodec: 'audio/webm;codecs=opus' },
	{ mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', videoCodec: 'video/mp4;codecs=avc1.42E028', audioCodec: 'audio/mp4;codecs=mp4a.40.2' },
	{ mimeType: 'video/mp4;codecs=avc1,opus', videoCodec: 'video/mp4;codecs=avc1.42E028', audioCodec: 'audio/mp4;codecs=opus' },
	{ mimeType: 'video/mp4;codecs=vp9,opus', videoCodec: 'video/mp4;codecs=vp09.00.40.08', audioCodec: 'audio/mp4;codecs=opus' },
	{ mimeType: 'audio/webm;codecs=opus', videoCodec: null, audioCodec: 'audio/webm;codecs=opus' },
	{ mimeType: 'audio/ogg;codecs=opus', videoCodec: null, audioCodec: 'audio/ogg;codecs=opus' },
	{ mimeType: 'audio/mp4;codecs=opus', videoCodec: null, audioCodec: 'audio/mp4;codecs=opus' },
	{ mimeType: 'audio/mp4;codecs=mp4a.40.2', videoCodec: null, audioCodec: 'audio/mp4;codecs=mp4a.40.2' }
];

export function slug(mimeType: string): string {
	return mimeType.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '');
}

export const recordSeconds = 10;
export const timesliceMs = 1000;
export const videoBitsPerSecond = 6_000_000;
export const audioBitsPerSecond = 160_000;
