/**
 * The commands besides export: the design link, the inspector and batch
 * seams, and the library through an injected store. Every one resolves to a
 * Result; none throws for anything a person can cause.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { err, ok } from '../../src/core/result.js';
import type { Result } from '../../src/core/result.js';
import { createPrng } from '../../src/core/prng.js';
import { decodeDesignLink } from '../../src/design/link.js';
import { defaultDesign } from '../../src/design/document.js';
import type { InspectReport, Inspector } from '../../src/studio/seams.js';
import type {
	LibraryItem,
	LibraryItemSummary,
	LibraryStore,
	StudioDocument,
} from '../../src/studio/types.js';
import { logoPatches } from '../../src/studio/logo.js';
import { assetOf, discImage } from '../design/helpers.js';
import { settle, studioWith, studioWithCode } from './helpers.js';

const REPORT: InspectReport = { symbols: [], sets: [], payload: null, safety: null };

describe('design-link', () => {
	it('gives a link to the design and nothing of the content', async () => {
		const { studio } = studioWithCode({}, 'https://example.com/private-0451');
		studio.dispatch({ type: 'design/shuffle', seed: 4 });
		const result = await studio.run({ type: 'design-link' });
		if (!result.ok) throw result.error;
		expect(result.value.issues).toEqual([]);
		expect(decodeDesignLink(result.value.link)).toEqual(studio.getSnapshot().document.design);
		expect(result.value.link).not.toContain('private');
	});

	it('says a picture logo was left out of the link', async () => {
		const { studio } = studioWithCode();
		studio.dispatch({
			type: 'design/patch',
			patch: logoPatches(defaultDesign(), assetOf(discImage(8))),
		});
		const result = await studio.run({ type: 'design-link' });
		expect(result.ok && result.value.issues.map((found) => found.code)).toEqual([
			'design.issue.link-assets-dropped',
		]);
	});

	it('reports a design too large for a link as a failed result', async () => {
		const { studio } = studioWithCode();
		const prng = createPrng(5);
		const hex = (): string =>
			`#${Array.from({ length: 6 }, () => '0123456789abcdef'[prng.int(16)]).join('')}`;
		const gradient = () => ({
			kind: 'linear',
			angle: prng.int(360),
			space: 'symbol',
			stops: Array.from({ length: 16 }, (_, i) => ({
				offset: i / 15,
				ink: { srgb: hex(), cmyk: [prng.next(), prng.next(), prng.next(), prng.next()] },
			})),
		});
		const style = () => ({
			outer: { id: 'square' },
			inner: { id: 'square-centre' },
			outerPaint: gradient(),
			innerPaint: gradient(),
		});
		studio.dispatch({
			type: 'design/replace',
			design: {
				...defaultDesign(),
				background: gradient(),
				modules: {
					shape: { id: 'square' },
					paint: gradient(),
					light: { shape: { id: 'dot' }, paint: gradient() },
				},
				regions: { finder: style(), 'sub-finder': style(), 'corner-finder': style() },
			},
		});
		expect(studio.getSnapshot().refusal).toBeNull();
		const result = await studio.run({ type: 'design-link' });
		expect(!result.ok && result.error).toMatchObject({
			code: 'design/invalid',
			params: { reason: 'size' },
		});
	});
});

describe('inspect', () => {
	it('runs through the injected inspector and keeps the report in the snapshot', async () => {
		const seen: string[] = [];
		const inspector: Inspector = {
			image: () => {
				seen.push('image');
				return ok(REPORT);
			},
			text: () => {
				seen.push('text');
				return REPORT;
			},
		};
		const { studio } = studioWith({ inspector });
		const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
		const states: string[] = [];
		studio.subscribe(() => states.push(studio.getSnapshot().inspect.status));
		expect(await studio.run({ type: 'inspect/image', image })).toEqual(ok(REPORT));
		expect(studio.getSnapshot().inspect).toEqual({
			status: 'done',
			source: 'image',
			report: REPORT,
		});
		expect(await studio.run({ type: 'inspect/text', text: 'WIFI:S:x;;' })).toEqual(ok(REPORT));
		expect(studio.getSnapshot().inspect).toMatchObject({ status: 'done', source: 'text' });
		expect(seen).toEqual(['image', 'text']);
		expect(states).toEqual(['running', 'done', 'running', 'done']);
	});

	it('reports a picture with no code, and an inspector that throws, as failures', async () => {
		const notFound = new QrStudioError('decode/not-found', 'none', { stage: 'finders' });
		const inspector: Inspector = {
			image: () => err(notFound),
			text: () => {
				throw new Error('broken inspector');
			},
		};
		const { studio } = studioWith({ inspector });
		const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
		const failed = await studio.run({ type: 'inspect/image', image });
		expect(!failed.ok && failed.error).toBe(notFound);
		expect(studio.getSnapshot().inspect).toEqual({
			status: 'failed',
			source: 'image',
			error: {
				code: 'decode/not-found',
				messageKey: 'decode.not-found',
				params: { stage: 'finders' },
			},
		});
		const thrown = await studio.run({ type: 'inspect/text', text: 'x' });
		expect(!thrown.ok && thrown.error.code).toBe('decode/unreadable');
	});

	it('says reading is not in this build without an inspector', async () => {
		const { studio } = studioWith();
		const result = await studio.run({ type: 'inspect/text', text: 'x' });
		expect(!result.ok && result.error).toMatchObject({
			code: 'platform/unavailable',
			params: { feature: 'inspect' },
		});
		expect(studio.getSnapshot().inspect.status).toBe('failed');
	});

	it('keeps quiet when the studio was disposed while it read', async () => {
		let studioRef: { dispose(): void } | null = null;
		const inspector: Inspector = {
			image: () => ok(REPORT),
			text: () => {
				studioRef?.dispose();
				return REPORT;
			},
		};
		const { studio } = studioWith({ inspector });
		studioRef = studio;
		expect((await studio.run({ type: 'inspect/text', text: 'x' })).ok).toBe(true);
	});
});

describe('batch', () => {
	it('is not in this build yet, and says so as a result', async () => {
		const { studio } = studioWith();
		const result = await studio.run({
			type: 'batch',
			csv: 'a\n1',
			mapping: { typeId: 'text', fields: { text: { column: 'a' } }, filename: '{a}' },
			output: { kind: 'zip', format: 'svg' },
		});
		expect(!result.ok && result.error).toMatchObject({
			code: 'platform/unavailable',
			params: { feature: 'batch' },
		});
		expect(studio.getSnapshot().batch).toEqual({ status: 'idle' });
	});
});

/** A store in memory, as the website's IndexedDB store or the offline app's file store behaves. */
class MemoryStore implements LibraryStore {
	enabled: boolean;
	available = true;
	failNext: QrStudioError | null = null;
	readonly items = new Map<string, LibraryItem>();
	private next = 1;

