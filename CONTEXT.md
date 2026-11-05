# Plowshare Studio

A free, browser-only tool for recording video podcasts and cutting them into episodes. Everything is captured, stored and edited on the user's own computer.

## Language

### Capture

**Session**:
One start-to-stop capture of a conversation, holding one **Recording** per **Participant** on a shared clock.
_Avoid_: Call, studio, room

**Take**:
A person's word for a **Session** made as one attempt among several; the same thing as a Session, fine in UI copy.

**Participant**:
A person captured in a **Session**, with the role host or guest.
_Avoid_: Speaker, user

**Recording**:
Everything one **Participant** captured during one **Session**.
_Avoid_: Source, file

**Segment**:
One unbroken stretch of capture inside a **Recording**, ending only when a device drops out; never changed by editing.
_Avoid_: Clip, chunk, piece (for anything produced by editing)

**Capturing** / **Paused** / **Finalizing** / **Ready** / **Interrupted**:
The states of a **Recording**: being captured; stopped by a device drop or sleep and waiting for the user to resume; being turned into a finished, seekable file after stop or recovery; finished and usable; or cut off by a crash and not yet recovered.
_Avoid_: "Recording" as a state name (it is the noun), processing, saved

**Capture gap**:
The stretch of a **Session**'s timeline between two **Segments** where nothing was captured.
_Avoid_: Dropout, hole, silence (silence is captured audio)

**Backed up**:
A **Session** whose **Recordings** have had every **Segment** stored outside the browser, by download or by copying to the connected Google Drive; it backs up the footage, not the Session's timing.
_Avoid_: Saved, exported (export makes an episode from a Project), synced

**Recording time left**:
How much longer capture can run before the disk can no longer hold both the raw and the finished copy of the current **Recording**.
_Avoid_: Quota, free space (those are inputs to it)

### Editing

**Project**:
One edit, made of an ordered list of **Sessions** played end to end.
_Avoid_: Episode (an episode is what a Project exports), edit

**Track**:
One **Recording**'s lane within a **Session** in the editor.
_Avoid_: Source, layer

**Cut**:
A range of a **Session**'s timeline chosen for removal, applied to every **Track** in it.
_Avoid_: Segment, deletion

**Suggested cut**:
A **Cut** the app proposes (from a pause or a **Capture gap**) that only takes effect once the user accepts it.
_Avoid_: Auto-cut, detected silence

**Kept range**:
A stretch of a **Session** that falls between **Cuts**; derived, never stored.
_Avoid_: Segment, clip

## Relationships

- A **Session** has one or more **Participants**, each with exactly one **Recording** in it
- A **Recording** has one or more **Segments**, laid end to end with any capture gaps preserved
- A **Project** holds an ordered list of one or more **Sessions**; a Session appears at most once per Project
- A **Session** can be used by many **Projects**
- A **Cut** belongs to exactly one **Session** within one **Project**, and never crosses into the next Session
- Adding or removing **Cuts** never changes a **Recording** or its **Segments**
- Recording creates a **Session**; only opening Sessions in the editor creates a **Project**
- Each **Recording** has its own state; a **Session** is Ready only when all its Recordings are
- A device drop closes the current **Segment** and **Pauses** the Recording; resuming starts a new Segment in the same Recording, leaving a **Capture gap**
- Every **Capture gap** is offered as a **Suggested cut**
- Recovering an **Interrupted** Recording sends it through **Finalizing**, like a normal stop

## Example dialogue

> **Dev:** "The user ran silence removal and got 30 **Cuts** — does that split the **Recording** into 31 **Segments**?"
> **Domain expert:** "No. **Segments** only come from capture interruptions, like an unplugged mic. The 30 **Cuts** live in the **Project**; the **Kept ranges** between them are worked out on the fly."
>
> **Dev:** "The host liked the intro of take 2 and the rest of take 3. Is that two **Projects**?"
> **Domain expert:** "One **Project** holding both **Sessions** in order: a **Cut** over the end of take 2 and a **Cut** over the intro of take 3."

## Flagged ambiguities

- "take" and "recording" were used interchangeably — resolved: a take is a **Session**; a **Recording** is one Participant's capture within it. In solo use they coincide.
- "segment" risked meaning both a capture interruption and a piece left after editing — resolved: **Segment** is capture-only; editing produces **Cuts** and **Kept ranges**.
- "Recording" was proposed as both the noun and the in-progress state — resolved: the state is **Capturing**.
- The Brief's data model calls Recordings in a Project `sources` — resolved: replaced by **Sessions** containing **Tracks**.
