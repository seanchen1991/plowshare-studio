<script lang="ts">
	import type { SupportedBrowser } from '../lib/browser/support';
	import { persistenceFixSteps, type Persistence } from '../lib/storage/persistence';
	import type { Session } from '../lib/storage/session-file';
	import TakeRow from './TakeRow.svelte';

	let {
		sessions,
		progress,
		onRecover,
		onRetry,
		onChanged,
		persistence,
		browser
	}: {
		sessions: Session[];
		progress: Record<string, number>;
		persistence: Persistence;
		browser: SupportedBrowser;
		onRecover: (session: Session) => void;
		onRetry: (session: Session) => void;
		onChanged: () => void;
	} = $props();
</script>

<div class="takes">
	<h2>Takes</h2>
	{#if persistence === 'refused'}
		<div class="persistence" role="status" data-testid="persistence-notice">
			<p>Your browser hasn't agreed to keep recordings permanently. Download takes you want to keep.</p>
			<details>
				<summary>How to fix this</summary>
				<ol>
					{#each persistenceFixSteps(browser) as step (step)}<li>{step}</li>{/each}
				</ol>
			</details>
		</div>
	{/if}
	{#if sessions.length === 0}
		<p class="empty">No takes yet. Takes you record show up here.</p>
	{:else}
		<ul>
			{#each sessions as session (session.id)}
				<TakeRow {session} progress={progress[session.id]} onRecover={() => onRecover(session)} onRetry={() => onRetry(session)} {onChanged} {persistence} />
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
	.persistence {
		display: grid;
		gap: 6px;
		padding: 10px 14px;
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
		background: var(--soft);
		font-size: var(--text-small);
	}
	summary {
		width: fit-content;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
	}
	.persistence ol {
		display: grid;
		gap: 4px;
		margin: 6px 0 0;
		padding-left: 20px;
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
