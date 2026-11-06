// Takes recorded back to back, while the one before is still Finalizing, and
// audio-only takes with the camera off. Runs in Chrome and Firefox.

import { expect, test, type Page } from '@playwright/test';
import { readOpfsJson, recordTake, saveOpfsFile } from '../helpers/app.ts';
import { probeDurationSeconds, streamCodecs } from '../helpers/media-file.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

type TestWindow = Window & { finalizing: number; mostFinalizing: number; finalized: number };

/** Every take's Session file, oldest first. */
async function allSessions(page: Page): Promise<Session[]> {
	const ids = await page.evaluate(async () => {
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
		const names: string[] = [];
		for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
		return names.sort();
	});
	return Promise.all(ids.map((id) => readOpfsJson<Session>(page, `sessions/${id}/session.json`)));
}

const states = async (page: Page) => (await allSessions(page)).map((s) => s.recordings[0]!.state);

test('a take can start while the one before is Finalizing; they finalize one at a time and both reach Ready', async ({ page }, testInfo) => {
	test.setTimeout(120_000);
	await page.addInitScript(() => {
		const w = window as unknown as TestWindow;
		w.finalizing = w.mostFinalizing = w.finalized = 0;
		// Slows Finalizing down, so the next take is captured (and stopped) while it runs, and counts how many run at once.
		const Original = window.Worker;
		window.Worker = class extends Original {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				if (!String(url).includes('finalize')) return;
				w.mostFinalizing = Math.max(w.mostFinalizing, ++w.finalizing);
				const post = this.postMessage.bind(this) as (message: unknown) => void;
				this.postMessage = ((message: unknown) => setTimeout(() => post(message), 8000)) as typeof this.postMessage;
				const terminate = this.terminate.bind(this);
				this.terminate = () => {
					w.finalizing--;
					w.finalized++;
					terminate();
				};
			}
		};
	});
	await page.goto('/');
	const record = page.getByRole('button', { name: 'Record' });
	const stop = page.getByRole('button', { name: 'Stop' });

	await record.click();
	await expect(page.getByText('REC', { exact: true })).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(3000);
	await stop.click();

	// Straight back to Record, with the first take Finalizing under it.
	await expect(record).toBeEnabled();
	await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'finalizing');
	await record.click();
	await expect(page.getByText('REC', { exact: true })).toBeVisible({ timeout: 10_000 });
	expect(await states(page)).toEqual(['finalizing', 'capturing']);
	await page.waitForTimeout(3000);
	await stop.click();

	// The second waits its turn: the first is still being finalized.
	await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'finalizing');
	expect(await page.evaluate(() => (window as unknown as TestWindow).finalized)).toBe(0);
	// Both still hold their lock, so another tab opening now wouldn't take either for a crashed take.
	const held = await page.evaluate(async () => ((await navigator.locks.query()).held ?? []).map((l) => l.name));
	for (const session of await allSessions(page)) expect(held).toContain(`plowshare.recording.${session.id}/rec_01`);
	await expect.poll(() => states(page), { timeout: 60_000 }).toEqual(['ready', 'ready']);
	const counts = await page.evaluate(() => { const w = window as unknown as TestWindow; return { mostFinalizing: w.mostFinalizing, finalized: w.finalized }; });
	expect(counts.mostFinalizing).toBe(1);
	expect(counts.finalized).toBe(2);

	// Each take has its own playable file, of its own length.
	const sessions = await allSessions(page);
	expect(new Set(sessions.map((s) => s.title)).size).toBe(2);
	for (const session of sessions) {
		const [segment] = session.recordings[0]!.segments;
		expect(session.recordings[0]!.segments).toHaveLength(1);
		expect(segment!.path).toContain(session.id);
		expect(segment!.rawPath).toBeNull();
		const file = testInfo.outputPath(`${session.id}.${segment!.path!.split('.').at(-1)}`);
		await saveOpfsFile(page, segment!.path!, file);
		expect(streamCodecs(file)).toHaveLength(2);
		expect(Math.abs(probeDurationSeconds(file) - 3)).toBeLessThan(1.5);
	}
	await page.getByRole('tab', { name: 'Takes' }).click();
	await expect(page.getByRole('region', { name: 'Takes' }).locator('[data-testid="session"][data-state="ready"]')).toHaveCount(2);
});

test('with the camera off, a take records audio only and the choice is remembered', async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	await page.goto('/');
	const camera = page.getByRole('combobox', { name: 'Camera' });
	await expect(camera).toBeEnabled();
	await camera.selectOption({ label: 'Camera off (audio only)' });
	await expect(page.getByTestId('camera-off')).toBeVisible();
	// The mic keeps working, and no camera check complains about a camera that isn't there.
	await expect(page.getByTestId('level-meter')).toBeVisible();
	await page.waitForTimeout(4000);
	await expect(page.getByTestId('device-warning')).toHaveCount(0);

	const session = await recordTake(page, 4);
	const recording = session.recordings[0]!;
	expect(recording.video).toBeNull();
	expect(recording.audio.codec).toBe('opus');
	const segment = recording.segments[0]!;
	expect(segment.path).toMatch(/\.webm$/);
	expect(segment.frames).toBeNull();
	const file = testInfo.outputPath('audio-only.webm');
	await saveOpfsFile(page, segment.path!, file);
	expect(streamCodecs(file)).toEqual(['opus']);
	expect(Math.abs(probeDurationSeconds(file) - 4)).toBeLessThan(1.5);

	// Shown as audio only in Takes, and it plays.
	await page.getByRole('tab', { name: 'Takes' }).click();
	const row = page.getByRole('region', { name: 'Takes' }).getByTestId('session').first();
	await expect(row).toContainText('Audio only');

	// Still off after a reload, until a camera is chosen.
	await page.reload();
	await expect(page.getByTestId('camera-off')).toBeVisible({ timeout: 10_000 });
	await expect(camera).toHaveValue('off');
	const firstCamera = camera.locator('option').first();
	await camera.selectOption((await firstCamera.getAttribute('value'))!);
	await expect(page.getByTestId('camera-off')).toBeHidden();
	await expect(page.getByTestId('preview')).toBeVisible();
	const again = await recordTake(page, 2);
	expect(again.recordings[0]!.video).not.toBeNull();
});
