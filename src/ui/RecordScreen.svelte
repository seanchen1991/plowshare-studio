<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { playAlertSound } from '../lib/browser/alert-sound';
	import type { SupportedBrowser } from '../lib/browser/support';
	import { audioBitsPerSecond, resolutionNotice, videoBitsPerSecond } from '../lib/media/capture';
	import { deviceProblem, frameRateWarning, sampleRateWarning, type DeviceProblem } from '../lib/recorder/device-checks';
	import { findDevice, loadDevicePrefs, micKey, saveDevicePrefs } from '../lib/recorder/device-prefs';
	import { listDevices, openCamera, openDevices, openMic, watchFrameRate, type DeviceLists } from '../lib/recorder/devices';
	import { meterLevel, type LevelReading } from '../lib/recorder/level-meter';
	import { startTake, type Pause, type StoppedTake, type Take } from '../lib/recorder/take';
	import { isOutOfRoom, measureStorage } from '../lib/storage/budget';
	import type { Persistence } from '../lib/storage/persistence';
	import type { Session } from '../lib/storage/session-file';
	import { showOf, type Show } from '../lib/storage/show-file';
	import { createShow, nextTakeShowId, setNextTakeShowId } from '../lib/storage/shows';
	import { formatTimeLeft, minimumSecondsToStart, recordingTimeLeftSeconds, warningDue } from '../lib/storage/time-left';
	import Button from './Button.svelte';
	import LevelMeter from './LevelMeter.svelte';
	import PillSelect from './PillSelect.svelte';
	import PillToggle from './PillToggle.svelte';
	import ShowNameDialog from './ShowNameDialog.svelte';
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
		onTakeChanged,
		onRetry,
		onEdit,
		onRecordPressed,
		persistence,
		shows,
		onShowsChanged,
		timeLeft = $bindable(null)
	}: {
		/** Whether the Record screen is showing; the camera is only on while it is (or while capturing). */
		active: boolean;
		browser: SupportedBrowser;
		/** The take recorded most recently in this visit, shown under the Record button. */
		lastTake: Session | null;
		progress?: number;
		onStarted: (session: Session) => void;
		/** The take has stopped and is Finalizing; it still holds its lock, for Finalizing to release. */
		onStopped: (stopped: StoppedTake) => void;
		onShowTakes: () => void;
		/** The last take was renamed, downloaded or deleted. */
		onTakeChanged: () => void;
		/** Runs Finalizing again for a take it failed for. */
		onRetry: (session: Session) => void;
		/** Opens a Ready take in the editor. */
		onEdit: (session: Session) => void;
		/** Record was pressed (the countdown starts): the moment to ask the browser to keep recordings. */
		onRecordPressed: () => void;
		persistence: Persistence;
		shows: Show[];
		/** A Show was created here. */
		onShowsChanged: () => Promise<void>;
		/** Recording time left in seconds, at the camera's bitrate; null until known. */
		timeLeft?: number | null;
	} = $props();

	const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);

	// The Show the next take is for, remembered between takes and visits; a deleted Show means none.
	let chosenShowId = $state(nextTakeShowId());
	const nextShowId = $derived(showOf(chosenShowId, shows)?.id ?? null);
	const newShowOption = 'new';
	let showNameDialog: ShowNameDialog;
	// Remounts the picker, so it goes back to the chosen Show when New show is cancelled.
	let showPickerKey = $state(0);

	function chooseShow(value: string) {
		if (value !== newShowOption) {
			chosenShowId = value || null;
			setNextTakeShowId(chosenShowId);
			return;
		}
		showNameDialog.open({
			onsave: async (name) => {
				const show = await createShow(name);
				await onShowsChanged();
				chooseShow(show.id);
			},
			oncancel: () => showPickerKey++
		});
	}

	let phase = $state<'idle' | 'countdown' | 'starting' | 'capturing' | 'paused' | 'stopping'>('idle');
	// Why the take is Paused, and how far into it; kept through the countdown to resume.
	let paused = $state<{ message: string } | null>(null);
	let countdown = $state(3);
	let reading = $state<LevelReading | null>(null);
	let devicesState = $state<'off' | 'opening' | 'on' | 'failed'>('off');
	let problem = $state<DeviceProblem | null>(null);
	let error = $state<string | null>(null);
	let elapsedMs = $state(0);
	let writtenBytes = $state(0);
	let notice = $state<string | null>(null);
	let preview = $state<HTMLVideoElement>();
	// Bits per second of the camera and mic as last opened, for Recording time left. Until a camera
	// opens, 1080p: the most the app records, so the room shown is never more than there is.
	let bitsPerSecond = $state(videoBitsPerSecond(1080) + audioBitsPerSecond);
	// Why the last take stopped by itself: Recording time left ran out, or the browser refused a write for room.
	let stoppedForSpace = $state<'time-left' | 'write' | null>(null);

	let prefs = $state(loadDevicePrefs());
	let lists = $state<DeviceLists>({ cameras: [], mics: [] });
	let cameraId = $state<string>();
	// Whether the open stream has a camera; false when it's off, for an audio-only take.
	let hasCamera = $state(true);
	let micId = $state<string>();
	let fps = $state<number | null>(null);
	let micSampleRate = $state<number>();

	let take: Take | null = null;
	let stream: MediaStream | null = null;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let stopWatching = () => {};
	let stopMetering = () => {};
	let countdownTimer: ReturnType<typeof setInterval> | undefined;
	let capturedFor = 0;
	// Capture time before the current Segment, and when it started.
	let capturedBefore = 0;
	let segmentStarted = 0;
	// Bumped whenever the devices close, so an open still in flight knows it is stale.
	let generation = 0;

	const cleanUpAudio = $derived(cleanUpFor(micId));
	// Picker values besides the cameras: turning the camera off, and on again before any camera is listed.
	const cameraOffOption = 'off';
	const cameraOnOption = 'on';
	const busy = $derived(phase === 'capturing' || phase === 'stopping');
	// In a take: capturing, or paused (including the countdown to resume).
	const inTake = $derived(busy || paused !== null);
	const choosingDevices = $derived(phase === 'idle' || phase === 'paused');
	const tooLittleRoom = $derived(phase === 'idle' && timeLeft !== null && timeLeft < minimumSecondsToStart);
	const spaceWarning = $derived(inTake && timeLeft !== null ? warningDue(timeLeft) : null);
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

	// Recording time left, every few seconds and whenever a take starts, stops or changes.
	const measuring = setInterval(() => void measureTimeLeft(), 5000);
	$effect(() => {
		void [lastTake, progress === undefined, bitsPerSecond];
		untrack(() => void measureTimeLeft());
	});

	async function measureTimeLeft() {
		const current = take;
		let rate = bitsPerSecond;
		// A recorder can run over the bitrate asked for; after a while, trust what it writes.
		if (current && capturedFor > 30_000) rate = Math.max(rate, (writtenBytes * 8) / (capturedFor / 1000));
		const measure = await measureStorage(current?.session.id, current ? writtenBytes : 0);
		timeLeft = recordingTimeLeftSeconds(measure, rate);
		// Stop while the finished copy still fits, so the take finalizes like any other.
		if (current && current === take && phase === 'capturing' && timeLeft <= 0) {
			stoppedForSpace = 'time-left';
			void stop();
		}
	}

	onDestroy(() => {
		clearInterval(measuring);
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
				cameraOff: prefs.cameraOff,
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
			if (!prefs.cameraOff && savedCamera && savedCamera.deviceId !== actualCamera) await replaceCamera(savedCamera.deviceId);
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
		hasCamera = !!video;
		micId = audio?.getSettings().deviceId;
		micSampleRate = audio?.getSettings().sampleRate;
		bitsPerSecond = (video ? videoBitsPerSecond(video.getSettings().height ?? 0) : 0) + audioBitsPerSecond;
		stopWatching();
		fps = null;
		preview!.srcObject = stream;
		await preview!.play();
		stopWatching = video ? watchFrameRate(preview!, (rate) => (fps = rate)) : () => {};
		stopMetering();
		stopMetering = audio ? meterLevel(audio, (r) => (reading = r)) : () => {};
	}

	async function replaceCamera(id: string | undefined) {
		stream!.getVideoTracks().forEach((t) => t.stop());
		const track = await openCamera(id, prefs.camera?.id);
		stream = new MediaStream([track, ...stream!.getAudioTracks()]);
	}

	function turnCameraOff() {
		stream!.getVideoTracks().forEach((t) => t.stop());
		stream = new MediaStream(stream!.getAudioTracks());
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

	function chooseCamera(value: string) {
		if (value === cameraOffOption) {
			prefs.cameraOff = true;
			saveDevicePrefs(prefs);
			return void changeDevice(async () => turnCameraOff());
		}
		prefs.cameraOff = false;
		if (value !== cameraOnOption) prefs.camera = saved(lists.cameras, value);
		saveDevicePrefs(prefs);
		void changeDevice(async () => {
			await replaceCamera(value === cameraOnOption ? undefined : value);
			// Allowing the camera may be what gives the cameras their names.
			lists = await listDevices();
		});
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
		if ((phase !== 'idle' && phase !== 'paused') || devicesState !== 'on' || tooLittleRoom) return;
		error = null;
		stoppedForSpace = null;
		if (!paused) onRecordPressed();
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
		phase = paused ? 'paused' : 'idle';
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
		if (take && paused) return resume(take, stream);
		phase = 'starting';
		try {
			take = await startTake({
				stream,
				preview,
				showId: nextShowId,
				onWritten: (bytes) => (writtenBytes = bytes),
				onPaused,
				onError: (message) => {
					if (isOutOfRoom(message)) stoppedForSpace = 'write';
					else error = `Recording stopped: couldn't save to this computer (${message}).`;
					void stop();
				}
			});
		} catch (e) {
			error = `Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`;
			phase = 'idle';
			return;
		}
		elapsedMs = capturedBefore = 0;
		writtenBytes = 0;
		startTicker();
		const { video, audio } = take.session.recordings[0]!;
		bitsPerSecond = (video?.bitrate ?? 0) + (audio.bitrate ?? audioBitsPerSecond);
		phase = 'capturing';
		notice = resolutionNotice(take.session.recordings[0]!.video);
		onStarted(take.session);
	}

	function startTicker() {
		segmentStarted = performance.now();
		const tick = () => (elapsedMs = capturedFor = capturedBefore + performance.now() - segmentStarted);
		tick();
		ticker = setInterval(tick, 250);
	}

	function droppedDevices(ended: Pause['ended']): string {
		if (ended.includes('camera') && ended.includes('mic')) return 'Camera and microphone';
		return ended.includes('camera') ? 'Camera' : ended.includes('mic') ? 'Microphone' : 'A device';
	}

	/** A Segment closed because a device dropped out or the computer slept: say so loudly, and get devices to resume with. */
	function onPaused(pause: Pause) {
		if (phase !== 'capturing') return;
		clearInterval(ticker);
		capturedBefore = elapsedMs;
		const at = formatDuration(elapsedMs * 1000);
		paused = {
			message:
				pause.reason === 'sleep'
					? `Recording paused at ${at} while your computer slept.`
					: `${droppedDevices(pause.ended)} disconnected at ${at}. Recording paused.`
		};
		phase = 'paused';
		playAlertSound();
		// The dropped track is dead; open the devices afresh (the saved ones, or whatever is there now).
		closePreview();
		void openPreview();
	}

	async function resume(current: Take, currentStream: MediaStream) {
		phase = 'starting';
		try {
			await current.resume(currentStream, preview);
		} catch (e) {
			error = `Couldn't resume recording: ${e instanceof Error ? e.message : String(e)}`;
			phase = 'paused';
			return;
		}
		paused = null;
		startTicker();
		phase = 'capturing';
	}

	async function stop() {
		if ((phase !== 'capturing' && phase !== 'paused') || !take) return;
		phase = 'stopping';
		clearInterval(ticker);
		const stopped = await take.stop();
		take = null;
		paused = null;
		capturedFor = capturedBefore = 0;
		notice = null;
		phase = 'idle';
		onStopped(stopped);
	}

	const deviceOptions = (devices: MediaDeviceInfo[], fallback: string) =>
		devices.map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));

	/** The Camera picker's choices: each camera, and Off. A take keeps the camera on or off as it started. */
	const cameraOptions = $derived.by(() => {
		const cameras = deviceOptions(lists.cameras, 'Camera');
		if (devicesState !== 'on') return cameras;
		if (paused) return hasCamera ? cameras : [{ value: cameraOffOption, label: 'Camera off' }];
		const on = cameras.length > 0 || hasCamera ? cameras : [{ value: cameraOnOption, label: 'Turn camera on' }];
		return [...on, { value: cameraOffOption, label: 'Camera off (audio only)' }];
	});
