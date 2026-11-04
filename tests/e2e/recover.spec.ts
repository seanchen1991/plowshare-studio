// Crash recovery: kill the browser process (not just the page) mid-take,
// relaunch it on the same profile, and Recover. Runs in Chrome and Firefox.

import { execFileSync } from 'node:child_process';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fixtureSpec as s } from '../fixtures/spec.ts';
import { readOpfsJson, saveOpfsFile } from '../helpers/app.ts';
import { detectBeeps } from '../helpers/beeps.ts';
import { useFixtureMedia } from '../helpers/fake-media.ts';
import { decodeAudio, probeDurationSeconds } from '../helpers/media-file.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

const seconds = 15;

test.describe.configure({ timeout: 150_000 });

let launch: () => Promise<BrowserContext>;
let profile: string;

test.beforeEach(async ({ playwright, browserName }, testInfo) => {
	profile = testInfo.outputPath('profile');
	const { launchOptions, baseURL } = testInfo.project.use;
	launch = async () => {
		const context = await playwright[browserName].launchPersistentContext(profile, { ...launchOptions, baseURL });
		if (browserName === 'firefox') await context.addInitScript(useFixtureMedia, s);
		return context;
	};
});

/** Kills the browser the way a crash would: every process using the profile, at once, with no chance to clean up. */
async function killBrowser(context: BrowserContext) {
	const closed = new Promise((done) => context.on('close', done));
	// No shell: its own command line would name the profile too, and get killed with the browser.
	const pids = execFileSync('pgrep', ['-f', profile], { encoding: 'utf8' }).trim().split('\n').map(Number);
	for (const pid of pids) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// Already gone with its parent.
		}
	}
	await closed;
}

async function elapsedSeconds(page: Page): Promise<number> {
	const [m, sec] = (await page.getByTestId('elapsed').locator('.time').innerText()).split(':').map(Number);
	return m! * 60 + sec!;
}

/** Relaunches, finds the Interrupted take and recovers it. Returns its Session file and the finished file on disk. */
async function relaunchAndRecover(outputPath: (name: string) => string) {
	const context = await launch();
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto('/');
	await expect(page.getByTestId('interrupted-notice')).toHaveText(/A take was cut off when the browser closed/);
	await page.getByRole('button', { name: 'Recover in Takes' }).click();

	const take = page.getByRole('region', { name: 'Takes' }).getByTestId('session');
	await expect(take).toHaveCount(1);
	await expect(take).toHaveAttribute('data-state', 'interrupted');
	await take.getByRole('button', { name: 'Recover' }).click();
	await expect(take).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
	await expect(page.getByTestId('interrupted-notice')).toBeHidden();

	const session = await readOpfsJson<Session>(page, `sessions/${await take.getAttribute('data-session-id')}/session.json`);
	const segment = session.recordings[0]!.segments[0]!;
	const file = outputPath('recovered' + segment.path!.slice(segment.path!.lastIndexOf('.')));
	await saveOpfsFile(page, segment.path!, file);
	return { context, page, take, session, file };
}

test('recovers a take after the browser is killed mid-recording', async ({}, testInfo) => {
	const first = await launch();
	const page = first.pages()[0] ?? (await first.newPage());
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(seconds * 1000);
	const killedAt = await elapsedSeconds(page);
	await killBrowser(first);

	const { context, take, session, file } = await relaunchAndRecover((name) => testInfo.outputPath(name));
	const recording = session.recordings[0]!;
	const segment = recording.segments[0]!;
	expect(recording.state).toBe('ready');
	expect(segment.rawPath).toBeNull();

	// What was saved against what was captured: only the last chunk or so is lost.
	const recoveredSeconds = segment.durationUs! / 1e6;
	const expectedSeconds = recording.recovery!.expectedUs / 1e6;
	testInfo.annotations.push({ type: 'recovered', description: `${recoveredSeconds} of ${expectedSeconds} s (elapsed ${killedAt} s)` });
	expect(Math.abs(expectedSeconds - killedAt)).toBeLessThan(2);
	expect(expectedSeconds - recoveredSeconds).toBeGreaterThanOrEqual(-0.5);
	expect(expectedSeconds - recoveredSeconds).toBeLessThan(3.5);
	await expect(take.getByTestId('recovered')).toHaveText(/^Recovered 0:\d\d of about 0:\d\d$/);

	// The file: seekable, the right length, and a beep every second right up to its end.
	const duration = probeDurationSeconds(file);
	expect(Math.abs(duration - recoveredSeconds)).toBeLessThan(0.5);
	const sampleRate = 8000;
	const beeps = detectBeeps(decodeAudio(file, sampleRate), sampleRate);
	expect(beeps.length).toBeGreaterThanOrEqual(Math.floor(duration) - 1);
	expect(beeps[0]!.timeSeconds).toBeLessThan(1.5);
	expect(duration - beeps.at(-1)!.timeSeconds).toBeLessThan(1.5);
	for (let i = 1; i < beeps.length; i++) {
		expect(Math.abs(beeps[i]!.timeSeconds - beeps[i - 1]!.timeSeconds - s.beepIntervalSeconds)).toBeLessThan(0.1);
	}

	await take.getByRole('button', { name: 'Play' }).click();
	const seeked = await take.getByTestId('player').evaluate(async (video: HTMLVideoElement) => {
		if (video.readyState < 1) await new Promise((done) => video.addEventListener('loadedmetadata', done, { once: true }));
		video.currentTime = 8;
		await new Promise((done) => video.addEventListener('seeked', done, { once: true }));
		return video.currentTime;
	});
	expect(Math.abs(seeked - 8)).toBeLessThan(0.5);
	await context.close();
});

test('recovers a take after the browser is killed while Finalizing', async ({}, testInfo) => {
	const first = await launch();
	// Hold Finalizing at its start: the finalize worker's script never loads.
	await first.route('**/finalize.worker*', () => {});
	const page = first.pages()[0] ?? (await first.newPage());
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(6000);
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'finalizing');
	await page.waitForTimeout(1000);
	await killBrowser(first);

	const { context, session, file } = await relaunchAndRecover((name) => testInfo.outputPath(name));
	const segment = session.recordings[0]!.segments[0]!;
	// Stopped cleanly before the crash, so nothing at all is lost.
	expect(Math.abs(segment.durationUs! - session.recordings[0]!.recovery!.expectedUs) / 1e6).toBeLessThan(1);
	expect(Math.abs(probeDurationSeconds(file) - 6)).toBeLessThan(1.5);
	await context.close();
});

test('a take recording in another tab is not taken for an interrupted one', async ({ context }) => {
	const recorder = await context.newPage();
	await recorder.goto('/');
	await recorder.getByRole('button', { name: 'Record' }).click();
	await expect(recorder.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });

	const other = await context.newPage();
	await other.goto('/');
	await other.getByRole('tab', { name: 'Takes' }).click();
	await expect(other.getByTestId('session')).toHaveAttribute('data-state', 'capturing');
	await expect(other.getByTestId('interrupted-notice')).toBeHidden();

	await recorder.getByRole('button', { name: 'Stop' }).click();
	await expect(recorder.getByTestId('session').first()).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
});
