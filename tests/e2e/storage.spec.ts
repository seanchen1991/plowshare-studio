// Recording time left: shown before recording, refused when too short, warned
// about and stopped cleanly while Capturing. The tests set the quota the page
// sees: Chrome's own estimate() always reports usage + 10 GiB, even under a
// lower quota it enforces. A private window is tried in a real installed
// Firefox (Playwright's build allows storage there).

import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readOpfsJson } from '../helpers/app.ts';
import { installedFirefox, launchFirefox } from '../helpers/raw-browser.ts';
import { audioBitsPerSecond, videoBitsPerSecond } from '../../src/lib/media/capture.ts';
import { formatTimeLeft, recordingTimeLeftSeconds, safetyMarginBytes } from '../../src/lib/storage/time-left.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

test.beforeEach(async ({ page }) => {
	// estimate() reports `window.testQuota` as the quota once a test sets it.
	await page.addInitScript(() => {
		const estimate = navigator.storage.estimate.bind(navigator.storage);
		navigator.storage.estimate = async () => {
			const real = await estimate();
			const quota = (window as unknown as { testQuota?: number }).testQuota;
			return quota === undefined ? real : { ...real, quota };
		};
	});
});

const estimate = (page: Page) => page.evaluate(() => navigator.storage.estimate()) as Promise<{ quota: number; usage: number }>;

/** Bits per second the app records at with this browser's fake camera (Chrome's fixture is 720p, Firefox's 1080p). */
const cameraBitsPerSecond = (page: Page) =>
	page.getByTestId('preview').evaluate((video: HTMLVideoElement) => (video.srcObject as MediaStream).getVideoTracks()[0]!.getSettings().height ?? 0)
		.then((height) => videoBitsPerSecond(height) + audioBitsPerSecond);

/** Sets the quota so that `seconds` of recording are left, given what is stored now, all of it owed a finished copy. */
async function leave(page: Page, seconds: number) {
	const { usage } = await estimate(page);
	const bytesPerSecond = (await cameraBitsPerSecond(page)) / 8;
	await page.evaluate((quota) => ((window as unknown as { testQuota: number }).testQuota = quota), usage * 2 + safetyMarginBytes + seconds * bytesPerSecond * 2);
}

test('shows Recording time left before recording', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	const { quota, usage } = await estimate(page);
	const expected = formatTimeLeft(recordingTimeLeftSeconds({ quota, usage, rawBytes: 0 }, await cameraBitsPerSecond(page)));
	await expect(page.getByTestId('time-left')).toHaveText(`Room for ${expected}`);
});

test('refuses to record with under 10 minutes of room, and says how to free some', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	await leave(page, 6 * 60 + 30);
	const problem = page.getByTestId('storage-problem');
	await expect(problem).toContainText('Not enough room to record: about 6 m left, and a take needs at least 10 minutes.', { timeout: 10_000 });
	await expect(problem).toContainText('Download the takes you want to keep and delete them in Takes');
	await expect(page.getByTestId('time-left')).toHaveText('Room for about 6 m');
	await expect(page.getByRole('button', { name: 'Record' })).toBeDisabled();
	await page.keyboard.press('Space');
	await expect(page.getByTestId('countdown')).toBeHidden();

	// Room again: recording is allowed.
	await leave(page, 30 * 60);
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled({ timeout: 10_000 });
	await expect(problem).toBeHidden();
});

test('warns at 15 and 5 minutes left, then stops cleanly and keeps the take', async ({ page }) => {
	test.setTimeout(90_000);
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
	const warning = page.getByTestId('storage-warning');
	await page.waitForTimeout(3000);
	await expect(warning).toBeHidden();

	// The disk fills up (another app, say) while the take runs.
	await leave(page, 14 * 60);
	await expect(warning).toHaveAttribute('data-threshold', '15', { timeout: 10_000 });
	await expect(warning).toContainText(/Room for about 1[34] m more\. The take stops by itself, and is kept/);
	await expect(page.getByTestId('time-left')).toHaveText(/Room for about 1[34] m/);

	await leave(page, 4 * 60);
	await expect(warning).toHaveAttribute('data-threshold', '5', { timeout: 10_000 });

	// Out of room: only the margin is free beyond what is stored.
	const { usage } = await estimate(page);
	await page.evaluate((quota) => ((window as unknown as { testQuota: number }).testQuota = quota), usage + safetyMarginBytes);
	await expect(page.getByTestId('storage-stopped')).toHaveText(
		'Recording stopped: this computer ran out of room for recordings. The take is kept.',
		{ timeout: 10_000 }
	);
	await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden();
	const take = page.getByTestId('session').first();
	await expect(take).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
	const session = await readOpfsJson<Session>(page, `sessions/${await take.getAttribute('data-session-id')}/session.json`);
	const segment = session.recordings[0]!.segments[0]!;
	expect(segment.path).not.toBeNull();
	expect(segment.rawPath).toBeNull();
	expect(segment.durationUs! / 1e6).toBeGreaterThan(5);
	// No room for another take.
	await expect(page.getByRole('button', { name: 'Record' })).toBeDisabled();
	await expect(page.getByTestId('storage-problem')).toBeVisible();
});

