// Computes a finished Segment's waveform peaks: decodes its audio a block at a
// time, so memory stays flat however long it is, and sends finished bins as it
// goes so the waveform fills in. Saves the peaks next to the Segment when done;
// the Segment itself is only read.

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { fileHandle, readFile } from '../storage/opfs.ts';
import { PeakBuilder, peakCount } from './peaks.ts';
import type { PeaksRequest, PeaksResponse } from './peaks.protocol.ts';

/** How often finished bins are sent while decoding. */
const sendEveryMs = 100;

function post(message: PeaksResponse) {
	self.postMessage(message);
}

async function compute({ path, durationUs, cachePath }: PeaksRequest): Promise<void> {
	const count = peakCount(durationUs);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await readFile(path)) });
	let builder: PeakBuilder | null = null;
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('This Segment has no audio');
		const planes: Float32Array[] = [];
		// Bins up to `sent` have been sent; the last bin a block touched may still grow with the next block.
		let sent = 0;
		let reached = 0;
		let lastSend = performance.now();
		for await (const sample of new AudioSampleSink(track).samples()) {
			try {
				builder ??= new PeakBuilder(count, sample.sampleRate);
				const frames = sample.numberOfFrames;
				for (let c = 0; c < sample.numberOfChannels; c++) {
					if ((planes[c]?.length ?? 0) < frames) planes[c] = new Float32Array(frames);
					sample.copyTo(planes[c]!, { planeIndex: c, format: 'f32-planar' });
				}
				const channels = planes.slice(0, sample.numberOfChannels).map((p) => p.subarray(0, frames));
				reached = Math.max(reached, builder.add(sample.timestamp, channels).to);
			} finally {
				sample.close();
			}
			if (performance.now() - lastSend >= sendEveryMs && reached - 1 > sent) {
				post({ type: 'peaks', from: sent, peaks: builder.peaks.slice(sent, reached - 1) });
				sent = reached - 1;
				lastSend = performance.now();
			}
		}
		builder ??= new PeakBuilder(count, 48000);
		post({ type: 'peaks', from: sent, peaks: builder.peaks.slice(sent) });
	} finally {
		input.dispose();
	}

	const writable = await (await fileHandle(cachePath, { create: true })).createWritable();
	await writable.write(builder.peaks);
	await writable.close();
}

self.onmessage = async (event: MessageEvent<PeaksRequest>) => {
	try {
		await compute(event.data);
		post({ type: 'done' });
	} catch (error) {
		post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	}
};
