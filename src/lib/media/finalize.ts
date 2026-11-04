// Runs Finalizing for a Recording: each unfinished Segment goes through the
// finalize worker, then the Session file is updated, and only then are the raw
// file and manifest deleted. Recovering an Interrupted Recording takes the same
// path.

import { parseManifest } from '../storage/manifest.ts';
import { fileExists, readFile, removeFile } from '../storage/opfs.ts';
import { holdRecording } from '../storage/recording-lock.ts';
import { segmentPaths, updateRecording, updateSegment, type Recording, type Segment, type Session } from '../storage/session-file.ts';
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
	const release = await holdRecording(sessionId, recordingId);
	try {
		return await finalizeHeld(sessionId, recordingId, onProgress);
	} finally {
		release();
	}
}

async function finalizeHeld(sessionId: string, recordingId: string, onProgress: (progress: number) => void): Promise<Session> {
	const recording = (await loadSession(sessionId)).recordings.find((r) => r.id === recordingId);
	if (!recording) throw new Error(`No Recording ${recordingId} in ${sessionId}`);
	const unfinished = unfinishedSegments(recording);

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
					updateSegment(withRecordedAudio(r, result), segment.index, (s) => ({
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

/**
 * Recovers an Interrupted Recording: Finalizing keeps the raw file up to the
 * last chunk its manifest lists. Records how long capture ran, so the user can
 * see what was saved. If it fails, the Recording stays Interrupted with the
 * reason, and Recover can be tried again.
 */
export async function recoverRecording(
	sessionId: string,
	recordingId: string,
	onProgress: (progress: number) => void = () => {}
): Promise<Session> {
	const recording = (await loadSession(sessionId)).recordings.find((r) => r.id === recordingId);
	if (!recording) throw new Error(`No Recording ${recordingId} in ${sessionId}`);

	// Segments the browser died in before their first chunk hold nothing to recover.
	const unfinished = unfinishedSegments(recording);
	const captured = new Map<number, number>();
	for (const segment of unfinished) {
		const manifest = (await fileExists(segment.manifestPath!)) ? parseManifest(await (await readFile(segment.manifestPath!)).text()) : null;
		if (manifest && manifest.chunks.length > 0) captured.set(segment.index, manifest.lastAliveUs);
	}
	const empty = unfinished.filter((s) => !captured.has(s.index));
	const kept = recording.segments.filter((s) => !empty.includes(s));
	if (kept.length === 0) {
		return changeSession(sessionId, (session) =>
			updateRecording(session, recordingId, (r) => ({ ...r, state: 'interrupted', finalizeError: 'nothing was saved before the browser closed' }))
		);
	}

	const last = kept.at(-1)!;
	const expectedUs = last.startUs + (captured.get(last.index) ?? last.durationUs ?? 0);
	await changeSession(sessionId, (session) =>
		updateRecording(session, recordingId, ({ finalizeError: _, ...r }) => ({
			...r,
			state: 'finalizing',
			recovery: { expectedUs },
			segments: r.segments.filter((s) => !empty.some((e) => e.index === s.index))
		}))
	);
	for (const segment of empty) {
		if (segment.rawPath) await removeFile(segment.rawPath);
		if (segment.manifestPath) await removeFile(segment.manifestPath);
	}

	const session = await finalizeRecording(sessionId, recordingId, onProgress);
	if (!session.recordings.find((r) => r.id === recordingId)?.finalizeError) return session;
	return changeSession(sessionId, (s) => updateRecording(s, recordingId, (r) => ({ ...r, state: 'interrupted' })));
}

function unfinishedSegments(recording: Recording): Segment[] {
	return recording.segments.filter((s) => s.path === null && s.rawPath && s.manifestPath);
}

/** What the file holds is the truth: Chrome may open a mic in stereo, and Firefox reports no sample rate. */
function withRecordedAudio(recording: Recording, result: FinalizeResult): Recording {
	if (!result.audio) return recording;
	return { ...recording, audio: { ...recording.audio, channels: result.audio.channels, sampleRate: result.audio.sampleRate } };
}
