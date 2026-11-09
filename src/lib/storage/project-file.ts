// The Project file: one JSON document per Project, following the Handoff
// brief's data model (ADR 0001). Pure functions only; reading and writing
// live in projects.ts.

import { newId, type Session } from './session-file.ts';

export interface Cut {
	startUs: number;
	endUs: number;
	reason: 'manual' | 'silence' | 'gap';
	accepted: boolean;
}

/** One Session in a Project, with the Cuts on its timeline. */
export interface ProjectSession {
	sessionId: string;
	cuts: Cut[];
}

export interface SilenceSettings {
	thresholdDb: number;
	minLengthMs: number;
	paddingMs: number;
}

export interface Project {
	version: 1;
	id: string;
	title: string;
	createdAt: string;
	/** Played end to end, in this order; each Session at most once. */
	sessions: ProjectSession[];
	silence: SilenceSettings;
}

/** Starting values, to tune by ear. */
export const defaultSilence: SilenceSettings = { thresholdDb: -45, minLengthMs: 700, paddingMs: 150 };

export const projectsDir = 'projects';

export function projectFilePath(projectId: string): string {
	return `${projectsDir}/${projectId}/project.json`;
}

/**
 * A new Project of these Sessions in this order, with no Cuts: named after the
 * Session, or the first of several.
 */
export function newProject(options: { now: Date; random?: () => number; sessions: Session[] }): Project {
	const { now, random = Math.random, sessions } = options;
	const [first] = sessions;
	const others = sessions.length - 1;
	return {
		version: 1,
		id: newId('proj', now, random),
		title: !first ? 'New project' : others === 0 ? first.title : `${first.title} and ${others} more`,
		createdAt: now.toISOString(),
		sessions: addSessions([], sessions.map((s) => s.id)),
		silence: { ...defaultSilence }
	};
}

/** Adds Sessions at the end, each with no Cuts; any already in the Project are left where they are. */
export function addSessions(list: ProjectSession[], sessionIds: string[]): ProjectSession[] {
	const added = [...list];
	for (const sessionId of sessionIds) {
		if (!added.some((s) => s.sessionId === sessionId)) added.push({ sessionId, cuts: [] });
	}
	return added;
}

/** Takes a Session out of the Project, with its Cuts. */
export function removeSession(list: ProjectSession[], sessionId: string): ProjectSession[] {
	return list.filter((s) => s.sessionId !== sessionId);
}

/** Moves the Session at `from` to `to`, shifting the ones between. */
export function moveSession(list: ProjectSession[], from: number, to: number): ProjectSession[] {
	if (from < 0 || from >= list.length) return list;
	const target = Math.min(Math.max(0, to), list.length - 1);
	if (target === from) return list;
	const moved = [...list];
	moved.splice(target, 0, ...moved.splice(from, 1));
	return moved;
}

/** The Projects that use a Session. */
export function projectsUsing(projects: Project[], sessionId: string): Project[] {
	return projects.filter((p) => p.sessions.some((s) => s.sessionId === sessionId));
}

/** The newest Project holding just this Session, which Edit on the take opens again rather than making another. */
export function soloProjectFor(projects: Project[], sessionId: string): Project | null {
	const solo = projects.filter((p) => p.sessions.length === 1 && p.sessions[0]!.sessionId === sessionId);
	return solo.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
