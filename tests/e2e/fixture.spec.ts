import { expect, test } from '@playwright/test';
import { fixtureSpec as s } from '../fixtures/spec.ts';
import { detectBeeps } from '../helpers/beeps.ts';

test('the fake camera and mic play the fixture', async ({ page }) => {
	await page.goto('/');

	const captured = await page.evaluate(
		async ({ seconds, sampleRate }) => {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: true,
				audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
			});
			const video = stream.getVideoTracks()[0]!.getSettings();

			// Collect raw mic samples for a few seconds.
			const context = new AudioContext({ sampleRate });
			const source = context.createMediaStreamSource(stream);
			const processor = context.createScriptProcessor(4096, 1, 1);
			const chunks: number[][] = [];
			processor.onaudioprocess = (event) => chunks.push(Array.from(event.inputBuffer.getChannelData(0)));
			source.connect(processor);
			processor.connect(context.destination);
			await new Promise((done) => setTimeout(done, seconds * 1000));
			processor.disconnect();
			await context.close();
			stream.getTracks().forEach((track) => track.stop());

			return { width: video.width, height: video.height, samples: chunks.flat() };
		},
		{ seconds: 4, sampleRate: s.sampleRate }
	);

	expect(captured.width).toBe(s.width);
	expect(captured.height).toBe(s.height);

	const beeps = detectBeeps(Float32Array.from(captured.samples), s.sampleRate);
	expect(beeps.length).toBeGreaterThanOrEqual(3);
	for (let i = 1; i < beeps.length; i++) {
		const interval = beeps[i]!.timeSeconds - beeps[i - 1]!.timeSeconds;
		expect(interval).toBeCloseTo(s.beepIntervalSeconds, 1);
	}
});
