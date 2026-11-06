// Walks through every screen and state and photographs it at three widths.
// Live states (the camera preview, the countdown, a take running) are only
// photographed; the rest are also compared with saved screenshots, so an
// unintended change to how a screen looks fails. See playwright.review.config.ts.

import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { seedTake } from '../helpers/app.ts';

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
		async function shot(page: Page, testInfo: TestInfo, name: string, { compare = false } = {}) {
			const dir = `test-results-review/gallery/${testInfo.project.name}/${size.name}`;
			mkdirSync(dir, { recursive: true });
			await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: 'disabled' });
			if (compare && process.platform === 'darwin') {
				await expect(page).toHaveScreenshot(`${size.name}-${name}.png`, { fullPage: true, animations: 'disabled' });
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

		test('Record screen when the camera and mic are blocked', async ({ page }, testInfo) => {
			await page.addInitScript(() => {
				navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
			});
			await page.goto('/');
			await expect(page.getByTestId('device-problem')).toBeVisible();
			await shot(page, testInfo, 'record-5-blocked', { compare: true });
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
