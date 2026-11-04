import { expect, test } from '@playwright/test';

test('switches between Record and Takes; Edit waits for phase 2', async ({ page }) => {
	await page.goto('/');
	const tabs = page.getByRole('tablist', { name: 'Screens' });
	const record = page.getByRole('region', { name: 'Record' });
	const takes = page.getByRole('region', { name: 'Takes' });

	await expect(tabs.getByRole('tab', { name: 'Record' })).toHaveAttribute('aria-selected', 'true');
	await expect(record).toBeVisible();
	await expect(takes).toBeHidden();

	await tabs.getByRole('tab', { name: 'Takes' }).click();
	await expect(takes).toBeVisible();
	await expect(record).toBeHidden();
	await expect(takes.getByText('No takes yet')).toBeVisible();

	await page.keyboard.press('ArrowLeft');
	await expect(record).toBeVisible();
	await expect(tabs.getByRole('tab', { name: 'Record' })).toBeFocused();

	await expect(tabs.getByRole('tab', { name: 'Edit' })).toBeDisabled();
});
