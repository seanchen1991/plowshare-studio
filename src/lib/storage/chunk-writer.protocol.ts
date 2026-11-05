// Messages between the recorder and the chunk-writer worker.

import type { ManifestHeader } from './manifest.ts';
import type { RecordingState } from './session-file.ts';

export type ChunkWriterRequest =
	| {
			type: 'open';
			rawPath: string;
			manifestPath: string;
			header: ManifestHeader;
			/** When capture started, as `performance.timeOrigin + performance.now()`, for the worker's alive lines. */
			startedAtMs: number;
	  }
	| { type: 'chunk'; data: Blob; timestampUs: number }
	| { type: 'close'; state: RecordingState };

export type ChunkWriterResponse =
	| { type: 'written'; chunks: number; bytes: number }
	| { type: 'closed'; chunks: number; bytes: number }
	| { type: 'error'; message: string };
