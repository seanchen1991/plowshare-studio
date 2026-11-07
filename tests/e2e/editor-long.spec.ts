// An hour-long take opened in the editor (LONG_TEST_MINUTES to shorten it):
// the waveform fills in while the page stays responsive, and memory stays flat
// while the peaks worker decodes the whole hour. Chrome only. The take is made
// with ffmpeg rather than recorded, so this runs in minutes, not an hour.

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { fixtureFiles } from '../fixtures/spec.ts';
import { opfsFileExists } from '../helpers/app.ts';
import { probeDurationSeconds } from '../helpers/media-file.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

const minutes = Number(process.env.LONG_TEST_MINUTES ?? 60);

/** A take like a Chrome recording (H.264 and Opus in MP4) with the fixture's beeps, made once and kept. */
function longTake(): string {
	const file = `${fixtureFiles.dir}/take-${minutes}min.mp4`;
	if (existsSync(file)) return file;
	execFileSync('ffmpeg', [
		'-v', 'error', '-y',
		'-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
		'-stream_loop', '-1', '-i', fixtureFiles.audio,
		'-t', String(minutes * 60),
		'-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60',
		'-c:a', 'libopus', '-b:a', '64k',
		file
	]);
	return file;
}

test(`a ${minutes}-minute take opens in the editor without freezing the page, with flat memory @long`, async ({ page, browser, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium', 'Measures Chrome processes');
	test.setTimeout(20 * 60_000);
	const file = longTake();
	const durationUs = Math.round(probeDurationSeconds(file) * 1e6);

	// Into OPFS as a Ready take, streamed so neither the test nor the page holds the file.
	const server = createServer((_, response) => {
		response.writeHead(200, { 'content-type': 'video/mp4', 'access-control-allow-origin': '*' });
		createReadStream(file).pipe(response);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
	await page.goto('/');
	const session: Session = {
		version: 1,
		id: 'ses_long',
		title: `${minutes} minutes`,
		createdAt: new Date().toISOString(),
		recordings: [
			{
				id: 'rec_01',
				participant: { id: 'par_host', role: 'host' },
				state: 'ready',
				clockOffsetUs: 0,
				video: { codec: 'avc', width: 320, height: 180, fps: 30, bitrate: null },
				audio: { codec: 'opus', channels: 1, sampleRate: 48000, bitrate: 64000, processing: false },
				segments: [
					{ index: 1, path: 'sessions/ses_long/rec_01/seg-01.mp4', rawPath: null, manifestPath: null, startUs: 0, durationUs, downloaded: true, frames: null }
				]
			}
		]
	};
	await page.evaluate(async ({ session, url }) => {
		const sessions = await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions', { create: true });
		const dir = await sessions.getDirectoryHandle(session.id, { create: true });
		const media = await (await dir.getDirectoryHandle('rec_01', { create: true })).getFileHandle('seg-01.mp4', { create: true });
		await (await fetch(url)).body!.pipeTo(await media.createWritable());
		const writable = await (await dir.getFileHandle('session.json', { create: true })).createWritable();
		await writable.write(JSON.stringify(session));
		await writable.close();
	}, { session, url });
	server.close();
	await page.reload();

	// Memory of every renderer (the page and its workers run in one), from the OS.
	const cdp = await browser.newBrowserCDPSession();
	const rendererMB = async () => {
		const { processInfo } = (await cdp.send('SystemInfo.getProcessInfo')) as { processInfo: { type: string; id: number }[] };
		const pids = processInfo.filter((p) => p.type === 'renderer').map((p) => String(p.id));
		const out = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')]).toString();
		return out.trim().split(/\s+/).reduce((sum, kb) => sum + Number(kb), 0) / 1024;
	};
	// How late a 50 ms timer fires: a busy main thread makes it late.
	await page.evaluate(() => {
		const w = window as unknown as { worstLateMs: number };
		w.worstLateMs = 0;
		let expected = performance.now() + 50;
		setInterval(() => {
			w.worstLateMs = Math.max(w.worstLateMs, performance.now() - expected);
			expected = performance.now() + 50;
		}, 50);
	});

	await page.getByRole('tab', { name: 'Takes' }).click();
	const started = Date.now();
	await page.locator('[data-session-id="ses_long"]').getByRole('button', { name: 'Edit' }).click();
	await expect(page.getByTestId('editor')).toBeVisible();
	await page.evaluate(() => ((window as unknown as { worstLateMs: number }).worstLateMs = 0));

	const memoryMB: number[] = [];
	let filledPartway = false;
	const cache = 'sessions/ses_long/rec_01/seg-01.peaks';
	const canvasHas = (fraction: number) =>
		page.getByTestId('lane').locator('canvas').evaluate((canvas: HTMLCanvasElement, fraction) => {
			const x = Math.round(fraction * canvas.width);
			const { data } = canvas.getContext('2d')!.getImageData(Math.max(0, x - 8), 0, 16, canvas.height);
			for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) return true;
			return false;
		}, fraction);
	while (!(await opfsFileExists(page, cache))) {
		memoryMB.push(await rendererMB());
		// The start is drawn while the end is still being decoded.
		if (!filledPartway && (await canvasHas(0.02)) && !(await canvasHas(0.98))) filledPartway = true;
		expect(Date.now() - started).toBeLessThan(15 * 60_000);
		await page.waitForTimeout(2000);
	}
	const seconds = (Date.now() - started) / 1000;
	const worstLateMs = await page.evaluate(() => (window as unknown as { worstLateMs: number }).worstLateMs);
	await expect.poll(() => canvasHas(0.98)).toBe(true);

	// Still responsive afterwards: seeking near the end moves the video there.
	const ruler = page.getByTestId('ruler');
	const box = (await ruler.boundingBox())!;
	await ruler.click({ position: { x: box.width * 0.9, y: box.height / 2 } });
	await expect
		.poll(() => page.getByTestId('editor-video').evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeGreaterThan(minutes * 60 * 0.85);

	const report = { minutes, seconds, worstLateMs, filledPartway, memoryMB };
	await testInfo.attach('report.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
	console.log(`Long editor report: ${JSON.stringify({ ...report, memoryMB: [memoryMB[0], Math.max(...memoryMB), memoryMB.at(-1)] })}`);

	expect(filledPartway).toBe(true);
	// The main thread never stalls long enough to notice.
	expect(worstLateMs).toBeLessThan(200);
	// Flat memory: the hour is decoded a block at a time, never held whole (an hour of decoded audio is ~700 MB).
	expect(Math.max(...memoryMB) - memoryMB[0]!).toBeLessThan(150);
});
