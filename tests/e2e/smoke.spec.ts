import { expect, test } from '@playwright/test';

test('loads the home screen in a supported browser', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Plowshare Studio' })).toBeVisible();
	await expect(page.getByTestId('home')).toBeVisible();
});

test('turns Safari away with a clear message', async ({ browser }) => {
	const context = await browser.newContext({
		userAgent:
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15'
	});
	const page = await context.newPage();
	await page.goto('/');
	await expect(page.getByTestId('unsupported')).toContainText('Please use Chrome, Edge or Firefox');
	await context.close();
});
