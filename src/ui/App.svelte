<script lang="ts">
	import { onMount } from 'svelte';
	import { detectBrowserSupport } from '../lib/browser/support';
	import { finalizeRecording, recoverRecording } from '../lib/media/finalize';
	import { saveFile } from '../lib/browser/download';
	import { autoDownloadName, backupFileName } from '../lib/storage/backup-names';
	import {
		autoDownload,
		backupOfferDismissed,
		canUseFolder,
		chooseBackupFolder,
		copyTake,
		dismissBackupOffer,
		folderAccess,
		forgetBackupFolder,
		loadBackupFolder,
		needsCopy,
		setAutoDownload,
		showFolder,
		type BackupStatus,
		type FolderAccess
	} from '../lib/storage/backup';
	import { storageRefused } from '../lib/storage/budget';
	import { markDownloaded } from '../lib/storage/library';
	import { readFile } from '../lib/storage/opfs';
	import { askToPersist, persistence as currentPersistence, type Persistence } from '../lib/storage/persistence';
	import { formatTimeLeft } from '../lib/storage/time-left';
	import { recordingDurationUs, sessionState, shouldRecoverAutomatically, type Session } from '../lib/storage/session-file';
	import { checkSessionsOnLaunch, listSessions } from '../lib/storage/sessions';
	import { showOf, type Show } from '../lib/storage/show-file';
	import { listShows } from '../lib/storage/shows';
	import { importFile } from '../lib/storage/import';
	import { projectsUsing, type Project } from '../lib/storage/project-file';
	import {
		createProject,
		deleteProject,
		lastProjectId,
		listProjects,
		loadProject,
		projectForSession,
		saveProject,
		setLastProjectId
	} from '../lib/storage/projects';
	import EditScreen from './EditScreen.svelte';
	import ProjectList from './ProjectList.svelte';
	import RecordScreen from './RecordScreen.svelte';
	import SegmentedControl from './SegmentedControl.svelte';
	import TakesScreen from './TakesScreen.svelte';
	import { formatDuration } from './format';

	type Screen = 'record' | 'takes' | 'edit';

	const support = detectBrowserSupport(navigator.userAgent);

	const unsupportedMessages = {
		safari: "Plowshare Studio doesn't support Safari yet.",
		ios: "Plowshare Studio doesn't support iPhone or iPad yet.",
		unknown: "Plowshare Studio doesn't support this browser yet."
	};

	let screen = $state<Screen>('record');
	let sessions = $state<Session[]>([]);
	let projects = $state<Project[]>([]);
	// The Project open in the Edit tab, remembered between visits; without one, the tab lists them.
	let project = $state<Project | null>(null);
	const readySessions = $derived(sessions.filter((s) => sessionState(s) === 'ready'));
	const screens = $derived<{ value: Screen; label: string; disabled?: boolean }[]>([
		{ value: 'record', label: 'Record' },
		{ value: 'takes', label: 'Takes' },
		{ value: 'edit', label: 'Edit', disabled: projects.length === 0 && readySessions.length === 0 }
	]);
	let shows = $state<Show[]>([]);
	let progress = $state<Record<string, number>>({});
	let lastTakeId = $state<string | null>(null);
	let timeLeft = $state<number | null>(null);
	let persistence = $state<Persistence>('not-asked');
	// The browser won't let this site store files: a Firefox private window, or site data blocked.
	let refused = $state(false);

	// Backups: the Backup folder in Chrome and Edge, automatic downloads in Firefox.
	const usesFolder = canUseFolder();
	let backupRoot = $state<FileSystemDirectoryHandle | null>(null);
	let backupAccess = $state<FolderAccess>('prompt');
	let copyingTitle = $state<string | null>(null);
	let downloadsOn = $state(autoDownload());
	let offerDismissed = $state(backupOfferDismissed());
	// No copying while a take is captured, so it doesn't compete for the disk.
	let capturing = false;
	const backup = $derived<BackupStatus>(
		usesFolder
			? {
					kind: 'folder',
					name: backupRoot?.name ?? null,
					access: backupAccess,
					waiting: sessions.filter(needsCopy).length,
					copying: copyingTitle
				}
			: { kind: 'downloads', on: downloadsOn }
	);
	// Offered once there's something to back up (a Show or a take), until chosen or declined.
	const offerBackup = $derived(
		!offerDismissed && (shows.length > 0 || sessions.length > 0) && (usesFolder ? !backupRoot : downloadsOn === null)
	);

	const lastTake = $derived(sessions.find((s) => s.id === lastTakeId) ?? null);
	// Takes recovered automatically on this visit, until the user has looked at Takes.
	let recoveredIds = $state<string[]>([]);
	let recovering = $state(0);
	const interrupted = $derived(sessions.filter((s) => sessionState(s) === 'interrupted' && progress[s.id] === undefined).length);
	const recovered = $derived(sessions.filter((s) => recoveredIds.includes(s.id) && sessionState(s) === 'ready'));

	$effect(() => {
		if (screen === 'takes') recoveredIds = [];
	});

	// Nothing left to edit: every take and Project deleted.
	$effect(() => {
		if (screen === 'edit' && screens[2]!.disabled) screen = 'takes';
	});

	/** Edit on a Ready take: opens its Project, made the first time. */
	async function edit(session: Session) {
		open(await projectForSession(session));
		await refreshProjects();
		screen = 'edit';
	}

	/** Edit together on several takes: a new Project of them, in the order listed. */
	async function editTogether(chosen: Session[]) {
		open(await createProject(chosen));
		await refreshProjects();
		screen = 'edit';
	}

	function open(opened: Project | null) {
		project = opened;
		setLastProjectId(opened?.id ?? null);
	}

	/** Open a file…: copies it in as a new take, and returns it once the list has it. */
	async function openFile(file: File): Promise<Session> {
		const session = await importFile(file);
		await refresh();
		return session;
	}

	async function refreshProjects() {
		projects = (await listProjects()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		// The open Project as saved: deleting a take may have taken it out; deleting the Project closes it.
		if (project) project = projects.find((p) => p.id === project!.id) ?? null;
	}

	function projectChanged(changed: Project) {
		project = changed;
		projects = projects.map((p) => (p.id === changed.id ? changed : p));
	}

	async function renameProject(renamed: Project, title: string) {
		await saveProject({ ...renamed, title });
		await refreshProjects();
	}

	async function removeProject(removed: Project) {
		await deleteProject(removed.id);
		if (project?.id === removed.id) open(null);
		await refreshProjects();
	}

	async function loadLastProject() {
		const id = lastProjectId();
		if (!id) return;
		project = await loadProject(id).catch(() => {
			setLastProjectId(null);
			return null;
		});
	}

	function recoveredSummary(session: Session): string {
		const recording = session.recordings[0]!;
		const durationUs = recordingDurationUs(recording) ?? 0;
		const expectedUs = Math.max(recording.recovery?.expectedUs ?? 0, durationUs);
		return `${formatDuration(durationUs)} of about ${formatDuration(expectedUs)}`;
	}

	async function refresh() {
		sessions = await listSessions();
		await refreshProjects();
	}

	async function refreshShows() {
		shows = await listShows();
		// New Shows get their folders straight away.
		if (backupRoot && backupAccess === 'granted') {
			for (const show of shows.filter((s) => !s.folder)) await showFolder(backupRoot, show, shows).catch(() => {});
			shows = await listShows();
		}
	}

	let copying: Promise<void> = Promise.resolve();

	/** Copies every Ready take not yet in the Backup folder, one at a time. */
	function copyPending() {
		copying = copying
			.then(async () => {
				if (!backupRoot || backupAccess !== 'granted') return;
				for (const session of (await listSessions()).filter(needsCopy)) {
					if (capturing) break;
					copyingTitle = session.title;
					await copyTake(backupRoot, session.id, shows);
					await refresh();
				}
				// A failure may mean access was taken away.
				backupAccess = await folderAccess(backupRoot);
			})
			.catch(() => {})
			.finally(() => (copyingTitle = null));
	}

	async function startBackups() {
		if (!usesFolder) return;
		backupRoot = await loadBackupFolder().catch(() => null);
		if (!backupRoot) return;
		backupAccess = await folderAccess(backupRoot);
		await refreshShows();
		copyPending();
	}

	async function chooseFolder() {
		const handle = await chooseBackupFolder();
		if (!handle) return;
		backupRoot = handle;
		backupAccess = await folderAccess(handle);
		dismissOffer();
		await refreshShows();
		copyPending();
	}

	/** Asks for access when the browser wants it confirmed; must follow a click. */
	async function allowAccess() {
		if (!backupRoot) return;
		backupAccess = await folderAccess(backupRoot, true);
		await refreshShows();
		copyPending();
	}

	async function turnOffFolder() {
		await forgetBackupFolder();
		backupRoot = null;
	}

	function setDownloads(on: boolean) {
		setAutoDownload(on);
		downloadsOn = on;
		dismissOffer();
	}

	function dismissOffer() {
		dismissBackupOffer();
		offerDismissed = true;
	}

	/** A take just became Ready: copy it, or in Firefox download it if asked to. */
	async function backUpNew(sessionId: string) {
		if (usesFolder) return copyPending();
		if (!downloadsOn) return;
		const session = sessions.find((s) => s.id === sessionId);
		if (!session || sessionState(session) !== 'ready') return;
		const show = showOf(session.showId, shows);
		for (const recording of session.recordings) {
			const finished = recording.segments.filter((s) => s.path !== null);
			for (const segment of finished) {
				saveFile(await readFile(segment.path!), autoDownloadName(backupFileName(session, finished, segment), show?.name));
				await markDownloaded(session.id, recording.id, segment.index);
			}
		}
		await refresh();
	}

	onMount(() => {
		if (support.supported) void start();
	});

	async function start() {
		refused = await storageRefused();
		if (refused) return;
		persistence = await currentPersistence();
		await refreshShows();
		void startBackups();
		await loadLastProject();
		await launch();
	}

	async function launch() {
		await checkSessionsOnLaunch().finally(refresh);
		const cutOff = sessions.filter((s) => s.recordings.some(shouldRecoverAutomatically));
		recovering = cutOff.length;
		for (const session of cutOff) {
			await recover(session);
			if (sessions.find((s) => s.id === session.id && sessionState(s) === 'ready')) recoveredIds = [...recoveredIds, session.id];
			recovering--;
		}
	}

	// One take finalizes at a time, in the order they stopped, so takes recorded back to back
	// don't compete for the disk with each other (and with the take being captured).
	let finishing: Promise<void> = Promise.resolve();

	function inTurn(job: () => Promise<void>): Promise<void> {
		const turn = finishing.then(job).catch(() => {});
		finishing = turn;
		return turn;
	}

	/** Finalizes a take once the ones before it are done. `held` hands over a just-stopped take's lock. */
	function finalize(session: Session, held?: () => void) {
		return inTurn(async () => {
			const recordingId = session.recordings[0]!.id;
			progress[session.id] = 0;
			await finalizeRecording(session.id, recordingId, (p) => (progress[session.id] = p), held);
			delete progress[session.id];
			await refresh();
			await backUpNew(session.id);
		});
	}

	function recover(session: Session) {
		sessions = sessions.map((s) => (s.id === session.id ? { ...s, recordings: s.recordings.map((r) => ({ ...r, state: 'finalizing' })) } : s));
		return inTurn(async () => {
			const recordingId = session.recordings[0]!.id;
			progress[session.id] = 0;
			await recoverRecording(session.id, recordingId, (p) => (progress[session.id] = p));
			delete progress[session.id];
			await refresh();
			await backUpNew(session.id);
		});
	}
</script>

{#if support.supported && refused}
	<main class="unsupported">
		<h1>Plowshare Studio</h1>
		<p data-testid="storage-refused" role="alert">
			Plowshare Studio can't record in a private window. Every take is saved to this computer as it records, and this browser
			doesn't let websites save files here. Open a normal window to record.
		</p>
		<p class="aside">If this isn't a private window, check that this site is allowed to store data in the browser's settings.</p>
	</main>
{:else if support.supported}
	<header class="top">
		<h1>Plowshare Studio</h1>
		<nav><SegmentedControl options={screens} bind:value={screen} label="Screens" /></nav>
		<div class="room figures" data-testid="time-left">
			{#if timeLeft !== null}Room for {formatTimeLeft(timeLeft)}{/if}
		</div>
	</header>
	<!-- Both screens stay mounted, so a take keeps recording while Takes is open. -->
	<main data-testid="home">
		{#if screen === 'record'}
			{#if interrupted > 0}
				<p class="notice problem" role="alert" data-testid="recovery-notice">
					{interrupted === 1 ? 'A take was' : `${interrupted} takes were`} cut off when the browser closed and couldn't be recovered automatically.
					<button type="button" onclick={() => (screen = 'takes')}>Recover in Takes</button>
				</p>
			{:else if recovering > 0}
				<p class="notice working" role="status" data-testid="recovery-notice">
					Recovering {recovering === 1 ? 'a take' : `${recovering} takes`} cut off when the browser closed…
				</p>
			{:else if recovered.length > 0}
				<p class="notice ready" role="status" data-testid="recovery-notice">
					{#if recovered.length === 1}
						Recovered a take cut off when the browser closed: {recoveredSummary(recovered[0]!)}.
					{:else}
						Recovered {recovered.length} takes cut off when the browser closed.
					{/if}
					<button type="button" onclick={() => (screen = 'takes')}>Show in Takes</button>
				</p>
			{/if}
		{/if}
		{#if screen === 'record' && offerBackup}
			<div class="notice offer" role="status" data-testid="backup-offer">
				{#if usesFolder}
					<span>Keep a copy of every take in a folder on this computer, with a folder for each show.</span>
					<button type="button" onclick={chooseFolder}>Choose folder…</button>
				{:else}
					<span>Download every take automatically when it's ready? Firefox can't save to a folder, so takes go to Downloads, named with their show.</span>
					<button type="button" onclick={() => setDownloads(true)}>Turn on</button>
				{/if}
				<button type="button" onclick={() => (usesFolder ? dismissOffer() : setDownloads(false))}>Not now</button>
			</div>
		{/if}
		<section aria-label="Record" hidden={screen !== 'record'}>
			<RecordScreen
				active={screen === 'record'}
				browser={support.browser}
				{lastTake}
				usedIn={lastTake ? projectsUsing(projects, lastTake.id).map((p) => p.title) : []}
				progress={lastTakeId ? progress[lastTakeId] : undefined}
				onStarted={(session) => {
					capturing = true;
					lastTakeId = session.id;
					void refresh();
				}}
				onStopped={async ({ session, release }) => {
					capturing = false;
					void finalize(session, release);
					await refresh();
				}}
				onShowTakes={() => (screen = 'takes')}
				onEdit={edit}
				onTakeChanged={refresh}
				onRetry={finalize}
				onRecordPressed={() => {
					void askToPersist().then((p) => (persistence = p));
					if (backupRoot && backupAccess === 'prompt') void allowAccess();
				}}
				{persistence}
				{shows}
				onShowsChanged={refreshShows}
				bind:timeLeft
			/>
		</section>
		<section aria-label="Takes" hidden={screen !== 'takes'}>
			<TakesScreen
				{sessions}
				{progress}
				{persistence}
				browser={support.browser}
				onRecover={recover}
				onRetry={finalize}
				onEdit={edit}
				onEditTogether={editTogether}
				onOpenFile={openFile}
				{projects}
				onChanged={refresh}
				{shows}
				onShowsChanged={refreshShows}
				{backup}
				onChooseFolder={chooseFolder}
				onAllowAccess={allowAccess}
				onTurnOffFolder={turnOffFolder}
				onSetDownloads={setDownloads}
				onRetryBackup={() => (backupAccess === 'prompt' ? allowAccess() : copyPending())}
			/>
		</section>
		<!-- Mounted only while open, so playback and peak decoding stop when the user leaves it. -->
		{#if screen === 'edit'}
			<section aria-label="Edit">
				{#if project}
					{#key project.id}
						<EditScreen {project} library={readySessions} onProjectChange={projectChanged} onClose={() => open(null)} onOpenFile={openFile} />
					{/key}
				{:else}
					<ProjectList {projects} {sessions} onOpen={open} onRename={renameProject} onDelete={removeProject} />
				{/if}
			</section>
		{/if}
	</main>
{:else}
	<main class="unsupported">
		<h1>Plowshare Studio</h1>
		<p data-testid="unsupported" role="alert">
			{unsupportedMessages[support.reason]}
			Please use Chrome, Edge or Firefox on a computer.
		</p>
	</main>
{/if}

<style>
	.top {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		height: 52px;
		padding: 0 20px;
		border-bottom: 1px solid var(--line);
		background: var(--canvas);
	}
	h1 {
		font-size: var(--text);
		font-weight: 650;
	}
	.room {
		justify-self: end;
		color: var(--muted);
		font-size: var(--text-small);
	}
	/* Phones: Recording time left gets a row of its own under the name and tabs. */
	@media (max-width: 640px) {
		.top {
			grid-template-columns: 1fr auto;
			row-gap: 2px;
			height: auto;
			padding: 8px 16px;
		}
		.room {
			grid-column: 1 / -1;
			justify-self: start;
		}
		.room:empty {
			display: none;
		}
	}
	main {
		padding: 32px 24px 64px;
	}
	.notice {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px 12px;
		max-width: 960px;
		margin: -12px auto 20px;
		padding: 8px 12px;
		border-radius: var(--radius-panel);
		font-size: var(--text-small);
	}
	.notice.problem {
		background: var(--problem-bg);
		color: var(--problem-fg);
	}
	.notice.working {
		background: var(--working-bg);
		color: var(--working-fg);
	}
	.notice.offer {
		background: var(--soft);
		color: var(--ink);
	}
	.notice.ready {
		background: var(--ready-bg);
		color: var(--ready-fg);
	}
	.notice button {
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
	}
	.unsupported {
		display: grid;
		gap: 12px;
		max-width: 32rem;
		margin: 15vh auto 0;
	}
	.unsupported h1 {
		font-size: 22px;
	}
	.aside {
		color: var(--muted);
		font-size: var(--text-small);
	}
</style>
