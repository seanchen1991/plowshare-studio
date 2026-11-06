// The Shows file: every Show, in one JSON document. Pure functions only;
// reading and writing live in shows.ts.

export interface Show {
	id: string;
	name: string;
	createdAt: string;
	/** Its folder's name in the Backup folder, once it has one; kept when the Show is renamed. */
	folder?: string;
}

export interface ShowsFile {
	version: 1;
	shows: Show[];
}

export const showsFilePath = 'shows.json';

export const maxShowNameLength = 100;

/** Why `name` can't be a Show's name, or null if it can. `exceptId` is the Show being renamed. */
export function showNameProblem(name: string, shows: Show[], exceptId?: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return 'Give the show a name.';
	if (trimmed.length > maxShowNameLength) return `Keep the name under ${maxShowNameLength} characters.`;
	const taken = shows.find((s) => s.id !== exceptId && s.name.toLowerCase() === trimmed.toLowerCase());
	return taken ? `There's already a show called “${taken.name}”.` : null;
}

/** Shows in name order, ignoring case. */
export function sortShows(shows: Show[]): Show[] {
	return [...shows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The Show a take is for, if it still exists. */
export function showOf(showId: string | null | undefined, shows: Show[]): Show | null {
	return (showId && shows.find((s) => s.id === showId)) || null;
}
