/**
 * The website's library: saved designs and brand kits in IndexedDB, once the
 * person has switched the library on, and nowhere at all before then.
 *
 * This is the one file in the package allowed near browser storage
 * (eslint.config.js, LIBRARY_FILE), and the one store it may use is
 * IndexedDB. The offline app never reaches it: a page opened from `file://`
 * has no origin worth trusting with storage, so the offline library is a file
 * the person saves instead (src/dom/file-library.ts, which also holds the
 * rules every record follows).
 *
 * "Nothing is stored until you ask" is meant mechanically:
 *
 * - Importing this module does nothing, and neither does creating a store.
 *   The factory is passed in by the caller (`globalThis.indexedDB`), so even
 *   the global is read only when the caller's code decides to read it.
 * - `probe` asks `indexedDB.databases()` whether the library exists, which
 *   reads the list of databases without opening one. A browser without it
 *   (Firefox before 126) gets 'unknown', and the view offers "Open my
 *   library": the click is the consent, and it is the first moment anything
 *   is opened.
 * - Every other operation opens the database only if it already exists. An
 *   open that finds it gone (deleted from another tab between the check and
 *   the open) aborts its own upgrade, which is what stops IndexedDB from
 *   creating an empty one in its place. Only `enable` creates.
 * - `disable` closes the connection and deletes the whole database. Nothing
 *   anywhere records that the library was on, in localStorage or elsewhere:
 *   such a flag would itself be something left behind before anybody agreed
 *   to anything. The database existing is the flag, so deleting it leaves
 *   nothing.
 *
 * Every failure is a Result. A full disk is 'library/quota'; a browser that
 * will not store anything (a private window in some engines, a sandboxed
 * frame, a delete held up by another tab) is 'library/unavailable'; a record
 * that cannot be used is 'library/corrupt' and is left out of a listing
 * rather than thrown. Platform errors are mapped by name and never carried
 * along: an IndexedDB error message can quote the value it failed to store.
 */

import { QrStudioError } from '../../core/errors.js';
import type { Issue } from '../../core/issue.js';
import { err, ok } from '../../core/result.js';
import type { Result } from '../../core/result.js';
import type { LibraryItem, LibraryItemSummary, StudioDocument } from '../../studio/index.js';
import {
	corruptError,
	libraryRecords,
	missingError,
	recordKey,
	skippedIssue,
	stamp,
} from '../file-library.js';
import type {
	BrandKit,
	Collection,
	DesignLibrary,
	KitItem,
	KitSummary,
	LibraryContents,
	LibraryProbe,
	RecordRules,
} from '../file-library.js';

export const LIBRARY_DATABASE = 'qr-code-studio-library';
/**
 * The schema version. Version 1 has two object stores, `designs` and `kits`,
 * each with keys the store gives out itself. A later version adds a step to
 * `upgrade` for the versions before it, and never changes what one did.
 */
export const LIBRARY_DATABASE_VERSION = 1;

const DESIGNS = 'designs';
const KITS = 'kits';

/** The slice of IDBFactory the store uses. `databases` is missing in Firefox before 126. */
export interface IdbFactoryLike {
	open(name: string, version: number): IDBOpenDBRequest;
	deleteDatabase(name: string): IDBOpenDBRequest;
	databases?(): Promise<readonly IDBDatabaseInfo[]>;
}

export interface IndexedDbLibraryDeps extends RecordRules {
	/**
	 * The browser's factory, `globalThis.indexedDB`, read by the caller when it
	 * builds the store. Missing or null where there is none (a server render,
	 * a browser with storage turned off), and every operation then says
	 * 'library/unavailable'.
	 */
	readonly indexedDB: IdbFactoryLike | null | undefined;
	/** Milliseconds since 1970. Default Date.now. */
	readonly now?: () => number;
}

export type IndexedDbLibrary = DesignLibrary;

