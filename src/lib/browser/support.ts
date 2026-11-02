// Decides whether this browser can run Plowshare Studio. Chrome, Edge,
// Firefox and other Chromium browsers are supported; Safari and anything on
// iPhone or iPad (where every browser is WebKit underneath) are not yet.

export type SupportedBrowser = 'chrome' | 'edge' | 'firefox' | 'chromium';

export type BrowserSupport =
	| { supported: true; browser: SupportedBrowser }
	| { supported: false; reason: 'safari' | 'ios' | 'unknown' };

export function detectBrowserSupport(userAgent: string): BrowserSupport {
	if (/iPhone|iPad|iPod/.test(userAgent)) {
		return { supported: false, reason: 'ios' };
	}
	if (/Firefox\//.test(userAgent)) {
		return { supported: true, browser: 'firefox' };
	}
	if (/Edg\//.test(userAgent)) {
		return { supported: true, browser: 'edge' };
	}
	if (/(Chrome|Chromium)\//.test(userAgent)) {
		// Brave, Opera, Vivaldi and others also report Chrome/.
		const isGoogleChrome = /Chrome\//.test(userAgent) && !/OPR\/|Vivaldi\//.test(userAgent);
		return { supported: true, browser: isGoogleChrome ? 'chrome' : 'chromium' };
	}
	if (/Safari\//.test(userAgent)) {
		return { supported: false, reason: 'safari' };
	}
	return { supported: false, reason: 'unknown' };
}
