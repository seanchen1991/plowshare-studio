// Copying a 60-minute take (1080p at the app's bitrates: about 2.8 GB) to the
// Backup folder, without holding the file in memory. Runs in a normal profile, where the
// browser allows the room; tagged @long (set LONG_TESTS to run it).

import { expect, test } from '@playwright/test';
import { listOpfs, seedTake } from '../helpers/app.ts';

test('copies a 60-minute take to the Backup folder without holding it in memory @long', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium', 'The Backup folder needs the File System Access API');
	test.setTimeout(15 * 60_000);
	const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('profile'), {
		args: testInfo.project.use.launchOptions?.args,
		baseURL: testInfo.project.use.baseURL
	});
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.addInitScript(() => {
			(window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
				(await navigator.storage.getDirectory()).getDirectoryHandle('podcasts', { create: true });
		});
		await page.goto('/');
		const bytes = Math.round(((6_000_000 + 160_000) * 3600) / 8);
		await seedTake(page, { title: 'An hour', createdAt: new Date(2026, 10, 2).toISOString(), segments: [{ extension: 'mp4', bytes, durationUs: 3600e6 }] });

		const heap = () => page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1e6);
		const before = await heap();
		await page.getByRole('tab', { name: 'Takes' }).click();
		await page.getByTestId('backup').getByRole('button', { name: 'Choose folder…' }).click();
		const samples: number[] = [];
		const started = Date.now();
		await expect
			.poll(
				async () => {
					samples.push(await heap());
					return (await listOpfs(page, 'podcasts'))['2026-11-02 An hour.mp4'];
				},
				{ timeout: 10 * 60_000, intervals: [500] }
			)
			.toBe(bytes);
		await expect(page.getByRole('region', { name: 'Takes' }).getByTestId('session')).toHaveAttribute('data-backed-up', 'true');
		const seconds = (Date.now() - started) / 1000;
		await (await context.newCDPSession(page)).send('HeapProfiler.collectGarbage');
		const after = await heap();
		testInfo.annotations.push({ type: 'copy', description: `${(bytes / 1e9).toFixed(2)} GB in ${seconds.toFixed(0)} s; heap ${before.toFixed(0)} MB before, peak ${Math.max(...samples).toFixed(0)} MB, ${after.toFixed(0)} MB after` });
		// Streaming leaves short-lived chunks for the garbage collector, so the heap saws up and down
		// while copying; held memory would instead grow with the file and stay.
		expect(after - before).toBeLessThan(50);
		expect(Math.max(...samples)).toBeLessThan(bytes / 1e6 / 4);
	} finally {
		await context.close();
	}
});
