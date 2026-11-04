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

/** Warns when the mic opens below 48 kHz, like a Bluetooth headset in call mode. Unknown rates (Firefox) pass. */
export function sampleRateWarning(sampleRate: number | undefined): string | null {
	if (!sampleRate || sampleRate >= 48000) return null;
	return (
		`Your microphone is running at ${sampleRate / 1000} kHz and will sound like a phone call. ` +
		'Bluetooth headsets do this while their mic is on; a wired or USB mic will sound better.'
	);
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