	constructor(enabled = false) {
		this.enabled = enabled;
	}

	private gate<T>(value: () => T): Promise<Result<T>> {
		const failure = this.failNext;
		this.failNext = null;
		return Promise.resolve(failure === null ? ok(value()) : err(failure));
	}

	probe() {
		return this.gate(() => ({ available: this.available, enabled: this.enabled }));
	}
	enable() {
		return this.gate(() => {
			this.enabled = true;
			return null;
		});
	}
	disable() {
		return this.gate(() => {
			this.enabled = false;
			this.items.clear();
			return null;
		});
	}
	list() {
		return this.gate((): readonly LibraryItemSummary[] =>
			[...this.items.values()].map(({ document: _document, ...summary }) => summary),
		);
	}
	save(item: { name: string; document: StudioDocument }) {
		return this.gate(() => {
			const id = `item-${this.next++}`;
			const summary = { id, name: item.name, savedAt: 1700000000000, typeId: item.document.typeId };
			this.items.set(id, { ...summary, document: structuredClone(item.document) });
			return summary;
		});
	}
	load(id: string) {
		const found = this.items.get(id);
		if (found === undefined)
			return Promise.resolve(err(new QrStudioError('library/corrupt', 'missing')));
		return this.gate(() => found);
	}
	remove(id: string) {
		return this.gate(() => {
			this.items.delete(id);
			return null;
		});
	}
}

