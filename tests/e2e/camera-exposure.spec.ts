// The warning for a camera picture that's too dark or washed out: shown over
// the preview once the picture has stayed out of range for a few seconds,
// gone once it's back, never for an audio-only take, and not for the normal
// fake camera. Chrome and Firefox.

import { expect, test, type Page } from '@playwright/test';
import { fixtureSpec } from '../fixtures/spec.ts';
import { useFixtureMedia } from '../helpers/fake-media.ts';

/**
 * Replaces the camera with a picture of one colour, `window.cameraColor`,
 * which the test can change; the microphone is left as it is.
 */
function paintedCamera(color: string) {
	(window as unknown as { cameraColor: string }).cameraColor = color;
	const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
	navigator.mediaDevices.getUserMedia = async (constraints) => {
		const stream = await getUserMedia(constraints);
		const real = stream.getVideoTracks()[0];
		if (!real) return stream;
		const canvas = document.createElement('canvas');
		canvas.width = 1280;
		canvas.height = 720;
		const context = canvas.getContext('2d')!;
		setInterval(() => {
			context.fillStyle = (window as unknown as { cameraColor: string }).cameraColor;
			context.fillRect(0, 0, canvas.width, canvas.height);
		}, 33);
		const painted = canvas.captureStream(30).getVideoTracks()[0]!;
		stream.removeTrack(real);
		real.stop();
		stream.addTrack(painted);
		return stream;
	};
}

test.beforeEach(async ({ context, browserName }) => {
	if (browserName === 'firefox') await context.addInitScript(useFixtureMedia, fixtureSpec);
});

const warning = (page: Page, text: RegExp) => page.getByTestId('device-warning').filter({ hasText: text });
const setColor = (page: Page, color: string) => page.evaluate((c) => ((window as unknown as { cameraColor: string }).cameraColor = c), color);

test('a very dark picture is warned about after a few seconds, and the warning goes once it’s back in range', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(paintedCamera, '#050505');
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	const dark = warning(page, /very dark/);
	// Not straight away: auto-exposure gets 2 s to settle, then it must stay dark for 3 samples.
	await page.waitForTimeout(3000);
	await expect(dark).toHaveCount(0);
	await expect(dark).toBeVisible({ timeout: 6000 });
	await expect(dark).toContainText('Add light facing you, or set exposure by hand with a camera control app (such as CameraController on a Mac).');
	await expect(dark).toContainText('Unplugging the camera and plugging it back in sometimes helps.');
	// It never blocks recording.
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();

	// A normal picture again: gone within a few seconds.
	await setColor(page, '#7a6f66');
	await expect(dark).toHaveCount(0, { timeout: 5000 });
});

test('a washed-out picture is warned about, and stays warned about while recording', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(paintedCamera, '#fbfbfb');
	await page.goto('/');
	const washedOut = warning(page, /washed out/);
	await expect(washedOut).toBeVisible({ timeout: 10_000 });
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(2000);
	await expect(washedOut).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
});

test('the normal fake camera gets no warning', async ({ page }) => {
	test.setTimeout(60_000);
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	await page.waitForTimeout(7000);
	await expect(warning(page, /very dark|washed out/)).toHaveCount(0);

	// One sample, taken as the watcher takes it (a 64 × 36 copy of the preview, read back), costs about a millisecond.
	const sampleMs = await page.getByTestId('preview').evaluate((video: HTMLVideoElement) => {
		const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
		const context = canvas.getContext('2d', { willReadFrequently: true })!;
		const started = performance.now();
		for (let i = 0; i < 50; i++) {
			context.drawImage(video, 0, 0, 64, 36);
			context.getImageData(0, 0, 64, 36);
		}
		return (performance.now() - started) / 50;
	});
	console.log(`Exposure sample: ${sampleMs.toFixed(2)} ms`);
	expect(sampleMs).toBeLessThan(5);
});

test('an audio-only take gets no warning, however dark the camera', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(paintedCamera, '#000000');
	await page.goto('/');
	const camera = page.getByRole('combobox', { name: 'Camera' });
	await expect(camera).toBeEnabled();
	await camera.selectOption({ label: 'Camera off (audio only)' });
	await expect(page.getByTestId('camera-off')).toBeVisible();
	await page.waitForTimeout(7000);
	await expect(warning(page, /very dark/)).toHaveCount(0);
});
