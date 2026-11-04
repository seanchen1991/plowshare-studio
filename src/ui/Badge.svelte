<script lang="ts" module>
	export type Tone = 'neutral' | 'ready' | 'working' | 'problem';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let { tone = 'neutral', children }: { tone?: Tone; children: Snippet } = $props();
</script>

<span class="badge {tone}">{@render children()}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 20px;
		padding: 0 8px;
		border-radius: var(--radius-round);
		font-size: var(--text-tiny);
		font-weight: 600;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.neutral {
		background: var(--soft);
		color: var(--muted);
	}
	.ready {
		background: var(--ready-bg);
		color: var(--ready-fg);
	}
	.working {
		background: var(--working-bg);
		color: var(--working-fg);
	}
	.problem {
		background: var(--problem-bg);
		color: var(--problem-fg);
	}
</style>
