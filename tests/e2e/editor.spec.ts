// The editor: Edit on a Ready take opens it in a Project, with a lane per
// Track whose waveform shows the fixture's beeps where they are, and playback
// that follows the playhead across Segments and Capture gaps. Runs in Chrome
// and Firefox.

import { expect, test, type Page } from '@playwright/test';
import { fixtureSpec } from '../fixtures/spec.ts';
import { glueTakes, opfsFileExists, readOpfsJson, recordTake, saveOpfsFile } from '../helpers/app.ts';
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

/** What the timeline shows: its zoom, how far it's scrolled, and its widths in px. */
const view = (page: Page) =>
	page.evaluate(() => {
		const timeline = document.querySelector<HTMLElement>('[data-testid="timeline"]')!;
		const scroller = document.querySelector<HTMLElement>('[data-testid="scroller"]')!;
		return {
			zoom: Number(timeline.dataset.zoom),
			scrollLeft: scroller.scrollLeft,
			viewWidth: scroller.clientWidth,
			contentWidth: scroller.scrollWidth
		};
	});

/** Where the playhead is drawn, in px from the view's left edge; outside 0–width when scrolled out of view. */
async function playheadX(page: Page): Promise<number> {
	const [playhead, scroller] = await Promise.all([page.getByTestId('playhead').boundingBox(), page.getByTestId('scroller').boundingBox()]);
	return playhead!.x + playhead!.width / 2 - scroller!.x;
}

/** The widest run of tall bars (over half the lane) within ±20 px of `x` in the view, in CSS px. */
function tallRunWidth(page: Page, x: number): Promise<number> {
	return page.getByTestId('lane').locator('canvas').evaluate((canvas: HTMLCanvasElement, x) => {
		const ratio = canvas.width / canvas.clientWidth;
		const from = Math.max(0, Math.round((x - 20) * ratio));
		const columns = Math.min(canvas.width - from, Math.round(40 * ratio));
		const { data } = canvas.getContext('2d')!.getImageData(from, 0, columns, canvas.height);
		const tall = (column: number) => {
			let count = 0;
			for (let y = 0; y < canvas.height; y++) if (data[(y * columns + column) * 4 + 3]! > 0) count++;
			return count > canvas.height / 2;
		};
		let first = -1;
		let last = -1;
		for (let column = 0; column < columns; column++) {
			if (!tall(column)) continue;
			if (first < 0) first = column;
			last = column;
		}
		return first < 0 ? 0 : (last - first + 1) / ratio;
	}, x);
}

/** Opens a take of two 4 s Segments with a 20 s Capture gap, once its peaks are in; returns its length in µs and the beeps in its first Segment. */
async function openGappedTake(page: Page): Promise<{ totalUs: number; beepsUs: number[] }> {
	await page.goto('/');
	const session = await glueTakes(page, await recordTake(page, 4), await recordTake(page, 4), 20_000_000);
	const [a, b] = session.recordings[0]!.segments as [Segment, Segment];
	await page.getByRole('tab', { name: 'Takes' }).click();
	await page.getByRole('region', { name: 'Takes' }).locator(`[data-session-id="${session.id}"]`).getByRole('button', { name: 'Edit' }).click();
	await expect(page.getByTestId('editor')).toBeVisible();
	const cache = (segment: Segment) => segment.path!.replace(/\.[^.]+$/, '.peaks');
	await expect.poll(() => opfsFileExists(page, cache(b)), { timeout: 30_000 }).toBe(true);
	await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'segment');
	// Where each beep starts, from the cached peaks: a loud bin after a quiet one.
	const peaks = await readOpfsBytes(page, cache(a));
	const beepsUs = peaks.flatMap((byte, i) => (peakDb(byte) > -20 && peakDb(peaks[i - 1] ?? 0) < -40 ? [(i * 1e6) / peaksPerSecond] : []));
	return { totalUs: a.durationUs! + 20_000_000 + b.durationUs!, beepsUs };
}

