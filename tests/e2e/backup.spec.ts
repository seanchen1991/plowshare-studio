// The Backup folder: Ready takes copied into a folder per Show. Playwright
// can't answer Chrome's folder picker, so it hands back a folder in the site's
// own storage ("podcasts"), which has the same API; picking a real folder is
// checked by hand. Firefox downloads each take instead.

import { expect, test, type Page } from '@playwright/test';
import { listOpfs, readOpfsJson, recordTake, seedShows, seedTake } from '../helpers/app.ts';
import { localDate } from '../../src/lib/storage/download-name.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';
import type { ShowsFile } from '../../src/lib/storage/show-file.ts';

const today = () => localDate(new Date());
const takes = (page: Page) => page.getByRole('region', { name: 'Takes' });
const backupLine = (page: Page) => takes(page).getByTestId('backup');

/** Stands in for the folder picker: a folder named "podcasts" in OPFS. */
async function stubPicker(page: Page) {
	await page.addInitScript(() => {
		(window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
			(await navigator.storage.getDirectory()).getDirectoryHandle('podcasts', { create: true });
	});
}

async function newShowOnRecord(page: Page, name: string) {
	await page.getByRole('region', { name: 'Record' }).getByRole('combobox', { name: 'Show', exact: true }).selectOption({ label: 'New show…' });
	const dialog = page.getByRole('dialog', { name: 'New show' });
	await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(dialog).toBeHidden();
}

test.describe('Chrome and Edge', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'The Backup folder needs the File System Access API');

	test('offers the folder, makes a folder per Show, and copies each Ready take into it', async ({ page }) => {
		test.setTimeout(90_000);
		await stubPicker(page);
		await page.goto('/');
		const offer = page.getByTestId('backup-offer');
		await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
		// Nothing to back up yet.
		await expect(offer).toBeHidden();

		await newShowOnRecord(page, 'Tilling Our Commons');
		await expect(offer).toContainText('Keep a copy of every take in a folder on this computer');
		await offer.getByRole('button', { name: 'Choose folder…' }).click();
		await expect(offer).toBeHidden();
		// The Show's folder is made straight away, marked as ours.
		await expect.poll(() => listOpfs(page, 'podcasts/tilling-our-commons')).toHaveProperty(['.plowshare-show']);

		const take = await recordTake(page, 2);
		const name = `${today()} Take 1.${take.recordings[0]!.segments[0]!.path!.split('.').pop()}`;
		const size = (await listOpfs(page, `sessions/${take.id}/rec_01`))[take.recordings[0]!.segments[0]!.path!.split('/').pop()!];
		await expect.poll(() => listOpfs(page, 'podcasts/tilling-our-commons')).toHaveProperty([name], size);
		await page.getByRole('tab', { name: 'Takes' }).click();
		await expect(takes(page).getByTestId('session')).toHaveAttribute('data-backed-up', 'true');
		expect((await readOpfsJson<Session>(page, `sessions/${take.id}/session.json`)).recordings[0]!.segments[0]!.copied).toBe(true);
		await expect(backupLine(page)).toHaveText(/^Backing up to “podcasts”\.\s*Change folder…\s*Turn off$/);

		// A take in no Show goes at the top of the Backup folder.
		await page.getByRole('tab', { name: 'Record' }).click();
		await page.getByRole('region', { name: 'Record' }).getByRole('combobox', { name: 'Show', exact: true }).selectOption({ label: 'No show' });
		await recordTake(page, 2);
		await expect.poll(async () => Object.keys(await listOpfs(page, 'podcasts')).sort()).toEqual([`${today()} Take 2.${name.split('.').pop()}`, 'tilling-our-commons']);

		// The choice survives a reload, and a new Show gets its folder without asking.
		await page.reload();
		await expect(page.getByTestId('backup-offer')).toBeHidden();
		await newShowOnRecord(page, 'Field Notes');
		await expect.poll(() => listOpfs(page, 'podcasts/field-notes')).toHaveProperty(['.plowshare-show']);
	});

	test('copies takes recorded before the folder was chosen; keeps folders through renames; avoids clashes', async ({ page }) => {
		await stubPicker(page);
		await page.goto('/');
		// Something not ours already has the first Show's folder name.
		await page.evaluate(async () => {
			const podcasts = await (await navigator.storage.getDirectory()).getDirectoryHandle('podcasts', { create: true });
			const other = await podcasts.getDirectoryHandle('tilling-our-commons', { create: true });
			await (await other.getFileHandle('notes.txt', { create: true })).createWritable().then((w) => w.close());
		});
		const [tilling, tilling2] = await seedShows(page, ['Tilling Our Commons', 'Tilling our commons!']);
		const segments = [
			{ extension: 'mp4', bytes: 300_000, durationUs: 600_000_000 },
			{ extension: 'mp4', bytes: 200_000, durationUs: 60_000_000 }
		];
		await seedTake(page, { title: 'Episode 1', createdAt: new Date(2026, 10, 2).toISOString(), segments, adjust: (s) => void (s.showId = tilling!.id) });
		await seedTake(page, { title: 'Episode 1', createdAt: new Date(2026, 10, 3).toISOString(), segments: segments.slice(0, 1), adjust: (s) => void (s.showId = tilling2!.id) });

		await page.getByRole('tab', { name: 'Takes' }).click();
		await expect(backupLine(page)).toHaveAttribute('data-state', 'none');
		await backupLine(page).getByRole('button', { name: 'Choose folder…' }).click();

		await expect.poll(() => listOpfs(page, 'podcasts/tilling-our-commons-2')).toEqual({
			'.plowshare-show': expect.any(Number),
			'2026-11-02 Episode 1 – part 1 of 2.mp4': 300_000,
			'2026-11-02 Episode 1 – part 2 of 2.mp4': 200_000
		});
		await expect.poll(() => listOpfs(page, 'podcasts/tilling-our-commons-3')).toEqual({
			'.plowshare-show': expect.any(Number),
			'2026-11-03 Episode 1.mp4': 300_000
		});
		expect(await listOpfs(page, 'podcasts/tilling-our-commons')).toEqual({ 'notes.txt': 0 });
		await expect(takes(page).getByTestId('session').first()).toHaveAttribute('data-backed-up', 'true');

		// Renaming keeps the folder.
		await takes(page).getByRole('combobox', { name: 'Show', exact: true }).selectOption({ label: 'Tilling Our Commons' });
		await takes(page).getByRole('button', { name: 'Show actions' }).click();
		await page.getByRole('button', { name: 'Rename show…' }).click();
		const rename = page.getByRole('dialog', { name: /^Rename/ });
		await rename.getByRole('textbox', { name: 'Name' }).fill('The Commons');
		await rename.getByRole('button', { name: 'Rename' }).click();
		await expect(rename).toBeHidden();
		const shows = (await readOpfsJson<ShowsFile>(page, 'shows.json')).shows;
		expect(shows.find((s) => s.id === tilling!.id)).toMatchObject({ name: 'The Commons', folder: 'tilling-our-commons-2' });
		expect(Object.keys(await listOpfs(page, 'podcasts')).sort()).toEqual(['tilling-our-commons', 'tilling-our-commons-2', 'tilling-our-commons-3']);
	});

	test('waits for access when the browser wants it confirmed, and asks when Record is pressed', async ({ page }) => {
		test.setTimeout(60_000);
		await stubPicker(page);
		await page.goto('/');
		await seedTake(page, { title: 'Before', createdAt: new Date(2026, 10, 2).toISOString(), segments: [{ extension: 'mp4', bytes: 1000, durationUs: 60_000_000 }] });
		await page.getByRole('tab', { name: 'Takes' }).click();
		await backupLine(page).getByRole('button', { name: 'Choose folder…' }).click();
		await expect(backupLine(page)).toHaveAttribute('data-state', 'granted');

		// A later visit where the browser wants access confirmed: nothing is asked on load.
		await page.addInitScript(() => {
			const w = window as unknown as { accessAsked: number; accessGranted: boolean };
			w.accessAsked = 0;
			w.accessGranted = false;
			const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
			proto.queryPermission = async () => (w.accessGranted ? 'granted' : 'prompt');
			proto.requestPermission = async () => {
				w.accessAsked++;
				w.accessGranted = true;
				return 'granted';
			};
		});
		await page.reload();
		await page.getByRole('tab', { name: 'Takes' }).click();
		await expect(backupLine(page)).toHaveText(/^Backups to “podcasts” are paused until you allow access\.\s*Allow access$/);
		await page.getByRole('tab', { name: 'Record' }).click();
		const take = await recordTake(page, 2);
		expect(await page.evaluate(() => (window as unknown as { accessAsked: number }).accessAsked)).toBe(1);
		await expect.poll(async () => Object.keys(await listOpfs(page, 'podcasts')).length).toBe(2);
		await page.getByRole('tab', { name: 'Takes' }).click();
		await expect(takes(page).locator(`[data-session-id="${take.id}"]`)).toHaveAttribute('data-backed-up', 'true');
		await expect(backupLine(page)).toHaveAttribute('data-state', 'granted');
	});

	test('Try again on a take asks for access when the browser wants it confirmed', async ({ page }) => {
		await stubPicker(page);
		// Access is granted unless this tab says the browser wants it confirmed again.
		await page.addInitScript(() => {
			const w = window as unknown as { accessAsked: number };
			w.accessAsked = 0;
			const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
			proto.queryPermission = async () => (sessionStorage.getItem('confirm') ? 'prompt' : 'granted');
			proto.requestPermission = async () => {
				w.accessAsked++;
				sessionStorage.removeItem('confirm');
				return 'granted';
			};
		});
		await page.goto('/');
		await page.getByRole('tab', { name: 'Takes' }).click();
		await backupLine(page).getByRole('button', { name: 'Choose folder…' }).click();
		await expect(backupLine(page)).toHaveAttribute('data-state', 'granted');

		// A later visit: a take whose copy failed, and access to confirm.
		await page.evaluate(() => sessionStorage.setItem('confirm', 'yes'));
		await seedTake(page, {
			title: 'Episode 8',
			createdAt: new Date(2026, 10, 2).toISOString(),
			segments: [{ extension: 'mp4', bytes: 1000, durationUs: 60_000_000 }],
			adjust: (s) => void (s.backupError = 'The disk is full')
		});
		await page.getByRole('tab', { name: 'Takes' }).click();
		await expect(backupLine(page)).toHaveAttribute('data-state', 'prompt');
		const take = takes(page).getByTestId('session');
		await take.getByRole('button', { name: 'Try again' }).click();
		await expect(take).toHaveAttribute('data-backed-up', 'true');
		expect(await page.evaluate(() => (window as unknown as { accessAsked: number }).accessAsked)).toBe(1);
		expect(await listOpfs(page, 'podcasts')).toEqual({ '2026-11-02 Episode 8.mp4': 1000 });
	});

	test('a copy that fails is reported on the take, keeps the browser copy, and Try again finishes it', async ({ page }) => {
		await stubPicker(page);
		await page.addInitScript(() => {
			const create = FileSystemFileHandle.prototype.createWritable;
			FileSystemFileHandle.prototype.createWritable = function (this: FileSystemFileHandle, ...args) {
				if ((window as unknown as { failCopies?: boolean }).failCopies && this.name.endsWith('.mp4')) {
					return Promise.reject(new DOMException('The disk is full', 'QuotaExceededError'));
				}
				return create.apply(this, args);
			};
		});
		await page.goto('/');
		const seeded = await seedTake(page, { title: 'Episode 9', createdAt: new Date(2026, 10, 2).toISOString(), segments: [{ extension: 'mp4', bytes: 5000, durationUs: 60_000_000 }] });
		await page.evaluate(() => ((window as unknown as { failCopies: boolean }).failCopies = true));
		await page.getByRole('tab', { name: 'Takes' }).click();
		await backupLine(page).getByRole('button', { name: 'Choose folder…' }).click();

		const take = takes(page).getByTestId('session');
		await expect(take.getByTestId('backup-failed')).toHaveText(
			"There wasn't room to copy this take to the Backup folder. It's still saved in the browser: free up space and try again. Try again"
		);
		await expect(take).toHaveAttribute('data-backed-up', 'false');
		expect(await listOpfs(page, `sessions/${seeded.id}/rec_01`)).toEqual({ 'seg-01.mp4': 5000 });
		expect(await listOpfs(page, 'podcasts')).toEqual({});
		await expect(backupLine(page)).toContainText('1 take not copied yet');

		await page.evaluate(() => ((window as unknown as { failCopies: boolean }).failCopies = false));
		await take.getByRole('button', { name: 'Try again' }).click();
		await expect(take.getByTestId('backup-failed')).toBeHidden();
		await expect(take).toHaveAttribute('data-backed-up', 'true');
		expect(await listOpfs(page, 'podcasts')).toEqual({ '2026-11-02 Episode 9.mp4': 5000 });
	});

	test('Not now stops the offer; Turn off forgets the folder', async ({ page }) => {
		await stubPicker(page);
		await page.goto('/');
		await seedTake(page, { title: 'Episode 1', createdAt: new Date(2026, 10, 2).toISOString(), segments: [{ extension: 'mp4', bytes: 1000, durationUs: 60_000_000 }] });
		await page.getByTestId('backup-offer').getByRole('button', { name: 'Not now' }).click();
		await page.reload();
		await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
		await expect(page.getByTestId('backup-offer')).toBeHidden();

		await page.getByRole('tab', { name: 'Takes' }).click();
		await backupLine(page).getByRole('button', { name: 'Choose folder…' }).click();
		await expect(backupLine(page)).toHaveAttribute('data-state', 'granted');
		await backupLine(page).getByRole('button', { name: 'Turn off' }).click();
		await expect(backupLine(page)).toHaveAttribute('data-state', 'none');
		await page.reload();
		await page.getByRole('tab', { name: 'Takes' }).click();
		await expect(backupLine(page)).toHaveAttribute('data-state', 'none');
	});
});

test('Firefox: downloads each Ready take, named with its Show, once turned on', async ({ page, browserName }) => {
	test.skip(browserName !== 'firefox', 'Firefox has no folder picker');
	test.setTimeout(60_000);
	await page.goto('/');
	await seedShows(page, ['Tilling Our Commons']);
	await page.reload();
	const offer = page.getByTestId('backup-offer');
	await expect(offer).toContainText("Firefox can't save to a folder");
	await offer.getByRole('button', { name: 'Turn on' }).click();
	await page.getByRole('region', { name: 'Record' }).getByRole('combobox', { name: 'Show', exact: true }).selectOption({ label: 'Tilling Our Commons' });

	const downloading = page.waitForEvent('download', { timeout: 60_000 });
	const take = await recordTake(page, 2);
	const download = await downloading;
	expect(download.suggestedFilename()).toBe(`Tilling Our Commons – ${today()} Take 1.webm`);
	await page.getByRole('tab', { name: 'Takes' }).click();
	await expect(takes(page).locator(`[data-session-id="${take.id}"]`)).toHaveAttribute('data-backed-up', 'true');
	await expect(backupLine(page)).toHaveText(/^Each take is downloaded when it's ready\.\s*Turn off$/);
});
