// Spike 03: records with every supported MediaRecorder format in each browser
// available on this machine. Browsers come from SPIKE_BROWSERS (comma-separated
// project names); defaults to Playwright's own Chromium and Firefox.

import { defineConfig, devices } from '@playwright/test';

const port = 4174;
const chromiumArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

const allProjects = [
	{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: chromiumArgs } } },
	{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', launchOptions: { args: chromiumArgs } } },
	{ name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge', launchOptions: { args: chromiumArgs } } },
	{
		name: 'firefox',
		use: {
			...devices['Desktop Firefox'],
			launchOptions: {
				firefoxUserPrefs: {
					'media.navigator.streams.fake': true,
					'media.navigator.permission.disabled': true
				}
			}
		}
	}
];

const wanted = (process.env.SPIKE_BROWSERS ?? 'chromium,firefox').split(',');

export default defineConfig({
	testDir: '.',
	testMatch: 'record.spec.ts',
	timeout: 10 * 60_000,
	workers: 1,
	reporter: 'list',
	use: { baseURL: `http://localhost:${port}` },
	projects: allProjects.filter((p) => wanted.includes(p.name)),
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		port,
		reuseExistingServer: !process.env.CI
	}
});
