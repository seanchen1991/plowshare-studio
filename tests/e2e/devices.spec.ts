import { expect, test } from '@playwright/test';
import { readOpfsJson, recordTake } from '../helpers/app.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

test('the preview is mirrored', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	const transform = await page.getByTestId('preview').evaluate((video) => getComputedStyle(video).transform);
	expect(transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
});

test('remembers the chosen microphone between visits', async ({ page }) => {
	await page.goto('/');
	const mic = page.getByRole('combobox', { name: 'Microphone' });
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	const labels = await mic.locator('option').allTextContents();
	expect(labels.length).toBeGreaterThan(1);
	// Not the one the browser opens by default.
	const chosen = labels.at(-1)!;
	await mic.selectOption({ label: chosen });
	await expect(mic.locator('option:checked')).toHaveText(chosen);

	// Chrome hands out new device ids here on every visit, so the mic is found again by name.
	await page.reload();
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	await expect(page.getByRole('combobox', { name: 'Microphone' }).locator('option:checked')).toHaveText(chosen);
	const inUse = await page.getByTestId('preview').evaluate((video) =>
		((video as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0]!.label
	);
	expect(inUse).toBe(chosen);
});

test('"Clean up audio" starts off, is remembered and is stored with the take', async ({ page }) => {
	await page.goto('/');
	const cleanUp = page.getByRole('button', { name: 'Clean up audio' });
	await expect(cleanUp).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	await cleanUp.click();
	await expect(cleanUp).toHaveAttribute('aria-pressed', 'true');

	await page.reload();
	await expect(page.getByRole('button', { name: 'Clean up audio' })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	const session = await recordTake(page, 3);
	expect(session.recordings[0]!.audio.processing).toBe(true);
	const stored = await readOpfsJson<Session>(page, `sessions/${session.id}/session.json`);
	expect(stored.recordings[0]!.audio.processing).toBe(true);
});

test('explains how to re-allow a blocked camera and mic', async ({ page }) => {
	await page.addInitScript(() => {
		navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
	});
	await page.goto('/');
	const problem = page.getByTestId('device-problem');
	await expect(problem).toContainText('isn’t allowed to use your camera and microphone');
	await expect(problem).toContainText('Turn on Camera and Microphone.');
	await expect(page.getByRole('button', { name: 'Record' })).toBeDisabled();
});
