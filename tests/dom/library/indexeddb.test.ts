/**
 * The website's library, over fake-indexeddb: nothing is opened or created
 * before the person asks, switching it on makes one database, switching it
 * off deletes it, and every way storage fails comes back as a Result.
 *
 * Each test has a factory of its own, so a database one test makes is never
 * what another one finds. The failures a real disk has and fake-indexeddb
 * does not (a full disk at commit, a delete that errors) come from a small
 * stand-in factory at the bottom.
 */

import fc from 'fast-check';
import {
	IDBDatabase as FakeDatabase,
	IDBFactory,
	IDBObjectStore as FakeObjectStore,
	forceCloseDatabase,
} from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignEntry } from '../../../src/dom/file-library.js';
import { LIBRARY_KEYS, libraryErrorKey } from '../../../src/dom/file-library.js';
import {
	LIBRARY_DATABASE,
	LIBRARY_DATABASE_VERSION,
	createIndexedDbLibrary,
} from '../../../src/dom/library/indexeddb.js';
import type { IdbFactoryLike, IndexedDbLibrary } from '../../../src/dom/library/indexeddb.js';
import { createStudio } from '../../../src/studio/studio.js';
import type { LibraryState, Studio } from '../../../src/studio/types.js';
import type { Result } from '../../../src/core/result.js';
import { DEFAULT_CONDITIONS } from '../../../src/studio/document.js';
import {
	NETWORK,
	SECRET,
	assetOf,
	brandKit,
	designs,
	names,
	normalised,
	picture,
	registries,
	wifiDocument,
} from './helpers.js';

const NOW = 1_761_436_800_000;

function libraryOn(factory: IdbFactoryLike | null | undefined, now = () => NOW): IndexedDbLibrary {
	return createIndexedDbLibrary({ indexedDB: factory, registries, now });
}

async function listed(factory: IDBFactory): Promise<IDBDatabaseInfo[]> {
	return factory.databases();
}

function code(result: Result<unknown>): string {
	return result.ok ? 'ok' : result.error.code;
}

function value<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
	return result.value;
}

/** A connection of the test's own, as another script or an older tab would hold one. */
function rawOpen(factory: IDBFactory, version?: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request =
			version === undefined
				? factory.open(LIBRARY_DATABASE)
				: factory.open(LIBRARY_DATABASE, version);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Write a value straight into one of the library's stores, as something other than this store might. */
async function rawAdd(factory: IDBFactory, store: string, value: unknown): Promise<string> {
	const db = await rawOpen(factory);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const request = tx.objectStore(store).add(value);
		tx.oncomplete = () => {
			db.close();
			resolve(String(request.result));
		};
		tx.onabort = () => reject(tx.error);
	});
}

/** Everything in both stores, as stored. */
async function rawDump(factory: IDBFactory): Promise<unknown[]> {
	const db = await rawOpen(factory);
	const all = await Promise.all(
		['designs', 'kits'].map(
			(store) =>
				new Promise<unknown[]>((resolve) => {
					const request = db.transaction(store).objectStore(store).getAll();
					request.onsuccess = () => resolve(request.result);
				}),
		),
	);
	db.close();
	return all.flat();
}

/** Until the studio's library state passes `done`. */
function until(studio: Studio, done: (library: LibraryState) => boolean): Promise<void> {
	return new Promise((resolve) => {
		const check = (): void => {
			if (!done(studio.getSnapshot().library)) return;
			stop();
			resolve();
		};
		const stop = studio.subscribe(check);
		check();
	});
}

