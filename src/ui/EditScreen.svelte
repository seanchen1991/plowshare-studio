<script lang="ts">
	/**
	 * The editor: the video above the timeline, a toolbar, and the timeline with
	 * a ruler, a chip row and one lane per Track. Plays the first Track; every
	 * Track gets a lane, for a host plus up to 3 guests.
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import { peakCount } from '../lib/analysis/peaks';
	import { loadPeaks } from '../lib/analysis/waveform';
	import { placedSegments, rulerMarks, sessionDurationUs, type PlacedSegment } from '../lib/edit/timeline';
	import type { Project } from '../lib/storage/project-file';
	import type { Recording, Session } from '../lib/storage/session-file';
	import Button from './Button.svelte';
	import LaneWaveform from './LaneWaveform.svelte';
	import { formatDuration, formatTimecode } from './format';
	import { Playback, type Showing } from './playback';

	let { project, session }: { project: Project; session: Session } = $props();

	interface Track {
		recording: Recording;
		segments: PlacedSegment[];
		color: string;
		name: string;
		role: string;
	}

	// A Ready take's Segments don't change, so the editor keeps the take as it opened (it's remounted for another).
	const opened = untrack(() => session);
	const tracks: Track[] = opened.recordings.map((recording, i) => ({
		recording,
		segments: placedSegments(recording.segments),
		color: `var(--track-${(i % 4) + 1})`,
		name: recording.participant.role === 'host' ? 'You' : `Guest ${i}`,
		role: recording.participant.role === 'host' ? 'Host' : 'Guest'
	}));
	const durationUs = sessionDurationUs(opened);
	const lead = tracks[0]!;
	const video = lead.recording.video;

	let media = $state<HTMLVideoElement>();
	let playback: Playback | undefined;
	let timeUs = $state(0);
	let playing = $state(false);
	let showing = $state<Showing>('gap');

	// Peaks per Track, by Segment index; `version` changes as they arrive.
	const peaks = tracks.map(() => new Map<number, Uint8Array>());
	const known = tracks.map(() => new Map<number, number>());
	let version = $state(0);
	const loading = new AbortController();

	let rulerWidth = $state(0);
	const marks = $derived(rulerMarks(durationUs, rulerWidth));
	const fraction = (us: number) => (durationUs > 0 ? us / durationUs : 0);

	onMount(() => {
		playback = new Playback(media!, lead.segments, durationUs, () => {
			timeUs = playback!.timeUs;
			playing = playback!.playing;
			showing = playback!.showing;
		});
		void playback.seek(0);
		void loadAllPeaks();
	});

	onDestroy(() => {
		loading.abort();
		playback?.destroy();
	});

	/** One Segment at a time, Track by Track, so long takes don't decode in parallel. */
	async function loadAllPeaks() {
		for (const [t, track] of tracks.entries()) {
			for (const segment of track.segments) {
				const bins = new Uint8Array(peakCount(segment.durationUs));
				peaks[t]!.set(segment.index, bins);
				try {
					await loadPeaks(
						segment,
						(from, values) => {
							bins.set(values.subarray(0, bins.length - from), from);
							known[t]!.set(segment.index, Math.max(known[t]!.get(segment.index) ?? 0, from + values.length));
							version++;
						},
						loading.signal
					);
				} catch {
					// A Segment whose audio can't be read keeps an empty lane.
				}
				if (loading.signal.aborted) return;
			}
		}
	}

	function toggle() {
		if (playing) playback?.pause();
		else void playback?.play();
	}

	/** Moves the playhead to where the pointer is on the ruler or a lane; dragging scrubs. */
	function seekTo(event: PointerEvent) {
		if (event.type === 'pointermove' && !(event.buttons & 1)) return;
		const target = event.currentTarget as HTMLElement;
		if (event.type === 'pointerdown') target.setPointerCapture?.(event.pointerId);
		const rect = target.getBoundingClientRect();
		const at = Math.min(Math.max(0, (event.clientX - rect.left) / rect.width), 1);
		void playback?.seek(Math.round(at * durationUs));
	}
</script>

