// A device dropping out, or the computer sleeping, mid-take: the Segment closes,
// the take pauses with an alert and a sound, and Resume starts a new Segment in
// the same Recording. Runs in Chrome and Firefox.

import { expect, test, type Page } from '@playwright/test';
import { readOpfsJson, saveOpfsFile } from '../helpers/app.ts';
import { probeDurationSeconds, streamCodecs } from '../helpers/media-file.ts';
import { captureGaps, type Session } from '../../src/lib/storage/session-file.ts';

type TestWindow = Window & { alertTones: number; dropTrack: (track: MediaStreamTrack) => void };

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const w = window as unknown as TestWindow;
		// Counts the alert's tones.
		w.alertTones = 0;
		const create = AudioContext.prototype.createOscillator;
		AudioContext.prototype.createOscillator = function (this: AudioContext) {
			w.alertTones++;
			return create.call(this);
		};
		// Firefox doesn't hand a page-made `ended` event to a track's listeners, so keep them to call directly.
		const listeners = new WeakMap<MediaStreamTrack, Set<EventListener>>();
		const add = MediaStreamTrack.prototype.addEventListener;
		const remove = MediaStreamTrack.prototype.removeEventListener;
		MediaStreamTrack.prototype.addEventListener = function (this: MediaStreamTrack, type: string, listener: EventListener, options?: unknown) {
			if (type === 'ended') listeners.set(this, (listeners.get(this) ?? new Set()).add(listener));
			return add.call(this, type, listener, options as AddEventListenerOptions);
		} as typeof add;
		MediaStreamTrack.prototype.removeEventListener = function (this: MediaStreamTrack, type: string, listener: EventListener, options?: unknown) {
			if (type === 'ended') listeners.get(this)?.delete(listener);
			return remove.call(this, type, listener, options as EventListenerOptions);
		} as typeof remove;
		// Ends a track the way unplugging does: it stops, then `ended` fires (stop() alone doesn't fire it).
		w.dropTrack = (track) => {
			track.stop();
			for (const listener of [...(listeners.get(track) ?? [])]) listener(new Event('ended'));
		};
	});
	await page.goto('/');
});

/** Unplugs the camera or mic, as far as the take can tell. */
async function dropTrack(page: Page, kind: 'audio' | 'video') {
	await page.getByTestId('preview').evaluate((video: HTMLVideoElement, kind) => {
		const stream = video.srcObject as MediaStream;
		(window as unknown as TestWindow).dropTrack(kind === 'audio' ? stream.getAudioTracks()[0]! : stream.getVideoTracks()[0]!);
	}, kind);
}

async function currentSession(page: Page): Promise<Session> {
	const id = await page.evaluate(async () => {
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
		const names: string[] = [];
		for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
		return names.sort().at(-1)!;
	});
	return readOpfsJson<Session>(page, `sessions/${id}/session.json`);
}

