import { describe, expect, it } from 'vitest';
import { defaultSilence, newProject, projectFilePath, soloProjectFor, type Project } from './project-file.ts';
import type { Session } from './session-file.ts';

const session = { id: 'ses_01', title: 'Take 3' } as Session;
const now = new Date('2026-11-07T18:00:00Z');

describe('newProject', () => {
	it('holds the one Session with no Cuts, named after it, with the silence defaults', () => {
		const project = newProject({ now, random: () => 0, session });
		expect(project).toEqual({
			version: 1,
			id: expect.stringMatching(/^proj_/),
			title: 'Take 3',
			createdAt: '2026-11-07T18:00:00.000Z',
			sessions: [{ sessionId: 'ses_01', cuts: [] }],
			silence: { thresholdDb: -45, minLengthMs: 700, paddingMs: 150 }
		});
		// Its own copy of the defaults.
		expect(project.silence).not.toBe(defaultSilence);
		expect(projectFilePath(project.id)).toBe(`projects/${project.id}/project.json`);
	});
});

describe('soloProjectFor', () => {
	const project = (id: string, createdAt: string, sessionIds: string[]) =>
		({ id, createdAt, sessions: sessionIds.map((sessionId) => ({ sessionId, cuts: [] })) }) as unknown as Project;

	it('is the newest Project holding just that Session', () => {
		const projects = [
			project('old', '2026-11-01T00:00:00Z', ['ses_01']),
			project('both', '2026-11-05T00:00:00Z', ['ses_01', 'ses_02']),
			project('new', '2026-11-03T00:00:00Z', ['ses_01']),
			project('other', '2026-11-06T00:00:00Z', ['ses_02'])
		];
		expect(soloProjectFor(projects, 'ses_01')?.id).toBe('new');
	});

	it('is null when no Project holds just that Session', () => {
		expect(soloProjectFor([project('both', '2026-11-05T00:00:00Z', ['ses_01', 'ses_02'])], 'ses_01')).toBeNull();
	});
});
