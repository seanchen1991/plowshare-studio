import { describe, expect, it } from 'vitest';
import { watchForSleep, type ClockReading } from './sleep.ts';

function clocks() {
	const now: ClockReading = { wallMs: 1_000_000, monoMs: 0 };
	return {
		read: () => ({ ...now }),
		/** Time passing while awake: both clocks move. */
		awake(ms: number) {
			now.wallMs += ms;
			now.monoMs += ms;
		},
		/** Asleep: only the wall clock moves, as on macOS. */
		asleep(ms: number) {
			now.wallMs += ms;
		}
	};
}

describe('watchForSleep', () => {
	it('sees nothing while chunks arrive every 2 s', () => {
		const c = clocks();
		const sleep = watchForSleep(c.read);
		for (let i = 0; i < 10; i++) {
			c.awake(2000);
			expect(sleep.chunk()).toBe(false);
		}
	});

	it('sees a long wait between chunks, even when the monotonic clock kept counting', () => {
		const c = clocks();
		const sleep = watchForSleep(c.read);
		c.awake(2000);
		expect(sleep.chunk()).toBe(false);
		c.awake(30_000);
		expect(sleep.chunk()).toBe(true);
		c.awake(2000);
		expect(sleep.chunk()).toBe(false);
	});

	it('sees the wall clock jump ahead of the monotonic one on a timer tick', () => {
		const c = clocks();
		const sleep = watchForSleep(c.read);
		c.awake(1000);
		expect(sleep.tick()).toBe(false);
		c.asleep(60_000);
		c.awake(1000);
		expect(sleep.tick()).toBe(true);
		c.awake(1000);
		expect(sleep.tick()).toBe(false);
	});

	it('does not take a throttled timer in a hidden tab for sleep', () => {
		const c = clocks();
		const sleep = watchForSleep(c.read);
		c.awake(60_000);
		expect(sleep.tick()).toBe(false);
	});
});
