// Tests against this computer's real camera, mic and speakers, in Chrome and
// Firefox. Not run in CI, which has no devices: `pnpm test:hardware` on a
// machine that has them. The browsers' own permission prompts are skipped;
// macOS asks once for the terminal the tests run from.

import { defineConfig, devices } from '@playwright/test';

const port = 4175;

export default defineConfig({
	testDir: 'tests/hardware',
	outputDir: 'test-results-hardware',
	// One camera: takes can't overlap.
	workers: 1,
	fullyParallel: false,
	reporter: [['list'], ['json', { outputFile: 'test-results-hardware/results.json' }]],
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-fake-ui-for-media-stream'] } }
		},
		{
			name: 'firefox',
			use: {
				...devices['Desktop Firefox'],
				launchOptions: { firefoxUserPrefs: { 'media.navigator.permission.disabled': true } }
			}
		}
	],
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		port,
		reuseExistingServer: true
	}
});
