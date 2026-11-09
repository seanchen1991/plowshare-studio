// Opening a recording from a file on disk: copies it into OPFS as a new Ready
// Session with one host Recording and one Segment, as it is if it's MP4 or
// WebM, otherwise remuxed. Copied, not linked, so moving the file later
// doesn't break the take. The Session file is written last, so a copy that
// fails partway never shows up as a take.

import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	Input,
	Mp4InputFormat,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	WebMInputFormat,
	WebMOutputFormat
} from 'mediabunny';
import { measureStorage } from './budget.ts';
import { planImport, roomForFileBytes, titleFromFileName } from './import-plan.ts';
import { fileHandle, removeDirectory, writeJson } from './opfs.ts';
import { newId, segmentPaths, sessionFilePath, sessionsDir, type Session } from './session-file.ts';

/** Why a file couldn't be opened, for the message the user sees. */
export type ImportProblem =
	| { kind: 'room'; neededBytes: number; roomBytes: number }
	| { kind: 'unreadable' }
	| { kind: 'no-audio' }
	| { kind: 'failed'; message: string };

export class ImportError extends Error {
	constructor(readonly problem: ImportProblem) {
		super(problem.kind);
	}
}

/** Copies `file` in as a new Ready take and returns its Session. Throws an ImportError if it can't. */
export async function importFile(file: File, now = new Date()): Promise<Session> {
	const roomBytes = roomForFileBytes(await measureStorage());
	if (file.size > roomBytes) throw new ImportError({ kind: 'room', neededBytes: file.size, roomBytes });

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const sessionId = newId('ses', now);
	try {
		const format = await input.getFormat().catch(() => null);
		const [video, audio] = format ? await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]) : [null, null];
		if (!format || (!video && !audio)) throw new ImportError({ kind: 'unreadable' });
		// Tracks the browser can't decode can't be shown or played.
		if ((video && !(await video.canDecode())) || (audio && !(await audio.canDecode()))) throw new ImportError({ kind: 'unreadable' });

		const container = format instanceof WebMInputFormat ? 'webm' : format instanceof Mp4InputFormat ? 'mp4' : 'other';
		const plan = planImport(container, video?.codec ?? null, audio?.codec ?? null);
		if (plan.kind === 'unsupported') throw new ImportError({ kind: plan.reason === 'no-audio' ? 'no-audio' : 'unreadable' });

		const recordingId = 'rec_01';
		const extension = plan.kind === 'copy' ? plan.extension : plan.container;
		const path = `${segmentPaths(sessionId, recordingId, 1).finishedBase}.${extension}`;
		const writable = await (await fileHandle(path, { create: true })).createWritable();
		if (plan.kind === 'copy') {
			await file.stream().pipeTo(writable);
		} else {
			const output = new Output({
				format: plan.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
				target: new StreamTarget(writable, { chunked: true })
			});
			const conversion = await Conversion.init({
				input,
				output,
				showWarnings: false,
				audio: plan.audioToOpus ? { codec: 'opus' } : undefined
			});
			if (!conversion.isValid || conversion.discardedTracks.some((d) => d.track === video || d.track === audio)) {
				await writable.abort().catch(() => {});
				throw new ImportError({ kind: 'unreadable' });
			}
			await conversion.execute();
		}

		const durationUs = Math.round((await input.computeDuration()) * 1e6);
		const session: Session = {
			version: 1,
			id: sessionId,
			title: titleFromFileName(file.name),
			createdAt: now.toISOString(),
			recordings: [
				{
					id: recordingId,
					participant: { id: 'par_host', role: 'host' },
					state: 'ready',
					clockOffsetUs: 0,
					video: video
						? {
								codec: video.codec ?? 'unknown',
								width: await video.getDisplayWidth(),
								height: await video.getDisplayHeight(),
								fps: Math.round((await video.computePacketStats(120)).averagePacketRate * 100) / 100,
								bitrate: null
							}
						: null,
					audio: {
						codec: plan.kind === 'remux' && plan.audioToOpus ? 'opus' : (audio!.codec ?? 'unknown'),
						channels: await audio!.getNumberOfChannels(),
						sampleRate: await audio!.getSampleRate(),
						bitrate: null,
						processing: false
					},
					// The file it came from is still on this computer, so the take counts as backed up.
					segments: [{ index: 1, path, rawPath: null, manifestPath: null, startUs: 0, durationUs, downloaded: true, frames: null }]
				}
			]
		};
		await writeJson(sessionFilePath(sessionId), session);
		return session;
	} catch (error) {
		await removeDirectory(`${sessionsDir}/${sessionId}`).catch(() => {});
		if (error instanceof ImportError) throw error;
		throw new ImportError({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
	} finally {
		input.dispose();
	}
}
