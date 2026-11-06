// Changes the user makes to takes in the library: rename, delete, moving to
// another Show, and noting which Segments have been downloaded.

import { readFile, removeDirectory } from './opfs.ts';
import { canDelete, sessionsDir, updateRecording, updateSegment, type Session } from './session-file.ts';
import { changeSession, loadSession } from './sessions.ts';

export function renameSession(sessionId: string, title: string): Promise<Session> {
	const trimmed = title.trim();
	return changeSession(sessionId, (s) => (trimmed ? { ...s, title: trimmed } : s));
}

/** Deletes the Session and all its files. Refuses while a Recording is still being captured or finalized. */
export async function deleteSession(sessionId: string): Promise<void> {
	if (!canDelete(await loadSession(sessionId))) throw new Error('This take is still being recorded or finished');
	await removeDirectory(`${sessionsDir}/${sessionId}`);
}

/** Moves the take to another Show, or to none. */
export function moveSession(sessionId: string, showId: string | null): Promise<Session> {
	return changeSession(sessionId, (s) => ({ ...s, showId }));
}

export function markDownloaded(sessionId: string, recordingId: string, index: number): Promise<Session> {
	return changeSession(sessionId, (s) => updateRecording(s, recordingId, (r) => updateSegment(r, index, (seg) => ({ ...seg, downloaded: true }))));
}

/** Bytes on disk of the finished files. */
export async function finishedBytes(session: Session): Promise<number> {
	const paths = session.recordings.flatMap((r) => r.segments.map((s) => s.path)).filter((p): p is string => p !== null);
	const sizes = await Promise.all(paths.map((p) => readFile(p).then((f) => f.size, () => 0)));
	return sizes.reduce((sum, size) => sum + size, 0);
}
