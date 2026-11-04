<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A rounded label for a device or setting; `dot` shows a colored dot before it. */
	let { dot, children }: { dot?: string; children: Snippet } = $props();
</script>

<span class="pill">
	{#if dot}<span class="dot" style:background={dot}></span>{/if}
	{@render children()}
</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-round);
		background: var(--canvas);
		font-size: var(--text-small);
		white-space: nowrap;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
</style>