function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('before the person asks', () => {
	it('reads nothing when it is made, and probing opens nothing', async () => {
		const factory = new IDBFactory();
		const touched: string[] = [];
		const watched = new Proxy(factory, {
			get(target, name, receiver) {
				touched.push(String(name));
				const found = Reflect.get(target, name, receiver) as unknown;
				return typeof found === 'function' ? found.bind(target) : found;
			},
		});
		const library = libraryOn(watched as IDBFactory);
		expect(touched).toEqual([]);
		const opened = vi.spyOn(factory, 'open');
		const deleted = vi.spyOn(factory, 'deleteDatabase');
		expect(value(await library.probe())).toEqual({ available: true, enabled: false, state: 'off' });
		expect(opened).not.toHaveBeenCalled();
		expect(deleted).not.toHaveBeenCalled();
		expect(touched.filter((name) => name !== 'databases')).toEqual([]);
		expect(await listed(factory)).toEqual([]);
	});

	it('refuses every operation until it is switched on, and still opens nothing', async () => {
		const factory = new IDBFactory();
		const opened = vi.spyOn(factory, 'open');
		const library = libraryOn(factory);
		const results = await Promise.all([
			library.list(),
			library.contents(),
			library.save({ name: 'Too soon', document: wifiDocument() }),
			library.load('1'),
			library.remove('1'),
			library.listKits(),
			library.saveKit({ name: 'Too soon', kit: brandKit() }),
			library.loadKit('1'),
			library.removeKit('1'),
		]);
		expect(results.map(code)).toEqual(Array(9).fill('library/not-enabled'));
		expect(opened).not.toHaveBeenCalled();
		expect(await listed(factory)).toEqual([]);
	});

	it('leaves nothing behind when a studio runs a whole session with it switched off', async () => {
		const factory = new IDBFactory();
		const opened = vi.spyOn(factory, 'open');
		const studio = createStudio({ library: libraryOn(factory) });
		await until(studio, (library) => library.status !== 'checking');
		expect(studio.getSnapshot().library).toEqual({ status: 'off' });
		studio.dispatch({ type: 'payload/type', typeId: 'wifi' });
		studio.dispatch({ type: 'payload/field', key: 'ssid', value: NETWORK });
		studio.dispatch({ type: 'payload/field', key: 'password', value: SECRET });
		studio.dispatch({ type: 'design/preset', id: 'hex-pro-blue' });
		expect(code(await studio.run({ type: 'library/save', name: 'Office' }))).toBe(
			'library/not-enabled',
		);
		expect(code(await studio.run({ type: 'library/load', id: '1' }))).toBe('library/not-enabled');
		studio.dispose();
		expect(opened).not.toHaveBeenCalled();
		expect(await listed(factory)).toEqual([]);
	});

	it('says it cannot tell, rather than opening, where the browser has no databases()', async () => {
		const factory = new IDBFactory();
		const opened = vi.spyOn(factory, 'open');
		const bare: IdbFactoryLike = {
			open: (name, version) => factory.open(name, version),
			deleteDatabase: (name) => factory.deleteDatabase(name),
		};
		const library = libraryOn(bare);
		expect(value(await library.probe())).toEqual({
			available: true,
			enabled: false,
			state: 'unknown',
		});
		expect(code(await library.list())).toBe('library/not-enabled');
		expect(opened).not.toHaveBeenCalled();
		// The click on "Open my library" is the consent; from then on it is on.
		expect(code(await library.enable())).toBe('ok');
		expect(value(await library.probe())).toEqual({ available: true, enabled: true, state: 'on' });
		expect(await listed(factory)).toEqual([
			{ name: LIBRARY_DATABASE, version: LIBRARY_DATABASE_VERSION },
		]);
	});

	it('says it cannot tell when databases() fails, and when it throws', async () => {
		const factory = new IDBFactory();
		for (const databases of [
			() => Promise.reject(new DOMException('no', 'SecurityError')),
			() => {
				throw new DOMException('no', 'SecurityError');
			},
		]) {
			const library = libraryOn({
				open: (name, version) => factory.open(name, version),
				deleteDatabase: (name) => factory.deleteDatabase(name),
				databases,
			});
			expect(value(await library.probe()).state).toBe('unknown');
			expect(code(await library.contents())).toBe('library/not-enabled');
		}
	});

	it('is unavailable with no factory, and says so for everything', async () => {
		for (const factory of [null, undefined]) {
			const library = libraryOn(factory);
			expect(value(await library.probe())).toEqual({
				available: false,
				enabled: false,
				state: 'unavailable',
			});
			const results = await Promise.all([
				library.enable(),
				library.disable(),
				library.list(),
				library.save({ name: 'x', document: wifiDocument() }),
				library.loadKit('1'),
			]);
			expect(results.map(code)).toEqual(Array(5).fill('library/unavailable'));
		}
	});

	it('does not create the database when it vanishes between the check and the open', async () => {
		// databases() says it is there; by the time the open runs it has gone
		// (another tab switched the library off). The open must not make an
		// empty one in its place.
		const factory = new IDBFactory();
		let racing: Promise<Result<null>> | null = null;
		let race = false;
		const library: IndexedDbLibrary = libraryOn({
			open(name, version) {
				const request = factory.open(name, version);
				// The person switches it on while that refused open is in flight.
				if (race && racing === null) {
					racing = new Promise((resolve) => queueMicrotask(() => resolve(library.enable())));
				}
				return request;
			},
			deleteDatabase: (name) => factory.deleteDatabase(name),
			databases: async () => [{ name: LIBRARY_DATABASE, version: LIBRARY_DATABASE_VERSION }],
		});
		expect(code(await library.list())).toBe('library/not-enabled');
		expect(await listed(factory)).toEqual([]);
		race = true;
		expect(code(await library.list())).toBe('library/not-enabled');
		expect(racing).not.toBeNull();
		expect(code(await (racing as unknown as Promise<Result<null>>))).toBe('ok');
		expect(await listed(factory)).toHaveLength(1);
	});
});

