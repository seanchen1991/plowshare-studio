<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		variant = 'default',
		children,
		...rest
	}: HTMLButtonAttributes & { variant?: 'default' | 'primary' | 'danger'; children: Snippet } = $props();
</script>

<button class={variant} type="button" {...rest}>{@render children()}</button>

<style>
	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-button);
		background: var(--canvas);
		font-size: var(--text-small);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}
	button:hover:not(:disabled) {
		background: var(--soft);
	}
	.primary {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--canvas);
	}
	.primary:hover:not(:disabled) {
		background: #35323c;
	}
	.danger {
		border-color: var(--record);
		background: var(--record);
		color: #fff;
	}
	.danger:hover:not(:disabled) {
		background: var(--record);
		filter: brightness(0.92);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
