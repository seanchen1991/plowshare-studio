// Drives Chrome or Firefox without Playwright attached to the page. Playwright
// keeps every page it controls "visible" (Chrome treats its focus emulation as
// a screen capture), so a test of a real background tab has to launch the
// browser itself and talk to it over the DevTools protocol (Chrome) or
// WebDriver BiDi (Firefox). Playwright's own Firefox build never reports a tab
// as hidden, so Firefox here is a regular installed one. Only what the
// background-tab test needs.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserType } from '@playwright/test';

/** An installed Firefox: FIREFOX_BIN, the macOS app, or `firefox` on the PATH. */
export function installedFirefox(): string | null {
	const candidates = [process.env.FIREFOX_BIN, '/Applications/Firefox.app/Contents/MacOS/firefox'];
	for (const path of candidates) if (path && existsSync(path)) return path;
	try {
		return execFileSync('which', ['firefox'], { encoding: 'utf8' }).trim() || null;
	} catch {
		return null;
	}
}

export interface RawBrowser {
	/** Opens `url` in the first tab and runs `preload` (a function's source) before the page's own scripts. */
	open(url: string, preload?: string): Promise<void>;
	/** Evaluates an expression in the app's tab, as if the user had just clicked, and returns its JSON-serializable result. */
	evaluate<T>(expression: string): Promise<T>;
	/** Opens another tab in the same window and brings it to the front, so the app's tab is hidden. */
	coverWithAnotherTab(): Promise<void>;
	close(): Promise<void>;
}

/** Waits for the browser to print the address of its debugging socket. */
function socketUrl(child: ChildProcess, pattern: RegExp): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = '';
		const timer = setTimeout(() => reject(new Error(`No debugging socket in: ${output.slice(-500)}`)), 30_000);
		child.stderr!.on('data', (data: Buffer) => {
			output += data.toString();
			const match = pattern.exec(output);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]!);
			}
		});
		child.once('exit', (code) => reject(new Error(`Browser exited (${code}): ${output.slice(-500)}`)));
	});
}

/** A JSON-over-WebSocket connection with numbered commands, as both protocols use. */
async function connect(url: string) {
	const socket = new WebSocket(url);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	let lastId = 0;
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(String(event.data));
		const waiter = message.id !== undefined ? pending.get(message.id) : undefined;
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(`${message.error.message ?? message.error}: ${message.message ?? ''}`));
		else waiter.resolve(message.result);
	});
	return {
		send(method: string, params: object = {}, extra: object = {}): Promise<any> {
			const id = ++lastId;
			socket.send(JSON.stringify({ id, method, params, ...extra }));
			return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
		},
		close: () => socket.close()
	};
}

/** Resolves when the browser exits; kills it if it hasn't 10 s after being asked to close. */
function exitOrKill(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	const exited = new Promise<void>((done) => child.once('exit', () => done()));
	const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
	return exited.finally(() => clearTimeout(timer));
}

const evaluateJson = (expression: string) => `(async () => JSON.stringify(await (${expression})))()`;

/** Chrome (Playwright's build is fine); downloads go to `downloads`. */
export async function launchChrome(browserType: BrowserType, profile: string, downloads: string, args: string[]): Promise<RawBrowser> {
	const child = spawn(
		browserType.executablePath(),
		[
			`--user-data-dir=${profile}`,
			'--remote-debugging-port=0',
			'--headless=new',
			'--no-first-run',
			'--no-default-browser-check',
			'--no-sandbox',
			...args,
			'about:blank'
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	const cdp = await connect(await socketUrl(child, /DevTools listening on (ws:\S+)/));
	await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
	let sessionId = '';

	const browser: RawBrowser = {
		async open(url, preload) {
			const { targetInfos } = await cdp.send('Target.getTargets');
			const tab = targetInfos.find((t: { type: string }) => t.type === 'page');
			({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: tab.targetId, flatten: true }));
			await cdp.send('Page.enable', {}, { sessionId });
			if (preload) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${preload})()` }, { sessionId });
			await cdp.send('Page.navigate', { url }, { sessionId });
		},
		async evaluate(expression) {
			const { result, exceptionDetails } = await cdp.send(
				'Runtime.evaluate',
				{ expression: evaluateJson(expression), awaitPromise: true, returnByValue: true, userGesture: true },
				{ sessionId }
			);
			if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
			return result.value === undefined ? undefined : JSON.parse(result.value);
		},
		async coverWithAnotherTab() {
			const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: false });
			await cdp.send('Target.activateTarget', { targetId });
		},
		async close() {
			const exited = exitOrKill(child);
			await cdp.send('Browser.close').catch(() => {});
			cdp.close();
			await exited;
		}
	};
	return browser;
}

/** An installed Firefox (see `installedFirefox`); downloads go to `downloads`. */
export async function launchFirefox(executable: string, profile: string, downloads: string, prefs: Record<string, unknown>): Promise<RawBrowser> {
	const allPrefs = {
		...prefs,
		// window.open makes a tab in the same window, which hides the app's tab.
		'browser.link.open_newwindow': 3,
		'browser.link.open_newwindow.restriction': 0,
		'browser.download.dir': downloads,
		'browser.download.folderList': 2,
		'browser.download.useDownloadDir': true,
		'browser.download.always_ask_before_handling_new_types': false,
		'browser.download.alwaysOpenPanel': false,
		'browser.shell.checkDefaultBrowser': false,
		'browser.startup.homepage_override.mstone': 'ignore',
		'startup.homepage_welcome_url': 'about:blank',
		'browser.aboutwelcome.enabled': false,
		'datareporting.policy.dataSubmissionEnabled': false
	};
	writeFileSync(join(profile, 'user.js'), Object.entries(allPrefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});\n`).join(''));
	const child = spawn(executable, ['--headless', '--remote-debugging-port', '0', '-profile', profile, '-no-remote', 'about:blank'], {
		stdio: ['ignore', 'ignore', 'pipe']
	});
	const bidi = await connect(`${await socketUrl(child, /WebDriver BiDi listening on (ws:\S+)/)}/session`);
	await bidi.send('session.new', { capabilities: {} });
	let context = '';

	const browser: RawBrowser = {
		async open(url, preload) {
			({ contexts: [{ context }] } = await bidi.send('browsingContext.getTree', { maxDepth: 0 }));
			if (preload) await bidi.send('script.addPreloadScript', { functionDeclaration: preload, contexts: [context] });
			await bidi.send('browsingContext.navigate', { context, url, wait: 'complete' });
		},
		async evaluate(expression) {
			const response = await bidi.send('script.evaluate', {
				expression: evaluateJson(expression),
				target: { context },
				awaitPromise: true,
				userActivation: true
			});
			if (response.type === 'exception') throw new Error(response.exceptionDetails.text);
			return response.result.type === 'string' ? JSON.parse(response.result.value) : undefined;
		},
		async coverWithAnotherTab() {
			await browser.evaluate(`window.open('about:blank', '_blank') !== null`);
		},
		async close() {
			const exited = exitOrKill(child);
			await bidi.send('browser.close').catch(() => {});
			bidi.close();
			await exited;
		}
	};
	return browser;
}
