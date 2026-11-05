// Saves a file to the user's Downloads. A File from OPFS is backed by the
// disk, so its object URL streams from there: nothing is read into memory.

/** How long the link stays valid: long enough for the browser to start saving. */
const keepUrlMs = 60_000;

export function saveFile(file: Blob, name: string): void {
	const url = URL.createObjectURL(file);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), keepUrlMs);
}
