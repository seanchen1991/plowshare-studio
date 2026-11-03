<script lang="ts">
	import { readFile } from '../lib/storage/opfs';
	import { recordingDurationUs, sessionState, type RecordingState, type Session } from '../lib/storage/session-file';
	import { formatDuration } from './format';

	let { sessions, progress }: { sessions: Session[]; progress: Record<string, number> } = $props();

	let playing = $state<{ sessionId: string; url: string } | null>(null);

	const stateLabels: Record<RecordingState, string> = {
		capturing: 'Capturing',
		paused: 'Paused',
		finalizing: 'Finalizing',
		ready: 'Ready',
		interrupted: 'Interrupted'
	};

	async function play(session: Session) {
		const path = session.recordings[0]?.segments[0]?.path;
		if (!path) return;
		if (playing) URL.revokeObjectURL(playing.url);
		playing = { sessionId: session.id, url: URL.createObjectURL(await readFile(path)) };
	}
</script>

<section aria-label="Library">
	<h2>Takes</h2>
	{#if sessions.length === 0}
		<p>No takes yet.</p>
	{:else}
		<ul>
			{#each sessions as session (session.id)}
				{@const state = sessionState(session)}
				{@const durationUs = session.recordings[0] ? recordingDurationUs(session.recordings[0]) : null}
				{@const failed = session.recordings.find((r) => r.finalizeError)?.finalizeError}
				<li data-testid="session" data-session-id={session.id} data-state={state}>
					<span class="title">{session.title}</span>
					<span class="state">
						{stateLabels[state]}{#if session.id in progress}&nbsp;{Math.round(progress[session.id]! * 100)}%{/if}
					</span>
					{#if durationUs !== null}<span>{formatDuration(durationUs)}</span>{/if}
					{#if state === 'ready'}
						<button onclick={() => play(session)}>Play</button>
					{/if}
					{#if failed}
						<p role="alert">Couldn't finish this take: {failed}. The raw recording is kept.</p>
					{/if}
					{#if playing?.sessionId === session.id}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={playing.url} controls data-testid="player"></video>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.title {
		font-weight: 600;
	}
	.state {
		color: #555;
	}
	video {
		width: 100%;
		max-height: 20rem;
		background: #000;
	}
</style>
