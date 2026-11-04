<script lang="ts">
	import type { Snippet } from 'svelte';

	/** An on/off setting drawn as a pill with a small switch. */
	let {
		pressed,
		disabled = false,
		title,
		onchange,
		children
	}: { pressed: boolean; disabled?: boolean; title?: string; onchange: (pressed: boolean) => void; children: Snippet } =
		$props();
</script>

<button type="button" class="pill" aria-pressed={pressed} {disabled} {title} onclick={() => onchange(!pressed)}>
	<span class="switch"></span>
	{@render children()}
</button>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 12px 0 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius-round);
		background: var(--canvas);
		font-size: var(--text-small);
		cursor: pointer;
		white-space: nowrap;
	}
	.pill:hover:not(:disabled) {
		background: var(--soft);
	}
	.pill:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.switch {
		position: relative;
		width: 24px;
		height: 14px;
		border-radius: var(--radius-round);
		background: var(--line);
		transition: background 120ms;
	}
	.switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--canvas);
		box-shadow: 0 1px 1px rgb(29 27 34 / 0.2);
		transition: transform 120ms;
	}
	[aria-pressed='true'] .switch {
		background: var(--track-1);
	}
	[aria-pressed='true'] .switch::after {
		transform: translateX(10px);
	}
</style>
