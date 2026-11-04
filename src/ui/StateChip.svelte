<script lang="ts">
	import type { RecordingState } from '../lib/storage/session-file';
	import Badge, { type Tone } from './Badge.svelte';

	/** A Recording state, with Finalizing's progress (0–1) when known. */
	let { state, progress }: { state: RecordingState; progress?: number } = $props();

	const labels: Record<RecordingState, string> = {
		capturing: 'Capturing',
		paused: 'Paused',
		finalizing: 'Finalizing',
		ready: 'Ready',
		interrupted: 'Interrupted'
	};

	const tones: Record<RecordingState, Tone> = {
		capturing: 'problem',
		paused: 'neutral',
		finalizing: 'working',
		ready: 'ready',
		interrupted: 'problem'
	};
</script>

<Badge tone={tones[state]}>
	{#if state === 'capturing'}<span class="live"></span>{/if}
	{labels[state]}{#if state === 'finalizing' && progress !== undefined}&nbsp;{Math.round(progress * 100)}%{/if}
</Badge>

<style>
	.live {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--record);
	}
</style>