function unavailable(reason?: 'blocked'): QrStudioError {
	return reason === 'blocked'
		? new QrStudioError(
				'library/unavailable',
				'The library is open in another tab. Close that tab and the library will be deleted.',
				{ reason },
			)
		: new QrStudioError('library/unavailable', 'Saved codes are not available in this browser.');
}

function notEnabled(): QrStudioError {
	return new QrStudioError(
		'library/not-enabled',
		'The library is switched off. Switch it on to save codes in this browser.',
	);
}

/**
 * What a platform error amounts to, by its name alone. The error itself is
 * dropped rather than kept as a cause: a DataCloneError's message, for one,
 * quotes the value it could not store.
 */
function storageError(cause: unknown): QrStudioError {
	const name =
		typeof cause === 'object' && cause !== null && 'name' in cause ? String(cause.name) : '';
	// QuotaExceededError everywhere today; Firefox before version 58 had its own name.
	if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
		return new QrStudioError(
			'library/quota',
			'This browser has no more room for saved codes. Remove some and try again.',
		);
	}
	return unavailable();
}

/** The id a key the store gave out is known by. */
function idOf(key: IDBValidKey): string {
	return String(key);
}

function idArgument(id: unknown, who: string): string {
	if (typeof id !== 'string') throw new TypeError(`${who}: id is a string.`);
	return id;
}

/** Make the stores a version needs, from the version the database was at. */
function upgrade(db: IDBDatabase, from: number): void {
	if (from < 1) {
		db.createObjectStore(DESIGNS, { autoIncrement: true });
		db.createObjectStore(KITS, { autoIncrement: true });
	}
}

/**
 * The website's library, over the IndexedDB factory the caller passes:
 * `createIndexedDbLibrary({ indexedDB: globalThis.indexedDB, registries })`.
 * Creating it reads nothing and opens nothing.
 */
