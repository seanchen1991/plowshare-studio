<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { SupportedBrowser } from '../lib/browser/support';
	import { resolutionNotice } from '../lib/media/capture';
	import { deviceProblem, frameRateWarning, sampleRateWarning, type DeviceProblem } from '../lib/recorder/device-checks';
	import { findDevice, loadDevicePrefs, micKey, saveDevicePrefs } from '../lib/recorder/device-prefs';
	import { listDevices, openCamera, openDevices, openMic, watchFrameRate, type DeviceLists } from '../lib/recorder/devices';
	import { meterLevel, type LevelReading } from '../lib/recorder/level-meter';
	import { startTake, type Take } from '../lib/recorder/take';
	import type { Session } from '../lib/storage/session-file';
	import Button from './Button.svelte';
	import LevelMeter from './LevelMeter.svelte';
	import PillSelect from './PillSelect.svelte';
	import PillToggle from './PillToggle.svelte';
	import TakeRow from './TakeRow.svelte';
	import { formatDuration } from './format';

	let {
		active,
		browser,
		lastTake,
		progress,
		onStarted,
		onStopped,
		onShowTakes,
		onTakeChanged
	}: {
		/** Whether the Record screen is showing; the camera is only on while it is (or while capturing). */
		active: boolean;
		browser: SupportedBrowser;
		/** The take recorded most recently in this visit, shown under the Record button. */
		lastTake: Session | null;
		progress?: number;
		onStarted: (session: Session) => void;
		onStopped: (session: Session) => void;
		onShowTakes: () => void;
		/** The last take was renamed, downloaded or deleted. */
		onTakeChanged: () => void;
	} = $props();

	const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);

	let phase = $state<'idle' | 'countdown' | 'starting' | 'capturing' | 'stopping'>('idle');
	let countdown = $state(3);
	let reading = $state<LevelReading | null>(null);
	let devicesState = $state<'off' | 'opening' | 'on' | 'failed'>('off');
	let problem = $state<DeviceProblem | null>(null);
	let error = $state<string | null>(null);
	let elapsedMs = $state(0);
	let writtenBytes = $state(0);
	let notice = $state<string | null>(null);
	let preview = $state<HTMLVideoElement>();

	let prefs = $state(loadDevicePrefs());
	let lists = $state<DeviceLists>({ cameras: [], mics: [] });
	let cameraId = $state<string>();
	let micId = $state<string>();
	let fps = $state<number | null>(null);
	let micSampleRate = $state<number>();

	let take: Take | null = null;
	let stream: MediaStream | null = null;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let stopWatching = () => {};
	let stopMetering = () => {};
	let countdownTimer: ReturnType<typeof setInterval> | undefined;
	// Bumped whenever the devices close, so an open still in flight knows it is stale.
	let generation = 0;

	const cleanUpAudio = $derived(cleanUpFor(micId));
	const busy = $derived(phase === 'capturing' || phase === 'stopping');
	const warnings = $derived(
		[fps === null ? null : frameRateWarning(fps), sampleRateWarning(micSampleRate)].filter((w) => w !== null)
	);

	// The camera and mic stay on while the Record screen shows, and through a take.
	$effect(() => {
		const wanted = active || phase !== 'idle';
		untrack(() => {
			if (wanted && devicesState === 'off') void openPreview();
			else if (!wanted && devicesState !== 'off') closePreview();
		});
	});

	function onDeviceChange() {
		if (devicesState === 'on') void listDevices().then((l) => (lists = l));
	}
	navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);

	onDestroy(() => {
		clearInterval(ticker);
		clearInterval(countdownTimer);
		navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
		closePreview();
	});

	async function openPreview() {
		const mine = ++generation;
		devicesState = 'opening';
		problem = null;
		try {
			const opened = await openDevices({
				cameraId: prefs.camera?.id,
				micId: prefs.mic?.id,
				cleanUpAudio: prefs.mic ? (prefs.cleanUpAudio[micKey({ deviceId: prefs.mic.id, label: prefs.mic.label })] ?? false) : false
			});
			if (mine !== generation) return opened.getTracks().forEach((t) => t.stop());
			stream = opened;
			// Browsers treat a preferred device as a hint, and before access is allowed they
			// can't match it at all. Now that the devices are listed, insist on the saved ones.
			lists = await listDevices();
			const savedCamera = findDevice(lists.cameras, prefs.camera);
			const savedMic = findDevice(lists.mics, prefs.mic);
			const actualCamera = stream.getVideoTracks()[0]?.getSettings().deviceId;
			const actualMic = stream.getAudioTracks()[0]?.getSettings().deviceId;
			if (savedCamera && savedCamera.deviceId !== actualCamera) await replaceCamera(savedCamera.deviceId);
			if (savedMic && (savedMic.deviceId !== actualMic || cleanUpFor(actualMic) !== cleanUpFor(savedMic.deviceId))) {
				await replaceMic(savedMic.deviceId);
			} else if (!savedMic && actualMic && cleanUpFor(actualMic)) {
				// The mic the browser picked may have "Clean up audio" on from before.
				await replaceMic(actualMic);
			}
			if (mine !== generation) return;
			await attach();
			devicesState = 'on';
		} catch (e) {
			if (mine !== generation) return;
			closePreview();
			problem = deviceProblem(e, browser, isMac);
			devicesState = 'failed';
		}
	}

	function closePreview() {
		generation++;
		stopWatching();
		stopMetering();
		reading = null;
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		if (preview) preview.srcObject = null;
		fps = null;
		micSampleRate = undefined;
		devicesState = 'off';
	}

	/** Shows the current stream in the preview and starts the checks on it. */
	async function attach() {
		const video = stream!.getVideoTracks()[0];
		const audio = stream!.getAudioTracks()[0];
		cameraId = video?.getSettings().deviceId;
		micId = audio?.getSettings().deviceId;
		micSampleRate = audio?.getSettings().sampleRate;
		stopWatching();
		fps = null;
		preview!.srcObject = stream;
		await preview!.play();
		stopWatching = watchFrameRate(preview!, (rate) => (fps = rate));
		stopMetering();
		stopMetering = audio ? meterLevel(audio, (r) => (reading = r)) : () => {};
	}

	async function replaceCamera(id: string) {
		stream!.getVideoTracks().forEach((t) => t.stop());
		const track = await openCamera(id);
		stream = new MediaStream([track, ...stream!.getAudioTracks()]);
	}

	/** "Clean up audio" for a mic, remembered by its name. */
	function cleanUpFor(id: string | undefined): boolean {
		const mic = lists.mics.find((d) => d.deviceId === id);
		return mic ? (prefs.cleanUpAudio[micKey(mic)] ?? false) : false;
	}

	function saved(devices: MediaDeviceInfo[], id: string) {
		return { id, label: devices.find((d) => d.deviceId === id)?.label ?? '' };
	}

	async function replaceMic(id: string) {
		stream!.getAudioTracks().forEach((t) => t.stop());
		const track = await openMic(id, cleanUpFor(id));
		stream = new MediaStream([...stream!.getVideoTracks(), track]);
	}

	async function changeDevice(change: () => Promise<void>) {
		error = null;
		try {
			await change();
			await attach();
		} catch (e) {
			error = `${deviceProblem(e, browser, isMac).title}`;
		}
	}

	function chooseCamera(id: string) {
		prefs.camera = saved(lists.cameras, id);
		saveDevicePrefs(prefs);
		void changeDevice(() => replaceCamera(id));
	}

	function chooseMic(id: string) {
		prefs.mic = saved(lists.mics, id);
		saveDevicePrefs(prefs);
		void changeDevice(() => replaceMic(id));
	}

	function setCleanUpAudio(on: boolean) {
		const mic = lists.mics.find((d) => d.deviceId === micId);
		if (!mic) return;
		prefs.cleanUpAudio[micKey(mic)] = on;
		saveDevicePrefs(prefs);
		const id = mic.deviceId;
		void changeDevice(() => replaceMic(id));
	}

	/** 3-2-1, so the user can check their level (automatic gain is off) before anything is recorded. */
	function startCountdown() {
		if (phase !== 'idle' || devicesState !== 'on') return;
		error = null;
		countdown = 3;
		phase = 'countdown';
		countdownTimer = setInterval(() => {
			if (--countdown > 0) return;
			clearInterval(countdownTimer);
			void record();
		}, 1000);
	}

	function cancelCountdown() {
		if (phase !== 'countdown') return;
		clearInterval(countdownTimer);
		phase = 'idle';
	}

	function onkeydown(event: KeyboardEvent) {
		if (!active) return;
		if (event.key === 'Escape') return cancelCountdown();
		// Space starts, unless it's meant for a focused control.
		const target = event.target as HTMLElement;
		if (event.code !== 'Space' || event.repeat || target.closest('button, input, select, textarea, [contenteditable]')) return;
		event.preventDefault();
		startCountdown();
	}

	async function record() {
		if (!stream) return;
		phase = 'starting';
		try {
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
			phase = 'idle';
			return;
		}
		const started = performance.now();
		elapsedMs = 0;
		writtenBytes = 0;
		ticker = setInterval(() => (elapsedMs = performance.now() - started), 250);
		phase = 'capturing';
		notice = resolutionNotice(take.session.recordings[0]!.video);
		onStarted(take.session);
	}

	async function stop() {
		if (phase !== 'capturing' || !take) return;
		phase = 'stopping';
		clearInterval(ticker);
		const session = await take.stop();
		take = null;
		notice = null;
		phase = 'idle';
		onStopped(session);
	}

	const deviceOptions = (devices: MediaDeviceInfo[], fallback: string) =>
		devices.map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
