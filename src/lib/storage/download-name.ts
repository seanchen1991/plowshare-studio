// Names for downloaded files: the Session's date and title, then "– part 1 of
// 2" when a Recording has several Segments. Safe on Windows, macOS and Linux.

/** Characters no common file system accepts in a name, plus control characters. */
const unsafe = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const maxTitleLength = 120;

/** `2026-11-02`, in the user's time zone. */
export function localDate(when: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

export function safeTitle(title: string): string {
	const cleaned = title
		.replace(unsafe, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		// Windows drops trailing dots, and a leading dot hides the file.
		.replace(/^[.\s]+|[.\s]+$/g, '');
	return cleaned.slice(0, maxTitleLength).trim() || 'Take';
}

/**
 * `2026-11-02 Episode 1.webm`, or `2026-11-02 Episode 1 – part 1 of 2.webm`
 * when the Recording has `count` Segments.
 */
export function downloadName(options: { title: string; createdAt: string; extension: string; part: number; count: number }): string {
	const { title, createdAt, extension, part, count } = options;
	const parts = count > 1 ? ` – part ${part} of ${count}` : '';
	return `${localDate(new Date(createdAt))} ${safeTitle(title)}${parts}.${extension}`;
}

/** The extension of a stored file's path, without the dot. */
export function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1) : '';
}
