# Handoff brief: phases 1–2

This brief is the source of truth for phases 1 and 2. Where it differs from the Technical Sketch or Hard parts in depth, this brief wins; those documents remain background on *why*. Terms (Session, Recording, Segment, Cut and so on) are defined in [`CONTEXT.md`](../../CONTEXT.md); architectural decisions live in [`docs/adr/`](../adr/).

**Name:** Plowshare Studio. Repo and folder name `plowshare-studio`; hosted at plowshare.studio.

## Goal

Build a free, open-source, browser-only tool to record a solo video podcast, combine takes, and cut out dead air and mistakes. Everything runs on the user's computer: no accounts, no backend, no uploads. This round covers the solo recorder (phase 1) and the simple cutter (phase 2).

## Stack

| Area | Choice |
| --- | --- |
| Language | TypeScript, strict mode |
| UI | Svelte 5 with Vite, single-page app (no SvelteKit needed yet) |
| Media read/write and export | [Mediabunny](https://mediabunny.dev/guide/introduction) |
| Storage | Origin Private File System (OPFS) for recordings, Session files and Project files |
| Heavy work | Web Workers for chunk writing, finalizing, waveform peaks, silence detection and export |
| Tests | Vitest for logic; Playwright with Chrome's fake camera and mic flags, fed the test fixture |
| CI | GitHub Actions: Vitest and the Playwright smoke test on every push; long and crash tests on a schedule or on demand |
| Package manager | pnpm |
| License | AGPL-3.0, LICENSE file at the root |
| Hosting | Static build, deployable to Cloudflare Pages or GitHub Pages, served at plowshare.studio; installable as a web app (manifest) |

Ask before adding any dependency not listed here.

## Browsers

Latest Chrome, Edge and Firefox on Windows, macOS and Linux. Safari is out of scope: detect it and show a clear "not supported yet, please use Chrome, Edge or Firefox" message. Private windows have tiny storage quotas: detect them and refuse to record, saying why.

## Phase 1: solo recorder

### Start with these three issues

1. **Spike: recovering cut-off WebM.** Check which codecs each browser's `MediaRecorder` supports (`isTypeSupported`), then confirm Mediabunny can remux a WebM file truncated mid-write, from both Chrome and Firefox, back to its last complete chunk. If this is unreliable, revisit WebM (Chrome's fragmented MP4 output is the fallback to evaluate) before building recovery.
2. **Test fixture.** A video file with an on-screen timecode and regular beeps, plus the Playwright setup that feeds it in as a fake camera and mic. It turns "nothing lost" and "in sync" into measurements.
3. **Project scaffolding and CI.** Repo, stack above, LICENSE, README, GitHub Actions.

### Capture

- Pick camera and microphone; live preview (mirrored in the preview only, never in the recording); microphone level meter showing peak and clipping, with "too quiet" and "clipping" warnings during the countdown.
- 3-2-1 countdown, start and stop, elapsed time.
- Pressing record creates a **Session** holding one **Recording** for the host. After stop, the user returns straight to the record screen so they can record another take while the last one finalizes.
- **Audio-only takes** are allowed: the same pipeline without the video track.
- **Video:** request 1920×1080 at 30 fps and accept what the camera delivers; never upscale. 1080p records at 6 Mbps, 720p at about 3.5 Mbps; tell the user when the camera only provides 720p. Codec preference: H.264, then VP9, then VP8, whichever `MediaRecorder` supports first, always in WebM. Store the chosen codec in the Session file. Variable frame rate is accepted at capture; export produces constant frame rate.
- **Audio:** echo cancellation, noise suppression and automatic gain control **off** by default. A "Clean up audio (call-style processing)" toggle turns them on, remembered per device. Opus, 160 kbps, mono, 48 kHz.

### Writing to disk

- `MediaRecorder` with a timeslice of a few seconds. Each chunk goes to a Web Worker that appends it to the Segment's OPFS file through a synchronous access handle and **flushes** it. Chunks are never held in memory.
- A **manifest** next to each Segment file records each chunk's byte offset and timestamp, plus the Recording's state. A chunk is listed in the manifest only after it has been flushed. The manifest is the source of truth for recovery.
- Chunk writing must not depend on timers, so recording in a background tab loses nothing.
- Hold a screen Wake Lock while capturing, re-acquire it when the tab becomes visible again, and warn before the tab is closed while capturing or finalizing.

### Recording states

