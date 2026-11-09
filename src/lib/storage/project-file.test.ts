import { describe, expect, it } from 'vitest';
import {
	addSessions,
	defaultSilence,
	moveSession,
	newProject,
	projectFilePath,
	projectsUsing,
	removeSession,
	soloProjectFor,
	type Project,
	type ProjectSession
} from './project-file.ts';
import type { Session } from './session-file.ts';

const session = { id: 'ses_01', title: 'Take 3' } as Session;
const now = new Date('2026-11-07T18:00:00Z');

describe('newProject', () => {
	it('holds the one Session with no Cuts, named after it, with the silence defaults', () => {
		const project = newProject({ now, random: () => 0, sessions: [session] });
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

describe('newProject from several takes', () => {
	it('holds them in order, named after the first', () => {
		const sessions = [session, { id: 'ses_02', title: 'Take 4' }, { id: 'ses_03', title: 'Take 5' }] as Session[];
		const project = newProject({ now, random: () => 0, sessions });
		expect(project.title).toBe('Take 3 and 2 more');
		expect(project.sessions.map((s) => s.sessionId)).toEqual(['ses_01', 'ses_02', 'ses_03']);
	});

	it('holds each Session once', () => {
		expect(newProject({ now, sessions: [session, session] }).sessions).toHaveLength(1);
	});
});

describe('changing the Sessions in a Project', () => {
	const cut = { startUs: 0, endUs: 1, reason: 'manual', accepted: true } as const;
	const list: ProjectSession[] = [
		{ sessionId: 'a', cuts: [cut] },
		{ sessionId: 'b', cuts: [] },
		{ sessionId: 'c', cuts: [] }
	];
	const ids = (l: ProjectSession[]) => l.map((s) => s.sessionId);

	it('adds Sessions at the end, at most once each', () => {
		expect(ids(addSessions(list, ['d', 'a', 'd']))).toEqual(['a', 'b', 'c', 'd']);
		expect(addSessions(list, ['a'])[0]!.cuts).toEqual([cut]);
	});

	it('removes a Session with its Cuts', () => {
		expect(removeSession(list, 'a')).toEqual([list[1], list[2]]);
		expect(removeSession(list, 'x')).toEqual(list);
	});

	it('moves a Session, keeping its Cuts', () => {
		expect(ids(moveSession(list, 0, 2))).toEqual(['b', 'c', 'a']);
		expect(moveSession(list, 0, 2)[2]!.cuts).toEqual([cut]);
		expect(ids(moveSession(list, 2, 0))).toEqual(['c', 'a', 'b']);
		expect(ids(moveSession(list, 1, 9))).toEqual(['a', 'c', 'b']);
		expect(moveSession(list, 1, 1)).toBe(list);
	});

	it("doesn't change the list it was given", () => {
		moveSession(list, 0, 2);
		addSessions(list, ['d']);
		expect(ids(list)).toEqual(['a', 'b', 'c']);
	});

	it('finds the Projects using a Session', () => {
		const projects = [
			{ id: 'p1', sessions: [{ sessionId: 'a', cuts: [] }] },
			{ id: 'p2', sessions: [{ sessionId: 'b', cuts: [] }] },
			{ id: 'p3', sessions: [{ sessionId: 'b', cuts: [] }, { sessionId: 'a', cuts: [] }] }
		] as unknown as Project[];
		expect(projectsUsing(projects, 'a').map((p) => p.id)).toEqual(['p1', 'p3']);
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
