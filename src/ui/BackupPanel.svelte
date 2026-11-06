<script lang="ts">
	import type { BackupStatus } from '../lib/storage/backup';

	/** Where backups go, at the top of Takes: the Backup folder (Chrome and Edge) or automatic downloads (Firefox). */
	let {
		backup,
		onChooseFolder,
		onAllowAccess,
		onTurnOffFolder,
		onSetDownloads
	}: {
		backup: BackupStatus;
		onChooseFolder: () => void;
		onAllowAccess: () => void;
		onTurnOffFolder: () => void;
		onSetDownloads: (on: boolean) => void;
	} = $props();

	const takes = (n: number) => (n === 1 ? '1 take' : `${n} takes`);
</script>

<div class="backup" data-testid="backup" data-state={backup.kind === 'folder' ? (backup.name ? backup.access : 'none') : backup.on ? 'on' : 'off'}>
	{#if backup.kind === 'folder'}
		{#if !backup.name}
			<span>Not backing up to a folder on this computer.</span>
			<button type="button" onclick={onChooseFolder}>Choose folder…</button>
		{:else if backup.access === 'granted'}
			<span>
				Backing up to “{backup.name}”{#if backup.copying}: copying “{backup.copying}”…{:else if backup.waiting > 0}: {takes(backup.waiting)} not copied yet.{:else}.{/if}
			</span>
			<button type="button" onclick={onChooseFolder}>Change folder…</button>
			<button type="button" onclick={onTurnOffFolder}>Turn off</button>
		{:else if backup.access === 'prompt'}
			<span>
				Backups to “{backup.name}” are paused until you allow access{#if backup.waiting > 0}: {takes(backup.waiting)} waiting{/if}.
			</span>
			<button type="button" onclick={onAllowAccess}>Allow access</button>
		{:else}
			<span>This browser no longer lets Plowshare Studio save to “{backup.name}”.</span>
			<button type="button" onclick={onChooseFolder}>Choose folder…</button>
		{/if}
	{:else if backup.on}
		<span>Each take is downloaded when it's ready.</span>
		<button type="button" onclick={() => onSetDownloads(false)}>Turn off</button>
	{:else}
		<span>Takes aren't downloaded automatically.</span>
		<button type="button" onclick={() => onSetDownloads(true)}>Download each take when it's ready</button>
	{/if}
</div>

<style>
	.backup {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 12px;
		color: var(--muted);
		font-size: var(--text-small);
	}
	button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		font-weight: 500;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
