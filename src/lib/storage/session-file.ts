// The Session file: one JSON document per Session, following the Handoff
// brief's data model. Pure functions only; reading and writing live in
// sessions.ts.

export type RecordingState = 'capturing' | 'paused' | 'finalizing' | 'ready' | 'interrupted';

export interface VideoSettings {
	codec: string;
	width: number;
	height: number;
	fps: number;
	bitrate: number | null;
}

export interface AudioSettings {
	codec: string;
	channels: number;
	sampleRate: number | null;
	bitrate: number | null;
	processing: boolean;
}

export interface FrameCounts {
	/** Frames the camera delivered during the Segment, when the browser can tell. */
	delivered: number | null;
	/** Frames in the finished file; null until Finalizing succeeds. */
	inFile: number | null;
}

export interface Segment {
	index: number;
	/** The finished file; null until Finalizing succeeds. */
	path: string | null;
	/** The raw file being captured; null once it has been deleted after Finalizing. */
	rawPath: string | null;
	manifestPath: string | null;
	startUs: number;
	durationUs: number | null;
	downloaded: boolean;
	frames: FrameCounts | null;
}

export interface Recording {
	id: string;
	participant: { id: string; role: 'host' | 'guest' };
	state: RecordingState;
	clockOffsetUs: number;
	video: VideoSettings | null;
	audio: AudioSettings;
	segments: Segment[];
	/** Why Finalizing failed, if it did; the raw file is kept. */
	finalizeError?: string;
}

export interface Session {
	version: 1;
	id: string;
	title: string;
	createdAt: string;
	recordings: Recording[];
}

export const sessionsDir = 'sessions';

export function sessionFilePath(sessionId: string): string {
	return `${sessionsDir}/${sessionId}/session.json`;
}

export function segmentPaths(sessionId: string, recordingId: string, index: number) {
	const base = `${sessionsDir}/${sessionId}/${recordingId}/seg-${String(index).padStart(2, '0')}`;
	return { raw: `${base}.raw`, manifest: `${base}.manifest.jsonl`, finishedBase: base };
}

export function newId(prefix: string, now: Date, random: () => number = Math.random): string {
	const suffix = Math.floor(random() * 36 ** 4)
		.toString(36)
		.padStart(4, '0');
	// Fixed width so ids sort by time.
	return `${prefix}_${now.getTime().toString(36).padStart(9, '0')}${suffix}`;
}

export function defaultTitle(now: Date): string {
	const when = now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	return `Take – ${when}`;
}

/** A new Session holding one host Recording with its first Segment, in Capturing. */
export function newSession(options: {
	now: Date;
	random?: () => number;
	video: VideoSettings | null;
	audio: AudioSettings;
}): Session {
	const { now, random = Math.random, video, audio } = options;
	const id = newId('ses', now, random);
	const recordingId = 'rec_01';
	const paths = segmentPaths(id, recordingId, 1);
	return {
		version: 1,
		id,
		title: defaultTitle(now),
		createdAt: now.toISOString(),
		recordings: [
			{
				id: recordingId,
				participant: { id: 'par_host', role: 'host' },
				state: 'capturing',
				clockOffsetUs: 0,
				video,
				audio,
				segments: [
					{
						index: 1,
						path: null,
						rawPath: paths.raw,
						manifestPath: paths.manifest,
						startUs: 0,
						durationUs: null,
						downloaded: false,
						frames: null
					}
				]
			}
		]
	};
}

export function updateRecording(session: Session, recordingId: string, update: (recording: Recording) => Recording): Session {
	if (!session.recordings.some((r) => r.id === recordingId)) throw new Error(`No Recording ${recordingId} in ${session.id}`);
	return { ...session, recordings: session.recordings.map((r) => (r.id === recordingId ? update(r) : r)) };
}

export function updateSegment(recording: Recording, index: number, update: (segment: Segment) => Segment): Recording {
	if (!recording.segments.some((s) => s.index === index)) throw new Error(`No Segment ${index} in ${recording.id}`);
	return { ...recording, segments: recording.segments.map((s) => (s.index === index ? update(s) : s)) };
}

const stateOrder: RecordingState[] = ['interrupted', 'paused', 'capturing', 'finalizing', 'ready'];

/** A Session is Ready only when all its Recordings are; otherwise it shows its least advanced Recording's state. */
export function sessionState(session: Session): RecordingState {
	return session.recordings.reduce<RecordingState>(
		(least, r) => (stateOrder.indexOf(r.state) < stateOrder.indexOf(least) ? r.state : least),
		'ready'
	);
}

/** Length of a Recording on the Session timeline, once its Segments have durations. */
export function recordingDurationUs(recording: Recording): number | null {
	const last = recording.segments.at(-1);
	if (!last || last.durationUs === null) return null;
	return last.startUs + last.durationUs;
}
