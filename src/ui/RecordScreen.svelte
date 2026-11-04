<script lang="ts">
	import { onDestroy } from 'svelte';
	import { startTake, type Take } from '../lib/recorder/take';
	import type { Session } from '../lib/storage/session-file';
	import TakeRow from './TakeRow.svelte';
	import { formatDuration } from './format';

	let {
		lastTake,
		progress,
		onStarted,
		onStopped,
		onShowTakes
	}: {
		/** The take recorded most recently in this visit, shown under the Record button. */
		lastTake: Session | null;
		progress?: number;
		onStarted: (session: Session) => void;
		onStopped: (session: Session) => void;
		onShowTakes: () => void;
	} = $props();

	let phase = $state<'idle' | 'starting' | 'capturing' | 'stopping'>('idle');
	let error = $state<string | null>(null);
	let elapsedMs = $state(0);
	let writtenBytes = $state(0);
	let preview = $state<HTMLVideoElement>();

	let take: Take | null = null;
	let stream: MediaStream | null = null;
	let ticker: ReturnType<typeof setInterval> | undefined;

	onDestroy(() => clearInterval(ticker));

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
		onStarted(take.session);
	}

	async function stop() {
		if (phase !== 'capturing' || !take) return;
		phase = 'stopping';
		clearInterval(ticker);
		const session = await take.stop();
		take = null;
		releaseDevices();
		phase = 'idle';
		onStopped(session);
	}

	function releaseDevices() {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		if (preview) preview.srcObject = null;
	}

	const busy = $derived(phase === 'capturing' || phase === 'stopping');
</script>

<div class="record">
	<div class="stage" class:live={busy}>
		<video bind:this={preview} muted playsinline></video>
		{#if !busy}
			<p class="placeholder">{phase === 'starting' ? 'Starting camera…' : 'Your camera turns on when you record.'}</p>
		{/if}
		{#if busy}
			<span class="rec"><span class="dot"></span>REC</span>
		{/if}
	</div>

	<!-- Device pills and the live mic waveform go here (issues 06 and 07). -->

	<div class="controls">
		{#if busy}
			<button class="big stop" onclick={stop} disabled={phase === 'stopping'}>
				<span class="square"></span>Stop
			</button>
			<p class="elapsed figures" data-testid="elapsed">
				<span class="time">{formatDuration(elapsedMs * 1000)}</span>
				<span class="saved">{(writtenBytes / 1e6).toFixed(0)} MB saved</span>
			</p>
		{:else}
			<button class="big" onclick={record} disabled={phase === 'starting'}>
				<span class="dot"></span>Record
			</button>
		{/if}
	</div>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if lastTake && !busy}
		<section class="last" aria-label="Last take">
			<div class="last-head">
				<h2>Last take</h2>
				<button class="link" onclick={onShowTakes}>All takes</button>
			</div>
			<ul><TakeRow session={lastTake} {progress} /></ul>
		</section>
	{/if}
</div>

<style>
	.record {
		display: grid;
		justify-items: center;
		gap: 20px;
		max-width: 880px;
		margin: 0 auto;
	}
	.stage {
		position: relative;
		width: 100%;
		max-height: 60vh;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-video);
		background: var(--soft);
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.stage.live {
		background: #000;
		border-color: #000;
	}
	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		visibility: hidden;
	}
	.live video {
		visibility: visible;
	}
	.placeholder {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--muted);
	}
	.rec {
		position: absolute;
		top: 12px;
		left: 12px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		border-radius: var(--radius-round);
		background: rgb(0 0 0 / 0.55);
		color: #fff;
		font-size: var(--text-tiny);
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.controls {
		display: grid;
		justify-items: center;
		gap: 10px;
	}
	.big {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		height: 52px;
		padding: 0 28px 0 22px;
		border: 1px solid var(--line);
		border-radius: var(--radius-round);
		background: var(--canvas);
		box-shadow: 0 1px 3px rgb(29 27 34 / 0.08);
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
	}
	.big:hover:not(:disabled) {
		background: var(--soft);
	}
	.big:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--record);
	}
	.rec .dot {
		width: 7px;
		height: 7px;
	}
	.square {
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background: var(--ink);
	}
	.elapsed {
		display: grid;
		justify-items: center;
	}
	.time {
		font-size: 22px;
		font-weight: 600;
	}
	.saved {
		color: var(--muted);
		font-size: var(--text-small);
	}
	.error {
		padding: 8px 12px;
		border-radius: var(--radius-panel);
		background: var(--problem-bg);
		color: var(--problem-fg);
	}
	.last {
		width: 100%;
		display: grid;
		gap: 8px;
		margin-top: 8px;
	}
	.last-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	h2 {
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--muted);
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font-size: var(--text-small);
		text-decoration: underline;
		cursor: pointer;
	}
	.link:hover {
		color: var(--ink);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
	}
</style>