test('skip, speed and zoom work from the toolbar and the keyboard', async ({ page }) => {
	test.setTimeout(150_000);
	const { totalUs } = await openGappedTake(page);
	const video = page.getByTestId('editor-video');
	const speed = page.getByTestId('speed');

	// Skip forward and back, 5 s at a time, from the toolbar and with ← → and J.
	await page.getByRole('button', { name: 'Forward 5 seconds' }).click();
	await expect.poll(() => playheadSeconds(page)).toBe(5);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => playheadSeconds(page)).toBe(10);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => playheadSeconds(page)).toBe(5);
	await page.getByRole('button', { name: 'Back 5 seconds' }).click();
	await expect.poll(() => playheadSeconds(page)).toBe(0);
	await page.keyboard.press('j');
	await expect.poll(() => playheadSeconds(page)).toBe(0);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('j');
	await expect.poll(() => playheadSeconds(page)).toBe(0);
	await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'segment');

	// Space, L and K play and pause; Space plays even with a toolbar button focused, without pressing it.
	await page.keyboard.press('Space');
	await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
	await page.keyboard.press('k');
	await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
	await page.keyboard.press('l');
	await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
	await page.keyboard.press('Space');
	await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
	await page.getByRole('button', { name: 'Zoom in' }).focus();
	await page.keyboard.press('Space');
	await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
	expect((await view(page)).zoom).toBe(1);
	await page.keyboard.press('Space');
	await page.getByRole('button', { name: 'Back 5 seconds' }).click();

	// Speed steps 1×, 1.5×, 2× and back to 1×.
	await expect(speed).toHaveText('1×');
	await speed.click();
	await expect(speed).toHaveText('1.5×');
	expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
	await speed.click();
	await expect(speed).toHaveText('2×');
	await expect(speed).toHaveAccessibleName('Speed 2×');
	// At 2× the playhead runs twice as fast, in a Segment...
	let before = await playheadSeconds(page);
	await page.getByRole('button', { name: 'Play' }).click();
	await page.waitForTimeout(1000);
	await page.getByRole('button', { name: 'Pause' }).click();
	let ran = (await playheadSeconds(page)) - before;
	expect(ran).toBeGreaterThan(1.6);
	expect(ran).toBeLessThan(2.8);
	// ...through a Capture gap...
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'gap');
	before = await playheadSeconds(page);
	await page.keyboard.press('Space');
	await page.waitForTimeout(1000);
	await page.keyboard.press('Space');
	ran = (await playheadSeconds(page)) - before;
	expect(ran).toBeGreaterThan(1.6);
	expect(ran).toBeLessThan(2.8);
	// ...and in the next Segment's file too.
	const ruler = page.getByTestId('ruler');
	await ruler.click({ position: { x: ((totalUs - 2e6) / totalUs) * (await ruler.boundingBox())!.width, y: 12 } });
	await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'segment');
	expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(2);
	await speed.click();
	await expect(speed).toHaveText('1×');
	expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1);

	// Zoom with + and −, the toolbar, and Ctrl and the wheel (a trackpad pinch).
	const zoomOut = page.getByRole('button', { name: 'Zoom out' });
	const zoomIn = page.getByRole('button', { name: 'Zoom in' });
	await expect(zoomOut).toBeDisabled();
	await page.keyboard.press('+');
	await expect.poll(async () => (await view(page)).zoom).toBe(2);
	await page.keyboard.press('=');
	await expect.poll(async () => (await view(page)).zoom).toBe(4);
	await page.keyboard.press('-');
	await expect.poll(async () => (await view(page)).zoom).toBe(2);
	await zoomOut.click();
	await expect.poll(async () => (await view(page)).zoom).toBe(1);
	await expect(zoomOut).toBeDisabled();
	// All the way in: a few seconds across, and no further.
	while (await zoomIn.isEnabled()) await zoomIn.click();
	const zoomed = await view(page);
	const [m, s] = (await page.getByTestId('timecode').innerText()).split('/')[1]!.trim().split(':');
	const across = (Number(m) * 60 + Number(s)) / zoomed.zoom;
	expect(across).toBeGreaterThanOrEqual(4.9);
	expect(across).toBeLessThan(8);
	expect(zoomed.contentWidth).toBeGreaterThan(zoomed.viewWidth * 3);
	while (await zoomOut.isEnabled()) await page.keyboard.press('-');
	const box = (await page.getByTestId('scroller').boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + 40);
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, -200);
	await page.keyboard.up('Control');
	await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(2);

	// Shortcuts don't fire while typing in a field.
	while (await zoomOut.isEnabled()) await page.keyboard.press('-');
	const at = await playheadSeconds(page);
	await page.evaluate(() => document.body.append(Object.assign(document.createElement('input'), { id: 'field' })));
	await page.locator('#field').focus();
	await page.keyboard.type(' +jl');
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('#field')).toHaveValue(' +jl');
	await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
	expect(await playheadSeconds(page)).toBe(at);
	expect((await view(page)).zoom).toBe(1);
});

