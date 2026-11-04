<script lang="ts">
	import { onMount } from 'svelte';
	import { detectBrowserSupport } from '../lib/browser/support';
	import { finalizeRecording } from '../lib/media/finalize';
	import type { Session } from '../lib/storage/session-file';
	import { listSessions } from '../lib/storage/sessions';
	import RecordScreen from './RecordScreen.svelte';
	import SegmentedControl from './SegmentedControl.svelte';
	import TakesScreen from './TakesScreen.svelte';

	type Screen = 'record' | 'takes' | 'edit';

	const support = detectBrowserSupport(navigator.userAgent);

	const unsupportedMessages = {
		safari: "Plowshare Studio doesn't support Safari yet.",
		ios: "Plowshare Studio doesn't support iPhone or iPad yet.",
		unknown: "Plowshare Studio doesn't support this browser yet."
	};

	const screens: { value: Screen; label: string; disabled?: boolean }[] = [
		{ value: 'record', label: 'Record' },
		{ value: 'takes', label: 'Takes' },
		{ value: 'edit', label: 'Edit', disabled: true }
	];

	let screen = $state<Screen>('record');
	let sessions = $state<Session[]>([]);
	let progress = $state<Record<string, number>>({});
	let lastTakeId = $state<string | null>(null);

	const lastTake = $derived(sessions.find((s) => s.id === lastTakeId) ?? null);

	async function refresh() {
		sessions = await listSessions();
	}

	onMount(() => {
		if (support.supported) void refresh();
	});

	async function finalize(session: Session) {
		const recordingId = session.recordings[0]!.id;
		progress[session.id] = 0;
		await finalizeRecording(session.id, recordingId, (p) => (progress[session.id] = p));
		delete progress[session.id];
		await refresh();
	}
</script>

{#if support.supported}
	<header class="top">
		<h1>Plowshare Studio</h1>
		<nav><SegmentedControl options={screens} bind:value={screen} label="Screens" /></nav>
		<!-- Recording time left goes here (issue 11). -->
		<div class="room"></div>
	</header>
	<!-- Both screens stay mounted, so a take keeps recording while Takes is open. -->
	<main data-testid="home">
		<section aria-label="Record" hidden={screen !== 'record'}>
			<RecordScreen
				active={screen === 'record'}
				browser={support.browser}
				{lastTake}
				progress={lastTakeId ? progress[lastTakeId] : undefined}
				onStarted={(session) => {
					lastTakeId = session.id;
					void refresh();
				}}
				onStopped={async (session) => {
					await refresh();
					void finalize(session);
				}}
				onShowTakes={() => (screen = 'takes')}
			/>
		</section>
		<section aria-label="Takes" hidden={screen !== 'takes'}>
			<TakesScreen {sessions} {progress} />
		</section>
	</main>
{:else}
	<main class="unsupported">
		<h1>Plowshare Studio</h1>
		<p data-testid="unsupported" role="alert">
			{unsupportedMessages[support.reason]}
			Please use Chrome, Edge or Firefox on a computer.
		</p>
	</main>
{/if}

<style>
	.top {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		height: 52px;
		padding: 0 20px;
		border-bottom: 1px solid var(--line);
		background: var(--canvas);
	}
	h1 {
		font-size: var(--text);
		font-weight: 650;
	}
	.room {
		justify-self: end;
		color: var(--muted);
		font-size: var(--text-small);
	}
	main {
		padding: 32px 24px 64px;
	}
	.unsupported {
		display: grid;
		gap: 12px;
		max-width: 32rem;
		margin: 15vh auto 0;
	}
	.unsupported h1 {
		font-size: 22px;
	}
</style>
