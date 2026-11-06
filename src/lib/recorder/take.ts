// Capturing one take: MediaRecorder hands each chunk (every few seconds) to the
// chunk-writer worker, which writes it to the Segment's raw file in OPFS. No
// chunk is kept in memory here. A device dropping out or the computer sleeping
// closes the Segment and pauses the take; resuming starts a new Segment.

import { warnBeforeLeaving } from '../browser/leave-warning.ts';
import { audioBitsPerSecond, videoBitsPerSecond } from '../media/capture.ts';
import { chooseMimeType, codecsFromMimeType } from '../media/formats.ts';
import type { ChunkWriterRequest, ChunkWriterResponse } from '../storage/chunk-writer.protocol.ts';
import { removeFile } from '../storage/opfs.ts';
import {
	newSession,
	nextSegment,
	nextTakeTitle,
	updateRecording,
	updateSegment,
	type AudioSettings,
	type RecordingState,
	type Segment,
	type Session,
	type VideoSettings
} from '../storage/session-file.ts';
import { holdRecording } from '../storage/recording-lock.ts';
import { changeSession, createSession, listSessions } from '../storage/sessions.ts';
import { watchForSleep } from './sleep.ts';
import { holdWakeLock } from './wake-lock.ts';

export const timesliceMs = 2000;

/** Why a take paused: a camera or mic track ended, or the computer slept. */
export interface Pause {
	reason: 'device' | 'sleep';
	/** The devices whose track had ended when the Segment closed. */
	ended: ('camera' | 'mic')[];
}

export interface Take {
	readonly session: Session;
	/** Starts a new Segment of a Paused take, from this stream. */
	resume(stream: MediaStream, preview?: HTMLVideoElement): Promise<void>;
	/** Stops capturing (or ends a pause) and moves the Recording to Finalizing. */
	stop(): Promise<Session>;
}

export interface TakeOptions {
	stream: MediaStream;
	/** A playing preview of the stream; counts camera frames where `track.stats` is missing (Firefox). */
	preview?: HTMLVideoElement;
	/** Bytes written so far, across all Segments. */
	onWritten?: (bytes: number) => void;
	/** Writing to disk failed; capture has stopped. */
	onError?: (message: string) => void;
	/** The Segment has closed and the Recording is Paused. */
	onPaused?: (pause: Pause) => void;
	/** The Show the take is for; null for none. */
	showId?: string | null;
}

type VideoTrackWithStats = MediaStreamTrack & { stats?: { deliveredFrames: number } };

function recorderFor(stream: MediaStream, mimeType: string): MediaRecorder {
	const videoTrack = stream.getVideoTracks()[0];
	// The bitrate follows the resolution the camera actually delivers.
	const height = videoTrack?.getSettings().height ?? 0;
	return new MediaRecorder(stream, {
		...(mimeType ? { mimeType } : {}),
		...(videoTrack ? { videoBitsPerSecond: videoBitsPerSecond(height) } : {}),
		audioBitsPerSecond
	});
}

