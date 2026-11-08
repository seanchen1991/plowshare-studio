// The editor: Edit on a Ready take opens it in a Project, with a lane per
// Track whose waveform shows the fixture's beeps where they are, and playback
// that follows the playhead across Segments and Capture gaps. Runs in Chrome
// and Firefox.

import { expect, test, type Page } from '@playwright/test';
import { fixtureSpec } from '../fixtures/spec.ts';
import { glueTakes, readOpfsJson, recordTake, saveOpfsFile } from '../helpers/app.ts';
import { detectBeeps } from '../helpers/beeps.ts';
import { useFixtureMedia } from '../helpers/fake-media.ts';
import { decodeAudio } from '../helpers/media-file.ts';
import { peakDb } from '../../src/lib/analysis/peaks.ts';
import type { Project } from '../../src/lib/storage/project-file.ts';
import type { Segment } from '../../src/lib/storage/session-file.ts';

test.beforeEach(async ({ context, browserName }) => {
	if (browserName === 'firefox') await context.addInitScript(useFixtureMedia, fixtureSpec);
});

const peaksPerSecond = 100;

/** A file in OPFS as bytes. */
function readOpfsBytes(page: Page, path: string): Promise<number[]> {
	return page.evaluate(async (path) => {
		let dir = await navigator.storage.getDirectory();
		const parts = path.split('/');
		for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
		return Array.from(new Uint8Array(await (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer()));
	}, path);
}

/** How tall the waveform is drawn around `fraction` of the lane's width (±3 px), as a share of the lane's height. */
function drawnHeight(page: Page, fraction: number, lane = 0): Promise<number> {
	return page.getByTestId('lane').nth(lane).locator('canvas').evaluate((canvas: HTMLCanvasElement, fraction) => {
		const context = canvas.getContext('2d')!;
		const ratio = canvas.width / canvas.clientWidth;
		const centre = Math.round(fraction * canvas.width);
		const from = Math.max(0, centre - Math.round(3 * ratio));
		const columns = Math.min(canvas.width - from, Math.round(7 * ratio));
		const { data } = context.getImageData(from, 0, columns, canvas.height);
		let top = canvas.height;
		let bottom = -1;
		for (let y = 0; y < canvas.height; y++) {
			for (let x = 0; x < columns; x++) {
				if (data[(y * columns + x) * 4 + 3]! > 0) {
					top = Math.min(top, y);
					bottom = Math.max(bottom, y);
				}
			}
		}
		return bottom < 0 ? 0 : (bottom - top + 1) / canvas.height;
	}, fraction);
}

const editorState = (page: Page) =>
	page.evaluate(() => {
		const video = document.querySelector<HTMLVideoElement>('[data-testid="editor-video"]')!;
		return {
			showing: document.querySelector('[data-testid="stage"]')!.getAttribute('data-showing'),
			currentTime: video.currentTime,
			paused: video.paused,
			src: video.currentSrc
		};
	});

/** The playhead's time in seconds, from the timecode (mm:ss.t). */
async function playheadSeconds(page: Page): Promise<number> {
	const text = (await page.getByTestId('timecode').innerText()).split('/')[0]!.trim();
	const [m, s] = text.split(':');
	return Number(m) * 60 + Number(s);
}

test('Edit on a Ready take opens it in a Project, with its waveform showing the beeps where they are', async ({ page }, testInfo) => {
	test.setTimeout(120_000);
	await page.goto('/');
	await expect(page.getByRole('tab', { name: 'Edit' })).toBeDisabled();
	const session = await recordTake(page, 6);
	const segment = session.recordings[0]!.segments[0]!;

	await page.getByTestId('session').first().getByRole('button', { name: 'Edit' }).click();
	const edit = page.getByRole('tab', { name: 'Edit' });
	await expect(edit).toHaveAttribute('aria-selected', 'true');
	const editor = page.getByTestId('editor');
	await expect(editor).toBeVisible();

	// The Project file: the one Session, no Cuts, the silence defaults.
	const projectId = (await editor.getAttribute('data-project-id'))!;
	const project = await readOpfsJson<Project>(page, `projects/${projectId}/project.json`);
	expect(project).toMatchObject({
		version: 1,
		id: projectId,
		title: session.title,
		sessions: [{ sessionId: session.id, cuts: [] }],
		silence: { thresholdDb: -45, minLengthMs: 700, paddingMs: 150 }
	});

	// One lane, for the host.
	await expect(page.getByTestId('lane')).toHaveCount(1);
	await expect(page.getByTestId('lane-header')).toContainText('You');
	await expect(page.getByTestId('lane-header')).toContainText('Host');
	const durationS = segment.durationUs! / 1e6;
	await expect(page.getByTestId('timecode')).toContainText(`00:00.0 / 00:0${Math.floor(durationS)}`);

	// Peaks are cached beside the Segment, one bin per 10 ms.
	const cachePath = segment.path!.replace(/\.[^.]+$/, '.peaks');
	await expect.poll(async () => (await readOpfsBytes(page, cachePath).catch(() => [])).length, { timeout: 30_000 }).toBe(
		Math.ceil(durationS * peaksPerSecond)
	);
	const peaks = await readOpfsBytes(page, cachePath);

	// The beeps, found in the finished file itself.
	const file = testInfo.outputPath('take.' + segment.path!.split('.').at(-1));
	await saveOpfsFile(page, segment.path!, file);
	const rate = 8000;
	const beeps = detectBeeps(decodeAudio(file, rate), rate).filter((b) => b.timeSeconds < durationS - 0.6);
	expect(beeps.length).toBeGreaterThanOrEqual(4);
	for (const beep of beeps) {
		// Loud in the peaks where the beep is, quiet half a second later.
		const at = Math.floor(beep.timeSeconds * peaksPerSecond);
		expect(peakDb(Math.max(...peaks.slice(Math.max(0, at - 2), at + 5)))).toBeGreaterThan(-20);
		expect(peakDb(Math.max(...peaks.slice(at + 40, at + 60)))).toBeLessThan(-60);
		// And drawn that way.
		expect(await drawnHeight(page, (beep.timeSeconds + 0.02) / durationS)).toBeGreaterThan(0.3);
		expect(await drawnHeight(page, (beep.timeSeconds + 0.5) / durationS)).toBeLessThan(0.1);
	}

	// Reopening reads the cache: no worker this time.
	const workers: string[] = [];
	page.on('worker', (worker) => workers.push(worker.url()));
	await page.reload();
	await expect(page.getByTestId('session').first()).toHaveAttribute('data-state', 'ready');
	await expect(edit).toBeEnabled();
	await edit.click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-project-id', projectId);
	await expect.poll(() => drawnHeight(page, (beeps[0]!.timeSeconds + 0.02) / durationS)).toBeGreaterThan(0.3);
	expect(workers.filter((url) => url.includes('peaks'))).toEqual([]);

	// Edit on the same take again opens the same Project, rather than making another.
	await page.getByRole('tab', { name: 'Takes' }).click();
	await page.getByRole('region', { name: 'Takes' }).getByTestId('session').first().getByRole('button', { name: 'Edit' }).click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-project-id', projectId);
	const projects = await page.evaluate(async () => {
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('projects');
		const names: string[] = [];
		for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
		return names;
	});
	expect(projects).toEqual([projectId]);
});

test('play, pause and seek; the video follows the playhead across a Capture gap into the next Segment', async ({ page }) => {
	test.setTimeout(150_000);
	await page.goto('/');
	// Two takes glued into one Session with a 3 s Capture gap, as a device drop would leave.
	const gapUs = 3_000_000;
	const session = await glueTakes(page, await recordTake(page, 4), await recordTake(page, 4), gapUs);
	const [a, b] = session.recordings[0]!.segments as [Segment, Segment];
	const row = page.getByRole('region', { name: 'Takes' }).locator(`[data-session-id="${session.id}"]`);
	await page.getByRole('tab', { name: 'Takes' }).click();
	await row.getByRole('button', { name: 'Edit' }).click();
	await expect(page.getByTestId('editor')).toBeVisible();

	// Both Segments are drawn, with nothing in the Capture gap.
	const totalUs = a.durationUs! + gapUs + b.durationUs!;
	await expect.poll(() => drawnHeight(page, (a.durationUs! + gapUs / 2) / totalUs), { timeout: 30_000 }).toBe(0);
	await expect.poll(() => drawnHeight(page, 500_000 / totalUs), { timeout: 30_000 }).toBeGreaterThan(0);
	await expect.poll(() => drawnHeight(page, (totalUs - 1e6) / totalUs), { timeout: 30_000 }).toBeGreaterThan(0);

	// Play from the start, then pause.
	await expect.poll(async () => (await editorState(page)).showing).toBe('segment');
	await page.getByRole('button', { name: 'Play' }).click();
	await page.waitForTimeout(1500);
	await page.getByRole('button', { name: 'Pause' }).click();
	const paused = await playheadSeconds(page);
	expect(paused).toBeGreaterThan(0.8);
	expect(paused).toBeLessThan(2.5);
	let state = await editorState(page);
	expect(state.paused).toBe(true);
	expect(Math.abs(state.currentTime - paused)).toBeLessThan(0.2);
	await page.waitForTimeout(500);
	expect(await playheadSeconds(page)).toBe(paused);

	// Seek by clicking the ruler: the video goes there too.
	const ruler = page.getByTestId('ruler');
	const box = (await ruler.boundingBox())!;
	const target = (a.durationUs! / 2) / totalUs;
	await ruler.click({ position: { x: box.width * target, y: box.height / 2 } });
	await expect.poll(async () => Math.abs((await editorState(page)).currentTime - a.durationUs! / 2e6)).toBeLessThan(0.15);
	expect(Math.abs((await playheadSeconds(page)) - a.durationUs! / 2e6)).toBeLessThan(0.15);

	// Clicking a lane in the Capture gap shows nothing.
	const lane = page.getByTestId('lane');
	const laneBox = (await lane.boundingBox())!;
	await lane.click({ position: { x: laneBox.width * ((a.durationUs! + gapUs / 2) / totalUs), y: laneBox.height / 2 } });
	await expect.poll(async () => (await editorState(page)).showing).toBe('gap');
	await expect(page.getByTestId('editor-video')).toBeHidden();

	// Play from just before the end of the first Segment: through the gap, into the second.
	await ruler.click({ position: { x: box.width * ((a.durationUs! - 700_000) / totalUs), y: box.height / 2 } });
	await expect.poll(async () => (await editorState(page)).showing).toBe('segment');
	const firstSrc = (await editorState(page)).src;
	await page.getByRole('button', { name: 'Play' }).click();
	await expect.poll(async () => (await editorState(page)).showing, { timeout: 5000 }).toBe('gap');
	await expect.poll(async () => (await editorState(page)).showing, { timeout: 6000 }).toBe('segment');
	await page.waitForTimeout(1000);
	state = await editorState(page);
	expect(state.src).not.toBe(firstSrc);
	expect(state.paused).toBe(false);
	const playhead = await playheadSeconds(page);
	// The playhead is in the second Segment, with the video at the matching place in its file.
	expect(playhead).toBeGreaterThan((a.durationUs! + gapUs) / 1e6);
	expect(Math.abs(state.currentTime - (playhead - (a.durationUs! + gapUs) / 1e6))).toBeLessThan(0.3);

	// At the end it stops.
	await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 10_000 });
	expect(await playheadSeconds(page)).toBeCloseTo(Math.floor((totalUs / 1e6) * 10) / 10, 0);
});

test('an audio-only take opens with its waveform and plays', async ({ page }) => {
	test.setTimeout(90_000);
	await page.goto('/');
	const camera = page.getByRole('combobox', { name: 'Camera' });
	await expect(camera).toBeEnabled();
	await camera.selectOption({ label: 'Camera off (audio only)' });
	await expect(page.getByTestId('camera-off')).toBeVisible();
	const session = await recordTake(page, 4);
	expect(session.recordings[0]!.video).toBeNull();

	await page.getByTestId('session').first().getByRole('button', { name: 'Edit' }).click();
	await expect(page.getByTestId('audio-only')).toBeVisible();
	await expect(page.getByTestId('editor-video')).toBeHidden();
	await expect.poll(() => drawnHeight(page, 0.5), { timeout: 30_000 }).toBeGreaterThan(0);

	await page.getByRole('button', { name: 'Play' }).click();
	await page.waitForTimeout(1200);
	const state = await editorState(page);
	expect(state.paused).toBe(false);
	expect(state.currentTime).toBeGreaterThan(0.6);
	expect(await playheadSeconds(page)).toBeGreaterThan(0.6);
});
