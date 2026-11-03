# Browser Podcast Studio: Technical Sketch

Nov 1, 2026 · @Sean

> Background and later phases. For phases 1–2, the [Handoff brief](Handoff%20brief.md) is the source of truth and overrides this document where they differ. Terms are defined in [`CONTEXT.md`](../../CONTEXT.md).

## The short answer

A solo recorder with simple editing is a weekend-to-few-weeks project. A Riverside-quality remote interview tool is months of work. The difference isn't features: it's keeping long recordings safe on unreliable browsers and moving large files between people.

**The core design choice:** everything heavy runs in each person's browser, not on a server. Recording, transcription, cutting and exporting all happen locally. The only servers are a tiny one that introduces browsers to each other and a relay for guests behind strict networks. That keeps running costs close to zero, which is what makes a free tool sustainable, the way VDO.Ninja is.

| Piece | Difficulty | Why |
| --- | --- | --- |
| Solo record (camera + mic to a file) | Easy | Browsers have recording built in |
| Cut dead air and mistakes | Easy to medium | Silence detection is simple; a good editing interface takes care |
| Transcript-based editing (delete words to cut video) | Medium | In-browser Whisper models now return word timestamps |
| Export a finished MP4 | Medium | Modern libraries make this fast, but long files strain memory |
| Two-person call | Easy to medium | Peer-to-peer browser video is mature |
| Each person recorded locally at full quality | Hard | Crashes, sleeping tabs, storage limits, Safari quirks |
| Getting the guest's file to the host | Hard | Gigabytes over flaky connections, resumable |
| Keeping both recordings in sync | Medium | Clocks and frame rates drift over an hour |

## Architecture at a glance

&#91;embedded content: architecture · two browsers, two small servers\]

The live call is only for talking; the episode is made from each person's local recording, which reaches the host after the call. The editor box is where your show's needs mostly live.

## Components

**1. The call.** Host and guest connect with WebRTC, the browser's built-in peer-to-peer video. A small signaling server (a WebSocket) introduces them; then video flows directly between browsers. A TURN relay (coturn, open source) carries traffic when a firewall blocks the direct path. The call isn't used for the final video, so it gives way to the recording when resources run short, but otherwise runs at the best quality the connection allows.

**2. Local recording.** Each browser records its own camera and mic at full quality with `MediaRecorder`, independent of the call. Chunks are written every few seconds to the browser's private disk storage (the Origin Private File System), so a crash loses seconds, not the episode. Request persistent storage so the browser doesn't evict files, and keep the screen awake with the Wake Lock API.

**3. File transfer.** Each guest's recording goes to the host automatically, peer-to-peer over a WebRTC data channel, in the background while recording (throttled so the call always wins), resuming after interruptions. The host can connect their own Google Drive; the host's browser then copies every finished recording there, the host's own and every guest's. Guests never deal with cloud storage. See [ADR 0002](../adr/0002-guests-send-to-host-host-saves-to-drive.md).

**4. Sync.** Both browsers start recording on a shared signal from the host and log timestamps against a common clock. A visible clap or tone at the start gives a fallback for lining tracks up by hand or by matching audio. Re-encoding to a constant frame rate fixes most drift.

**5. Editing.** Transcribe each track in the browser with a Whisper model through Transformers.js on WebGPU, which can return word-level timestamps. The editor shows the transcript: deleting words or selecting a pause creates a cut. Silence detection is simple audio math: find stretches below a volume threshold longer than about half a second, and offer to remove them. Under the hood, the edit is just a list of keep/cut ranges, never a modified file, so undo is free.

**6. Export.** Render the keep-ranges into a finished MP4 with Mediabunny, an open-source library that reads and writes video using the browser's hardware encoders (WebCodecs). For a two-person show, lay the tracks side by side, or switch to whoever is speaking using the transcript. Also export an audio-only file for podcast feeds, plus the transcript for your Substack post.

**7. Storage and sharing.** Projects live in the host's browser. Export the project file to back it up or to move it between computers. No accounts are needed for the first version.

## The hard parts

Riverside's real product is reliability: an hour-long interview that never gets lost. Most of the engineering goes there.

- **Browsers aren't built for hour-long recordings.** Tabs get throttled or put to sleep in the background, laptops sleep, and a guest may close the tab before their upload finishes. Every one of these needs a recovery path.
- **Safari behaves differently.** Its `MediaRecorder` output formats and storage limits differ from Chrome's, and many guests will be on iPhones or Macs. Budget real time for testing here.
- **Storage limits.** An hour of 1080p video can be several gigabytes. Browsers cap how much a site can store, and caps vary by browser and free disk space.
- **Moving the guest's file.** Large, resumable transfers over home internet are the most fragile step.
- **Memory when exporting.** Long files must be processed in a stream, not loaded whole, or the tab crashes.
- **Transcription speed.** Whisper in the browser is fast on a recent laptop with a GPU and slow on older machines. Offer a smaller model as a fallback.
- **Guest experience.** The guest must click a link and have it just work: no install, clear permission prompts, a mic check, and a visible "don't close this tab" message until their upload finishes.

