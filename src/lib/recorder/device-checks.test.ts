import { describe, expect, it } from 'vitest';
import { deviceProblem, frameRateWarning, sampleRateWarning } from './device-checks.ts';

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
	it('stays quiet at 48 kHz and when the browser does not say', () => {
		expect(sampleRateWarning(48000)).toBeNull();
		expect(sampleRateWarning(undefined)).toBeNull();
	});

	it('warns below 48 kHz', () => {
		expect(sampleRateWarning(16000)).toMatch(/^Your microphone is running at 16 kHz/);
		expect(sampleRateWarning(44100)).toMatch(/44\.1 kHz/);
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
