<script lang="ts">
	/**
	 * The editor for one Project: its takes (Sessions) end to end on one
	 * timeline, the video above it, and a toolbar. The timeline has a row naming
	 * each take, a ruler, a chip row and one lane per Track. Zoomed in, the rows
	 * scroll sideways together under the fixed lane headers.
	 *
	 * Dragging across the ruler or a lane selects a range to Cut (split at take
	 * boundaries, since a Cut stays inside its Session); clicking moves the
	 * playhead, or restores a Cut when it's on one in a lane. Adding, removing,
	 * reordering takes and every Cut can be undone, and each change is saved to
	 * the Project file straight away.
	 *
	 * The timeline shows the takes as recorded, Cuts included; playing plays the
	 * edit, skipping them. The playhead is drawn at its place on the timeline.
	 */
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { peakCount, peaksPerSecond } from '../lib/analysis/peaks';
	import { loadPeaks } from '../lib/analysis/waveform';
	import { addCut, canRedo, canUndo, cutAt, newHistory, record, redo, restoreCut, undo, type Range } from '../lib/edit/cuts';
	import { layOut, layoutDurationUs, sessionAt, splitRange } from '../lib/edit/layout';
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
	import { addSessions, moveSession, removeSession, type Cut, type Project, type ProjectSession } from '../lib/storage/project-file';
	import { saveProject } from '../lib/storage/projects';
	import type { Session } from '../lib/storage/session-file';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import LaneWaveform, { barStep } from './LaneWaveform.svelte';
	import { formatDuration, formatTimecode } from './format';
	import { EditPlayer, type Showing } from './edit-player';
	import { ImportError } from '../lib/storage/import';
	import { importMessage, openableFiles } from './import-message';

	let {
		project,
		library,
		onProjectChange,
		onClose,
		onOpenFile
	}: {
		project: Project;
		/** Every Ready take, to find the Project's in and to add from. */
		library: Session[];
		onProjectChange: (project: Project) => void;
		/** Back to the list of Projects. */
		onClose: () => void;
		/** Open a file…: copies a recording from disk in as a new take. */
		onOpenFile: (file: File) => Promise<Session>;
	} = $props();

	interface Track {
		/** Every take's Segments for this Track, placed on the timeline. */
		segments: PlacedSegment[];
		color: string;
		name: string;
		role: string;
	}

	// The Project's takes and Cuts; undo steps back through them. Its present is the Project as it is now.
	let history = $state.raw(newHistory<ProjectSession[]>(untrack(() => project.sessions)));
	let title = $state(untrack(() => project.title));
	// The takes still in the library, in order; one deleted elsewhere drops out.
	const entries = $derived(
		history.present.flatMap((ps) => {
			const session = library.find((s) => s.id === ps.sessionId);
			return session ? [{ ps, session, durationUs: sessionDurationUs(session) }] : [];
		})
	);
	const layout = $derived(layOut(entries.map((e) => e.durationUs)));
	const durationUs = $derived(layoutDurationUs(layout));
	// One lane per Track position: the host first, then guests, across all takes.
	const tracks = $derived<Track[]>(
		Array.from({ length: Math.max(0, ...entries.map((e) => e.session.recordings.length)) }, (_, t) => {
			const first = entries.find((e) => e.session.recordings[t])?.session.recordings[t];
			const host = first?.participant.role === 'host';
			return {
				segments: entries.flatMap((e, i) =>
					placedSegments(e.session.recordings[t]?.segments ?? []).map((s) => ({ ...s, startUs: s.startUs + layout[i]!.offsetUs }))
				),
				color: `var(--track-${(t % 4) + 1})`,
				name: host ? 'You' : `Guest ${t}`,
				role: host ? 'Host' : 'Guest'
			};
		})
	);

	let screen = $state<HTMLCanvasElement>();
	let player: EditPlayer | undefined;
	/** The playhead in edit time, with the Cuts taken out. */
	let editUs = $state(0);
	let playing = $state(false);
	let showing = $state<Showing>('gap');
	let rate = $state(1);

	// Accepted Cuts on the timeline, each with the take it belongs to.
	const acceptedCuts = $derived(
		entries.flatMap((e, i) =>
			e.ps.cuts.filter((c) => c.accepted).map((cut) => ({ cut, sessionId: e.ps.sessionId, startUs: cut.startUs + layout[i]!.offsetUs, endUs: cut.endUs + layout[i]!.offsetUs }))
		)
	);
	let selection = $state<Range | null>(null);
	/** Where Split started a Cut, until it's pressed again. */
	let splitFromUs = $state<number | null>(null);
	let saveFailed = $state(false);

	// What plays: each take's Kept ranges, in order. The playhead's place on the timeline follows from it.
	const pieces = $derived(
		planEdit(entries.map((e) => ({ segments: placedSegments(e.session.recordings[0]?.segments ?? []), durationUs: e.durationUs, cuts: e.ps.cuts })))
	);
	const editLengthUs = $derived(planDurationUs(pieces));
	const place = $derived(editToSession(pieces, editUs));
	const timeUs = $derived((layout[place.session]?.offsetUs ?? 0) + place.sessionUs);
	const current = $derived(entries[place.session]);
	// The take the playhead is in and the moment in it, kept by id so it survives reordering.
	let lastPlace = { sessionId: '', sessionUs: 0 };
	$effect(() => {
		const next = pieces;
		untrack(() => {
			const index = entries.findIndex((e) => e.ps.sessionId === lastPlace.sessionId);
			player?.setPieces(next, index >= 0 ? sessionToEdit(next, index, lastPlace.sessionUs) : 0);
		});
	});

	// The picture's shape, and whether the take at the playhead has one.
	const firstVideo = $derived(entries.find((e) => e.session.recordings[0]?.video)?.session.recordings[0]?.video ?? null);
	const video = $derived(current ? current.session.recordings[0]?.video ?? null : firstVideo);

	/** Skip back and forward this far. */
	const skipUs = 5_000_000;
	/** Speed steps through these, then back to the first. */
	const speeds = [1, 1.5, 2];

	// Peaks by Segment file; `version` changes as they arrive.
	const peaks = new Map<string, Uint8Array>();
	const known = new Map<string, number>();
	let version = $state(0);
	const loading = new AbortController();
	let peaksLoading = false;
	$effect(() => {
		void tracks;
		untrack(() => void loadMissingPeaks());
	});

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
			const at = editToSession(pieces, editUs);
			lastPlace = { sessionId: entries[at.session]?.ps.sessionId ?? '', sessionUs: at.sessionUs };
			if (playing && usPerPx > 0) {
				const to = followPlayhead(before / usPerPx, timeUs / usPerPx, scrollPx, viewWidth);
				if (to !== null) scrollTo(to);
			}
		});
		void player.seek(0);
		// Pinching a trackpad arrives as a wheel event with Ctrl held; it needs to be cancelable.
		scroller!.addEventListener('wheel', onwheel, { passive: false });
	});

	onDestroy(() => {
		loading.abort();
		player?.destroy();
		scroller?.removeEventListener('wheel', onwheel);
	});

	/** Every Segment's peaks not asked for yet, one at a time, so long takes don't decode in parallel. */
	async function loadMissingPeaks() {
		if (peaksLoading) return;
		peaksLoading = true;
		for (;;) {
			const segment = tracks.flatMap((t) => t.segments).find((s) => !peaks.has(s.path));
			if (!segment || loading.signal.aborted) break;
			const bins = new Uint8Array(peakCount(segment.durationUs));
			peaks.set(segment.path, bins);
			try {
				await loadPeaks(
					segment,
					(from, values) => {
						bins.set(values.subarray(0, bins.length - from), from);
						known.set(segment.path, Math.max(known.get(segment.path) ?? 0, from + values.length));
						version++;
					},
					loading.signal
				);
			} catch {
				// A Segment whose audio can't be read keeps an empty lane.
			}
		}
		peaksLoading = false;
	}

	function toggle() {
		if (playing) player?.pause();
		else void player?.play();
	}

	function skip(direction: 1 | -1) {
		// In edit time: 5 s of what you hear.
		const to = Math.min(Math.max(0, editUs + direction * skipUs), editLengthUs);
		const at = editToSession(pieces, to);
		reveal((layout[at.session]?.offsetUs ?? 0) + at.sessionUs);
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
		return (event.target as HTMLElement).closest('input, select, textarea, [contenteditable], dialog') !== null;
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

	/** Changes the Project's takes or Cuts: it can be undone, and is saved. */
	function commit(next: ProjectSession[]) {
		history = record(history, next);
		save();
	}

	function save() {
		const next: Project = { ...project, title, sessions: history.present };
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

	/** A new cut list for one take. */
	function withCuts(sessionId: string, change: (cuts: Cut[]) => Cut[]): ProjectSession[] {
		return history.present.map((ps) => (ps.sessionId === sessionId ? { ...ps, cuts: change(ps.cuts) } : ps));
	}

	/** Cuts a range of the timeline: one Cut in each take it covers. */
	function cutRange(range: Range) {
		let next = history.present;
		for (const part of splitRange(layout, range)) {
			const entry = entries[part.index]!;
			next = next.map((ps) =>
				ps.sessionId === entry.ps.sessionId
					? { ...ps, cuts: addCut(ps.cuts, { startUs: part.startUs, endUs: part.endUs, reason: 'manual', accepted: true }, entry.durationUs) }
					: ps
			);
		}
		if (next !== history.present) commit(next);
	}

	function cutSelection() {
		if (!selection) return;
		cutRange(selection);
		selection = null;
	}

	/** Split starts a Cut at the playhead; pressed again, it ends the Cut there. */
	function split() {
		if (splitFromUs === null) {
			splitFromUs = timeUs;
			return;
		}
		cutRange({ startUs: Math.min(splitFromUs, timeUs), endUs: Math.max(splitFromUs, timeUs) });
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
			seekTimeline(selection.startUs);
			return;
		}
		selection = null;
		const at = sessionAt(layout, atUs);
		const entry = entries[at.index];
		const cut = restores && entry ? cutAt(entry.ps.cuts, at.localUs) : null;
		if (cut && entry) commit(withCuts(entry.ps.sessionId, (cuts) => restoreCut(cuts, cut)));
		else seekTimeline(atUs);
	}

	/** Moves the playhead to a place on the timeline; inside a Cut, it lands just after it. */
	function seekTimeline(us: number) {
		const at = sessionAt(layout, us);
		if (at.index >= 0) void player?.seek(sessionToEdit(pieces, at.index, at.localUs));
	}

	// The takes in the Project: add, remove and reorder.
	let picker: Dialog;
	let picked = $state<string[]>([]);
	const addable = $derived(library.filter((s) => !history.present.some((ps) => ps.sessionId === s.id)));
	let dragging = $state<number | null>(null);

	function openPicker() {
		picked = [];
		picker.open();
	}

	function addPicked(event: SubmitEvent) {
		if ((event.submitter as HTMLButtonElement | null)?.value !== 'add' || picked.length === 0) return;
		// In the order they're listed, not the order they were ticked.
		commit(addSessions(history.present, addable.filter((s) => picked.includes(s.id)).map((s) => s.id)));
	}

	// Open a file… from the picker: the new take is added to the Project straight away.
	let fileInput = $state<HTMLInputElement>();
	let opening = $state<string | null>(null);
	let openProblem = $state<string | null>(null);

	async function openChosen() {
		const file = fileInput?.files?.[0];
		if (!file || !fileInput) return;
		fileInput.value = '';
		picker.close();
		opening = file.name;
		openProblem = null;
		try {
			const session = await onOpenFile(file);
			commit(addSessions(history.present, [session.id]));
		} catch (error) {
			openProblem = error instanceof ImportError ? importMessage(error.problem, file.name) : `Couldn't open “${file.name}”: ${String(error)}.`;
		} finally {
			opening = null;
		}
	}

	function moveTake(sessionId: string, to: number) {
		commit(moveSession(history.present, history.present.findIndex((ps) => ps.sessionId === sessionId), to));
	}

	// Renaming the Project, in the header.
	let renaming = $state(false);
	let titleInput = $state<HTMLInputElement>();

	async function startRename() {
		renaming = true;
		await tick();
		titleInput?.select();
	}

	function finishRename(keep: boolean) {
		if (!renaming) return;
		renaming = false;
		const next = titleInput?.value.trim() ?? '';
		if (keep && next && next !== title) {
			title = next;
			save();
		}
	}
</script>

<div class="editor" data-testid="editor" data-project-id={project.id}>
	<header class="project-bar">
		<Button onclick={onClose} aria-label="All projects">
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>Projects
		</Button>
		{#if renaming}
			<input
				bind:this={titleInput}
				class="title-input"
				value={title}
				aria-label="Project name"
				maxlength="200"
				onkeydown={(e) => {
					if (e.key === 'Enter') finishRename(true);
					if (e.key === 'Escape') finishRename(false);
				}}
				onblur={() => finishRename(true)}
			/>
		{:else}
			<button class="project-title" type="button" onclick={startRename} title="Rename" data-testid="project-title">{title}</button>
		{/if}
	</header>

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
			<span class="take-time" data-testid="take-time" title="Where the playhead is in the take, Cuts included"
				>Take {entries.length > 1 ? `${place.session + 1} · ` : ''}{formatTimecode(place.sessionUs)}</span
			>
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

	<ol class="project-takes" data-testid="project-takes" aria-label="Takes in this project">
		{#each entries as entry, i (entry.ps.sessionId)}
			<li
				class="project-take"
				class:dragging={dragging === i}
				data-testid="project-take"
				data-session-id={entry.ps.sessionId}
				draggable="true"
				ondragstart={(e) => {
					dragging = i;
					e.dataTransfer?.setData('text/plain', entry.ps.sessionId);
				}}
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => {
					e.preventDefault();
					const from = dragging === null ? null : entries[dragging];
					if (from && from !== entry) moveTake(from.ps.sessionId, history.present.findIndex((ps) => ps.sessionId === entry.ps.sessionId));
					dragging = null;
				}}
				ondragend={() => (dragging = null)}
			>
				<span class="take-number figures">{i + 1}</span>
				<span class="take-name">{entry.session.title}</span>
				<span class="take-length figures">{formatDuration(entry.durationUs)}</span>
				<span class="take-actions">
					<button
						class="icon"
						type="button"
						aria-label="Move “{entry.session.title}” earlier"
						disabled={i === 0}
						onclick={() => moveTake(entry.ps.sessionId, history.present.findIndex((ps) => ps.sessionId === entries[i - 1]!.ps.sessionId))}
						><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg></button
					>
					<button
						class="icon"
						type="button"
						aria-label="Move “{entry.session.title}” later"
						disabled={i === entries.length - 1}
						onclick={() => moveTake(entry.ps.sessionId, history.present.findIndex((ps) => ps.sessionId === entries[i + 1]!.ps.sessionId))}
						><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg></button
					>
					<button
						class="icon"
						type="button"
						aria-label="Remove “{entry.session.title}” from this project"
						onclick={() => commit(removeSession(history.present, entry.ps.sessionId))}
						><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg></button
					>
				</span>
			</li>
		{/each}
		<li><Button onclick={openPicker}>Add takes</Button></li>
	</ol>
	{#if opening}
		<p class="opening" role="status">Copying “{opening}” into Plowshare Studio…</p>
	{/if}
	{#if openProblem}
		<p class="open-problem" role="alert" data-testid="open-problem">{openProblem}</p>
	{/if}
	{#if entries.length === 0}
		<p class="no-takes" data-testid="no-takes">This project has no takes. Add takes to start editing it.</p>
	{/if}

	{#if saveFailed}
		<p class="save-failed" role="alert">Your latest change couldn't be saved. It will be saved with the next one, if there's room.</p>
	{/if}

	<div class="timeline" data-testid="timeline" data-zoom={zoom} style:--view-width="{viewWidth}px">
		<div class="headers">
			<div class="header-cell takes-row"></div>
			<div class="header-cell ruler-row"></div>
			<div class="header-cell chips-row"></div>
			{#each tracks as track, t (t)}
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
				{#each layout.slice(1) as placed (placed.offsetUs)}
					<div class="boundary" data-testid="boundary" style:--at={fraction(placed.offsetUs)}></div>
				{/each}
				{#each acceptedCuts as cut (`${cut.sessionId}:${cut.startUs}`)}
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
				<div class="takes-row" data-testid="takes-row">
					{#each entries as entry, i (entry.ps.sessionId)}
						<span class="take-label" style:--from={fraction(layout[i]!.offsetUs)} style:--to={fraction(layout[i]!.offsetUs + layout[i]!.durationUs)}
							>{i + 1} · {entry.session.title}</span
						>
					{/each}
				</div>
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
				{#each tracks as track, t (t)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="lane"
						data-testid="lane"
						onpointerdown={pressed(true)}
						onpointermove={moved}
						onpointerup={released}
						onpointercancel={() => (press = null)}
					>
						<LaneWaveform segments={track.segments} {viewStartUs} {viewUs} cuts={acceptedCuts} {peaks} {known} {version} color={track.color} />
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<Dialog bind:this={picker} title="Add takes" onsubmit={addPicked}>
	{#if addable.length === 0}
		<p>Every Ready take is already in this project.</p>
	{:else}
		<ul class="pick" data-testid="take-picker">
			{#each addable as take (take.id)}
				<li>
					<label>
						<input type="checkbox" value={take.id} bind:group={picked} />
						<span class="take-name">{take.title}</span>
						<span class="take-length figures">{formatDuration(sessionDurationUs(take))}</span>
					</label>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="open-file">
		Or bring in a recording from this computer:
		<Button onclick={() => fileInput?.click()}>Open a file…</Button>
		<input bind:this={fileInput} type="file" accept={openableFiles} hidden onchange={openChosen} data-testid="open-file" />
	</p>
	{#snippet actions()}
		<Button type="submit" value="cancel">Cancel</Button>
		<Button type="submit" value="add" variant="primary" disabled={picked.length === 0}>Add</Button>
	{/snippet}
</Dialog>

<svelte:window {onkeydown} {onkeyup} />

<style>
	.editor {
		--header: 200px;
		display: grid;
		gap: 16px;
		max-width: 1200px;
		margin: -8px auto 0;
	}
	.project-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.project-title,
	.title-input {
		min-width: 0;
		padding: 2px 6px;
		border: 1px solid transparent;
		border-radius: var(--radius-button);
		background: none;
		font: inherit;
		font-size: 16px;
		font-weight: 600;
		color: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.project-title {
		cursor: text;
	}
	.project-title:hover {
		border-color: var(--line);
	}
	.title-input {
		flex: 1;
		max-width: 480px;
		border-color: var(--line);
	}
	.project-bar svg,
	.project-takes svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.project-takes {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.project-take {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		height: 32px;
		padding: 0 4px 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--radius-button);
		background: var(--soft);
		font-size: var(--text-small);
		cursor: grab;
	}
	.project-take.dragging {
		opacity: 0.5;
	}
	.take-number {
		color: var(--muted);
	}
	.take-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.take-length {
		color: var(--muted);
	}
	.take-actions {
		display: flex;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-button);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.icon:hover:not(:disabled) {
		background: var(--line);
		color: var(--ink);
	}
	.icon:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.opening {
		margin: 0;
		color: var(--muted);
		font-size: var(--text-small);
	}
	.open-problem {
		margin: 0;
		padding: 10px 14px;
		border-radius: var(--radius-panel);
		background: var(--problem-bg);
		color: var(--problem-fg);
		font-size: var(--text-small);
	}
	.open-file {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 4px 0 0;
		color: var(--muted);
		font-size: var(--text-small);
	}
	.no-takes {
		margin: 0;
		padding: 24px 16px;
		border: 1px dashed var(--line);
		border-radius: var(--radius-panel);
		color: var(--muted);
		text-align: center;
	}
	.pick {
		display: grid;
		gap: 2px;
		max-height: 50vh;
		margin: 0 0 8px;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.pick label {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
		border-radius: var(--radius-button);
		cursor: pointer;
	}
	.pick label:hover {
		background: var(--soft);
	}
	.pick .take-name {
		flex: 1;
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
	.takes-row,
	.ruler-row,
	.chips-row {
		height: 24px;
		border-bottom: 1px solid var(--line);
	}
	.takes-row {
		position: relative;
		overflow: hidden;
	}
	.take-label {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(100% * var(--from));
		width: calc(100% * (var(--to) - var(--from)));
		padding: 4px 8px 0;
		overflow: hidden;
		color: var(--muted);
		font-size: var(--text-tiny);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.boundary {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(100% * var(--at));
		width: 2px;
		margin-left: -1px;
		background: var(--cut-edge);
		pointer-events: none;
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
		top: 72px;
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
		top: 48px;
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