describe('the library', () => {
	it('is unavailable without a store, and every command says so', async () => {
		const { studio } = studioWith();
		expect(studio.getSnapshot().library).toEqual({ status: 'unavailable' });
		for (const command of [
			{ type: 'library/enable' },
			{ type: 'library/disable' },
			{ type: 'library/save', name: 'x' },
			{ type: 'library/load', id: 'x' },
			{ type: 'library/remove', id: 'x' },
		] as const) {
			const result = await studio.run(command);
			expect(!result.ok && result.error.code, command.type).toBe('library/unavailable');
		}
	});

	it('asks the store at start whether it is on, creating nothing', async () => {
		const off = new MemoryStore(false);
		const a = studioWith({ library: off }).studio;
		expect(a.getSnapshot().library).toEqual({ status: 'checking' });
		await settle();
		expect(a.getSnapshot().library).toEqual({ status: 'off' });
		expect(off.enabled).toBe(false);

		const on = new MemoryStore(true);
		await on.save({ name: 'Kept', document: a.getSnapshot().document });
		const b = studioWith({ library: on }).studio;
		await settle();
		expect(b.getSnapshot().library).toMatchObject({ status: 'on', items: [{ name: 'Kept' }] });

		const nowhere = new MemoryStore();
		nowhere.available = false;
		const c = studioWith({ library: nowhere }).studio;
		await settle();
		expect(c.getSnapshot().library).toEqual({ status: 'unavailable' });

		const broken = new MemoryStore();
		broken.failNext = new QrStudioError('library/corrupt', 'bad');
		const d = studioWith({ library: broken }).studio;
		await settle();
		expect(d.getSnapshot().library).toMatchObject({
			status: 'failed',
			error: { code: 'library/corrupt' },
		});

		const throwing = {
			...new MemoryStore(),
			probe: () => Promise.reject(new Error('store threw')),
		} as unknown as LibraryStore;
		const e = studioWith({ library: throwing }).studio;
		await settle();
		expect(e.getSnapshot().library).toMatchObject({
			status: 'failed',
			error: { code: 'library/unavailable' },
		});

		// Disposed before the store answered: nothing changes after.
		const late = studioWith({ library: new MemoryStore(true) }).studio;
		late.dispose();
		await settle();
		expect(late.getSnapshot().library).toEqual({ status: 'checking' });
	});

	it('enables, saves, lists, loads, removes and disables', async () => {
		const store = new MemoryStore();
		const { studio } = studioWithCode({ library: store }, 'https://example.com/saved');
		await settle();
		const notOn = await studio.run({ type: 'library/save', name: 'Too soon' });
		expect(!notOn.ok && notOn.error.code).toBe('library/not-enabled');

		expect(await studio.run({ type: 'library/enable' })).toEqual(ok([]));
		expect(studio.getSnapshot().library).toEqual({ status: 'on', items: [] });

		const saved = await studio.run({ type: 'library/save', name: 'Menu' });
		if (!saved.ok) throw saved.error;
		expect(saved.value).toMatchObject({ name: 'Menu', typeId: 'url' });
		expect(studio.getSnapshot().library).toMatchObject({ status: 'on', items: [{ name: 'Menu' }] });

		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/changed' });
		studio.dispatch({ type: 'mode', mode: 'scan' });
		const loaded = await studio.run({ type: 'library/load', id: saved.value.id });
		if (!loaded.ok) throw loaded.error;
		expect(loaded.value).toEqual(saved.value);
		expect(studio.getSnapshot().document.fields.url).toBe('https://example.com/saved');
		// Loading keeps the mode the person is in, and is a step they can undo.
		expect(studio.getSnapshot().document.mode).toBe('scan');
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.fields.url).toBe('https://example.com/changed');

		const missing = await studio.run({ type: 'library/load', id: 'no-such-item' });
		expect(!missing.ok && missing.error.code).toBe('library/corrupt');

		expect(await studio.run({ type: 'library/remove', id: saved.value.id })).toEqual(ok([]));
		expect(await studio.run({ type: 'library/disable' })).toEqual(ok(null));
		expect(studio.getSnapshot().library).toEqual({ status: 'off' });
	});

	it('opens a damaged saved document as far as it can, saying what it repaired', async () => {
		const store = new MemoryStore(true);
		const document = {
			mode: 'create',
			typeId: 'no-such-type',
			fields: { url: 'https://example.com/' },
			design: { schema: 'nope' },
			conditions: { sizeMm: -4 },
		} as unknown as StudioDocument;
		store.items.set('bad', { id: 'bad', name: 'Damaged', savedAt: 0, typeId: 'url', document });
		const { studio } = studioWith({ library: store });
		await settle();
		const loaded = await studio.run({ type: 'library/load', id: 'bad' });
		expect(loaded.ok).toBe(true);
		const snapshot = studio.getSnapshot();
		expect(snapshot.document.typeId).toBe('url');
		expect(snapshot.document.fields.url).toBe('https://example.com/');
		expect(snapshot.refusal?.issues.map((found) => found.path[0])).toEqual([
			'typeId',
			'design',
			'conditions',
		]);
	});

	it('passes on what the store refuses', async () => {
		const store = new MemoryStore();
		const { studio } = studioWithCode({ library: store });
		await settle();
		store.failNext = new QrStudioError('library/quota', 'full');
		const enable = await studio.run({ type: 'library/enable' });
		expect(!enable.ok && enable.error.code).toBe('library/quota');
		expect(studio.getSnapshot().library).toMatchObject({ status: 'failed' });
		await studio.run({ type: 'library/enable' });
		store.failNext = new QrStudioError('library/quota', 'full');
		const save = await studio.run({ type: 'library/save', name: 'x' });
		expect(!save.ok && save.error.code).toBe('library/quota');
		const saved = await studio.run({ type: 'library/save', name: 7 as never });
		expect(saved.ok && saved.value.name).toBe('');
		store.failNext = new QrStudioError('library/corrupt', 'bad');
		expect((await studio.run({ type: 'library/remove', id: 'item-1' })).ok).toBe(false);
		store.failNext = new QrStudioError('library/corrupt', 'bad');
		const id = saved.ok ? saved.value.id : '';
		expect((await studio.run({ type: 'library/load', id })).ok).toBe(false);
		store.failNext = new QrStudioError('library/corrupt', 'bad');
		expect((await studio.run({ type: 'library/disable' })).ok).toBe(false);
	});

	it('marks the library failed when the list cannot be read after a change', async () => {
		const store = new MemoryStore(true);
		const { studio } = studioWithCode({ library: store });
		await settle();
		store.list = () => Promise.resolve(err(new QrStudioError('library/corrupt', 'bad')));
		const saved = await studio.run({ type: 'library/save', name: 'x' });
		expect(saved.ok).toBe(true);
		expect(studio.getSnapshot().library).toMatchObject({
			status: 'failed',
			error: { code: 'library/corrupt' },
		});
	});

	it('resolves to cancelled when the studio is disposed mid-command', async () => {
		const store = new MemoryStore(true);
		const { studio } = studioWithCode({ library: store });
		await settle();
		const pending = [
			studio.run({ type: 'library/enable' }),
			studio.run({ type: 'library/save', name: 'x' }),
		];
		studio.dispose();
		for (const result of await Promise.all(pending)) {
			expect(!result.ok && result.error.code).toBe('cancelled');
		}
	});
});

describe('run', () => {
	it("refuses a command that is not one, as a caller's mistake", async () => {
		const { studio } = studioWith();
		await expect(studio.run(null as never)).rejects.toThrow(TypeError);
		await expect(studio.run({ type: 'nope' } as never)).rejects.toThrow(TypeError);
	});

	it('turns anything else a seam throws into a failed result', async () => {
		const { studio } = studioWith({
			library: {
				...new MemoryStore(true),
				probe: () => Promise.resolve(ok({ available: true, enabled: false })),
				enable: () => Promise.reject(new RangeError('store broke')),
			} as unknown as LibraryStore,
		});
		const result = await studio.run({ type: 'library/enable' });
		expect(!result.ok && result.error.code).toBe('platform/unavailable');
	});
});