describe('switched on', () => {
	it('makes exactly one database, and saves, lists, loads and removes', async () => {
		const factory = new IDBFactory();
		let clock = NOW;
		const library = libraryOn(factory, () => (clock += 1000.7));
		expect(code(await library.enable())).toBe('ok');
		expect(code(await library.enable())).toBe('ok');
		expect(await listed(factory)).toEqual([
			{ name: LIBRARY_DATABASE, version: LIBRARY_DATABASE_VERSION },
		]);
		const db = await rawOpen(factory);
		expect([...db.objectStoreNames]).toEqual(['designs', 'kits']);
		db.close();

		const office = value(
			await library.save({ name: '  Office\n Wi-Fi ', document: wifiDocument() }),
		);
		expect(office).toEqual({ id: '1', name: 'Office Wi-Fi', savedAt: NOW + 1000, typeId: 'wifi' });
		const shop = value(await library.save({ name: 'Shop', document: wifiDocument() }));
		expect(shop.id).toBe('2');
		expect(value(await library.list())).toEqual([office, shop]);

		const loaded = value(await library.load('1'));
		expect(loaded).toMatchObject(office);
		expect(loaded.document).toEqual({
			mode: 'create',
			typeId: 'wifi',
			fields: {},
			design: normalised(wifiDocument().design),
			conditions: DEFAULT_CONDITIONS,
		});
		expect(Object.isFrozen(loaded.document)).toBe(true);

		expect(code(await library.remove('1'))).toBe('ok');
		expect(code(await library.remove('1'))).toBe('ok');
		expect(code(await library.remove('not an id'))).toBe('ok');
		expect(value(await library.list())).toEqual([shop]);
		const gone = await library.load('1');
		expect(code(gone)).toBe('library/corrupt');
		expect(!gone.ok && libraryErrorKey(gone.error)).toBe(LIBRARY_KEYS.missing);
		expect(code(await library.load('0'))).toBe('library/corrupt');
		expect(code(await library.load('../designs'))).toBe('library/corrupt');
	});

	it('stamps a save with the time, from Date.now unless given a clock', async () => {
		const library = createIndexedDbLibrary({ indexedDB: new IDBFactory(), registries });
		await library.enable();
		const before = Date.now();
		const saved = value(await library.save({ name: 'Now', document: wifiDocument() }));
		expect(saved.savedAt).toBeGreaterThanOrEqual(before);
		expect(saved.savedAt).toBeLessThanOrEqual(Date.now());
	});

	it('is found on by the next visit, which lists without being switched on again', async () => {
		const factory = new IDBFactory();
		const first = libraryOn(factory);
		await first.enable();
		await first.save({ name: 'Kept', document: wifiDocument() });
		await first.saveKit({ name: 'Brand', kit: brandKit() });

		const opened = vi.spyOn(factory, 'open');
		const next = libraryOn(factory);
		expect(value(await next.probe())).toEqual({ available: true, enabled: true, state: 'on' });
		expect(opened).not.toHaveBeenCalled();
		const [designs, kits] = await Promise.all([next.list(), next.listKits()]);
		expect(value(designs).map((item) => item.name)).toEqual(['Kept']);
		expect(value(kits).map((item) => item.name)).toEqual(['Brand']);
		// One connection, however many operations asked for it at once.
		expect(opened).toHaveBeenCalledTimes(1);

		const studio = createStudio({ registries, library: next });
		// The studio says 'on' as soon as the probe answers and fills the list
		// after, so this waits for the list rather than for a number of turns.
		await until(studio, (library) => library.status === 'on' && library.items.length > 0);
		expect(studio.getSnapshot().library).toMatchObject({ status: 'on', items: [{ name: 'Kept' }] });
		studio.dispose();
	});

	it('deletes everything when it is switched off, and finds nothing afterwards', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		await library.save({ name: 'Gone soon', document: wifiDocument() });
		await library.saveKit({ name: 'Gone soon', kit: brandKit() });
		expect(code(await library.disable())).toBe('ok');
		expect(await listed(factory)).toEqual([]);
		expect(value(await library.probe()).state).toBe('off');
		expect(code(await library.list())).toBe('library/not-enabled');
		expect(value(await libraryOn(factory).probe()).state).toBe('off');
		// Switching off a library that was never on deletes nothing and makes nothing.
		expect(code(await libraryOn(new IDBFactory()).disable())).toBe('ok');
	});

	it('is let go by another tab when one tab switches it off', async () => {
		const factory = new IDBFactory();
		const here = libraryOn(factory);
		const there = libraryOn(factory);
		await here.enable();
		await here.save({ name: 'Shared', document: wifiDocument() });
		expect(value(await there.list())).toHaveLength(1);
		expect(code(await here.disable())).toBe('ok');
		expect(await listed(factory)).toEqual([]);
		expect(code(await there.list())).toBe('library/not-enabled');
		expect(await listed(factory)).toEqual([]);
	});

	it('says so when a connection it does not own holds the delete up', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		const stubborn = await rawOpen(factory);
		const blocked = await library.disable();
		expect(code(blocked)).toBe('library/unavailable');
		expect(!blocked.ok && blocked.error.params).toEqual({ reason: 'blocked' });
		expect(!blocked.ok && libraryErrorKey(blocked.error)).toBe(LIBRARY_KEYS.blocked);
		// The delete stays queued, and finishes once that connection goes.
		stubborn.close();
		for (let turn = 0; turn < 50 && (await listed(factory)).length > 0; turn += 1) await settle();
		expect(await listed(factory)).toEqual([]);
	});

	it('opens again after the browser closes the connection underneath it', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		await library.save({ name: 'One', document: wifiDocument() });
		const opened = vi.spyOn(factory, 'open');
		// The connection the store holds, caught as it starts its next transaction.
		const transaction = FakeDatabase.prototype.transaction;
		const held: IDBDatabase[] = [];
		vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (
			this: IDBDatabase,
			...args: Parameters<IDBDatabase['transaction']>
		) {
			held.push(this);
			return transaction.apply(this, args);
		});
		await library.list();
		// As clearing site data in the browser's settings does.
		const db = held[0] as IDBDatabase;
		const closed = new Promise((resolve) => db.addEventListener('close', resolve));
		forceCloseDatabase(db as never);
		await closed;
		expect(value(await library.list()).map((item) => item.name)).toEqual(['One']);
		expect(opened).toHaveBeenCalledTimes(1);
	});
});

