<script lang="ts">
	/**
	 * A mirrored waveform of thin rounded bars, one per peak (0–1). Used live on
	 * the Record screen and as a thumbnail in Takes.
	 */
	let {
		peaks,
		color = 'var(--track-1)',
		height = 48,
		label
	}: { peaks: number[]; color?: string; height?: number; label?: string } = $props();
</script>

<div
	class="waveform"
	style:height="{height}px"
	style:--bar={color}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : true}
>
	{#each peaks as peak, i (i)}
		<span style:height="{Math.max(peak, 0.04) * 100}%"></span>
	{/each}
</div>

<style>
	.waveform {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}
	span {
		flex: 1 1 0;
		min-width: 1px;
		max-width: 3px;
		border-radius: var(--radius-round);
		background: var(--bar);
	}
</style>
