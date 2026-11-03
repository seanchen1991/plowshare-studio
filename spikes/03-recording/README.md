# Spike 03: codec support and recovering a cut-off WebM

Throwaway investigation for [issue 03](../../.scratch/issues/03-spike-codecs-and-cut-off-webm-recovery.md) (local tracker). It answers:

1. Which formats can `MediaRecorder` write in Chrome, Edge and Firefox on Linux, macOS and Windows, and which does the browser report as hardware-backed (`powerEfficient`)?
2. If a recording is cut off by a crash, at a chunk boundary or mid-chunk, can Mediabunny finalize what's left into a seekable file?

## How it runs

- `record.spec.ts` (Playwright, real browsers with fake devices) probes every format in `candidates.ts`, then records 10 seconds at 6 Mbps / 160 kbps with a 1-second timeslice in each supported one, saving every chunk.
- `analyze.ts` (Node, one Linux machine) rebuilds each raw file, cuts it off at 60% of its chunks (and again halfway into the next chunk), finalizes each version with Mediabunny using a forced copy, and checks duration, decode errors and seeking with ffprobe/ffmpeg.
- The `Spike 03` workflow runs both across Linux, macOS and Windows and puts the results in the run summary.

Locally: `SPIKE_BROWSERS=chromium,firefox pnpm exec playwright test -c spikes/03-recording/playwright.config.ts`, then `node spikes/03-recording/analyze.ts`. (Media capture hangs inside Claude Code's sandbox; run it yourself or in CI.)

## Early finding (before the browser runs)

Mediabunny's default copy mode (`'preferred'`) re-encodes a track whenever copying it would need any timestamp shift; WebM Opus audio hit this and, in Node, was dropped. With `copy: { mode: 'forced' }` both tracks are copied untouched, with identical timestamps. **Finalizing must use forced copy**, or in the browser it would silently re-encode the audio.

## Results

Filled in after the CI run.