test('refuses to record where the browser won’t let the site store files', async ({ page }) => {
	await page.addInitScript(() => {
		navigator.storage.getDirectory = () => Promise.reject(new DOMException('Security error when calling GetDirectory', 'SecurityError'));
	});
	await page.goto('/');
	await expect(page.getByTestId('storage-refused')).toContainText("Plowshare Studio can't record in a private window.");
	await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0);
});

test('refuses to record in a real Firefox private window', async ({ browserName }, testInfo) => {
	const firefox = browserName === 'firefox' ? installedFirefox() : null;
	test.skip(!firefox, 'Needs an installed Firefox: Playwright’s build allows storage in private windows');
	const profile = testInfo.outputPath('profile');
	mkdirSync(profile, { recursive: true });
	const raw = await launchFirefox(firefox!, profile, testInfo.outputPath('downloads'), { 'browser.privatebrowsing.autostart': true });
	try {
		await raw.open(`${testInfo.project.use.baseURL}/`);
		const deadline = Date.now() + 15_000;
		let text: string | null = null;
		while (!text && Date.now() < deadline) {
			text = await raw.evaluate<string | null>(`document.querySelector('[data-testid=storage-refused]')?.textContent ?? null`);
			if (!text) await new Promise((done) => setTimeout(done, 250));
		}
		expect(text).toContain("can't record in a private window");
	} finally {
		await raw.close();
	}
});

test('when the browser runs out of room before the estimate says, the take is kept and can be finished later', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium', 'The quota is enforced through the DevTools protocol');
	test.setTimeout(120_000);
	// A normal profile: Chrome ignores quota overrides in Playwright's off-the-record contexts.
	const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('profile'), {
		args: testInfo.project.use.launchOptions?.args,
		baseURL: testInfo.project.use.baseURL
	});
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto('/');
		const cdp = await context.newCDPSession(page);
		const quota = (bytes: number) => cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(page.url()).origin, quotaSize: bytes });
		// estimate() still reports usage + 10 GiB, so the app sees plenty of room.
		await quota(6_000_000);
		await page.getByRole('button', { name: 'Record' }).click();
		await expect(page.getByTestId('storage-stopped')).toContainText('this computer ran out of room for recordings. The take is kept, up to the last few seconds.', {
			timeout: 60_000
		});
		const take = page.getByTestId('session').first();
		// Chrome sometimes words this as a generic write failure ("Failed to write data to data pipe").
		await expect(take.getByTestId('finalize-failed')).toContainText(/(There wasn't room on this computer to finish this take|Couldn't finish this take: .*if this computer is short of space)/, {
			timeout: 30_000
		});

		await quota(200_000_000);
		await take.getByRole('button', { name: 'Try again' }).click();
		await expect(take).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
		await expect(take.getByTestId('finalize-failed')).toBeHidden();
		const session = await readOpfsJson<Session>(page, `sessions/${await take.getAttribute('data-session-id')}/session.json`);
		const segment = session.recordings[0]!.segments[0]!;
		expect(segment.rawPath).toBeNull();
		expect(segment.durationUs! / 1e6).toBeGreaterThan(5);
		await take.getByRole('button', { name: 'Play' }).click();
		const duration = await page.getByTestId('player').evaluate(async (video: HTMLVideoElement) => {
			if (video.readyState < 1) await new Promise((done) => video.addEventListener('loadedmetadata', done, { once: true }));
			return video.duration;
		});
		expect(Math.abs(duration - segment.durationUs! / 1e6)).toBeLessThan(1);
	} finally {
		await context.close();
	}
});

test('refuses to record under a small quota Firefox really enforces', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName !== 'firefox', 'Uses a Firefox storage pref');
	// Firefox gives a site a fifth of this fixed limit (in KB) and reports it truthfully: 409.6 MB.
	const browser = await playwright.firefox.launch({
		firefoxUserPrefs: { ...testInfo.project.use.launchOptions?.firefoxUserPrefs, 'dom.quotaManager.temporaryStorage.fixedLimit': 2_000_000 }
	});
	try {
		const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
		await page.goto('/');
		expect((await estimate(page)).quota).toBe(409_600_000);
		await expect(page.getByTestId('storage-problem')).toContainText('Not enough room to record: less than a minute left', { timeout: 10_000 });
		await expect(page.getByRole('button', { name: 'Record' })).toBeDisabled();
	} finally {
		await browser.close();
	}
});
