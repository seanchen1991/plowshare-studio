<script lang="ts">
	import type { SupportedBrowser } from '../lib/browser/support';
	import { persistenceFixSteps, type Persistence } from '../lib/storage/persistence';
	import type { Session } from '../lib/storage/session-file';
	import { showOf, type Show } from '../lib/storage/show-file';
	import { createShow, deleteShow, renameShow } from '../lib/storage/shows';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Menu from './Menu.svelte';
	import PillSelect from './PillSelect.svelte';
	import ShowNameDialog from './ShowNameDialog.svelte';
	import TakeRow from './TakeRow.svelte';

	let {
		sessions,
		progress,
		onRecover,
		onRetry,
		onChanged,
		persistence,
		browser,
		shows,
		onShowsChanged
	}: {
		sessions: Session[];
		progress: Record<string, number>;
		persistence: Persistence;
		browser: SupportedBrowser;
		onRecover: (session: Session) => void;
		onRetry: (session: Session) => void;
		onChanged: () => void;
		shows: Show[];
		/** A Show was created, renamed or deleted. */
		onShowsChanged: () => Promise<void>;
	} = $props();

	const allTakes = 'all';
	// Which takes are listed: all, those in no Show (''), or one Show's.
	let filter = $state(allTakes);
	const filterShow = $derived(showOf(filter, shows));
	// A Show deleted while it was the filter falls back to all takes.
	const shownFilter = $derived(filter === allTakes || filter === '' || filterShow ? filter : allTakes);
	const listed = $derived(
		shownFilter === allTakes ? sessions : sessions.filter((s) => (showOf(s.showId, shows)?.id ?? '') === shownFilter)
	);
	const inFilterShow = $derived(filterShow ? sessions.filter((s) => s.showId === filterShow.id).length : 0);

	let showNameDialog!: ShowNameDialog;
	let confirmDeleteShow!: Dialog;
	// Remounts the filter, so it goes back to the current choice when New show is cancelled.
	let filterKey = $state(0);

	function newShow() {
		showNameDialog.open({
			onsave: async (name) => {
				const show = await createShow(name);
				await onShowsChanged();
				filter = show.id;
			},
			oncancel: () => filterKey++
		});
	}

	function rename(show: Show) {
		showNameDialog.open({
			show,
			onsave: async (name) => {
				await renameShow(show.id, name);
				await onShowsChanged();
			}
		});
	}

	async function removeShow(event: SubmitEvent) {
		if ((event.submitter as HTMLButtonElement | null)?.value !== 'delete' || !filterShow) return;
		await deleteShow(filterShow.id);
		filter = allTakes;
		await onShowsChanged();
		onChanged();
	}

	const emptyMessage = $derived(
		shownFilter === allTakes ? 'No takes yet. Takes you record show up here.' : shownFilter === '' ? 'Every take is in a show.' : 'No takes in this show yet.'
	);
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
	<div class="toolbar">
		{#key filterKey}
			<PillSelect
				label="Show"
				icon="show"
				options={[
					{ value: allTakes, label: 'All takes' },
					...shows.map((s) => ({ value: s.id, label: s.name })),
					...(shows.length ? [{ value: '', label: 'No show' }] : []),
					{ value: 'new', label: 'New show…' }
				]}
				value={shownFilter}
				onchange={(value) => (value === 'new' ? newShow() : (filter = value))}
			/>
		{/key}
		{#if filterShow}
			<Menu
				label="Show actions"
				items={[
					{ label: 'Rename show…', onselect: () => rename(filterShow) },
					{ label: 'Delete show…', onselect: () => confirmDeleteShow.open(), danger: true }
				]}>⋯</Menu
			>
		{/if}
	</div>
	{#if listed.length === 0}
		<p class="empty">{emptyMessage}</p>
	{:else}
		<ul>
			{#each listed as session (session.id)}
				<TakeRow {session} progress={progress[session.id]} onRecover={() => onRecover(session)} onRetry={() => onRetry(session)} {onChanged} {persistence} {shows} />
			{/each}
		</ul>
	{/if}
	<ShowNameDialog bind:this={showNameDialog} {shows} />
	<Dialog bind:this={confirmDeleteShow} title="Delete “{filterShow?.name}”?" onsubmit={removeShow}>
		<p>
			{#if inFilterShow === 0}
				It has no takes.
			{:else}
				{inFilterShow === 1 ? 'Its take is' : `Its ${inFilterShow} takes are`} kept, in no show.
			{/if}
		</p>
		{#snippet actions()}
			<Button type="submit" value="cancel" autofocus>Cancel</Button>
			<Button type="submit" value="delete" variant="danger">Delete show</Button>
		{/snippet}
	</Dialog>
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
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
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
