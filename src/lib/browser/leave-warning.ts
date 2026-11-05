// Asks the browser to warn before the tab is closed or reloaded while any take
// is Capturing or Finalizing here. Browsers show their own wording.

let holds = 0;

function onBeforeUnload(event: BeforeUnloadEvent) {
	event.preventDefault();
	// Older Chromium and Firefox versions also need returnValue set.
	event.returnValue = '';
}

/** Warns on leaving until the returned function is called. Holds stack: the warning stays while any is held. */
export function warnBeforeLeaving(): () => void {
	if (holds++ === 0) window.addEventListener('beforeunload', onBeforeUnload);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--holds === 0) window.removeEventListener('beforeunload', onBeforeUnload);
	};
}
