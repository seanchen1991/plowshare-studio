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

export interface ToneOnsetOptions {
	/** Analysis window. */
	windowMs?: number;
	/** How far above the recording's typical level a window must be to count as tone. */
	ratio?: number;
	/** Quiet time needed between two onsets. */
	minGapMs?: number;
}

/**
 * Onsets of the fixture's tones in audio that went through a room: played on
 * speakers and picked up by a mic, so quiet, noisy and of unknown level. A
 * window counts when its energy at one of `frequencies` stands well above the
 * median window's, rather than above a fixed amplitude as in `detectBeeps`.
 */
export function toneOnsets(
	samples: Float32Array,
	sampleRate: number,
	frequencies: number[],
	{ windowMs = 20, ratio = 30, minGapMs = 500 }: ToneOnsetOptions = {}
): number[] {
	const size = Math.round((windowMs / 1000) * sampleRate);
	const powers: number[] = [];
	for (let from = 0; from + size <= samples.length; from += size) {
		powers.push(Math.max(...frequencies.map((f) => goertzel(samples, from, size, f / sampleRate))));
	}
	const median = [...powers].sort((a, b) => a - b)[Math.floor(powers.length / 2)] ?? 0;
	const onsets: number[] = [];
	let lastLoud = -Infinity;
	powers.forEach((power, i) => {
		if (power <= median * ratio || power < 1e-9) return;
		const time = (i * size) / sampleRate;
		if (time - lastLoud > minGapMs / 1000) onsets.push(time);
		lastLoud = time;
	});
	return onsets;
}

/** Power of one frequency (cycles per sample) in `size` samples from `from`. */
function goertzel(samples: Float32Array, from: number, size: number, frequency: number): number {
	const coefficient = 2 * Math.cos(2 * Math.PI * frequency);
	let previous = 0;
	let beforePrevious = 0;
	for (let i = from; i < from + size; i++) {
		const current = samples[i]! + coefficient * previous - beforePrevious;
		beforePrevious = previous;
		previous = current;
	}
	return (previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious) / (size * size);
}