describe('what a record holds', () => {
	it('never holds the content of a code', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		await library.save({ name: 'Office', document: wifiDocument() });
		await library.saveKit({ name: 'Brand', kit: brandKit() });
		const stored = JSON.stringify(await rawDump(factory));
		expect(stored).not.toContain(SECRET);
		expect(stored).not.toContain(NETWORK);
		for (const key of ['fields', 'content', 'password', 'ssid'])
			expect(stored).not.toContain(`"${key}"`);
		expect(value(await library.load('1')).document.fields).toEqual({});

		// And has no room for it in its type.
		const entry: DesignEntry = {
			name: 'x',
			savedAt: 0,
			typeId: 'wifi',
			design: wifiDocument().design,
			conditions: DEFAULT_CONDITIONS,
		};
		// @ts-expect-error a record has no field for content
		const withFields: DesignEntry = { ...entry, fields: { password: SECRET } };
		// @ts-expect-error nor under any other name content goes by
		const withContent: DesignEntry = { ...entry, content: SECRET };
		expect([withFields, withContent]).toHaveLength(2);
	});

	it('refuses, by name, a record something else wrote with content in it', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		const good = value(await library.save({ name: 'Good', document: wifiDocument() }));
		const design = normalised(wifiDocument().design);
		const base = {
			name: 'Bad',
			savedAt: NOW,
			typeId: 'wifi',
			design,
			conditions: DEFAULT_CONDITIONS,
		};
		const ids = {
			fields: await rawAdd(factory, 'designs', { ...base, fields: { password: SECRET } }),
			content: await rawAdd(factory, 'designs', { ...base, content: SECRET }),
			kit: await rawAdd(factory, 'kits', {
				...brandKit(),
				name: 'Kit',
				savedAt: NOW,
				text: SECRET,
			}),
		};
		expect(value(await library.list())).toEqual([good]);
		expect(value(await library.contents())).toEqual({
			designs: [good],
			kits: [],
			skipped: [
				{ code: LIBRARY_KEYS.content, path: ['designs', ids.fields], severity: 'warning' },
				{ code: LIBRARY_KEYS.content, path: ['designs', ids.content], severity: 'warning' },
				{ code: LIBRARY_KEYS.content, path: ['kits', ids.kit], severity: 'warning' },
			],
		});
		expect(code(await library.load(ids.fields))).toBe('library/corrupt');
		expect(code(await library.loadKit(ids.kit))).toBe('library/corrupt');
	});

	it('leaves out and reports damaged records, never throwing, and can remove them', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		const design = normalised(wifiDocument().design);
		const base = {
			name: 'Fine',
			savedAt: NOW,
			typeId: 'wifi',
			design,
			conditions: DEFAULT_CONDITIONS,
		};
		const bad: unknown[] = [
			'a string',
			[base],
			null,
			{ ...base, extra: 1 },
			{ name: 'No conditions', savedAt: NOW, typeId: 'wifi', design },
			{ ...base, name: 42 },
			{ ...base, name: ' padded ' },
			{ ...base, name: 'x'.repeat(200) },
			{ ...base, savedAt: -1 },
			{ ...base, savedAt: Number.NaN },
			{ ...base, typeId: 'Not An Id' },
			{ ...base, typeId: 7 },
			{ ...base, conditions: null },
			{ ...base, conditions: { ...DEFAULT_CONDITIONS, colour: 'red' } },
			{ ...base, conditions: { ...DEFAULT_CONDITIONS, sizeMm: -4 } },
			{ ...base, design: { ...design, version: 2 } },
			{ ...base, design: { ...design, quietZone: 'wide' } },
			{ ...base, design: 'not a design' },
		];
		const ids: string[] = [];
		for (const record of bad) ids.push(await rawAdd(factory, 'designs', record));
		const fine = await rawAdd(factory, 'designs', base);
		const contents = value(await library.contents());
		expect(contents.designs.map((item) => item.id)).toEqual([fine]);
		expect(contents.skipped).toEqual(
			ids.map((id) => ({ code: LIBRARY_KEYS.corrupt, path: ['designs', id], severity: 'warning' })),
		);
		for (const id of ids) {
			const loaded = await library.load(id);
			expect(code(loaded)).toBe('library/corrupt');
			expect(!loaded.ok && loaded.error.params).toEqual({});
		}
		expect(code(await library.remove(ids[0] as string))).toBe('ok');
		expect(value(await library.contents()).skipped).toHaveLength(ids.length - 1);
	});

	it('checks a design on the way in, and cleans the name', async () => {
		const library = libraryOn(new IDBFactory());
		await library.enable();
		const broken = { ...wifiDocument(), design: { ...wifiDocument().design, quietZone: -3 } };
		const refused = await library.save({ name: 'Broken', document: broken as never });
		expect(code(refused)).toBe('design/invalid');
		expect(!refused.ok && refused.error.params.count).toBeGreaterThan(0);
		const repaired = value(
			await library.save({
				name: 'A\u0000B\u2028C',
				document: { ...wifiDocument(), conditions: { sizeMm: -1 } as never },
			}),
		);
		expect(repaired.name).toBe('A B C');
		expect(value(await library.load(repaired.id)).document.conditions).toEqual(DEFAULT_CONDITIONS);
	});

	it('throws TypeError for a caller mistake, and only for that', async () => {
		expect(() => createIndexedDbLibrary(null as never)).toThrow(TypeError);
		expect(() => createIndexedDbLibrary({ indexedDB: null } as never)).toThrow(TypeError);
		const library = libraryOn(new IDBFactory());
		await library.enable();
		await expect(library.save(null as never)).rejects.toThrow(TypeError);
		await expect(library.save({ name: 1, document: wifiDocument() } as never)).rejects.toThrow(
			TypeError,
		);
		await expect(
			library.save({ name: 'x', document: { ...wifiDocument(), typeId: 'Wi Fi' } }),
		).rejects.toThrow(TypeError);
		await expect(library.saveKit({ name: 'x' } as never)).rejects.toThrow(TypeError);
		await expect(library.saveKit({ name: 2, kit: brandKit() } as never)).rejects.toThrow(TypeError);
		for (const call of [
			() => library.load(1 as never),
			() => library.remove(1 as never),
			() => library.loadKit(1 as never),
			() => library.removeKit(1 as never),
		])
			await expect(call()).rejects.toThrow(TypeError);
		const broken = libraryOn(new IDBFactory(), () => Number.NaN);
		await expect(broken.save({ name: 'x', document: wifiDocument() })).rejects.toThrow(TypeError);
	});

	it('hands every design back exactly as the design layer reads it', async () => {
		const library = libraryOn(new IDBFactory());
		await library.enable();
		await fc.assert(
			fc.asyncProperty(designs, names, async (design, name) => {
				const saved = value(await library.save({ name, document: wifiDocument(design) }));
				expect(saved.name.length).toBeLessThanOrEqual(160);
				expect(saved.name).toBe(saved.name.trim());
				const loaded = value(await library.load(saved.id));
				expect(loaded.document.design).toEqual(design);
				expect(loaded.name).toBe(saved.name);
				expect(code(await library.remove(saved.id))).toBe('ok');
			}),
			{ numRuns: 60, seed: 20261026 },
		);
	});
});

