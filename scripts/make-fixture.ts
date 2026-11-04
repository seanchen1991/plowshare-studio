// Generates the test fixture with ffmpeg. Run with `pnpm fixture`; Playwright
// also runs it automatically before browser tests if the files are missing.
// Usage: node scripts/make-fixture.ts [--force]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fixtureFiles, fixtureSpec as s } from '../tests/fixtures/spec.ts';

export function makeFixture({ force = false } = {}): void {
	if (!force && existsSync(fixtureFiles.video) && existsSync(fixtureFiles.audio)) return;
	mkdirSync(fixtureFiles.dir, { recursive: true });

	const flashFrames = Math.max(1, Math.round((s.beepDurationMs / 1000) * s.fps));
	const boxWidth = 60;
	const boxHeight = 40;
	const stripY = s.height - boxHeight - 20;
	const frameCode = Array.from({ length: s.frameCodeBits }, (_, bit) => {
		// Most significant bit on the left.
		const x = 20 + (s.frameCodeBits - 1 - bit) * boxWidth;
		return `drawbox=x=${x}:y=${stripY}:w=${boxWidth - 4}:h=${boxHeight}:color=white:t=fill:enable='eq(mod(floor(n/${2 ** bit}),2),1)'`;
	});
	const video = [
		`testsrc=size=${s.width}x${s.height}:rate=${s.fps}:decimals=2:duration=${s.loopSeconds}`,
		`drawbox=x=0:y=${stripY - 10}:w=${s.frameCodeBits * boxWidth + 40}:h=${boxHeight + 20}:color=black:t=fill`,
		...frameCode,
		`drawbox=x=${s.width - 150}:y=10:w=140:h=140:color=black:t=fill`,
		`drawbox=x=${s.width - 140}:y=20:w=120:h=120:color=white:t=fill:enable='lt(mod(n,${s.fps * s.beepIntervalSeconds}),${flashFrames})'`
	].join(',');

	execFileSync('ffmpeg', [
		'-hide_banner', '-loglevel', 'error', '-y',
		'-f', 'lavfi', '-i', video,
		// 4:2:0: Chrome's fake camera shows plain green for ffmpeg's default 4:4:4 MJPEG.
		'-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', '4', '-f', 'mjpeg', fixtureFiles.video
	], { stdio: 'inherit' });

	const beepSeconds = s.beepDurationMs / 1000;
	const tone = `if(lt(mod(t,${s.markerEverySeconds}),${s.beepIntervalSeconds}),${s.markerHz},${s.toneHz})`;
	const audio = `aevalsrc='0.5*sin(2*PI*${tone}*t)*lt(mod(t,${s.beepIntervalSeconds}),${beepSeconds})':s=${s.sampleRate}:d=${s.loopSeconds}`;

	execFileSync('ffmpeg', [
		'-hide_banner', '-loglevel', 'error', '-y',
		'-f', 'lavfi', '-i', audio,
		'-ac', '1', '-c:a', 'pcm_s16le', fixtureFiles.audio
	], { stdio: 'inherit' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	makeFixture({ force: process.argv.includes('--force') });
}
