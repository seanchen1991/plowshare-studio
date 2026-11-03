// Spike 03 local run: one real take, written to OPFS as it records, then
// finalized with Mediabunny (forced copy) and checked for dropped frames.
// Open with `pnpm dev` at /spikes/03-recording/local.html.

import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	EncodedPacketSink,
	Input,
	MkvOutputFormat,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	WebMOutputFormat
} from 'mediabunny';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const formats = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];
const timesliceMs = 2000;
const videoBitsPerSecond = 6_000_000;
const audioBitsPerSecond = 160_000;

const report: Record<string, unknown> = {};

function show() {
	el('report').textContent = JSON.stringify(report, null, 2);
}

function formatTime(seconds: number) {
	const m = Math.floor(seconds / 60);
	return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

async function spikeDir() {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle('spike-03', { create: true });
}

// 1. Browser and hardware encoding

el('hw').onclick = async () => {
	const uaData = (navigator as unknown as { userAgentData?: { getHighEntropyValues(k: string[]): Promise<unknown> } }).userAgentData;
	report.browser = {
		userAgent: navigator.userAgent,
		versions: uaData ? await uaData.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture']) : null,
		cores: navigator.hardwareConcurrency
	};

	const codecs = { 'H.264': 'avc1.640028', VP9: 'vp09.00.40.08', VP8: 'vp8', AV1: 'av01.0.08M.08' };
	const rows: Record<string, Record<string, string>> = {};
	for (const [name, codec] of Object.entries(codecs)) {
		rows[name] = {};
		for (const accel of ['prefer-hardware', 'prefer-software'] as const) {
			if (!('VideoEncoder' in window)) {
				rows[name][accel] = 'no WebCodecs';
				continue;
			}
			try {
				const { supported } = await VideoEncoder.isConfigSupported({
					codec,
					width: 1920,
					height: 1080,
					bitrate: videoBitsPerSecond,
					framerate: 30,
					hardwareAcceleration: accel
				});
				rows[name][accel] = supported ? 'yes' : 'no';
			} catch (error) {
				rows[name][accel] = `error: ${String(error).slice(0, 40)}`;
			}
		}
	}
	report.webCodecsEncoders1080p = rows;
	report.mediaRecorderSupport = Object.fromEntries(formats.map((f) => [f, MediaRecorder.isTypeSupported(f)]));

	el('hwOut').innerHTML =
		'<table><tr><th>Codec</th><th>Hardware</th><th>Software</th></tr>' +
		Object.entries(rows)
			.map(([name, r]) => `<tr><td>${name}</td><td>${r['prefer-hardware']}</td><td>${r['prefer-software']}</td></tr>`)
			.join('') +
		'</table>';
	show();
};

// 2. Devices

el('allow').onclick = async () => {
	const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
	probe.getTracks().forEach((t) => t.stop());
	const devices = await navigator.mediaDevices.enumerateDevices();
	for (const [select, kind] of [
		[el<HTMLSelectElement>('cam'), 'videoinput'],
		[el<HTMLSelectElement>('mic'), 'audioinput']
	] as const) {
		select.innerHTML = devices
			.filter((d) => d.kind === kind)
			.map((d) => `<option value="${d.deviceId}">${d.label || d.deviceId}</option>`)
			.join('');
	}
	el<HTMLSelectElement>('format').innerHTML = formats
		.filter((f) => MediaRecorder.isTypeSupported(f))
		.map((f) => `<option>${f}</option>`)
		.join('');
	el<HTMLButtonElement>('start').disabled = false;

	const { quota = 0, usage = 0 } = await navigator.storage.estimate();
	el('space').textContent = `Storage available to this site: ${((quota - usage) / 1e9).toFixed(1)} GB. A 60-minute take needs about 5.4 GB (raw plus finished copy).`;
};

// 3. Record, finalize, analyze

el('start').onclick = async () => {
	el<HTMLButtonElement>('start').disabled = true;
	const minutes = Number(el<HTMLSelectElement>('minutes').value);
	const mimeType = el<HTMLSelectElement>('format').value;

	const stream = await navigator.mediaDevices.getUserMedia({
		video: {
			deviceId: { exact: el<HTMLSelectElement>('cam').value },
			width: { ideal: 1920 },
			height: { ideal: 1080 },
			frameRate: { ideal: 30 }
		},
		audio: {
			deviceId: { exact: el<HTMLSelectElement>('mic').value },
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			channelCount: 1,
			sampleRate: 48000
		}
	});
	const preview = el<HTMLVideoElement>('preview');
	preview.srcObject = stream;
	void preview.play();
	const videoTrack = stream.getVideoTracks()[0]!;
	const settings = stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, ...t.getSettings() }));

	const dir = await spikeDir();
	const rawHandle = await dir.getFileHandle('raw.webm', { create: true });
	const writable = await rawHandle.createWritable();
	let writing: Promise<void> = Promise.resolve();
	let bytes = 0;
	let chunks = 0;

	const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond });
	recorder.ondataavailable = (e) => {
		bytes += e.data.size;
		chunks++;
		writing = writing.then(() => writable.write(e.data));
	};
	const stopped = new Promise<void>((done) => (recorder.onstop = () => done()));
	let recorderError: string | null = null;
	recorder.onerror = (e) => (recorderError = String((e as ErrorEvent).error ?? e));

	const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
	const heap: number[] = [];
	const started = performance.now();
	recorder.start(timesliceMs);

	const tick = setInterval(() => {
		const elapsed = (performance.now() - started) / 1000;
		el('elapsed').textContent = `${formatTime(elapsed)} / ${minutes}:00 · ${(bytes / 1e6).toFixed(0)} MB`;
		const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
		if (memory && Math.floor(elapsed) % 30 === 0) heap.push(Math.round(memory.usedJSHeapSize / 1e6));
	}, 1000);
	const autoStop = setTimeout(() => recorder.state === 'recording' && recorder.stop(), minutes * 60_000);
	el<HTMLButtonElement>('stop').disabled = false;
	el<HTMLButtonElement>('stop').onclick = () => recorder.state === 'recording' && recorder.stop();

	await stopped;
	const recordedSeconds = (performance.now() - started) / 1000;
	const trackStats = (videoTrack as unknown as { stats?: Record<string, number> }).stats;
	const videoStats = trackStats
		? { deliveredFrames: trackStats.deliveredFrames, discardedFrames: trackStats.discardedFrames, totalFrames: trackStats.totalFrames }
		: null;
	clearInterval(tick);
	clearTimeout(autoStop);
	el<HTMLButtonElement>('stop').disabled = true;
	stream.getTracks().forEach((t) => t.stop());
	await wakeLock?.release();
	await writing;
	await writable.close();

	el('status').textContent = 'Finalizing…';
	const rawFile = await rawHandle.getFile();
	const finalizeStarted = performance.now();
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(rawFile) });
	const inputFormat = (await input.getFormat()).name;
	// Chrome writes H.264 as Matroska, which WebM can't hold; keep the same container family, or remux to MP4.
	const finishAs = el<HTMLSelectElement>('finishAs').value;
	const [outputFormat, extension] =
		finishAs === 'mp4'
			? [new Mp4OutputFormat(), 'mp4']
			: /webm/i.test(inputFormat)
				? [new WebMOutputFormat(), 'webm']
				: [new MkvOutputFormat(), 'mkv'];
	const finishedHandle = await dir.getFileHandle(`finished.${extension}`, { create: true });
	const finishedWritable = await finishedHandle.createWritable();
	const output = new Output({ format: outputFormat, target: new StreamTarget(finishedWritable, { chunked: true }) });
	const conversion = await Conversion.init({ input, output, showWarnings: false, copy: { mode: 'forced' } });
	conversion.onProgress = (p) => (el('status').textContent = `Finalizing… ${Math.round(p * 100)}%`);
	const discardedTracks = conversion.discardedTracks.map((d) => `${d.track.type}:${d.reason}`);
	if (conversion.isValid && discardedTracks.length === 0) await conversion.execute();
	await finishedWritable.close().catch(() => {});
	const finalizeMs = Math.round(performance.now() - finalizeStarted);
	input.dispose();
	if (discardedTracks.length > 0) {
		report.finalize = { ok: false, inputFormat, finishAs: extension, discardedTracks };
		el('status').textContent = `Finalizing FAILED: dropped ${discardedTracks.join(', ')}. Copy the report and paste it back.`;
		el<HTMLButtonElement>('copy').disabled = false;
		el<HTMLButtonElement>('start').disabled = false;
		show();
		return;
	}

	el('status').textContent = 'Checking frames…';
	const finishedFile = await finishedHandle.getFile();
	const check = new Input({ formats: ALL_FORMATS, source: new BlobSource(finishedFile) });
	const duration = await check.computeDuration();
	const track = await check.getPrimaryVideoTrack();
	const fps = (settings.find((s) => s.kind === 'video') as { frameRate?: number }).frameRate ?? 30;
	const interval = 1 / fps;
	let frames = 0;
	let gaps = 0;
	let missingFrames = 0;
	let maxGapMs = 0;
	let previous: number | null = null;
	if (track) {
		for await (const packet of new EncodedPacketSink(track).packets()) {
			frames++;
			if (previous !== null) {
				const gap = packet.timestamp - previous;
				maxGapMs = Math.max(maxGapMs, gap * 1000);
				if (gap > 1.5 * interval) {
					gaps++;
					missingFrames += Math.round(gap / interval) - 1;
				}
			}
			previous = packet.timestamp;
		}
	}
	check.dispose();

	report.take = {
		mimeType,
		actualMimeType: recorder.mimeType,
		recorderError,
		minutesRequested: minutes,
		recordedSeconds: Math.round(recordedSeconds),
		settings,
		chunks,
		rawMB: Math.round(rawFile.size / 1e6),
		averageMbps: Number(((rawFile.size * 8) / recordedSeconds / 1e6).toFixed(2)),
		heapMBEvery30s: heap
	};
	report.finalize = {
		ok: true,
		inputFormat,
		finishAs: extension,
		ms: finalizeMs,
		mbPerSecond: Number((rawFile.size / 1e6 / (finalizeMs / 1000)).toFixed(1)),
		finishedMB: Math.round(finishedFile.size / 1e6),
		durationSeconds: Number(duration.toFixed(2))
	};
	report.frames = {
		captureFps: fps,
		expected: Math.round(duration * fps),
		inFile: frames,
		gapsOverOneAndHalfFrames: gaps,
		missingFrames,
		missingPercent: Number(((missingFrames / Math.max(1, frames + missingFrames)) * 100).toFixed(3)),
		maxGapMs: Math.round(maxGapMs),
		trackStats: videoStats
	};

	const finished = el<HTMLVideoElement>('finished');
	report.playback = await new Promise((done) => {
		const timer = setTimeout(() => done({ playable: false, error: 'no metadata after 15 s' }), 15_000);
		finished.onloadedmetadata = () => {
			clearTimeout(timer);
			done({ playable: true, duration: Number(finished.duration.toFixed(2)), width: finished.videoWidth, height: finished.videoHeight });
		};
		finished.onerror = () => {
			clearTimeout(timer);
			done({ playable: false, error: finished.error?.message || `media error ${finished.error?.code}` });
		};
		finished.src = URL.createObjectURL(finishedFile);
	});
	el('status').textContent = `Done: ${formatTime(duration)} finalized in ${(finalizeMs / 1000).toFixed(1)} s, ${missingFrames} frames missing.`;
	el<HTMLButtonElement>('copy').disabled = false;
	el<HTMLButtonElement>('start').disabled = false;
	show();
};

el('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(report, null, 2));

el('cleanup').onclick = async () => {
	const root = await navigator.storage.getDirectory();
	await root.removeEntry('spike-03', { recursive: true }).catch(() => {});
	el('status').textContent = 'Spike files deleted.';
};
