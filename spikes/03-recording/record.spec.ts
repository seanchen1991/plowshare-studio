// Probes MediaRecorder format support and hardware-encoding hints, then records
// a short take with every supported format, saving each chunk as it arrived.
// Output: out/<os>-<browser>/support.json and out/<os>-<browser>/<format>/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import {
	audioBitsPerSecond,
	candidates,
	recordSeconds,
	slug,
	timesliceMs,
	videoBitsPerSecond
} from './candidates.ts';

const os = process.env.SPIKE_OS ?? process.platform;

test('probe and record every supported format', async ({ page, browserName }, testInfo) => {
	const outDir = join(import.meta.dirname, 'out', `${os}-${testInfo.project.name}`);
	mkdirSync(outDir, { recursive: true });
	await page.goto('/');

	const support = await page.evaluate(async (list) => {
		const results = [];
		for (const c of list) {
			const supported = MediaRecorder.isTypeSupported(c.mimeType);
			let encodingInfo: unknown = null;
			try {
				const info = await navigator.mediaCapabilities.encodingInfo(
					c.videoCodec
						? {
								type: 'record',
								video: { contentType: c.videoCodec, width: 1920, height: 1080, bitrate: 6_000_000, framerate: 30 }
							}
						: {
								type: 'record',
								audio: { contentType: c.audioCodec, channels: '1', bitrate: 160_000, samplerate: 48_000 }
							}
				);
				encodingInfo = { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
			} catch (error) {
				encodingInfo = { error: String(error) };
			}
			results.push({ mimeType: c.mimeType, supported, encodingInfo });
		}
		return { userAgent: navigator.userAgent, results };
	}, candidates);

	writeFileSync(join(outDir, 'support.json'), JSON.stringify({ os, browser: testInfo.project.name, browserName, ...support }, null, 2));

	for (const { mimeType, supported } of support.results) {
		if (!supported) continue;
		const candidate = candidates.find((c) => c.mimeType === mimeType)!;
		const result = await page.evaluate(
			async ({ mimeType, video, seconds, timeslice, vbps, abps }) => {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: video ? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } : false,
					audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
				});
				const settings = stream.getTracks().map((t) => ({ kind: t.kind, ...t.getSettings() }));
				const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: vbps, audioBitsPerSecond: abps });
				const chunks: { atMs: number; data: Blob }[] = [];
				const start = performance.now();
				recorder.ondataavailable = (e) => chunks.push({ atMs: performance.now() - start, data: e.data });
				const stopped = new Promise<void>((done) => (recorder.onstop = () => done()));
				let error: string | null = null;
				recorder.onerror = (e) => (error = String((e as ErrorEvent).error ?? e));
				recorder.start(timeslice);
				await new Promise((done) => setTimeout(done, seconds * 1000));
				recorder.stop();
				await stopped;
				stream.getTracks().forEach((t) => t.stop());

				const toBase64 = async (blob: Blob) => {
					const bytes = new Uint8Array(await blob.arrayBuffer());
					let binary = '';
					for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
					return btoa(binary);
				};
				return {
					requestedMimeType: mimeType,
					actualMimeType: recorder.mimeType,
					error,
					settings,
					chunks: await Promise.all(chunks.map(async (c) => ({ atMs: c.atMs, size: c.data.size, base64: await toBase64(c.data) })))
				};
			},
			{
				mimeType,
				video: candidate.videoCodec !== null,
				seconds: recordSeconds,
				timeslice: timesliceMs,
				vbps: videoBitsPerSecond,
				abps: audioBitsPerSecond
			}
		);

		const dir = join(outDir, slug(mimeType));
		mkdirSync(dir, { recursive: true });
		result.chunks.forEach((c, i) => writeFileSync(join(dir, `chunk-${String(i).padStart(4, '0')}.bin`), Buffer.from(c.base64, 'base64')));
		const { chunks, ...meta } = result;
		writeFileSync(
			join(dir, 'meta.json'),
			JSON.stringify({ ...meta, recordSeconds, timesliceMs, chunks: chunks.map(({ atMs, size }) => ({ atMs, size })) }, null, 2)
		);
	}
});
