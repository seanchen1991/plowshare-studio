// Screenshots of every screen and state, at laptop, small-laptop and phone
// widths, in Chrome and Firefox with the fixture devices: `pnpm test:review`.
// They land in test-results-review/gallery/ for a person (or agent) to look
// over. The screens that don't move are also compared with saved ones in
// tests/review/screenshots/ (macOS only: other systems draw fonts
// differently); `pnpm test:review --update-snapshots` accepts a change.

import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

export default defineConfig({
	...base,
	testDir: 'tests/review',
	outputDir: 'test-results-review/output',
	grep: undefined,
	grepInvert: undefined,
	reporter: 'list',
	snapshotPathTemplate: '{testDir}/screenshots/{projectName}/{arg}{ext}',
	use: { ...base.use, locale: 'en-US', timezoneId: 'America/Los_Angeles' },
	projects: base.projects!.map(({ testMatch: _, ...project }) => project)
});
