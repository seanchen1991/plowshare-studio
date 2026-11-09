import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { fixtureFiles } from './tests/fixtures/spec.ts';

const port = 4173;
// Tests tagged @long (hour-long recordings) only run when LONG_TESTS is set.
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
						// Otherwise performance.memory is rounded into coarse buckets, hiding slow leaks.
						'--enable-precise-memory-info',
						`--use-file-for-fake-video-capture=${resolve(fixtureFiles.video)}`,
						`--use-file-for-fake-audio-capture=${resolve(fixtureFiles.audio)}`
					]
				}
			}
		},
		{
			// Only the specs that must hold in Firefox too; the camera and mic come from tests/helpers/fake-media.ts.
			name: 'firefox',
			testMatch: /(recover|library|background|staying-alive|storage|persistence|shows|backup|device-drops|back-to-back|editor|preview|projects|open-file)\.spec\.ts/,
			use: {
				...devices['Desktop Firefox'],
				launchOptions: {
					firefoxUserPrefs: {
						'media.navigator.streams.fake': true,
						'media.navigator.permission.disabled': true,
						// The stand-in mic is Web Audio, which must play without a click.
						'media.autoplay.default': 0,
						'media.autoplay.block-webaudio': false
					}
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
