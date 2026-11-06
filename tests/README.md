# Tests

Four suites, from fastest to the ones that need a real computer.

| Command | What it checks | Where it runs |
|---|---|---|
| `pnpm test` | Unit tests: pure logic, and test helpers such as the beep detector | Everywhere, CI on every push |
| `pnpm test:e2e` | The app in Chrome and Firefox with fake devices (Chrome plays the fixture video and beeps as its camera and mic). Tests tagged `@long` run only with `LONG_TESTS=1` | CI on every push; long tests weekly |
| `pnpm test:review` | Screenshots of every screen and state at 1280, 1024 and 390 px wide, in both browsers | macOS, before handing an issue over |
| `pnpm test:hardware` | Records with this computer's real camera and mic, and checks the file | A machine with a camera and mic |

Playwright tests that open a camera or mic hang inside Claude Code's sandbox; run them outside it.

## Review screenshots

`pnpm test:review` writes every screenshot to `test-results-review/gallery/<browser>/<width>/`, for a person or agent to look over. The screens that don't move (Takes, menus, dialogs, the blocked-camera screen) are also compared with saved copies in `tests/review/screenshots/`, so a change to how they look fails. Comparisons run on macOS only, since other systems draw fonts differently. When a change is intended, look at the new screenshots, then accept them with `pnpm test:review --update-snapshots` and commit them.

Add a state to `tests/review/gallery.spec.ts` whenever an issue adds one to the UI.

## Real devices

`pnpm test:hardware` uses the camera and mic the app picks, in Chrome and Firefox, with no permission prompts. The first run from a new terminal app may make macOS ask for camera and microphone access. Each test writes a `report.json` (devices, frames kept, sound level, beeps heard), stills from the take, screenshots and a video of the page to `test-results-hardware/`.

- During the take, the fixture's beeps play on the speakers, and the test checks that the mic hears one every second. `HARDWARE_SPEAKER=0` skips that.
- `HARDWARE_MIC="part of a name"` records with a particular mic. On a Mac with the lid closed, the built-in mic is still listed but records silence.
- `HARDWARE_SECONDS` sets the take's length (default 20).

Things only a person can check stay on the hardware checklist in issue 15: unplugging a USB mic, closing the lid mid-take, whether the screen actually stays on, and how a take sounds.
