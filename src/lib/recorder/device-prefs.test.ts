import { describe, expect, it } from 'vitest';
import { parseDevicePrefs } from './device-prefs.ts';

describe('parseDevicePrefs', () => {
	it('reads saved choices', () => {
		expect(parseDevicePrefs('{"cameraId":"c","micId":"m","cleanUpAudio":{"m":true}}')).toEqual({
			cameraId: 'c',
			micId: 'm',
			cleanUpAudio: { m: true }
		});
	});

	it('starts empty when nothing or garbage is stored', () => {
		expect(parseDevicePrefs(null)).toEqual({ cameraId: undefined, micId: undefined, cleanUpAudio: {} });
		expect(parseDevicePrefs('not json')).toEqual({ cleanUpAudio: {} });
		expect(parseDevicePrefs('{"cameraId":3}').cameraId).toBeUndefined();
	});
});
