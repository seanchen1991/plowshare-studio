// Firefox's fake devices play a steady tone, not the fixture, and can't take a
// file. This init script swaps getUserMedia for a stream made in the page: a
// canvas with a running frame number and the fixture's beeps on a loop, so the
// same beep checks work in Firefox. It must be self-contained: Playwright
// serializes it into the page.

import type { fixtureSpec } from '../fixtures/spec.ts';

export function useFixtureMedia(spec: typeof fixtureSpec): void {
	let source: MediaStream | null = null;

	function build(): MediaStream {
		const canvas = document.createElement('canvas');
		canvas.width = spec.width;
		canvas.height = spec.height;
		const context = canvas.getContext('2d')!;
		let frame = 0;
		setInterval(() => {
			context.fillStyle = `hsl(${(frame * 3) % 360} 40% 40%)`;
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#fff';
			context.font = '96px monospace';
			context.fillText(String(frame++), 40, 140);
		}, 1000 / spec.fps);

		const audio = new AudioContext({ sampleRate: spec.sampleRate });
		const buffer = audio.createBuffer(1, spec.loopSeconds * spec.sampleRate, spec.sampleRate);
		const samples = buffer.getChannelData(0);
		const beepSeconds = spec.beepDurationMs / 1000;
		for (let i = 0; i < samples.length; i++) {
			const t = i / spec.sampleRate;
			const hz = t % spec.markerEverySeconds < spec.beepIntervalSeconds ? spec.markerHz : spec.toneHz;
			samples[i] = t % spec.beepIntervalSeconds < beepSeconds ? 0.5 * Math.sin(2 * Math.PI * hz * t) : 0;
		}
		const player = audio.createBufferSource();
		player.buffer = buffer;
		player.loop = true;
		const destination = audio.createMediaStreamDestination();
		player.connect(destination);
		player.start();
		void audio.resume();

		return new MediaStream([...canvas.captureStream(spec.fps).getVideoTracks(), ...destination.stream.getAudioTracks()]);
	}

	navigator.mediaDevices.getUserMedia = async (constraints) => {
		source ??= build();
		const tracks: MediaStreamTrack[] = [];
		if (constraints?.video) tracks.push(source.getVideoTracks()[0]!.clone());
		if (constraints?.audio) tracks.push(source.getAudioTracks()[0]!.clone());
		return new MediaStream(tracks);
	};
}
