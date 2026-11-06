// Asking the browser to keep recordings permanently (navigator.storage.persist()),
// so it won't delete them to free space. Asked when the user first presses
// Record, never on page load, and again on a later visit while refused.

import type { SupportedBrowser } from '../browser/support.ts';

/** Persistent: the browser agreed. Refused: asked, and it hasn't agreed. Not asked: no take has been started yet. */
export type Persistence = 'persistent' | 'refused' | 'not-asked';

const askedKey = 'plowshare.persistAsked';
// Once a visit: Firefox asks the user each time, and a refusal won't change within a visit.
let askedThisVisit = false;

function askedBefore(): boolean {
	try {
		return localStorage.getItem(askedKey) === 'yes';
	} catch {
		return false;
	}
}

function rememberAsked() {
	try {
		localStorage.setItem(askedKey, 'yes');
	} catch {
		// Without storage the notice waits for this visit's answer; asking still works.
	}
}

/** Where things stand, without asking. */
export async function persistence(): Promise<Persistence> {
	if (await navigator.storage.persisted()) return 'persistent';
	return askedBefore() ? 'refused' : 'not-asked';
}

/**
 * Asks, unless already persistent or asked on this visit. Firefox shows its own
 * prompt and only answers once the user has, so callers shouldn't wait on it.
 */
export async function askToPersist(): Promise<Persistence> {
	if (await navigator.storage.persisted()) return 'persistent';
	if (askedThisVisit) return 'refused';
	askedThisVisit = true;
	rememberAsked();
	return (await navigator.storage.persist()) ? 'persistent' : 'refused';
}

/** Takes not stored anywhere else are flagged only while the browser may delete them. */
export function warnNotBackedUp(state: Persistence, backedUp: boolean): boolean {
	return state !== 'persistent' && !backedUp;
}

/** How to get the browser to agree: Chrome and Edge keep an installed app's storage; Firefox asks. */
export function persistenceFixSteps(browser: SupportedBrowser): string[] {
	const afterInstall = 'Open Plowshare Studio from the installed app and record there. Your takes come with it.';
	switch (browser) {
		case 'chrome':
			return [
				'Install Plowshare Studio as an app: click the install icon at the right end of the address bar, or open the ⋮ menu and choose Cast, save, and share › Install page as app.',
				afterInstall
			];
		case 'edge':
			return ['Install Plowshare Studio as an app: open the … menu and choose Apps › Install this site as an app.', afterInstall];
		case 'chromium':
			return ['Install Plowshare Studio as an app, from the browser’s menu or the install icon in the address bar.', afterInstall];
		case 'firefox':
			return [
				'When Firefox asks whether Plowshare Studio may store data in persistent storage, choose Allow. It asks the next time you press Record.',
				'Chose Block before? Click the icon at the left end of the address bar, click the × next to Store Data in Persistent Storage, then reload the page and press Record.'
			];
	}
}
