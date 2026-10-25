/**
 * The website's library in a real browser, for e2e/library.spec.ts.
 *
 * Bundled for the page as it is built, and run against the page's own
 * `indexedDB`, the same way the website builds its store. Each step returns
 * plain data, and the list of databases as `indexedDB.databases()` reports
 * it, so the spec can show what exists after each one.
 */

import { LIBRARY_DATABASE, createIndexedDbLibrary } from '../../../src/dom/library/index.js';
import type { IdbFactoryLike, IndexedDbLibrary } from '../../../src/dom/library/index.js';
import type { Result } from '../../../src/core/result.js';
import { createRegistries } from '../../../src/registries.js';
import { createStudio } from '../../../src/studio/studio.js';
import type { Studio } from '../../../src/studio/types.js';

/** A Wi-Fi password nobody has, which must not be found anywhere the browser stored. */
const SECRET = 'Synthetic-Passphrase-4f1c9e';

const registries = createRegistries();

function store(factory: IdbFactoryLike = globalThis.indexedDB): IndexedDbLibrary {
	return createIndexedDbLibrary({ indexedDB: factory, registries });
}

function code(result: Result<unknown>): string {
	return result.ok ? 'ok' : result.error.code;
}

export async function databases(): Promise<{ name: string; version: number }[]> {
	return (await globalThis.indexedDB.databases()).map(({ name, version }) => ({
		name: name ?? '',
		version: version ?? 0,
	}));
}

/** Until the studio's probe of the library has answered, however long the engine takes. */
function answered(studio: Studio): Promise<void> {
	return new Promise((resolve) => {
		const check = (): void => {
			if (studio.getSnapshot().library.status === 'checking') return;
			stop();
			resolve();
		};
		const stop = studio.subscribe(check);
		check();
	});
}

/** A studio with Wi-Fi content typed in, over `library`, once its probe has answered. */
async function studioWithContent(library: IndexedDbLibrary): Promise<Studio> {
	const studio = createStudio({ registries, library });
	await answered(studio);
	studio.dispatch({ type: 'payload/type', typeId: 'wifi' });
	studio.dispatch({ type: 'payload/field', key: 'ssid', value: 'Example Network' });
	studio.dispatch({ type: 'payload/field', key: 'password', value: SECRET });
	studio.dispatch({ type: 'design/preset', id: 'hex-pro-blue' });
	return studio;
}

/** A whole visit with the library left off: every operation refused, nothing opened. */
export async function untouched() {
	const library = store();
	const probe = await library.probe();
	const codes = (
		await Promise.all([
			library.list(),
			library.contents(),
			library.load('1'),
			library.remove('1'),
			library.listKits(),
			library.loadKit('1'),
			library.removeKit('1'),
		])
	).map(code);
	const studio = await studioWithContent(store());
	const status = studio.getSnapshot().library.status;
	const saved = code(await studio.run({ type: 'library/save', name: 'Office' }));
	studio.dispose();
	return {
		probe: probe.ok ? probe.value : null,
		codes,
		status,
		saved,
		databases: await databases(),
	};
}

/**
 * The open that finds the database gone. databases() is made to say it is
 * there, as it would have a moment before another tab deleted it; the open
 * must abort rather than leave an empty database behind.
 */
export async function vanished() {
	const real = globalThis.indexedDB;
	const library = store({
		open: (name, version) => real.open(name, version),
		deleteDatabase: (name) => real.deleteDatabase(name),
		databases: async () => [{ name: LIBRARY_DATABASE, version: 1 }],
	});
	const listed = code(await library.list());
	return { listed, databases: await databases() };
}

/** The person switches the library on and saves a design and a kit through the studio. */
export async function switchOn() {
	const studio = await studioWithContent(store());
	const enabled = code(await studio.run({ type: 'library/enable' }));
	const saved = await studio.run({ type: 'library/save', name: 'Office' });
	studio.dispose();
	const kit = await store().saveKit({
		name: 'Brand',
		kit: { palette: ['#0b76d9'], logo: null, presets: ['hex-pro-blue'] },
	});
	return {
		enabled,
		saved: saved.ok ? saved.value.name : code(saved),
		kit: kit.ok ? kit.value.name : code(kit),
		databases: await databases(),
		stored: await everythingStored(),
	};
}

/** Every value in the library's stores, as text, read without the store. */
async function everythingStored(): Promise<string> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = globalThis.indexedDB.open(LIBRARY_DATABASE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	const values = await Promise.all(
		[...db.objectStoreNames].map(
			(name) =>
				new Promise<unknown[]>((resolve) => {
					const request = db.transaction(name).objectStore(name).getAll();
					request.onsuccess = () => resolve(request.result);
				}),
		),
	);
	db.close();
	return JSON.stringify(values);
}

/** The next visit: found on without being switched on again. */
export async function reopen() {
	const library = store();
	const probe = await library.probe();
	const listed = await library.list();
	const loaded = await library.load('1');
	return {
		probe: probe.ok ? probe.value : null,
		names: listed.ok ? listed.value.map((item) => item.name) : code(listed),
		fields: loaded.ok ? loaded.value.document.fields : code(loaded),
		databases: await databases(),
	};
}

/** The person switches it off again. */
export async function switchOff() {
	const library = store();
	const disabled = code(await library.disable());
	const probe = await library.probe();
	return {
		disabled,
		probe: probe.ok ? probe.value : null,
		listed: code(await library.list()),
		databases: await databases(),
	};
}
