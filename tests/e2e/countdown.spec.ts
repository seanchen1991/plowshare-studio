import { expect, test, type Page } from '@playwright/test';

async function sessionCount(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		try {
			const sessions = await root.getDirectoryHandle('sessions');
			let count = 0;
			for await (const _ of (sessions as unknown as { keys(): AsyncIterable<string> }).keys()) count++;
			return count;
		} catch {
			return 0;
		}
	});
}

test('counts down 3-2-1 with a level check, then captures', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	const countdown = page.getByTestId('countdown');
	await expect(countdown).toHaveText('3');
	expect(await sessionCount(page)).toBe(0);
	// The fixture beeps at -6 dBFS every second: a good level.
	await expect(page.getByTestId('level-meter')).toHaveAttribute('data-status', 'good');
	await expect(page.getByTestId('level-status')).toHaveText('Level good');
	await expect(countdown).toHaveText('1');
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 3000 });
	await expect(countdown).toBeHidden();
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
});

test('cancelling the countdown records nothing', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('countdown')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByTestId('countdown')).toBeHidden();
	await page.waitForTimeout(4000);
	await expect(page.getByTestId('elapsed')).toBeHidden();
	expect(await sessionCount(page)).toBe(0);
	await page.getByRole('tab', { name: 'Takes' }).click();
	await expect(page.getByText('No takes yet')).toBeVisible();
});

test('Space starts the countdown and Esc cancels it', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	await page.locator('body').press('Space');
	await expect(page.getByTestId('countdown')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('countdown')).toBeHidden();
	await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
	await page.waitForTimeout(3500);
	expect(await sessionCount(page)).toBe(0);
});
