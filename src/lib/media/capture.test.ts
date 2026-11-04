import { describe, expect, it } from 'vitest';
import type { VideoSettings } from '../storage/session-file.ts';
import { captureConstraints, resolutionNotice, videoBitsPerSecond } from './capture.ts';

const video = (height: number): VideoSettings => ({ codec: 'avc', width: (height * 16) / 9, height, fps: 30, bitrate: null });

describe('captureConstraints', () => {
	it('asks for 1080p at 30 fps without requiring it', () => {
		expect(captureConstraints().video).toEqual({
			width: { ideal: 1920 },
			height: { ideal: 1080 },
			frameRate: { ideal: 30 }
		});
	});

	it('asks for the chosen devices, falling back if they are gone', () => {
		const constraints = captureConstraints({ cameraId: 'cam', micId: 'mic' });
		expect(constraints.video).toMatchObject({ deviceId: { ideal: 'cam' } });
		expect(constraints.audio).toMatchObject({ deviceId: { ideal: 'mic' } });
	});

	it('turns call-style processing on only when asked to clean up audio', () => {
		expect(captureConstraints({ cleanUpAudio: true }).audio).toMatchObject({
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true
		});
	});

	it('turns call-style audio processing off and asks for mono at 48 kHz', () => {
		expect(captureConstraints().audio).toMatchObject({
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			channelCount: { ideal: 1 },
			sampleRate: { ideal: 48000 }
		});
	});
});

describe('videoBitsPerSecond', () => {
	it('follows the resolution the camera delivers', () => {
		expect(videoBitsPerSecond(1080)).toBe(6_000_000);
		expect(videoBitsPerSecond(720)).toBe(3_500_000);
		expect(videoBitsPerSecond(480)).toBe(2_000_000);
	});
});

describe('resolutionNotice', () => {
	it('says nothing at 1080p', () => {
		expect(resolutionNotice(video(1080))).toBeNull();
	});

	it('names the resolution when the camera gives less', () => {
		expect(resolutionNotice(video(720))).toBe('Your camera only provides 720p, so this take records at 720p.');
	});

	it('says nothing for audio-only takes or unknown sizes', () => {
		expect(resolutionNotice(null)).toBeNull();
		expect(resolutionNotice(video(0))).toBeNull();
	});
});