async function startRecording(page: Page) {
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByText('REC', { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function waitUntilReady(page: Page): Promise<Session> {
	const take = page.getByTestId('session').first();
	await expect(take).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
	return readOpfsJson<Session>(page, `sessions/${await take.getAttribute('data-session-id')}/session.json`);
}

test('a mic dropping out pauses the take; Resume carries on in a new Segment of the same Recording', async ({ page }, testInfo) => {
	test.setTimeout(120_000);
	await startRecording(page);
	await page.waitForTimeout(6000);
	await dropTrack(page, 'audio');

	const alert = page.getByTestId('paused-alert');
	await expect(alert).toContainText(/Microphone disconnected at 0:0[5-7]\. Recording paused\./);
	expect(await page.evaluate(() => (window as unknown as TestWindow).alertTones)).toBeGreaterThan(0);
	await expect(page.getByText('PAUSED', { exact: true })).toBeVisible();
	const pausedAt = await page.getByTestId('elapsed').locator('.time').innerText();
	// The Segment is closed and the Recording is Paused on disk.
	await expect.poll(async () => (await currentSession(page)).recordings[0]!.state).toBe('paused');
	expect((await currentSession(page)).recordings[0]!.segments).toHaveLength(1);

	// The devices are open again and can be changed before resuming.
	await expect(page.getByRole('combobox', { name: 'Microphone' })).toBeEnabled();
	await page.waitForTimeout(2000);
	await page.getByRole('button', { name: 'Resume' }).click();
	await expect(page.getByTestId('countdown')).toBeVisible();
	await expect(page.getByText('REC', { exact: true })).toBeVisible({ timeout: 10_000 });
	await expect(alert).toBeHidden();
	// The elapsed time carries on from where it paused.
	expect((await page.getByTestId('elapsed').locator('.time').innerText()) >= pausedAt).toBe(true);
	await page.waitForTimeout(6000);
	await page.getByRole('button', { name: 'Stop' }).click();

	const session = await waitUntilReady(page);
	expect(session.recordings).toHaveLength(1);
	const recording = session.recordings[0]!;
	expect(recording.segments.map((s) => s.index)).toEqual([1, 2]);
	expect(recording.segments[0]!.startUs).toBe(0);
	// The Capture gap: about 2 s waiting, the 3 s countdown and reopening the devices.
	const gaps = captureGaps(recording);
	expect(gaps).toHaveLength(1);
	expect(gaps[0]!.durationUs / 1e6).toBeGreaterThan(4);
	expect(gaps[0]!.durationUs / 1e6).toBeLessThan(15);

	// Both Segments are playable files with video and sound.
	for (const segment of recording.segments) {
		expect(segment.rawPath).toBeNull();
		expect(Math.abs(segment.durationUs! / 1e6 - 6)).toBeLessThan(2);
		const file = testInfo.outputPath(segment.path!.split('/').at(-1)!);
		await saveOpfsFile(page, segment.path!, file);
		expect(streamCodecs(file)).toHaveLength(2);
		expect(Math.abs(probeDurationSeconds(file) - segment.durationUs! / 1e6)).toBeLessThan(0.5);
	}
});

test('Stop from Paused finishes the take with the Segments it has', async ({ page }) => {
	test.setTimeout(90_000);
	await startRecording(page);
	await page.waitForTimeout(4000);
	await dropTrack(page, 'video');
	await expect(page.getByTestId('paused-alert')).toContainText(/Camera disconnected at 0:0\d\. Recording paused\./);

	// Esc cancels the countdown to resume and goes back to Paused.
	await page.getByRole('button', { name: 'Resume' }).click();
	await expect(page.getByText(/Recording resumes in/)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

	await page.getByRole('button', { name: 'Stop' }).click();
	const session = await waitUntilReady(page);
	expect(session.recordings[0]!.segments).toHaveLength(1);
	expect(session.recordings[0]!.segments[0]!.path).not.toBeNull();
	await expect(page.getByTestId('paused-alert')).toBeHidden();
	await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
});

test('the computer sleeping pauses the take', async ({ page }) => {
	test.setTimeout(90_000);
	await startRecording(page);
	await page.waitForTimeout(3000);
	// Waking from a minute's sleep: the wall clock has run ahead of the monotonic one.
	await page.evaluate(() => {
		const now = Date.now.bind(Date);
		Date.now = () => now() + 60_000;
	});
	await expect(page.getByTestId('paused-alert')).toContainText(/Recording paused at 0:0\d while your computer slept\./, { timeout: 5000 });

	await page.getByRole('button', { name: 'Resume' }).click();
	await expect(page.getByText('REC', { exact: true })).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(3000);
	await page.getByRole('button', { name: 'Stop' }).click();
	const recording = (await waitUntilReady(page)).recordings[0]!;
	expect(recording.segments).toHaveLength(2);
	// The minute asleep is part of the Capture gap.
	expect(captureGaps(recording)[0]!.durationUs / 1e6).toBeGreaterThan(60);
});
