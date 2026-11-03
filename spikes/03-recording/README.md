# Spike 03: codec support and recovering a cut-off WebM

Throwaway investigation for [issue 03](../../.scratch/issues/03-spike-codecs-and-cut-off-webm-recovery.md) (local tracker). It answers:

1. Which formats can `MediaRecorder` write in Chrome, Edge and Firefox on Linux, macOS and Windows, and which does the browser report as hardware-backed (`powerEfficient`)?
2. If a recording is cut off by a crash, at a chunk boundary or mid-chunk, can Mediabunny finalize what's left into a seekable file?

## How it runs

- `record.spec.ts` (Playwright, real browsers with fake devices) probes every format in `candidates.ts`, then records 10 seconds at 6 Mbps / 160 kbps with a 1-second timeslice in each supported one, saving every chunk.
- `analyze.ts` (Node, one Linux machine) rebuilds each raw file, cuts it off at 60% of its chunks (and again halfway into the next chunk), finalizes each version with Mediabunny using a forced copy, and checks duration, decode errors and seeking with ffprobe/ffmpeg.
- The `Spike 03` workflow runs both across Linux, macOS and Windows and puts the results in the run summary.

Locally: `SPIKE_BROWSERS=chromium,firefox pnpm exec playwright test -c spikes/03-recording/playwright.config.ts`, then `node spikes/03-recording/analyze.ts`. (Media capture hangs inside Claude Code's sandbox; run it yourself or in CI.)

## Local run (real camera, mic and hardware)

Answers what CI can't: hardware encoding, dropped frames over a long take, and finalizing time.

1. `pnpm dev`, then open http://localhost:5173/spikes/03-recording/local.html in Chrome (then Firefox).
2. **Check** (hardware encoders) → **Allow camera and mic** → pick devices, the default format and **60 minutes** → **Start**. Keep the laptop plugged in and the tab visible.
3. When it finishes, try seeking in the finished video, then **Copy report** and paste it back, along with which machine it was.
4. **Delete spike files** frees the ~5 GB it used.

Do a 1-minute take first to make sure everything works.

## Early finding (before the browser runs)

Mediabunny's default copy mode (`'preferred'`) re-encodes a track whenever copying it would need any timestamp shift; WebM Opus audio hit this and, in Node, was dropped. With `copy: { mode: 'forced' }` both tracks are copied untouched, with identical timestamps. **Finalizing must use forced copy**, or in the browser it would silently re-encode the audio.

## Results (CI runs 41658796549 and 41662027169, 2026-11-03)

Chrome, Edge, Playwright's Chromium (all 156) and Firefox 157, each on Linux, macOS and Windows runners, with fake devices. 111 recordings, each finalized full, cut at a chunk boundary, and cut mid-chunk.

### Recommendation: keep WebM everywhere

- **Every cut-off WebM finalized**, in every browser, codec and OS, cut at a boundary or mid-chunk: 0 failures. The finished files have a duration, decode with 0 errors (one stray error in one Firefox VP8 run), and seek. The boundary cut lost 0.1–0.2 s against the chunk's arrival time; mid-chunk cuts kept part of the next chunk.
- **Raw `MediaRecorder` WebM has no duration** (`ffprobe` reports N/A) in every browser, so finalizing after every stop is required, as planned.
- **Chromium's fragmented MP4 is not a crash-safe fallback.** It ignores the timeslice on every OS: one ~1 KB header chunk, then the whole take arrives at stop. A crash before stop loses everything (confirmed again in run 41662027169; whether a given cut test shows this depends only on whether the cut lands before that single data chunk). Its files also carry non-monotonic timestamps (24 decode warnings in a 10 s clip, even uncut).
- **Finalize with `copy: { mode: 'forced' }`** (see the early finding above).

### Format support

| | Chrome / Edge / Chromium | Firefox |
| --- | --- | --- |
| WebM video | VP8, VP9, AV1, H.264 (`h264` and `avc1`) on all three OSes | **VP8 only** |
| WebM audio-only (Opus) | ✅ | ✅ |
| Ogg Opus | — | ✅ (Mediabunny can't copy it: `cannot_copy`) |
| MP4 | H.264/VP9 + Opus everywhere; AAC on macOS and Windows only | — |

So the brief's preference order (H.264 → VP9 → VP8) resolves to H.264 in Chromium browsers and VP8 in Firefox.

**Chromium writes H.264 as Matroska, not WebM.** Asking for `video/webm;codecs=h264` (or `avc1`) gives `video/x-matroska;codecs=avc1,opus` in Chrome, Edge and Chromium on every OS. WebM can't hold H.264, so finalizing must keep the input's container family (Matroska in, Matroska out) or remux to MP4. Both work with a forced copy, and the finished `.mkv`, `.webm` and `.mp4` files all play and seek in Chromium, Chrome and Firefox (checked locally with the CI recordings). The first local run finalized into WebM and silently dropped the video track; the page now fails loudly on any dropped track.

### What this run could not answer

- **Hardware encoding.** `mediaCapabilities.encodingInfo({ type: 'record' })` throws in Chromium ("not a valid enum value") and answers "unsupported" in Firefox for formats it records, so it's useless here. The right probe is WebCodecs `VideoEncoder.isConfigSupported` with `hardwareAcceleration: 'prefer-hardware'`, and CI runners have no GPU anyway: this needs a run on a real machine.
- **Real-device behavior.** Chrome's fake camera runs at 20 fps and its fake mic is stereo 44.1 kHz regardless of constraints; test-pattern video compresses to well under 6 Mbps. The app must store the settings it actually gets, not the ones it asked for.
- **Finalize time for a 60-minute file and the dropped-frame threshold** need a real machine and a long take.
- Browser versions in `support.json` come from Playwright's user-agent presets, not the real browsers; record `browser.version()` next time.
