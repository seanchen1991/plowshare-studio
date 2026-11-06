// Asking the browser to keep recordings permanently, the notice and badges
// while it hasn't agreed, and installing the app. Chrome refuses persistence
// in Playwright's off-the-record contexts; Firefox is tried with its permission
// set to allow and to block, and Chrome with it granted in a normal profile.

import { expect, test, type Page } from '@playwright/test';
import { recordTake, seedTake } from '../helpers/app.ts';

// Counts calls to persist(), to check when the app asks.
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const persist = navigator.storage.persist.bind(navigator.storage);
		const w = window as unknown as { persistCalls: number };
		w.persistCalls = 0;
		navigator.storage.persist = () => {
			w.persistCalls++;
			return persist();
		};
	});
});

const persistCalls = (page: Page) => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls);

const takes = (page: Page) => page.getByRole('region', { name: 'Takes' });

async function openTakes(page: Page) {
	await page.getByRole('tab', { name: 'Takes' }).click();
}

test('asks on the first Record, not on page load, and again on a later visit while refused', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Chrome refuses here without a prompt; Firefox is tried below');
	test.setTimeout(60_000);
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	expect(await persistCalls(page)).toBe(0);
	await openTakes(page);
	await expect(page.getByTestId('persistence-notice')).toBeHidden();
	await page.getByRole('tab', { name: 'Record' }).click();

	await recordTake(page, 2);
	expect(await persistCalls(page)).toBe(1);
	await recordTake(page, 2);
	// Once a visit.
	expect(await persistCalls(page)).toBe(1);

	await openTakes(page);
	const notice = page.getByTestId('persistence-notice');
	await expect(notice).toContainText("Your browser hasn't agreed to keep recordings permanently. Download takes you want to keep.");
	await expect(notice.getByText('Install page as app')).toBeHidden();
	await notice.getByText('How to fix this').click();
	await expect(notice).toContainText('Install Plowshare Studio as an app: click the install icon at the right end of the address bar');
	await expect(takes(page).getByTestId('session').first().getByText('Not backed up')).toBeVisible();

	// A later visit: the notice stays, nothing is asked until Record.
	await page.reload();
	await openTakes(page);
	await expect(notice).toBeVisible();
	expect(await persistCalls(page)).toBe(0);
	await page.getByRole('tab', { name: 'Record' }).click();
	await page.getByRole('button', { name: 'Record' }).click();
	await expect.poll(() => persistCalls(page)).toBe(1);
	await page.getByRole('button', { name: 'Cancel' }).click();
});

test('no notice or Not backed up badges once storage is persistent', async ({ page }) => {
	await page.addInitScript(() => {
		navigator.storage.persisted = async () => true;
		navigator.storage.persist = async () => true;
	});
	await page.goto('/');
	await seedTake(page, { title: 'Episode 1', createdAt: new Date(2026, 10, 2).toISOString(), segments: [{ extension: 'mp4', bytes: 1000, durationUs: 60_000_000 }] });
	await openTakes(page);
	const take = takes(page).getByTestId('session');
	await expect(take).toHaveAttribute('data-backed-up', 'false');
	await expect(take.getByText('Not backed up')).toBeHidden();
	await expect(page.getByTestId('persistence-notice')).toBeHidden();
});

test('Firefox: allowing persistent storage keeps recordings, and blocking it shows how to fix it', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName !== 'firefox', 'Uses Firefox’s persistent-storage permission');
	test.setTimeout(90_000);
	for (const [setting, allowed] of [[1, true], [2, false]] as const) {
		const browser = await playwright.firefox.launch({
			firefoxUserPrefs: { ...testInfo.project.use.launchOptions?.firefoxUserPrefs, 'permissions.default.persistent-storage': setting }
		});
		try {
			const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
			await page.goto('/');
			await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
			await recordTake(page, 2);
			expect(await page.evaluate(() => navigator.storage.persisted())).toBe(allowed);
			await openTakes(page);
			const take = takes(page).getByTestId('session').first();
			const notice = page.getByTestId('persistence-notice');
			if (allowed) {
				await expect(take.getByText('Not backed up')).toBeHidden();
				await expect(notice).toBeHidden();
			} else {
				await expect(take.getByText('Not backed up')).toBeVisible();
				await notice.getByText('How to fix this').click();
				await expect(notice).toContainText('When Firefox asks whether Plowshare Studio may store data in persistent storage, choose Allow.');
				await expect(notice).toContainText('click the × next to Store Data in Persistent Storage');
			}
		} finally {
			await browser.close();
		}
	}
});

test('Chrome: once persistence is granted (as for an installed app), no badges', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium', 'Grants Chrome’s durable-storage permission');
	test.setTimeout(60_000);
	// A normal profile: Chrome never persists Playwright's off-the-record contexts.
	const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('profile'), {
		args: testInfo.project.use.launchOptions?.args,
		baseURL: testInfo.project.use.baseURL
	});
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto('/');
		const cdp = await context.newCDPSession(page);
		await cdp.send('Browser.grantPermissions', { permissions: ['durableStorage'], origin: new URL(page.url()).origin });
		await recordTake(page, 2);
		expect(await page.evaluate(() => navigator.storage.persisted())).toBe(true);
		await openTakes(page);
		const take = takes(page).getByTestId('session').first();
		await expect(take).toHaveAttribute('data-backed-up', 'false');
		await expect(take.getByText('Not backed up')).toBeHidden();
		await expect(page.getByTestId('persistence-notice')).toBeHidden();
	} finally {
		await context.close();
	}
});

test('passes Chrome’s installability checks', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Installing is for Chrome and Edge');
	await page.goto('/');
	const cdp = await page.context().newCDPSession(page);
	const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
	expect(installabilityErrors).toEqual([]);
	const { errors, data } = await cdp.send('Page.getAppManifest');
	expect(errors).toEqual([]);
	const manifest = JSON.parse(data!);
	expect(manifest).toMatchObject({ name: 'Plowshare Studio', display: 'standalone', start_url: '/' });
	// Every icon it lists is served.
	for (const icon of manifest.icons as { src: string }[]) {
		expect((await page.request.get(icon.src)).ok(), icon.src).toBe(true);
	}
});
