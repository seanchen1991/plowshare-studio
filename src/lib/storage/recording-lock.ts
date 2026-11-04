// A Recording that is Capturing or Finalizing holds a Web Lock for as long as
// that work runs. The browser drops the lock when the tab or the browser dies,
// so on launch an unfinished Recording without a lock was cut off, while one
// with a lock is still running in another tab.

const prefix = 'plowshare.recording.';

export function lockName(sessionId: string, recordingId: string): string {
	return `${prefix}${sessionId}/${recordingId}`;
}

/** Takes the Recording's lock, waiting for it if needed. Call the returned function to release it. */
export function holdRecording(sessionId: string, recordingId: string): Promise<() => void> {
	return new Promise((granted) => {
		void navigator.locks.request(lockName(sessionId, recordingId), () => new Promise<void>((release) => granted(release)));
	});
}

/** Names of the Recording locks held anywhere in this browser profile right now. */
export async function heldRecordingLocks(): Promise<Set<string>> {
	const { held = [] } = await navigator.locks.query();
	return new Set(held.map((lock) => lock.name).filter((name): name is string => !!name?.startsWith(prefix)));
}
