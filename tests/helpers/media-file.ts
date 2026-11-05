// Inspects finished recordings with ffprobe and ffmpeg (installed in CI for
// the fixture), so tests check the file itself, not what the app says about it.

import { execFileSync } from 'node:child_process';

const run = (command: string, args: string[]) =>
	execFileSync(command, args, { maxBuffer: 512 * 1024 * 1024 });

export function probeDurationSeconds(file: string): number {
	const out = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
	return Number(out.toString().trim());
}

export function streamCodecs(file: string): string[] {
	const out = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]);
	return out.toString().trim().split('\n');
}

export interface ProbedStream {
	codec_type: 'video' | 'audio';
	codec_name: string;
	width?: number;
	height?: number;
	channels?: number;
	sample_rate?: string;
}

export function probeStreams(file: string): ProbedStream[] {
	const out = run('ffprobe', [
		'-v', 'error',
		'-show_entries', 'stream=codec_type,codec_name,width,height,channels,sample_rate',
		'-of', 'json',
		file
	]);
	return JSON.parse(out.toString()).streams;
}

/** The first audio track as mono samples. A low sample rate keeps hour-long files small; the beeps are 1 and 2 kHz. */
export function decodeAudio(file: string, sampleRate = 8000): Float32Array {
	const out = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-']);
	return new Float32Array(out.buffer, out.byteOffset, out.byteLength / 4);
}

/** Presentation times of every video frame, in seconds, in order. */
export function videoFrameTimes(file: string): number[] {
	return packetTimes(file, 'v:0');
}

/** Presentation times of every packet in one stream (`v:0`, `a:0`), sorted. */
export function packetTimes(file: string, stream: string): number[] {
	const out = run('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file]);
	return out
		.toString()
		.trim()
		.split('\n')
		.map((line) => Number(line.replace(/,$/, '')))
		.filter((t) => Number.isFinite(t))
		.sort((a, b) => a - b);
}
