// Plays the edit: the plan's pieces end to end, with Cuts skipped, across
// Segment files, Capture gaps and (from issue 27) Sessions. Rather than seeking
// a <video> element at every Cut, it decodes with Mediabunny and schedules the
// audio on the Web Audio clock, sample-accurately, a little ahead, and draws
// each video frame onto a canvas when that clock reaches it. The next piece
// starts decoding while the current one plays, so a jump costs nothing.
// Faster speeds are time-stretched, so voices keep their pitch.

import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input, type InputAudioTrack, type InputVideoTrack, type WrappedCanvas } from 'mediabunny';
import { editToSession, pieceAt, planDurationUs, sessionToEdit, type Piece } from '../lib/edit/plan';
import { Stretcher } from '../lib/edit/stretch';
import { readFile } from '../lib/storage/opfs';

export type Showing = 'segment' | 'gap';

interface Source {
	input: Input;
	video: InputVideoTrack | null;
	audio: InputAudioTrack | null;
}

/** One stretch of playing, from pressing Play (or a seek while playing) until it stops. */
interface Run {
	stopped: boolean;
	/** The edit time playing starts from, and the audio clock time it's heard at. */
	fromUs: number;
	startsAt: number;
	rate: number;
	nodes: Set<AudioBufferSourceNode>;
}

