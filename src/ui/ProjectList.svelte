<script lang="ts">
	import { tick } from 'svelte';
	import { sessionDurationUs } from '../lib/edit/timeline';
	import type { Project } from '../lib/storage/project-file';
	import type { Session } from '../lib/storage/session-file';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Menu from './Menu.svelte';
	import { formatDuration } from './format';

	/** The Edit tab's list of Projects, newest first: open, rename or delete one. */
	let {
		projects,
		sessions,
		onOpen,
		onRename,
		onDelete
	}: {
		projects: Project[];
		/** Every take, to show each Project's length. */
		sessions: Session[];
		onOpen: (project: Project) => void;
		onRename: (project: Project, title: string) => void;
		onDelete: (project: Project) => void;
	} = $props();

	let renamingId = $state<string | null>(null);
	let titleInput = $state<HTMLInputElement>();
	let deleting = $state<Project | null>(null);
	let confirmDelete: Dialog;

	function summary(project: Project): string {
		const takes = project.sessions.flatMap((ps) => sessions.filter((s) => s.id === ps.sessionId));
		const length = takes.reduce((sum, s) => sum + sessionDurationUs(s), 0);
		const created = new Date(project.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
		return [takes.length === 1 ? '1 take' : `${takes.length} takes`, takes.length ? formatDuration(length) : null, created]
			.filter(Boolean)
			.join(' · ');
	}

	async function startRename(project: Project) {
		renamingId = project.id;
		await tick();
		titleInput?.select();
	}

	function finishRename(project: Project, keep: boolean) {
		if (renamingId !== project.id) return;
		renamingId = null;
		const title = titleInput?.value.trim() ?? '';
		if (keep && title && title !== project.title) onRename(project, title);
	}

	function remove(event: SubmitEvent) {
		if ((event.submitter as HTMLButtonElement | null)?.value === 'delete' && deleting) onDelete(deleting);
	}
</script>

<div class="projects">
	<h2>Projects</h2>
	{#if projects.length === 0}
		<p class="empty">No projects yet. Press Edit on a take, or pick several in Takes and press Edit together.</p>
	{:else}
		<ul>
			{#each projects as project (project.id)}
				<li data-testid="project" data-project-id={project.id}>
					<div class="what">
						{#if renamingId === project.id}
							<input
								bind:this={titleInput}
								class="title-input"
								value={project.title}
								aria-label="Project name"
								maxlength="200"
								onkeydown={(e) => {
									if (e.key === 'Enter') finishRename(project, true);
									if (e.key === 'Escape') finishRename(project, false);
								}}
								onblur={() => finishRename(project, true)}
							/>
						{:else}
							<span class="title" data-testid="project-name">{project.title}</span>
						{/if}
						<span class="details figures">{summary(project)}</span>
					</div>
					<span class="actions">
						<Button variant="primary" onclick={() => onOpen(project)}>Open</Button>
						<Menu
							label="More actions"
							items={[
								{ label: 'Rename', onselect: () => startRename(project) },
								{
									label: 'Delete…',
									onselect: () => {
										deleting = project;
										confirmDelete.open();
									},
									danger: true
								}
							]}>⋯</Menu
						>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	<Dialog bind:this={confirmDelete} title="Delete “{deleting?.title}”?" onsubmit={remove}>
		<p>This deletes the project and its Cuts. The takes it uses are kept.</p>
		{#snippet actions()}
			<Button type="submit" value="cancel" autofocus>Cancel</Button>
			<Button type="submit" value="delete" variant="danger">Delete project</Button>
		{/snippet}
	</Dialog>
</div>

<style>
	.projects {
		display: grid;
		gap: 16px;
		max-width: 960px;
		margin: 0 auto;
	}
	h2 {
		font-size: 18px;
		font-weight: 600;
	}
	.empty {
		padding: 48px 16px;
		border: 1px dashed var(--line);
		border-radius: var(--radius-panel);
		color: var(--muted);
		text-align: center;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-panel);
	}
	li {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 12px 16px;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	.what {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.title {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title-input {
		font: inherit;
		font-weight: 600;
		padding: 2px 6px;
		border: 1px solid var(--line);
		border-radius: var(--radius-button);
	}
	.details {
		color: var(--muted);
		font-size: var(--text-small);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
