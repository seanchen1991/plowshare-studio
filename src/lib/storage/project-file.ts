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

/** A new Project holding one Session, named after it, with no Cuts. */
export function newProject(options: { now: Date; random?: () => number; session: Session }): Project {
	const { now, random = Math.random, session } = options;
	return {
		version: 1,
		id: newId('proj', now, random),
		title: session.title,
		createdAt: now.toISOString(),
		sessions: [{ sessionId: session.id, cuts: [] }],
		silence: { ...defaultSilence }
	};
}

/** The newest Project holding just this Session, which Edit on the take opens again rather than making another. */
export function soloProjectFor(projects: Project[], sessionId: string): Project | null {
	const solo = projects.filter((p) => p.sessions.length === 1 && p.sessions[0]!.sessionId === sessionId);
	return solo.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
