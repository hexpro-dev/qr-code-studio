/**
 * The library through the studio: what the probe says to offer, saved
 * designs that bring back their look and never touch the content, records a
 * store had to leave out, brand kits, and the offline app's library file.
 *
 * A fake store pins every branch; the real file store and the real
 * IndexedDB store (over fake-indexeddb) show the two the studio is given.
 */

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { issue } from '../../src/core/issue.js';
import type { Issue } from '../../src/core/issue.js';
import { err, ok } from '../../src/core/result.js';
import type { Result } from '../../src/core/result.js';
import { defaultDesign } from '../../src/design/document.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import { createFileLibrary } from '../../src/dom/file-library.js';
import { createIndexedDbLibrary } from '../../src/dom/library/index.js';
import { createRegistries } from '../../src/registries.js';
import { contrastRatio, luminance } from '../../src/studio/contrast.js';
import { KIT_PALETTE_MAX, applyKit, kitFromDesign } from '../../src/studio/kit.js';
import { errorKey, studioError } from '../../src/studio/keys.js';
import { createStudio } from '../../src/studio/studio.js';
import type {
	BrandKit,
	KitItem,
	KitSummary,
	LibraryContents,
	LibraryItem,
	LibraryItemSummary,
	LibraryProbeState,
	LibraryStore,
	Studio,
	StudioDocument,
} from '../../src/studio/types.js';
import { assetOf, discImage } from '../design/helpers.js';
import { settle, studioWith } from './helpers.js';

const registries = createRegistries();

/** A design saved for a link, with conditions of its own. */
const SAVED_DESIGN: QrDesignV1 = {
	...defaultDesign(),
	modules: { ...defaultDesign().modules, shape: { id: 'dot' } },
	name: 'Saved look',
};
const SAVED_CONDITIONS = { sizeMm: 40, dpi: 300, distanceMm: 800 };

const KIT: BrandKit = {
	palette: ['#fafaf7', '#0b3d91', '#c2410c'],
	logo: null,
	presets: ['classic-black'],
};

/** A library in memory that does what both real stores do, and can be told to fail or wait. */
class MemoryLibrary implements LibraryStore {
	state: LibraryProbeState | undefined;
	available = true;
	enabled: boolean;
	failNext: QrStudioError | null = null;
	failContents = false;
	skipped: Issue[] = [];
	gate: Promise<void> | null = null;
	contentsGate: Promise<void> | null = null;
	readonly designs = new Map<string, LibraryItem>();
	readonly kits = new Map<string, KitItem>();
	private next = 1;

	constructor(options: { state?: LibraryProbeState; enabled?: boolean } = {}) {
		this.state = options.state;
		this.enabled = options.enabled ?? options.state === 'on';
	}

	private async answer<T>(value: () => T): Promise<Result<T>> {
		if (this.gate !== null) await this.gate;
		const failure = this.failNext;
		this.failNext = null;
		return failure === null ? ok(value()) : err(failure);
	}