describe('brand kits', () => {
	it('saves, lists, loads and removes a kit', async () => {
		const library = libraryOn(new IDBFactory());
		await library.enable();
		const kit = brandKit({ presets: ['hex-pro-blue', 'hex-pro-blue', 'rounded-ocean'] });
		const saved = value(await library.saveKit({ name: 'Hex Pro', kit }));
		expect(saved).toEqual({ id: '1', name: 'Hex Pro', savedAt: NOW });
		expect(value(await library.listKits())).toEqual([saved]);
		expect(value(await library.loadKit('1'))).toEqual({
			...saved,
			kit: { ...kit, presets: ['hex-pro-blue', 'rounded-ocean'] },
		});
		const plain = value(
			await library.saveKit({ name: 'Plain', kit: brandKit({ logo: null, palette: [] }) }),
		);
		expect(value(await library.loadKit(plain.id)).kit).toEqual({
			palette: [],
			logo: null,
			presets: kit.presets.slice(1),
		});
		expect(code(await library.removeKit('1'))).toBe('ok');
		expect(value(await library.listKits())).toEqual([plain]);
		expect(code(await library.loadKit('1'))).toBe('library/corrupt');
	});

	it('refuses a kit with anything a design would not take', async () => {
		const library = libraryOn(new IDBFactory());
		await library.enable();
		const oversized = assetOf(picture(2, 2));
		const kits = [
			brandKit({ palette: ['not a colour'] }),
			brandKit({ palette: [{ srgb: '#000000', cmyk: [0, 0, 0, 2] }] as never }),
			brandKit({ palette: Array(33).fill('#000000') }),
			brandKit({ palette: 'red' as never }),
			brandKit({ logo: { ...oversized, width: 3 } }),
			brandKit({ logo: { ...oversized, png: 'aGVsbG8=' } }),
			brandKit({ presets: ['no-such-preset'] }),
			brandKit({ presets: ['Not Kebab'] }),
			brandKit({ presets: Array(33).fill('hex-pro-blue') }),
			brandKit({ presets: 'hex-pro-blue' as never }),
			{ ...brandKit(), extra: true },
			{ ...brandKit(), content: SECRET },
			{ palette: [], presets: [] },
		];
		for (const kit of kits) {
			const refused = await library.saveKit({ name: 'Bad', kit: kit as never });
			expect(code(refused)).toBe('design/invalid');
			expect(!refused.ok && libraryErrorKey(refused.error)).toBe(LIBRARY_KEYS.kit);
		}
		expect(value(await library.listKits())).toEqual([]);
	});

	it('keeps a kit from a newer build, without the presets this one lacks', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		const id = await rawAdd(factory, 'kits', {
			...brandKit({ presets: ['from-the-future', 'hex-pro-blue'] }),
			name: 'Newer',
			savedAt: NOW,
		});
		const broken = await rawAdd(factory, 'kits', {
			...brandKit(),
			name: 'Broken',
			savedAt: 'today',
		});
		const notAKit = await rawAdd(factory, 'kits', 7);
		const badInk = await rawAdd(factory, 'kits', {
			...brandKit({ palette: ['nope'] }),
			name: 'Ink',
			savedAt: NOW,
		});
		expect(value(await library.loadKit(id)).kit.presets).toEqual(['hex-pro-blue']);
		expect(value(await library.contents()).skipped.map((found) => found.path)).toEqual([
			['kits', broken],
			['kits', notAKit],
			['kits', badInk],
		]);
	});
});

