// Drives the app and reads what it stored in OPFS.

import { expect, type Page } from '@playwright/test';
import type { Session } from '../../src/lib/storage/session-file.ts';

/**
 * Records a take of about `seconds` (after the 3-2-1 countdown) and waits until
 * it is Ready. Returns its Session file. `beforeStop` runs just before Stop.
 */
export async function recordTake(
	page: Page,
	seconds: number,
	{ finalizeTimeoutMs = 60_000, beforeStop }: { finalizeTimeoutMs?: number; beforeStop?: () => Promise<void> } = {}
): Promise<Session> {
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(seconds * 1000);
	await beforeStop?.();
	await page.getByRole('button', { name: 'Stop' }).click();

	const take = page.getByTestId('session').first();
	await expect(take).toHaveAttribute('data-state', 'ready', { timeout: finalizeTimeoutMs });
	const sessionId = (await take.getAttribute('data-session-id'))!;
	return readOpfsJson<Session>(page, `sessions/${sessionId}/session.json`);
}

export function readOpfsJson<T>(page: Page, path: string): Promise<T> {
	return page.evaluate(async (path) => {
		let dir = await navigator.storage.getDirectory();
		const parts = path.split('/');
		for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
		const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile();
		return JSON.parse(await file.text());
	}, path);
}

export function opfsFileExists(page: Page, path: string): Promise<boolean> {
	return page.evaluate(async (path) => {
		try {
			let dir = await navigator.storage.getDirectory();
			const parts = path.split('/');
			for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
			await dir.getFileHandle(parts.at(-1)!);
			return true;
		} catch {
			return false;
		}
	}, path);
}

/** Copies a file out of OPFS to `destination` on disk, through a download (works for multi-gigabyte files). */
export async function saveOpfsFile(page: Page, path: string, destination: string): Promise<void> {
	const download = page.waitForEvent('download', { timeout: 120_000 });
	await page.evaluate(async (path) => {
		let dir = await navigator.storage.getDirectory();
		const parts = path.split('/');
		for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
		const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile();
		const link = document.createElement('a');
		link.href = URL.createObjectURL(file);
		link.download = parts.at(-1)!;
		link.click();
	}, path);
	await (await download).saveAs(destination);
}

export interface SeedSegment {
	/** File extension of the finished file. */
	extension: string;
	bytes: number;
	durationUs: number;
	downloaded?: boolean;
}

/**
 * Writes a Ready take straight into OPFS, with finished files of the given
 * sizes (zeros, not playable), then reloads so the app lists it. Faster than
 * recording, and allows several Segments before the app can record them.
 */
export async function seedTake(page: Page, options: { title: string; createdAt: string; segments: SeedSegment[] }): Promise<Session> {
	const id = `ses_seed${Math.random().toString(36).slice(2, 8)}`;
	let startUs = 0;
	const session: Session = {
		version: 1,
		id,
		title: options.title,
		createdAt: options.createdAt,
		recordings: [
			{
				id: 'rec_01',
				participant: { id: 'par_host', role: 'host' },
				state: 'ready',
				clockOffsetUs: 0,
				video: { codec: 'avc', width: 1920, height: 1080, fps: 30, bitrate: 6_000_000 },
				audio: { codec: 'opus', channels: 1, sampleRate: 48000, bitrate: 160_000, processing: false },
				segments: options.segments.map((seg, i) => {
					const segment = {
						index: i + 1,
						path: `sessions/${id}/rec_01/seg-0${i + 1}.${seg.extension}`,
						rawPath: null,
						manifestPath: null,
						startUs,
						durationUs: seg.durationUs,
						downloaded: seg.downloaded ?? false,
						frames: null
					};
					startUs += seg.durationUs + 5_000_000;
					return segment;
				})
			}
		]
	};
	const files = session.recordings[0]!.segments.map((s, i) => ({ path: s.path!, bytes: options.segments[i]!.bytes }));
	await page.evaluate(
		async ({ session, files }) => {
			async function open(path: string) {
				let dir = await navigator.storage.getDirectory();
				const parts = path.split('/');
				for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: true });
				return (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
			}
			const block = new Uint8Array(8 * 1024 * 1024);
			for (const { path, bytes } of files) {
				const writable = await open(path);
				for (let written = 0; written < bytes; written += block.length) await writable.write(block.subarray(0, Math.min(block.length, bytes - written)));
				await writable.close();
			}
			const writable = await open(`sessions/${session.id}/session.json`);
			await writable.write(JSON.stringify(session));
			await writable.close();
		},
		{ session, files }
	);
	await page.reload();
	return session;
}