	probe() {
		return this.answer(() => ({
			available: this.available,
			enabled: this.enabled,
			...(this.state === undefined ? {} : { state: this.state }),
		}));
	}
	enable() {
		return this.answer(() => {
			this.enabled = true;
			return null;
		});
	}
	disable() {
		return this.answer(() => {
			this.enabled = false;
			this.designs.clear();
			this.kits.clear();
			return null;
		});
	}
	private summaries(): LibraryItemSummary[] {
		return [...this.designs.values()].map(({ document: _document, ...summary }) => summary);
	}
	private kitSummaries(): KitSummary[] {
		return [...this.kits.values()].map(({ kit: _kit, ...summary }) => summary);
	}
	list() {
		return this.answer(() => this.summaries());
	}
	async contents(): Promise<Result<LibraryContents>> {
		if (this.contentsGate !== null) await this.contentsGate;
		if (this.failContents) return err(new QrStudioError('library/corrupt', 'bad'));
		return this.answer(() => ({
			designs: this.summaries(),
			kits: this.kitSummaries(),
			skipped: this.skipped,
		}));
	}
	save(item: { name: string; document: StudioDocument }) {
		return this.answer(() => {
			const id = String(this.next++);
			const summary = { id, name: item.name, savedAt: 1, typeId: item.document.typeId };
			// As the real stores do: the look and the sizes, never the fields.
			const document: StudioDocument = {
				mode: 'create',
				typeId: item.document.typeId,
				fields: {},
				design: item.document.design,
				conditions: item.document.conditions,
			};
			this.designs.set(id, { ...summary, document });
			return summary;
		});
	}
	load(id: string) {
		const found = this.designs.get(id);
		if (found === undefined) {
			return Promise.resolve(
				err(new QrStudioError('library/corrupt', 'gone', { reason: 'missing' })),
			);
		}
		return this.answer(() => found);
	}
	remove(id: string) {
		return this.answer(() => {
			this.designs.delete(id);
			return null;
		});
	}
	listKits() {
		return this.answer(() => this.kitSummaries());
	}
	saveKit(item: { name: string; kit: BrandKit }) {
		return this.answer(() => {
			const id = String(this.next++);
			const summary = { id, name: item.name, savedAt: 1 };
			this.kits.set(id, { ...summary, kit: item.kit });
			return summary;
		});
	}
	loadKit(id: string) {
		const found = this.kits.get(id);
		if (found === undefined) {
			return Promise.resolve(
				err(new QrStudioError('library/corrupt', 'gone', { reason: 'missing' })),
			);
		}
		return this.answer(() => found);
	}
	removeKit(id: string) {
		return this.answer(() => {
			this.kits.delete(id);
			return null;
		});
	}
}

/** A studio over `library`, once its probe has answered. */
async function over(library: LibraryStore): Promise<Studio> {
	const { studio } = studioWith({ library });
	await settle();
	await settle();
	return studio;
}

/** Until the studio's probe of the library has answered, however long the store takes. */
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

function value<T>(result: Result<T>): T {
	if (!result.ok) throw result.error;
	return result.value;
}

describe('what the probe says to offer', () => {
	it("is each of the store's states, or the flags of an older store", async () => {
		for (const state of ['unavailable', 'off', 'unknown'] as const) {
			expect((await over(new MemoryLibrary({ state }))).getSnapshot().library, state).toEqual({
				status: state,
			});
		}
		const on = await over(new MemoryLibrary({ state: 'on' }));
		expect(on.getSnapshot().library).toEqual({
			status: 'on',
			items: [],
			kits: [],
			skipped: [],
			kit: null,
		});
		const older = new MemoryLibrary();
		expect((await over(older)).getSnapshot().library).toEqual({ status: 'off' });
		older.enabled = true;
		expect((await over(older)).getSnapshot().library.status).toBe('on');
		older.available = false;
		expect((await over(older)).getSnapshot().library).toEqual({ status: 'unavailable' });
	});

	it('takes "Open my library" as the consent, and opens it', async () => {
		const library = new MemoryLibrary({ state: 'unknown' });
		const studio = await over(library);
		expect(value(await studio.run({ type: 'library/enable' }))).toEqual([]);
		expect(studio.getSnapshot().library.status).toBe('on');
		expect(library.enabled).toBe(true);
	});

	it('reads the records a store had to leave out into the state', async () => {
		const library = new MemoryLibrary({ state: 'on' });
		library.skipped = [
			issue('dom.library.issue.corrupt', ['designs', '4'], 'warning'),
			issue('dom.library.issue.content', ['kits', '2'], 'warning'),
		];
		const studio = await over(library);
		const state = studio.getSnapshot().library;
		expect(state.status === 'on' && state.skipped.length).toBe(2);
	});

	it('marks the library failed when its contents cannot be read', async () => {
		const library = new MemoryLibrary({ state: 'on' });
		library.failContents = true;
		const studio = await over(library);
		expect(studio.getSnapshot().library).toMatchObject({
			status: 'failed',
			error: { code: 'library/corrupt' },
		});
		library.failContents = false;
		const saved = await studio.run({ type: 'library/save', name: 'x' });
		expect(!saved.ok && saved.error.code).toBe('library/not-enabled');
	});
});

