import { describe, expect, it } from 'vitest';
import { isOutOfRoom } from './budget.ts';

describe('isOutOfRoom', () => {
	it('recognizes the browsers’ out-of-room errors', () => {
		// Chrome, writing a raw file and a finished copy; then Firefox.
		expect(isOutOfRoom("Failed to execute 'write' on 'FileSystemSyncAccessHandle': No space available for this operation")).toBe(true);
		expect(isOutOfRoom('The operation failed because it would cause the application to exceed its storage quota.')).toBe(true);
		expect(isOutOfRoom('QuotaExceededError: The current transaction exceeded its quota limitations.')).toBe(true);
	});

	it('leaves other failures alone', () => {
		expect(isOutOfRoom('The raw recording is empty')).toBe(false);
		expect(isOutOfRoom('A requested file or directory could not be found')).toBe(false);
	});
});
