// An hour-long take with the fixture (LONG_TEST_MINUTES to shorten it), held to
// the automated threshold from issue 03: the recorder loses at most 0.1% of the
// frames the camera delivered, with no gap over 200 ms after the first second,
// no missing beeps, and flat memory.

import { expect, test } from '@playwright/test';
import { fixtureSpec as s } from '../fixtures/spec.ts';
import { saveOpfsFile } from '../helpers/app.ts';
import { detectBeeps } from '../helpers/beeps.ts';
import { decodeAudio, probeDurationSeconds, videoFrameTimes } from '../helpers/media-file.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

const minutes = Number(process.env.LONG_TEST_MINUTES ?? 60);

test(`records a ${minutes}-minute take without losing frames or audio @long`, async ({ page }, testInfo) => {
	test.setTimeout((minutes + 15) * 60_000);
	await page.goto('/');
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });

	const heapMB: number[] = [];
	for (let minute = 0; minute < minutes; minute++) {
		await page.waitForTimeout(60_000);
		heapMB.push(
			await page.evaluate(() => {
				const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
				return memory ? memory.usedJSHeapSize / 1e6 : 0;
			})
		);
	}
	await page.getByRole('button', { name: 'Stop' }).click();

	const take = page.getByTestId('session').first();
	await expect(take).toHaveAttribute('data-state', 'ready', { timeout: 10 * 60_000 });
	const sessionId = (await take.getAttribute('data-session-id'))!;
	const session = await page.evaluate(async (id) => {
		const root = await navigator.storage.getDirectory();
		const dir = await (await root.getDirectoryHandle('sessions')).getDirectoryHandle(id);
		return JSON.parse(await (await (await dir.getFileHandle('session.json')).getFile()).text()) as Session;
	}, sessionId);
	const segment = session.recordings[0]!.segments[0]!;

	const file = testInfo.outputPath('take' + segment.path!.slice(segment.path!.lastIndexOf('.')));
	await saveOpfsFile(page, segment.path!, file);
	const duration = probeDurationSeconds(file);
	const report: Record<string, unknown> = { minutes, duration, frames: segment.frames, heapMB };

	// Frames: lost by the recorder, and gaps after the first second.
	const { delivered, inFile } = segment.frames!;
	const lostPercent = ((delivered! - inFile!) / delivered!) * 100;
	const times = videoFrameTimes(file);
	let maxGapMs = 0;
	for (let i = 1; i < times.length; i++) {
		if (times[i - 1]! >= 1) maxGapMs = Math.max(maxGapMs, (times[i]! - times[i - 1]!) * 1000);
	}
	Object.assign(report, { lostPercent, maxGapMs });

	// Audio: a beep at the start of every second, none missing.
	const sampleRate = 8000;
	const beeps = detectBeeps(decodeAudio(file, sampleRate), sampleRate);
	const longestBeepGap = beeps.slice(1).reduce((max, beep, i) => Math.max(max, beep.timeSeconds - beeps[i]!.timeSeconds), 0);
	Object.assign(report, { beeps: beeps.length, longestBeepGap });

	await testInfo.attach('report.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
	console.log(`Long take report: ${JSON.stringify(report)}`);

	expect(Math.abs(duration - minutes * 60)).toBeLessThan(5);
	expect(lostPercent).toBeLessThanOrEqual(0.1);
	expect(maxGapMs).toBeLessThanOrEqual(200);
	expect(beeps.length).toBeGreaterThanOrEqual(Math.floor(duration) - 1);
	expect(longestBeepGap).toBeLessThan(s.beepIntervalSeconds + 0.1);
	// Flat memory: no growth beyond 50 MB between the first and last minute (chunks are never held in memory).
	expect(heapMB.at(-1)! - heapMB[0]!).toBeLessThan(50);
});
