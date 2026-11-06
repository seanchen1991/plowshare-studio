// A short two-tone chime for alerts that need the user even when they aren't
// looking at the screen. The page has had a click (Record) by the time it plays,
// so browsers allow the sound.

export function playAlertSound(): void {
	try {
		const context = new AudioContext();
		const tones = [880, 660];
		for (const [i, frequency] of tones.entries()) {
			const start = context.currentTime + i * 0.25;
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			oscillator.frequency.value = frequency;
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
			oscillator.connect(gain).connect(context.destination);
			oscillator.start(start);
			oscillator.stop(start + 0.25);
		}
		setTimeout(() => void context.close(), (tones.length * 0.25 + 0.2) * 1000);
	} catch {
		// No sound; the alert on screen still shows.
	}
}
