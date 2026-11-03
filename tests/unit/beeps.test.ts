import { describe, expect, it } from 'vitest';
import { fixtureSpec as s } from '../fixtures/spec.ts';
import { detectBeeps } from '../helpers/beeps.ts';
import { synthesizeFixtureAudio } from '../helpers/fixture-audio.ts';

describe('detectBeeps', () => {
	it('finds one beep per second at the right times, within 1 ms', () => {
		const beeps = detectBeeps(synthesizeFixtureAudio(12), s.sampleRate);
		expect(beeps).toHaveLength(12);
		beeps.forEach((beep, second) => {
			expect(beep.timeSeconds).toBeCloseTo(second, 3);
		});
	});

	it('tells marker beeps from regular ones by frequency', () => {
		const beeps = detectBeeps(synthesizeFixtureAudio(12), s.sampleRate);
		const markers = beeps.filter((b) => b.frequencyHz > (s.toneHz + s.markerHz) / 2);
		expect(markers.map((b) => Math.round(b.timeSeconds))).toEqual([0, 10]);
		for (const beep of beeps) {
			const expected = markers.includes(beep) ? s.markerHz : s.toneHz;
			expect(Math.abs(beep.frequencyHz - expected)).toBeLessThan(expected * 0.05);
		}
	});

	it('ignores low-level noise between beeps', () => {
		const samples = synthesizeFixtureAudio(5);
		let seed = 1;
		for (let i = 0; i < samples.length; i++) {
			seed = (seed * 16807) % 2147483647;
			samples[i]! += (seed / 2147483647 - 0.5) * 0.04;
		}
		expect(detectBeeps(samples, s.sampleRate).map((b) => Math.round(b.timeSeconds))).toEqual([0, 1, 2, 3, 4]);
	});

	it('reports a gap as missing beeps', () => {
		const samples = synthesizeFixtureAudio(6);
		samples.fill(0, 2 * s.sampleRate, 4 * s.sampleRate);
		expect(detectBeeps(samples, s.sampleRate).map((b) => Math.round(b.timeSeconds))).toEqual([0, 1, 4, 5]);
	});

	it('returns nothing for silence', () => {
		expect(detectBeeps(new Float32Array(s.sampleRate), s.sampleRate)).toEqual([]);
	});
});
