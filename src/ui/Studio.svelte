<script lang="ts">
	import { onMount } from 'svelte';
	import { finalizeRecording } from '../lib/media/finalize';
	import { startTake, type Take } from '../lib/recorder/take';
	import type { Session } from '../lib/storage/session-file';
	import { listSessions } from '../lib/storage/sessions';
	import Library from './Library.svelte';
	import { formatDuration } from './format';

	let phase = $state<'idle' | 'starting' | 'capturing' | 'stopping'>('idle');
	let error = $state<string | null>(null);
	let elapsedMs = $state(0);
	let writtenBytes = $state(0);
	let sessions = $state<Session[]>([]);
	let progress = $state<Record<string, number>>({});
	let preview = $state<HTMLVideoElement>();

	let take: Take | null = null;
	let stream: MediaStream | null = null;
	let ticker: ReturnType<typeof setInterval> | undefined;

	async function refresh() {
		sessions = await listSessions();
	}

	onMount(() => {
		void refresh();
		return () => clearInterval(ticker);
	});

	async function record() {
		error = null;
		phase = 'starting';
		try {
			stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
			preview!.srcObject = stream;
			await preview!.play();
			take = await startTake({
				stream,
				preview,
				onWritten: (bytes) => (writtenBytes = bytes),
				onError: (message) => {
					error = `Recording stopped: couldn't save to this computer (${message}).`;
					void stop();
				}
			});
		} catch (e) {
			error = `Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`;
			releaseDevices();
			phase = 'idle';
			return;
		}
		const started = performance.now();
		elapsedMs = 0;
		writtenBytes = 0;
		ticker = setInterval(() => (elapsedMs = performance.now() - started), 250);
		phase = 'capturing';
		await refresh();
	}

	async function stop() {
		if (phase !== 'capturing' || !take) return;
		phase = 'stopping';
		clearInterval(ticker);
		const session = await take.stop();
		take = null;
		releaseDevices();
		phase = 'idle';
		await refresh();
		void finalize(session);
	}

	async function finalize(session: Session) {
		const recordingId = session.recordings[0]!.id;
		progress[session.id] = 0;
		await finalizeRecording(session.id, recordingId, (p) => (progress[session.id] = p));
		delete progress[session.id];
		await refresh();
	}

	function releaseDevices() {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		if (preview) preview.srcObject = null;
	}
</script>

<section class="record" aria-label="Record">
	<video bind:this={preview} class:live={phase === 'capturing'} muted playsinline></video>
	{#if phase === 'capturing' || phase === 'stopping'}
		<p class="elapsed" data-testid="elapsed">
			{formatDuration(elapsedMs * 1000)} · {(writtenBytes / 1e6).toFixed(0)} MB saved
		</p>
		<button onclick={stop} disabled={phase === 'stopping'}>Stop</button>
	{:else}
		<button onclick={record} disabled={phase === 'starting'}>Record</button>
	{/if}
	{#if error}
		<p role="alert">{error}</p>
	{/if}
</section>

<Library {sessions} {progress} />

<style>
	.record {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	video {
		display: none;
		width: 100%;
		max-height: 20rem;
		background: #000;
	}
	video.live {
		display: block;
	}
	.elapsed {
		font-variant-numeric: tabular-nums;
		margin: 0;
	}
</style>
