// Records with this computer's real camera and mic, and checks the finished
// file as the fixture tests do, as far as a real room allows. While the take
// runs, the fixture's beeps play on the speakers (macOS), so the mic should
// hear one a second: set HARDWARE_SPEAKER=0 to skip that where it would
// disturb someone. HARDWARE_MIC picks a mic by part of its name, instead of
// the one the app would pick (on a Mac with the lid closed, the built-in mic
// is listed but records silence). Stills, screenshots and a video of the page are attached,
// and report.json sums up what was measured, for a person (or agent) to look at.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureFiles, fixtureSpec as s } from '../fixtures/spec.ts';
import { saveOpfsFile, recordTake } from '../helpers/app.ts';
import { toneOnsets } from '../helpers/beeps.ts';
import { greyFrame } from '../helpers/frame-code.ts';
import { decodeAudio, packetTimes, probeDurationSeconds, probeStreams } from '../helpers/media-file.ts';

test.use({ video: 'on' });

const seconds = Number(process.env.HARDWARE_SECONDS ?? 20);
const speaker = process.platform === 'darwin' && process.env.HARDWARE_SPEAKER !== '0';
const micName = process.env.HARDWARE_MIC;

interface TrackInUse {
	kind: string;
	label: string;
	settings: MediaTrackSettings;
}

const tracksInUse = (page: Page) =>
	page.getByTestId('preview').evaluate((video: HTMLVideoElement) =>
		(video.srcObject as MediaStream).getTracks().map((t) => ({ kind: t.kind, label: t.label, settings: t.getSettings() }))
	);

async function ready(page: Page) {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled({ timeout: 20_000 });
}

/** Plays the fixture's beeps on the default output until stopped. */
function playBeeps(): ChildProcess | null {
	if (!speaker) return null;
	return spawn('afplay', ['-v', '0.5', resolve(fixtureFiles.audio)], { stdio: 'ignore' });
}

/** A frame of `file` as a PNG, for a person to look at. */
function still(file: string, timeSeconds: number, destination: string) {
	execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(timeSeconds), '-i', file, '-frames:v', '1', destination]);
}

const mean = (frame: Buffer) => frame.reduce((sum, v) => sum + v, 0) / frame.length;
const meanDifference = (a: Buffer, b: Buffer) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length;
const largestGap = (times: number[]) => times.slice(1).reduce((max, t, i) => Math.max(max, t - times[i]!), 0);

