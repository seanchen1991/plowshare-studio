// What to tell the user when a file couldn't be opened as a take.

import { isOutOfRoom } from '../lib/storage/budget';
import type { ImportProblem } from '../lib/storage/import';
import { formatBytes } from './format';

/** Which files the file picker offers: video and audio of any kind; the rest is refused with a message. */
export const openableFiles = 'video/*,audio/*,.mp4,.m4a,.mov,.webm,.mkv,.wav,.mp3,.ogg';

export function importMessage(problem: ImportProblem, fileName: string): string {
	const name = `“${fileName}”`;
	switch (problem.kind) {
		case 'room':
			return `Not enough room to open ${name}: it needs ${formatBytes(problem.neededBytes)}, and there's room for ${formatBytes(problem.roomBytes)}. Download the takes you want to keep and delete them, or free up space on this computer.`;
		case 'unreadable':
			return `Couldn't open ${name}: it isn't a video or audio file Plowshare Studio can read. MP4 and WebM files work best.`;
		case 'no-audio':
			return `Couldn't open ${name}: it has no sound, so there's nothing to edit.`;
		case 'failed':
			return isOutOfRoom(problem.message)
				? `This computer ran out of room while copying ${name}. Free up space and try again.`
				: `Couldn't open ${name}: ${problem.message}.`;
	}
}
