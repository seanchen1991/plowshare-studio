import { describe, expect, it } from 'vitest';
import {
	deviceProblem,
	exposureOf,
	exposureWarning,
	frameRateWarning,
	quietExposure,
	sampleRateWarning,
	watchExposureStep,
	type Exposure
} from './device-checks.ts';

describe('frameRateWarning', () => {
	it('stays quiet at or near 30 fps', () => {
		expect(frameRateWarning(30)).toBeNull();
		expect(frameRateWarning(24)).toBeNull();
	});

	it('warns well below 30 fps, naming the rate', () => {
		expect(frameRateWarning(20.4)).toMatch(/^Your camera is only sending 20 frames per second/);
	});
});

describe('sampleRateWarning', () => {
	it('stays quiet at 48 and 44.1 kHz, and when the browser does not say', () => {
		expect(sampleRateWarning(48000)).toBeNull();
		expect(sampleRateWarning(44100)).toBeNull();
		expect(sampleRateWarning(undefined)).toBeNull();
	});

	it('warns at call quality, below 44.1 kHz', () => {
		expect(sampleRateWarning(16000)).toMatch(/^Your microphone is running at 16 kHz/);
		expect(sampleRateWarning(8000)).toMatch(/8 kHz/);
		expect(sampleRateWarning(32000)).toMatch(/32 kHz/);
	});
});

describe('deviceProblem', () => {
	const denied = new DOMException('Permission denied', 'NotAllowedError');

	it('gives steps for each browser when access is denied', () => {
		expect(deviceProblem(denied, 'chrome', false).steps[1]).toBe('Turn on Camera and Microphone.');
		expect(deviceProblem(denied, 'edge', false).steps[0]).toMatch(/Permissions for this site/);
		expect(deviceProblem(denied, 'firefox', false).steps[0]).toMatch(/crossed-out camera/);
	});

	it('points Mac users at System Settings too', () => {
		expect(deviceProblem(denied, 'chrome', true).steps.at(-1)).toMatch(/Privacy & Security/);
		expect(deviceProblem(denied, 'chrome', false).steps.at(-1)).toBe('Reload the page.');
	});

	it('explains missing and busy devices', () => {
		expect(deviceProblem(new DOMException('', 'NotFoundError'), 'chrome', false).title).toMatch(/No camera/);
		expect(deviceProblem(new DOMException('', 'NotReadableError'), 'firefox', false).title).toMatch(/busy/);
	});
});

/** A histogram with `count` pixels at each given brightness. */
function histogram(...levels: [luma: number, count: number][]): number[] {
	const bins = new Array<number>(256).fill(0);
	for (const [luma, count] of levels) bins[luma]! += count;
	return bins;
}

describe('exposureOf', () => {
	it('calls a picture of crushed blacks very dark', () => {
		expect(exposureOf(histogram([4, 1000]))).toBe('dark');
		expect(exposureOf(histogram([10, 850], [120, 150]))).toBe('dark');
		expect(exposureOf(histogram([35, 970], [90, 30]))).toBe('dark');
	});

	it('calls a picture of blown whites, or all very bright, washed out', () => {
		expect(exposureOf(histogram([252, 1000]))).toBe('washed-out');
		expect(exposureOf(histogram([245, 550], [140, 450]))).toBe('washed-out');
		expect(exposureOf(histogram([215, 950], [100, 50]))).toBe('washed-out');
	});

	it('passes a normal picture', () => {
		const spread = histogram(...Array.from({ length: 256 }, (_, i) => [i, 4] as [number, number]));
		expect(exposureOf(spread)).toBeNull();
		expect(exposureOf(histogram([60, 300], [120, 400], [190, 300]))).toBeNull();
	});

	it('passes a dark backdrop with a lit face, though its average is very low', () => {
		// Averages 31 of 255, but a quarter of the picture is well exposed.
		expect(exposureOf(histogram([5, 750], [110, 250]))).toBeNull();
		expect(exposureOf(histogram([8, 650], [150, 300], [230, 50]))).toBeNull();
	});

	it('passes a bright room with some shadow', () => {
		expect(exposureOf(histogram([240, 400], [180, 400], [40, 200]))).toBeNull();
	});

	it('says nothing about an empty frame', () => {
		expect(exposureOf(histogram())).toBeNull();
	});
});

describe('exposureWarning', () => {
	it('names the problem and gives the same advice for both', () => {
		expect(exposureWarning('dark')).toMatch(/^Your camera picture is very dark\. Add light facing you/);
		expect(exposureWarning('washed-out')).toMatch(/^Your camera picture is washed out\. .*CameraController/);
		expect(exposureWarning(null)).toBeNull();
	});
});

describe('watchExposureStep', () => {
	const run = (samples: Exposure[]) => samples.reduce(watchExposureStep, quietExposure).shown;

	it('warns once the picture has been out of range for 3 samples in a row', () => {
		expect(run(['dark', 'dark'])).toBeNull();
		expect(run(['dark', 'dark', 'dark'])).toBe('dark');
		expect(run(['dark', null, 'dark', 'dark'])).toBeNull();
	});

	it('clears after 2 samples back in range, and not after one', () => {
		expect(run(['dark', 'dark', 'dark', null])).toBe('dark');
		expect(run(['dark', 'dark', 'dark', null, null])).toBeNull();
	});

	it('switches from one warning to the other once the new one has lasted', () => {
		expect(run(['dark', 'dark', 'dark', 'washed-out', 'washed-out'])).toBe('dark');
		expect(run(['dark', 'dark', 'dark', 'washed-out', 'washed-out', 'washed-out'])).toBe('washed-out');
	});
});