<div class="editor" data-testid="editor" data-project-id={project.id}>
	<div
		class="stage"
		style:aspect-ratio={video ? `${video.width} / ${video.height}` : undefined}
		data-testid="stage"
		data-showing={showing}
	>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={media} data-testid="editor-video" playsinline hidden={!video || showing !== 'segment'}></video>
		{#if !video}
			<p class="audio-only" data-testid="audio-only">Audio only</p>
		{/if}
	</div>

	<div class="toolbar">
		<Button variant="primary" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</Button>
		<span class="timecode" data-testid="timecode">{formatTimecode(timeUs)} <span class="total">/ {formatTimecode(durationUs)}</span></span>
	</div>

	<div class="timeline" data-testid="timeline">
		<div class="header-cell"></div>
		<div
			class="ruler"
			bind:clientWidth={rulerWidth}
			data-testid="ruler"
			role="slider"
			tabindex="-1"
			aria-label="Playhead"
			aria-valuemin={0}
			aria-valuemax={Math.round(durationUs / 1e6)}
			aria-valuenow={Math.round(timeUs / 1e6)}
			onpointerdown={seekTo}
			onpointermove={seekTo}
		>
			{#each marks as mark (mark)}
				<span class="mark figures" style:left="{fraction(mark) * 100}%">{formatDuration(mark)}</span>
			{/each}
		</div>
		<div class="header-cell"></div>
		<div class="chips" data-testid="chips"></div>
		{#each tracks as track, t (track.recording.id)}
			<div class="lane-header" data-testid="lane-header">
				<span class="swatch" style:background={track.color}></span>
				<span class="who">
					<span class="name">{track.name}</span>
					<span class="role">{track.role}</span>
				</span>
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="lane" data-testid="lane" data-recording-id={track.recording.id} onpointerdown={seekTo} onpointermove={seekTo}>
				<LaneWaveform segments={track.segments} {durationUs} peaks={peaks[t]!} known={known[t]!} {version} color={track.color} />
			</div>
		{/each}
		<div class="playhead" data-testid="playhead" style:--at={fraction(timeUs)}></div>
	</div>
</div>

<style>
	.editor {
		--header: 200px;
		display: grid;
		gap: 16px;
		max-width: 1200px;
		margin: -8px auto 0;
	}
	.stage {
		position: relative;
		justify-self: center;
		width: min(100%, 720px, calc(40vh * 16 / 9));
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: var(--radius-video);
		background: #000;
	}
	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.audio-only {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--soft);
		color: var(--muted);
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
	}
	.timecode {
		font-family: var(--font-mono);
		font-size: 15px;
		font-variant-numeric: tabular-nums;
	}
	.total {
		color: var(--muted);
	}
	.timeline {
		position: relative;
		display: grid;
		grid-template-columns: var(--header) minmax(0, 1fr);
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
		overflow: hidden;
		user-select: none;
	}
	.header-cell,
	.lane-header {
		background: var(--soft);
		border-right: 1px solid var(--line);
	}
	.ruler {
		position: relative;
		height: 24px;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
		touch-action: none;
	}
	.mark {
		position: absolute;
		top: 0;
		bottom: 0;
		padding: 5px 0 0 4px;
		border-left: 1px solid var(--line);
		color: var(--muted);
		font-size: var(--text-tiny);
		white-space: nowrap;
	}
	.chips {
		height: 24px;
		border-bottom: 1px solid var(--line);
	}
	.lane-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 14px;
		border-bottom: 1px solid var(--line);
	}
	.swatch {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-round);
	}
	.who {
		display: grid;
		min-width: 0;
	}
	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.role {
		color: var(--muted);
		font-size: var(--text-small);
	}
	.lane {
		position: relative;
		height: 72px;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
		touch-action: none;
	}
	/* The last lane and its header: the timeline's border closes them. */
	.timeline > :nth-last-child(2),
	.timeline > :nth-last-child(3) {
		border-bottom: 0;
	}
	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(var(--header) + (100% - var(--header)) * var(--at));
		width: 2px;
		margin-left: -1px;
		background: var(--ink);
		pointer-events: none;
	}
	@media (max-width: 640px) {
		.editor {
			--header: 96px;
		}
		.lane-header {
			padding: 0 10px;
		}
	}
</style>
