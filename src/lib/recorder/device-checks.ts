// Messages about the camera and mic: the checks shown over the preview (spike
// 03) and what to do when the browser refuses access. Pure.

import type { SupportedBrowser } from '../browser/support.ts';

export const requestedFps = 30;

/** Warns when the camera delivers well below the 30 fps asked for (below 24). */
export function frameRateWarning(fps: number): string | null {
	if (fps >= requestedFps * 0.8) return null;
	return (
		`Your camera is only sending ${Math.round(fps)} frames per second, often because of low light or exposure. ` +
		'Try more light, or unplug the camera and plug it back in.'
	);
}

/**
 * Warns when the mic opens at call quality (below 44.1 kHz), like a Bluetooth
 * headset in call mode at 8 or 16 kHz. 44.1 kHz, common for USB mics and audio
 * interfaces, is fine: it is resampled to 48 kHz. Unknown rates (Firefox) pass.
 */
export function sampleRateWarning(sampleRate: number | undefined): string | null {
	if (!sampleRate || sampleRate >= 44100) return null;
	return (
		`Your microphone is running at ${sampleRate / 1000} kHz and will sound like a phone call. ` +
		'Bluetooth headsets do this while their mic is on; a wired or USB mic will sound better.'
	);
}

/** A camera picture that's too dark or washed out to record, or null when it's fine. */
export type Exposure = 'dark' | 'washed-out' | null;

/** The share of a brightness histogram (256 bins of luma, 0–255) at or below `max`, or at or above `min`. */
function shareAtMost(histogram: ArrayLike<number>, total: number, max: number): number {
	let count = 0;
	for (let i = 0; i <= max; i++) count += histogram[i]!;
	return count / total;
}
function shareAtLeast(histogram: ArrayLike<number>, total: number, min: number): number {
	let count = 0;
	for (let i = min; i < 256; i++) count += histogram[i]!;
	return count / total;
}

/**
 * Whether a picture is too dark or washed out, from the share of nearly black or
 * nearly white pixels rather than the average: a dark backdrop with a lit face is
 * fine, a frame that's mostly crushed black or blown white isn't.
 */
export function exposureOf(histogram: ArrayLike<number>): Exposure {
	let total = 0;
	for (let i = 0; i < 256; i++) total += histogram[i]!;
	if (total === 0) return null;
	if (shareAtMost(histogram, total, 20) >= 0.8 || shareAtMost(histogram, total, 45) >= 0.95) return 'dark';
	if (shareAtLeast(histogram, total, 235) >= 0.5 || shareAtLeast(histogram, total, 200) >= 0.9) return 'washed-out';
	return null;
}

const exposureAdvice =
	'Add light facing you, or set exposure by hand with a camera control app (such as CameraController on a Mac). ' +
	'Unplugging the camera and plugging it back in sometimes helps.';

export function exposureWarning(exposure: Exposure): string | null {
	if (exposure === 'dark') return `Your camera picture is very dark. ${exposureAdvice}`;
	if (exposure === 'washed-out') return `Your camera picture is washed out. ${exposureAdvice}`;
	return null;
}

/** What the exposure warning shows, and the run of samples that may change it. */
export interface ExposureWatch {
	shown: Exposure;
	streak: Exposure;
	count: number;
}

export const quietExposure: ExposureWatch = { shown: null, streak: null, count: 0 };

/**
 * The warning after one more sample (about one a second): it appears once the
 * picture has been out of range for 3 samples in a row, and clears after 2 in range.
 */
export function watchExposureStep(watch: ExposureWatch, sample: Exposure): ExposureWatch {
	const count = sample === watch.streak ? watch.count + 1 : 1;
	const needed = sample === null ? 2 : 3;
	return { shown: sample !== watch.shown && count >= needed ? sample : watch.shown, streak: sample, count };
}

export interface DeviceProblem {
	title: string;
	steps: string[];
}

const reallowSteps: Record<SupportedBrowser, string[]> = {
	chrome: [
		'Click the icon at the left end of the address bar.',
		'Turn on Camera and Microphone.',
		'Reload the page.'
	],
	chromium: [
		'Click the icon at the left end of the address bar.',
		'Allow the camera and microphone for this site.',
		'Reload the page.'
	],
	edge: [
		'Click the icon at the left end of the address bar, then Permissions for this site.',
		'Set Camera and Microphone to Allow.',
		'Reload the page.'
	],
	firefox: [
		'Click the crossed-out camera or microphone icon at the left end of the address bar.',
		'Click the × next to each Blocked permission.',
		'Reload the page and choose Allow.'
	]
};

/** Plain words for a failed getUserMedia, with steps to fix it where the user can. */
export function deviceProblem(error: unknown, browser: SupportedBrowser, isMac: boolean): DeviceProblem {
	const name = error instanceof DOMException || error instanceof Error ? error.name : '';
	const message = error instanceof Error ? error.message : String(error);
	if (name === 'NotAllowedError' || name === 'SecurityError') {
		const steps = [...reallowSteps[browser]];
		if (isMac) {
			steps.push(
				'Still blocked? Open System Settings › Privacy & Security, and allow this browser under Camera and Microphone.'
			);
		}
		return { title: 'Plowshare Studio isn’t allowed to use your camera and microphone.', steps };
	}
	if (name === 'NotFoundError' || name === 'OverconstrainedError') {
		return { title: 'No camera or microphone was found.', steps: ['Plug one in, then try again.'] };
	}
	if (name === 'NotReadableError' || name === 'AbortError') {
		return {
			title: 'Your camera or microphone is busy.',
			steps: ['Close other apps or tabs that might be using it (video calls, other recorders), then try again.']
		};
	}
	return { title: `Couldn’t open your camera and microphone (${message}).`, steps: ['Try again.'] };
}
