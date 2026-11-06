// Capturing one take: MediaRecorder hands each chunk (every few seconds) to the
// chunk-writer worker, which writes it to the Segment's raw file in OPFS. No
// chunk is kept in memory here.

import { warnBeforeLeaving } from '../browser/leave-warning.ts';
import { audioBitsPerSecond, videoBitsPerSecond } from '../media/capture.ts';
import { chooseMimeType, codecsFromMimeType } from '../media/formats.ts';
import type { ChunkWriterRequest, ChunkWriterResponse } from '../storage/chunk-writer.protocol.ts';
import { newSession, nextTakeTitle, updateRecording, updateSegment, type AudioSettings, type Session, type VideoSettings } from '../storage/session-file.ts';
import { holdRecording } from '../storage/recording-lock.ts';
import { changeSession, createSession, listSessions } from '../storage/sessions.ts';
import { holdWakeLock } from './wake-lock.ts';

export const timesliceMs = 2000;

export interface Take {
	session: Session;
	/** Stops capturing and moves the Recording to Finalizing. */
	stop(): Promise<Session>;
}

export interface TakeOptions {
	stream: MediaStream;
	/** A playing preview of the stream; counts camera frames where `track.stats` is missing (Firefox). */
	preview?: HTMLVideoElement;
	onWritten?: (bytes: number) => void;
	/** Writing to disk failed; capture has stopped. */
	onError?: (message: string) => void;
	/** The Show the take is for; null for none. */
	showId?: string | null;
}

type VideoTrackWithStats = MediaStreamTrack & { stats?: { deliveredFrames: number } };

export async function startTake({ stream, preview, onWritten, onError, showId = null }: TakeOptions): Promise<Take> {
	const mimeType = chooseMimeType((type) => MediaRecorder.isTypeSupported(type));
	const videoTrack = stream.getVideoTracks()[0] as VideoTrackWithStats | undefined;
	const audioTrack = stream.getAudioTracks()[0];
	// The bitrate follows the resolution the camera actually delivers.
	const height = videoTrack?.getSettings().height ?? 0;
	const recorder = new MediaRecorder(stream, {
		...(mimeType ? { mimeType } : {}),
		...(videoTrack ? { videoBitsPerSecond: videoBitsPerSecond(height) } : {}),
		audioBitsPerSecond
	});
	const codecs = codecsFromMimeType(recorder.mimeType || mimeType);

	let session = newSession({
		now: new Date(),
		title: nextTakeTitle((await listSessions()).map((s) => s.title)),
		showId,
		video: videoTrack ? videoSettings(videoTrack, codecs.video, recorder) : null,
		audio: audioSettings(audioTrack, codecs.audio, recorder)
	});
	const recording = session.recordings[0]!;
	const segment = recording.segments[0]!;
	// Held until stop, so a launch in another tab doesn't take this Recording for a crashed one.
	const release = await holdRecording(session.id, recording.id);
	const releaseWakeLock = holdWakeLock();
	const stopWarning = warnBeforeLeaving();
	await createSession(session);

	const worker = new Worker(new URL('../storage/chunk-writer.worker.ts', import.meta.url), { type: 'module' });
	const send = (request: ChunkWriterRequest) => worker.postMessage(request);
	let closed: (value: void) => void;
	const workerClosed = new Promise<void>((resolve) => (closed = resolve));
	let failure: string | null = null;
	worker.onmessage = (event: MessageEvent<ChunkWriterResponse>) => {
		const message = event.data;
		if (message.type === 'written') onWritten?.(message.bytes);
		else if (message.type === 'closed') closed();
		else {
			failure = message.message;
			closed();
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
			sessionId: session.id,
			recordingId: recording.id,
			segmentIndex: segment.index,
			mimeType: recorder.mimeType || mimeType,
			startedAt: new Date().toISOString()
		}
	});

	const frames = countFrames(videoTrack, preview);
	const sinceStartUs = () => Math.round((performance.now() - started) * 1000);
	// MediaRecorder's own events, not page timers, drive chunk writing, so a background tab loses nothing.
	recorder.ondataavailable = (event) => send({ type: 'chunk', data: event.data, timestampUs: sinceStartUs() });
	const recorderStopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
	recorder.start(timesliceMs);

	return {
		session,
		async stop() {
			if (recorder.state !== 'inactive') recorder.stop();
			await recorderStopped;
			const delivered = frames.stop();
			if (!failure) send({ type: 'close', state: 'finalizing' });
			await workerClosed;
			worker.terminate();
			session = await changeSession(session.id, (s) =>
				updateRecording(s, recording.id, (r) =>
					updateSegment({ ...r, state: 'finalizing' }, segment.index, (seg) => ({
						...seg,
						frames: delivered === null ? null : { delivered, inFile: null }
					}))
				)
			);
			release();
			releaseWakeLock();
			stopWarning();
			return session;
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
