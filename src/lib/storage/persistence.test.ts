import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A browser stand-in: whether storage is persisted, what persist() answers, and localStorage. */
function fakeBrowser({ persisted = false, agrees = false } = {}) {
	const state = { persisted, asks: 0 };
	const items = new Map<string, string>();
	vi.stubGlobal('navigator', {
		storage: {
			persisted: async () => state.persisted,
			persist: async () => {
				state.asks++;
				if (agrees) state.persisted = true;
				return agrees;
			}
		}
	});
	vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) });
	return state;
}

// A fresh module is a fresh visit.
const visit = () => import('./persistence.ts');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('asking to persist', () => {
	it('has not asked before the first take', async () => {
		fakeBrowser();
		expect(await (await visit()).persistence()).toBe('not-asked');
	});

	it('asks once a visit, and again on a later visit while refused', async () => {
		const browser = fakeBrowser();
		let page = await visit();
		expect(await page.askToPersist()).toBe('refused');
		expect(await page.askToPersist()).toBe('refused');
		expect(browser.asks).toBe(1);
		expect(await page.persistence()).toBe('refused');

		vi.resetModules();
		page = await visit();
		expect(await page.persistence()).toBe('refused');
		await page.askToPersist();
		expect(browser.asks).toBe(2);
	});

	it('stops asking once the browser agrees', async () => {
		const browser = fakeBrowser({ agrees: true });
		const page = await visit();
		expect(await page.askToPersist()).toBe('persistent');
		vi.resetModules();
		expect(await (await visit()).askToPersist()).toBe('persistent');
		expect(browser.asks).toBe(1);
	});

	it('never asks when already persistent', async () => {
		const browser = fakeBrowser({ persisted: true });
		const page = await visit();
		expect(await page.persistence()).toBe('persistent');
		expect(await page.askToPersist()).toBe('persistent');
		expect(browser.asks).toBe(0);
	});
});

describe('warnNotBackedUp', () => {
	it('flags takes only while storage is not persistent and they are not Backed up', async () => {
		const { warnNotBackedUp } = await visit();
		expect(warnNotBackedUp('refused', false)).toBe(true);
		expect(warnNotBackedUp('not-asked', false)).toBe(true);
		expect(warnNotBackedUp('refused', true)).toBe(false);
		expect(warnNotBackedUp('persistent', false)).toBe(false);
	});
});

describe('persistenceFixSteps', () => {
	it('says to install in Chrome and Edge, and to allow the prompt in Firefox', async () => {
		const { persistenceFixSteps } = await visit();
		expect(persistenceFixSteps('chrome')[0]).toMatch(/^Install Plowshare Studio as an app.*Install page as app/);
		expect(persistenceFixSteps('edge')[0]).toMatch(/Apps › Install this site as an app/);
		expect(persistenceFixSteps('chromium')[0]).toMatch(/^Install Plowshare Studio as an app/);
		expect(persistenceFixSteps('firefox').join(' ')).toMatch(/choose Allow.*Store Data in Persistent Storage/);
	});
});