/** Audio is scheduled this far ahead of the clock. */
const aheadSeconds = 1.5;
/** Time to decode the first audio and frame before playing starts. */
const leadSeconds = 0.12;
/** Fades at each piece's edges, so a Cut doesn't click. */
const fadeSeconds = 0.003;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class EditPlayer {
	/** Where the playhead is, in edit time (µs). */
	timeUs = 0;
	playing = false;
	showing: Showing = 'gap';
	/** Playback speed: 1 is normal. */
	rate = 1;
	durationUs: number;

	private sources = new Map<string, Promise<Source>>();
	private stills = new Map<string, CanvasSink>();
	private audio: AudioContext | null = null;
	private run: Run | null = null;
	private frame = 0;
	// Bumped on every seek, so a slower earlier one doesn't draw over a later one.
	private seeks = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private pieces: Piece[],
		/** Runs whenever the playhead, playing or what's showing changes. */
		private readonly onChange: () => void
	) {
		this.durationUs = planDurationUs(pieces);
	}

	play(): void {
		if (this.playing || this.durationUs <= 0) return;
		// Made and resumed straight away, inside the click or key press that allows sound.
		this.audio ??= new AudioContext();
		void this.audio.resume();
		if (this.timeUs >= this.durationUs) this.timeUs = 0;
		this.playing = true;
		this.start();
		this.onChange();
	}

	pause(): void {
		if (this.run) this.timeUs = Math.min(this.heard(this.run), this.durationUs);
		this.playing = false;
		this.stop();
		this.onChange();
	}

	/** Moves the playhead to an edit time; keeps playing if it was. */
	async seek(timeUs: number): Promise<void> {
		const seek = ++this.seeks;
		this.timeUs = Math.min(Math.max(0, Math.round(timeUs)), this.durationUs);
		this.updateShowing();
		if (this.playing) {
			this.stop();
			this.start();
		} else {
			this.onChange();
			await this.drawStill(seek);
		}
	}

	/** Changes the speed; playing carries on from where it is. */
	setRate(rate: number): void {
		this.rate = rate;
		if (this.playing) void this.seek(this.heard(this.run!));
		else this.onChange();
	}

	/**
	 * New pieces after the edit changes. The playhead moves to `atUs` in the new
	 * edit, or by default stays at the same place in the same Session (by its place in the Project).
	 */
	setPieces(pieces: Piece[], atUs?: number): void {
		const at = editToSession(this.pieces, this.run ? this.heard(this.run) : this.timeUs);
		this.pieces = pieces;
		this.durationUs = planDurationUs(pieces);
		void this.seek(atUs ?? sessionToEdit(pieces, at.session, at.sessionUs));
	}

	destroy(): void {
		this.stop();
		void this.audio?.close();
		for (const source of this.sources.values()) void source.then((s) => s.input.dispose()).catch(() => {});
	}

	private start() {
		const audio = this.audio!;
		const run: Run = { stopped: false, fromUs: this.timeUs, startsAt: audio.currentTime + leadSeconds, rate: this.rate, nodes: new Set() };
		this.run = run;
		void this.playAudio(run);
		void this.playVideo(run);
		this.frame = requestAnimationFrame(this.tick);
	}

	private stop() {
		cancelAnimationFrame(this.frame);
		const run = this.run;
		if (!run) return;
		run.stopped = true;
		for (const node of run.nodes) node.stop();
		run.nodes.clear();
		this.run = null;
	}

	/** The audio clock time an edit time plays at. */
	private clockAt(run: Run, editUs: number): number {
		return run.startsAt + (editUs - run.fromUs) / 1e6 / run.rate;
	}

	/** The edit time being heard now: the clock less the time sound takes to reach the speakers. */
	private heard(run: Run): number {
		const audio = this.audio!;
		const now = audio.currentTime - (audio.outputLatency || audio.baseLatency || 0);
		return run.fromUs + Math.max(0, now - run.startsAt) * run.rate * 1e6;
	}

	private readonly tick = () => {
		const run = this.run;
		if (!run || run.stopped) return;
		const now = this.heard(run);
		if (now >= this.durationUs) {
			// The end: the last sound already scheduled plays out rather than being cut off.
			run.stopped = true;
			this.run = null;
			this.timeUs = this.durationUs;
			this.playing = false;
			this.onChange();
			return;
		}
		this.timeUs = now;
		this.updateShowing();
		this.onChange();
		this.frame = requestAnimationFrame(this.tick);
	};

	private updateShowing() {
		const index = pieceAt(this.pieces, this.timeUs);
		this.showing = index >= 0 && this.pieces[index]!.segment ? 'segment' : 'gap';
	}

	private source(path: string): Promise<Source> {
		let source = this.sources.get(path);
		if (!source) {
			source = (async () => {
				const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await readFile(path)) });
				const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
				return { input, video, audio };
			})();
			this.sources.set(path, source);
		}
		return source;
	}

	/** Schedules every piece's audio from where the run starts, staying a little ahead of the clock. */
	private async playAudio(run: Run) {
		const audio = this.audio!;
		const first = pieceAt(this.pieces, run.fromUs);
		if (first < 0) return;
		for (const piece of this.pieces.slice(first)) {
			if (run.stopped) return;
			if (!piece.segment) continue;
			const track = (await this.source(piece.segment.path)).audio;
			if (!track || run.stopped) continue;
			const fromUs = piece.fileStartUs + Math.max(0, run.fromUs - piece.editStartUs);
			const toUs = piece.fileStartUs + piece.durationUs;
			let stretcher: Stretcher | null = null;
			let started = false;
			let at = 0;
			// Held back one block, so the last one can fade out.
			let held: { channels: Float32Array[]; sampleRate: number; fadeIn: boolean } | null = null;
			const send = (block: typeof held, fadeOut: boolean) => {
				if (!block || block.channels[0]!.length === 0) return;
				if (block.fadeIn) fade(block.channels, block.sampleRate, 'in');
				if (fadeOut) fade(block.channels, block.sampleRate, 'out');
				this.schedule(run, block.channels, block.sampleRate, at);
				at += block.channels[0]!.length / block.sampleRate;
			};
			for await (const wrapped of new AudioBufferSink(track).buffers(fromUs / 1e6, toUs / 1e6)) {
				if (run.stopped) return;
				const { buffer } = wrapped;
				const bufferUs = wrapped.timestamp * 1e6;
				const start = Math.max(0, Math.round(((fromUs - bufferUs) / 1e6) * buffer.sampleRate));
				const end = Math.min(buffer.length, Math.round(((toUs - bufferUs) / 1e6) * buffer.sampleRate));
				if (end <= start) continue;
				let channels: Float32Array[] = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(start, end));
				const firstBlock = !started;
				if (firstBlock) {
					started = true;
					// The piece's first sound goes exactly where it belongs in the edit; the rest follows on.
					at = this.clockAt(run, piece.editStartUs + bufferUs + (start / buffer.sampleRate) * 1e6 - piece.fileStartUs);
					if (run.rate !== 1) stretcher = new Stretcher(channels.length, buffer.sampleRate, run.rate);
				}
				if (stretcher) channels = stretcher.push(channels);
				send(held, false);
				held = { channels, sampleRate: buffer.sampleRate, fadeIn: firstBlock };
				while (!run.stopped && at - audio.currentTime > aheadSeconds) await sleep(100);
			}
			if (run.stopped) return;
			if (stretcher && held) {
				const rest = stretcher.flush();
				held = { ...held, channels: held.channels.map((c, i) => concat(c, rest[i]!)) };
			}
			send(held, true);
		}
	}

	private schedule(run: Run, channels: Float32Array[], sampleRate: number, at: number) {
		const audio = this.audio!;
		const seconds = channels[0]!.length / sampleRate;
		if (at + seconds <= audio.currentTime) return;
		const buffer = audio.createBuffer(channels.length, channels[0]!.length, sampleRate);
		channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
		const node = audio.createBufferSource();
		node.buffer = buffer;
		node.connect(audio.destination);
		// Late (just after a seek): start partway in, so it still lines up with the clock.
		const late = audio.currentTime - at;
		if (late > 0) node.start(audio.currentTime, late);
		else node.start(at);
		run.nodes.add(node);
		node.onended = () => run.nodes.delete(node);
	}

	/** Draws each piece's frames as the clock reaches them, opening the next piece while this one plays. */
	private async playVideo(run: Run) {
		const first = pieceAt(this.pieces, run.fromUs);
		if (first < 0) return;
		const open = async (piece: Piece, fromEditUs: number) => {
			if (!piece.segment) return null;
			const track = (await this.source(piece.segment.path)).video;
			if (!track) return null;
			const fromS = (piece.fileStartUs + Math.max(0, fromEditUs - piece.editStartUs)) / 1e6;
			const frames = new CanvasSink(track, { poolSize: 3 }).canvases(fromS, (piece.fileStartUs + piece.durationUs) / 1e6);
			return { frames, first: frames.next() };
		};
		let current = open(this.pieces[first]!, run.fromUs);
		for (let i = first; i < this.pieces.length; i++) {
			const piece = this.pieces[i]!;
			const following = this.pieces[i + 1];
			const next = following ? open(following, following.editStartUs) : null;
			const opened = await current;
			if (opened) {
				let result = await opened.first;
				while (!result.done && !run.stopped) {
					const frame = result.value;
					const startUs = piece.editStartUs + frame.timestamp * 1e6 - piece.fileStartUs;
					const endUs = startUs + frame.duration * 1e6;
					// A frame whose time has already passed is dropped, so the picture catches up with the sound.
					if (endUs > this.heard(run)) {
						while (!run.stopped && this.heard(run) < Math.max(startUs, piece.editStartUs)) await nextFrame();
						if (run.stopped) break;
						this.draw(frame, piece);
					}
					result = await opened.frames.next();
				}
				void opened.frames.return(undefined);
			}
			if (run.stopped) {
				void next?.then((o) => o?.frames.return(undefined));
				return;
			}
			current = next ?? Promise.resolve(null);
		}
	}

	/** The frame at the playhead, while paused. */
	private async drawStill(seek: number) {
		const index = pieceAt(this.pieces, this.timeUs);
		const piece = this.pieces[index];
		if (!piece?.segment) return;
		const track = (await this.source(piece.segment.path)).video;
		if (!track || seek !== this.seeks) return;
		let sink = this.stills.get(piece.segment.path);
		if (!sink) this.stills.set(piece.segment.path, (sink = new CanvasSink(track)));
		const frame = await sink.getCanvas((piece.fileStartUs + this.timeUs - piece.editStartUs) / 1e6);
		if (frame && seek === this.seeks && !this.playing) this.draw(frame, piece);
	}

	private draw(frame: WrappedCanvas, piece: Piece) {
		const { canvas } = this;
		if (canvas.width !== frame.canvas.width || canvas.height !== frame.canvas.height) {
			canvas.width = frame.canvas.width;
			canvas.height = frame.canvas.height;
		}
		canvas.getContext('2d')!.drawImage(frame.canvas, 0, 0);
		// Which moment of which Session is on screen, for anyone checking the picture.
		canvas.dataset.session = String(piece.session);
		canvas.dataset.frameUs = String(Math.round(piece.sessionStartUs + frame.timestamp * 1e6 - piece.fileStartUs));
	}
}

function fade(channels: Float32Array[], sampleRate: number, direction: 'in' | 'out') {
	const length = Math.min(channels[0]!.length, Math.round(fadeSeconds * sampleRate));
	for (const samples of channels) {
		for (let i = 0; i < length; i++) {
			const at = direction === 'in' ? i : samples.length - 1 - i;
			samples[at] = samples[at]! * (i / length);
		}
	}
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
	const joined = new Float32Array(a.length + b.length);
	joined.set(a);
	joined.set(b, a.length);
	return joined;
}
