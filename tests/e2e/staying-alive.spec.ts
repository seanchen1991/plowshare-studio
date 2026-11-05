// The screen stays awake during a take, and leaving the page while a take is
// Capturing or Finalizing asks first. Re-acquiring the Wake Lock when the tab
// comes back is unit-tested (wake-lock.test.ts): Playwright can't hide a tab.

import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ context, browserName }) => {
	if (browserName === 'chromium') await context.grantPermissions(['screen-wake-lock']);
	// Keep the Wake Lock sentinels the app is given, to see which are still held.
	await context.addInitScript(() => {
		const sentinels: WakeLockSentinel[] = [];
		(window as unknown as { heldWakeLocks: () => number }).heldWakeLocks = () => sentinels.filter((s) => !s.released).length;
		const request = navigator.wakeLock.request.bind(navigator.wakeLock);
		navigator.wakeLock.request = async (type) => {
			const sentinel = await request(type);
			sentinels.push(sentinel);
			return sentinel;
		};
	});
});

const heldWakeLocks = (page: Page) => page.evaluate(() => (window as unknown as { heldWakeLocks: () => number }).heldWakeLocks());

/** Tries to close the page as a user would; returns whether the browser asked first. The page stays open if it did. */
async function closeAsks(page: Page): Promise<boolean> {
	let asked = false;
	page.once('dialog', async (dialog) => {
		asked = dialog.type() === 'beforeunload';
		await dialog.dismiss();
	});
	await page.close({ runBeforeUnload: true });
	await page.waitForTimeout(500);
	return asked && !page.isClosed();
}

test('holds a screen Wake Lock while capturing, and asks before leaving', async ({ page }) => {
	await page.goto('/');
	expect(await heldWakeLocks(page)).toBe(0);
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
	await expect.poll(() => heldWakeLocks(page)).toBe(1);
	expect(await closeAsks(page)).toBe(true);

	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
	expect(await heldWakeLocks(page)).toBe(0);
	// Nothing is in progress, so the page closes without asking.
	await page.close({ runBeforeUnload: true });
	await expect.poll(() => page.isClosed()).toBe(true);
});

test('asks before leaving while a take is Finalizing', async ({ page, context }) => {
	// Hold Finalizing at its start: the finalize worker's script never loads.
	await context.route('**/finalize.worker*', () => {});
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'finalizing');
	expect(await heldWakeLocks(page)).toBe(0);
	expect(await closeAsks(page)).toBe(true);
});

test('leaves without asking when nothing is recording', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Takes' }).click();
	await page.close({ runBeforeUnload: true });
	await expect.poll(() => page.isClosed()).toBe(true);
});
