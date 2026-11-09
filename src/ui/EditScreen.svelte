<script lang="ts">
	/**
	 * The editor: the video above the timeline, a toolbar, and the timeline with
	 * a ruler, a chip row and one lane per Track. Plays the first Track; every
	 * Track gets a lane, for a host plus up to 3 guests. Zoomed in, the ruler,
	 * chips and lanes scroll sideways together under the fixed lane headers.
	 *
	 * Dragging across the ruler or a lane selects a range to Cut; clicking moves
	 * the playhead, or restores a Cut when it's on one in a lane. Every change to
	 * the cut list can be undone, and is saved to the Project file straight away.
	 *
	 * The timeline shows the Session as recorded, Cuts included; playing plays the
	 * edit, skipping them. The playhead is drawn at its place in the Session.
	 */
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { peakCount, peaksPerSecond } from '../lib/analysis/peaks';
	import { loadPeaks } from '../lib/analysis/waveform';
	import { addCut, canRedo, canUndo, cutAt, newHistory, record, redo, restoreCut, undo, type Range } from '../lib/edit/cuts';
	import { editToSession, planDurationUs, planEdit, sessionToEdit } from '../lib/edit/plan';
	import {
		followPlayhead,
		maxZoom,
		placedSegments,
		revealPlayhead,
		rulerMarks,
		sessionDurationUs,
		zoomStep,
		type PlacedSegment
	} from '../lib/edit/timeline';
	import type { Cut, Project } from '../lib/storage/project-file';
	import { saveProject } from '../lib/storage/projects';
	import type { Recording, Session } from '../lib/storage/session-file';
	import Button from './Button.svelte';
	import LaneWaveform, { barStep } from './LaneWaveform.svelte';
	import { formatDuration, formatTimecode } from './format';
	import { EditPlayer, type Showing } from './edit-player';

	let {
		project,
		session,
		onProjectChange
	}: { project: Project; session: Session; onProjectChange: (project: Project) => void } = $props();

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

	let screen = $state<HTMLCanvasElement>();
	let player: EditPlayer | undefined;
	/** The playhead in edit time, with the Cuts taken out. */
	let editUs = $state(0);
	let playing = $state(false);
	let showing = $state<Showing>('gap');
	let rate = $state(1);

	// The cut list's history; its present is the Session's Cuts as they are now.
	let history = $state.raw(newHistory<Cut[]>(untrack(() => project.sessions.find((s) => s.sessionId === opened.id)?.cuts ?? [])));
	const cuts = $derived(history.present);
	const acceptedCuts = $derived(cuts.filter((c) => c.accepted));
	let selection = $state<Range | null>(null);
	/** Where Split started a Cut, until it's pressed again. */
	let splitFromUs = $state<number | null>(null);
	let saveFailed = $state(false);

	// What plays: the Kept ranges, in order. The playhead's place in the Session follows from it.
	const pieces = $derived(planEdit([{ segments: lead.segments, durationUs, cuts }]));
	const editLengthUs = $derived(planDurationUs(pieces));
	const timeUs = $derived(editToSession(pieces, editUs).sessionUs);
	$effect(() => {
		const next = pieces;
		untrack(() => player?.setPieces(next));
	});

	/** Skip back and forward this far. */
	const skipUs = 5_000_000;
	/** Speed steps through these, then back to the first. */
	const speeds = [1, 1.5, 2];

	// Peaks per Track, by Segment index; `version` changes as they arrive.
	const peaks = tracks.map(() => new Map<number, Uint8Array>());
	const known = tracks.map(() => new Map<number, number>());
	let version = $state(0);
	const loading = new AbortController();

	// Zoom is how many view widths the whole timeline spans: 1 fits it all.
	let scroller = $state<HTMLElement>();
	let viewWidth = $state(0);
	let scrollPx = $state(0);
	let zoomWanted = $state(1);
	const zoomLimit = $derived(maxZoom(durationUs, viewWidth, barStep, peaksPerSecond));
	const zoom = $derived(Math.min(zoomWanted, zoomLimit));
	const contentWidth = $derived(viewWidth * zoom);
	const usPerPx = $derived(contentWidth > 0 ? durationUs / contentWidth : 0);
	const viewStartUs = $derived(scrollPx * usPerPx);
	const viewUs = $derived(durationUs / zoom);
	const marks = $derived(rulerMarks(viewStartUs, viewStartUs + viewUs, usPerPx > 0 ? 1e6 / usPerPx : 0));
	const fraction = (us: number) => (durationUs > 0 ? us / durationUs : 0);

	onMount(() => {
		player = new EditPlayer(screen!, pieces, () => {
			const before = timeUs;
			editUs = player!.timeUs;
			playing = player!.playing;
			showing = player!.showing;
			rate = player!.rate;
			if (playing && usPerPx > 0) {
				const to = followPlayhead(before / usPerPx, timeUs / usPerPx, scrollPx, viewWidth);
				if (to !== null) scrollTo(to);
			}
		});
		void player.seek(0);
		void loadAllPeaks();
		// Pinching a trackpad arrives as a wheel event with Ctrl held; it needs to be cancelable.
		scroller!.addEventListener('wheel', onwheel, { passive: false });
	});

	onDestroy(() => {
		loading.abort();
		player?.destroy();
		scroller?.removeEventListener('wheel', onwheel);
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
		if (playing) player?.pause();
		else void player?.play();
	}

	function skip(direction: 1 | -1) {
		// In edit time: 5 s of what you hear.
		const to = Math.min(Math.max(0, editUs + direction * skipUs), editLengthUs);
		reveal(editToSession(pieces, to).sessionUs);
		void player?.seek(to);
	}

	function nextSpeed() {
		player?.setRate(speeds[(speeds.indexOf(rate) + 1) % speeds.length]!);
	}

	function scrollTo(px: number) {
		if (!scroller) return;
		scroller.scrollLeft = px;
		scrollPx = scroller.scrollLeft;
	}

	/** Scrolls a time that's out of view into the middle of it. */
	function reveal(us: number) {
		if (usPerPx <= 0) return;
		const to = revealPlayhead(us / usPerPx, scrollPx, viewWidth);
		if (to !== null) scrollTo(to);
	}

	/**
	 * Zooms, keeping one moment where it is on screen: the one under `anchorPx`
	 * (from the view's left edge), else the playhead if it's in view, else the middle.
	 */
	async function zoomTo(wanted: number, anchorPx?: number) {
		const next = Math.min(Math.max(1, wanted), zoomLimit);
		if (next === zoom || !scroller || usPerPx <= 0) return;
		const playheadPx = timeUs / usPerPx - scrollPx;
		const anchor = anchorPx ?? (playheadPx >= 0 && playheadPx <= viewWidth ? playheadPx : viewWidth / 2);
		const anchorUs = (scrollPx + anchor) * usPerPx;
		const nextWidth = viewWidth * next;
		zoomWanted = next;
		// Set straight away, so a zoom that follows before the page updates starts from here.
		scrollPx = Math.min(Math.max(0, (anchorUs / durationUs) * nextWidth - anchor), nextWidth - viewWidth);
		await tick();
		scroller.scrollLeft = scrollPx;
	}

	function onwheel(event: WheelEvent) {
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		void zoomTo(zoom * Math.exp(-event.deltaY / 100), event.clientX - scroller!.getBoundingClientRect().left);
	}

	/** Shortcuts, except while typing in a field. Space always plays and pauses, even with a button focused. */
	function typing(event: KeyboardEvent) {
		return (event.target as HTMLElement).closest('input, select, textarea, [contenteditable]') !== null;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || typing(event)) return;
		// ⌘Z and ⇧⌘Z, or Ctrl on other systems.
		if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redoChange();
			else undoChange();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		switch (event.key) {
			case 'Delete':
			case 'Backspace':
				if (!selection) return;
				cutSelection();
				break;
			case 'Escape':
				if (!selection && splitFromUs === null) return;
				selection = null;
				splitFromUs = null;
				break;
			case ' ':
				if (!event.repeat) toggle();
				break;
			case 'ArrowLeft':
			// The player can't play backward, so J skips back.
			case 'j':
			case 'J':
				skip(-1);
				break;
			case 'ArrowRight':
				skip(1);
				break;
			case 'k':
			case 'K':
				player?.pause();
				break;
			case 'l':
			case 'L':
				if (!playing) void player?.play();
				break;
			case '+':
			case '=':
				void zoomTo(zoom * zoomStep);
				break;
			case '-':
			case '_':
				void zoomTo(zoom / zoomStep);
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	/** A focused button acts on Space's keyup; Space belongs to playback here. */
	function onkeyup(event: KeyboardEvent) {
		if (event.key === ' ' && !typing(event)) event.preventDefault();
	}

	/** Changes the cut list: it can be undone, and is saved. */
	function commit(next: Cut[]) {
		history = record(history, next);
		save();
	}

	function save() {
		const next: Project = {
			...project,
			sessions: project.sessions.map((s) => (s.sessionId === opened.id ? { ...s, cuts: history.present } : s))
		};
		onProjectChange(next);
		saveProject(next).then(
			() => (saveFailed = false),
			() => (saveFailed = true)
		);
	}

	function undoChange() {
		if (!canUndo(history)) return;
		history = undo(history);
		selection = null;
		save();
	}

	function redoChange() {
		if (!canRedo(history)) return;
		history = redo(history);
		selection = null;
		save();
	}

	function cutSelection() {
		if (!selection) return;
		commit(addCut(cuts, { ...selection, reason: 'manual', accepted: true }, durationUs));
		selection = null;
	}

	/** Split starts a Cut at the playhead; pressed again, it ends the Cut there. */
	function split() {
		if (splitFromUs === null) {
			splitFromUs = timeUs;
			return;
		}
		commit(addCut(cuts, { startUs: splitFromUs, endUs: timeUs, reason: 'manual', accepted: true }, durationUs));
		splitFromUs = null;
	}

	// A press on the ruler or a lane: a click if it hardly moves, otherwise a drag that selects.
	let press: { atUs: number; x: number; dragging: boolean; target: HTMLElement; restores: boolean } | null = null;

	function timeAt(event: PointerEvent, target: HTMLElement): number {
		const rect = target.getBoundingClientRect();
		return Math.round(Math.min(Math.max(0, (event.clientX - rect.left) / rect.width), 1) * durationUs);
	}

	/** `restores`: a click on a Cut restores it (lanes) rather than moving the playhead there (ruler). */
	function pressed(restores: boolean) {
		return (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = event.currentTarget as HTMLElement;
			target.setPointerCapture?.(event.pointerId);
			press = { atUs: timeAt(event, target), x: event.clientX, dragging: false, target, restores };
		};
	}

	function moved(event: PointerEvent) {
		if (!press) return;
		if (!press.dragging && Math.abs(event.clientX - press.x) < 4) return;
		press.dragging = true;
		const atUs = timeAt(event, press.target);
		selection = { startUs: Math.min(press.atUs, atUs), endUs: Math.max(press.atUs, atUs) };
	}

	function released() {
		if (!press) return;
		const { atUs, dragging, restores } = press;
		press = null;
		if (dragging && selection) {
			seekSession(selection.startUs);
			return;
		}
		selection = null;
		const cut = restores ? cutAt(cuts, atUs) : null;
		if (cut) commit(restoreCut(cuts, cut));
		else seekSession(atUs);
	}

	/** Moves the playhead to a place in the Session; inside a Cut, it lands just after it. */
	function seekSession(us: number) {
		void player?.seek(sessionToEdit(pieces, 0, us));
	}
</script>

<div class="editor" data-testid="editor" data-project-id={project.id}>
	<div
		class="stage"
		style:aspect-ratio={video ? `${video.width} / ${video.height}` : undefined}
		data-testid="stage"
		data-showing={showing}
	>
		<canvas bind:this={screen} data-testid="editor-canvas" hidden={!video || showing !== 'segment'}></canvas>
		{#if !video}
			<p class="audio-only" data-testid="audio-only">Audio only</p>
		{/if}
	</div>

	<div class="toolbar">
		<div class="group">
			<Button onclick={() => skip(-1)} aria-label="Back 5 seconds">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 9.5a5 5 0 1 0 .9-4.6" /><path d="M3.5 1.8v3.4h3.4" /></svg>5
			</Button>
			<Button variant="primary" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</Button>
			<Button onclick={() => skip(1)} aria-label="Forward 5 seconds">
				5<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 9.5a5 5 0 1 1-.9-4.6" /><path d="M12.5 1.8v3.4H9.1" /></svg>
			</Button>
			<span class="timecode" data-testid="timecode">{formatTimecode(editUs)} <span class="total">/ {formatTimecode(editLengthUs)}</span></span>
			<span class="take-time" data-testid="take-time" title="Where the playhead is in the take, Cuts included">Take {formatTimecode(timeUs)}</span>
		</div>
		<div class="group">
			<Button onclick={split} aria-pressed={splitFromUs !== null} data-testid="split">{splitFromUs === null ? 'Split' : 'End cut'}</Button>
			<Button onclick={cutSelection} disabled={!selection}>Cut</Button>
			<span class="pair">
				<Button onclick={undoChange} disabled={!canUndo(history)} aria-label="Undo">
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5L2.5 6.5l3 3" /><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" /></svg>
				</Button>
				<Button onclick={redoChange} disabled={!canRedo(history)} aria-label="Redo">
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3" /><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" /></svg>
				</Button>
			</span>
			<Button onclick={nextSpeed} aria-label="Speed {rate}×" data-testid="speed"><span class="figures">{rate}×</span></Button>
			<span class="pair">
				<Button onclick={() => zoomTo(zoom / zoomStep)} disabled={zoom <= 1} aria-label="Zoom out">
					<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4l3.6 3.6M5 7h4" /></svg>
				</Button>
				<Button onclick={() => zoomTo(zoom * zoomStep)} disabled={zoom >= zoomLimit} aria-label="Zoom in">
					<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4l3.6 3.6M5 7h4M7 5v4" /></svg>
				</Button>
			</span>
		</div>
	</div>

	{#if saveFailed}
		<p class="save-failed" role="alert">Your latest change couldn't be saved. It will be saved with the next one, if there's room.</p>
	{/if}

	<div class="timeline" data-testid="timeline" data-zoom={zoom} style:--view-width="{viewWidth}px">
		<div class="headers">
			<div class="header-cell ruler-row"></div>
			<div class="header-cell chips-row"></div>
			{#each tracks as track (track.recording.id)}
				<div class="lane-header" data-testid="lane-header">
					<span class="swatch" style:background={track.color}></span>
					<span class="who">
						<span class="name">{track.name}</span>
						<span class="role">{track.role}</span>
					</span>
				</div>
			{/each}
		</div>
		<div
			class="scroller"
			bind:this={scroller}
			bind:clientWidth={viewWidth}
			onscroll={() => (scrollPx = scroller!.scrollLeft)}
			data-testid="scroller"
		>
			<div class="content" style:width={zoom > 1 ? `${contentWidth}px` : '100%'}>
				<div class="playhead" data-testid="playhead" style:--at={fraction(timeUs)}></div>
				{#each acceptedCuts as cut (cut.startUs)}
					<div
						class="band cut"
						data-testid="cut"
						data-start-us={cut.startUs}
						data-end-us={cut.endUs}
						style:--from={fraction(cut.startUs)}
						style:--to={fraction(cut.endUs)}
					></div>
				{/each}
				{#if selection}
					<div class="band selection" data-testid="selection" style:--from={fraction(selection.startUs)} style:--to={fraction(selection.endUs)}></div>
				{/if}
				{#if splitFromUs !== null}
					<div class="split-from" data-testid="split-from" style:--at={fraction(splitFromUs)}></div>
				{/if}
				<div
					class="ruler ruler-row"
					data-testid="ruler"
					role="slider"
					tabindex="-1"
					aria-label="Playhead"
					aria-valuemin={0}
					aria-valuemax={Math.round(durationUs / 1e6)}
					aria-valuenow={Math.round(timeUs / 1e6)}
					onpointerdown={pressed(false)}
					onpointermove={moved}
					onpointerup={released}
					onpointercancel={() => (press = null)}
				>
					{#each marks as mark (mark)}
						<span class="mark figures" style:left="{fraction(mark) * 100}%">{formatDuration(mark)}</span>
					{/each}
				</div>
				<div class="chips chips-row" data-testid="chips"></div>
				{#each tracks as track, t (track.recording.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="lane"
						data-testid="lane"
						data-recording-id={track.recording.id}
						onpointerdown={pressed(true)}
						onpointermove={moved}
						onpointerup={released}
						onpointercancel={() => (press = null)}
					>
						<LaneWaveform segments={track.segments} {viewStartUs} {viewUs} cuts={acceptedCuts} peaks={peaks[t]!} known={known[t]!} {version} color={track.color} />
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<svelte:window {onkeydown} {onkeyup} />

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
	canvas {
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
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
	}
	.group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.toolbar svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.pair {
		display: flex;
		gap: 4px;
	}
	.save-failed {
		margin: 0;
		color: var(--problem-fg);
		font-size: var(--text-small);
		text-align: center;
	}
	.timecode {
		margin-left: 8px;
		font-family: var(--font-mono);
		white-space: nowrap;
		font-size: 15px;
		font-variant-numeric: tabular-nums;
	}
	.total {
		color: var(--muted);
	}
	.take-time {
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.timeline {
		display: grid;
		grid-template-columns: var(--header) minmax(0, 1fr);
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
		overflow: hidden;
		user-select: none;
	}
	.headers {
		background: var(--soft);
		border-right: 1px solid var(--line);
	}
	.scroller {
		overflow-x: auto;
		overflow-y: hidden;
	}
	.content {
		position: relative;
	}
	.ruler-row,
	.chips-row {
		height: 24px;
		border-bottom: 1px solid var(--line);
	}
	.ruler {
		position: relative;
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
	.lane-header:last-child,
	.lane:last-child {
		border-bottom: 0;
	}
	/* Cuts and the selection run through every lane, below the ruler and chips. */
	.band {
		position: absolute;
		top: 48px;
		bottom: 0;
		left: calc(100% * var(--from));
		width: calc(100% * (var(--to) - var(--from)));
		pointer-events: none;
	}
	.cut {
		border-inline: 1px solid var(--cut-edge);
		background: var(--cut-bg);
	}
	.selection {
		border-inline: 1px solid var(--select-edge);
		background: var(--select-bg);
	}
	.split-from {
		position: absolute;
		top: 24px;
		bottom: 0;
		left: calc(100% * var(--at));
		border-left: 1px dashed var(--select-edge);
		pointer-events: none;
	}
	.playhead {
		position: absolute;
		z-index: 1;
		top: 0;
		bottom: 0;
		left: calc(100% * var(--at));
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
