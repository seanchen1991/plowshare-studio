import { describe, expect, it } from 'vitest';
import {
	newId,
	newSession,
	recordingDurationUs,
	segmentPaths,
	sessionFilePath,
	sessionState,
	updateRecording,
	updateSegment,
	markInterrupted,
	type AudioSettings,
	type Session
} from './session-file.ts';

const audio: AudioSettings = { codec: 'opus', channels: 1, sampleRate: 48000, bitrate: 128000, processing: false };
const video = { codec: 'avc', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 };
const now = new Date('2026-11-03T12:00:00Z');

function session(): Session {
	return newSession({ now, random: () => 0.5, video, audio });
}

describe('newSession', () => {
	it('holds one host Recording, Capturing, with its first Segment', () => {
		const s = session();
		expect(s.version).toBe(1);
		expect(s.createdAt).toBe('2026-11-03T12:00:00.000Z');
		expect(s.recordings).toHaveLength(1);
		const [recording] = s.recordings;
		expect(recording!.participant).toEqual({ id: 'par_host', role: 'host' });
		expect(recording!.state).toBe('capturing');
		expect(recording!.video).toEqual(video);
		expect(recording!.segments).toEqual([
			{
				index: 1,
				path: null,
				rawPath: `sessions/${s.id}/rec_01/seg-01.raw`,
				manifestPath: `sessions/${s.id}/rec_01/seg-01.manifest.jsonl`,
				startUs: 0,
				durationUs: null,
				downloaded: false,
				frames: null
			}
		]);
	});

	it('allows audio-only takes', () => {
		expect(newSession({ now, video: null, audio }).recordings[0]!.video).toBeNull();
	});
});

describe('ids and paths', () => {
	it('makes ids that sort by time', () => {
		const earlier = newId('ses', new Date(1_000), () => 0.9);
		const later = newId('ses', new Date(2_000_000), () => 0.1);
		expect(earlier).toMatch(/^ses_[0-9a-z]+$/);
		expect(earlier < later).toBe(true);
	});

	it('lays files out per Session and Recording', () => {
		expect(sessionFilePath('ses_1')).toBe('sessions/ses_1/session.json');
		expect(segmentPaths('ses_1', 'rec_01', 12).finishedBase).toBe('sessions/ses_1/rec_01/seg-12');
	});
});

describe('updates', () => {
	it('changes one Recording and Segment without touching the original', () => {
		const before = session();
		const after = updateRecording(before, 'rec_01', (r) =>
			updateSegment({ ...r, state: 'ready' }, 1, (s) => ({ ...s, path: 'x.mp4', durationUs: 5_000_000 }))
		);
		expect(after.recordings[0]!.state).toBe('ready');
		expect(after.recordings[0]!.segments[0]!.path).toBe('x.mp4');
		expect(before.recordings[0]!.state).toBe('capturing');
	});

	it('refuses unknown Recordings and Segments', () => {
		expect(() => updateRecording(session(), 'rec_99', (r) => r)).toThrow();
		expect(() => updateSegment(session().recordings[0]!, 9, (s) => s)).toThrow();
	});
});

describe('sessionState', () => {
	it('is Ready only when every Recording is', () => {
		const s = session();
		const guest = { ...s.recordings[0]!, id: 'rec_02', state: 'finalizing' as const };
		const both = { ...s, recordings: [{ ...s.recordings[0]!, state: 'ready' as const }, guest] };
		expect(sessionState(both)).toBe('finalizing');
		expect(sessionState({ ...both, recordings: [both.recordings[0]!, { ...guest, state: 'ready' }] })).toBe('ready');
	});

	it('shows Interrupted ahead of anything else', () => {
		const s = session();
		const interrupted = { ...s.recordings[0]!, id: 'rec_02', state: 'interrupted' as const };
		expect(sessionState({ ...s, recordings: [s.recordings[0]!, interrupted] })).toBe('interrupted');
	});
});

describe('markInterrupted', () => {
	const withState = (state: Session['recordings'][number]['state'], id = 'rec_01') => ({ ...session().recordings[0]!, id, state });

	it('marks unfinished Recordings that nothing is working on', () => {
		const s = { ...session(), recordings: [withState('capturing'), withState('finalizing', 'rec_02'), withState('paused', 'rec_03')] };
		expect(markInterrupted(s, () => false).recordings.map((r) => r.state)).toEqual(['interrupted', 'interrupted', 'interrupted']);
	});

	it('leaves Recordings that are still running elsewhere', () => {
		const s = { ...session(), recordings: [withState('capturing'), withState('finalizing', 'rec_02')] };
		expect(markInterrupted(s, (id) => id === 'rec_01').recordings.map((r) => r.state)).toEqual(['capturing', 'interrupted']);
	});

	it('leaves Ready and Interrupted Recordings alone', () => {
		const s = { ...session(), recordings: [withState('ready'), withState('interrupted', 'rec_02')] };
		expect(markInterrupted(s, () => false)).toEqual(s);
	});
});

describe('recordingDurationUs', () => {
	it('is unknown until the last Segment has a duration', () => {
		expect(recordingDurationUs(session().recordings[0]!)).toBeNull();
	});

	it('runs to the end of the last Segment, including Capture gaps', () => {
		const recording = {
			...session().recordings[0]!,
			segments: [
				{ ...session().recordings[0]!.segments[0]!, durationUs: 10_000_000 },
				{ ...session().recordings[0]!.segments[0]!, index: 2, startUs: 15_000_000, durationUs: 5_000_000 }
			]
		};
		expect(recordingDurationUs(recording)).toBe(20_000_000);
	});
});
