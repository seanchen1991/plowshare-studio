<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { saveFile } from '../lib/browser/download';
	import { isOutOfRoom } from '../lib/storage/budget';
	import { downloadName, extensionOf } from '../lib/storage/download-name';
	import { warnNotBackedUp, type Persistence } from '../lib/storage/persistence';
	import { deleteSession, finishedBytes, markDownloaded, renameSession } from '../lib/storage/library';
	import { readFile } from '../lib/storage/opfs';
	import {
		canDelete,
		recordingDurationUs,
		sessionBackedUp,
		sessionState,
		type Segment,
		type Session
	} from '../lib/storage/session-file';
	import Badge from './Badge.svelte';
	import Button from './Button.svelte';
	import Menu from './Menu.svelte';
	import StateChip from './StateChip.svelte';
	import { formatBytes, formatDuration } from './format';

	/**
	 * One Session in a list of takes; `progress` is Finalizing's, when running. `onChanged` runs after a rename,
	 * download or delete; `onRetry` runs Finalizing again after it failed.
	 */
	let {
		session,
		progress,
		onRecover,
		onRetry,
		onChanged,
		persistence
	}: {
		session: Session;
		progress?: number;
		onRecover?: () => void;
		onRetry?: () => void;
		onChanged: () => void;
		persistence: Persistence;
	} = $props();

	let playerUrl = $state<string | null>(null);
	let bytes = $state<number | null>(null);
	let renaming = $state(false);
	let titleInput = $state<HTMLInputElement>();
	let confirmDelete = $state<HTMLDialogElement>();
	let problem = $state<string | null>(null);

	const takeState = $derived(sessionState(session));
	const recording = $derived(session.recordings[0]);
	const segments = $derived(recording?.segments.filter((s) => s.path !== null) ?? []);
	const durationUs = $derived(recording ? recordingDurationUs(recording) : null);
	const failed = $derived(session.recordings.find((r) => r.finalizeError)?.finalizeError);
	const recovery = $derived(recording?.recovery);
	const backedUp = $derived(sessionBackedUp(session));
	const details = $derived(
		[
			new Date(session.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
			bytes !== null ? formatBytes(bytes) : null,
			recording?.video ? `${recording.video.width} × ${recording.video.height}` : recording ? 'Audio only' : null
		]
			.filter(Boolean)
			.join(' · ')
	);

	$effect(() => {
		if (takeState === 'ready') void finishedBytes(session).then((b) => (bytes = b));
	});

	async function play() {
		const path = segments[0]?.path;
		if (!path) return;
		if (playerUrl) URL.revokeObjectURL(playerUrl);
		playerUrl = URL.createObjectURL(await readFile(path));
	}

	async function download(segment: Segment) {
		if (!recording || !segment.path) return;
		const name = downloadName({
			title: session.title,
			createdAt: session.createdAt,
			extension: extensionOf(segment.path),
			part: segments.indexOf(segment) + 1,
			count: segments.length
		});
		saveFile(await readFile(segment.path), name);
		await markDownloaded(session.id, recording.id, segment.index);
		onChanged();
	}

	async function startRename() {
		renaming = true;
		await tick();
		titleInput?.select();
	}

	async function finishRename(save: boolean) {
		if (!renaming) return;
		renaming = false;
		if (save && titleInput && titleInput.value.trim() !== session.title) {
			await renameSession(session.id, titleInput.value);
			onChanged();
		}
	}

	async function remove() {
		try {
			await deleteSession(session.id);
		} catch (e) {
			problem = `Couldn't delete this take: ${e instanceof Error ? e.message : String(e)}.`;
		}
		onChanged();
	}

	onDestroy(() => {
		if (playerUrl) URL.revokeObjectURL(playerUrl);
	});
</script>

<li data-testid="session" data-session-id={session.id} data-state={takeState} data-backed-up={backedUp}>
	<div class="what">
		{#if renaming}
			<input
				bind:this={titleInput}
				class="title-input"
				value={session.title}
				aria-label="Take name"
				maxlength="200"
				onkeydown={(e) => {
					if (e.key === 'Enter') void finishRename(true);
					if (e.key === 'Escape') void finishRename(false);
				}}
				onblur={() => finishRename(true)}
			/>
		{:else}
			<span class="title" data-testid="take-title">{session.title}</span>
		{/if}
		<span class="details figures">{details}</span>
	</div>
	<span class="duration figures">{durationUs !== null ? formatDuration(durationUs) : ''}</span>
	<span class="state">
		<StateChip state={takeState} {progress} />
		{#if takeState === 'ready' && warnNotBackedUp(persistence, backedUp)}<Badge tone="working">Not backed up</Badge>{/if}
	</span>
	<span class="actions">
		{#if takeState === 'ready'}
			<Button onclick={play}>Play</Button>
			{#if segments.length === 1}
				<Button onclick={() => download(segments[0]!)}>Download</Button>
			{:else}
				<Menu
					label="Download"
					items={segments.map((s, i) => ({
						label: `Part ${i + 1} of ${segments.length}${s.durationUs !== null ? ` (${formatDuration(s.durationUs)})` : ''}`,
						onselect: () => download(s)
					}))}>Download</Menu
				>
			{/if}
		{:else if takeState === 'interrupted' && onRecover}
			<Button variant="primary" onclick={onRecover}>Recover</Button>
		{:else if failed && progress === undefined && onRetry}
			<Button variant="primary" onclick={onRetry}>Try again</Button>
		{/if}
		<Menu
			label="More actions"
			items={[
				{ label: 'Rename', onselect: startRename },
				{ label: 'Delete…', onselect: () => confirmDelete?.showModal(), danger: true, disabled: !canDelete(session) }
			]}>⋯</Menu
		>
	</span>
	{#if takeState === 'interrupted'}
		<p class="problem" role="alert" data-testid="interrupted">
			{#if failed && isOutOfRoom(failed)}
				There wasn't room on this computer to finish this take. The raw recording is kept: free up space, then press Recover.
			{:else if failed}
				Couldn't recover this take: {failed}.
			{:else if recovery}
				The browser closed while this take was being recovered. Recover tries again.
			{:else}
				The browser closed during this take.
			{/if}
		</p>
	{:else if failed && isOutOfRoom(failed)}
		<p class="problem" role="alert" data-testid="finalize-failed">
			There wasn't room on this computer to finish this take. The raw recording is kept: free up space, then press Try again.
		</p>
	{:else if failed}
		<p class="problem" role="alert" data-testid="finalize-failed">
			Couldn't finish this take: {failed}. The raw recording is kept: if this computer is short of space, free some up, then
			press Try again.
		</p>
	{:else if takeState === 'ready' && recovery && durationUs !== null}
		<p class="recovered" data-testid="recovered">
			Recovered {formatDuration(durationUs)} of about {formatDuration(Math.max(recovery.expectedUs, durationUs))}
		</p>
	{/if}
	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{/if}
	{#if playerUrl}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video src={playerUrl} controls data-testid="player"></video>
	{/if}

	<dialog bind:this={confirmDelete} aria-labelledby="delete-{session.id}">
		<form method="dialog">
			<h3 id="delete-{session.id}">Delete “{session.title}”?</h3>
			<p>
				This removes the recording from this computer for good.
				{#if !backedUp}<strong>It hasn't been downloaded</strong>, so there is no other copy.{/if}
			</p>
			<div class="dialog-actions">
				<Button type="submit" value="cancel" autofocus>Cancel</Button>
				<button type="submit" class="delete" value="delete" onclick={remove}>Delete</button>
			</div>
		</form>
	</dialog>
</li>

<style>
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 64px 120px 200px;
		align-items: center;
		column-gap: 16px;
		padding: 12px 16px;
	}
	.what {
		display: grid;
		min-width: 0;
	}
	.title {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title-input {
		height: 26px;
		margin: -2px 0;
		padding: 0 6px;
		border: 1px solid var(--track-3);
		border-radius: var(--radius-button);
		font: inherit;
		font-weight: 600;
	}
	.details {
		color: var(--muted);
		font-size: var(--text-small);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.duration {
		text-align: right;
	}
	.state {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.problem,
	.recovered,
	video {
		grid-column: 1 / -1;
		margin-top: 10px;
	}
	.problem {
		padding: 8px 12px;
		border-radius: var(--radius-panel);
		background: var(--problem-bg);
		color: var(--problem-fg);
		font-size: var(--text-small);
	}
	.recovered {
		color: var(--muted);
		font-size: var(--text-small);
	}
	video {
		width: 100%;
		max-height: 24rem;
		border-radius: var(--radius-video);
		background: #000;
	}
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
	dialog h3 {
		margin-bottom: 8px;
		font-size: 16px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	dialog p {
		color: var(--muted);
		font-size: var(--text-small);
	}
	dialog strong {
		color: var(--ink);
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 20px;
	}
	.delete {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--record);
		border-radius: var(--radius-button);
		background: var(--record);
		color: #fff;
		font-size: var(--text-small);
		font-weight: 500;
		cursor: pointer;
	}
	@media (max-width: 640px) {
		li {
			grid-template-columns: minmax(0, 1fr) auto;
			row-gap: 8px;
		}
		.actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
	}
</style>
