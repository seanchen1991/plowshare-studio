// Reading and writing Project files in OPFS, and which Project the Edit tab
// opens.

import { listDirectories, readJson, writeJson } from './opfs.ts';
import { newProject, projectFilePath, projectsDir, soloProjectFor, type Project } from './project-file.ts';
import type { Session } from './session-file.ts';

export function loadProject(projectId: string): Promise<Project> {
	return readJson<Project>(projectFilePath(projectId));
}

/** Every Project in OPFS. Projects whose file can't be read are skipped. */
export async function listProjects(): Promise<Project[]> {
	const ids = await listDirectories(projectsDir);
	const projects = await Promise.all(ids.map((id) => loadProject(id).catch(() => null)));
	return projects.filter((p): p is Project => p !== null);
}

let saving = Promise.resolve();

/** Writes a Project file. Writes happen one at a time, in order, so the last change is the one kept. */
export function saveProject(project: Project): Promise<void> {
	saving = saving.catch(() => {}).then(() => writeJson(projectFilePath(project.id), project));
	return saving;
}

/** The Project for editing this take on its own: the one made last time, or a new one. */
export async function projectForSession(session: Session, now = new Date()): Promise<Project> {
	const existing = soloProjectFor(await listProjects(), session.id);
	if (existing) return existing;
	const project = newProject({ now, session });
	await writeJson(projectFilePath(project.id), project);
	return project;
}

const lastProjectKey = 'plowshare.lastProject';

/** The Project the Edit tab opens, remembered between visits. Callers check it still exists. */
export function lastProjectId(): string | null {
	try {
		return localStorage.getItem(lastProjectKey);
	} catch {
		return null;
	}
}

export function setLastProjectId(projectId: string | null): void {
	try {
		if (projectId) localStorage.setItem(lastProjectKey, projectId);
		else localStorage.removeItem(lastProjectKey);
	} catch {
		// Without storage the Edit tab only remembers the Project during this visit.
	}
}