</script>

<svelte:window {onkeydown} />

<div class="record">
	<div class="stage" class:live={devicesState === 'on' && hasCamera}>
		<video bind:this={preview} muted playsinline data-testid="preview"></video>
		{#if devicesState === 'opening' || devicesState === 'off'}
			<p class="placeholder">{prefs.cameraOff ? 'Starting microphone…' : 'Starting camera…'}</p>
		{:else if devicesState === 'on' && !hasCamera}
			<p class="placeholder" data-testid="camera-off">Camera off · recording audio only</p>
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
		{:else if paused}
			<span class="rec">PAUSED</span>
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
		{#key showPickerKey}
			<PillSelect
				label="Show"
				icon="show"
				options={[{ value: '', label: 'No show' }, ...shows.map((s) => ({ value: s.id, label: s.name })), { value: newShowOption, label: 'New show…' }]}
				value={nextShowId ?? ''}
				disabled={phase !== 'idle' || inTake}
				onchange={chooseShow}
			/>
		{/key}
		<PillSelect
			label="Camera"
			icon="camera"
			options={cameraOptions}
			value={hasCamera ? cameraId : cameraOffOption}
			disabled={devicesState !== 'on' || !choosingDevices || (paused !== null && !hasCamera)}
			onchange={chooseCamera}
		/>
		<PillSelect
			label="Microphone"
			icon="mic"
			options={deviceOptions(lists.mics, 'Microphone')}
			value={micId}
			disabled={devicesState !== 'on' || !choosingDevices}
			onchange={chooseMic}
		/>
		<PillToggle
			pressed={cleanUpAudio}
			disabled={devicesState !== 'on' || !choosingDevices}
			title="Echo cancellation, noise suppression and automatic gain, as in video calls. Best left off with a good mic in a quiet room."
			onchange={setCleanUpAudio}
		>
			Clean up audio
		</PillToggle>
	</div>

	{#if devicesState === 'on'}
		<LevelMeter {reading} warn={phase === 'countdown'} />
	{/if}

	{#if paused}
		<div class="paused-alert" role="alert" data-testid="paused-alert">
			<p class="paused-title">{paused.message}</p>
			<p>Choose a camera and microphone, then Resume to carry on in the same take, or Stop to finish it.</p>
		</div>
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
			<p class="hint">Recording {paused ? 'resumes' : 'starts'} in {countdown}… Press Esc to cancel</p>
		{:else if paused}
			<div class="paused-actions">
				<button class="big" onclick={startCountdown} disabled={phase !== 'paused' || devicesState !== 'on'}>
					<span class="dot"></span>Resume
				</button>
				<button class="big" onclick={stop} disabled={phase !== 'paused'}><span class="square"></span>Stop</button>
			</div>
			<p class="elapsed figures" data-testid="elapsed">
				<span class="time">{formatDuration(elapsedMs * 1000)}</span>
				<span class="saved">Paused · {(writtenBytes / 1e6).toFixed(0)} MB saved</span>
			</p>
		{:else}
			<button class="big" onclick={startCountdown} disabled={phase === 'starting' || devicesState !== 'on' || tooLittleRoom}>
				<span class="dot"></span>Record
			</button>
			<p class="hint">Press Space to start · 3-2-1 countdown</p>
		{/if}
	</div>

	{#if stoppedForSpace && !inTake}
		<p class="error" role="alert" data-testid="storage-stopped">
			Recording stopped: this computer ran out of room for recordings. The take is kept{stoppedForSpace === 'write'
				? ', up to the last few seconds. If it can’t be finished, free up space and try again from Takes.'
				: '.'}
		</p>
	{/if}

	{#if tooLittleRoom && timeLeft !== null}
		<div class="error" role="alert" data-testid="storage-problem">
			<p>
				Not enough room to record: {formatTimeLeft(timeLeft)} left, and a take needs at least
				{minimumSecondsToStart / 60} minutes.
			</p>
			<p>
				Download the takes you want to keep and delete them in <button class="link" onclick={onShowTakes}>Takes</button>, or free
				up space on this computer.
			</p>
		</div>
	{/if}

	{#if spaceWarning !== null && timeLeft !== null}
		<p class="notice urgent" role="alert" data-testid="storage-warning" data-threshold={spaceWarning / 60}>
			Room for {formatTimeLeft(timeLeft)} more. The take stops by itself, and is kept, when this computer runs out of room.
		</p>
	{/if}

	{#if notice}
		<p class="notice" data-testid="resolution-notice">{notice}</p>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<ShowNameDialog bind:this={showNameDialog} {shows} />

	{#if lastTake && !inTake}
		<section class="last" aria-label="Last take">
			<div class="last-head">
				<h2>Last take</h2>
				<button class="link" onclick={onShowTakes}>All takes</button>
			</div>
			<ul><TakeRow session={lastTake} {progress} {persistence} {shows} onChanged={onTakeChanged} onRetry={() => onRetry(lastTake)} onEdit={() => onEdit(lastTake)} /></ul>
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
	.paused-alert {
		width: 100%;
		display: grid;
		gap: 4px;
		padding: 12px 16px;
		border: 1px solid var(--problem-fg);
		border-radius: var(--radius-panel);
		background: var(--problem-bg);
		color: var(--problem-fg);
	}
	.paused-title {
		font-weight: 600;
		font-size: 16px;
	}
	.paused-actions {
		display: flex;
		gap: 10px;
	}
	.notice {
		padding: 8px 12px;
		border-radius: var(--radius-panel);
		background: var(--working-bg);
		color: var(--working-fg);
		font-size: var(--text-small);
	}
	.notice.urgent {
		border: 1px solid var(--working-edge);
		font-weight: 600;
	}
	.error {
		display: grid;
		gap: 4px;
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
