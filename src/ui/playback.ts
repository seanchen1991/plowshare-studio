// Plays a Recording's Segments in the editor as one timeline. Segments are
// separate files, so the media element switches file at each Segment; in a
// Capture gap it shows nothing while the playhead moves on by the clock.

import { readFile } from '../lib/storage/opfs';
import { locate, type PlacedSegment } from '../lib/edit/timeline';

export type Showing = 'segment' | 'gap';

export class Playback {
	/** Where the playhead is, in microseconds. */
	timeUs = 0;
	playing = false;
	showing: Showing = 'gap';

	private loaded: PlacedSegment | null = null;
	private url: string | null = null;
	private frame = 0;
	private lastTick = 0;
	// Bumped on every seek, so a slower earlier one doesn't win.
	private seeks = 0;

	constructor(
		private readonly media: HTMLMediaElement,
		private readonly segments: PlacedSegment[],
		private readonly durationUs: number,
		/** Runs whenever the playhead, playing or what's showing changes. */
		private readonly onChange: () => void
	) {
		media.addEventListener('ended', this.onEnded);
	}

	async play(): Promise<void> {
		if (this.timeUs >= this.durationUs) await this.seek(0);
		this.playing = true;
		this.lastTick = performance.now();
		if (this.showing === 'segment') await this.media.play().catch(() => {});
		this.frame = requestAnimationFrame(this.tick);
		this.onChange();
	}

	pause(): void {
		this.playing = false;
		cancelAnimationFrame(this.frame);
		this.media.pause();
		this.onChange();
	}

	/** Moves the playhead, loading the Segment there if it isn't already; keeps playing if it was. */
	async seek(timeUs: number): Promise<void> {
		const seek = ++this.seeks;
		this.timeUs = Math.min(Math.max(0, timeUs), this.durationUs);
		const position = locate(this.segments, this.timeUs);
		if (position.kind !== 'segment') {
			this.media.pause();
			this.showing = 'gap';
			if (position.kind === 'end') this.pause();
			this.onChange();
			return;
		}
		if (this.loaded?.index !== position.segment.index) {
			this.media.pause();
			this.showing = 'gap';
			this.onChange();
			const url = URL.createObjectURL(await readFile(position.segment.path));
			if (seek !== this.seeks) return URL.revokeObjectURL(url);
			if (this.url) URL.revokeObjectURL(this.url);
			this.url = url;
			this.loaded = position.segment;
			this.media.src = url;
			await new Promise((resolve) => this.media.addEventListener('loadedmetadata', resolve, { once: true }));
			if (seek !== this.seeks) return;
		}
		this.media.currentTime = position.offsetUs / 1e6;
		this.showing = 'segment';
		if (this.playing) await this.media.play().catch(() => {});
		this.onChange();
	}

	destroy(): void {
		cancelAnimationFrame(this.frame);
		this.media.removeEventListener('ended', this.onEnded);
		this.media.pause();
		this.media.removeAttribute('src');
		this.media.load();
		if (this.url) URL.revokeObjectURL(this.url);
	}

	private readonly tick = (now: number) => {
		if (!this.playing) return;
		const elapsedUs = (now - this.lastTick) * 1000;
		this.lastTick = now;
		const position = locate(this.segments, this.timeUs);
		if (this.showing === 'segment' && this.loaded) {
			// The media element keeps the time while a Segment plays.
			this.timeUs = Math.min(this.loaded.startUs + this.media.currentTime * 1e6, this.loaded.startUs + this.loaded.durationUs);
			this.onChange();
		} else if (position.kind === 'gap') {
			this.timeUs = Math.min(this.timeUs + elapsedUs, position.nextStartUs);
			this.onChange();
			if (this.timeUs >= position.nextStartUs) void this.seek(position.nextStartUs);
		} else if (position.kind === 'end') {
			this.timeUs = this.durationUs;
			this.pause();
			return;
		}
		this.frame = requestAnimationFrame(this.tick);
	};

	/** A Segment's file ran out: carry on from its end, into a gap, the next Segment or the end. */
	private readonly onEnded = () => {
		if (!this.loaded || !this.playing) return;
		void this.seek(this.loaded.startUs + this.loaded.durationUs);
	};
}