Each Recording is in one state, shown in the library:

- **Capturing**: in progress.
- **Paused**: a device dropped or the computer slept; waiting for the user.
- **Finalizing**: starts automatically on stop. A worker remuxes each raw Segment with Mediabunny into a finished, seekable file, with progress shown. The raw file is deleted only after the finished file checks out (its duration roughly matches the manifest).
- **Ready**: playable, renameable, downloadable, editable.
- **Interrupted**: the browser died during Capturing or Finalizing. On load, offer **Recover**, which trims the raw file back to the last complete chunk in the manifest and then goes through Finalizing, the same path as a normal stop. Show what was saved, for example "Recovered 47:12 of about 47:15". Never recover automatically.

### Device drops and sleep (Segments)

- Listen for each track's `ended` event and for device changes. If any track ends, close the current Segment (it finalizes like a normal stop), set the Recording to **Paused**, and show a loud alert with a sound: "Microphone disconnected at 22:14, recording paused."
- Waking from sleep shows "Recording paused while your computer slept", with Resume or Stop.
- **Resume is manual:** the user chooses a device (the same one or another), the countdown runs, and a new Segment starts in the same Recording. The time in between is a **Capture gap** on the Session's timeline. The editor offers it as a Suggested cut.
- Devices change mid-take only through this pause-and-resume path.

### Storage

- **Recording time left** = (free space − safety margin) ÷ 2 ÷ bitrate. The ÷ 2 reserves room for the finished copy written during Finalizing; count Sessions still Finalizing as used. Show it before starting ("Room for about 4 h 10 m").
- Refuse to start below about 10 minutes, and explain how to free space. While capturing, warn at 15 and 5 minutes left, and **stop cleanly** when time runs out so the take still finalizes. There is no fixed limit on take length.
- **Persistence:** call `navigator.storage.persist()` the first time the user presses record, not on page load. If refused, record anyway, and show a lasting, calm notice in the library ("Your browser hasn't agreed to keep recordings permanently. Download takes you want to keep."), with browser-specific "How to fix this" steps: install the app in Chrome and Edge, or allow the storage prompt in Firefox. Ask again on later visits while refused.
- Delete recordings only when the user asks, never automatically.

### Library

- Lists Sessions (shown as takes) with state, length, date and whether they are **Backed up**.
- Play, rename, delete, download.
- **Download** gives one finished file per Segment: `2026-11-02 Episode 1.webm`, or `… – part 1 of 2.webm` and so on when there are several. No zip. A Session is Backed up once every Segment has been downloaded. While persistence is refused, any take that isn't backed up shows a "not backed up" badge.

### Not in phase 1

A pause button the user presses, screen recording, markers during recording, an uncompressed audio backup, zip downloads, and rebuilding a Session from downloaded files.

### Done when

- [ ] A 60-minute 1080p30 recording in Chrome finishes and plays back with working seeking.
- [ ] Killing the **browser process** mid-recording, then relaunching and choosing Recover, keeps everything up to the last few seconds, in Chrome and Firefox.
- [ ] A 10-minute recording works the same way in Firefox.
- [ ] Memory use stays flat during a long recording.
- [ ] A 10-minute take with the tab in the background loses nothing.
- [ ] Unplugging the mic mid-take, then resuming, gives one Recording with two Segments, both playable, with the Capture gap recorded.
- [ ] A 60-minute 1080p30 recording on an older laptop drops no more than an agreed number of frames (set the threshold during the spike).
- [ ] Manual hardware checklist passes: USB mic unplugged mid-take, laptop lid closed and reopened mid-take, an older laptop.

## Phase 2: simple cutter

**Features**

- Create a **Project** by opening one or more Ready Sessions; add, remove and reorder Sessions in it. Several Projects can use the same Session.
- Open a recording from a file on disk.
- Waveform overview computed in a worker and cached, with a video preview synced to the playhead.
- Select a range and cut it; click a Cut to restore it; undo and redo.
- **Suggested cuts:** "Remove pauses" finds stretches below a volume threshold longer than a minimum length, keeping a little padding on each side; every Capture gap is also suggested. Accept or reject them one by one or all at once. Threshold, minimum length and padding are adjustable.
- Preview plays the edit with Cuts skipped, across Sessions in order.
- Export the Project as MP4 (H.264 video, AAC audio) and as audio-only, streamed so long files don't load into memory, with progress and cancel. Place frames by timestamp and output constant frame rate. Check codec support with Mediabunny and fall back to WebM if a codec isn't available.

