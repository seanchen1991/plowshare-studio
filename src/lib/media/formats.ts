// Which format to record in and which to finish in (ADR 0003). Pure.

/** Recording formats in order of preference (Handoff brief: H.264, then VP9, then VP8). */
export const recordingMimeTypes = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];

/** The format for an audio-only take (camera off). */
export const audioOnlyMimeTypes = ['audio/webm;codecs=opus'];

/** The first preferred format the browser can record, or '' to let it choose. */
export function chooseMimeType(isTypeSupported: (mimeType: string) => boolean, withVideo = true): string {
	return (withVideo ? recordingMimeTypes : audioOnlyMimeTypes).find(isTypeSupported) ?? '';
}

const videoCodecs: [RegExp, string][] = [
	[/avc1|h264/i, 'avc'],
	[/vp0?9/i, 'vp9'],
	[/vp0?8/i, 'vp8'],
	[/av01|av1/i, 'av1']
];

/**
 * Codecs named in a MediaRecorder MIME type, using Mediabunny's codec names.
 * Chromium reports H.264 as `video/x-matroska;codecs=avc1,opus`.
 */
export function codecsFromMimeType(mimeType: string): { video: string | null; audio: string | null } {
	const codecs = /codecs="?([^";]*)/i.exec(mimeType)?.[1] ?? '';
	const video = videoCodecs.find(([pattern]) => pattern.test(codecs))?.[1] ?? null;
	const audio = /opus/i.test(codecs) ? 'opus' : /mp4a|aac/i.test(codecs) ? 'aac' : null;
	return { video, audio };
}

/** H.264 is finished as MP4; everything else (VP8, VP9, audio-only Opus) as WebM. */
export function finishedContainer(videoCodec: string | null): 'mp4' | 'webm' {
	return videoCodec === 'avc' ? 'mp4' : 'webm';
}
