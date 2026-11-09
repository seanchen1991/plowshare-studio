// Preview plays the edit: Cuts are skipped, and sound and picture stay in step
// across every Cut and Segment boundary. The preview's own output is recorded
// in the page (the canvas, and the audio it plays) and measured with the
// fixture: the beeps heard must be exactly the ones the Cuts keep, spaced as in
// the edit, and in Chrome, where the fixture draws a frame counter, the picture
// at each beep must be the frame that went with it in the recording.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fixtureSpec } from '../fixtures/spec.ts';
import { glueTakes, opfsFileExists, readOpfsJson, recordTake, saveOpfsFile } from '../helpers/app.ts';
import { detectBeeps } from '../helpers/beeps.ts';
import { useFixtureMedia } from '../helpers/fake-media.ts';
import { readFrameCode } from '../helpers/frame-code.ts';
import { audioStartSeconds, decodeAudio } from '../helpers/media-file.ts';
import { editDurationUs, toEditTime } from '../../src/lib/edit/cuts.ts';
import type { Cut, Project } from '../../src/lib/storage/project-file.ts';
import type { Segment, Session } from '../../src/lib/storage/session-file.ts';

/** Every Web Audio graph also feeds a stream the test can record: whatever reaches the speakers. */
function tapAudio() {
	const taps = new Map<BaseAudioContext, MediaStreamAudioDestinationNode>();
	(window as unknown as { audioTaps: typeof taps }).audioTaps = taps;
	const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
	AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
		if (args[0] instanceof AudioDestinationNode && this.context instanceof AudioContext) {
			let tap = taps.get(this.context);
			if (!tap) taps.set(this.context, (tap = this.context.createMediaStreamDestination()));
			connect.call(this, tap);
		}
		return connect.apply(this, args);
	} as typeof AudioNode.prototype.connect;
}

test.beforeEach(async ({ context, browserName }) => {
	await context.addInitScript(tapAudio);
	if (browserName === 'firefox') await context.addInitScript(useFixtureMedia, fixtureSpec);
});

const rate = 8000;

