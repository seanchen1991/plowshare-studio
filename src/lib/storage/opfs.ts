// Path-based helpers over the origin private file system (OPFS). Work in the
// main thread and in workers. Paths use '/' and are relative to the OPFS root.

async function directory(path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
	let dir = await navigator.storage.getDirectory();
	for (const name of path) dir = await dir.getDirectoryHandle(name, { create });
	return dir;
}

function split(path: string): { dirs: string[]; name: string } {
	const parts = path.split('/').filter(Boolean);
	const name = parts.pop();
	if (!name) throw new Error(`Not a file path: ${path}`);
	return { dirs: parts, name };
}

export async function fileHandle(path: string, { create = false } = {}): Promise<FileSystemFileHandle> {
	const { dirs, name } = split(path);
	return (await directory(dirs, create)).getFileHandle(name, { create });
}

export async function readFile(path: string): Promise<File> {
	return (await fileHandle(path)).getFile();
}

export async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await (await readFile(path)).text()) as T;
}

/** Writes JSON through a writable stream, which only replaces the file when it closes. */
export async function writeJson(path: string, value: unknown): Promise<void> {
	const writable = await (await fileHandle(path, { create: true })).createWritable();
	await writable.write(JSON.stringify(value, null, '\t'));
	await writable.close();
}

export async function removeFile(path: string): Promise<void> {
	const { dirs, name } = split(path);
	try {
		await (await directory(dirs, false)).removeEntry(name);
	} catch (error) {
		if ((error as DOMException).name !== 'NotFoundError') throw error;
	}
}

export async function listDirectories(path: string): Promise<string[]> {
	let dir: FileSystemDirectoryHandle;
	try {
		dir = await directory(path.split('/').filter(Boolean), false);
	} catch (error) {
		if ((error as DOMException).name === 'NotFoundError') return [];
		throw error;
	}
	const names: string[] = [];
	for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
		if (handle.kind === 'directory') names.push(name);
	}
	return names;
}

export async function fileExists(path: string): Promise<boolean> {
	try {
		await fileHandle(path);
		return true;
	} catch (error) {
		if (['NotFoundError', 'TypeMismatchError'].includes((error as DOMException).name)) return false;
		throw error;
	}
}

/** Deletes a directory and everything in it. */
export async function removeDirectory(path: string): Promise<void> {
	const { dirs, name } = split(path);
	try {
		await (await directory(dirs, false)).removeEntry(name, { recursive: true });
	} catch (error) {
		if ((error as DOMException).name !== 'NotFoundError') throw error;
	}
}
