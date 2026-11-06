<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A modal dialog with a title, a body and a row of actions. A submit button's `value`
	 * closes it; `onsubmit` can call `preventDefault()` to keep it open (to show a problem).
	 */
	let {
		title,
		children,
		actions,
		onsubmit,
		onclose
	}: {
		title: string;
		children: Snippet;
		actions: Snippet;
		onsubmit?: (event: SubmitEvent) => void;
		onclose?: () => void;
	} = $props();

	let dialog: HTMLDialogElement;
	const id = `dialog-${Math.random().toString(36).slice(2)}`;

	export function open() {
		dialog.showModal();
	}

	export function close() {
		dialog.close();
	}
</script>

<dialog bind:this={dialog} aria-labelledby={id} {onclose}>
	<form method="dialog" {onsubmit}>
		<h3 {id}>{title}</h3>
		{@render children()}
		<div class="actions">{@render actions()}</div>
	</form>
</dialog>

<style>
	dialog {
		width: min(100% - 32px, 400px);
		padding: 20px;
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
		color: var(--ink);
		box-shadow: 0 12px 40px rgb(29 27 34 / 0.18);
	}
	dialog::backdrop {
		background: rgb(29 27 34 / 0.3);
	}
	h3 {
		margin-bottom: 8px;
		font-size: 16px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	dialog :global(p) {
		color: var(--muted);
		font-size: var(--text-small);
	}
	dialog :global(strong) {
		color: var(--ink);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 20px;
	}
</style>