/** A frame of a file at `seconds`, scaled to the fixture's size, as grey pixels. */
function greyFrameAt(file: string, seconds: number): Buffer {
	return execFileSync(
		'ffmpeg',
		['-v', 'error', '-i', file, '-ss', String(seconds), '-frames:v', '1', '-vf', `scale=${fixtureSpec.width}:${fixtureSpec.height}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
}

/** Writes a Project file in OPFS. */
function writeProject(page: Page, project: Project) {
	return page.evaluate(async (project) => {
		const projects = await (await navigator.storage.getDirectory()).getDirectoryHandle('projects');
		const dir = await projects.getDirectoryHandle(project.id);
		const writable = await (await dir.getFileHandle('project.json')).createWritable();
		await writable.write(JSON.stringify(project));
		await writable.close();
	}, project);
}

test('preview skips the Cuts, with sound and picture in step across every Cut and Segment boundary', async ({ page, browserName }, testInfo) => {
	test.setTimeout(240_000);
	await page.goto('/');
	const gapUs = 3_000_000;
	const session = await glueTakes(page, await recordTake(page, 7), await recordTake(page, 7), gapUs);
	const [a, b] = session.recordings[0]!.segments as [Segment, Segment];

	const sourceBeeps = await beepsInSegments(page, testInfo, browserName, [a, b]);
	const inA = sourceBeeps.filter((s) => s.atUs < a.durationUs!);
	const inB = sourceBeeps.filter((s) => s.atUs >= b.startUs);
	expect(inA.length).toBeGreaterThanOrEqual(6);
	expect(inB.length).toBeGreaterThanOrEqual(6);

	// Three Cuts, each edge halfway between beeps so every beep is either kept whole or cut whole:
	// one inside the first Segment, one from the first across the Capture gap into the second, one inside the second.
	const between = (beep: { atUs: number }) => beep.atUs + 500_000;
	const cuts: Cut[] = [
		[between(inA[0]!), between(inA[1]!)],
		[between(inA[3]!), between(inB[1]!)],
		[between(inB[3]!), between(inB[4]!)]
	].map(([startUs, endUs]) => ({ startUs: startUs!, endUs: endUs!, reason: 'manual', accepted: true }));
	const kept = sourceBeeps.filter((s) => !cuts.some((c) => s.atUs >= c.startUs && s.atUs < c.endUs));

	await page.getByRole('tab', { name: 'Takes' }).click();
	await page.getByRole('region', { name: 'Takes' }).locator(`[data-session-id="${session.id}"]`).getByRole('button', { name: 'Edit' }).click();
	const projectId = (await page.getByTestId('editor').getAttribute('data-project-id'))!;
	await writeProject(page, {
		version: 1,
		id: projectId,
		title: session.title,
		createdAt: new Date().toISOString(),
		sessions: [{ sessionId: session.id, cuts }],
		silence: { thresholdDb: -45, minLengthMs: 700, paddingMs: 150 }
	});
	await page.reload();
	await page.getByRole('tab', { name: 'Edit' }).click();
	await expect(page.getByTestId('cut')).toHaveCount(3);
	await expect.poll(() => opfsFileExists(page, b.path!.replace(/\.[^.]+$/, '.peaks')), { timeout: 30_000 }).toBe(true);

	// The edit's length is the take's less the Cuts.
	const totalUs = b.startUs + b.durationUs!;
	const editUs = totalUs - cuts.reduce((sum, c) => sum + c.endUs - c.startUs, 0);
	await expect(page.getByTestId('timecode')).toContainText(`/ ${format(editUs)}`);

	// Seeking into a Cut lands after it: the timecode shows edit time, the take time where that is.
	const ruler = page.getByTestId('ruler');
	const box = (await ruler.boundingBox())!;
	const inside = (cuts[1]!.startUs + cuts[1]!.endUs) / 2;
	await ruler.click({ position: { x: (inside / totalUs) * box.width, y: box.height / 2 } });
	await expect(page.getByTestId('take-time')).toHaveText(`Take ${format(cuts[1]!.endUs)}`);
	await expect(page.getByTestId('timecode')).toContainText(`${format(toEditTime(cuts, cuts[1]!.endUs))} /`);
	await expect(page.getByTestId('stage')).toHaveAttribute('data-showing', 'segment');

	await checkPreview(page, testInfo, browserName, kept.map((k) => ({ editS: toEditTime(cuts, k.atUs) / 1e6, frameCode: k.frameCode })), editUs, { fast: true });
});

test('preview plays across Session boundaries in order, skipping Cuts, with sound and picture in step', async ({ page, browserName }, testInfo) => {
	test.setTimeout(240_000);
	await page.goto('/');
	await recordTake(page, 6);
	await recordTake(page, 6);

	// Both takes in one Project, from Takes: they play in the order listed (newest first).
	await page.getByRole('tab', { name: 'Takes' }).click();
	const takes = page.getByRole('region', { name: 'Takes' }).getByTestId('session');
	await takes.nth(0).getByRole('checkbox').check();
	await takes.nth(1).getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Edit together' }).click();
	await expect(page.getByTestId('project-take')).toHaveCount(2);
	const projectId = (await page.getByTestId('editor').getAttribute('data-project-id'))!;
	const project = await readOpfsJson<Project>(page, `projects/${projectId}/project.json`);
	const sessions = await Promise.all(project.sessions.map((ps) => readOpfsJson<Session>(page, `sessions/${ps.sessionId}/session.json`)));

	// Cuts in both: the end of the first take and the start of the second, so the boundary joins kept
	// material from each, and one more inside the second. Edges sit halfway between beeps.
	const between = (beep: { atUs: number }) => beep.atUs + 500_000;
	const takeBeeps = [];
	for (const session of sessions) takeBeeps.push(await beepsInSegments(page, testInfo, browserName, session.recordings[0]!.segments));
	const [first, second] = takeBeeps as [{ atUs: number; frameCode: number }[], { atUs: number; frameCode: number }[]];
	expect(first.length).toBeGreaterThanOrEqual(5);
	expect(second.length).toBeGreaterThanOrEqual(5);
	const durations = sessions.map((s) => s.recordings[0]!.segments[0]!.durationUs!);
	const manual = (startUs: number, endUs: number): Cut => ({ startUs, endUs, reason: 'manual', accepted: true });
	const cuts = [[manual(between(first[3]!), durations[0]!)], [manual(0, between(second[0]!)), manual(between(second[2]!), between(second[3]!))]];
	await writeProject(page, { ...project, sessions: project.sessions.map((ps, i) => ({ ...ps, cuts: cuts[i]! })) });
	await page.reload();
	await page.getByRole('tab', { name: 'Edit' }).click();
	await expect(page.getByTestId('cut')).toHaveCount(3);
	await expect(page.getByTestId('boundary')).toHaveCount(1);
	for (const session of sessions) {
		const path = session.recordings[0]!.segments[0]!.path!;
		await expect.poll(() => opfsFileExists(page, path.replace(/\.[^.]+$/, '.peaks')), { timeout: 30_000 }).toBe(true);
	}

	// The kept beeps of each take, at their edit times: the second take's start where the first's edit ends.
	const firstEditUs = editDurationUs(cuts[0]!, durations[0]!);
	const editUs = firstEditUs + editDurationUs(cuts[1]!, durations[1]!);
	await expect(page.getByTestId('timecode')).toContainText(`/ ${format(editUs)}`);
	const kept = takeBeeps.flatMap((beeps, i) =>
		beeps
			.filter((b) => !cuts[i]!.some((c) => b.atUs >= c.startUs && b.atUs < c.endUs))
			.map((b) => ({ editS: ((i === 0 ? 0 : firstEditUs) + toEditTime(cuts[i]!, b.atUs)) / 1e6, frameCode: b.frameCode }))
	);
	await checkPreview(page, testInfo, browserName, kept, editUs);
});

/**
 * Records the preview from the start and checks it against the beeps the edit
 * keeps (their edit times, and the frame recorded with each): the same beeps,
 * the same spacing, in sync in Chrome, no freezes; with `fast`, again at 2×.
 */
async function checkPreview(
	page: Page,
	testInfo: TestInfo,
	browserName: string,
	beeps: { editS: number; frameCode: number }[],
	editUs: number,
	{ fast = false } = {}
) {
	// Make the audio graph (Play), then record the preview from the start to the end.
	await page.getByRole('button', { name: 'Play' }).click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { audioTaps: Map<unknown, unknown> }).audioTaps.size)).toBe(1);
	await page.getByRole('button', { name: 'Pause' }).click();
	const { file: recording, longestFreezeMs } = await recordPreview(page, testInfo.outputPath('preview.webm'), editUs);

	// The beeps heard: exactly the kept ones, spaced as the edit spaces them, so each jump is seamless.
	const allHeard = beepsIn(recording);
	// Leaving out a beep in the last moment of the edit, which may be clipped as playing stops.
	const lastS = editUs / 1e6 - 0.15;
	const expected = beeps.map((b) => b.editS).filter((s) => s < lastS);
	const heard = allHeard.filter((h) => h.timeSeconds - allHeard[0]!.timeSeconds < lastS - expected[0]!);
	const spacingErrorsMs = heard.map((h, i) => Math.round((h.timeSeconds - heard[0]!.timeSeconds - (expected[i]! - expected[0]!)) * 1000));
	const report: Record<string, unknown> = { heard: heard.length, expected: expected.length, spacingErrorsMs, longestFreezeMs };

	// In Chrome: at each beep heard, the frame on screen is the one recorded with that beep.
	if (browserName === 'chromium') {
		const frameErrors = heard.map((h, i) => readFrameCode(greyFrameAt(recording, h.timeSeconds + 0.01)) - beeps[i]!.frameCode);
		report.frameErrors = frameErrors;
		report.outputLatency = await page.evaluate(() => {
			const [context] = (window as unknown as { audioTaps: Map<AudioContext, unknown> }).audioTaps.keys();
			return context!.outputLatency;
		});
	}
	await testInfo.attach('report.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
	console.log(`Preview report (${browserName}): ${JSON.stringify(report)}`);

	expect(heard.length).toBe(expected.length);
	for (const error of spacingErrorsMs) expect(Math.abs(error)).toBeLessThanOrEqual(40);
	// The picture never freezes at a jump: the next piece is decoding before it's due. Measured in Chrome,
	// which decodes in hardware; Firefox's software decoding stalls under the test suite's load (it's reported).
	if (browserName === 'chromium') expect(longestFreezeMs).toBeLessThan(150);
	if (browserName === 'chromium') {
		// In sync: within 2 frames (67 ms; recording the preview adds up to a frame of its own), and
		// steady, shifting by no more than a frame across every Cut and Segment boundary. The first
		// beep is left out of the steadiness check: it's heard as the sound starts up.
		const frameErrors = report.frameErrors as number[];
		for (const error of frameErrors) expect(Math.abs(error)).toBeLessThanOrEqual(2);
		const steady = frameErrors.slice(1);
		expect(Math.max(...steady) - Math.min(...steady)).toBeLessThanOrEqual(1);
	}

	if (!fast) return;
	// At 2×: the same beeps, half as far apart, at the same pitch.
	await page.getByTestId('speed').click();
	await page.getByTestId('speed').click();
	await expect(page.getByTestId('speed')).toHaveText('2×');
	const twice = beepsIn((await recordPreview(page, testInfo.outputPath('preview-2x.webm'), editUs / 2)).file);
	const fastSpacingErrorsMs = expected.slice(1).map((e, i) => Math.round(((twice[i + 1]?.timeSeconds ?? NaN) - twice[0]!.timeSeconds - (e - expected[0]!) / 2) * 1000));
	const pitches = twice.map((h) => Math.round(h.frequencyHz));
	console.log(`Preview at 2× (${browserName}): ${JSON.stringify({ heard: twice.length, fastSpacingErrorsMs, pitches })}`);
	expect(twice.length).toBeGreaterThanOrEqual(expected.length);
	for (const error of fastSpacingErrorsMs) expect(Math.abs(error)).toBeLessThanOrEqual(40);
	// The fixture's tones are 1 and 2 kHz; played faster without stretching, they'd be 2 and 4.
	for (const hz of pitches) expect(Math.min(Math.abs(hz - fixtureSpec.toneHz), Math.abs(hz - fixtureSpec.markerHz))).toBeLessThan(150);
}

/**
 * Plays the edit from the playhead to the end and records what the preview
 * shows and plays, into `file`. Press Play once before, so the audio graph exists.
 */
async function recordPreview(page: Page, file: string, playsUs: number): Promise<{ file: string; longestFreezeMs: number }> {
	await page.getByRole('button', { name: 'Back 5 seconds' }).click();
	while (!(await page.getByTestId('timecode').innerText()).startsWith('00:00.0')) await page.keyboard.press('ArrowLeft');
	await page.evaluate(() => {
		const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]')!;
		const [tap] = (window as unknown as { audioTaps: Map<AudioContext, MediaStreamAudioDestinationNode> }).audioTaps.values();
		const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...tap!.stream.getAudioTracks()]);
		const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 8_000_000 });
		const chunks: Blob[] = [];
		recorder.ondataavailable = (event) => chunks.push(event.data);
		const done = new Promise<Blob>((resolve) => (recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))));
		recorder.start(250);
		// When each new frame reaches the canvas.
		const draws: number[] = [];
		const watcher = new MutationObserver(() => draws.push(performance.now()));
		watcher.observe(canvas, { attributeFilter: ['data-frame-us'] });
		Object.assign(window, { previewRecorder: recorder, previewRecording: done, previewDraws: draws, previewWatcher: watcher });
	});
	await page.waitForTimeout(300);
	await page.getByRole('button', { name: 'Play' }).click();
	await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: playsUs / 1000 + 15_000 });
	const longestFreezeMs = await page.evaluate(() => {
		const w = window as unknown as { previewDraws: number[]; previewWatcher: MutationObserver };
		w.previewWatcher.disconnect();
		// From half a second in: starting to play waits for the first frames, which is fine; a jump mustn't.
		const draws = w.previewDraws.filter((at) => at > w.previewDraws[0]! + 500);
		return Math.round(draws.slice(1).reduce((max, at, i) => Math.max(max, at - draws[i]!), 0));
	});
	const base64 = await page.evaluate(async () => {
		const w = window as unknown as { previewRecorder: MediaRecorder; previewRecording: Promise<Blob> };
		w.previewRecorder.stop();
		const bytes = new Uint8Array(await (await w.previewRecording).arrayBuffer());
		let binary = '';
		for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return btoa(binary);
	});
	writeFileSync(file, Buffer.from(base64, 'base64'));
	return { file, longestFreezeMs };
}

/** The beeps in Segments' files, placed on their take's timeline, with the frame recorded with each (Chrome only). */
async function beepsInSegments(page: Page, testInfo: TestInfo, browserName: string, segments: Segment[]) {
	const beeps: { atUs: number; frameCode: number }[] = [];
	for (const segment of segments) {
		const file = testInfo.outputPath(`${segment.path!.replaceAll('/', '-')}`);
		await saveOpfsFile(page, segment.path!, file);
		for (const beep of beepsIn(file)) {
			const frameCode = browserName === 'chromium' ? readFrameCode(greyFrameAt(file, beep.timeSeconds + 0.01)) : -1;
			beeps.push({ atUs: segment.startUs + Math.round(beep.timeSeconds * 1e6), frameCode });
		}
	}
	return beeps;
}

/** The beeps in a recording, placed on its timeline (its audio may start after its video). */
function beepsIn(file: string) {
	const start = audioStartSeconds(file);
	return detectBeeps(decodeAudio(file, rate), rate).map((beep) => ({ ...beep, timeSeconds: beep.timeSeconds + start }));
}

/** mm:ss.t, as the editor's timecode shows it. */
function format(us: number): string {
	const tenths = Math.floor(us / 100_000);
	const m = Math.floor(tenths / 600);
	const s = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
	return `${String(m).padStart(2, '0')}:${s}`;
}
