import { fixtureSpec as s } from '../fixtures/spec.ts';

/** Synthesizes the fixture's audio track, matching scripts/make-fixture.ts. */
export function synthesizeFixtureAudio(seconds: number, sampleRate: number = s.sampleRate): Float32Array {
	const samples = new Float32Array(Math.round(seconds * sampleRate));
	const beepSeconds = s.beepDurationMs / 1000;
	for (let i = 0; i < samples.length; i++) {
		const t = i / sampleRate;
		const inBeep = t % s.beepIntervalSeconds < beepSeconds;
		const hz = t % s.markerEverySeconds < s.beepIntervalSeconds ? s.markerHz : s.toneHz;
		samples[i] = inBeep ? 0.5 * Math.sin(2 * Math.PI * hz * t) : 0;
	}
	return samples;
}
