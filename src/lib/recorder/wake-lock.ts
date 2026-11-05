// Keeps the screen on during a take. The browser drops a screen Wake Lock
// whenever the tab is hidden, so it is asked for again each time the tab
// becomes visible. Failing to get one never stops a take.

export interface WakeLockEnvironment {
	request: () => Promise<{ released: boolean; release: () => Promise<void> }>;
	isVisible: () => boolean;
	onVisibilityChange: (listener: () => void) => () => void;
}

const browserEnvironment = (): WakeLockEnvironment | null =>
	'wakeLock' in navigator
		? {
				request: () => navigator.wakeLock.request('screen'),
				isVisible: () => document.visibilityState === 'visible',
				onVisibilityChange: (listener) => {
					document.addEventListener('visibilitychange', listener);
					return () => document.removeEventListener('visibilitychange', listener);
				}
			}
		: null;

/** Holds a screen Wake Lock until the returned function is called. */
export function holdWakeLock(environment: WakeLockEnvironment | null = browserEnvironment()): () => void {
	if (!environment) return () => {};
	let sentinel: Awaited<ReturnType<WakeLockEnvironment['request']>> | null = null;
	let holding = true;
	let requesting = false;

	async function acquire() {
		if (!holding || requesting || !environment!.isVisible() || (sentinel && !sentinel.released)) return;
		requesting = true;
		try {
			sentinel = await environment!.request();
			if (!holding) void sentinel.release();
		} catch {
			// Refused (battery saver, permissions policy): the take goes on without it.
		} finally {
			requesting = false;
		}
	}

	const stopListening = environment.onVisibilityChange(() => void acquire());
	void acquire();
	return () => {
		holding = false;
		stopListening();
		if (sentinel && !sentinel.released) void sentinel.release();
	};
}
