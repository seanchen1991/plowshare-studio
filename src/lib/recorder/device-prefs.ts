// The camera and mic the user chose, and "Clean up audio" per mic, remembered
// between visits in localStorage. Losing them only means choosing again.
//
// Device ids alone aren't enough: browsers hand out new ids each visit unless
// camera access is remembered for the site (Firefox without "Remember", and
// Chrome in tests). So each device is found by id, then by name.

export interface SavedDevice {
	id: string;
	label: string;
}

export interface DevicePrefs {
	camera?: SavedDevice;
	/** The camera is off: takes record audio only. */
	cameraOff: boolean;
	mic?: SavedDevice;
	/** "Clean up audio" by mic (see `micKey`); missing means off. */
	cleanUpAudio: Record<string, boolean>;
}

const key = 'plowshare.devices.v1';

/** What "Clean up audio" is remembered under: the mic's name, which outlives its id. */
export function micKey(mic: { deviceId: string; label: string }): string {
	return mic.label || mic.deviceId;
}

/** The saved device among those present: the same id, or failing that the same name. */
export function findDevice<T extends { deviceId: string; label: string }>(devices: T[], saved?: SavedDevice): T | undefined {
	if (!saved) return undefined;
	return devices.find((d) => d.deviceId === saved.id) ?? (saved.label ? devices.find((d) => d.label === saved.label) : undefined);
}

function parseDevice(value: unknown): SavedDevice | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const { id, label } = value as Record<string, unknown>;
	return typeof id === 'string' && typeof label === 'string' ? { id, label } : undefined;
}

export function parseDevicePrefs(text: string | null): DevicePrefs {
	try {
		const value = JSON.parse(text ?? '{}');
		return {
			camera: parseDevice(value.camera),
			cameraOff: value.cameraOff === true,
			mic: parseDevice(value.mic),
			cleanUpAudio: value.cleanUpAudio && typeof value.cleanUpAudio === 'object' ? value.cleanUpAudio : {}
		};
	} catch {
		return { cameraOff: false, cleanUpAudio: {} };
	}
}

export function loadDevicePrefs(): DevicePrefs {
	try {
		return parseDevicePrefs(localStorage.getItem(key));
	} catch {
		return { cameraOff: false, cleanUpAudio: {} };
	}
}

export function saveDevicePrefs(prefs: DevicePrefs): void {
	try {
		localStorage.setItem(key, JSON.stringify(prefs));
	} catch {
		// Storage blocked: the choice lasts until the page closes.
	}
}
