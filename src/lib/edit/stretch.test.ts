import { describe, expect, it } from 'vitest';
import { Stretcher } from './stretch.ts';

const rate = 48000;

function tone(seconds: number, hz: number, amplitude = 0.5): Float32Array {
	const samples = new Float32Array(Math.round(seconds * rate));
	for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
	return samples;
}

/** Runs `input` through a Stretcher in blocks of `block` samples. */
function stretch(input: Float32Array[], speed: number, block = 4096): Float32Array[] {
	const stretcher = new Stretcher(input.length, rate, speed);
	const out: Float32Array[][] = input.map(() => []);
	const take = (chunk: Float32Array[]) => chunk.forEach((c, i) => out[i]!.push(c));
	for (let at = 0; at < input[0]!.length; at += block) take(stretcher.push(input.map((c) => c.subarray(at, at + block))));
	take(stretcher.flush());
	return out.map((parts) => {
		const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const p of parts) {
			joined.set(p, at);
			at += p.length;
		}
		return joined;
	});
}

/** Frequency from zero crossings, over the steady middle of `samples`. */
function frequency(samples: Float32Array): number {
	const from = Math.floor(samples.length * 0.2);
	const to = Math.floor(samples.length * 0.8);
	let crossings = 0;
	for (let i = from + 1; i < to; i++) if (samples[i - 1]! < 0 !== samples[i]! < 0) crossings++;
	return crossings / 2 / ((to - from) / rate);
}

/** The biggest jump between neighbouring samples in the steady middle: a click shows as a big one. */
function biggestStep(samples: Float32Array): number {
	let biggest = 0;
	for (let i = Math.floor(samples.length * 0.1); i < samples.length * 0.9; i++) biggest = Math.max(biggest, Math.abs(samples[i]! - samples[i - 1]!));
	return biggest;
}

describe('Stretcher', () => {
	for (const speed of [1.5, 2]) {
		it(`plays ${speed}× as fast at the same pitch`, () => {
			const [out] = stretch([tone(2, 1000)], speed);
			expect(Math.abs(out!.length - (2 * rate) / speed)).toBeLessThan(rate * 0.01);
			expect(frequency(out!)).toBeGreaterThan(980);
			expect(frequency(out!)).toBeLessThan(1020);
			// A 1 kHz tone at 0.5 moves at most 0.065 between samples; joins don't click.
			expect(biggestStep(out!)).toBeLessThan(0.1);
		});
	}

	it('gives the same length whatever size the blocks come in', () => {
		const input = [tone(1, 440)];
		expect(stretch(input, 1.5, 500)[0]!.length).toBe(stretch(input, 1.5, 9000)[0]!.length);
	});

	it('keeps channels in step, cut at the same places', () => {
		const left = tone(1, 300);
		const [l, r] = stretch([left, left.map((v) => v * 0.5)], 2);
		expect(r!.length).toBe(l!.length);
		for (let i = 0; i < l!.length; i += 97) expect(r![i]).toBeCloseTo(l![i]! * 0.5, 5);
	});

	it('passes audio through untouched at 1×', () => {
		const input = tone(0.5, 440);
		const [out] = stretch([input], 1);
		expect(Array.from(out!)).toEqual(Array.from(input));
	});
});
