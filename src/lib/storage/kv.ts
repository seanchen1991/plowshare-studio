// A small key-value store in IndexedDB, for values localStorage can't hold
// (a folder handle). Lives with the site's other storage.

const dbName = 'plowshare';
const storeName = 'kv';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(storeName);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const request = action(db.transaction(storeName, mode).objectStore(storeName));
			request.onsuccess = () => resolve(request.result as T);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

export function kvGet<T>(key: string): Promise<T | undefined> {
	return run<T | undefined>('readonly', (store) => store.get(key));
}

export async function kvSet(key: string, value: unknown): Promise<void> {
	await run('readwrite', (store) => store.put(value, key));
}

export async function kvDelete(key: string): Promise<void> {
	await run('readwrite', (store) => store.delete(key));
}
