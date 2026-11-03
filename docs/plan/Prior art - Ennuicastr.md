# Prior art: Ennuicastr

[Ennuicastr](https://github.com/ennuicastr/ennuicastr) ([ecastr.com](https://ecastr.com)) records distributed podcast interviews in the browser and has done so since 2018. This note records what its client code (commit `fe07210`, August 2026) teaches us for phases 4–6. ISC-licensed, so code could be reused with its copyright notice, but its stack differs (libav.js rather than Mediabunny), so the ideas transfer better than the code. Terms follow [`CONTEXT.md`](../../CONTEXT.md).

## How it works, briefly

- A central server receives every participant's **audio live** during the session, each packet stamped with session time; the server rebuilds continuous, synced tracks.
- **Video** is recorded in each browser, timestamped the same way, and streamed **peer-to-peer to the host** while recording. The host's browser can also save what it receives to cloud storage or a folder on disk.
- Every participant also keeps a **local copy** in browser storage as a safety net, which the host can retrieve later.

## Ideas to adopt

### 1. Stamp session time while recording (phases 4 and 6)

Each participant re-measures its clock offset to the server **every 10 seconds** (5 pings at first, 150 ms apart) and **slews** toward the new value rather than jumping (`src/audio.ts`: `timeOffsetAdjPerFrame`, the pong handler, `adjustTime`). Every audio packet and video frame is stamped with:

> capture time − input latency + clock offset − session start

(`src/video-record.ts`, the `MediaStreamTrackProcessor` loop). Recordings therefore arrive already on the shared timeline, with drift corrected continuously, instead of being aligned afterwards.

**For us:** from phase 4, store the offset samples in each Recording's manifest alongside chunk timestamps, so finalizing can place every Segment exactly on the Session timeline. The reference-track cross-correlation in Hard parts §3 becomes a check, not the main mechanism. Two improvements: estimate the offset from the **lowest-latency** round trips (as NTP does), not the mean of the last five, and keep the raw samples so the timeline can be recomputed later.

### 2. Correct drift by adding or removing silence (phase 6)

The server "removes or adds silence as necessary" to keep tracks in sync (README). With continuous timestamps (idea 1), drift correction becomes small insertions or deletions in quiet moments, which is cheaper and less audible than resampling a whole track (Hard parts §3.4).

### 3. Record both echo-cancelled and raw audio (phase 4)

With `useDualEC` (`src/audio.ts`), each participant captures the mic twice, with and without echo cancellation, and both are recorded; the choice is made in editing. This replaces the "I'm wearing headphones" switch in Hard parts §4.4, which guests can easily get wrong. Cost: one extra audio track per Participant (about 70 MB per hour at 160 kbps). **To verify:** that Firefox allows two simultaneous captures of one microphone with different processing.

### 4. Mark voice activity on every audio packet (phases 2 and 6)

Each packet carries a voice-activity flag (`vadVal` in `src/audio.ts`). Ennuicastr uses it to avoid sending silence; for us it is free metadata for the phase 6 active-speaker layout and an extra signal for Remove pauses suggestions.

### 5. Write once, fan out to every destination (phases 4 and 5)

The muxed recording is a stream split with `tee()` into: browser storage (always), live send to the host, and optionally cloud storage, a folder on disk, or a streamed download (`saveVideoData` in `src/video-record.ts`). This matches our plan to transfer progressively during the call and keep the guest's copy as the safety net. Its host can later pull files out of a guest's browser storage by proving knowledge of the recording key with a salted hash (`src/file-storage-main.ts`), which matches our rescue link (Hard parts §5.6).

### 6. Let the host save to their own cloud account (adopted: ADR 0002)

The host's browser can save incoming recordings to the host's own **Google Drive, Dropbox or WebDAV** (`src/file-storage-main.ts`, via `nonlocal-forage`). For podcasters this is far easier than our bring-your-own S3 bucket (create a bucket, a scoped key and a CORS rule).

**Decided** ([ADR 0002](../adr/0002-guests-send-to-host-host-saves-to-drive.md)): we follow Ennuicastr's model. Guests send only to the host, peer-to-peer; the host's browser saves every take, solo ones included, to the host's Google Drive. The S3 bucket option is dropped.

Notes:
- Users need their own Google or Dropbox account, but no Plowshare account. The project needs a one-time OAuth app registration with each provider: Google's `drive.file` scope avoids its restricted-scope security review but still needs a consent screen; Dropbox requires production approval past 50 users. Browser-only token lifetimes for hour-long uploads need checking.

### 7. Save straight to a folder on disk (phase 1, issue 12)

In Chrome and Edge the host can choose a real folder with the File System Access API (`showDirectoryPicker`), and recordings stream into it (Ennuicastr's "FSDH" option, `src/fsdh-perm.ts`). No storage quota, no eviction, and every take is backed up the moment it is written. Not available in Firefox, so it can only be an option. Raised as a decision in issue 12.

## Where we deliberately differ

- **No central recording server.** Its live audio upload is robust but needs a server that scales with every session, which contradicts our near-zero running cost. We keep peer-to-peer transfer to the host, plus optional user-owned storage.
- **Transfers must resume.** It sends video as 16 KB messages addressed by byte offset, queued on `bufferedamountlow` (`src/ctcp.ts`), the same approach as Hard parts §2.3, but without acknowledgements, hashes or resume: a dropped connection ends the live copy, and the receiver gives up past 1,024 queued messages. Keep our acknowledged, hashed chunks in the manifest.
- **No automatic deletion.** Its local copies expire after 31 days by default (`src/file-storage.ts`, `storeFile`). We delete only when the user asks or a transfer is confirmed.

## To revisit before phase 4

- **WebCodecs instead of `MediaRecorder`.** Its first choice is `MediaStreamTrackProcessor` + `VideoEncoder` (with `latencyMode: "realtime"`), muxing itself, which gives exact per-frame timestamps and is what makes idea 1 work for video. `MediaRecorder` packets are re-timed against real time with a moving average instead. Spike 03's `MediaRecorder` decision stands for phase 1; recheck before phase 4, especially as hardware H.264 is available through WebCodecs on Apple Silicon.
- **MP4 and Safari.** `docs/mp4-recording.md` in its repo explains why MP4 is unsafe to record into (agreeing with spike 03) and the trick it uses to record safely in Safari. Useful when Safari support is reconsidered.
- **Firefox's start gap and encoding load (spike 03).** Firefox starts every take with a 0.4–0.6 s gap before the second frame (Chrome about 0.1 s), which matters when placing Recordings on the Session timeline. Its `MediaRecorder` encodes VP8 in software, and a call adds a second encode, so re-measure frame loss with a call running.
- **Test checklist.** Its `CHECKLIST.md` runs multi-browser sessions (Chrome, Firefox, Safari, Android, iOS) including hard-quitting a browser mid-recording, then checks sync. A model for the phase 4 manual checklist.
