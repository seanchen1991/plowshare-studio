// Reading and writing Session files in OPFS.

import { listDirectories, readJson, writeJson } from './opfs.ts';
import { sessionFilePath, sessionsDir, type Session } from './session-file.ts';

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
