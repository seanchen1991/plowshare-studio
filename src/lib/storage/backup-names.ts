// Names in the Backup folder: each Show's folder, and each copied file. Pure
// functions only; copying lives in backup.ts.

import { downloadName, extensionOf, safeTitle } from './download-name.ts';
import type { Segment, Session } from './session-file.ts';

const maxFolderLength = 60;

/** "Tilling Our Commons" → "tilling-our-commons": lowercase letters and digits joined by hyphens. */
export function showFolderName(showName: string): string {
	const slug = showName
		.normalize('NFKD')
		// Accents off Latin letters; other scripts' marks are put back together below.
		.replace(/[̀-ͯ]/g, '')
		.normalize('NFC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, maxFolderLength)
		.replace(/-+$/, '');
	return slug || 'show';
}

/** What's at a name in the Backup folder: nothing, a folder Plowshare Studio made (or an empty one), or something else. */
export type FolderEntry = 'missing' | 'reusable' | 'taken';

/**
 * The folder name for a Show: its slug, or `slug-2`, `slug-3` and so on when
 * that name belongs to another Show or to something that isn't ours.
 */
export function chooseFolderName(showName: string, entry: (name: string) => FolderEntry, otherShowsFolders: Set<string>): string {
	const base = showFolderName(showName);
	for (let n = 1; ; n++) {
		const name = n === 1 ? base : `${base}-${n}`;
		if (!otherShowsFolders.has(name) && entry(name) !== 'taken') return name;
	}
}

/** A copied Segment's file name: the same as its download (issue 09). */
export function backupFileName(session: Session, segments: Segment[], segment: Segment): string {
	return downloadName({
		title: session.title,
		createdAt: session.createdAt,
		extension: extensionOf(segment.path!),
		part: segments.indexOf(segment) + 1,
		count: segments.length
	});
}

/** Firefox can't write to a folder, so automatic downloads start with the Show's name instead. */
export function autoDownloadName(fileName: string, showName: string | undefined): string {
	return showName ? `${safeTitle(showName)} – ${fileName}` : fileName;
}

/** `name.mp4`, then `name (2).mp4`, … for when a different file already has the name. */
export function numberedName(fileName: string, n: number): string {
	if (n === 1) return fileName;
	const dot = fileName.lastIndexOf('.');
	return dot > 0 ? `${fileName.slice(0, dot)} (${n})${fileName.slice(dot)}` : `${fileName} (${n})`;
}
