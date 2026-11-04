import { expect, test } from '@playwright/test';
import { fixtureSpec as s } from '../fixtures/spec.ts';
import { opfsFileExists, recordTake, saveOpfsFile } from '../helpers/app.ts';
import { detectBeeps } from '../helpers/beeps.ts';
import { greyFrame, readFrameCode } from '../helpers/frame-code.ts';
import { decodeAudio, probeDurationSeconds, probeStreams, streamCodecs } from '../helpers/media-file.ts';

const seconds = 30;

test('records a take, finalizes it and plays it back with seeking', async ({ page }, testInfo) => {
	test.setTimeout(150_000);
	await page.goto('/');
	let elapsedSeconds = 0;
	const session = await recordTake(page, seconds, {
		beforeStop: async () => {
			const [m, s] = (await page.getByTestId('elapsed').locator('.time').innerText()).split(':').map(Number);
			elapsedSeconds = m! * 60 + s!;
		}
	});

	// The Session file follows the brief's shape.
	expect(session.version).toBe(1);
	expect(session.recordings).toHaveLength(1);
	const recording = session.recordings[0]!;
	expect(recording.state).toBe('ready');
	expect(recording.participant.role).toBe('host');
	expect(recording.video).toMatchObject({ width: s.width, height: s.height });
	expect(recording.segments).toHaveLength(1);
	const segment = recording.segments[0]!;
	expect(segment.startUs).toBe(0);
	expect(Math.abs(segment.durationUs! / 1e6 - seconds)).toBeLessThan(2);
	// The elapsed time shown (whole seconds) matches the finished Recording.
	expect(Math.abs(segment.durationUs! / 1e6 - elapsedSeconds)).toBeLessThan(1.5);

	// Finished as MP4 for H.264, WebM otherwise (ADR 0003); the raw file and manifest are gone.
	expect(segment.path).toMatch(recording.video!.codec === 'avc' ? /seg-01\.mp4$/ : /seg-01\.webm$/);
	expect(segment.rawPath).toBeNull();
	expect(await opfsFileExists(page, `sessions/${session.id}/rec_01/seg-01.raw`)).toBe(false);
	expect(await opfsFileExists(page, `sessions/${session.id}/rec_01/seg-01.manifest.jsonl`)).toBe(false);

	// Frames delivered by the camera and frames in the file are both recorded.
	expect(segment.frames!.delivered).toBeGreaterThan(0);
	expect(segment.frames!.inFile).toBeGreaterThan(0);

	// The file itself: both tracks, the right length, and a beep every second throughout.
	const file = testInfo.outputPath('take' + segment.path!.slice(segment.path!.lastIndexOf('.')));
	await saveOpfsFile(page, segment.path!, file);
	expect(streamCodecs(file)).toHaveLength(2);

	// Capture quality: the file holds what the Session file says, at the fixture's 720p.
	const streams = probeStreams(file);
	const video = streams.find((st) => st.codec_type === 'video')!;
	const audio = streams.find((st) => st.codec_type === 'audio')!;
	const ffprobeNames: Record<string, string> = { avc: 'h264', vp9: 'vp9', vp8: 'vp8' };
	expect(video.codec_name).toBe(ffprobeNames[recording.video!.codec]);
	expect(video).toMatchObject({ width: s.width, height: s.height });
	expect(recording.video!.bitrate).toBe(3_500_000);
	expect(audio.codec_name).toBe('opus');
	expect(audio.channels).toBe(recording.audio.channels);
	expect(Number(audio.sample_rate)).toBe(recording.audio.sampleRate);
	expect(recording.audio).toMatchObject({ codec: 'opus', sampleRate: 48000, bitrate: 160_000, processing: false });
	expect(Math.abs(probeDurationSeconds(file) - segment.durationUs! / 1e6)).toBeLessThan(0.5);
	// Not mirrored: the fixture's frame counter reads correctly, about 300 frames over 10 s
	// (a busy machine's fake camera skips some). Read mirrored, the boxes give nonsense.
	const loopFrames = s.loopSeconds * s.fps;
	const codes = [readFrameCode(greyFrame(file, 5)), readFrameCode(greyFrame(file, 15))];
	const counted = (codes[1]! - codes[0]! + loopFrames) % loopFrames;
	expect(codes.every((code) => code < loopFrames), `frame codes ${codes.join(', ')}`).toBe(true);
	expect(counted, `frame codes ${codes.join(', ')}`).toBeGreaterThan(10 * s.fps * 0.7);
	expect(counted, `frame codes ${codes.join(', ')}`).toBeLessThan(10 * s.fps + 15);

	const sampleRate = 8000;
	const beeps = detectBeeps(decodeAudio(file, sampleRate), sampleRate);
	const duration = probeDurationSeconds(file);
	expect(beeps.length).toBeGreaterThanOrEqual(Math.floor(duration) - 1);
	expect(beeps[0]!.timeSeconds).toBeLessThan(1.5);
	expect(duration - beeps.at(-1)!.timeSeconds).toBeLessThan(1.5);
	for (let i = 1; i < beeps.length; i++) {
		expect(Math.abs(beeps[i]!.timeSeconds - beeps[i - 1]!.timeSeconds - s.beepIntervalSeconds)).toBeLessThan(0.1);
	}

	// Plays in the library, with seeking.
	await page.getByRole('button', { name: 'Play' }).click();
	const player = page.getByTestId('player');
	const seeked = await player.evaluate(async (video: HTMLVideoElement) => {
		if (video.readyState < 1) await new Promise((done) => video.addEventListener('loadedmetadata', done, { once: true }));
		const duration = video.duration;
		video.currentTime = 20;
		await new Promise((done) => video.addEventListener('seeked', done, { once: true }));
		return { duration, currentTime: video.currentTime };
	});
	expect(Math.abs(seeked.duration - seconds)).toBeLessThan(2);
	expect(Math.abs(seeked.currentTime - 20)).toBeLessThan(0.5);
});

test('tells the user when the camera only provides 720p', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('resolution-notice')).toHaveText(
		`Your camera only provides ${s.height}p, so this take records at ${s.height}p.`,
		{ timeout: 10_000 }
	);
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByTestId('resolution-notice')).toBeHidden();
});