**Done when**

- [ ] A 60-minute recording opens, shows its waveform and suggests pauses without freezing the page.
- [ ] A Project combining two takes exports as one continuous episode.
- [ ] The exported MP4 plays in VLC and uploads to YouTube and Substack.
- [ ] Audio and video stay in sync across every Cut and every Session boundary, start to end (measured with the test fixture).
- [ ] Unit tests cover the cut-list logic and silence detection.

## Data model

See [ADR 0001](../adr/0001-projects-are-ordered-sessions.md). Recordings are never modified. Times are integer microseconds.

**Session file** (phase 1), one per Session:

```json
{
  "version": 1,
  "id": "ses_01",
  "title": "Episode 1 – take 2",
  "createdAt": "2026-11-02T18:00:00Z",
  "recordings": [
    {
      "id": "rec_01",
      "participant": { "id": "par_host", "role": "host" },
      "state": "ready",
      "clockOffsetUs": 0,
      "video": { "codec": "avc", "width": 1920, "height": 1080, "fps": 30, "bitrate": 6000000 },
      "audio": { "codec": "opus", "channels": 1, "sampleRate": 48000, "bitrate": 160000, "processing": false },
      "segments": [
        { "index": 1, "path": "sessions/ses_01/rec_01/seg-01.webm", "startUs": 0, "durationUs": 1334000000, "downloaded": true },
        { "index": 2, "path": "sessions/ses_01/rec_01/seg-02.webm", "startUs": 1344000000, "durationUs": 1056000000, "downloaded": false }
      ]
    }
  ]
}
```

`video` is `null` for an audio-only take. `startUs` places each Segment on the Session's timeline; a Capture gap is the space between one Segment's end and the next one's start (here, 10 seconds). Each raw Segment also has a manifest during Capturing and Finalizing.

**Project file** (phase 2):

```json
{
  "version": 1,
  "id": "proj_01",
  "title": "Episode 1",
  "createdAt": "2026-11-02T19:00:00Z",
  "sessions": [
    {
      "sessionId": "ses_01",
      "cuts": [
        { "startUs": 12500000, "endUs": 14100000, "reason": "silence", "accepted": true },
        { "startUs": 1334000000, "endUs": 1344000000, "reason": "gap", "accepted": false }
      ]
    },
    { "sessionId": "ses_02", "cuts": [] }
  ],
  "silence": { "thresholdDb": -45, "minLengthMs": 700, "paddingMs": 150 }
}
```

Sessions play in the listed order; each appears at most once. A Cut lies on one Session's timeline, applies to every Track in it, and never crosses into the next Session. `reason` is `manual`, `silence` or `gap`. Kept ranges are derived. The silence defaults are starting values to tune by ear.

## Suggested layout

```
src/
  lib/
    recorder/    MediaRecorder, devices, level meter, wake lock, device-drop handling
    storage/     OPFS read/write, manifests, recovery, Session and Project files, quota and persistence
    media/       remux/finalize, export, codec checks (Mediabunny)
    analysis/    waveform peaks, silence detection (pure functions + workers)
    edit/        cut list: add, remove, merge, undo, derive kept ranges (pure TS)
  ui/            Svelte components and views
tests/
  fixtures/      timecode-and-beeps video
```

## Not in this round

Accounts, any backend, calls or guests, transcription, Safari, cloud storage, multi-track editing.

## Working agreements

- Build phase 1 completely before phase 2.
- Keep the cut list and silence detection as pure, tested functions with no browser APIs.
- Use the terms in `CONTEXT.md` in code, UI and docs; "take" is fine in UI copy for a Session.
- Commit in small, working steps; keep the README current with how to run, test and build.
- Flag browser limits you hit (codec support, storage quotas) instead of working around them silently.

## Design rule: a host plus up to 3 guests

Later phases add remote guests, and a Session must support the host plus 1 to 3 guests. Never assume exactly two people, even in phases 1 and 2:

- Store participants and Recordings as lists, each with an id and a role (`host` or `guest`), as the Session file already does.
- Name things for a participant, not for "the guest": per-participant Recordings, transfers, clock offsets and reference tracks.
- Keep the timeline, cut list and export able to hold any number of Tracks per Session, even while the UI shows only one.
- Size storage checks by the number of participants: the host will eventually store every participant's Recording.
