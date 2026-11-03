// Capturing one take: MediaRecorder hands each chunk (every few seconds) to the
// chunk-writer worker, which writes it to the Segment's raw file in OPFS. No
// chunk is kept in memory here.

import { chooseMimeType, codecsFromMimeType } from '../media/formats.ts';
import type { ChunkWriterRequest, ChunkWriterResponse } from '../storage/chunk-writer.protocol.ts';
import { newSession, updateRecording, updateSegment, type AudioSettings, type Session, type VideoSettings } from '../storage/session-file.ts';
import { changeSession, createSession } from '../storage/sessions.ts';

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
}

type VideoTrackWithStats = MediaStreamTrack & { stats?: { deliveredFrames: number } };

export async function startTake({ stream, preview, onWritten, onError }: TakeOptions): Promise<Take> {
	const mimeType = chooseMimeType((type) => MediaRecorder.isTypeSupported(type));
	const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
	const videoTrack = stream.getVideoTracks()[0] as VideoTrackWithStats | undefined;
	const audioTrack = stream.getAudioTracks()[0];
	const codecs = codecsFromMimeType(recorder.mimeType || mimeType);

	let session = newSession({
		now: new Date(),
		video: videoTrack ? videoSettings(videoTrack, codecs.video, recorder) : null,
		audio: audioSettings(audioTrack, codecs.audio, recorder)
	});
	await createSession(session);
	const recording = session.recordings[0]!;
	const segment = recording.segments[0]!;

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

	send({
		type: 'open',
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
	const started = performance.now();
	recorder.ondataavailable = (event) => {
		send({ type: 'chunk', data: event.data, timestampUs: Math.round((performance.now() - started) * 1000) });
	};
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
	const onFrame = () => {
		if (!counting) return;
		count++;
		preview.requestVideoFrameCallback(onFrame);
	};
	preview.requestVideoFrameCallback(onFrame);
	return {
		stop: () => {
			counting = false;
			return count;
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