test('zoomed in, the timeline scrolls and follows the playhead, and the waveform stays sharp', async ({ page }) => {
	test.setTimeout(150_000);
	const { totalUs, beepsUs } = await openGappedTake(page);
	expect(beepsUs.length).toBeGreaterThanOrEqual(3);
	const beepX = async (us: number) => {
		const v = await view(page);
		return (us / totalUs) * v.contentWidth - v.scrollLeft;
	};

	// Zoomed out, a 50 ms beep is a bar, or two if it straddles them.
	const beep = beepsUs[1]!;
	expect(await tallRunWidth(page, await beepX(beep))).toBeLessThanOrEqual(5);

	// Zooming keeps the playhead where it is on screen.
	await page.getByTestId('ruler').click({ position: { x: (beep / totalUs) * (await view(page)).viewWidth, y: 12 } });
	await expect.poll(() => playheadSeconds(page)).toBeCloseTo(beep / 1e6, 0);
	const x = await playheadX(page);
	while (await page.getByRole('button', { name: 'Zoom in' }).isEnabled()) await page.keyboard.press('+');
	await expect.poll(() => playheadX(page)).toBeCloseTo(x, -1);

	// Zoomed all the way in, the beep is drawn as wide as it lasts, from the fine peaks.
	const pxPerSecond = (await view(page)).contentWidth / (totalUs / 1e6);
	await expect.poll(async () => tallRunWidth(page, await beepX(beep))).toBeGreaterThanOrEqual(0.05 * pxPerSecond - 3);
	expect(await tallRunWidth(page, await beepX(beep + 300_000))).toBe(0);
	// The ruler marks every second.
	const labels = await page.getByTestId('ruler').locator('.mark').allInnerTexts();
	expect(labels).toContain('0:01');
	expect(labels).toContain('0:02');

	// Scrolling sideways moves the ruler and lanes together and redraws the waveform for what's in view.
	await page.getByRole('button', { name: 'Back 5 seconds' }).click();
	await page.getByTestId('scroller').evaluate((el) => (el.scrollLeft = 0));
	const later = beepsUs.at(-1)!;
	await page.getByTestId('scroller').evaluate((el, px) => (el.scrollLeft = px), (later / totalUs) * (await view(page)).contentWidth - 200);
	await expect.poll(async () => tallRunWidth(page, await beepX(later))).toBeGreaterThanOrEqual(0.05 * pxPerSecond - 3);

	// Playing from the start, the view turns the page as the playhead runs off the right edge.
	await page.getByTestId('scroller').evaluate((el) => (el.scrollLeft = 0));
	await page.getByTestId('speed').click();
	await page.getByTestId('speed').click();
	await page.getByRole('button', { name: 'Play' }).click();
	await expect.poll(async () => (await view(page)).scrollLeft, { timeout: 10_000 }).toBeGreaterThan(0);
	for (let i = 0; i < 5; i++) {
		const playhead = await playheadX(page);
		expect(playhead).toBeGreaterThanOrEqual(-2);
		expect(playhead).toBeLessThanOrEqual((await view(page)).viewWidth + 2);
		await page.waitForTimeout(400);
	}
	// A view the user scrolled away from stays put.
	const away = (await view(page)).contentWidth - (await view(page)).viewWidth;
	await page.getByTestId('scroller').evaluate((el, px) => (el.scrollLeft = px), away);
	await page.waitForTimeout(1500);
	expect((await view(page)).scrollLeft).toBeCloseTo(away, -1);
	await page.getByRole('button', { name: 'Pause' }).click();

	// Skipping to a time out of view brings it into view.
	await page.getByTestId('scroller').evaluate((el) => (el.scrollLeft = 0));
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => playheadX(page)).toBeGreaterThan(0);
	expect(await playheadX(page)).toBeLessThan((await view(page)).viewWidth);
});
