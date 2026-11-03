// Drives the app and reads what it stored in OPFS.

import { expect, type Page } from '@playwright/test';
import type { Session } from '../../src/lib/storage/session-file.ts';

/** Records a take of about `seconds` and waits until it is Ready. Returns its Session file. */
export async function recordTake(page: Page, seconds: number, { finalizeTimeoutMs = 60_000 } = {}): Promise<Session> {
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(page.getByTestId('elapsed')).toBeVisible();
	await page.waitForTimeout(seconds * 1000);
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
