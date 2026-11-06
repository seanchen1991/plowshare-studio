// Reading and writing Shows in OPFS, and which Show the next take is for.

import { fileExists, readJson, writeJson } from './opfs.ts';
import { newId } from './session-file.ts';
import { changeSession, listSessions } from './sessions.ts';
import { showNameProblem, showsFilePath, sortShows, type Show, type ShowsFile } from './show-file.ts';

let pending: Promise<unknown> = Promise.resolve();

/** Runs one change to the Shows file at a time, so concurrent changes don't overwrite each other. */
function changeShows<T>(change: (shows: Show[]) => { shows: Show[]; result: T }): Promise<T> {
	const next = pending
		.catch(() => {})
		.then(async () => {
			const { shows, result } = change(await listShows());
			await writeJson(showsFilePath, { version: 1, shows } satisfies ShowsFile);
			return result;
		});
	pending = next;
	return next;
}

/** Every Show, in name order. */
export async function listShows(): Promise<Show[]> {
	if (!(await fileExists(showsFilePath))) return [];
	return sortShows((await readJson<ShowsFile>(showsFilePath)).shows);
}

function check(name: string, shows: Show[], exceptId?: string): string {
	const problem = showNameProblem(name, shows, exceptId);
	if (problem) throw new Error(problem);
	return name.trim();
}

export function createShow(name: string, now = new Date()): Promise<Show> {
	return changeShows((shows) => {
		const show = { id: newId('show', now), name: check(name, shows), createdAt: now.toISOString() };
		return { shows: [...shows, show], result: show };
	});
}

export function renameShow(showId: string, name: string): Promise<void> {
	return changeShows((shows) => {
		const trimmed = check(name, shows, showId);
		return { shows: shows.map((s) => (s.id === showId ? { ...s, name: trimmed } : s)), result: undefined };
	});
}

/** Deletes the Show; its takes are kept, in no Show. */
export async function deleteShow(showId: string): Promise<void> {
	await changeShows((shows) => ({ shows: shows.filter((s) => s.id !== showId), result: undefined }));
	for (const session of await listSessions()) {
		if (session.showId === showId) await changeSession(session.id, (s) => (s.showId === showId ? { ...s, showId: null } : s));
	}
	if (nextTakeShowId() === showId) setNextTakeShowId(null);
}

const nextTakeKey = 'plowshare.nextTakeShow';

/** The Show the next take is for, remembered between visits; null is none. Callers check it still exists. */
export function nextTakeShowId(): string | null {
	try {
		return localStorage.getItem(nextTakeKey);
	} catch {
		return null;
	}
}

export function setNextTakeShowId(showId: string | null): void {
	try {
		if (showId) localStorage.setItem(nextTakeKey, showId);
		else localStorage.removeItem(nextTakeKey);
	} catch {
		// Without storage the choice lasts only this visit.
	}
}