What each of these takes to implement: [Hard parts in depth](Hard%20parts%20in%20depth.md)

## What it costs to run

Because users' computers do the heavy work, the costs are small and mostly scale with how many calls need the relay. Figures below are approximate, from memory, not quoted prices.

| Piece | What it does | Rough cost |
| --- | --- | --- |
| Static site | Serves the app | Free tiers (GitHub Pages, Cloudflare Pages) |
| Signaling server | Introduces browsers to each other | A few dollars a month on a small server |
| TURN relay | Carries video when firewalls block direct connections | Grows with usage; only some calls need it |
| Google Drive (optional) | Keeps every recording safe outside the browser | Free to run; uses the host's own Drive storage |
| Transcription and export | Runs in each user's browser | Free |

The relay is the cost to watch at scale. VDO.Ninja covers its relay through sponsors, which is one model for keeping a tool like this free.

## Build plan

Each phase is usable on its own, so you can record real episodes while building the next. Phases 1 and 2 cover your first solo episode.

1. **Solo recorder.** Camera and mic to a crash-safe local file, with a level meter and a countdown. Done when you can record your first episode and never lose a take.
2. **Simple cutter.** Waveform view, mark-and-delete ranges, automatic "remove pauses longer than X", export MP4 and audio-only.
3. **Transcript editing.** In-browser Whisper, a clickable transcript, delete words to cut. Export the transcript for Substack.
4. **Two-person calls.** Peer-to-peer call with signaling and a relay, each side recording locally, a guest page that needs no account.
5. **Reliable guest transfer.** Automatic peer-to-peer transfer to the host during recording, resumable, progress shown to both sides, recovery after a crash or closed tab. (Saving to Google Drive arrives earlier, as a follow-up to phase 1.)
6. **Two-track editing.** Line tracks up, side-by-side or active-speaker layout, one cut list across both tracks.
7. **Polish.** Safari support, smaller models for older machines, loudness leveling, captions export.

A shortcut for phases 4 and 5: use VDO.Ninja for the call at first and have each person record locally with your phase 1 recorder. That lets you skip straight to the editing work, which is where your show's needs are.

## Building blocks and decisions

| Need | Open-source piece | Notes |
| --- | --- | --- |
| Calls, or a reference design | [VDO.Ninja](https://docs.vdo.ninja/readme/why-use-vdo-ninja-over-other-solutions) | Free, open source, peer-to-peer; its relay is sponsor-funded |
| Relay server | coturn | The standard open-source TURN server |
| Reading and writing video | [Mediabunny](https://mediabunny.dev/guide/introduction) | MPL-2.0; uses the browser's hardware encoders; far faster than ffmpeg.wasm in its own benchmarks |
| Transcription | [Transformers.js](https://huggingface.co/docs/transformers.js) Whisper; [@remotion/whisper-webgpu](https://remotion.dev/docs/whisper-webgpu) | Word-level timestamps on WebGPU; the model downloads once and is cached |
| Fallback for odd formats | ffmpeg.wasm | Slow, but handles almost anything |

**Decisions so far**

- [x] **Browsers:** Chrome, Edge, Firefox and other Chromium browsers first. Safari waits until enough users ask for it. The guest page should detect Safari and say plainly that it isn't supported yet.
- [x] **File transfer:** guests send their recordings to the host automatically, peer-to-peer, while recording. The host can connect their own Google Drive, and every recording (the host's takes and every guest's) is copied there from the host's browser. The earlier bring-your-own S3 bucket option is dropped. See [ADR 0002](../adr/0002-guests-send-to-host-host-saves-to-drive.md).
- [x] **Open source from day one,** license: AGPL-3.0 recommended (see the reply in chat for alternatives). Its dependencies (Mediabunny under MPL-2.0, Transformers.js under Apache-2.0) are generally considered compatible, but confirm before release.
- [x] **No accounts, ever, by design.** Links do the work instead: each session has an unguessable host link and a separate guest link, so possessing the link is the permission. Relay abuse is handled by short-lived TURN credentials plus rate limits on the signaling server. Projects live in the host's browser, so the app needs a clear export-and-backup option, and warns that clearing browser data deletes recordings. Revisit only if a future feature truly needs it, such as syncing projects across computers.
- [ ] **Ownership and funding:** undecided. Options to weigh later: you alone, sponsors (as VDO.Ninja does), or a co-op of the podcasters who rely on it.

Sources: [Mediabunny introduction](https://mediabunny.dev/guide/introduction) · [Mediabunny homepage](https://mediabunny.dev/) · [Remotion: Whisper WebGPU](https://remotion.dev/docs/whisper-webgpu) · [VDO.Ninja docs](https://docs.vdo.ninja/readme/why-use-vdo-ninja-over-other-solutions)

Ready-to-paste brief for building phases 1 and 2: [Handoff brief](Handoff%20brief.md)
