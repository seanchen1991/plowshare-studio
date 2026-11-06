<script lang="ts">
	import type { Session } from '../lib/storage/session-file';
	import TakeRow from './TakeRow.svelte';

	let {
		sessions,
		progress,
		onRecover,
		onRetry,
		onChanged
	}: {
		sessions: Session[];
		progress: Record<string, number>;
		onRecover: (session: Session) => void;
		onRetry: (session: Session) => void;
		onChanged: () => void;
	} = $props();
</script>

<div class="takes">
	<h2>Takes</h2>
	{#if sessions.length === 0}
		<p class="empty">No takes yet. Takes you record show up here.</p>
	{:else}
		<ul>
			{#each sessions as session (session.id)}
				<TakeRow {session} progress={progress[session.id]} onRecover={() => onRecover(session)} onRetry={() => onRetry(session)} {onChanged} />
			{/each}
		</ul>
	{/if}
</div>

<style>
	.takes {
		display: grid;
		gap: 16px;
		max-width: 960px;
		margin: 0 auto;
	}
	h2 {
		font-size: 18px;
		font-weight: 600;
	}
	.empty {
		padding: 48px 16px;
		border: 1px dashed var(--line);
		border-radius: var(--radius-panel);
		color: var(--muted);
		text-align: center;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
	}
	ul > :global(li + li) {
		border-top: 1px solid var(--line);
	}
</style>
