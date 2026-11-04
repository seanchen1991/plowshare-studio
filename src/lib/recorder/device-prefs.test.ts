import { describe, expect, it } from 'vitest';
import { findDevice, micKey, parseDevicePrefs } from './device-prefs.ts';

describe('parseDevicePrefs', () => {
	it('reads saved choices', () => {
		const text = '{"camera":{"id":"c","label":"Cam"},"mic":{"id":"m","label":"Mic"},"cleanUpAudio":{"Mic":true}}';
		expect(parseDevicePrefs(text)).toEqual({
			camera: { id: 'c', label: 'Cam' },
			mic: { id: 'm', label: 'Mic' },
			cleanUpAudio: { Mic: true }
		});
	});

	it('starts empty when nothing or garbage is stored', () => {
		expect(parseDevicePrefs(null)).toEqual({ camera: undefined, mic: undefined, cleanUpAudio: {} });
		expect(parseDevicePrefs('not json')).toEqual({ cleanUpAudio: {} });
		expect(parseDevicePrefs('{"camera":{"id":3}}').camera).toBeUndefined();
	});
});

describe('findDevice', () => {
	const devices = [
		{ deviceId: 'new-1', label: 'USB Mic' },
		{ deviceId: 'new-2', label: 'Built-in Mic' }
	];

	it('finds the device by id', () => {
		expect(findDevice(devices, { id: 'new-2', label: 'Renamed' })).toBe(devices[1]);
	});

	it('falls back to the name when the browser handed out new ids', () => {
		expect(findDevice(devices, { id: 'old-1', label: 'USB Mic' })).toBe(devices[0]);
	});

	it('finds nothing when the device is gone or nothing was saved', () => {
		expect(findDevice(devices, { id: 'old-3', label: 'Headset' })).toBeUndefined();
		expect(findDevice(devices, { id: 'old-3', label: '' })).toBeUndefined();
		expect(findDevice(devices, undefined)).toBeUndefined();
	});
});

describe('micKey', () => {
	it('uses the name, or the id when there is none', () => {
		expect(micKey({ deviceId: 'x', label: 'USB Mic' })).toBe('USB Mic');
		expect(micKey({ deviceId: 'x', label: '' })).toBe('x');
	});
});
