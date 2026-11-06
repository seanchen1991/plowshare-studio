// What the browser lets this site store, for Recording time left, and whether
// it lets it store anything at all.

import { fileExists, readFile } from './opfs.ts';
import { listSessions } from './sessions.ts';
import type { StorageMeasure } from './time-left.ts';

/**
 * Firefox refuses its file storage to private windows (a SecurityError),
 * and so does any browser told not to let this site store data. Chrome's
 * incognito windows can't be told apart: they report the same quota.
 */
export async function storageRefused(): Promise<boolean> {
	try {
		await navigator.storage.getDirectory();
		return false;
	} catch (error) {
		if ((error as DOMException).name === 'SecurityError') return true;
		throw error;
	}
}

/** Whether a write failed because the browser ran out of room (Chrome and Firefox word it differently). */
export function isOutOfRoom(message: string): boolean {
	return /quota|no space|disk is full|not enough space/i.test(message);
}

/**
 * Measures storage now. Raw files of every Session but `capturingSessionId`
 * are sized from disk; the take being captured adds `capturingRawBytes`, since
 * its raw file is held open by the chunk writer.
 */
export async function measureStorage(capturingSessionId?: string, capturingRawBytes = 0): Promise<StorageMeasure> {
	const [{ quota = 0, usage = 0 }, sessions] = await Promise.all([navigator.storage.estimate(), listSessions()]);
	const rawPaths = sessions
		.filter((s) => s.id !== capturingSessionId)
		.flatMap((s) => s.recordings.flatMap((r) => r.segments.map((seg) => seg.rawPath)))
		.filter((p): p is string => p !== null);
	const sizes = await Promise.all(rawPaths.map(async (p) => ((await fileExists(p)) ? (await readFile(p)).size : 0)));
	return { quota, usage, rawBytes: sizes.reduce((sum, size) => sum + size, 0) + capturingRawBytes };
}
