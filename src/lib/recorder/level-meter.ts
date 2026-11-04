// Listens to the mic through Web Audio and reports its level once per frame.
// The analyser only reads the track; it isn't connected to the speakers or the
// recorder.

import { emptyMeter, isClipping, levelStatus, meterPosition, toDb, updateMeter, type LevelStatus, type MeterState } from './level.ts';

export interface LevelReading {
	/** Meter positions, 0 to 1. */
	level: number;
	peak: number;
	clipping: boolean;
	status: LevelStatus;
	/** Recent peaks for the live waveform, oldest first, 0 to 1. */
	bars: number[];
}

const barMs = 50;
const barCount = 120;

/** Starts metering `track`. Returns a function that stops it. */
export function meterLevel(track: MediaStreamTrack, onReading: (reading: LevelReading) => void): () => void {
	const context = new AudioContext();
	const source = context.createMediaStreamSource(new MediaStream([track]));
	const analyser = context.createAnalyser();
	analyser.fftSize = 2048;
	source.connect(analyser);
	const samples = new Float32Array(analyser.fftSize);

	// Browsers may start audio suspended until the user clicks or types.
	const resume = () => void context.resume();
	const resumeEvents = ['pointerdown', 'keydown'] as const;
	if (context.state === 'suspended') resumeEvents.forEach((e) => window.addEventListener(e, resume, { once: true }));

	let state: MeterState = emptyMeter(performance.now());
	const bars: number[] = new Array(barCount).fill(0);
	let barPeak = 0;
	let barStarted = performance.now();
	let frame = requestAnimationFrame(tick);

	function tick(now: number) {
		analyser.getFloatTimeDomainData(samples);
		let peak = 0;
		for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
		state = updateMeter(state, peak, now);

		barPeak = Math.max(barPeak, peak);
		if (now - barStarted >= barMs) {
			bars.shift();
			bars.push(meterPosition(toDb(barPeak)));
			barPeak = 0;
			barStarted = now;
		}

		onReading({
			level: meterPosition(state.levelDb),
			peak: meterPosition(state.peakDb),
			clipping: isClipping(state, now),
			status: levelStatus(state, now),
			bars: [...bars]
		});
		frame = requestAnimationFrame(tick);
	}

	return () => {
		cancelAnimationFrame(frame);
		resumeEvents.forEach((e) => window.removeEventListener(e, resume));
		source.disconnect();
		void context.close();
	};
}
