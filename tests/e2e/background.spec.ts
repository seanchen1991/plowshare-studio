// A take keeps everything while its tab sits in the background, with the
// browser's background throttling left on (Playwright normally turns it off).
// The browser is launched without Playwright, which would otherwise keep the
// tab "visible"; the take is saved with the app's own Download button, still
// in the background. Firefox needs a regular installed Firefox (see
// raw-browser.ts) and uses its own fake devices: the Web Audio stand-in from
// fake-media.ts runs at several times real speed in a hidden tab of a real
// Firefox. They play a steady tone, so there the check is that audio and video
// packets run without a gap from start to end. One minute on every push; ten
// minutes (past Chrome's five-minute intensive throttling) with the long tests.

import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fixtureSpec as s } from '../fixtures/spec.ts';
import { detectBeeps } from '../helpers/beeps.ts';
import { decodeAudio, packetTimes, probeDurationSeconds } from '../helpers/media-file.ts';
import { installedFirefox, launchChrome, launchFirefox, type RawBrowser } from '../helpers/raw-browser.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

const runs = [
	{ minutes: 1, tag: '' },
	{ minutes: Number(process.env.BACKGROUND_MINUTES ?? 10), tag: ' @long' }
];

/** Polls an expression in the page until it is truthy. */
async function waitFor(browser: RawBrowser, expression: string, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (!(await browser.evaluate<boolean>(expression))) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${expression}`);
		await new Promise((done) => setTimeout(done, 250));
	}
}

/** The big Record or Stop button (the tab bar has a "Record" tab too). */
const button = (label: string) => `[...document.querySelectorAll('button.big')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;

/** Waits for a finished download (not a .part or .crdownload file) whose size has settled. */
async function downloadedFile(dir: string, timeoutMs = 120_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let last = { path: '', size: -1 };
	while (Date.now() < deadline) {
		const name = readdirSync(dir).find((n) => !/\.(part|crdownload)$/.test(n) && !n.startsWith('.'));
		if (name) {
			const path = join(dir, name);
			const size = statSync(path).size;
			if (path === last.path && size === last.size && size > 0) return path;
			last = { path, size };
		}
		await new Promise((done) => setTimeout(done, 500));
	}
	throw new Error(`No finished download in ${dir}: ${readdirSync(dir).join(', ')}`);
}

for (const { minutes, tag } of runs) {
	test(`a ${minutes}-minute take in a background tab loses nothing${tag}`, async ({ playwright, browserName }, testInfo) => {
		test.setTimeout((minutes + 4) * 60_000);
		const firefox = browserName === 'firefox' ? installedFirefox() : null;
		test.skip(browserName === 'firefox' && !firefox, 'Needs an installed Firefox: Playwright’s build never hides a tab');
		const profile = testInfo.outputPath('profile');
		const downloads = testInfo.outputPath('downloads');
		mkdirSync(profile, { recursive: true });
		mkdirSync(downloads, { recursive: true });
		const { launchOptions, baseURL } = testInfo.project.use;
		const raw = firefox
			? await launchFirefox(firefox, profile, downloads, launchOptions?.firefoxUserPrefs ?? {})
			: await launchChrome(playwright.chromium, profile, downloads, launchOptions?.args ?? []);

		try {
			await raw.open(`${baseURL}/`);
			await waitFor(raw, `${button('Record')}?.disabled === false`);
			await raw.evaluate(`${button('Record')}.click()`);
			await waitFor(raw, `!!document.querySelector('[data-testid=elapsed]')`, 10_000);

			// Count how often a page timer fires once hidden, to see what throttling the browser applies.
			await raw.evaluate(`(window.ticks = 0, setInterval(() => window.ticks++, 100), true)`);
			await raw.coverWithAnotherTab();
			const hiddenAt = Date.now();
			await waitFor(raw, `document.visibilityState === 'hidden'`, 5_000);

			await new Promise((done) => setTimeout(done, minutes * 60_000));
			const hiddenSeconds = (Date.now() - hiddenAt) / 1000;
			expect(await raw.evaluate<string>('document.visibilityState')).toBe('hidden');
			const ticksPerSecond = (await raw.evaluate<number>('window.ticks')) / hiddenSeconds;
			testInfo.annotations.push({ type: 'page timer while hidden', description: `${ticksPerSecond.toFixed(2)} per second (10 when visible)` });

			// Stopped and downloaded while still hidden, so Finalizing runs in the background too.
			await raw.evaluate(`${button('Stop')}.click()`);
			await waitFor(raw, `document.querySelector('[data-testid=session]')?.dataset.state === 'ready'`, 120_000);
			const session = await raw.evaluate<Session>(`(async () => {
				const id = document.querySelector('[data-testid=session]').dataset.sessionId;
				const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions')).getDirectoryHandle(id);
				return JSON.parse(await (await (await dir.getFileHandle('session.json')).getFile()).text());
			})()`);
			const segment = session.recordings[0]!.segments[0]!;
			await raw.evaluate(`[...document.querySelectorAll('[data-testid=session] button')].find((b) => b.textContent.trim() === 'Download').click()`);
			const file = await downloadedFile(downloads);
			expect(await raw.evaluate<string>('document.visibilityState')).toBe('hidden');

			const duration = probeDurationSeconds(file);
			testInfo.annotations.push({ type: 'take', description: `${duration} s in ${file.slice(downloads.length + 1)}, hidden ${hiddenSeconds.toFixed(1)} s, frames ${JSON.stringify(segment.frames)}` });
			expect(duration).toBeGreaterThan(hiddenSeconds);
			expect(duration).toBeLessThan(hiddenSeconds + 10);

			// No stretch of audio or video missing anywhere, start to end.
			const largestGap = (times: number[]) => times.slice(1).reduce((max, t, i) => Math.max(max, t - times[i]!), 0);
			const audio = packetTimes(file, 'a:0');
			const video = packetTimes(file, 'v:0');
			testInfo.annotations.push({ type: 'gaps', description: `audio ${largestGap(audio)} s, video ${largestGap(video)} s` });
			expect(audio[0]!).toBeLessThan(0.5);
			expect(duration - audio.at(-1)!).toBeLessThan(0.5);
			expect(largestGap(audio)).toBeLessThan(0.1);
			expect(largestGap(video)).toBeLessThan(0.2);
			expect(video.length).toBeGreaterThan(duration * s.fps * 0.95);

			// Chrome plays the fixture: a beep every second, none missing.
			if (!firefox) {
				const sampleRate = 8000;
				const beeps = detectBeeps(decodeAudio(file, sampleRate), sampleRate);
				expect(beeps.length).toBeGreaterThanOrEqual(Math.floor(duration) - 1);
				expect(beeps[0]!.timeSeconds).toBeLessThan(1.5);
				expect(duration - beeps.at(-1)!.timeSeconds).toBeLessThan(1.5);
				expect(largestGap(beeps.map((b) => b.timeSeconds))).toBeLessThan(s.beepIntervalSeconds + 0.1);
			}
				} finally {
			await raw.close();
		}
	});
}
