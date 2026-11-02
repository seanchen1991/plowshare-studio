import { describe, expect, it } from 'vitest';
import { detectBrowserSupport } from './support';

const userAgents = {
	chromeMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
	chromeLinux:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
	edgeWindows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
	firefoxWindows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
	firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
	opera:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 OPR/126.0.0.0',
	safariMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15',
	safariIphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1',
	chromeIphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1',
	firefoxIpad:
		'Mozilla/5.0 (iPad; CPU OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15'
};

describe('detectBrowserSupport', () => {
	it.each([
		['chromeMac', 'chrome'],
		['chromeLinux', 'chrome'],
		['edgeWindows', 'edge'],
		['firefoxWindows', 'firefox'],
		['firefoxLinux', 'firefox'],
		['opera', 'chromium']
	] as const)('supports %s', (name, browser) => {
		expect(detectBrowserSupport(userAgents[name])).toEqual({ supported: true, browser });
	});

	it('rejects Safari on the Mac', () => {
		expect(detectBrowserSupport(userAgents.safariMac)).toEqual({
			supported: false,
			reason: 'safari'
		});
	});

	it.each(['safariIphone', 'chromeIphone', 'firefoxIpad'] as const)(
		'rejects every browser on iPhone and iPad (%s)',
		(name) => {
			expect(detectBrowserSupport(userAgents[name])).toEqual({ supported: false, reason: 'ios' });
		}
	);

	it('rejects browsers it does not recognize', () => {
		expect(detectBrowserSupport('curl/8.0')).toEqual({ supported: false, reason: 'unknown' });
	});
});
