/**
 * The offline file's library: saved codes held in this tab, and kept only in
 * a file the person saves and opens again later.
 *
 * SEAM(library): a stand-in for the file store the library milestone (M11)
 * builds, written to the studio's `LibraryStore` and nothing more, plus the
 * two calls a file needs (`toFile` and `fromFile`). When that store merges it
 * replaces this module and the view does not change. Nothing here touches any
 * browser store: the items are a list in memory, gone when the tab closes
 * unless the person saved the file.
 */

import { QrStudioError } from '../core/errors.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import type {
	LibraryItem,
	LibraryItemSummary,
	LibraryStore,
	StudioDocument,
} from '../studio/index.js';

/** The suffix a library file is saved with, and how a dropped one is recognised. */
export const LIBRARY_SUFFIX = '.qrlibrary.json';
const SCHEMA = 'qr-library';
/** A library file is a few designs; one with a logo in every code is a few megabytes. */
const MAX_FILE = 32 * 1024 * 1024;

export interface FileLibraryStore extends LibraryStore {
	/** The library as a file for the person to keep. */
	toFile(): { readonly bytes: Uint8Array; readonly filename: string };
	/** Add what a library file holds. Resolves to how many codes it added. */
	fromFile(bytes: Uint8Array): Promise<Result<number>>;
	/** True when something was saved or removed since the file was last saved or opened. */
	readonly dirty: boolean;
}

function corrupt(): QrStudioError {
	return new QrStudioError('library/corrupt', 'This library file is damaged and cannot be opened.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summary(item: LibraryItem): LibraryItemSummary {
	return Object.freeze({
		id: item.id,
		name: item.name,
		savedAt: item.savedAt,
		typeId: item.typeId,
	});
}

export function createFileLibrary(clock: () => number = () => Date.now()): FileLibraryStore {
	const items: LibraryItem[] = [];
	let counter = 0;
	let dirty = false;
	const newId = (): string => {
		counter += 1;
		return `${clock().toString(36)}-${counter.toString(36)}`;
	};
	const listed = (): readonly LibraryItemSummary[] =>
		Object.freeze([...items].sort((a, b) => b.savedAt - a.savedAt).map(summary));

	return {
		get dirty() {
			return dirty;
		},
		// Always there and always on: there is nothing to switch on, because
		// nothing is written anywhere until the person saves the file.
		probe: async () => ok({ available: true, enabled: true }),
		enable: async () => ok(null),
		disable: async () => {
			items.length = 0;
			dirty = false;
			return ok(null);
		},
		list: async () => ok(listed()),
		save: async ({
			name,
			document,
		}: {
			readonly name: string;
			readonly document: StudioDocument;
		}) => {
			const item: LibraryItem = Object.freeze({
				id: newId(),
				name: name.trim() === '' ? 'Untitled' : name.trim().slice(0, 80),
				savedAt: clock(),
				typeId: document.typeId,
				document,
			});
			items.push(item);
			dirty = true;
			return ok(summary(item));
		},
		load: async (id: string) => {
			const found = items.find((item) => item.id === id);
			return found === undefined ? err(corrupt()) : ok(found);
		},
		remove: async (id: string) => {
			const at = items.findIndex((item) => item.id === id);
			if (at >= 0) {
				items.splice(at, 1);
				dirty = true;
			}
			return ok(null);
		},
		toFile() {
			dirty = false;
			const body = JSON.stringify({ schema: SCHEMA, version: 1, items }, null, '\t');
			return { bytes: new TextEncoder().encode(body), filename: `qr-codes${LIBRARY_SUFFIX}` };
		},
		async fromFile(bytes: Uint8Array): Promise<Result<number>> {
			if (bytes.length > MAX_FILE) return err(corrupt());
			let parsed: unknown;
			try {
				parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
			} catch {
				return err(corrupt());
			}
			if (!isRecord(parsed) || parsed.schema !== SCHEMA || !Array.isArray(parsed.items)) {
				return err(corrupt());
			}
			let added = 0;
			for (const raw of parsed.items) {
				// The document is checked by the studio when it is opened
				// (documentFrom repairs what it can), so only the envelope is
				// checked here.
				if (!isRecord(raw) || !isRecord(raw.document)) continue;
				const name = typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Untitled';
				const savedAt =
					typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : clock();
				const typeId = typeof raw.typeId === 'string' ? raw.typeId : 'url';
				items.push(
					Object.freeze({
						id: newId(),
						name,
						savedAt,
						typeId,
						document: raw.document as unknown as StudioDocument,
					}),
				);
				added += 1;
			}
			dirty = false;
			return ok(added);
		},
	};
}
