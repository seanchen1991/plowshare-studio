// Messages between the app and the peaks worker.

export interface PeaksRequest {
	/** The finished Segment file. */
	path: string;
	durationUs: number;
	/** Where to save the peaks once they're all computed. */
	cachePath: string;
}

export type PeaksResponse =
	/** Finished bins, starting at bin `from`. Arrive in order as decoding goes. */
	| { type: 'peaks'; from: number; peaks: Uint8Array }
	| { type: 'done' }
	| { type: 'error'; message: string };