export async function startTake({ stream, preview, onWritten, onError, onPaused, showId = null }: TakeOptions): Promise<Take> {
	const mimeType = chooseMimeType((type) => MediaRecorder.isTypeSupported(type));
	const videoTrack = stream.getVideoTracks()[0];
	const audioTrack = stream.getAudioTracks()[0];
	const recorder = recorderFor(stream, mimeType);
	const codecs = codecsFromMimeType(recorder.mimeType || mimeType);

	let session = newSession({
		now: new Date(),
		title: nextTakeTitle((await listSessions()).map((s) => s.title)),
		showId,
		video: videoTrack ? videoSettings(videoTrack, codecs.video, recorder) : null,
		audio: audioSettings(audioTrack, codecs.audio, recorder)
	});
	const recording = session.recordings[0]!;
	// Held until stop, through any pause, so a launch in another tab doesn't take this Recording for a crashed one.
	const release = await holdRecording(session.id, recording.id);
	const releaseWakeLock = holdWakeLock();
	const stopWarning = warnBeforeLeaving();
	await createSession(session);

	// The Session's timeline runs on the wall clock, which keeps counting while the computer sleeps.
	const startedAtMs = Date.now();
	let state: 'capturing' | 'paused' | 'stopped' = 'capturing';
	let writtenBefore = 0;
	// The Segment closing for a pause, which resume and stop wait for.
	let pausing: Promise<void> = Promise.resolve();

	const capture = (recorder: MediaRecorder, stream: MediaStream, preview: HTMLVideoElement | undefined, segment: Segment) =>
		captureSegment({
			recorder,
			stream,
			preview,
			segment,
			header: { sessionId: session.id, recordingId: recording.id, mimeType: recorder.mimeType || mimeType },
			onWritten: (bytes) => onWritten?.(writtenBefore + bytes),
			onError,
			onPause: pause
		});
	let current = capture(recorder, stream, preview, recording.segments[0]!);

	/** Closes the current Segment and records what the camera delivered; an empty later Segment is dropped. */
	async function closeSegment(closingState: RecordingState) {
		const { segment } = current;
		const { delivered, chunks, bytes } = await current.close(closingState);
		writtenBefore += bytes;
		if (chunks === 0 && segment.index > 1) {
			session = await changeSession(session.id, (s) =>
				updateRecording(s, recording.id, (r) => ({ ...r, segments: r.segments.filter((seg) => seg.index !== segment.index) }))
			);
			await removeFile(segment.rawPath!).catch(() => {});
			await removeFile(segment.manifestPath!).catch(() => {});
			return;
		}
		session = await changeSession(session.id, (s) =>
			updateRecording(s, recording.id, (r) =>
				updateSegment(r, segment.index, (seg) => ({ ...seg, frames: delivered === null ? null : { delivered, inFile: null } }))
			)
		);
	}

	function pause(reason: Pause['reason']) {
		if (state !== 'capturing') return;
		state = 'paused';
		const tracks = current.stream.getTracks();
		pausing = (async () => {
			await closeSegment('paused');
			session = await changeSession(session.id, (s) => updateRecording(s, recording.id, (r) => ({ ...r, state: 'paused' })));
			const ended = tracks.filter((t) => t.readyState === 'ended').map((t): Pause['ended'][number] => (t.kind === 'video' ? 'camera' : 'mic'));
			onPaused?.({ reason, ended });
		})();
	}

	return {
		get session() {
			return session;
		},
		async resume(stream, preview) {
			await pausing;
			if (state !== 'paused') return;
			const segment = nextSegment(session.id, session.recordings[0]!, (Date.now() - startedAtMs) * 1000);
			session = await changeSession(session.id, (s) =>
				updateRecording(s, recording.id, (r) => ({ ...r, state: 'capturing', segments: [...r.segments, segment] }))
			);
			state = 'capturing';
			current = capture(recorderFor(stream, mimeType), stream, preview, segment);
		},
		async stop() {
			await pausing;
			if (state === 'stopped') return session;
			const wasCapturing = state === 'capturing';
			state = 'stopped';
			if (wasCapturing) await closeSegment('finalizing');
			session = await changeSession(session.id, (s) => updateRecording(s, recording.id, (r) => ({ ...r, state: 'finalizing' })));
			release();
			releaseWakeLock();
			stopWarning();
			return session;
		}
	};
}

interface SegmentOptions {
	recorder: MediaRecorder;
	stream: MediaStream;
	preview: HTMLVideoElement | undefined;
	segment: Segment;
	header: { sessionId: string; recordingId: string; mimeType: string };
	onWritten: (bytes: number) => void;
	onError?: (message: string) => void;
	onPause: (reason: Pause['reason']) => void;
}

