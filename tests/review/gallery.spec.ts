// Walks through every screen and state and photographs it at three widths.
// Live states (the camera preview, the countdown, a take running) are only
// photographed; the rest are also compared with saved screenshots, so an
// unintended change to how a screen looks fails. See playwright.review.config.ts.

import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { glueTakes, opfsFileExists, recordTake, seedShows, seedTake } from '../helpers/app.ts';
import { safetyMarginBytes } from '../../src/lib/storage/time-left.ts';

const widths = [
	{ name: 'laptop', width: 1280, height: 800 },
	{ name: 'small-laptop', width: 1024, height: 700 },
	{ name: 'phone', width: 390, height: 844 }
];

const createdAt = new Date(2026, 10, 2, 18, 30).toISOString();
/** Takes a few minutes apart, so the list's order (newest first) is fixed. */
const at = (n: number) => new Date(2026, 10, 2, 18, 30 + n * 5).toISOString();
const minutes = (n: number) => n * 60_000_000;

for (const size of widths) {
	test.describe(size.name, () => {
		test.use({ viewport: { width: size.width, height: size.height } });

		/** Saves a full-page screenshot to the gallery, and compares it with the saved one when `compare`. */
		async function shot(page: Page, testInfo: TestInfo, name: string, { compare = false, timeLeft = true } = {}) {
			// Shown once the camera is open and storage measured; settled first, so screenshots match.
			if (timeLeft) await expect(page.getByTestId('time-left')).toHaveText(/Room for/);
			const dir = `test-results-review/gallery/${testInfo.project.name}/${size.name}`;
			mkdirSync(dir, { recursive: true });
			await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: 'disabled' });
			if (compare && process.platform === 'darwin') {
				// Recording time left depends on this machine's free space and the camera, so it is left out.
				const hide = await page.addStyleTag({ content: '[data-testid=time-left] { visibility: hidden !important; }' });
				await expect(page).toHaveScreenshot(`${size.name}-${name}.png`, { fullPage: true, animations: 'disabled' });
				await hide.evaluate((style) => (style as HTMLStyleElement).remove());
			}
		}

		test('Record screen', async ({ page }, testInfo) => {
			test.setTimeout(90_000);
			await page.goto('/');
			await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
			await shot(page, testInfo, 'record-1-ready');

			await page.getByRole('button', { name: 'Record' }).click();
			await expect(page.getByTestId('countdown')).toHaveText('2');
			await shot(page, testInfo, 'record-2-countdown');

			await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
			await page.waitForTimeout(2000);
			await shot(page, testInfo, 'record-3-capturing');
			await page.getByRole('button', { name: 'Stop' }).click();
			await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
			await shot(page, testInfo, 'record-4-last-take');
		});

		test('The editor', async ({ page }, testInfo) => {
			test.setTimeout(150_000);
			await page.goto('/');
			// A take with two Segments and a Capture gap between them.
			const session = await glueTakes(page, await recordTake(page, 8), await recordTake(page, 5), 4_000_000, 'Episode 3 – take 2');
			await page.getByRole('tab', { name: 'Takes' }).click();
			await page.locator(`[data-session-id="${session.id}"]`).getByRole('button', { name: 'Edit' }).click();
			const [, second] = session.recordings[0]!.segments;
			// Wait for both Segments' peaks.
			await expect.poll(() => opfsFileExists(page, second!.path!.replace(/\.[^.]+$/, '.peaks')), { timeout: 30_000 }).toBe(true);
			const ruler = page.getByTestId('ruler');
			const box = (await ruler.boundingBox())!;
			await ruler.click({ position: { x: box.width * 0.72, y: box.height / 2 } });
			await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'segment');
			await page.waitForTimeout(500);
			await shot(page, testInfo, 'edit-1-two-segments');

			await ruler.click({ position: { x: box.width * 0.52, y: box.height / 2 } });
			await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'gap');
			await shot(page, testInfo, 'edit-2-in-a-capture-gap');

			// Zoomed all the way in on the second Segment, a few seconds across.
			await ruler.click({ position: { x: box.width * 0.85, y: box.height / 2 } });
			await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'segment');
			const zoomIn = page.getByRole('button', { name: 'Zoom in' });
			while (await zoomIn.isEnabled()) await zoomIn.click();
			await page.waitForTimeout(500);
			await shot(page, testInfo, 'edit-4-zoomed-in');
			while (await page.getByRole('button', { name: 'Zoom out' }).isEnabled()) await page.keyboard.press('-');

			// Two Cuts, one of them across the Capture gap, and a selection about to be cut.
			const lane = page.getByTestId('lane');
			const laneBox = (await lane.boundingBox())!;
			const drag = async (from: number, to: number) => {
				await page.mouse.move(laneBox.x + laneBox.width * from, laneBox.y + laneBox.height / 2);
				await page.mouse.down();
				await page.mouse.move(laneBox.x + laneBox.width * to, laneBox.y + laneBox.height / 2, { steps: 6 });
				await page.mouse.up();
			};
			await drag(0.12, 0.22);
			await page.keyboard.press('Delete');
			await drag(0.42, 0.62);
			await page.keyboard.press('Delete');
			await drag(0.78, 0.86);
			await page.waitForTimeout(300);
			await shot(page, testInfo, 'edit-5-cuts');
			await page.keyboard.press('Escape');

			// An audio-only take.
			await page.getByRole('tab', { name: 'Record' }).click();
			await page.getByRole('combobox', { name: 'Camera' }).selectOption({ label: 'Camera off (audio only)' });
			await recordTake(page, 6);
			await page.getByTestId('session').first().getByRole('button', { name: 'Edit' }).click();
			await expect(page.getByTestId('audio-only')).toBeVisible();
			await page.waitForTimeout(2000);
			await shot(page, testInfo, 'edit-3-audio-only');
		});

		test('Projects', async ({ page }, testInfo) => {
			test.setTimeout(150_000);
			await page.goto('/');
			const titles = ['Interview with Sam – take 1', 'Interview with Sam – take 2', 'Intro'];
			for (const title of titles) {
				const take = await recordTake(page, 4);
				await page.evaluate(
					async ({ id, title }) => {
						const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions')).getDirectoryHandle(id);
						const file = await dir.getFileHandle('session.json');
						const session = JSON.parse(await (await file.getFile()).text());
						const writable = await file.createWritable();
						await writable.write(JSON.stringify({ ...session, title }));
						await writable.close();
					},
					{ id: take.id, title }
				);
			}
			await page.reload();

			// Two takes ticked in Takes, ready to edit together.
			await page.getByRole('tab', { name: 'Takes' }).click();
			const rows = page.getByRole('region', { name: 'Takes' }).getByTestId('session');
			await rows.nth(1).getByRole('checkbox').check();
			await rows.nth(2).getByRole('checkbox').check();
			await shot(page, testInfo, 'projects-1-takes-selected');

			// The editor with three takes end to end, a Cut in the middle one.
			await page.getByRole('button', { name: 'Edit together' }).click();
			await page.getByRole('button', { name: 'Add takes' }).click();
			await page.getByTestId('take-picker').getByRole('checkbox').first().check();
			await shot(page, testInfo, 'projects-2-add-takes');
			await page.getByRole('button', { name: 'Add', exact: true }).click();
			await expect(page.getByTestId('project-take')).toHaveCount(3);
			const lane = page.getByTestId('lane');
			const box = (await lane.boundingBox())!;
			await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2, { steps: 6 });
			await page.mouse.up();
			await page.keyboard.press('Delete');
			await page.waitForTimeout(1500);
			await shot(page, testInfo, 'projects-3-three-takes');

			// The list of Projects, with a solo one too.
			await page.getByRole('tab', { name: 'Takes' }).click();
			await rows.nth(0).getByRole('button', { name: 'Edit' }).click();
			await page.getByRole('button', { name: 'All projects' }).click();
			await expect(page.getByTestId('project')).toHaveCount(2);
			await shot(page, testInfo, 'projects-4-list');
		});

		test('A take paused', async ({ page }, testInfo) => {
			test.setTimeout(90_000);
			await page.goto('/');
			await page.getByRole('button', { name: 'Record' }).click();
			await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
			await page.waitForTimeout(2000);
			// Pauses it the way waking from sleep does: the wall clock jumps ahead.
			await page.evaluate(() => {
				const now = Date.now.bind(Date);
				Date.now = () => now() + 60_000;
			});
			await expect(page.getByTestId('paused-alert')).toBeVisible({ timeout: 5000 });
			await expect(page.getByRole('button', { name: 'Resume' })).toBeEnabled();
			await shot(page, testInfo, 'record-6-paused');
			await page.getByRole('button', { name: 'Resume' }).click();
			await expect(page.getByTestId('countdown')).toHaveText('2');
			await shot(page, testInfo, 'record-7-resuming');
		});

		test('The camera off, for an audio-only take', async ({ page }, testInfo) => {
			test.setTimeout(90_000);
			await page.goto('/');
			await page.getByRole('combobox', { name: 'Camera' }).selectOption({ label: 'Camera off (audio only)' });
			await expect(page.getByTestId('camera-off')).toBeVisible();
			await shot(page, testInfo, 'record-8-camera-off');
			await page.getByRole('button', { name: 'Record' }).click();
			await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
			await page.waitForTimeout(2000);
			await shot(page, testInfo, 'record-9-capturing-audio-only');
			await page.getByRole('button', { name: 'Stop' }).click();
			await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
			await shot(page, testInfo, 'record-10-audio-only-last-take');
		});

		test('Record screen when the camera and mic are blocked', async ({ page }, testInfo) => {
			await page.addInitScript(() => {
				navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
			});
			await page.goto('/');
			await expect(page.getByTestId('device-problem')).toBeVisible();
			await shot(page, testInfo, 'record-5-blocked', { compare: true, timeLeft: false });
		});

		// Seeded files are small (the test browser's storage quota is), so sizes show in MB.
		test('Takes screen', async ({ page }, testInfo) => {
			await page.goto('/');
			await page.getByRole('tab', { name: 'Takes' }).click();
			await shot(page, testInfo, 'takes-1-empty', { compare: true });

			await seedTake(page, { title: 'Episode 3 – solo', createdAt: at(1), segments: [{ extension: 'mp4', bytes: 24_120_000, durationUs: minutes(41) + 12e6 }] });
			await seedTake(page, {
				title: 'Interview with a very long guest name that goes on and on past the edge',
				createdAt: at(2),
				segments: [{ extension: 'webm', bytes: 9_800_000, durationUs: minutes(63), downloaded: true }]
			});
			await seedTake(page, {
				title: 'Episode 2',
				createdAt: at(3),
				segments: [
					{ extension: 'webm', bytes: 11_000_000, durationUs: minutes(22) },
					{ extension: 'webm', bytes: 4_000_000, durationUs: minutes(8) }
				]
			});
			await seedTake(page, {
				title: 'Audio-only check',
				createdAt: at(4),
				segments: [{ extension: 'webm', bytes: 1_200_000, durationUs: minutes(9) }],
				adjust: (session) => void (session.recordings[0]!.video = null)
			});
			await seedTake(page, {
				title: 'Cut off',
				createdAt: at(5),
				segments: [{ extension: 'webm', bytes: 1000, durationUs: minutes(5) }],
				adjust: (session) =>
					void Object.assign(session.recordings[0]!, { state: 'interrupted', recovery: { expectedUs: minutes(5) }, finalizeError: 'the raw recording is empty' })
			});
			await seedTake(page, {
				title: 'Recovered',
				createdAt: at(6),
				segments: [{ extension: 'mp4', bytes: 3_000_000, durationUs: minutes(14) }],
				adjust: (session) => void (session.recordings[0]!.recovery = { expectedUs: minutes(15) })
			});
			await page.getByRole('tab', { name: 'Takes' }).click();
			await expect(page.getByTestId('session')).toHaveCount(6);
			await shot(page, testInfo, 'takes-2-list', { compare: true });

			const parts = page.getByTestId('session').filter({ hasText: 'Episode 2' });
			await parts.getByRole('button', { name: 'Download' }).click();
			await shot(page, testInfo, 'takes-3-parts-menu', { compare: true });
			await page.keyboard.press('Escape');

			const solo = page.getByTestId('session').filter({ hasText: 'Episode 3' });
			await solo.getByRole('button', { name: 'More actions' }).click();
			await shot(page, testInfo, 'takes-4-more-menu', { compare: true });
			await page.getByRole('button', { name: 'Rename' }).click();
			await expect(solo.getByRole('textbox', { name: 'Take name' })).toBeFocused();
			await shot(page, testInfo, 'takes-5-renaming', { compare: true });
			await page.keyboard.press('Escape');

			await solo.getByRole('button', { name: 'More actions' }).click();
			await page.getByRole('button', { name: 'Delete…' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await shot(page, testInfo, 'takes-6-delete-dialog', { compare: true });
		});

		test('Shows', async ({ page }, testInfo) => {
			test.setTimeout(60_000);
			await page.goto('/');
			const [tilling, field] = await seedShows(page, ['Tilling Our Commons', 'Field Notes from a Long and Winding Road']);
			await page.evaluate((id) => localStorage.setItem('plowshare.nextTakeShow', id), tilling!.id);
			const segments = [{ extension: 'mp4', bytes: 2_000_000, durationUs: minutes(20) }];
			await seedTake(page, { title: 'Episode 12', createdAt: at(1), segments, adjust: (s) => void (s.showId = tilling!.id) });
			await seedTake(page, { title: 'Episode 13', createdAt: at(2), segments, adjust: (s) => void (s.showId = tilling!.id) });
			await seedTake(page, { title: 'Walk 4', createdAt: at(3), segments, adjust: (s) => void (s.showId = field!.id) });
			await seedTake(page, { title: 'Mic check', createdAt: at(4), segments });
			await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
			await shot(page, testInfo, 'shows-1-record-for-a-show');

			await page.getByRole('tab', { name: 'Takes' }).click();
			const takes = page.getByRole('region', { name: 'Takes' });
			const filter = takes.getByRole('combobox', { name: 'Show', exact: true });
			await expect(takes.getByTestId('session')).toHaveCount(4);
			await shot(page, testInfo, 'shows-2-all-takes', { compare: true });

			await filter.selectOption({ label: 'Tilling Our Commons' });
			await expect(takes.getByTestId('session')).toHaveCount(2);
			await takes.getByRole('button', { name: 'Show actions' }).click();
			await shot(page, testInfo, 'shows-3-one-show-and-its-menu', { compare: true });
			await page.keyboard.press('Escape');

			await filter.selectOption({ label: 'New show…' });
			const dialog = page.getByRole('dialog', { name: 'New show' });
			await dialog.getByRole('textbox', { name: 'Name' }).fill('tilling our commons');
			await dialog.getByRole('button', { name: 'Create' }).click();
			await expect(dialog.getByRole('alert')).toBeVisible();
			await shot(page, testInfo, 'shows-4-new-show-name-taken', { compare: true });
			await dialog.getByRole('button', { name: 'Cancel' }).click();

			await takes.getByTestId('session').first().getByRole('button', { name: 'More actions' }).click();
			await page.getByRole('button', { name: 'Move to show…' }).click();
			await expect(page.getByRole('dialog', { name: /^Move/ })).toBeVisible();
			await shot(page, testInfo, 'shows-5-move-dialog', { compare: true });
			await page.getByRole('dialog', { name: /^Move/ }).getByRole('button', { name: 'Cancel' }).click();

			await takes.getByRole('button', { name: 'Show actions' }).click();
			await page.getByRole('button', { name: 'Delete show…' }).click();
			await expect(page.getByRole('dialog', { name: /^Delete “Tilling/ })).toBeVisible();
			await shot(page, testInfo, 'shows-6-delete-show-dialog', { compare: true });
		});

		test('Backups', async ({ page, browserName }, testInfo) => {
			test.setTimeout(60_000);
			const chrome = browserName === 'chromium';
			await page.addInitScript(() => {
				const w = window as unknown as Record<string, unknown>;
				if (!('showDirectoryPicker' in window)) return;
				w.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('podcasts', { create: true });
				// Copies fail with a full disk, for the take that shows it.
				const create = FileSystemFileHandle.prototype.createWritable;
				FileSystemFileHandle.prototype.createWritable = function (this: FileSystemFileHandle, ...args) {
					if (this.name.includes('Episode 7')) return Promise.reject(new DOMException('The disk is full', 'QuotaExceededError'));
					return create.apply(this, args);
				};
			});
			await page.goto('/');
			const [tilling] = await seedShows(page, ['Tilling Our Commons']);
			const segments = [{ extension: 'mp4', bytes: 2_000_000, durationUs: minutes(20) }];
			await seedTake(page, { title: 'Episode 6', createdAt: at(1), segments, adjust: (s) => void (s.showId = tilling!.id) });
			await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
			await expect(page.getByTestId('backup-offer')).toBeVisible();
			await shot(page, testInfo, 'backup-1-offer');

			await page.getByRole('tab', { name: 'Takes' }).click();
			const line = page.getByRole('region', { name: 'Takes' }).getByTestId('backup');
			await shot(page, testInfo, 'backup-2-not-on', { compare: true });
			if (!chrome) {
				await line.getByRole('button', { name: "Download each take when it's ready" }).click();
				await shot(page, testInfo, 'backup-3-on', { compare: true });
				return;
			}
			await line.getByRole('button', { name: 'Choose folder…' }).click();
			await expect(page.getByTestId('session')).toHaveAttribute('data-backed-up', 'true');
			await expect(line).toHaveText(/Backing up to “podcasts”\./);
			await shot(page, testInfo, 'backup-3-on', { compare: true });

			await seedTake(page, { title: 'Episode 7', createdAt: at(2), segments, adjust: (s) => void (s.showId = tilling!.id) });
			await page.getByRole('tab', { name: 'Takes' }).click();
			await expect(page.getByTestId('backup-failed')).toBeVisible();
			await expect(line).toContainText('1 take not copied yet');
			await shot(page, testInfo, 'backup-4-copy-failed', { compare: true });

			await page.addInitScript(() => {
				(FileSystemHandle.prototype as unknown as Record<string, unknown>).queryPermission = async () => 'prompt';
			});
			await page.reload();
			await page.getByRole('tab', { name: 'Takes' }).click();
			await expect(line).toContainText('paused until you allow access');
			await shot(page, testInfo, 'backup-5-waiting-for-access', { compare: true });
		});

		test('A take Finalizing', async ({ page, context }, testInfo) => {
			// Hold Finalizing at its start: the finalize worker's script never loads.
			await context.route('**/finalize.worker*', () => {});
			await page.goto('/');
			await page.getByRole('button', { name: 'Record' }).click();
			await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
			await page.getByRole('button', { name: 'Stop' }).click();
			await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'finalizing');
			await shot(page, testInfo, 'record-6-finalizing');
			await page.getByRole('tab', { name: 'Takes' }).click();
			await shot(page, testInfo, 'takes-7-finalizing');
		});

		test('Running out of room', async ({ page }, testInfo) => {
			test.setTimeout(60_000);
			// estimate() reports `window.testQuota` once set, as in tests/e2e/storage.spec.ts.
			await page.addInitScript(() => {
				const estimate = navigator.storage.estimate.bind(navigator.storage);
				navigator.storage.estimate = async () => {
					const quota = (window as unknown as { testQuota?: number }).testQuota;
					return quota === undefined ? estimate() : { ...(await estimate()), quota };
				};
			});
			const leave = async (minutes: number) => {
				const { usage = 0 } = await page.evaluate(() => navigator.storage.estimate());
				const quota = usage * 2 + safetyMarginBytes + minutes * 60 * (3_660_000 / 8) * 2;
				await page.evaluate((q) => ((window as unknown as { testQuota: number }).testQuota = q), quota);
			};
			await page.goto('/');
			await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
			await shot(page, testInfo, 'storage-1-time-left');

			await page.getByRole('button', { name: 'Record' }).click();
			await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
			await leave(4);
			await expect(page.getByTestId('storage-warning')).toBeVisible({ timeout: 10_000 });
			await shot(page, testInfo, 'storage-2-warning');

			const { usage = 0 } = await page.evaluate(() => navigator.storage.estimate());
			await page.evaluate((q) => ((window as unknown as { testQuota: number }).testQuota = q), usage + safetyMarginBytes);
			await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
			await expect(page.getByTestId('storage-problem')).toBeVisible({ timeout: 10_000 });
			await shot(page, testInfo, 'storage-3-stopped-and-refused');
		});

		// Seen after a reload: the take is then Interrupted, and Recover finishes it.
		test('A take that ran out of room while finishing', async ({ page }, testInfo) => {
			await page.goto('/');
			await seedTake(page, {
				title: 'Episode 4',
				createdAt,
				segments: [{ extension: 'webm', bytes: 1000, durationUs: minutes(12) }],
				adjust: (session) => {
					const recording = session.recordings[0]!;
					recording.state = 'finalizing';
					recording.finalizeError = 'The operation failed because it would cause the application to exceed its storage quota.';
					Object.assign(recording.segments[0]!, { path: null, rawPath: `sessions/${session.id}/rec_01/seg-01.raw`, manifestPath: `sessions/${session.id}/rec_01/seg-01.manifest.jsonl` });
				}
			});
			await page.getByRole('tab', { name: 'Takes' }).click();
			await expect(page.getByTestId('interrupted')).toContainText("There wasn't room on this computer to finish this take.");
			await shot(page, testInfo, 'takes-8-no-room-to-finish', { compare: true });
		});

		test('The browser hasn’t agreed to keep recordings', async ({ page }, testInfo) => {
			// Asked on an earlier visit, and refused (as Playwright's contexts always are).
			await page.addInitScript(() => localStorage.setItem('plowshare.persistAsked', 'yes'));
			await page.goto('/');
			await seedTake(page, { title: 'Episode 5', createdAt, segments: [{ extension: 'mp4', bytes: 2_000_000, durationUs: minutes(20) }] });
			await page.getByRole('tab', { name: 'Takes' }).click();
			await page.getByTestId('persistence-notice').getByText('How to fix this').click();
			await shot(page, testInfo, 'takes-9-persistence-notice', { compare: true });
		});

		test('A private window', async ({ page }, testInfo) => {
			await page.addInitScript(() => {
				navigator.storage.getDirectory = () => Promise.reject(new DOMException('Security error when calling GetDirectory', 'SecurityError'));
			});
			await page.goto('/');
			await expect(page.getByTestId('storage-refused')).toBeVisible();
			await shot(page, testInfo, 'storage-4-private-window', { compare: true, timeLeft: false });
		});

		test('A take that couldn’t be recovered automatically', async ({ page }, testInfo) => {
			await page.goto('/');
			// Cut off, with a raw file that isn't a recording: automatic recovery runs once, fails and says so.
			await seedTake(page, {
				title: 'Cut off',
				createdAt,
				segments: [{ extension: 'webm', bytes: 1000, durationUs: minutes(5) }],
				adjust: (session) => {
					const recording = session.recordings[0]!;
					recording.state = 'capturing';
					Object.assign(recording.segments[0]!, { path: null, rawPath: `sessions/${session.id}/rec_01/seg-01.raw`, manifestPath: `sessions/${session.id}/rec_01/seg-01.manifest.jsonl`, durationUs: null });
				}
			});
			await expect(page.getByTestId('recovery-notice')).toContainText("couldn't be recovered automatically", { timeout: 15_000 });
			await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
			await shot(page, testInfo, 'record-7-recovery-failed');
		});
	});
}
