<script lang="ts">
	import { maxShowNameLength, showNameProblem, type Show } from '../lib/storage/show-file';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';

	/** Asks for a Show's name, for a new Show or a rename, and says what's wrong with it before saving. */
	let { shows }: { shows: Show[] } = $props();

	let dialog: Dialog;
	let input = $state<HTMLInputElement>();
	let title = $state('New show');
	let saveLabel = $state('Create');
	let exceptId = $state<string | undefined>();
	let problem = $state<string | null>(null);
	let save: (name: string) => Promise<void> = async () => {};
	let done: () => void = () => {};

	/** Opens the dialog; `onsave` gets the trimmed name, and a thrown error is shown in the dialog. */
	export function open(options: { show?: Show; onsave: (name: string) => Promise<void>; oncancel?: () => void }) {
		title = options.show ? `Rename “${options.show.name}”` : 'New show';
		saveLabel = options.show ? 'Rename' : 'Create';
		exceptId = options.show?.id;
		problem = null;
		save = options.onsave;
		done = options.oncancel ?? (() => {});
		if (input) input.value = options.show?.name ?? '';
		dialog.open();
		input?.select();
	}

	async function submit(event: SubmitEvent) {
		const submitter = event.submitter as HTMLButtonElement | null;
		if (submitter?.value === 'cancel') return;
		event.preventDefault();
		const name = input?.value ?? '';
		problem = showNameProblem(name, shows, exceptId);
		if (problem) return;
		try {
			await save(name.trim());
			done = () => {};
			dialog.close();
		} catch (e) {
			problem = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<Dialog bind:this={dialog} {title} onsubmit={submit} onclose={() => done()}>
	<label class="field">
		<span>Name</span>
		<input bind:this={input} maxlength={maxShowNameLength + 20} autocomplete="off" oninput={() => (problem = null)} />
	</label>
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{#snippet actions()}
		<Button type="submit" value="cancel" formnovalidate>Cancel</Button>
		<Button type="submit" value="save" variant="primary">{saveLabel}</Button>
	{/snippet}
</Dialog>

<style>
	.field {
		display: grid;
		gap: 4px;
		font-size: var(--text-small);
	}
	.field span {
		color: var(--muted);
	}
	input {
		height: 32px;
		padding: 0 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius-button);
		font: inherit;
		font-size: var(--text);
	}
	input:focus {
		outline: 2px solid var(--track-3);
		outline-offset: 1px;
	}
	.problem {
		margin-top: 8px;
		color: var(--problem-fg) !important;
	}
</style>
