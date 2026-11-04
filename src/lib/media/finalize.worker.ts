// Finalizing: remuxes one raw Segment into a finished, seekable file without
// re-encoding (ADR 0003), then checks the result before reporting success.
// Deleting the raw file is left to the caller, after it has recorded the
// finished file in the Session file.

import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	EncodedPacketSink,
	Input,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	WebMOutputFormat
} from 'mediabunny';
import { durationMatches, parseManifest } from '../storage/manifest.ts';
import { fileHandle, readFile } from '../storage/opfs.ts';
import { finishedContainer } from './formats.ts';
import type { FinalizeRequest, FinalizeResponse, FinalizeResult } from './finalize.protocol.ts';

function post(message: FinalizeResponse) {
	self.postMessage(message);
}

async function finalize({ rawPath, manifestPath, finishedBase }: FinalizeRequest): Promise<FinalizeResult> {
	const manifest = parseManifest(await (await readFile(manifestPath)).text());
	// Only bytes listed in the manifest are known to be complete.
	const raw = (await readFile(rawPath)).slice(0, manifest.endOffset);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(raw) });
	try {
		const inputTracks = await input.getTracks();
		const videoTrack = await input.getPrimaryVideoTrack();
		const container = finishedContainer(videoTrack?.codec ?? null);
		const path = `${finishedBase}.${container}`;

		const writable = await (await fileHandle(path, { create: true })).createWritable();
		const output = new Output({
			format: container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
			target: new StreamTarget(writable, { chunked: true })
		});
		// Forced copy: the default mode re-encodes or drops Opus audio (spike 03).
		const conversion = await Conversion.init({ input, output, showWarnings: false, copy: { mode: 'forced' } });
		const dropped = conversion.discardedTracks.map((d) => `${d.track.type} (${d.reason})`);
		if (!conversion.isValid || dropped.length > 0) {
			await writable.abort().catch(() => {});
			throw new Error(`Finalizing would drop ${dropped.join(', ') || 'every track'}`);
		}
		conversion.onProgress = (progress) => post({ type: 'progress', progress });
		await conversion.execute();

		return await check(path, inputTracks.length, manifest.lastTimestampUs);
	} finally {
		input.dispose();
	}
}

/** The finished file must have every input track and about the duration the manifest recorded. */
async function check(path: string, expectedTracks: number, manifestUs: number): Promise<FinalizeResult> {
	const finished = new Input({ formats: ALL_FORMATS, source: new BlobSource(await readFile(path)) });
	try {
		const tracks = await finished.getTracks();
		if (tracks.length !== expectedTracks) throw new Error(`Finished file has ${tracks.length} of ${expectedTracks} tracks`);

		const durationUs = Math.round((await finished.computeDuration()) * 1e6);
		if (!durationMatches(durationUs, manifestUs)) {
			throw new Error(`Finished file lasts ${durationUs / 1e6} s but ${manifestUs / 1e6} s were captured`);
		}

		const video = await finished.getPrimaryVideoTrack();
		let framesInFile: number | null = null;
		if (video) {
			framesInFile = 0;
			for await (const _ of new EncodedPacketSink(video).packets(undefined, undefined, { metadataOnly: true })) framesInFile++;
		}
		const audioTrack = await finished.getPrimaryAudioTrack();
		const audio = audioTrack
			? { channels: await audioTrack.getNumberOfChannels(), sampleRate: await audioTrack.getSampleRate() }
			: null;
		return { path, durationUs, framesInFile, audio };
	} finally {
		finished.dispose();
	}
}

self.onmessage = async (event: MessageEvent<FinalizeRequest>) => {
	try {
		post({ type: 'done', result: await finalize(event.data) });
	} catch (error) {
		post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	}
};
