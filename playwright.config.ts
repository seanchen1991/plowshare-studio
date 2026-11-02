import { defineConfig, devices } from '@playwright/test';

const port = 4173;
// Tests tagged @long (hour-long recordings, crash runs) only run when LONG_TESTS is set.
const longTests = !!process.env.LONG_TESTS;

export default defineConfig({
	testDir: 'tests/e2e',
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
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		port,
		reuseExistingServer: !process.env.CI
	}
});
