// Runs Finalizing for a Recording: each unfinished Segment goes through the
// finalize worker, then the Session file is updated, and only then are the raw
// file and manifest deleted.

import { removeFile } from '../storage/opfs.ts';
import { segmentPaths, updateRecording, updateSegment, type Session } from '../storage/session-file.ts';
import { changeSession, loadSession } from '../storage/sessions.ts';
import type { FinalizeRequest, FinalizeResponse, FinalizeResult } from './finalize.protocol.ts';

function runWorker(request: FinalizeRequest, onProgress: (progress: number) => void): Promise<FinalizeResult> {
	const worker = new Worker(new URL('./finalize.worker.ts', import.meta.url), { type: 'module' });
	return new Promise<FinalizeResult>((resolve, reject) => {
		worker.onmessage = (event: MessageEvent<FinalizeResponse>) => {
			const message = event.data;
			if (message.type === 'progress') onProgress(message.progress);
			else if (message.type === 'done') resolve(message.result);
			else reject(new Error(message.message));
		};
		worker.onerror = (event) => reject(new Error(event.message || 'The finalize worker failed'));
		worker.postMessage(request);
	}).finally(() => worker.terminate());
}

/** Finalizes every unfinished Segment of a Recording. Progress runs from 0 to 1 across all of them. */
export async function finalizeRecording(
	sessionId: string,
	recordingId: string,
	onProgress: (progress: number) => void = () => {}
): Promise<Session> {
	const recording = (await loadSession(sessionId)).recordings.find((r) => r.id === recordingId);
	if (!recording) throw new Error(`No Recording ${recordingId} in ${sessionId}`);
	const unfinished = recording.segments.filter((s) => s.path === null && s.rawPath && s.manifestPath);

	try {
		for (const [i, segment] of unfinished.entries()) {
			const result = await runWorker(
				{
					rawPath: segment.rawPath!,
					manifestPath: segment.manifestPath!,
					finishedBase: segmentPaths(sessionId, recordingId, segment.index).finishedBase
				},
				(progress) => onProgress((i + progress) / unfinished.length)
			);
			await changeSession(sessionId, (session) =>
				updateRecording(session, recordingId, (r) =>
					updateSegment(r, segment.index, (s) => ({
						...s,
						path: result.path,
						durationUs: result.durationUs,
						frames: result.framesInFile === null ? null : { delivered: s.frames?.delivered ?? null, inFile: result.framesInFile }
					}))
				)
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return changeSession(sessionId, (session) => updateRecording(session, recordingId, (r) => ({ ...r, finalizeError: message })));
	}

	await changeSession(sessionId, (s) => updateRecording(s, recordingId, ({ finalizeError: _, ...r }) => ({ ...r, state: 'ready' })));
	// The finished files are recorded, so the raw files can go.
	for (const segment of unfinished) {
		await removeFile(segment.rawPath!);
		await removeFile(segment.manifestPath!);
	}
	onProgress(1);
	return changeSession(sessionId, (s) =>
		updateRecording(s, recordingId, (r) => ({
			...r,
			segments: r.segments.map((seg) => (seg.path ? { ...seg, rawPath: null, manifestPath: null } : seg))
		}))
	);
}
