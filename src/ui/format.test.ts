import { describe, expect, it } from 'vitest';
import { formatTimecode } from './format.ts';

describe('formatTimecode', () => {
	it('shows minutes, seconds and tenths', () => {
		expect(formatTimecode(0)).toBe('00:00.0');
		expect(formatTimecode(1_715_799_999)).toBe('28:35.7');
		expect(formatTimecode(59_990_000)).toBe('00:59.9');
	});

	it('adds hours past an hour', () => {
		expect(formatTimecode(3_723_400_000)).toBe('1:02:03.4');
	});

	it('treats a negative time as the start', () => {
		expect(formatTimecode(-5)).toBe('00:00.0');
	});
});
