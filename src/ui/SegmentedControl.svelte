<script lang="ts" generics="T extends string">
	/** Switches between views, as tabs: arrow keys move between the enabled options. */
	let {
		options,
		value = $bindable(),
		label
	}: { options: { value: T; label: string; disabled?: boolean }[]; value: T; label: string } = $props();

	let buttons: HTMLButtonElement[] = $state([]);

	function onkeydown(event: KeyboardEvent) {
		const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const enabled = options.filter((o) => !o.disabled);
		const next = enabled[(enabled.findIndex((o) => o.value === value) + step + enabled.length) % enabled.length]!;
		value = next.value;
		buttons[options.indexOf(next)]?.focus();
	}
</script>

<div class="segmented" role="tablist" aria-label={label} tabindex="-1" {onkeydown}>
	{#each options as option, i (option.value)}
		<button
			bind:this={buttons[i]}
			type="button"
			role="tab"
			aria-selected={option.value === value}
			tabindex={option.value === value ? 0 : -1}
			disabled={option.disabled}
			onclick={() => (value = option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border-radius: var(--radius-panel);
		background: var(--soft);
	}
	button {
		height: 26px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--radius-button);
		background: transparent;
		color: var(--muted);
		font-size: var(--text-small);
		font-weight: 500;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		color: var(--ink);
	}
	[aria-selected='true'] {
		background: var(--canvas);
		color: var(--ink);
		box-shadow: 0 1px 2px rgb(29 27 34 / 0.08);
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
