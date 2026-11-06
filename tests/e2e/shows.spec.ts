// Shows: creating one from the Record screen, the next take joining it, and
// managing Shows in Takes (filter, rename, move a take, delete).

import { expect, test, type Locator, type Page } from '@playwright/test';
import { readOpfsJson, recordTake, seedTake } from '../helpers/app.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';
import type { ShowsFile } from '../../src/lib/storage/show-file.ts';

const recordRegion = (page: Page) => page.getByRole('region', { name: 'Record' });
const takesRegion = (page: Page) => page.getByRole('region', { name: 'Takes' });
// By role, so the closed dialogs' pickers don't count.
const showPicker = (within: Locator) => within.getByRole('combobox', { name: 'Show', exact: true });

async function newShow(page: Page, picker: Locator, name: string) {
	await picker.selectOption({ label: 'New show…' });
	const dialog = page.getByRole('dialog', { name: 'New show' });
	await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(dialog).toBeHidden();
}

test('a Show made on the Record screen holds the next takes, and is remembered after a reload', async ({ page }) => {
	test.setTimeout(60_000);
	await page.goto('/');
	const picker = showPicker(recordRegion(page));
	await expect(picker).toHaveValue('');
	await newShow(page, picker, '  Tilling Our Commons ');
	await expect(picker.locator('option:checked')).toHaveText('Tilling Our Commons');

	const first = await recordTake(page, 2);
	const shows = (await readOpfsJson<ShowsFile>(page, 'shows.json')).shows;
	expect(shows.map((s) => s.name)).toEqual(['Tilling Our Commons']);
	expect(first.showId).toBe(shows[0]!.id);
	await expect(recordRegion(page).getByTestId('take-details')).toContainText('Tilling Our Commons');

	await page.reload();
	await expect(picker.locator('option:checked')).toHaveText('Tilling Our Commons');
	expect((await recordTake(page, 2)).showId).toBe(shows[0]!.id);

	// None is remembered too.
	await picker.selectOption({ label: 'No show' });
	await page.reload();
	await expect(picker).toHaveValue('');
	expect((await recordTake(page, 2)).showId).toBeNull();
});

test('cancelling New show keeps the Show already chosen', async ({ page }) => {
	await page.goto('/');
	const picker = showPicker(recordRegion(page));
	await newShow(page, picker, 'Field Notes');
	await picker.selectOption({ label: 'New show…' });
	const dialog = page.getByRole('dialog', { name: 'New show' });
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(picker.locator('option:checked')).toHaveText('Field Notes');
});

test('Show names must be non-empty and unique, ignoring case', async ({ page }) => {
	await page.goto('/');
	const picker = showPicker(takesRegion(page));
	await page.getByRole('tab', { name: 'Takes' }).click();
	await newShow(page, picker, 'Tilling Our Commons');

	await picker.selectOption({ label: 'New show…' });
	const dialog = page.getByRole('dialog', { name: 'New show' });
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(dialog.getByRole('alert')).toHaveText('Give the show a name.');
	await dialog.getByRole('textbox', { name: 'Name' }).fill('tilling our commons');
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(dialog.getByRole('alert')).toHaveText("There's already a show called “Tilling Our Commons”.");
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	expect((await readOpfsJson<ShowsFile>(page, 'shows.json')).shows).toHaveLength(1);
});

test('Takes filters by Show, renames a Show, moves a take, and deleting a Show keeps its takes', async ({ page }) => {
	await page.goto('/');
	const one = await seedTake(page, { title: 'Episode 1', createdAt: new Date(2026, 10, 2).toISOString(), segments: [{ extension: 'mp4', bytes: 1000, durationUs: 60_000_000 }] });
	const two = await seedTake(page, { title: 'Episode 2', createdAt: new Date(2026, 10, 3).toISOString(), segments: [{ extension: 'mp4', bytes: 1000, durationUs: 60_000_000 }] });
	await page.getByRole('tab', { name: 'Takes' }).click();
	const takes = takesRegion(page);
	const filter = showPicker(takes);
	const row = (id: string) => takes.locator(`[data-session-id="${id}"]`);

	// Creating a Show from the filter shows its (empty) list.
	await newShow(page, filter, 'Tilling Our Commons');
	await expect(takes.getByText('No takes in this show yet.')).toBeVisible();

	// Move Episode 1 into it.
	await filter.selectOption({ label: 'All takes' });
	await row(one.id).getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Move to show…' }).click();
	const move = page.getByRole('dialog', { name: 'Move “Episode 1” to' });
	await showPicker(move).selectOption({ label: 'Tilling Our Commons' });
	await move.getByRole('button', { name: 'Move' }).click();
	await expect(row(one.id).getByTestId('take-details')).toContainText('Tilling Our Commons');
	await expect(row(two.id).getByTestId('take-details')).not.toContainText('Tilling Our Commons');

	await filter.selectOption({ label: 'Tilling Our Commons' });
	await expect(takes.getByTestId('session')).toHaveCount(1);
	await expect(row(one.id)).toBeVisible();
	await filter.selectOption({ label: 'No show' });
	await expect(takes.getByTestId('session')).toHaveCount(1);
	await expect(row(two.id)).toBeVisible();

	// Rename: the take follows.
	await filter.selectOption({ label: 'Tilling Our Commons' });
	await takes.getByRole('button', { name: 'Show actions' }).click();
	await page.getByRole('button', { name: 'Rename show…' }).click();
	const rename = page.getByRole('dialog', { name: 'Rename “Tilling Our Commons”' });
	await expect(rename.getByRole('textbox', { name: 'Name' })).toHaveValue('Tilling Our Commons');
	await rename.getByRole('textbox', { name: 'Name' }).fill('Tilling the Commons');
	await rename.getByRole('button', { name: 'Rename' }).click();
	await expect(filter.locator('option:checked')).toHaveText('Tilling the Commons');
	await expect(row(one.id).getByTestId('take-details')).toContainText('Tilling the Commons');

	// Delete: the take stays, in no Show, and the list goes back to all takes.
	await takes.getByRole('button', { name: 'Show actions' }).click();
	await page.getByRole('button', { name: 'Delete show…' }).click();
	const confirm = page.getByRole('dialog', { name: 'Delete “Tilling the Commons”?' });
	await expect(confirm).toContainText('Its take is kept, in no show.');
	await confirm.getByRole('button', { name: 'Delete show' }).click();
	await expect(filter).toHaveValue('all');
	await expect(takes.getByTestId('session')).toHaveCount(2);
	await expect(row(one.id).getByTestId('take-details')).not.toContainText('Tilling');
	expect((await readOpfsJson<Session>(page, `sessions/${one.id}/session.json`)).showId).toBeNull();
	expect((await readOpfsJson<ShowsFile>(page, 'shows.json')).shows).toEqual([]);

	// Survives a reload.
	await page.reload();
	await page.getByRole('tab', { name: 'Takes' }).click();
	await expect(takes.getByTestId('session')).toHaveCount(2);
	await expect(filter.locator('option')).toHaveText(['All takes', 'New show…']);
});
