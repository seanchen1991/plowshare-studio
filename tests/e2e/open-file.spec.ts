// Open a file…: a recording from disk is copied in as a new Ready take, kept
// as it is when it's MP4 or WebM and remuxed otherwise, with its settings and
// length read from the file and its title from the file name. Storage is
// checked first, and files it can't use get a plain message. Chrome and Firefox.

import { execFileSync } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fixtureFiles, fixtureSpec } from '../fixtures/spec.ts';
import { listOpfs, readOpfsJson, recordTake, saveOpfsFile } from '../helpers/app.ts';
import { useFixtureMedia } from '../helpers/fake-media.ts';
import { probeDurationSeconds, probeStreams } from '../helpers/media-file.ts';
import type { Project } from '../../src/lib/storage/project-file.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

test.beforeEach(async ({ context, browserName }) => {
	if (browserName === 'firefox') await context.addInitScript(useFixtureMedia, fixtureSpec);
	// estimate() reports `window.testQuota` as the quota once a test sets it.
	await context.addInitScript(() => {
		const estimate = navigator.storage.estimate.bind(navigator.storage);
		navigator.storage.estimate = async () => {
			const real = await estimate();
			const quota = (window as unknown as { testQuota?: number }).testQuota;
			return quota === undefined ? real : { ...real, quota };
		};
	});
});

/** The Session ids in OPFS. */
async function sessionIds(page: Page): Promise<string[]> {
	const files = await listOpfs(page, 'sessions');
	return [...new Set(Object.keys(files).map((path) => path.split('/')[0]!))].sort();
}

/** The takes listed in Takes. */
const listedIds = (page: Page) =>
	page.getByRole('region', { name: 'Takes' }).getByTestId('session').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.sessionId!));

/** Opens a file from Takes and returns the new take's Session, once it's listed. */
async function openFile(page: Page, file: string): Promise<Session> {
	await page.getByRole('tab', { name: 'Takes' }).click();
	const before = await listedIds(page);
	await page.getByRole('region', { name: 'Takes' }).getByTestId('open-file').setInputFiles(file);
	await expect.poll(async () => (await listedIds(page)).length, { timeout: 60_000 }).toBe(before.length + 1);
	const id = (await listedIds(page)).find((s) => !before.includes(s))!;
	await expect(page.locator(`[data-session-id="${id}"]`)).toHaveAttribute('data-state', 'ready');
	return readOpfsJson<Session>(page, `sessions/${id}/session.json`);
}

/** The take's one Segment, saved to disk. */
async function savedSegment(page: Page, session: Session, file: string): Promise<string> {
	await saveOpfsFile(page, session.recordings[0]!.segments[0]!.path!, file);
	return file;
}

test('opens the fixture, a downloaded take and a file in another container as Ready takes', async ({ page }, testInfo) => {
	test.setTimeout(180_000);
	await page.goto('/');

	// A downloaded take (MP4 in Chrome, WebM in Firefox): kept byte for byte, with the same settings and length.
	const recorded = await recordTake(page, 4);
	const download = await savedSegment(page, recorded, testInfo.outputPath(`My downloaded take.${recorded.recordings[0]!.segments[0]!.path!.split('.').at(-1)}`));
	const reopened = await openFile(page, download);
	const recording = reopened.recordings[0]!;
	expect(reopened.title).toBe('My downloaded take');
	expect(recording.state).toBe('ready');
	expect(recording.participant.role).toBe('host');
	expect(recording.segments).toHaveLength(1);
	expect(recording.segments[0]!.downloaded).toBe(true);
	expect(recording.video).toMatchObject({ codec: recorded.recordings[0]!.video!.codec, width: recorded.recordings[0]!.video!.width, height: recorded.recordings[0]!.video!.height });
	expect(recording.video!.fps).toBeGreaterThan(10);
	expect(recording.audio).toMatchObject({ codec: 'opus', channels: recorded.recordings[0]!.audio.channels });
	expect(Math.abs(recording.segments[0]!.durationUs! - recorded.recordings[0]!.segments[0]!.durationUs!)).toBeLessThan(100_000);
	const copy = await savedSegment(page, reopened, testInfo.outputPath('copy'));
	expect(statSync(copy).size).toBe(statSync(download).size);

	// The fixture's audio (WAV): remuxed to WebM with Opus, its length from the file.
	const fixture = await openFile(page, fixtureFiles.audio);
	expect(fixture.title).toBe('fixture');
	expect(fixture.recordings[0]!.video).toBeNull();
	expect(fixture.recordings[0]!.audio).toMatchObject({ codec: 'opus', channels: 1 });
	expect(fixture.recordings[0]!.segments[0]!.path).toMatch(/\.webm$/);
	expect(Math.abs(fixture.recordings[0]!.segments[0]!.durationUs! / 1e6 - fixtureSpec.loopSeconds)).toBeLessThan(0.1);
	const fixtureCopy = await savedSegment(page, fixture, testInfo.outputPath('fixture.webm'));
	expect(probeStreams(fixtureCopy).map((s) => s.codec_name)).toEqual(['opus']);

	// H.264 and AAC in Matroska: remuxed to MP4, the streams copied as they are.
	const mkv = testInfo.outputPath('Interview with Sam.mkv');
	execFileSync('ffmpeg', [
		'-v', 'error', '-y',
		'-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
		'-i', fixtureFiles.audio,
		'-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mkv
	]);
	const remuxed = await openFile(page, mkv);
	expect(remuxed.title).toBe('Interview with Sam');
	expect(remuxed.recordings[0]!.video).toMatchObject({ codec: 'avc', width: 640, height: 360, fps: 25 });
	expect(remuxed.recordings[0]!.audio.codec).toBe('aac');
	expect(remuxed.recordings[0]!.segments[0]!.path).toMatch(/\.mp4$/);
	const remuxedCopy = await savedSegment(page, remuxed, testInfo.outputPath('remuxed.mp4'));
	expect(probeStreams(remuxedCopy).map((s) => s.codec_name)).toEqual(['h264', 'aac']);
	expect(Math.abs(probeDurationSeconds(remuxedCopy) - 5)).toBeLessThan(0.2);

	// It edits like any take: the waveform draws and the picture shows.
	await page.locator(`[data-session-id="${remuxed.id}"]`).getByRole('button', { name: 'Edit' }).click();
	await expect(page.getByTestId('editor')).toBeVisible();
	await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'segment');
	await expect
		.poll(() => page.getByTestId('lane').locator('canvas').evaluate((c: HTMLCanvasElement) => {
			const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
			for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) return true;
			return false;
		}), { timeout: 30_000 })
		.toBe(true);
	await expect.poll(() => page.getByTestId('editor-canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBe(640);
});

