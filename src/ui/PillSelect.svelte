<script lang="ts">
	/** A picker drawn as a pill: an icon, the chosen name and a chevron over a native select. */
	let {
		label,
		icon,
		options,
		value,
		disabled = false,
		onchange
	}: {
		label: string;
		icon: 'camera' | 'mic' | 'show';
		options: { value: string; label: string }[];
		value: string | undefined;
		disabled?: boolean;
		onchange: (value: string) => void;
	} = $props();

	const current = $derived(options.find((o) => o.value === value)?.label ?? (options.length ? '' : 'None found'));
</script>

<label class="pill" class:disabled>
	{#if icon === 'camera'}
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><rect x="1.5" y="4" width="9" height="8" rx="1.5" /><path d="M10.5 7l4-2.5v7l-4-2.5z" /></svg
		>
	{:else if icon === 'mic'}
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0010 0M8 12.5v2" /></svg
		>
	{:else}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5a1 1 0 011-1h3.5l1.5 1.5h6a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z" /></svg>
	{/if}
	<span class="name">{current}</span>
	<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5l3.5 3.5 3.5-3.5" /></svg>
	<select aria-label={label} {disabled} {value} onchange={(e) => onchange(e.currentTarget.value)}>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
</label>

<style>
	.pill {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		max-width: 280px;
		padding: 0 10px 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-round);
		background: var(--canvas);
		font-size: var(--text-small);
		cursor: pointer;
	}
	.pill:hover:not(.disabled) {
		background: var(--soft);
	}
	.pill:focus-within {
		outline: 2px solid var(--track-3);
		outline-offset: 2px;
	}
	.disabled {
		opacity: 0.55;
		cursor: default;
	}
	svg {
		flex: none;
		width: 15px;
		height: 15px;
		fill: none;
		stroke: var(--muted);
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The native select covers the pill, so clicks and keys open the browser's own list. */
	select {
		position: absolute;
		inset: 0;
		width: 100%;
		opacity: 0;
		cursor: inherit;
	}
</style>
