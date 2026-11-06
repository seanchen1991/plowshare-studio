// The Backup folder: a folder on the user's computer (File System Access API,
// Chrome and Edge) that Ready takes are copied into, one folder per Show.
// Firefox can't write to folders; there, takes can be downloaded automatically.

import { backupFileName, chooseFolderName, numberedName, showFolderName, type FolderEntry } from './backup-names.ts';
import { kvDelete, kvGet, kvSet } from './kv.ts';
import { readFile } from './opfs.ts';
import { sessionState, updateRecording, updateSegment, type Session } from './session-file.ts';
import { changeSession, loadSession } from './sessions.ts';
import { showOf, type Show } from './show-file.ts';
import { setShowFolder } from './shows.ts';

/** Whether access to the folder is granted, can be asked for (needs a click), or was refused. */
export type FolderAccess = 'granted' | 'prompt' | 'denied';

type PermissionHandle = FileSystemDirectoryHandle & {
	queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
	requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};

type WindowWithPicker = Window & {
	showDirectoryPicker(options?: { id?: string; mode?: 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>;
};

const folderKey = 'backupFolder';
/** Marks a folder in the Backup folder as made by Plowshare Studio, so a Show can reuse it. */
export const markerFile = '.plowshare-show';

/** Chrome and Edge can write to a folder the user picks; Firefox can't. */
export function canUseFolder(): boolean {
	return 'showDirectoryPicker' in window;
}

/** Asks the user to pick the Backup folder (must follow a click). Null if they cancel. */
export async function chooseBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const handle = await (window as unknown as WindowWithPicker).showDirectoryPicker({ id: 'plowshare-backup', mode: 'readwrite', startIn: 'documents' });
		await kvSet(folderKey, handle);
		return handle;
	} catch (error) {
		if ((error as DOMException).name === 'AbortError') return null;
		throw error;
	}
}

export async function loadBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
	return (await kvGet<FileSystemDirectoryHandle>(folderKey)) ?? null;
}

export function forgetBackupFolder(): Promise<void> {
	return kvDelete(folderKey);
}

/** Access to the folder; with `ask`, asks the user when the browser wants it confirmed (must follow a click). */
export async function folderAccess(handle: FileSystemDirectoryHandle, ask = false): Promise<FolderAccess> {
	const permission = handle as PermissionHandle;
	const state = await permission.queryPermission({ mode: 'readwrite' });
	if (state !== 'prompt' || !ask) return state;
	return permission.requestPermission({ mode: 'readwrite' });
}

async function entryAt(root: FileSystemDirectoryHandle, name: string): Promise<FolderEntry> {
	let dir: FileSystemDirectoryHandle;
	try {
		dir = await root.getDirectoryHandle(name);
	} catch (error) {
		const reason = (error as DOMException).name;
		if (reason === 'NotFoundError') return 'missing';
		if (reason === 'TypeMismatchError') return 'taken';
		throw error;
	}
	// Empty, or holding our marker: reusable.
	for await (const _ of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
		return (await hasFile(dir, markerFile)) ? 'reusable' : 'taken';
	}
	return 'reusable';
}

async function hasFile(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
	try {
		await dir.getFileHandle(name);
		return true;
	} catch {
		return false;
	}
}