test('refuses a file it can’t read, one with no sound, and one that won’t fit, copying nothing', async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	await page.goto('/');
	await page.getByRole('tab', { name: 'Takes' }).click();
	const before = await sessionIds(page);
	const problem = page.getByTestId('open-problem');

	const notes = testInfo.outputPath('notes.mp4');
	writeFileSync(notes, 'Not a video at all, just some notes.\n'.repeat(100));
	await page.getByTestId('open-file').setInputFiles(notes);
	await expect(problem).toHaveText('Couldn’t open “notes.mp4”: it isn’t a video or audio file Plowshare Studio can read. MP4 and WebM files work best.'.replaceAll('’', "'"));

	const silent = testInfo.outputPath('silent.mp4');
	execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', silent]);
	await page.getByTestId('open-file').setInputFiles(silent);
	await expect(problem).toHaveText("Couldn't open “silent.mp4”: it has no sound, so there's nothing to edit.");

	// Room for less than the fixture's 5.8 MB.
	const { usage } = (await page.evaluate(() => navigator.storage.estimate())) as { usage: number };
	await page.evaluate((quota) => ((window as unknown as { testQuota: number }).testQuota = quota), usage + 500_000_000 + 1_000_000);
	await page.getByTestId('open-file').setInputFiles(fixtureFiles.audio);
	await expect(problem).toContainText('Not enough room to open “fixture.wav”: it needs 6 MB, and there\'s room for 1 MB.');
	await expect(problem).toContainText('free up space on this computer');

	expect(await sessionIds(page)).toEqual(before);
});

test('Open a file… in the editor’s Add takes adds the new take to the Project', async ({ page }) => {
	test.setTimeout(90_000);
	await page.goto('/');
	const take = await recordTake(page, 3);
	await page.getByTestId('session').first().getByRole('button', { name: 'Edit' }).click();
	const id = (await page.getByTestId('editor').getAttribute('data-project-id'))!;
	await page.getByRole('button', { name: 'Add takes' }).click();
	await page.getByRole('dialog').getByTestId('open-file').setInputFiles(fixtureFiles.audio);
	await expect(page.getByTestId('project-take')).toHaveCount(2);
	await expect(page.getByTestId('project-take').nth(1)).toContainText('fixture');
	await expect.poll(async () => (await readOpfsJson<Project>(page, `projects/${id}/project.json`)).sessions.length).toBe(2);
	expect((await readOpfsJson<Project>(page, `projects/${id}/project.json`)).sessions[0]!.sessionId).toBe(take.id);
	// And it's in Takes like any other.
	await page.getByRole('tab', { name: 'Takes' }).click();
	await expect(page.getByRole('region', { name: 'Takes' }).getByTestId('take-title').filter({ hasText: 'fixture' })).toBeVisible();
});
