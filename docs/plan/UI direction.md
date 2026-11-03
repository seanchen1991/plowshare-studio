# UI direction

Chosen on 2026-11-03 from four prototyped directions (variant D, "Canvas + lanes"). References: Descript's editor (white workspace, waveform strip) and Hindenburg's parallel track lanes. Borrow patterns, never their screens, icons or branding. Terms follow [`CONTEXT.md`](../../CONTEXT.md); "take" is fine in UI copy for a Session.

## Principles

- **Light only.** A white workspace with soft grey panels. No dark theme.
- **Calm and roomy.** Thin top bars, generous space, one primary action per screen.
- **Removed material stays visible.** A Cut is shown in place, never hidden, so it is easy to spot and undo.
- **Built for four people.** Every Track-based view holds a host plus up to 3 guests, even while phase 1–2 show one or two.

## Layout

A top bar holds the name on the left, **Record · Takes · Edit** tabs (a segmented control) in the middle, and Recording time left on the right ("Room for about 4 h 10 m").

### Record

Centered column: a large 16:9 camera preview; the camera and mic as pill-shaped pickers below it, with a "Clean up audio" pill; a live waveform of the mic with its level status ("Level good"); one round **Record** button (red dot), with "Press Space to start · 3-2-1 countdown" under it. While capturing: elapsed time and how much is saved. After stop, the user stays here (the take finalizes in the background, shown in Takes).

### Takes

A list, one row per Session: title with date, size and resolution under it; a small waveform thumbnail; duration; a state chip (Capturing, Finalizing with %, Ready, Interrupted); a "Not backed up" badge when it applies; actions at the end of the row: Play, Download, **Edit** (primary), or **Recover** for an Interrupted take.

### Edit (phase 2)

- **Toolbar:** skip back and forward, timecode (`00:00.0 / 28:35.7`), Play, speed, Split, Remove pauses, zoom. No Record button: recording always starts from the Record screen.
- **Video** centered above the timeline.
- **Timeline:** a ruler, then a **chip row** holding pause chips ("1.2s") and Suggested cuts ("Pause · Cut?", "Capture gap · Cut?"), then **one lane per Track**:
  - Lane header (200 px, grey): color swatch, name and role, mute, solo, volume, input device.
  - Lane body: a mirrored waveform of thin rounded bars in the Track's color.
- **Cuts** are bands through every lane (a Cut applies to every Track): accepted Cuts as a light grey band with solid edges, with the waveform inside it greyed; Suggested cuts as a pale amber band with dashed edges.
- The playhead is a dark line through all lanes.

### Edit (phase 3, transcript)

The area above the timeline splits in two: the **transcript** on the left, laid out as a conversation (one paragraph per turn, speaker name in the Track's color, timestamp), with removed words struck through; the **video** on the right, smaller. Each lane gains a row of word or phrase chips above its waveform, struck through inside Cuts; the timeline zooms in far enough for them to be readable. The timeline itself is unchanged, so phase 2 should build the area above it to allow this split later. Open question for phase 3: on a laptop screen, transcript, video and four lanes compete for height (collapsing the video is one answer).

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| ink | `#1d1b22` | text, primary buttons, playhead |
| muted | `#77727f` | secondary text |
| line | `#ececf0` | borders, dividers |
| soft | `#f6f5f8` | panels, lane headers, segmented control |
| record | `#e5484d` | record dot, errors |
| track 1–4 | `#2f8f83` teal, `#d0805a` coral, `#5b6fd0` indigo, `#b8913a` ochre | waveforms and swatches, in Participant order (host first) |
| ready | `#e3f3ef` on `#23705f` | Ready chip |
| working | `#fff3dc` on `#8a5a00` | Finalizing chip, "Not backed up", Suggested cuts (border `#e0b45c`) |
| problem | `#fde3e4` on `#a8282d` | Interrupted chip |
| cut | `rgb(120 110 130 / 0.1)`, edges `#b9b3c2` | accepted Cut band |

Type: the system UI font at 14 px (12 px for small text, 11 px for ruler and chips); tabular figures for every time and size; monospace for the editor timecode. Corners: 999 px for pills and chips, 12 px for video, 6–8 px for buttons and panels.
