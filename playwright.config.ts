import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { fixtureFiles } from './tests/fixtures/spec.ts';

const port = 4173;
// Tests tagged @long (hour-long recordings, crash runs) only run when LONG_TESTS is set.
const longTests = !!process.env.LONG_TESTS;

export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/global-setup.ts',
	grep: longTests ? /@long/ : undefined,
	grepInvert: longTests ? undefined : /@long/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// The fixture plays as the camera and mic; permission prompts are auto-accepted.
				launchOptions: {
					args: [
						'--use-fake-device-for-media-stream',
						'--use-fake-ui-for-media-stream',
						`--use-file-for-fake-video-capture=${resolve(fixtureFiles.video)}`,
						`--use-file-for-fake-audio-capture=${resolve(fixtureFiles.audio)}`
					]
				}
			}
		}
	],
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		port,
		reuseExistingServer: !process.env.CI
	}
});
