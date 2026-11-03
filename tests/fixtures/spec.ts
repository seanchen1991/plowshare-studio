// The test fixture: a looping video with a running timestamp, a binary frame
// counter and a white flash on every beep, plus a matching audio track. Chrome
// plays it as a fake camera and mic. Both tracks loop every `loopSeconds`.

export const fixtureSpec = {
	loopSeconds: 60,
	width: 1280,
	height: 720,
	fps: 30,
	sampleRate: 48000,
	// One short beep at the start of every second...
	beepIntervalSeconds: 1,
	beepDurationMs: 50,
	toneHz: 1000,
	// ...except every 10th second, which uses a higher marker tone.
	markerEverySeconds: 10,
	markerHz: 2000,
	// Frame number in binary, drawn as a strip of boxes along the bottom.
	frameCodeBits: 12
} as const;

export const fixtureFiles = {
	dir: 'tests/fixtures/.generated',
	video: 'tests/fixtures/.generated/fixture.mjpeg',
	audio: 'tests/fixtures/.generated/fixture.wav'
} as const;
