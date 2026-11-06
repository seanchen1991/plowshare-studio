// The Takes library: details, download names and Backed up, rename, delete,
// and downloads that stream from disk. Runs in Chrome and Firefox.

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { opfsFileExists, readOpfsJson, seedTake } from '../helpers/app.ts';
import { localDate } from '../../src/lib/storage/download-name.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

const createdAt = new Date(2026, 10, 2, 18, 30).toISOString();
const date = localDate(new Date(createdAt));

function takesList(page: Page) {
	return page.getByRole('region', { name: 'Takes' });
}

async function openTakes(page: Page) {
	await page.getByRole('tab', { name: 'Takes' }).click();
}

test('shows each take’s date, size, length and backup state, and downloads it by name', async ({ page }) => {
	await page.goto('/');
	const seeded = await seedTake(page, {
		title: 'Interview: Sam / part?',
		createdAt,
		segments: [{ extension: 'mp4', bytes: 3_000_000, durationUs: 65_000_000 }]
	});
	await openTakes(page);
	const take = takesList(page).getByTestId('session');
	await expect(take.getByTestId('take-title')).toHaveText('Interview: Sam / part?');
	await expect(take).toContainText(new Date(createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }));
	await expect(take).toContainText('3 MB');
	await expect(take).toContainText('1920 × 1080');
	await expect(take).toContainText('1:05');
	await expect(take).toHaveAttribute('data-backed-up', 'false');
	await expect(take.getByText('Not backed up')).toBeVisible();

	const downloading = page.waitForEvent('download');
	await take.getByRole('button', { name: 'Download' }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe(`${date} Interview Sam part.mp4`);
	expect(statSync(await download.path()).size).toBe(3_000_000);

	await expect(take).toHaveAttribute('data-backed-up', 'true');
	await expect(take.getByText('Not backed up')).toBeHidden();
	const session = await readOpfsJson<Session>(page, `sessions/${seeded.id}/session.json`);
	expect(session.recordings[0]!.segments[0]!.downloaded).toBe(true);
});

test('downloads a take with several Segments one part at a time', async ({ page }) => {
	await page.goto('/');
	await seedTake(page, {
		title: 'Episode 1',
		createdAt,
		segments: [
			{ extension: 'webm', bytes: 1_000_000, durationUs: 600_000_000 },
			{ extension: 'webm', bytes: 500_000, durationUs: 90_000_000 }
		]
	});
	await openTakes(page);
	const take = takesList(page).getByTestId('session');

	for (const [part, length] of [
		[1, '10:00'],
		[2, '1:30']
	] as const) {
		await expect(take).toHaveAttribute('data-backed-up', 'false');
		await take.getByRole('button', { name: 'Download' }).click();
		const downloading = page.waitForEvent('download');
		await page.getByRole('button', { name: `Part ${part} of 2 (${length})` }).click();
		expect((await downloading).suggestedFilename()).toBe(`${date} Episode 1 – part ${part} of 2.webm`);
	}
	await expect(take).toHaveAttribute('data-backed-up', 'true');
});

test('renames a take; Esc keeps the old name', async ({ page }) => {
	await page.goto('/');
	const seeded = await seedTake(page, { title: 'Take 1', createdAt, segments: [{ extension: 'mp4', bytes: 1000, durationUs: 5_000_000 }] });
	await openTakes(page);
	const take = takesList(page).getByTestId('session');

	await take.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	await take.getByRole('textbox', { name: 'Take name' }).fill('Never saved');
	await take.getByRole('textbox', { name: 'Take name' }).press('Escape');
	await expect(take.getByTestId('take-title')).toHaveText('Take 1');

	await take.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	await take.getByRole('textbox', { name: 'Take name' }).fill('  Episode 7 – intro  ');
	await take.getByRole('textbox', { name: 'Take name' }).press('Enter');
	await expect(take.getByTestId('take-title')).toHaveText('Episode 7 – intro');
	expect((await readOpfsJson<Session>(page, `sessions/${seeded.id}/session.json`)).title).toBe('Episode 7 – intro');

	// The name sticks after a reload, and downloads use it.
	await page.reload();
	await openTakes(page);
	const downloading = page.waitForEvent('download');
	await take.getByRole('button', { name: 'Download' }).click();
	expect((await downloading).suggestedFilename()).toBe(`${date} Episode 7 – intro.mp4`);
});

test('deletes a take only after confirming, with all its files', async ({ page }) => {
	await page.goto('/');
	const seeded = await seedTake(page, { title: 'Outtakes', createdAt, segments: [{ extension: 'mp4', bytes: 1000, durationUs: 5_000_000 }] });
	await openTakes(page);
	const take = takesList(page).getByTestId('session');
	const dialog = page.getByRole('dialog', { name: 'Delete “Outtakes”?' });

	await take.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Delete…' }).click();
	await expect(dialog).toContainText("It hasn't been downloaded");
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(take).toHaveCount(1);

	await take.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Delete…' }).click();
	await dialog.getByRole('button', { name: 'Delete' }).click();
	await expect(take).toHaveCount(0);
	await expect(takesList(page)).toContainText('No takes yet');
	expect(await opfsFileExists(page, `sessions/${seeded.id}/session.json`)).toBe(false);
	expect(await opfsFileExists(page, seeded.recordings[0]!.segments[0]!.path!)).toBe(false);
});

/** Resident memory of a browser and all its child processes, in MB. */
function browserMemoryMB(rootPid: number): number {
	const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' })
		.trim()
		.split('\n')
		.map((line) => line.trim().split(/\s+/).map(Number) as [number, number, number]);
	const tree = new Set([rootPid]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const [pid, ppid] of rows) if (tree.has(ppid) && !tree.has(pid)) (tree.add(pid), (grew = true));
	}
	return rows.filter(([pid]) => tree.has(pid)).reduce((sum, [, , rss]) => sum + rss, 0) / 1024;
}

test('downloading a large take keeps memory flat', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium', 'Measured in Chrome; Firefox downloads the same way');
	test.setTimeout(180_000);
	const megabytes = 512;
	const profile = testInfo.outputPath('profile');
	const { launchOptions, baseURL } = testInfo.project.use;
	const context = await playwright.chromium.launchPersistentContext(profile, { ...launchOptions, baseURL, acceptDownloads: true });
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto('/');
		await seedTake(page, { title: 'Long one', createdAt, segments: [{ extension: 'mp4', bytes: megabytes * 1e6, durationUs: 3_600_000_000 }] });
		await openTakes(page);

		// The browser's own process is the oldest one using this profile.
		const rootPid = Number(execFileSync('pgrep', ['-o', '-f', profile], { encoding: 'utf8' }).trim());
		const before = browserMemoryMB(rootPid);
		let peak = before;
		const sampler = setInterval(() => (peak = Math.max(peak, browserMemoryMB(rootPid))), 100);

		const downloading = page.waitForEvent('download');
		await takesList(page).getByTestId('session').getByRole('button', { name: 'Download' }).click();
		const download = await downloading;
		expect(statSync(await download.path()).size).toBe(megabytes * 1e6);
		clearInterval(sampler);

		testInfo.annotations.push({ type: 'memory', description: `before ${before.toFixed(0)} MB, peak ${peak.toFixed(0)} MB` });
		// Reading the file into memory would add about its size.
		expect(peak - before).toBeLessThan(megabytes / 4);
	} finally {
		await context.close();
	}
});