describe('saved designs', () => {
	async function withSaved(): Promise<{ studio: Studio; library: MemoryLibrary; id: string }> {
		const library = new MemoryLibrary({ state: 'on' });
		const saver = await over(library);
		saver.dispatch({ type: 'design/replace', design: SAVED_DESIGN });
		saver.dispatch({ type: 'conditions', conditions: SAVED_CONDITIONS });
		const { id } = value(await saver.run({ type: 'library/save', name: 'Look' }));
		const studio = await over(library);
		studio.dispatch({ type: 'payload/type', typeId: 'wifi' });
		studio.dispatch({ type: 'payload/field', key: 'ssid', value: 'Example Network' });
		return { studio, library, id };
	}

	it('bring back the look and the sizes, and leave what was typed and its kind alone', async () => {
		const { studio, id } = await withSaved();
		const before = studio.getSnapshot().document;
		const loaded = value(await studio.run({ type: 'library/load', id }));
		expect(loaded).toEqual({ id, name: 'Look', savedAt: 1, typeId: 'url' });
		const after = studio.getSnapshot().document;
		expect(after.typeId).toBe('wifi');
		expect(after.fields).toBe(before.fields);
		expect(after.design).toEqual(SAVED_DESIGN);
		expect(after.conditions).toEqual(SAVED_CONDITIONS);
		// The look is a step to undo; the sizes, as everywhere, are not.
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design).toBe(before.design);
		expect(studio.getSnapshot().document.conditions).toEqual(SAVED_CONDITIONS);
		expect(studio.getSnapshot().document.fields.ssid).toBe('Example Network');
	});

	it('change nothing for a design and sizes already in place', async () => {
		const { studio, id } = await withSaved();
		await studio.run({ type: 'library/load', id });
		const snapshot = studio.getSnapshot();
		await studio.run({ type: 'library/load', id });
		expect(studio.getSnapshot().document).toBe(snapshot.document);
	});

	it('keep a fixed look fixed, bringing back only what the lock leaves alone', async () => {
		const { studio, id } = await withSaved();
		studio.dispatch({ type: 'payload/type', typeId: 'swiss-qr-bill' });
		const drawn = studio.getSnapshot().design.effective.modules;
		await studio.run({ type: 'library/load', id });
		// The saved design's name passes the lock; its dotted modules do not show.
		expect(studio.getSnapshot().design.effective.modules).toEqual(drawn);
		expect(studio.getSnapshot().design.effective.name).toBe('Saved look');
		expect(studio.getSnapshot().document.conditions).toEqual(SAVED_CONDITIONS);
	});

	it('bring back only the sizes when nothing of the look can change, saying so', async () => {
		const library = new MemoryLibrary({ state: 'on' });
		const saver = await over(library);
		saver.dispatch({
			type: 'design/patch',
			patch: { path: ['modules', 'shape'], value: { id: 'dot' } },
		});
		saver.dispatch({ type: 'conditions', conditions: SAVED_CONDITIONS });
		const { id } = value(await saver.run({ type: 'library/save', name: 'Dots' }));
		const studio = await over(library);
		studio.dispatch({ type: 'payload/type', typeId: 'swiss-qr-bill' });
		const design = studio.getSnapshot().document.design;
		await studio.run({ type: 'library/load', id });
		expect(studio.getSnapshot().document.design).toBe(design);
		expect(studio.getSnapshot().document.conditions).toEqual(SAVED_CONDITIONS);
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.design-locked');
	});

	it("say a missing one has gone, in the library's own words", async () => {
		const { studio } = await withSaved();
		const missing = await studio.run({ type: 'library/load', id: '99' });
		expect(!missing.ok && studioError(missing.error).messageKey).toBe('dom.library.error.missing');
	});

	it('are listed, removed, and gone with a disable', async () => {
		const { studio, library, id } = await withSaved();
		expect(studio.getSnapshot().library).toMatchObject({ status: 'on', items: [{ name: 'Look' }] });
		expect(value(await studio.run({ type: 'library/remove', id }))).toEqual([]);
		expect(value(await studio.run({ type: 'library/disable' }))).toBeNull();
		expect(studio.getSnapshot().library).toEqual({ status: 'off' });
		expect(library.enabled).toBe(false);
	});
});

