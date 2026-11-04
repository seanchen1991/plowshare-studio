// What to ask the camera and mic for, and how hard to compress what they
// deliver (Handoff brief, capture quality). Pure.

import type { VideoSettings } from '../storage/session-file.ts';

/**
 * 1080p at 30 fps if the camera has it; `ideal` means the browser falls back to
 * the closest the camera offers instead of failing, and it never upscales.
 * Audio as the mic hears it: no call-style processing, mono, 48 kHz (browsers
 * may still deliver stereo, so the Session file records what arrived).
 */
export function captureConstraints(): MediaStreamConstraints {
	return {
		video: {
			width: { ideal: 1920 },
			height: { ideal: 1080 },
			frameRate: { ideal: 30 }
		},
		audio: {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			channelCount: { ideal: 1 },
			sampleRate: { ideal: 48000 }
		}
	};
}

export const audioBitsPerSecond = 160_000;

/** 6 Mbps at 1080p, 3.5 Mbps at 720p, 2 Mbps below that. */
export function videoBitsPerSecond(height: number): number {
	if (height >= 1080) return 6_000_000;
	if (height >= 720) return 3_500_000;
	return 2_000_000;
}

/** Tells the user when the camera gives less than 1080p; null when it doesn't. */
export function resolutionNotice(video: VideoSettings | null): string | null {
	if (!video || video.height <= 0 || video.height >= 1080) return null;
	return `Your camera only provides ${video.height}p, so this take records at ${video.height}p.`;
}
