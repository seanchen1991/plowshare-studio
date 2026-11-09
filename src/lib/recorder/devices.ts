// Opening the camera and mic, and watching what they deliver. The preview
// stream is the one a take records, so what the user sees is what they get.

import { audioConstraints, captureConstraints, videoConstraints, type CaptureChoice } from '../media/capture.ts';
import { exposureOf, quietExposure, watchExposureStep, type Exposure } from './device-checks.ts';

export function openDevices(choice: CaptureChoice): Promise<MediaStream> {
	return navigator.mediaDevices.getUserMedia(captureConstraints(choice));
}

/** Opens exactly this camera; with no id (none listed yet), the saved one if it's there, or any. */
export async function openCamera(cameraId: string | undefined, preferredId?: string): Promise<MediaStreamTrack> {
	const constraints = cameraId ? videoConstraints(cameraId, true) : videoConstraints(preferredId);
	const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
	return stream.getVideoTracks()[0]!;
}

/** Opens exactly this mic. */
export async function openMic(micId: string, cleanUpAudio = false): Promise<MediaStreamTrack> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(micId, cleanUpAudio, true) });
	return stream.getAudioTracks()[0]!;
}

export interface DeviceLists {
	cameras: MediaDeviceInfo[];
	mics: MediaDeviceInfo[];
}

/** Cameras and mics, with names once the user has allowed access. */
export async function listDevices(): Promise<DeviceLists> {
	const devices = await navigator.mediaDevices.enumerateDevices();
	return {
		cameras: devices.filter((d) => d.kind === 'videoinput' && d.deviceId),
		mics: devices.filter((d) => d.kind === 'audioinput' && d.deviceId)
	};
}

/**
 * Reports the frames per second a playing video shows, averaged over the last
 * few seconds, once a second. Pauses while the tab is hidden, where browsers
 * stop painting frames. Returns a function that stops watching.
 */
export function watchFrameRate(video: HTMLVideoElement, onRate: (fps: number) => void, windowMs = 3000): () => void {
	let frames: number[] = [];
	let since = performance.now();
	let watching = true;

	const onFrame = (now: number) => {
		if (!watching) return;
		frames.push(now);
		video.requestVideoFrameCallback(onFrame);
	};
	video.requestVideoFrameCallback(onFrame);

	const timer = setInterval(() => {
		const now = performance.now();
		if (document.hidden) {
			frames = [];
			since = now;
			return;
		}
		frames = frames.filter((t) => t > now - windowMs);
		// Only report once a full window has been watched.
		if (now - since >= windowMs) onRate((frames.length * 1000) / windowMs);
	}, 1000);

	return () => {
		watching = false;
		clearInterval(timer);
	};
}

/** Samples are taken from a frame this small: plenty to judge brightness, and next to nothing to read. */
const exposureSample = { width: 64, height: 36 };

/**
 * Watches the camera picture's brightness about once a second, from a tiny copy
 * of the preview, and reports when the exposure warning should change. Ignores
 * the first 2 s, while the camera's auto-exposure settles. Nothing here touches
 * the recording.
 */
export function watchExposure(video: HTMLVideoElement, onExposure: (exposure: Exposure) => void, settleMs = 2000): () => void {
	const canvas = document.createElement('canvas');
	canvas.width = exposureSample.width;
	canvas.height = exposureSample.height;
	const context = canvas.getContext('2d', { willReadFrequently: true })!;
	const started = performance.now();
	let watch = quietExposure;

	const timer = setInterval(() => {
		if (document.hidden || video.readyState < 2 || performance.now() - started < settleMs) return;
		context.drawImage(video, 0, 0, canvas.width, canvas.height);
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		const histogram = new Uint32Array(256);
		for (let i = 0; i < data.length; i += 4) histogram[Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!)]!++;
		const next = watchExposureStep(watch, exposureOf(histogram));
		if (next.shown !== watch.shown) onExposure(next.shown);
		watch = next;
	}, 1000);

	return () => clearInterval(timer);
}