describe('when storage fails', () => {
	it('maps a full disk to library/quota, as the write is made and as it commits', async () => {
		const factory = new IDBFactory();
		const library = libraryOn(factory);
		await library.enable();
		vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementationOnce(() => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		});
		const full = await library.save({ name: 'Too much', document: wifiDocument() });
		expect(code(full)).toBe('library/quota');
		expect(!full.ok && full.error.params).toEqual({});
		expect(value(await library.list())).toEqual([]);

		const atCommit = libraryOn(stubFactory({ abortWith: 'QuotaExceededError' }));
		expect(code(await atCommit.enable())).toBe('ok');
		expect(code(await atCommit.saveKit({ name: 'Too much', kit: brandKit() }))).toBe(
			'library/quota',
		);
		const legacy = libraryOn(stubFactory({ abortWith: 'NS_ERROR_DOM_QUOTA_REACHED' }));
		await legacy.enable();
		expect(code(await legacy.save({ name: 'x', document: wifiDocument() }))).toBe('library/quota');
		const other = libraryOn(stubFactory({ abortWith: 'UnknownError' }));
		await other.enable();
		expect(code(await other.list())).toBe('library/unavailable');
	});

	it('maps everything else storage throws to library/unavailable, never carrying the message', async () => {
		const throwing = new IDBFactory();
		vi.spyOn(throwing, 'open').mockImplementation(() => {
			throw new DOMException(`refused ${SECRET}`, 'SecurityError');
		});
		const refused = await libraryOn(throwing).enable();
		expect(code(refused)).toBe('library/unavailable');
		expect(!refused.ok && refused.error.message).not.toContain(SECRET);
		expect(!refused.ok && refused.error.cause).toBeUndefined();

		// A database a newer build made, at a version this one cannot open.
		const newer = new IDBFactory();
		(await rawOpen(newer, LIBRARY_DATABASE_VERSION + 1)).close();
		expect(code(await libraryOn(newer).enable())).toBe('library/unavailable');
		expect(code(await libraryOn(newer).list())).toBe('library/unavailable');

		const deleting = new IDBFactory();
		vi.spyOn(deleting, 'deleteDatabase').mockImplementation(() => {
			throw 'not even an Error';
		});
		expect(code(await libraryOn(deleting).disable())).toBe('library/unavailable');
		expect(code(await libraryOn(stubFactory({ deleteFails: true })).disable())).toBe(
			'library/unavailable',
		);

		const closing = new IDBFactory();
		const library = libraryOn(closing);
		await library.enable();
		vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementationOnce(() => {
			throw new DOMException('closing', 'InvalidStateError');
		});
		expect(code(await library.list())).toBe('library/unavailable');
		expect(code(await library.list())).toBe('ok');
	});
});

