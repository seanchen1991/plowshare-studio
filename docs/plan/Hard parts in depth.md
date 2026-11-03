# Hard parts in depth

> Background on *why*. For phases 1–2, the [Handoff brief](Handoff%20brief.md) is the source of truth and overrides this document where they differ. Terms are defined in [`CONTEXT.md`](../../CONTEXT.md).

What Riverside-style tools actually charge for is reliability: every second of an hour-long interview, from every participant, at full quality, lined up correctly. Each problem below has three parts: what goes wrong, what Plowshare Studio needs to implement, and which build phase it belongs to.

## 1. Recordings that never get lost

The whole product rests on this: if the browser crashes at minute 47, you lose a few seconds, not the episode. Phase 1 builds most of it, and phase 4 extends it to guests.

**What goes wrong**

- The tab crashes, the browser is force-quit, or the computer restarts for an update.
- The laptop sleeps or the lid closes, which stops the camera and mic tracks.
- A USB mic or camera gets unplugged or grabbed by another app, which ends that track silently.
- The recording is held in memory until the end, so a long session exhausts RAM.
- The browser evicts stored data under disk pressure, or the disk fills up.
- A file cut off mid-write won't open, because the WebM `MediaRecorder` produces has no duration or seek index until it is finalized.

**What to implement**

1. **Write every chunk to disk as it arrives.** Use `MediaRecorder` with a timeslice of a few seconds. Hand each chunk to a Web Worker that appends it to an OPFS file through a synchronous access handle, which is faster and only available in workers. Never keep chunks in memory.
2. **Keep a manifest next to the file.** After each chunk, record its byte offset, its timestamp and the recording's state (recording, stopped, finalized). This is the source of truth for recovery and, later, for transfer.
3. **Recover on startup.** If a manifest says "recording" but no recording is running, offer recovery. Trim the file back to the last complete chunk, then remux it with Mediabunny into a finalized file with a correct duration and seek index.
4. **Segment instead of failing.** Listen for each track's `ended` event and for device changes. If the mic or camera drops, close the current segment, tell the user immediately, and start a new segment when the device returns. The project then holds several segments for one source, laid end to end on the timeline.
5. **Fight sleep.** Hold a screen Wake Lock while recording, re-acquire it when the tab becomes visible again, and warn before the tab is closed.
6. **Budget storage before starting.** Call `navigator.storage.persist()` so the browser won't evict recordings, and `navigator.storage.estimate()` to check free space. Set an explicit video bitrate so file size is predictable: at 6 megabits per second, an hour is about 2.7 GB. Refuse to start, or offer a lower quality, if the estimate doesn't fit with a safety margin. Private windows have tiny quotas: detect them and say so.
7. **Clean up deliberately.** Delete recordings only when the user asks, or after a transfer is confirmed, never automatically on a timer.

## 2. Getting the guest's file to you

The guest's recording can be several gigabytes, sitting on someone else's computer and home internet, and it has to reach you whole. Phase 5.

**What goes wrong**

- The guest closes the tab the moment the call ends, before anything has transferred.
- The connection drops halfway through a multi-gigabyte transfer.
- Sending a large file during the call steals bandwidth from the call.
- A chunk arrives corrupted or out of order, and nobody notices until editing.

**What to implement**

