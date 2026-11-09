// Playing audio faster without raising its pitch, for preview at 1.5× and 2×:
// WSOLA (waveform-similarity overlap-add). Short windowed frames are taken from
// the input `speed` times further apart than they're laid down in the output,
// each nudged to where it best continues the frame before, so the joins don't
// click. Streaming, so a long Session is never held whole. Pure.

export class Stretcher {
	/** Frame length, and the hop between frames in the output. */
	private readonly frame: number;
	private readonly hop: number;
	/** How far a frame may move to fit the one before. */
	private readonly tolerance: number;
	private readonly window: Float32Array;

	// Input not yet used up, per channel, starting at stream sample `inputStart`.
	private input: Float32Array[];
	private inputStart = 0;
	private inputLength = 0;
	/** Frames laid down so far, and where in the input the last one came from. */
	private frames = 0;
	private lastFrom = 0;
	/** The second half of the last windowed frame, waiting for the next to overlap it. */
	private tail: Float32Array[];
	/** Output samples given out so far. */
	private emitted = 0;

	constructor(
		private readonly channels: number,
		sampleRate: number,
		private readonly speed: number
	) {
		this.hop = Math.round(sampleRate * 0.02);
		this.frame = this.hop * 2;
		this.tolerance = Math.round(sampleRate * 0.012);
		// A periodic Hann window: overlapping by half, the windows add up to 1.
		this.window = new Float32Array(this.frame);
		for (let i = 0; i < this.frame; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frame);
		this.input = Array.from({ length: channels }, () => new Float32Array(this.frame * 4));
		this.tail = Array.from({ length: channels }, () => new Float32Array(this.hop));
	}

	/** Adds a block of audio, one array per channel, and returns the output it completes. */
	push(block: Float32Array[]): Float32Array[] {
		if (this.speed === 1) return block.map((c) => c.slice());
		this.append(block);
		return this.process(this.inputStart + this.inputLength);
	}

	/** The rest of the output, once the input has ended. */
	flush(): Float32Array[] {
		if (this.speed === 1) return Array.from({ length: this.channels }, () => new Float32Array(0));
		const end = this.inputStart + this.inputLength;
		// Silence after the end lets the last frames be taken; output stops where the input would.
		this.append(Array.from({ length: this.channels }, () => new Float32Array(this.frame + this.tolerance)));
		const before = this.emitted;
		const out = this.process(end);
		// Exactly as long as the input at this speed.
		const length = Math.max(0, Math.min(out[0]!.length + this.hop, Math.round(end / this.speed) - before));
		this.emitted = before + length;
		return out.map((c, i) => {
			const joined = new Float32Array(c.length + this.hop);
			joined.set(c);
			joined.set(this.tail[i]!, c.length);
			return joined.subarray(0, length);
		});
	}

	private append(block: Float32Array[]) {
		const length = block[0]?.length ?? 0;
		if (this.inputLength + length > this.input[0]!.length) {
			const size = Math.max(this.input[0]!.length * 2, this.inputLength + length);
			this.input = this.input.map((c) => {
				const grown = new Float32Array(size);
				grown.set(c.subarray(0, this.inputLength));
				return grown;
			});
		}
		block.forEach((c, i) => this.input[i]!.set(c, this.inputLength));
		this.inputLength += length;
	}

	/** Lays down every frame whose ideal start lies before `until` and whose input is all here. */
	private process(until: number): Float32Array[] {
		const out: Float32Array[][] = Array.from({ length: this.channels }, () => []);
		const available = this.inputStart + this.inputLength;
		for (;;) {
			const ideal = Math.round(this.frames * this.hop * this.speed);
			if (ideal >= until || ideal + this.tolerance + this.frame > available) break;
			const from = this.frames === 0 ? 0 : this.bestFrom(ideal);
			for (let c = 0; c < this.channels; c++) {
				const samples = this.input[c]!;
				const at = from - this.inputStart;
				const done = new Float32Array(this.hop);
				for (let i = 0; i < this.hop; i++) done[i] = this.tail[c]![i]! + samples[at + i]! * this.window[i]!;
				for (let i = 0; i < this.hop; i++) this.tail[c]![i] = samples[at + this.hop + i]! * this.window[this.hop + i]!;
				out[c]!.push(done);
			}
			this.lastFrom = from;
			this.frames++;
		}
		this.discardUsed();
		this.emitted += out[0]!.length * this.hop;
		return out.map((parts) => {
			const joined = new Float32Array(parts.length * this.hop);
			parts.forEach((p, i) => joined.set(p, i * this.hop));
			return joined;
		});
	}

	/**
	 * Where near `ideal` to take the next frame: the start whose first half looks
	 * most like what naturally followed the last frame (the continuation it overlaps).
	 */
	private bestFrom(ideal: number): number {
		const natural = this.lastFrom + this.hop - this.inputStart;
		const low = Math.max(this.inputStart, ideal - this.tolerance);
		const high = ideal + this.tolerance;
		let best = Math.max(low, ideal);
		let bestScore = -Infinity;
		// Every second offset, comparing every fourth sample: plenty for speech, and cheap.
		for (let from = low; from <= high; from += 2) {
			const at = from - this.inputStart;
			let product = 0;
			let energy = 1e-9;
			for (let c = 0; c < this.channels; c++) {
				const samples = this.input[c]!;
				for (let i = 0; i < this.hop; i += 4) {
					const candidate = samples[at + i]!;
					product += samples[natural + i]! * candidate;
					energy += candidate * candidate;
				}
			}
			const score = product / Math.sqrt(energy);
			if (score > bestScore) {
				bestScore = score;
				best = from;
			}
		}
		return best;
	}

	/** Drops input no later frame can reach. */
	private discardUsed() {
		const keepFrom = Math.min(this.lastFrom, Math.round(this.frames * this.hop * this.speed) - this.tolerance);
		const drop = keepFrom - this.inputStart;
		if (drop < this.frame * 2) return;
		for (const c of this.input) c.copyWithin(0, drop, this.inputLength);
		this.inputStart += drop;
		this.inputLength -= drop;
	}
}
