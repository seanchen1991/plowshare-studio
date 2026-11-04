// Appends recorded chunks to a Segment's raw file in OPFS. Each chunk is
// flushed to disk before it is listed in the manifest, so the manifest never
// lists bytes that aren't there. Messages are handled strictly in order.

import { manifestLine, type ManifestEntry } from './manifest.ts';
import { fileHandle } from './opfs.ts';
import type { ChunkWriterRequest, ChunkWriterResponse } from './chunk-writer.protocol.ts';

const encoder = new TextEncoder();
let raw: FileSystemSyncAccessHandle | null = null;
let manifest: FileSystemSyncAccessHandle | null = null;
let rawOffset = 0;
let chunks = 0;
let failed = false;

function post(message: ChunkWriterResponse) {
	self.postMessage(message);
}

function append(entry: ManifestEntry) {
	manifest!.write(encoder.encode(manifestLine(entry)), { at: manifest!.getSize() });
	manifest!.flush();
}

async function handle(request: ChunkWriterRequest) {
	switch (request.type) {
		case 'open': {
			raw = await (await fileHandle(request.rawPath, { create: true })).createSyncAccessHandle();
			manifest = await (await fileHandle(request.manifestPath, { create: true })).createSyncAccessHandle();
			raw.truncate(0);
			manifest.truncate(0);
			append(request.header);
			break;
		}
		case 'chunk': {
			const bytes = new Uint8Array(await request.data.arrayBuffer());
			if (bytes.length === 0) return;
			const written = raw!.write(bytes, { at: rawOffset });
			if (written !== bytes.length) throw new Error(`Wrote ${written} of ${bytes.length} bytes`);
			raw!.flush();
			append({ kind: 'chunk', offset: rawOffset, bytes: bytes.length, timestampUs: request.timestampUs });
			rawOffset += bytes.length;
			chunks++;
			post({ type: 'written', chunks, bytes: rawOffset });
			break;
		}
		case 'alive': {
			if (manifest) append({ kind: 'alive', timestampUs: request.timestampUs });
			break;
		}
		case 'close': {
			append({ kind: 'state', state: request.state });
			raw!.close();
			manifest!.close();
			manifest = null;
			post({ type: 'closed', chunks, bytes: rawOffset });
			break;
		}
	}
}

let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<ChunkWriterRequest>) => {
	queue = queue.then(async () => {
		if (failed) return;
		try {
			await handle(event.data);
		} catch (error) {
			failed = true;
			post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	});
};