// A stand-in factory for what fake-indexeddb does not do: a transaction that
// aborts at commit with a chosen error, and a delete that errors.

interface Stub {
	readonly abortWith?: string;
	readonly deleteFails?: boolean;
}

function later(task: () => void): void {
	setTimeout(task, 0);
}

function stubFactory(stub: Stub): IdbFactoryLike {
	const request = (): Record<string, unknown> => ({ result: undefined, error: null });
	const event = { preventDefault() {}, oldVersion: 1 };
	const db = {
		onversionchange: null,
		onclose: null,
		close() {},
		transaction() {
			const tx: Record<string, unknown> = { error: null };
			const store = {
				add: () => request(),
				get: () => request(),
				delete: () => request(),
				openCursor: () => request(),
			};
			tx.objectStore = () => store;
			later(() => {
				tx.error = new DOMException('stub', stub.abortWith ?? 'UnknownError');
				(tx.onabort as () => void)();
			});
			return tx;
		},
	};
	return {
		databases: async () => [{ name: LIBRARY_DATABASE, version: LIBRARY_DATABASE_VERSION }],
		open() {
			const opening = request();
			later(() => {
				opening.result = db;
				(opening.onsuccess as (e: unknown) => void)(event);
			});
			return opening as unknown as IDBOpenDBRequest;
		},
		deleteDatabase() {
			const deleting = request();
			later(() => {
				if (stub.deleteFails === true) {
					deleting.error = new DOMException('stub', 'UnknownError');
					(deleting.onerror as (e: unknown) => void)(event);
				} else (deleting.onsuccess as (e: unknown) => void)(event);
			});
			return deleting as unknown as IDBOpenDBRequest;
		},
	};
}
