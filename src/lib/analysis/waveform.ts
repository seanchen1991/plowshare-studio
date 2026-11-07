// A Segment's waveform peaks, from their cache next to the Segment when there
// is one, otherwise computed in the peaks worker.

import { fileExists, readFile } from '../storage/opfs.ts';
import { peakCount } from './peaks.ts';
import type { PeaksRequest, PeaksResponse } from './peaks.protocol.ts';

/** Where a Segment's peaks are cached: beside its file, named after it. */
export function peaksCachePath(segmentPath: string): string {
	return segmentPath.replace(/\.[^./]+$/, '') + '.peaks';
}

/**
 * Delivers a Segment's peaks to `onPeaks` as they become known, starting at bin
 * `from`, and resolves once all are in. Aborting stops the worker.
 */
export async function loadPeaks(
	segment: { path: string; durationUs: number },
	onPeaks: (from: number, peaks: Uint8Array) => void,
	signal: AbortSignal
): Promise<void> {
	const cachePath = peaksCachePath(segment.path);
	if (await fileExists(cachePath)) {
		const cached = new Uint8Array(await (await readFile(cachePath)).arrayBuffer());
		// A cache of the wrong length was made some other way: compute again.
		if (cached.length === peakCount(segment.durationUs)) {
			if (!signal.aborted) onPeaks(0, cached);
			return;
		}
	}
	if (signal.aborted) return;

	const worker = new Worker(new URL('./peaks.worker.ts', import.meta.url), { type: 'module' });
	const stop = () => worker.terminate();
	signal.addEventListener('abort', stop);
	try {
		await new Promise<void>((resolve, reject) => {
			signal.addEventListener('abort', () => resolve());
			worker.onmessage = (event: MessageEvent<PeaksResponse>) => {
				const message = event.data;
				if (message.type === 'peaks') onPeaks(message.from, message.peaks);
				else if (message.type === 'done') resolve();
				else reject(new Error(message.message));
			};
			worker.onerror = (event) => reject(new Error(event.message || 'The peaks worker failed'));
			worker.postMessage({ path: segment.path, durationUs: segment.durationUs, cachePath } satisfies PeaksRequest);
		});
	} finally {
		signal.removeEventListener('abort', stop);
		worker.terminate();
	}
}
