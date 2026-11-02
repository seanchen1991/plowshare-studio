<script lang="ts">
	import { detectBrowserSupport } from '../lib/browser/support';

	const support = detectBrowserSupport(navigator.userAgent);

	const unsupportedMessages = {
		safari: "Plowshare Studio doesn't support Safari yet.",
		ios: "Plowshare Studio doesn't support iPhone or iPad yet.",
		unknown: "Plowshare Studio doesn't support this browser yet."
	};
</script>

<main>
	<h1>Plowshare Studio</h1>
	{#if support.supported}
		<p data-testid="home">Record your podcast right here in the browser.</p>
	{:else}
		<p data-testid="unsupported" role="alert">
			{unsupportedMessages[support.reason]}
			Please use Chrome, Edge or Firefox on a computer.
		</p>
	{/if}
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 2rem 1rem;
		font-family: system-ui, sans-serif;
	}
</style>
