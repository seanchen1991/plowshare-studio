// Spike 03 analysis: for every recording under out/, rebuilds the raw file
// from its chunks, cuts it off the way a crash would (at a chunk boundary and
// mid-chunk), then tries to finalize each version with Mediabunny (forced
// copy, no re-encoding) and checks the result with ffprobe/ffmpeg.
// Usage: node spikes/03-recording/analyze.ts  → writes out/results.{json,md}

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ALL_FORMATS,
	Conversion,
	FilePathSource,
	FilePathTarget,
	Input,
	MkvOutputFormat,
	Mp4OutputFormat,
	OggOutputFormat,
	Output,
	WebMOutputFormat,
	type OutputFormat
} from 'mediabunny';

const outRoot = join(import.meta.dirname, 'out');

interface Meta {
	requestedMimeType: string;
	actualMimeType: string;
	error: string | null;
	recordSeconds: number;
	settings: Record<string, unknown>[];
	chunks: { atMs: number; size: number }[];
}

interface VariantResult {
	variant: 'full' | 'boundary' | 'midchunk';
	bytes: number;
	expectedSeconds: number;
	rawProbeDuration: string;
	finalize: 'ok' | 'failed';
	error?: string;
	discardedTracks?: string[];
	finalizeMs?: number;
	outDuration?: number;
	outProbeDuration?: string;
	decodeErrors?: number;
	seekOk?: boolean;
}

function run(cmd: string, args: string[]) {
	const r = spawnSync(cmd, args, { encoding: 'utf8' });
	return { ok: r.status === 0, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

function probeDuration(path: string): string {
	return run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout || 'none';
}

function extensionFor(mimeType: string): string {
	if (mimeType.includes('mp4')) return 'mp4';
	if (mimeType.includes('ogg')) return 'ogg';
	if (mimeType.includes('matroska')) return 'mkv';
	return 'webm';
}

function outputFormatFor(inputFormatName: string): OutputFormat {
	if (/mp4|quicktime|isobmff/i.test(inputFormatName)) return new Mp4OutputFormat();
	if (/ogg/i.test(inputFormatName)) return new OggOutputFormat();
	if (/webm/i.test(inputFormatName)) return new WebMOutputFormat();
	return new MkvOutputFormat();
}

async function finalize(rawPath: string, finishedPath: string): Promise<Partial<VariantResult>> {
	const started = performance.now();
	try {
		const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(rawPath) });
		const format = await input.getFormat();
		const output = new Output({ format: outputFormatFor(format.name), target: new FilePathTarget(finishedPath) });
		const conversion = await Conversion.init({ input, output, showWarnings: false, copy: { mode: 'forced' } });
		const discardedTracks = conversion.discardedTracks.map((d) => `${d.track.type}:${d.reason}`);
		if (!conversion.isValid) return { finalize: 'failed', error: 'conversion invalid', discardedTracks };
		await conversion.execute();
		const check = new Input({ formats: ALL_FORMATS, source: new FilePathSource(finishedPath) });
		const outDuration = await check.computeDuration();
		return { finalize: 'ok', discardedTracks, finalizeMs: Math.round(performance.now() - started), outDuration };
	} catch (error) {
		return { finalize: 'failed', error: String(error).slice(0, 200) };
	}
}

function verify(path: string, duration: number): Partial<VariantResult> {
	const decode = run('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-']);
	const decodeErrors = decode.stderr ? decode.stderr.split('\n').length : 0;
	const seek = run('ffmpeg', ['-v', 'error', '-ss', String(duration / 2), '-i', path, '-t', '0.5', '-f', 'null', '-']);
	return { outProbeDuration: probeDuration(path), decodeErrors, seekOk: seek.ok };
}