/** The Show's folder, made (with its marker) if needed; the first time, its name is chosen and remembered. */
export async function showFolder(root: FileSystemDirectoryHandle, show: Show, shows: Show[]): Promise<FileSystemDirectoryHandle> {
	let name = show.folder;
	if (!name) {
		const base = showFolderName(show.name);
		const entries = new Map<string, FolderEntry>();
		// Enough candidates for any realistic clash; chooseFolderName stops at the first free one.
		for (let n = 1; n <= 20; n++) {
			const candidate = n === 1 ? base : `${base}-${n}`;
			entries.set(candidate, await entryAt(root, candidate));
			if (entries.get(candidate) !== 'taken') break;
		}
		const others = new Set(shows.filter((s) => s.id !== show.id && s.folder).map((s) => s.folder!));
		name = chooseFolderName(show.name, (n) => entries.get(n) ?? 'missing', others);
		await setShowFolder(show.id, name);
		show.folder = name;
	}
	const dir = await root.getDirectoryHandle(name, { create: true });
	if (!(await hasFile(dir, markerFile))) {
		const writable = await (await dir.getFileHandle(markerFile, { create: true })).createWritable();
		await writable.write(JSON.stringify({ app: 'Plowshare Studio', showId: show.id }));
		await writable.close();
	}
	return dir;
}

/** A name for a new file in `dir`: `name`, or `name (2)` and so on if a file already has it. */
async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
	for (let n = 1; ; n++) {
		const candidate = numberedName(name, n);
		if (!(await hasFile(dir, candidate))) return candidate;
	}
}

/** Takes with finished Segments not yet in the Backup folder. */
export function needsCopy(session: Session): boolean {
	return sessionState(session) === 'ready' && session.recordings.some((r) => r.segments.some((s) => s.path && !s.copied));
}

/**
 * Copies every finished Segment of the take not yet copied into its Show's
 * folder (or the top of the Backup folder), streaming from disk. A failure is
 * recorded on the take and the browser's copy is untouched.
 */
export async function copyTake(root: FileSystemDirectoryHandle, sessionId: string, shows: Show[]): Promise<Session> {
	let session = await loadSession(sessionId);
	if (!needsCopy(session)) return session;
	try {
		const show = showOf(session.showId, shows);
		const dir = show ? await showFolder(root, show, shows) : root;
		for (const recording of session.recordings) {
			const finished = recording.segments.filter((s) => s.path !== null);
			for (const segment of finished) {
				if (segment.copied) continue;
				const name = await freeName(dir, backupFileName(session, finished, segment));
				const file = await dir.getFileHandle(name, { create: true });
				try {
					// pipeTo closes the file when done, or aborts the write on failure.
					await (await readFile(segment.path!)).stream().pipeTo(await file.createWritable());
				} catch (error) {
					// Opening it made an empty file; don't leave it to look like a copy.
					await dir.removeEntry(name).catch(() => {});
					throw error;
				}
				session = await changeSession(sessionId, (s) =>
					updateRecording(s, recording.id, (r) => updateSegment(r, segment.index, (seg) => ({ ...seg, copied: true })))
				);
			}
		}
		return await changeSession(sessionId, ({ backupError: _, ...s }) => s);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return changeSession(sessionId, (s) => ({ ...s, backupError: message }));
	}
}

const autoDownloadKey = 'plowshare.autoDownload';

/** Firefox's stand-in: download each take when it's Ready. Null until the user has said. */
export function autoDownload(): boolean | null {
	try {
		const value = localStorage.getItem(autoDownloadKey);
		return value === null ? null : value === 'on';
	} catch {
		return null;
	}
}

export function setAutoDownload(on: boolean): void {
	try {
		localStorage.setItem(autoDownloadKey, on ? 'on' : 'off');
	} catch {
		// Without storage the choice lasts only this visit.
	}
}

/** Where backups stand, for the screens: a folder (Chrome and Edge), or automatic downloads (Firefox). */
export type BackupStatus =
	| { kind: 'folder'; name: string | null; access: FolderAccess; waiting: number; copying: string | null }
	| { kind: 'downloads'; on: boolean | null };

const offerKey = 'plowshare.backupOffer';

/** The user said Not now to the offer to back up. */
export function backupOfferDismissed(): boolean {
	try {
		return localStorage.getItem(offerKey) === 'dismissed';
	} catch {
		return false;
	}
}

export function dismissBackupOffer(): void {
	try {
		localStorage.setItem(offerKey, 'dismissed');
	} catch {
		// Offered again next visit.
	}
}