</script>

<svelte:window {onkeydown} />

<div class="record">
	<div class="stage" class:live={devicesState === 'on'}>
		<video bind:this={preview} muted playsinline data-testid="preview"></video>
		{#if devicesState === 'opening' || devicesState === 'off'}
			<p class="placeholder">Starting camera…</p>
		{:else if devicesState === 'failed' && problem}
			<div class="problem" role="alert" data-testid="device-problem">
				<p class="problem-title">{problem.title}</p>
				<ol>
					{#each problem.steps as step (step)}<li>{step}</li>{/each}
				</ol>
				<Button onclick={openPreview}>Try again</Button>
			</div>
		{/if}
		{#if busy}
			<span class="rec"><span class="dot"></span>REC</span>
		{/if}
		{#if phase === 'countdown'}
			<div class="countdown" data-testid="countdown">
				<span class="count">{countdown}</span>
			</div>
		{/if}
		{#if warnings.length > 0 && devicesState === 'on'}
			<div class="warnings">
				{#each warnings as warning (warning)}<p data-testid="device-warning">{warning}</p>{/each}
			</div>
		{/if}
	</div>

	<div class="devices">
		<PillSelect
			label="Camera"
			icon="camera"
			options={deviceOptions(lists.cameras, 'Camera')}
			value={cameraId}
			disabled={devicesState !== 'on' || phase !== 'idle'}
			onchange={chooseCamera}
		/>
		<PillSelect
			label="Microphone"
			icon="mic"
			options={deviceOptions(lists.mics, 'Microphone')}
			value={micId}
			disabled={devicesState !== 'on' || phase !== 'idle'}
			onchange={chooseMic}
		/>
		<PillToggle
			pressed={cleanUpAudio}
			disabled={devicesState !== 'on' || phase !== 'idle'}
			title="Echo cancellation, noise suppression and automatic gain, as in video calls. Best left off with a good mic in a quiet room."
			onchange={setCleanUpAudio}
		>
			Clean up audio
		</PillToggle>
	</div>

	{#if devicesState === 'on'}
		<LevelMeter {reading} warn={phase === 'countdown'} />
	{/if}

	<div class="controls">
		{#if busy}
			<button class="big stop" onclick={stop} disabled={phase === 'stopping'}>
				<span class="square"></span>Stop
			</button>
			<p class="elapsed figures" data-testid="elapsed">
				<span class="time">{formatDuration(elapsedMs * 1000)}</span>
				<span class="saved">{(writtenBytes / 1e6).toFixed(0)} MB saved</span>
			</p>
		{:else if phase === 'countdown'}
			<button class="big" onclick={cancelCountdown}>Cancel</button>
			<p class="hint">Recording starts in {countdown}… Press Esc to cancel</p>
		{:else}
			<button class="big" onclick={startCountdown} disabled={phase === 'starting' || devicesState !== 'on'}>
				<span class="dot"></span>Record
			</button>
			<p class="hint">Press Space to start · 3-2-1 countdown</p>
		{/if}
	</div>

	{#if notice}
		<p class="notice" data-testid="resolution-notice">{notice}</p>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if lastTake && !busy}
		<section class="last" aria-label="Last take">
			<div class="last-head">
				<h2>Last take</h2>
				<button class="link" onclick={onShowTakes}>All takes</button>
			</div>
			<ul><TakeRow session={lastTake} {progress} onChanged={onTakeChanged} /></ul>
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
		/* Mirrored like a selfie camera; the recording is not. */
		transform: scaleX(-1);
	}
	.placeholder {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--muted);
	}
	.problem {
		position: absolute;
		inset: 0;
		display: grid;
		align-content: center;
		justify-items: start;
		gap: 10px;
		padding: 24px 15%;
	}
	.problem-title {
		font-weight: 600;
	}
	.problem ol {
		margin: 0;
		padding-left: 20px;
		color: var(--muted);
	}
	.warnings {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: 12px;
		display: grid;
		justify-items: start;
		gap: 6px;
	}
	.warnings p {
		max-width: 100%;
		padding: 6px 10px;
		border: 1px solid var(--working-edge);
		border-radius: var(--radius-panel);
		background: var(--working-bg);
		color: var(--working-fg);
		font-size: var(--text-small);
	}
	.devices {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
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
	.countdown {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 0.25);
	}
	.count {
		display: grid;
		place-items: center;
		width: 120px;
		height: 120px;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.55);
		color: #fff;
		font-size: 64px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.hint {
		color: var(--muted);
		font-size: var(--text-small);
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
	.notice {
		padding: 8px 12px;
		border-radius: var(--radius-panel);
		background: var(--working-bg);
		color: var(--working-fg);
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