test('records a take from the real camera and mic', async ({ page, browserName }, testInfo) => {
	test.setTimeout(seconds * 1000 + 150_000);
	await ready(page);
	if (micName) {
		const picker = page.getByRole('combobox', { name: 'Microphone' });
		const label = (await picker.locator('option').allTextContents()).find((l) => l.includes(micName));
		expect(label, `a mic named like "${micName}"`).toBeDefined();
		await picker.selectOption({ label: label! });
		await expect.poll(async () => (await tracksInUse(page)).find((t) => t.kind === 'audio')?.label.trim(), { timeout: 20_000 }).toBe(label!.trim());
		await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
	}
	const inUse: TrackInUse[] = await tracksInUse(page);
	const camera = inUse.find((t) => t.kind === 'video')!;
	const mic = inUse.find((t) => t.kind === 'audio')!;
	await page.screenshot({ path: testInfo.outputPath('1-ready.png') });

	// Started with the countdown, so the take begins in the middle of the beeps, not before them.
	const beeps = playBeeps();
	const session = await recordTake(page, seconds, {
		beforeStop: async () => void (await page.screenshot({ path: testInfo.outputPath('2-capturing.png') }))
	}).finally(() => beeps?.kill());
	await page.screenshot({ path: testInfo.outputPath('3-ready-take.png') });

	const recording = session.recordings[0]!;
	const segment = recording.segments[0]!;
	const file = testInfo.outputPath('take' + segment.path!.slice(segment.path!.lastIndexOf('.')));
	await saveOpfsFile(page, segment.path!, file);
	const duration = probeDurationSeconds(file);
	const streams = probeStreams(file);
	const video = streams.find((st) => st.codec_type === 'video')!;
	const audio = decodeAudio(file, 8000);
	const rms = Math.sqrt(audio.reduce((sum, v) => sum + v * v, 0) / audio.length);
	const heard = toneOnsets(audio, 8000, [s.toneHz, s.markerHz]);
	const videoTimes = packetTimes(file, 'v:0');
	const audioTimes = packetTimes(file, 'a:0');
	const first = greyFrame(file, 2);
	const last = greyFrame(file, duration - 2);
	for (const [name, t] of [['4-start', 2], ['5-middle', duration / 2], ['6-end', duration - 2]] as const) {
		still(file, t, testInfo.outputPath(`${name}.png`));
	}

	const report = {
		browser: browserName,
		camera: { label: camera.label, width: camera.settings.width, height: camera.settings.height, frameRate: camera.settings.frameRate },
		mic: { label: mic.label, sampleRate: mic.settings.sampleRate, channelCount: mic.settings.channelCount },
		recording: { video: recording.video, audio: recording.audio },
		file: { name: file.slice(file.lastIndexOf('/') + 1), seconds: duration, video: `${video.codec_name} ${video.width}×${video.height}` },
		segmentSeconds: segment.durationUs! / 1e6,
		frames: { ...segment.frames, packets: videoTimes.length, perSecond: videoTimes.length / duration, largestGapSeconds: largestGap(videoTimes) },
		audio: { rmsDbfs: rms > 0 ? Math.round(20 * Math.log10(rms)) : 'silent', largestGapSeconds: largestGap(audioTimes), speakerBeeps: speaker ? heard.length : 'skipped' },
		picture: { meanBrightness: mean(first), changeStartToEnd: meanDifference(first, last) }
	};
	writeFileSync(testInfo.outputPath('report.json'), JSON.stringify(report, null, 2));
	await testInfo.attach('report', { path: testInfo.outputPath('report.json'), contentType: 'application/json' });

	// What the camera gives is what the take records.
	expect(recording.video).toMatchObject({ width: camera.settings.width, height: camera.settings.height });
	expect(video).toMatchObject({ width: camera.settings.width, height: camera.settings.height });
	expect(Math.abs(duration - seconds)).toBeLessThan(2);
	expect(Math.abs(duration - segment.durationUs! / 1e6)).toBeLessThan(0.5);

	// Every frame the camera delivered is in the file: issue 03's D2 allows 0.5% lost in Chrome, and
	// the last frame before Stop can miss the file.
	const { delivered, inFile } = segment.frames ?? {};
	if (browserName === 'chromium' && delivered) {
		expect(delivered - inFile!, JSON.stringify(segment.frames)).toBeLessThanOrEqual(Math.max(1, delivered * 0.005));
	}
	// Cameras slow down in low light (the app warns), so a steady stream is checked, not 30 fps.
	expect(videoTimes.length).toBeGreaterThan(duration * 10);
	expect(largestGap(videoTimes)).toBeLessThan(browserName === 'firefox' ? 1.1 : 0.2);
	// A live picture: the sensor's noise alone changes every frame; a frozen or blank feed doesn't.
	expect(report.picture.changeStartToEnd).toBeGreaterThan(0.3);
	expect(report.picture.meanBrightness).toBeGreaterThan(2);

	// Real sound throughout: not digital silence, no holes.
	expect(rms, `${mic.label} recorded digital silence; choose a working mic with HARDWARE_MIC`).toBeGreaterThan(3e-5);
	expect(largestGap(audioTimes)).toBeLessThan(0.1);
	if (speaker) {
		expect(heard.length, `beeps heard at ${heard.map((t) => t.toFixed(2)).join(', ')}`).toBeGreaterThan(seconds * 0.8);
		expect(largestGap(heard)).toBeLessThan(s.beepIntervalSeconds + 0.2);
	}

	// Plays and seeks in the library.
	await page.getByRole('button', { name: 'Play' }).click();
	const seeked = await page.getByTestId('player').evaluate(async (player: HTMLVideoElement, to) => {
		if (player.readyState < 1) await new Promise((done) => player.addEventListener('loadedmetadata', done, { once: true }));
		player.currentTime = to;
		await new Promise((done) => player.addEventListener('seeked', done, { once: true }));
		return { duration: player.duration, currentTime: player.currentTime };
	}, seconds / 2);
	expect(Math.abs(seeked.duration - duration)).toBeLessThan(1);
	expect(Math.abs(seeked.currentTime - seconds / 2)).toBeLessThan(0.5);
});

test('switches between every real camera and mic', async ({ page }, testInfo) => {
	test.setTimeout(120_000);
	await ready(page);
	const outcomes: { picker: string; option: string; result: string }[] = [];

	for (const [picker, kind] of [['Microphone', 'audio'], ['Camera', 'video']] as const) {
		const select = page.getByRole('combobox', { name: picker });
		const options = await select.locator('option').allTextContents();
		for (const [i, option] of options.entries()) {
			await select.selectOption({ index: i });
			// Either the preview now uses that device, or the app says why it can't.
			let result = 'neither in use nor explained';
			for (const deadline = Date.now() + 15_000; Date.now() < deadline; await page.waitForTimeout(250)) {
				const problem = page.getByTestId('device-problem');
				if (await problem.isVisible()) {
					result = `problem shown: ${await problem.innerText()}`;
					break;
				}
				if (!(await page.getByRole('button', { name: 'Record' }).isEnabled())) continue;
				const track = (await tracksInUse(page)).find((t) => t.kind === kind);
				if (track && option.includes(track.label.trim())) {
					result = 'in use';
					break;
				}
			}
			outcomes.push({ picker, option, result });
			await page.screenshot({ path: testInfo.outputPath(`${picker.toLowerCase()}-${i + 1}.png`) });
			if (result.startsWith('problem shown')) await page.getByRole('button', { name: 'Try again' }).click();
		}
		await select.selectOption({ index: 0 });
	}

	writeFileSync(testInfo.outputPath('report.json'), JSON.stringify(outcomes, null, 2));
	await testInfo.attach('report', { path: testInfo.outputPath('report.json'), contentType: 'application/json' });
	expect(outcomes.filter((o) => o.result === 'neither in use nor explained')).toEqual([]);
	expect(outcomes.filter((o) => o.result === "in use").length).toBeGreaterThanOrEqual(2);
});