async function analyzeRecording(dir: string): Promise<{ meta: Meta; variants: VariantResult[] }> {
	const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as Meta;
	const chunkFiles = readdirSync(dir).filter((f) => f.startsWith('chunk-')).sort();
	const chunks = chunkFiles.map((f) => readFileSync(join(dir, f)));
	const ext = extensionFor(meta.actualMimeType || meta.requestedMimeType);
	const keep = Math.max(1, Math.round(chunks.length * 0.6));
	const work = join(dir, 'analysis');
	mkdirSync(work, { recursive: true });

	const variants: [VariantResult['variant'], Buffer, number][] = [
		['full', Buffer.concat(chunks), meta.recordSeconds],
		['boundary', Buffer.concat(chunks.slice(0, keep)), (meta.chunks[keep - 1]?.atMs ?? 0) / 1000],
		[
			'midchunk',
			Buffer.concat([...chunks.slice(0, keep), chunks[keep]?.subarray(0, Math.floor(chunks[keep].length / 2)) ?? Buffer.alloc(0)]),
			(meta.chunks[keep - 1]?.atMs ?? 0) / 1000
		]
	];

	const results: VariantResult[] = [];
	for (const [variant, bytes, expectedSeconds] of variants) {
		const rawPath = join(work, `${variant}-raw.${ext}`);
		const finishedPath = join(work, `${variant}-finished.${ext}`);
		writeFileSync(rawPath, bytes);
		const result: VariantResult = {
			variant,
			bytes: bytes.length,
			expectedSeconds: Math.round(expectedSeconds * 100) / 100,
			rawProbeDuration: probeDuration(rawPath),
			finalize: 'failed',
			...(await finalize(rawPath, finishedPath))
		};
		if (result.finalize === 'ok' && result.outDuration !== undefined) Object.assign(result, verify(finishedPath, result.outDuration));
		results.push(result);
	}
	return { meta, variants: results };
}

function markdown(all: Awaited<ReturnType<typeof collect>>): string {
	const lines: string[] = ['# Spike 03 results', '', '## Format support', ''];
	for (const s of all.support) {
		lines.push(`### ${s.os} / ${s.browser}`, '', `\`${s.userAgent}\``, '', '| Format | isTypeSupported | encodingInfo (supported / smooth / powerEfficient) |', '| --- | --- | --- |');
		for (const r of s.results) {
			const e = r.encodingInfo as { supported?: boolean; smooth?: boolean; powerEfficient?: boolean; error?: string };
			const info = e?.error ? `error: ${e.error.slice(0, 60)}` : `${e?.supported} / ${e?.smooth} / ${e?.powerEfficient}`;
			lines.push(`| \`${r.mimeType}\` | ${r.supported ? '✅' : '—'} | ${info} |`);
		}
		lines.push('');
	}
	lines.push('## Finalizing cut-off recordings', '', '| Recording | Actual MIME | Variant | Expected s | Raw duration | Finalize | Out duration | Seconds lost | Decode errors | Seek | Notes |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const r of all.recordings) {
		for (const v of r.variants) {
			const notes = [v.error, v.discardedTracks?.length ? `discarded ${v.discardedTracks.join(', ')}` : '', v.finalizeMs !== undefined ? `${v.finalizeMs} ms` : ''].filter(Boolean).join('; ');
			lines.push(
				`| ${r.name} | \`${r.meta.actualMimeType}\` | ${v.variant} | ${v.expectedSeconds} | ${v.rawProbeDuration} | ${v.finalize === 'ok' ? '✅' : '❌'} | ${v.outDuration?.toFixed(2) ?? '—'} | ${v.outDuration === undefined ? '—' : (v.expectedSeconds - v.outDuration).toFixed(2)} | ${v.decodeErrors ?? '—'} | ${v.seekOk === undefined ? '—' : v.seekOk ? '✅' : '❌'} | ${notes} |`
			);
		}
	}
	return lines.join('\n') + '\n';
}

async function collect() {
	const support: { os: string; browser: string; userAgent: string; results: { mimeType: string; supported: boolean; encodingInfo: unknown }[] }[] = [];
	const recordings: { name: string; meta: Meta; variants: VariantResult[] }[] = [];
	for (const machine of readdirSync(outRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
		const machineDir = join(outRoot, machine);
		if (existsSync(join(machineDir, 'support.json'))) support.push(JSON.parse(readFileSync(join(machineDir, 'support.json'), 'utf8')));
		for (const format of readdirSync(machineDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
			const dir = join(machineDir, format);
			if (!existsSync(join(dir, 'meta.json'))) continue;
			recordings.push({ name: `${machine}/${format}`, ...(await analyzeRecording(dir)) });
		}
	}
	return { support, recordings };
}

const all = await collect();
writeFileSync(join(outRoot, 'results.json'), JSON.stringify(all, null, 2));
const md = markdown(all);
writeFileSync(join(outRoot, 'results.md'), md);
process.stdout.write(md);
