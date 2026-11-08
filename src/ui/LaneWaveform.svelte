<script lang="ts" module>
	/** Bars are this far apart, in CSS pixels. */
	export const barStep = 3;
</script>

<script lang="ts">
	/**
	 * A Track's waveform for the part of the Session timeline on screen: mirrored,
	 * thin rounded bars in the Track's colour, each Segment at its start, Capture
	 * gaps empty. Drawn on a canvas the width of the view, which stays put while
	 * the lane under it scrolls, since an hour of bars is too many elements. Bins
	 * not computed yet are left blank, so the waveform fills in as peaks arrive.
	 */
	import { barHeight, loudestIn, peaksPerSecond } from '../lib/analysis/peaks';
	import type { PlacedSegment } from '../lib/edit/timeline';

	let {
		segments,
		viewStartUs,
		viewUs,
		peaks,
		known,
		version,
		color
	}: {
		segments: PlacedSegment[];
		/** Where the view starts on the timeline, and how much of it shows. */
		viewStartUs: number;
		viewUs: number;
		/** Each Segment's peaks, by Segment index. */
		peaks: Map<number, Uint8Array>;
		/** How many of each Segment's bins are known so far. */
		known: Map<number, number>;
		/** Changes whenever more peaks arrive. */
		version: number;
		/** A CSS colour, which may be a custom property. */
		color: string;
	} = $props();

	const barWidth = 2;

	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let height = $state(0);
	let frame = 0;

	$effect(() => {
		void [segments, viewStartUs, viewUs, version, color, width, height];
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});

	function draw() {
		if (!canvas || width === 0 || height === 0 || viewUs <= 0) return;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		const context = canvas.getContext('2d')!;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		// The canvas's own `color` resolves a custom property to a colour the canvas can use.
		context.fillStyle = getComputedStyle(canvas).color;

		const middle = height / 2;
		const usPerPx = viewUs / width;
		// Pixels from the timeline's start, where the view begins.
		const viewPx = viewStartUs / usPerPx;
		context.beginPath();
		for (const segment of segments) {
			const bins = peaks.get(segment.index);
			const ready = known.get(segment.index) ?? 0;
			if (!bins || ready === 0) continue;
			const startPx = Math.max(segment.startUs / usPerPx, viewPx - barStep);
			const endPx = Math.min((segment.startUs + segment.durationUs) / usPerPx, viewPx + width);
			// Bars sit on one grid along the timeline, whatever Segment they're in and however it's scrolled.
			for (let x = Math.ceil(startPx / barStep) * barStep; x < endPx; x += barStep) {
				const from = ((x * usPerPx - segment.startUs) / 1e6) * peaksPerSecond;
				const to = (((x + barStep) * usPerPx - segment.startUs) / 1e6) * peaksPerSecond;
				if (from >= ready) break;
				const half = Math.max(1, barHeight(loudestIn(bins, from, Math.min(to, ready))) * (middle - 1));
				context.roundRect(x - viewPx, middle - half, barWidth, half * 2, barWidth / 2);
			}
		}
		context.fill();
	}
</script>

<div class="lane-waveform" bind:clientWidth={width} bind:clientHeight={height}>
	<canvas bind:this={canvas} style:color={color} style:width="{width}px" style:height="{height}px"></canvas>
</div>

<style>
	.lane-waveform {
		position: sticky;
		left: 0;
		width: var(--view-width, 100%);
		height: 100%;
		overflow: hidden;
	}
	canvas {
		display: block;
	}
</style>
