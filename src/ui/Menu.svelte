<script lang="ts" module>
	export interface MenuItem {
		label: string;
		onselect: () => void;
		danger?: boolean;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A button that opens a short list of actions below it. Esc or a click elsewhere closes it. */
	let { label, items, children }: { label: string; items: MenuItem[]; children: Snippet } = $props();

	let trigger: HTMLButtonElement;
	let panel: HTMLDivElement;
	const id = `menu-${Math.random().toString(36).slice(2)}`;

	// Sits under the button, right-aligned, placed before it shows so it never flashes elsewhere.
	function place(event: ToggleEvent) {
		if (event.newState !== 'open') return;
		const rect = trigger.getBoundingClientRect();
		panel.style.top = `${rect.bottom + 4}px`;
		panel.style.right = `${document.documentElement.clientWidth - rect.right}px`;
	}

	function focusFirst(event: ToggleEvent) {
		if (event.newState === 'open') panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
	}

	function select(item: MenuItem) {
		panel.hidePopover();
		item.onselect();
	}
</script>

<button bind:this={trigger} type="button" class="trigger" popovertarget={id} aria-label={label} title={label}>
	{@render children()}
</button>
<div bind:this={panel} {id} popover="auto" class="panel" onbeforetoggle={place} ontoggle={focusFirst}>
	{#each items as item (item.label)}
		<button type="button" class:danger={item.danger} disabled={item.disabled} onclick={() => select(item)}>{item.label}</button>
	{/each}
</div>

<style>
	.trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 30px;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--radius-button);
		background: var(--canvas);
		font-size: var(--text-small);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}
	.trigger:hover {
		background: var(--soft);
	}
	.panel {
		position: fixed;
		inset: auto;
		margin: 0;
		display: none;
		min-width: 160px;
		padding: 4px;
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
		background: var(--canvas);
		color: var(--ink);
		box-shadow: 0 6px 24px rgb(29 27 34 / 0.12);
	}
	.panel:popover-open {
		display: grid;
	}
	.panel button {
		padding: 7px 10px;
		border: 0;
		border-radius: var(--radius-button);
		background: none;
		font-size: var(--text-small);
		text-align: left;
		cursor: pointer;
	}
	.panel button:hover:not(:disabled),
	.panel button:focus-visible {
		background: var(--soft);
	}
	.panel button:disabled {
		color: var(--muted);
		cursor: default;
	}
	.danger {
		color: var(--problem-fg);
	}
</style>