describe('brand kits', () => {
	it('are saved, listed, applied with their presets offered, and removed', async () => {
		const library = new MemoryLibrary({ state: 'on' });
		const studio = await over(library);
		const saved = value(await studio.run({ type: 'library/save-kit', name: 'Brand', kit: KIT }));
		expect(value(await studio.run({ type: 'library/list-kits' }))).toEqual([saved]);
		const loaded = value(await studio.run({ type: 'library/load-kit', id: saved.id }));
		expect(loaded.kit).toEqual(KIT);
		const design = studio.getSnapshot().document.design;
		expect(design).toEqual(applyKit(defaultDesign(), KIT));
		expect(studio.getSnapshot().library).toMatchObject({
			status: 'on',
			kit: { id: saved.id, kit: { presets: ['classic-black'] } },
		});
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design).toEqual(defaultDesign());
		// Removing another kit keeps this one offered; removing it clears it.
		const other = value(await studio.run({ type: 'library/save-kit', name: 'Other', kit: KIT }));
		await studio.run({ type: 'library/remove-kit', id: other.id });
		expect(studio.getSnapshot().library).toMatchObject({ kit: { id: saved.id } });
		expect(value(await studio.run({ type: 'library/remove-kit', id: saved.id }))).toEqual([]);
		expect(studio.getSnapshot().library).toMatchObject({ kit: null });
	});

	it("put a kit's logo into the design", async () => {
		const library = new MemoryLibrary({ state: 'on' });
		const studio = await over(library);
		const logo = assetOf(discImage(16));
		const { id } = value(
			await studio.run({ type: 'library/save-kit', name: 'With logo', kit: { ...KIT, logo } }),
		);
		await studio.run({ type: 'library/load-kit', id });
		const design = studio.getSnapshot().document.design;
		expect(design.logo?.source).toEqual({ kind: 'asset', id: 'logo' });
		expect(design.assets?.logo).toEqual(logo);
	});

	it("say a kit the store will not keep cannot be used, in the library's own words", () => {
		const rejected = new QrStudioError('design/invalid', 'kit', { reason: 'kit' });
		expect(errorKey(rejected)).toBe('dom.library.error.kit');
		expect(errorKey(new QrStudioError('design/invalid', 'x', { reason: 'other' }))).toBe(
			'error.design.invalid',
		);
		expect(errorKey(new QrStudioError('library/unavailable', 'x', { reason: 'blocked' }))).toBe(
			'dom.library.error.blocked',
		);
		expect(errorKey(new QrStudioError('library/quota', 'x', { reason: 'file-full' }))).toBe(
			'dom.library.error.file-full',
		);
		expect(errorKey(new QrStudioError('library/quota', 'x'))).toBe('error.library.quota');
	});
});