/** Captures one Segment: its own recorder and chunk writer, watching for a track ending or the computer sleeping. */
function captureSegment({ recorder, stream, preview, segment, header, onWritten, onError, onPause }: SegmentOptions) {
	const worker = new Worker(new URL('../storage/chunk-writer.worker.ts', import.meta.url), { type: 'module' });
	const send = (request: ChunkWriterRequest) => worker.postMessage(request);
	let closed: (written: { chunks: number; bytes: number }) => void;
	const workerClosed = new Promise<{ chunks: number; bytes: number }>((resolve) => (closed = resolve));
	let failure: string | null = null;
	let bytes = 0;
	worker.onmessage = (event: MessageEvent<ChunkWriterResponse>) => {
		const message = event.data;
		if (message.type === 'written') onWritten((bytes = message.bytes));
		else if (message.type === 'closed') closed(message);
		else {
			failure = message.message;
			// Whatever was written stays; the Segment is kept for Finalizing.
			closed({ chunks: -1, bytes });
			if (recorder.state !== 'inactive') recorder.stop();
			onError?.(message.message);
		}
	};

	const started = performance.now();
	send({
		type: 'open',
		startedAtMs: performance.timeOrigin + started,
		rawPath: segment.rawPath!,
		manifestPath: segment.manifestPath!,
		header: {
			kind: 'header',
			version: 1,
			sessionId: header.sessionId,
			recordingId: header.recordingId,
			segmentIndex: segment.index,
			mimeType: header.mimeType,
			startedAt: new Date().toISOString()
		}
	});

	const frames = countFrames(stream.getVideoTracks()[0] as VideoTrackWithStats | undefined, preview);
	const sinceStartUs = () => Math.round((performance.now() - started) * 1000);
	const sleep = watchForSleep();
	// MediaRecorder's own events, not page timers, drive chunk writing, so a background tab loses nothing.
	recorder.ondataavailable = (event) => {
		send({ type: 'chunk', data: event.data, timestampUs: sinceStartUs() });
		if (sleep.chunk()) onPause('sleep');
	};
	const ticking = setInterval(() => sleep.tick() && onPause('sleep'), 1000);
	const tracks = stream.getTracks();
	const onEnded = () => onPause('device');
	for (const track of tracks) track.addEventListener('ended', onEnded);
	const recorderStopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
	recorder.start(timesliceMs);

	return {
		segment,
		stream,
		/** Stops the recorder and closes the Segment's files; returns what was captured. */
		async close(state: RecordingState): Promise<{ delivered: number | null; chunks: number; bytes: number }> {
			clearInterval(ticking);
			for (const track of tracks) track.removeEventListener('ended', onEnded);
			if (recorder.state !== 'inactive') recorder.stop();
			await recorderStopped;
			const delivered = frames.stop();
			if (!failure) send({ type: 'close', state });
			const written = await workerClosed;
			worker.terminate();
			return { delivered, ...written };
		}
	};
}

/** Counts frames the camera delivers from now until `stop()`. */
function countFrames(track: VideoTrackWithStats | undefined, preview: HTMLVideoElement | undefined) {
	if (!track) return { stop: () => null };
	if (track.stats) {
		const start = track.stats.deliveredFrames;
		return { stop: () => track.stats!.deliveredFrames - start };
	}
	if (!preview || !('requestVideoFrameCallback' in preview)) return { stop: () => null };
	let count = 0;
	let counting = true;
	// A hidden tab draws no frames, so the preview's count means nothing once the tab has been hidden.
	let wasHidden = document.visibilityState === 'hidden';
	const onVisibility = () => (wasHidden ||= document.visibilityState === 'hidden');
	document.addEventListener('visibilitychange', onVisibility);
	const onFrame = () => {
		if (!counting) return;
		count++;
		preview.requestVideoFrameCallback(onFrame);
	};
	preview.requestVideoFrameCallback(onFrame);
	return {
		stop: () => {
			counting = false;
			document.removeEventListener('visibilitychange', onVisibility);
			return wasHidden ? null : count;
		}
	};
}

function videoSettings(track: MediaStreamTrack, codec: string | null, recorder: MediaRecorder): VideoSettings {
	const settings = track.getSettings();
	return {
		codec: codec ?? 'unknown',
		width: settings.width ?? 0,
		height: settings.height ?? 0,
		fps: settings.frameRate ?? 0,
		bitrate: recorder.videoBitsPerSecond || null
	};
}

function audioSettings(track: MediaStreamTrack | undefined, codec: string | null, recorder: MediaRecorder): AudioSettings {
	const settings = track?.getSettings() ?? {};
	return {
		codec: codec ?? 'unknown',
		channels: settings.channelCount ?? 1,
		sampleRate: settings.sampleRate ?? null,
		bitrate: recorder.audioBitsPerSecond || null,
		processing: !!(settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl)
	};
}
