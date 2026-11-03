// Finds the fixture's beeps in recorded audio, so tests can measure lost time
// and A/V sync as numbers. Pure: takes samples, no browser APIs.

export interface Beep {
	/** Onset of the beep, in seconds from the start of `samples`. */
	timeSeconds: number;
	/** Tone frequency estimated from zero crossings. */
	frequencyHz: number;
}

export interface DetectBeepsOptions {
	/** Absolute amplitude a sample must exceed to count as part of a beep. */
	threshold?: number;
	/** Quiet time needed between two beeps for them to count separately. */
	minGapMs?: number;
}

export function detectBeeps(
	samples: Float32Array,
	sampleRate: number,
	{ threshold = 0.1, minGapMs = 200 }: DetectBeepsOptions = {}
): Beep[] {
	const minGap = Math.round((minGapMs / 1000) * sampleRate);
	const beeps: Beep[] = [];
	let start = -1;
	let lastLoud = -Infinity;

	const finish = () => {
		if (start < 0) return;
		beeps.push({
			timeSeconds: start / sampleRate,
			frequencyHz: estimateFrequency(samples, start, lastLoud, sampleRate)
		});
		start = -1;
	};

	for (let i = 0; i < samples.length; i++) {
		if (Math.abs(samples[i]!) <= threshold) continue;
		if (i - lastLoud > minGap) {
			finish();
			start = i;
		}
		lastLoud = i;
	}
	finish();
	return beeps;
}

function estimateFrequency(samples: Float32Array, from: number, to: number, sampleRate: number): number {
	let crossings = 0;
	for (let i = from + 1; i <= to; i++) {
		if (samples[i - 1]! < 0 !== samples[i]! < 0) crossings++;
	}
	const seconds = (to - from) / sampleRate;
	return seconds > 0 ? crossings / 2 / seconds : 0;
}