describe('the kit rule', () => {
	it('takes a pale ink for the ground, the darkest readable for modules, the next for the rings', () => {
		const design = applyKit(defaultDesign(), KIT);
		expect(design.background).toEqual({ kind: 'solid', ink: '#fafaf7' });
		expect(design.modules.paint).toEqual({ kind: 'solid', ink: '#0b3d91' });
		// Orange is just over the floor on that ground, so it takes the rings.
		expect(contrastRatio('#c2410c', '#fafaf7')).toBeGreaterThanOrEqual(4.5);
		expect(design.regions.finder).toEqual({
			outer: { id: 'square' },
			inner: { id: 'square-centre' },
			outerPaint: { kind: 'solid', ink: '#c2410c' },
		});
		// A second dark ink under the floor leaves the rings to follow the modules.
		const pale = applyKit(defaultDesign(), { ...KIT, palette: ['#fafaf7', '#0b3d91', '#f59e0b'] });
		expect(pale.regions.finder).toBeUndefined();
		const two = applyKit(defaultDesign(), { ...KIT, palette: ['#ffffff', '#111111', '#7a1f3d'] });
		expect(two.regions.finder).toEqual({
			outer: { id: 'square' },
			inner: { id: 'square-centre' },
			outerPaint: { kind: 'solid', ink: '#7a1f3d' },
		});
	});

	it("keeps the design's own ground, modules and finder shapes when the kit has nothing for them", () => {
		const styled: QrDesignV1 = {
			...defaultDesign(),
			background: {
				kind: 'linear',
				angle: 0,
				space: 'symbol',
				stops: [
					{ offset: 0, ink: '#ffffff' },
					{ offset: 1, ink: '#eeeeee' },
				],
			},
			regions: { finder: { outer: { id: 'circle' }, inner: { id: 'circle-centre' } } },
		};
		const pastel = applyKit(styled, { palette: ['#ff9999', '#99ccff'], logo: null, presets: [] });
		expect(pastel).toEqual(styled);
		const dark = applyKit(styled, { palette: ['#123456', '#5a1e00'], logo: null, presets: [] });
		// Judged against white, as a gradient ground is.
		expect(dark.background).toBe(styled.background);
		expect(dark.modules.paint).toEqual({ kind: 'solid', ink: '#5a1e00' });
		expect(dark.regions.finder).toEqual({
			outer: { id: 'circle' },
			inner: { id: 'circle-centre' },
			outerPaint: { kind: 'solid', ink: '#123456' },
		});
		expect(applyKit(styled, { palette: [], logo: null, presets: [] })).toEqual(styled);
		const clear = applyKit(
			{ ...defaultDesign(), background: null },
			{ palette: ['#222222'], logo: null, presets: [] },
		);
		expect(clear.modules.paint).toEqual({ kind: 'solid', ink: '#222222' });
	});

	it("keeps a logo's size and plate when the kit brings a picture", () => {
		const logo = assetOf(discImage(8));
		const plated: QrDesignV1 = {
			...defaultDesign(),
			logo: {
				source: { kind: 'icon', id: 'star' },
				size: 0.3,
				clear: 'shape',
				padding: 2,
				plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'circle' },
			},
		};
		const design = applyKit(plated, { palette: [], logo, presets: [] });
		expect(design.logo).toEqual({ ...plated.logo, source: { kind: 'asset', id: 'logo' } });
	});

	it('makes a kit from a design: its inks once each, its picture, no presets', () => {
		const logo = assetOf(discImage(8));
		const design: QrDesignV1 = {
			...applyKit(defaultDesign(), {
				palette: ['#ffffff', '#111111', '#7a1f3d'],
				logo,
				presets: [],
			}),
			modules: {
				...defaultDesign().modules,
				paint: {
					kind: 'linear',
					angle: 0,
					space: 'symbol',
					stops: [
						{ offset: 0, ink: '#111111' },
						{ offset: 1, ink: '#222222' },
					],
				},
			},
		};
		expect(kitFromDesign(design)).toEqual({
			palette: ['#111111', '#222222', '#7a1f3d', '#ffffff'],
			logo,
			presets: [],
		});
		const icon = kitFromDesign({
			...defaultDesign(),
			logo: {
				source: { kind: 'icon', id: 'star' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
		});
		expect(icon).toEqual({ palette: ['#000000', '#ffffff'], logo: null, presets: [] });
		const missing = kitFromDesign({
			...defaultDesign(),
			background: null,
			logo: {
				source: { kind: 'asset', id: 'gone' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
		});
		expect(missing.logo).toBeNull();
		const filled = kitFromDesign({
			...defaultDesign(),
			modules: {
				...defaultDesign().modules,
				paint: { kind: 'entry', ref: { id: 'palette-scatter' } },
			},
		});
		expect(filled.palette).toEqual(['#ffffff']);
		const stops = Array.from({ length: 16 }, (_, i) => ({
			offset: i / 15,
			ink: `#0000${(i + 16).toString(16)}`,
		}));
		const many = kitFromDesign({
			...defaultDesign(),
			modules: {
				...defaultDesign().modules,
				paint: { kind: 'linear', angle: 0, space: 'symbol', stops },
			},
			background: {
				kind: 'linear',
				angle: 0,
				space: 'symbol',
				stops: stops.map((stop) => ({ ...stop, ink: stop.ink.replace('#0000', '#ff00') })),
			},
			regions: {
				finder: {
					outer: { id: 'square' },
					inner: { id: 'square-centre' },
					outerPaint: {
						kind: 'linear',
						angle: 0,
						space: 'symbol',
						stops: stops.map((stop) => ({ ...stop, ink: stop.ink.replace('#0000', '#00ff') })),
					},
				},
			},
		});
		expect(many.palette).toHaveLength(KIT_PALETTE_MAX);
		expect(luminance('#ffffff')).toBeCloseTo(1);
	});
});

describe("the offline app's library file", () => {
	function fileLibrary() {
		const files: { bytes: Uint8Array; filename: string }[] = [];
		const library = createFileLibrary({
			registries,
			now: () => 1700000000000,
			download: (bytes, filename) => {
				files.push({ bytes, filename });
				return ok(null);
			},
			readText: (file) => file.text(),
		});
		return { library, files };
	}

	it('offers Save and Open, says when there is something unsaved, and opens what it saved', async () => {
		const { library, files } = fileLibrary();
		const studio = await over(library);
		expect(studio.getSnapshot().library).toMatchObject({
			status: 'file',
			unsaved: false,
			items: [],
		});
		studio.dispatch({ type: 'design/replace', design: SAVED_DESIGN });
		await studio.run({ type: 'library/save', name: 'Look' });
		await studio.run({ type: 'library/save-kit', name: 'Brand', kit: KIT });
		expect(studio.getSnapshot().library).toMatchObject({
			status: 'file',
			unsaved: true,
			items: [{ name: 'Look' }],
			kits: [{ name: 'Brand' }],
		});
		expect(value(await studio.run({ type: 'library/save-file', name: 'Shop' }))).toEqual({
			filename: 'Shop.qrlibrary.json',
		});
		expect(studio.getSnapshot().library).toMatchObject({ unsaved: false });
		// A fresh page opens the file it saved.
		const fresh = await over(fileLibrary().library);
		const file = new Blob([files[0]?.bytes as BlobPart]);
		const opened = value(await fresh.run({ type: 'library/open-file', file }));
		expect(opened).toEqual({ opened: true, issues: [] });
		expect(fresh.getSnapshot().library).toMatchObject({
			status: 'file',
			unsaved: false,
			items: [{ name: 'Look' }],
			kits: [{ name: 'Brand' }],
			skipped: [],
		});
		// Disabling forgets what the page holds; the file library stays offered.
		await fresh.run({ type: 'library/disable' });
		expect(fresh.getSnapshot().library).toMatchObject({ status: 'file', items: [], kits: [] });
	});

	it('shows the records a file had to leave out, and changes nothing for a file it refuses', async () => {
		const { library, files } = fileLibrary();
		const studio = await over(library);
		await studio.run({ type: 'library/save', name: 'Good' });
		await studio.run({ type: 'library/save-file' });
		const parsed = JSON.parse(new TextDecoder().decode(files[0]?.bytes)) as { designs: unknown[] };
		parsed.designs.push({
			name: 'Bad',
			savedAt: 1,
			typeId: 'url',
			design: { schema: 'nope' },
			conditions: {},
		});
		const opened = value(
			await studio.run({ type: 'library/open-file', file: new Blob([JSON.stringify(parsed)]) }),
		);
		expect(opened.opened).toBe(true);
		const state = studio.getSnapshot().library;
		expect(state.status === 'file' && state.skipped.map((found) => found.code)).toEqual([
			'dom.library.issue.corrupt',
		]);
		const refused = value(
			await studio.run({ type: 'library/open-file', file: new Blob(['not json']) }),
		);
		expect(refused.opened).toBe(false);
		expect(studio.getSnapshot().library).toBe(state);
	});

	it('are file commands a library kept in the browser does not have', async () => {
		const studio = await over(new MemoryLibrary({ state: 'on' }));
		for (const command of [
			{ type: 'library/save-file' },
			{ type: 'library/open-file', file: new Blob([]) },
		] as const) {
			const result = await studio.run(command);
			expect(!result.ok && result.error).toMatchObject({
				code: 'library/unavailable',
				params: { reason: 'not-a-file' },
			});
		}
	});

	it('pass on a file the browser would not hand over', async () => {
		const library = createFileLibrary({
			registries,
			download: () => err(new QrStudioError('platform/unavailable', 'no')),
		});
		const studio = await over(library);
		const saved = await studio.run({ type: 'library/save-file' });
		expect(!saved.ok && saved.error.code).toBe('platform/unavailable');
	});
});

describe("the website's library, over IndexedDB", () => {
	it('starts off, opens on consent, and keeps designs and kits with no content in them', async () => {
		const indexedDB = new IDBFactory();
		const studio = await over(createIndexedDbLibrary({ indexedDB, registries }));
		await answered(studio);
		expect(studio.getSnapshot().library).toEqual({ status: 'off' });
		await studio.run({ type: 'library/enable' });
		studio.dispatch({ type: 'payload/type', typeId: 'wifi' });
		studio.dispatch({ type: 'payload/field', key: 'password', value: 'Synthetic-Passphrase-77' });
		studio.dispatch({ type: 'design/replace', design: SAVED_DESIGN });
		const { id } = value(await studio.run({ type: 'library/save', name: 'Wi-Fi look' }));
		const kit = value(await studio.run({ type: 'library/save-kit', name: 'Brand', kit: KIT }));
		expect(studio.getSnapshot().library).toMatchObject({
			status: 'on',
			items: [{ id }],
			kits: [{ id: kit.id }],
		});
		// Another page opens the same library and brings the look back to its own content.
		const other = await over(createIndexedDbLibrary({ indexedDB, registries }));
		await answered(other);
		other.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		value(await other.run({ type: 'library/load', id }));
		expect(other.getSnapshot().document).toMatchObject({
			typeId: 'url',
			fields: { url: 'https://example.com/' },
			design: SAVED_DESIGN,
		});
		expect(JSON.stringify(other.getSnapshot().document)).not.toContain('Synthetic-Passphrase');
		await other.run({ type: 'library/load-kit', id: kit.id });
		expect(other.getSnapshot().document.design.background).toEqual({
			kind: 'solid',
			ink: '#fafaf7',
		});
		await studio.run({ type: 'library/disable' });
		studio.dispose();
		other.dispose();
	});
});

describe('a library command the studio is disposed in the middle of', () => {
	it('resolves to cancelled, every one', async () => {
		const commands = [
			{ type: 'library/enable' },
			{ type: 'library/disable' },
			{ type: 'library/save', name: 'x' },
			{ type: 'library/remove', id: '1' },
			{ type: 'library/load', id: '1' },
			{ type: 'library/save-kit', name: 'x', kit: KIT },
			{ type: 'library/load-kit', id: '2' },
			{ type: 'library/remove-kit', id: '2' },
		] as const;
		for (const command of commands) {
			const library = new MemoryLibrary({ state: 'on' });
			library.designs.set('1', {
				id: '1',
				name: 'A',
				savedAt: 1,
				typeId: 'url',
				document: {
					mode: 'create',
					typeId: 'url',
					fields: {},
					design: SAVED_DESIGN,
					conditions: SAVED_CONDITIONS,
				},
			});
			library.kits.set('2', { id: '2', name: 'K', savedAt: 1, kit: KIT });
			const studio = await over(library);
			let release: () => void = () => undefined;
			library.gate = new Promise((resolve) => (release = resolve));
			const pending = studio.run(command);
			studio.dispose();
			release();
			const result = await pending;
			expect(!result.ok && result.error.code, command.type).toBe('cancelled');
		}
	});

	it('opens no file into a disposed studio', async () => {
		const { library } = { library: createFileLibrary({ registries }) };
		const studio = await over(library);
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const slow = {
			...library,
			openFile: async (file: Blob) => (await gate, library.openFile(file)),
		};
		const second = await over(slow);
		const pending = second.run({ type: 'library/open-file', file: new Blob(['{}']) });
		second.dispose();
		release();
		expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
		studio.dispose();
	});
});

describe('a store that refuses', () => {
	it('has every refusal passed on, and the library marked failed when enable or a read fails', async () => {
		const library = new MemoryLibrary({ state: 'unknown' });
		const studio = await over(library);
		library.failNext = new QrStudioError('library/unavailable', 'blocked', { reason: 'blocked' });
		const enable = await studio.run({ type: 'library/enable' });
		expect(!enable.ok && studioError(enable.error).messageKey).toBe('dom.library.error.blocked');
		expect(studio.getSnapshot().library.status).toBe('failed');
		const own = new MemoryLibrary({ state: 'on' });
		const s = await over(own);
		for (const command of [
			{ type: 'library/disable' },
			{ type: 'library/save', name: 'x' },
			{ type: 'library/remove', id: '1' },
			{ type: 'library/save-kit', name: 'x', kit: KIT },
			{ type: 'library/remove-kit', id: '1' },
		] as const) {
			own.failNext = new QrStudioError('library/quota', 'full');
			const result = await s.run(command);
			expect(!result.ok && result.error.code, command.type).toBe('library/quota');
		}
		const kit = await s.run({ type: 'library/load-kit', id: 'nope' });
		expect(!kit.ok && kit.error.code).toBe('library/corrupt');
		// A list that fails after a change leaves the library marked failed, and says so.
		for (const command of [
			{ type: 'library/remove', id: '1' },
			{ type: 'library/list-kits' },
			{ type: 'library/remove-kit', id: '1' },
			{ type: 'library/enable' },
		] as const) {
			const fresh = new MemoryLibrary({ state: 'on' });
			const failing = await over(fresh);
			fresh.failContents = true;
			const result = await failing.run(command);
			expect(!result.ok && result.error.code, command.type).toBe('library/corrupt');
			expect(failing.getSnapshot().library.status, command.type).toBe('failed');
		}
	});

	it('turns anything else a store throws into a failed result', async () => {
		const library = new MemoryLibrary({ state: 'off' });
		library.enable = () => Promise.reject(new RangeError('store broke'));
		const studio = await over(library);
		const result = await studio.run({ type: 'library/enable' });
		expect(!result.ok && result.error.code).toBe('platform/unavailable');
		const unstudied = createStudio({ library: null });
		const none = await unstudied.run({ type: 'library/list-kits' });
		expect(!none.ok && none.error.code).toBe('library/unavailable');
	});
});

describe('the probe, at its edges', () => {
	it('marks the library failed when the probe fails or throws', async () => {
		const failing = new MemoryLibrary({ state: 'on' });
		failing.failNext = new QrStudioError('library/unavailable', 'no');
		expect((await over(failing)).getSnapshot().library).toMatchObject({
			status: 'failed',
			error: { code: 'library/unavailable' },
		});
		const throwing = new MemoryLibrary({ state: 'on' });
		throwing.probe = () => Promise.reject(new Error('store threw'));
		expect((await over(throwing)).getSnapshot().library).toMatchObject({
			status: 'failed',
			error: { code: 'library/unavailable' },
		});
	});

	it('leaves the snapshot alone when the studio is disposed while the library is read', async () => {
		const library = new MemoryLibrary({ state: 'on' });
		let release: () => void = () => undefined;
		library.contentsGate = new Promise((resolve) => (release = resolve));
		const { studio } = studioWith({ library });
		await settle();
		studio.dispose();
		release();
		await settle();
		expect(studio.getSnapshot().library).toEqual({ status: 'checking' });
	});

	it('names an unnamed save, and an unnamed kit, with nothing', async () => {
		const studio = await over(new MemoryLibrary({ state: 'on' }));
		expect(value(await studio.run({ type: 'library/save', name: 5 as never })).name).toBe('');
		expect(
			value(await studio.run({ type: 'library/save-kit', name: null as never, kit: KIT })).name,
		).toBe('');
	});
});