export function createIndexedDbLibrary(deps: IndexedDbLibraryDeps): IndexedDbLibrary {
	if (typeof deps !== 'object' || deps === null) {
		throw new TypeError('createIndexedDbLibrary: deps is { indexedDB, registries }.');
	}
	const records = libraryRecords(deps);
	const factory = deps.indexedDB ?? null;
	const now = deps.now ?? Date.now;
	/** The connection, open or opening. Cleared when it fails, closes or is asked to go. */
	let connection: Promise<Result<IDBDatabase>> | null = null;
	let open: IDBDatabase | null = null;

	/**
	 * Drop the connection this store holds. Each connection ends once, by
	 * whichever comes first of a versionchange, the browser closing it or
	 * `disable`, and only while it is the one held, so there is never a newer
	 * one here for this to drop by mistake.
	 */
	function forget(): void {
		open = null;
		connection = null;
	}

	/**
	 * Whether the library's database exists, from the list of databases, which
	 * opens nothing. Null when the browser cannot say.
	 */
	async function exists(source: IdbFactoryLike): Promise<boolean | null> {
		if (typeof source.databases !== 'function') return null;
		try {
			const all = await source.databases();
			return all.some((info) => info.name === LIBRARY_DATABASE);
		} catch {
			return null;
		}
	}

	function openDatabase(source: IdbFactoryLike, create: boolean): Promise<Result<IDBDatabase>> {
		return new Promise((resolve) => {
			let request: IDBOpenDBRequest;
			try {
				request = source.open(LIBRARY_DATABASE, LIBRARY_DATABASE_VERSION);
			} catch (thrown) {
				resolve(err(storageError(thrown)));
				return;
			}
			let declined = false;
			request.onupgradeneeded = (event) => {
				// Version 0 is a database IndexedDB has just made because nothing
				// was there. Unless the person asked for one, abort the upgrade,
				// which removes it again, and say the library is off.
				if (event.oldVersion === 0 && !create) {
					declined = true;
					(request.transaction as IDBTransaction).abort();
					return;
				}
				upgrade(request.result, event.oldVersion);
			};
			request.onsuccess = () => {
				const db = request.result;
				// Another tab switching the library off, or a newer build upgrading
				// it, asks this connection to get out of the way. It does, at once,
				// so the delete or the upgrade is never held up by this tab.
				db.onversionchange = () => {
					db.close();
					forget();
				};
				// The browser closing it underneath (the person cleared site data).
				db.onclose = () => forget();
				open = db;
				resolve(ok(db));
			};
			request.onerror = (event) => {
				event.preventDefault();
				resolve(err(declined ? notEnabled() : storageError(request.error)));
			};
		});
	}

	function connect(source: IdbFactoryLike, create: boolean): Promise<Result<IDBDatabase>> {
		connection ??= openDatabase(source, create).then((opened) => {
			if (!opened.ok) connection = null;
			return opened;
		});
		return connection;
	}

	/** The open database, for an operation that must not create one. */
	async function existing(): Promise<Result<IDBDatabase>> {
		if (factory === null) return err(unavailable());
		if (connection !== null) return connection;
		if ((await exists(factory)) !== true) return err(notEnabled());
		return connect(factory, false);
	}

	/**
	 * Run one transaction. `work` makes its requests and returns how to read
	 * the answer, which is read once the transaction has committed, so a write
	 * is reported only when it is on disk and a failed commit (a full disk,
	 * which browsers report at commit) is reported as a failure.
	 */
	async function transact<T>(
		stores: readonly string[],
		mode: IDBTransactionMode,
		work: (tx: IDBTransaction) => () => T,
	): Promise<Result<T>> {
		const db = await existing();
		if (!db.ok) return db;
		return new Promise((resolve) => {
			try {
				const tx = db.value.transaction([...stores], mode);
				const read = work(tx);
				tx.oncomplete = () => resolve(ok(read()));
				tx.onabort = () => resolve(err(storageError(tx.error)));
			} catch (thrown) {
				// Refused as it was asked: a connection that closed in the meantime,
				// or a value that cannot be stored. Each piece of work makes its one
				// write last, so a transaction left behind by a throw holds nothing
				// and commits nothing.
				resolve(err(storageError(thrown)));
			}
		});
	}

	function everything<E, S, I>(
		tx: IDBTransaction,
		collection: Collection<E, S, I>,
		skipped: Issue[],
	): S[] {
		const out: S[] = [];
		const cursor = tx.objectStore(collection.store).openCursor();
		cursor.onsuccess = () => {
			const at = cursor.result;
			if (at === null) return;
			const id = idOf(at.key);
			const checked = collection.check(at.value);
			if (checked.problem !== null)
				skipped.push(skippedIssue(collection.store, id, checked.problem));
			else out.push(collection.summary(id, checked.entry));
			at.continue();
		};
		return out;
	}

	function listOf<E, S, I>(collection: Collection<E, S, I>): Promise<Result<readonly S[]>> {
		return transact([collection.store], 'readonly', (tx) => {
			const out = everything(tx, collection, []);
			return () => Object.freeze(out);
		});
	}

	async function saveTo<E, S, I>(
		collection: Collection<E, S, I>,
		entry: Result<E>,
	): Promise<Result<S>> {
		if (!entry.ok) return entry;
		const value = entry.value;
		return transact([collection.store], 'readwrite', (tx) => {
			const request = tx.objectStore(collection.store).add(value);
			return () => collection.summary(idOf(request.result), value);
		});
	}

	async function loadFrom<E, S, I>(
		collection: Collection<E, S, I>,
		id: string,
	): Promise<Result<I>> {
		const key = recordKey(id);
		const read = await transact([collection.store], 'readonly', (tx) => {
			const request = key === null ? null : tx.objectStore(collection.store).get(key);
			return (): Result<I> => {
				const value: unknown = request?.result;
				if (value === undefined) return err(missingError());
				const checked = collection.check(value);
				return checked.problem !== null
					? err(corruptError())
					: ok(collection.item(id, checked.entry));
			};
		});
		return read.ok ? read.value : read;
	}

	function removeFrom<E, S, I>(collection: Collection<E, S, I>, id: string): Promise<Result<null>> {
		const key = recordKey(id);
		return transact([collection.store], 'readwrite', (tx) => {
			// An id no store gave out names nothing, so there is nothing to remove.
			if (key !== null) tx.objectStore(collection.store).delete(key);
			return () => null;
		});
	}

	return Object.freeze({
		async probe(): Promise<Result<LibraryProbe>> {
			if (factory === null) {
				return ok(
					Object.freeze({ available: false, enabled: false, state: 'unavailable' as const }),
				);
			}
			const found = open !== null ? true : await exists(factory);
			const state = found === null ? 'unknown' : found ? 'on' : 'off';
			return ok(Object.freeze({ available: true, enabled: found === true, state }));
		},
		async enable(): Promise<Result<null>> {
			if (factory === null) return err(unavailable());
			const before = connection === null ? null : await connection;
			if (before?.ok === true) return ok(null);
			const opened = await connect(factory, true);
			return opened.ok ? ok(null) : opened;
		},
		async disable(): Promise<Result<null>> {
			if (factory === null) return err(unavailable());
			// Closed first so this tab never blocks its own delete. Any other
			// connection, in this tab or another, closes itself on the versionchange
			// the delete sends.
			const current = connection;
			if (current !== null) {
				const opened = await current;
				if (opened.ok) {
					opened.value.close();
					forget();
				}
			}
			return new Promise((resolve) => {
				let request: IDBOpenDBRequest;
				try {
					request = factory.deleteDatabase(LIBRARY_DATABASE);
				} catch (thrown) {
					resolve(err(storageError(thrown)));
					return;
				}
				request.onsuccess = () => resolve(ok(null));
				request.onerror = (event) => {
					event.preventDefault();
					resolve(err(storageError(request.error)));
				};
				// Another tab holds a connection and did not let go. The delete
				// stays queued and finishes when that tab closes; the person is
				// told now rather than left waiting.
				request.onblocked = () => resolve(err(unavailable('blocked')));
			});
		},
		list(): Promise<Result<readonly LibraryItemSummary[]>> {
			return listOf(records.designs);
		},
		contents(): Promise<Result<LibraryContents>> {
			return transact([DESIGNS, KITS], 'readonly', (tx) => {
				// Two cursors in one transaction take turns, so each keeps its own
				// list of what it left out and the two are joined in a fixed order.
				const skippedDesigns: Issue[] = [];
				const skippedKits: Issue[] = [];
				const designs = everything(tx, records.designs, skippedDesigns);
				const kits = everything(tx, records.kits, skippedKits);
				return () =>
					Object.freeze({
						designs: Object.freeze(designs),
						kits: Object.freeze(kits),
						skipped: Object.freeze([...skippedDesigns, ...skippedKits]),
					});
			});
		},
		async save(item: { readonly name: string; readonly document: StudioDocument }) {
			return saveTo(records.designs, records.designIn(item, stamp(now)));
		},
		async load(id: string): Promise<Result<LibraryItem>> {
			return loadFrom(records.designs, idArgument(id, 'load'));
		},
		async remove(id: string): Promise<Result<null>> {
			return removeFrom(records.designs, idArgument(id, 'remove'));
		},
		listKits(): Promise<Result<readonly KitSummary[]>> {
			return listOf(records.kits);
		},
		async saveKit(item: { readonly name: string; readonly kit: BrandKit }) {
			return saveTo(records.kits, records.kitIn(item, stamp(now)));
		},
		async loadKit(id: string): Promise<Result<KitItem>> {
			return loadFrom(records.kits, idArgument(id, 'loadKit'));
		},
		async removeKit(id: string): Promise<Result<null>> {
			return removeFrom(records.kits, idArgument(id, 'removeKit'));
		},
	});
}
