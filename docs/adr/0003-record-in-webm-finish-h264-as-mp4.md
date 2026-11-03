# Record in WebM or Matroska; finish H.264 takes as MP4

Every take is recorded with `MediaRecorder` into WebM, or into Matroska where Chromium puts H.264 (it reports `video/x-matroska;codecs=avc1,opus` when asked for WebM, since WebM can't hold H.264), using a timeslice so each chunk can be flushed to disk. During Finalizing, Mediabunny copies the tracks without re-encoding (`copy: { mode: 'forced' }`) into the finished file: **MP4** for H.264 + Opus (Chrome and Edge), **WebM** for VP8 or VP9 + Opus (Firefox). This replaces the brief's earlier "always in WebM". Spike 03 (`spikes/03-recording/README.md`) has the evidence.

## Considered options

- **Record into MP4:** rejected. Chromium's MP4 `MediaRecorder` ignores the timeslice and delivers the whole take at stop, so a crash loses everything, and its timestamps are non-monotonic.
- **Finish in the recorded container** (`.mkv` from Chromium, `.webm` from Firefox): rejected because Matroska doesn't open in QuickTime or Safari, which many podcasters use to check a take. Remuxing to MP4 costs nothing extra: 60 minutes (2.8 GB) took 12 s, and the output is the same size.
- **Finish everything as WebM:** impossible for H.264, which WebM can't hold. Trying it silently drops the video track.

## Consequences

- Finished files are `.mp4` from Chrome and Edge and `.webm` from Firefox. The Session file stores each Segment's path, so the library and editor must not assume one extension.
- Finalizing checks that every input track made it into the output and fails loudly if one was dropped, besides checking the duration against the manifest.
- The MP4's audio is Opus, not AAC. Browsers and macOS 26's AVFoundation (QuickTime) decode it, but some older desktop editors may not. Export (phase 2) still produces H.264 + AAC MP4.
- Recovering a cut-off take works the same way for both containers: trim to the last complete chunk, then Finalize.
