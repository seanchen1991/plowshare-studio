// The camera and mic the user chose, and "Clean up audio" per mic, remembered
// between visits in localStorage. Losing them only means choosing again.

export interface DevicePrefs {
	cameraId?: string;
	micId?: string;
	/** "Clean up audio" by mic id; missing means off. */
	cleanUpAudio: Record<string, boolean>;
}

const key = 'plowshare.devices.v1';

export function parseDevicePrefs(text: string | null): DevicePrefs {
	try {
		const value = JSON.parse(text ?? '{}');
		return {
			cameraId: typeof value.cameraId === 'string' ? value.cameraId : undefined,
			micId: typeof value.micId === 'string' ? value.micId : undefined,
			cleanUpAudio: value.cleanUpAudio && typeof value.cleanUpAudio === 'object' ? value.cleanUpAudio : {}
		};
	} catch {
		return { cleanUpAudio: {} };
	}
}

export function loadDevicePrefs(): DevicePrefs {
	try {
		return parseDevicePrefs(localStorage.getItem(key));
	} catch {
		return { cleanUpAudio: {} };
	}
}

export function saveDevicePrefs(prefs: DevicePrefs): void {
	try {
		localStorage.setItem(key, JSON.stringify(prefs));
	} catch {
		// Storage blocked: the choice lasts until the page closes.
	}
}
