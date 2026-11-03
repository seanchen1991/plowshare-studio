// Messages between the app and the finalize worker.

export interface FinalizeRequest {
	rawPath: string;
	manifestPath: string;
	/** Path of the finished file without its extension; the worker picks MP4 or WebM. */
	finishedBase: string;
}

export interface FinalizeResult {
	path: string;
	durationUs: number;
	/** Frames in the finished file; null for audio-only. */
	framesInFile: number | null;
}

export type FinalizeResponse =
	| { type: 'progress'; progress: number }
	| { type: 'done'; result: FinalizeResult }
	| { type: 'error'; message: string };
