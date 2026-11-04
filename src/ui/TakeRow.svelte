<script lang="ts">
	import { onDestroy } from 'svelte';
	import { readFile } from '../lib/storage/opfs';
	import { recordingDurationUs, sessionState, type Session } from '../lib/storage/session-file';
	import Button from './Button.svelte';
	import StateChip from './StateChip.svelte';
	import { formatDuration } from './format';

	/** One Session in a list of takes; `progress` is Finalizing's, when running. */
	let { session, progress, onRecover }: { session: Session; progress?: number; onRecover?: () => void } = $props();

	let playerUrl = $state<string | null>(null);

	const takeState = $derived(sessionState(session));
	const recording = $derived(session.recordings[0]);
	const durationUs = $derived(recording ? recordingDurationUs(recording) : null);
	const failed = $derived(session.recordings.find((r) => r.finalizeError)?.finalizeError);
	const recovery = $derived(recording?.recovery);

	async function play() {
		const path = recording?.segments[0]?.path;
		if (!path) return;
		if (playerUrl) URL.revokeObjectURL(playerUrl);
		playerUrl = URL.createObjectURL(await readFile(path));
	}

	onDestroy(() => {
		if (playerUrl) URL.revokeObjectURL(playerUrl);
	});
</script>

<li data-testid="session" data-session-id={session.id} data-state={takeState}>
	<div class="what">
		<span class="title">{session.title}</span>
		{#if recording?.video}
			<span class="details figures">{recording.video.width} × {recording.video.height}</span>
		{/if}
	</div>
	<span class="duration figures">{durationUs !== null ? formatDuration(durationUs) : ''}</span>
	<span class="state"><StateChip state={takeState} {progress} /></span>
	<span class="actions">
		{#if takeState === 'ready'}
			<Button onclick={play}>Play</Button>
		{:else if takeState === 'interrupted' && onRecover}
			<Button variant="primary" onclick={onRecover}>Recover</Button>
		{/if}
	</span>
	{#if takeState === 'interrupted'}
		<p class="problem" role="alert" data-testid="interrupted">
			{#if failed}
				Couldn't recover this take: {failed}.
			{:else}
				The browser closed during this take. Recover saves everything up to the last few seconds.
			{/if}
		</p>
	{:else if failed}
		<p class="problem" role="alert">Couldn't finish this take: {failed}. The raw recording is kept.</p>
	{:else if takeState === 'ready' && recovery && durationUs !== null}
		<p class="recovered" data-testid="recovered">
			Recovered {formatDuration(durationUs)} of about {formatDuration(Math.max(recovery.expectedUs, durationUs))}
		</p>
	{/if}
	{#if playerUrl}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video src={playerUrl} controls data-testid="player"></video>
	{/if}
</li>

<style>
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 64px 112px 72px;
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
	.details {
		color: var(--muted);
		font-size: var(--text-small);
	}
	.duration {
		text-align: right;
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
</style>
