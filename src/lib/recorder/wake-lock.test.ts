import { describe, expect, it } from 'vitest';
import { holdWakeLock, type WakeLockEnvironment } from './wake-lock.ts';

/** A browser stand-in: the tab can be hidden and shown, and hiding drops the lock as browsers do. */
function fakeBrowser({ refuse = false } = {}) {
	let visible = true;
	let listeners: (() => void)[] = [];
	const locks: { released: boolean; release: () => Promise<void> }[] = [];
	const environment: WakeLockEnvironment = {
		request: async () => {
			if (refuse) throw new DOMException('Not allowed', 'NotAllowedError');
			const lock = { released: false, release: async () => void (lock.released = true) };
			locks.push(lock);
			return lock;
		},
		isVisible: () => visible,
		onVisibilityChange: (listener) => {
			listeners.push(listener);
			return () => (listeners = listeners.filter((l) => l !== listener));
		}
	};
	const settle = () => new Promise((done) => setTimeout(done));
	return {
		environment,
		locks,
		held: () => locks.filter((l) => !l.released).length,
		async setVisible(value: boolean) {
			visible = value;
			if (!value) locks.forEach((l) => (l.released = true));
			listeners.forEach((l) => l());
			await settle();
		},
		settle
	};
}

describe('holdWakeLock', () => {
	it('holds one lock until released', async () => {
		const browser = fakeBrowser();
		const release = holdWakeLock(browser.environment);
		await browser.settle();
		expect(browser.held()).toBe(1);
		release();
		expect(browser.held()).toBe(0);
	});

	it('asks again each time the tab comes back', async () => {
		const browser = fakeBrowser();
		holdWakeLock(browser.environment);
		await browser.settle();
		await browser.setVisible(false);
		expect(browser.held()).toBe(0);
		await browser.setVisible(true);
		expect(browser.held()).toBe(1);
		await browser.setVisible(false);
		await browser.setVisible(true);
		expect(browser.locks).toHaveLength(3);
		expect(browser.held()).toBe(1);
	});

	it('stops asking once released', async () => {
		const browser = fakeBrowser();
		const release = holdWakeLock(browser.environment);
		await browser.settle();
		release();
		await browser.setVisible(false);
		await browser.setVisible(true);
		expect(browser.locks).toHaveLength(1);
		expect(browser.held()).toBe(0);
	});

	it('waits for the tab to be visible before asking', async () => {
		const browser = fakeBrowser();
		await browser.setVisible(false);
		holdWakeLock(browser.environment);
		await browser.settle();
		expect(browser.locks).toHaveLength(0);
		await browser.setVisible(true);
		expect(browser.held()).toBe(1);
	});

	it('carries on when the browser refuses, or has no Wake Lock', async () => {
		const browser = fakeBrowser({ refuse: true });
		const release = holdWakeLock(browser.environment);
		await browser.settle();
		expect(browser.held()).toBe(0);
		release();
		expect(() => holdWakeLock(null)()).not.toThrow();
	});
});