1. **Transfer progressively, during the call.** Riverside-style tools upload while you talk, so most of the file has arrived by the end. Send finished chunks in the background, but throttle them: watch the call's connection stats and pause when bandwidth is tight. The call always wins.
2. **Make every chunk resumable.** Reuse the manifest from section 1. Each chunk has an index and a SHA-256 hash (computed with the browser's built-in `crypto.subtle`). The receiver acknowledges chunks it has verified, the sender keeps a record of acknowledgments in OPFS, and after any interruption, a reloaded tab or a reconnect, the transfer resumes from the first unacknowledged chunk.
3. **Peer-to-peer path (the free default).** Send over a WebRTC data channel in small messages, tens of kilobytes each. Respect backpressure: stop sending when the channel's buffer is full, and resume on its "buffer low" event, or the tab will balloon in memory. This path needs both tabs open, so the host's tab must also stay open until the transfer finishes.
4. **Bring-your-own-bucket path.** *Superseded by [ADR 0002](../adr/0002-guests-send-to-host-host-saves-to-drive.md): guests only send to the host, and the host's browser saves to Google Drive. Kept for reference.* Use the S3 multipart upload protocol, which R2, B2 and S3 all support. The host's browser holds the credentials, starts the upload, and signs per-part upload URLs that it sends to the guest over the data channel. The guest uploads parts directly to the bucket and reports each part's ETag back. Parts must be at least 5 MB except the last one. The bucket's CORS rule must allow the app's address and expose the `ETag` header, or the browser hides it. The host completes the upload with the collected ETags. With this path, the host's tab doesn't need to stay open, as long as enough part URLs were signed in advance with a long enough expiry.
5. **Verify at the end.** The host checks that every chunk arrived and every hash matches before marking the recording "complete". Only then does the guest's page say it's safe to close.

## 3. Keeping two recordings in sync

Two computers record separately, so their files don't share a starting point or a clock. If they're misaligned by even a fraction of a second, one person seems to answer before the other finishes. Phases 4 and 6.

**What goes wrong**

- Each recorder starts at a slightly different moment, since the "start" message takes time to arrive.
- The two computers' clocks disagree.
- Each computer's audio hardware runs at a very slightly different real speed, so tracks that line up at minute 1 can be noticeably apart by minute 60. This is drift.
- `MediaRecorder` video often has a variable frame rate, so counting frames gives the wrong time.

**What to implement**

1. **Measure the clock offset.** Over the data channel, exchange a handful of timestamped ping-pong messages and estimate each guest's clock offset from the samples with the shortest round trip. This is how NTP works. Store the offset with the recording.
2. **Timestamp everything against a shared timeline.** When recording starts, each side logs its local time at its first chunk. With the offset, both tracks can be placed on one timeline to within a few milliseconds.
3. **Record a reference track.** The host also records the incoming call audio from the guest at call quality. It's low fidelity, but it's on the host's clock, which gives a robust fallback: line up the guest's high-quality audio against the reference by cross-correlation. This is standard signal-processing math that finds the offset where the two waveforms match best. It also catches mistakes in the clock method.
4. **Correct drift.** Measure the offset near the start and near the end of the recording, using the reference track. If they differ, stretch or resample the guest's track very slightly so both line up throughout. For long recordings, measure at several points along the way.
5. **Use timestamps, not frame counts.** When editing and exporting, place every video frame by its own timestamp, and output a constant frame rate. Mediabunny exposes per-frame timestamps, which makes this possible.

## 4. The call itself

The call only has to be good enough to talk over, but it can't get in the way of the recording. Phase 4.

**What goes wrong**

- Office, school and some home networks block direct peer-to-peer connections, so the call never connects.
- An open relay server gets found and abused by strangers, running up the bandwidth bill.
- On an older laptop, encoding the call and the recording at the same time maxes out the CPU, and the recording stutters.
- Without headphones, each person's mic picks up the other person from their speakers, causing echo in the recording.

**What to implement**

1. **Connection fallbacks.** Use public STUN servers for the common case. Run coturn as the TURN relay for blocked networks, including TLS on port 443, which gets through most corporate firewalls because it looks like ordinary web traffic.
2. **Short-lived relay credentials.** The signaling server hands each session TURN credentials that expire after a few hours, signed with a secret shared with coturn. This is a standard coturn feature, and it stops strangers from using the relay for free.
3. **Best call quality the conditions allow.** Don't fix the call at a low quality. Set a ceiling per stream and let WebRTC's built-in congestion control adapt below it. Rough ceilings, to tune in testing: with one guest, up to 720p video, about 1.5–2.5 megabits per second; with 2–3 guests, each person sends a separate stream to every other, so lower each to about 540p and 0.8–1.2 megabits per second. Voice uses Opus at 32–64 kilobits per second, which sounds close to the in-person quality. Apply ceilings with the sender's encoding parameters (`RTCRtpSender.setParameters`, with `scaleResolutionDownBy` and `maxBitrate`), while the recorder keeps the full-quality track. Step quality down only when `getStats()` shows the outgoing video limited by CPU or bandwidth, and step back up when that clears. Priority when resources are short: the local recording first, then call audio, then call video, then the background transfer.
4. **Echo handling as a choice.** Turn on the browser's echo cancellation, noise suppression and automatic gain by default, since they prevent echo without headphones. Offer an "I'm wearing headphones" switch that turns them off, which gives a cleaner, more natural recording. Recommend headphones on the guest's setup page.

## 5. Guest experience and safety nets

Your guests aren't technical, have never seen the tool, and get one chance. Most failures in practice come from setup, not code. Phases 4 and 5.

**What to implement**

1. **A pre-flight page.** Before joining, the guest sees: a browser check (with the "please use Chrome, Edge or Firefox" message from the decisions list), camera preview, a mic level meter, a speaker test, a free-space check against the expected file size, and a quick network test. Each shows a clear pass or fix-it message.
2. **Plain-language permission help.** When camera or mic access is blocked, show browser-specific steps to re-enable it. This is the most common failure for first-time guests.
3. **Unmistakable states.** The guest always sees one of: recording, uploading (with progress), or "all done, safe to close". While anything is unsent, closing the tab triggers a warning.
4. **The host sees everything.** A small panel for each guest shows recording state, free space and transfer progress, so problems surface during the interview instead of afterward.
5. **A fallback copy.** The host's reference recording of the call (section 3) doubles as a safety net. If a guest's file never arrives, you still have their audio and video at call quality. It's worse, but it's an episode. Riverside-style tools work the same way.
6. **A rescue link.** If a guest's transfer stalls after the call, the host can send a link that reopens the guest's page and resumes the transfer from their stored copy, as long as they use the same browser on the same computer.

## 6. Testing the hard parts

These failures happen in long sessions on messy networks, so they won't show up in a quick manual test. Build the harness alongside phase 1 and grow it each phase.

| Test | How | Catches |
| --- | --- | --- |
| Fake devices | Playwright with Chrome's fake camera and mic flags, fed a known video file with an on-screen timecode and regular beeps | Recording and export regressions, automatically |
| Crash recovery | Kill the browser process mid-recording, relaunch, run recovery, check the duration | Lost data after crashes |
| Long sessions | Record for 60–90 minutes on a schedule, overnight | Memory leaks, storage growth, drift |
| Bad networks | Run two browsers in containers with Linux traffic shaping (`tc netem`) adding loss, delay and drops | Transfer resumption, call fallbacks |
| Sync accuracy | Record the beep-and-timecode file on two "participants", export, and measure how far apart the beeps land | Alignment and drift correction |
| Real hardware | A short manual checklist on an older laptop, a USB mic unplugged mid-take, a laptop lid closed mid-take | What emulation misses |

The beep-and-timecode file is the most useful single tool here. It makes "is it in sync?" a number instead of a judgment.
