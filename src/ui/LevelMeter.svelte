<script lang="ts">
	import type { LevelReading } from '../lib/recorder/level-meter';
	import Waveform from './Waveform.svelte';

	/** The live mic waveform with a level bar, peak hold, clip light and a word on the level. */
	let { reading, warn = false }: { reading: LevelReading | null; warn?: boolean } = $props();

	const messages = {
		good: 'Level good',
		quiet: 'Too quiet — move closer or turn your mic up',
		clipping: 'Clipping — turn your mic down'
	};
	// Before the countdown, silence is just silence; during it, it's a warning.
	const idleQuiet = 'Say something to check your level';

	const status = $derived(reading?.status ?? 'quiet');
	const message = $derived(status === 'quiet' && !warn ? idleQuiet : messages[status]);
	const tone = $derived(status === 'clipping' ? 'problem' : status === 'quiet' ? (warn ? 'working' : 'muted') : 'ready');
</script>

<div class="meter" data-testid="level-meter" data-status={status}>
	<Waveform peaks={reading?.bars ?? []} height={36} color="var(--track-1)" />
	<div class="bar-row">
		<div class="bar" aria-hidden="true">
			<div class="fill" style:clip-path="inset(0 {(1 - (reading?.level ?? 0)) * 100}% 0 0)"></div>
			<div class="hold" style:left="{(reading?.peak ?? 0) * 100}%"></div>
		</div>
		<span class="clip" class:on={reading?.clipping} aria-label={reading?.clipping ? 'Clipping' : undefined}>CLIP</span>
	</div>
	<p class="status {tone}" role="status" data-testid="level-status">{message}</p>
</div>

<style>
	.meter {
		display: grid;
		gap: 6px;
		width: min(100%, 520px);
	}
	.bar-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.bar {
		position: relative;
		flex: 1;
		height: 6px;
		border-radius: var(--radius-round);
		background: var(--soft);
		overflow: hidden;
	}
	/* Green up to -18 dBFS (70%), amber to -6 (90%), red above. */
	.fill {
		position: absolute;
		inset: 0;
		background: linear-gradient(to right, var(--track-1) 0 70%, var(--working-edge) 70% 90%, var(--record) 90%);
	}
	.hold {
		position: absolute;
		top: 0;
		width: 2px;
		height: 100%;
		margin-left: -1px;
		background: var(--ink);
	}
	.clip {
		padding: 1px 6px;
		border-radius: var(--radius-round);
		background: var(--soft);
		color: var(--muted);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.clip.on {
		background: var(--record);
		color: #fff;
	}
	.status {
		font-size: var(--text-small);
		text-align: center;
	}
	.muted {
		color: var(--muted);
	}
	.ready {
		color: var(--ready-fg);
	}
	.working {
		color: var(--working-fg);
		font-weight: 600;
	}
	.problem {
		color: var(--problem-fg);
		font-weight: 600;
	}
</style>
