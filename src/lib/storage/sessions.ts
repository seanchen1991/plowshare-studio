// Reading and writing Session files in OPFS.

import { listDirectories, readJson, removeFile, writeJson } from './opfs.ts';
import { heldRecordingLocks, lockName } from './recording-lock.ts';
import { markInterrupted, sessionFilePath, sessionsDir, type Session } from './session-file.ts';

const pending = new Map<string, Promise<unknown>>();

/** Runs one change to a Session file at a time per Session, so concurrent updates don't overwrite each other. */
export function changeSession(sessionId: string, change: (session: Session) => Session): Promise<Session> {
	const previous = pending.get(sessionId) ?? Promise.resolve();
	const next = previous
		.catch(() => {})
		.then(async () => {
			const session = change(await loadSession(sessionId));
			await writeJson(sessionFilePath(sessionId), session);
			return session;
		});
	pending.set(sessionId, next);
	return next;
}

export async function createSession(session: Session): Promise<void> {
	await writeJson(sessionFilePath(session.id), session);
}

export function loadSession(sessionId: string): Promise<Session> {
	return readJson<Session>(sessionFilePath(sessionId));
}

/** Every Session in OPFS, newest first. Sessions whose file can't be read are skipped. */
export async function listSessions(): Promise<Session[]> {
	const ids = await listDirectories(sessionsDir);
	const sessions = await Promise.all(ids.map((id) => loadSession(id).catch(() => null)));
	return sessions.filter((s): s is Session => s !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Run once at launch: marks Recordings the browser cut off as Interrupted, and
 * deletes raw files a crash left behind after Finalizing had already finished.
 */
export async function checkSessionsOnLaunch(): Promise<void> {
	const held = await heldRecordingLocks();
	for (const session of await listSessions()) {
		const marked = markInterrupted(session, (recordingId) => held.has(lockName(session.id, recordingId)));
		if (marked.recordings.some((r, i) => r.state !== session.recordings[i]!.state)) {
			await changeSession(session.id, (s) => markInterrupted(s, (recordingId) => held.has(lockName(s.id, recordingId))));
		}

		const leftovers = session.recordings.flatMap((r) =>
			r.state === 'ready' ? r.segments.filter((seg) => seg.path && (seg.rawPath || seg.manifestPath)) : []
		);
		if (leftovers.length === 0) continue;
		for (const segment of leftovers) {
			if (segment.rawPath) await removeFile(segment.rawPath);
			if (segment.manifestPath) await removeFile(segment.manifestPath);
		}
		await changeSession(session.id, (s) => ({
			...s,
			recordings: s.recordings.map((r) =>
				r.state === 'ready' ? { ...r, segments: r.segments.map((seg) => (seg.path ? { ...seg, rawPath: null, manifestPath: null } : seg)) } : r
			)
		}));
	}
}
