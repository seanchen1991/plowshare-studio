<script lang="ts">
	import { onMount } from 'svelte';
	import { detectBrowserSupport } from '../lib/browser/support';
	import { finalizeRecording, recoverRecording } from '../lib/media/finalize';
	import { recordingDurationUs, sessionState, shouldRecoverAutomatically, type Session } from '../lib/storage/session-file';
	import { checkSessionsOnLaunch, listSessions } from '../lib/storage/sessions';
	import RecordScreen from './RecordScreen.svelte';
	import SegmentedControl from './SegmentedControl.svelte';
	import TakesScreen from './TakesScreen.svelte';
	import { formatDuration } from './format';

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
	// Takes recovered automatically on this visit, until the user has looked at Takes.
	let recoveredIds = $state<string[]>([]);
	let recovering = $state(0);
	const interrupted = $derived(sessions.filter((s) => sessionState(s) === 'interrupted' && progress[s.id] === undefined).length);
	const recovered = $derived(sessions.filter((s) => recoveredIds.includes(s.id) && sessionState(s) === 'ready'));

	$effect(() => {
		if (screen === 'takes') recoveredIds = [];
	});

	function recoveredSummary(session: Session): string {
		const recording = session.recordings[0]!;
		const durationUs = recordingDurationUs(recording) ?? 0;
		const expectedUs = Math.max(recording.recovery?.expectedUs ?? 0, durationUs);
		return `${formatDuration(durationUs)} of about ${formatDuration(expectedUs)}`;
	}

	async function refresh() {
		sessions = await listSessions();
	}

	onMount(() => {
		if (support.supported) void launch();
	});

	async function launch() {
		await checkSessionsOnLaunch().finally(refresh);
		const cutOff = sessions.filter((s) => s.recordings.some(shouldRecoverAutomatically));
		recovering = cutOff.length;
		for (const session of cutOff) {
			await recover(session);
			if (sessions.find((s) => s.id === session.id && sessionState(s) === 'ready')) recoveredIds = [...recoveredIds, session.id];
			recovering--;
		}
	}

	async function finalize(session: Session) {
		const recordingId = session.recordings[0]!.id;
		progress[session.id] = 0;
		await finalizeRecording(session.id, recordingId, (p) => (progress[session.id] = p));
		delete progress[session.id];
		await refresh();
	}

	async function recover(session: Session) {
		const recordingId = session.recordings[0]!.id;
		progress[session.id] = 0;
		sessions = sessions.map((s) => (s.id === session.id ? { ...s, recordings: s.recordings.map((r) => ({ ...r, state: 'finalizing' })) } : s));
		await recoverRecording(session.id, recordingId, (p) => (progress[session.id] = p));
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
		{#if screen === 'record'}
			{#if interrupted > 0}
				<p class="notice problem" role="alert" data-testid="recovery-notice">
					{interrupted === 1 ? 'A take was' : `${interrupted} takes were`} cut off when the browser closed and couldn't be recovered automatically.
					<button type="button" onclick={() => (screen = 'takes')}>Recover in Takes</button>
				</p>
			{:else if recovering > 0}
				<p class="notice working" role="status" data-testid="recovery-notice">
					Recovering {recovering === 1 ? 'a take' : `${recovering} takes`} cut off when the browser closed…
				</p>
			{:else if recovered.length > 0}
				<p class="notice ready" role="status" data-testid="recovery-notice">
					{#if recovered.length === 1}
						Recovered a take cut off when the browser closed: {recoveredSummary(recovered[0]!)}.
					{:else}
						Recovered {recovered.length} takes cut off when the browser closed.
					{/if}
					<button type="button" onclick={() => (screen = 'takes')}>Show in Takes</button>
				</p>
			{/if}
		{/if}
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
			<TakesScreen {sessions} {progress} onRecover={recover} />
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
	.notice {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px 12px;
		max-width: 960px;
		margin: -12px auto 20px;
		padding: 8px 12px;
		border-radius: var(--radius-panel);
		font-size: var(--text-small);
	}
	.notice.problem {
		background: var(--problem-bg);
		color: var(--problem-fg);
	}
	.notice.working {
		background: var(--working-bg);
		color: var(--working-fg);
	}
	.notice.ready {
		background: var(--ready-bg);
		color: var(--ready-fg);
	}
	.notice button {
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
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
