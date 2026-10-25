/**
 * The less travelled paths, each for the case it exists for: a registry
 * entry or a preset of somebody else's, a picture cache under pressure, a
 * studio disposed mid-command, and the options a website passes that the
 * other suites leave out.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { err, ok } from '../../src/core/result.js';
import type { Result } from '../../src/core/result.js';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { Preset, QrDesignV1 } from '../../src/design/types.js';
import { encode } from '../../src/encode/encode.js';
import { createRegistries } from '../../src/registries.js';
import { createFontRegistry } from '../../src/text/registry.js';
import { AssetCache } from '../../src/studio/assets.js';
import { buildCatalogue } from '../../src/studio/catalogue.js';
import { fitsField } from '../../src/studio/document.js';
import { exportSymbol } from '../../src/studio/export.js';
import { darkInk } from '../../src/studio/shuffle.js';
import { encodeOptions, symbolView } from '../../src/studio/symbol.js';
import { trackedScheduler } from '../../src/studio/timers.js';
import { requiredEntries, slicedVerifyRunner } from '../../src/studio/verify.js';
import type { LibraryStore, StudioDocument } from '../../src/studio/types.js';
import { createPrng } from '../../src/core/prng.js';
import { assetOf, discImage } from '../design/helpers.js';
import { FakeRunner, FakeTime, reportFor, settle, studioWith, studioWithCode } from './helpers.js';

describe('the picture cache', () => {
	it('decodes a picture once, forgets the least recently drawn past eight, and draws a damaged one as missing', () => {
		const cache = new AssetCache();
		const pictures = Array.from({ length: 10 }, (_, i) => assetOf(discImage(4 + i)));
		const first = cache.image(pictures[0]?.png as string);
		expect(cache.image(pictures[0]?.png as string)).toBe(first);
		for (const picture of pictures) cache.image(picture.png);
		// The first was pushed out, so it decodes afresh.
		expect(cache.image(pictures[0]?.png as string)).not.toBe(first);
		expect(cache.image('not base64 at all ***')).toBeNull();
		const design: QrDesignV1 = {
			...defaultDesign(),
			assets: { logo: pictures[1] as NonNullable<QrDesignV1['assets']>['logo'] },
		};
		const lookup = cache.lookup(design);
		expect(lookup('logo')?.width).toBe(5);
		expect(lookup('missing')).toBeUndefined();
		expect(cache.lookup(defaultDesign())('logo')).toBeUndefined();
		expect(cache.all(defaultDesign())).toBeUndefined();
		const damaged: QrDesignV1 = {
			...defaultDesign(),
			assets: { logo: { png: 'AAAA', width: 1, height: 1 } },
		};
		expect(cache.all(damaged)).toEqual({});
		expect(cache.lookup(damaged)('logo')).toBeUndefined();
	});
});

describe('the timer tracker', () => {
	it('runs a task once, never after it was cancelled, and cancels all', () => {
		const time = new FakeTime();
		const tracked = trackedScheduler(time);
		let ran = 0;
		const cancel = tracked.later(() => (ran += 1), 10);
		expect(tracked.pending).toBe(1);
		time.advance(10);
		cancel();
		expect(ran).toBe(1);
		expect(tracked.pending).toBe(0);
		// A scheduler whose own cancel does nothing still never runs a cancelled task.
		const lazy = trackedScheduler({
			later: (task, ms) => (time.later(task, ms), () => undefined),
			sliceMs: 8,
		});
		const stop = lazy.later(() => (ran += 1), 5);
		stop();
		time.advance(5);
		expect(ran).toBe(1);
		lazy.later(() => (ran += 1), 5);
		lazy.cancelAll();
		time.advance(5);
		expect(ran).toBe(1);
	});
});

describe("entries and presets of somebody else's", () => {
	it('draw a ring that names no kind as a finder', () => {
		const registries = createRegistries();
		registries.design.regionShapes.register({
			id: 'kindless',
			labelKey: 'design.region.square',
			params: [],
			kinds: [],
			part: 'outer',
			path(_ctx, out) {
				out.rect(0, 0, 7, 7);
			},
		});
		const ring = buildCatalogue(registries).rings.find((entry) => entry.id === 'kindless');
		expect(ring?.thumbnail().startsWith('<svg')).toBe(true);
	});

	it('take a preset with no level of its own over a design with none', () => {
		const registries = createRegistries();
		const base = registries.design.presets.require('classic-black');
		const bare: Preset = {
			...base,
			id: 'no-level',
			ecLevels: ['H'],
			design: { ...base.design, symbol: { symbology: 'qr' } },
		};
		registries.design.presets.register(bare);
		const { studio } = studioWithCode({ registries });
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['symbol'], value: { symbology: 'qr' } },
		});
		studio.dispatch({ type: 'design/shuffle', seed: 1 });
		studio.dispatch({ type: 'design/preset', id: 'no-level' });
		expect(studio.getSnapshot().document.design.symbol).toEqual({ symbology: 'qr' });
		studio.dispatch({ type: 'design/patch', patch: { path: ['symbol', 'ecLevel'], value: 'L' } });
		studio.dispatch({ type: 'design/shuffle', seed: 2 });
		studio.dispatch({ type: 'design/preset', id: 'no-level' });
		expect(studio.getSnapshot().document.design.symbol.ecLevel).toBe('L');
	});

	it('move a select value only to a field with that option', () => {
		expect(fitsField({ key: 's', kind: 'select', labelKey: 'x' }, 'a')).toBe(false);
	});

	it('make a dark ink black when nothing is dark enough beside the ground', () => {
		expect(darkInk(createPrng(1), '#000000')).toBe('#000000');
	});
});

describe('the symbol helpers, at their edges', () => {
	it('pass every symbol setting the design gives to the encoder', () => {
		const design: QrDesignV1 = {
			...defaultDesign(),
			symbol: {
				symbology: 'qr',
				ecLevel: 'Q',
				boostEc: true,
				minVersion: '2',
				maxVersion: '9',
				mask: 3,
				segmentation: { eci: 'utf-8' },
			},
		};
		expect(encodeOptions(design)).toEqual(design.symbol);
	});

	it('read back an ECI designator into the summary', () => {
		const { studio } = studioWithCode({}, 'https://example.com/café');
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['symbol', 'segmentation'], value: { eci: 'utf-8' } },
		});
		const { symbol } = studio.getSnapshot();
		expect(symbol.status === 'ok' && symbol.view.segments[0]?.eci).toBe(26);
	});

	it('leave the fullness unknown for a symbology with no profile for its own version', () => {
		const symbologies = createRegistries().symbologies;
		const entry = symbologies.require('qr');
		const odd = new Proxy(symbologies, {
			get(target, property) {
				if (property === 'require') {
					return () => ({
						...entry,
						profile: () => {
							throw new Error('no profile');
						},
					});
				}
				return Reflect.get(target, property);
			},
		});
		const view = symbolView(encode('HELLO'), 'HELLO', defaultDesign(), odd);
		expect(view.segments.length).toBe(1);
		expect(view.capacity.usedBits).toBe(0);
	});
});

describe('exports, at their edges', () => {
	const registries = createDesignRegistries();
	const input = {
		symbol: encode('https://example.com/'),
		design: defaultDesign(),
		fixedSizeMm: undefined,
		conditions: { sizeMm: 25, dpi: null, distanceMm: null },
		registries,
		assets: () => undefined,
		fonts: createFontRegistry(),
		seed: 1,
		rasterEncoder: null,
		printer: null,
		overlay: null,
	};

	it('take options that are not an object as none', async () => {
		const result = await exportSymbol(input, 'svg', 'nonsense' as never);
		expect(result.ok && result.value.issues).toEqual([]);
	});

	it("hold a symbology of somebody else's to four modules of quiet zone", async () => {
		const symbol = { ...input.symbol, symbology: 'theirs' };
		const result = await exportSymbol({ ...input, symbol }, 'svg', { quietZone: 3 });
		expect(result.ok && result.value.issues.map((found) => found.params)).toContainEqual({
			min: 4,
		});
	});

	it("use the design's own dpi when the options give none", async () => {
		const design: QrDesignV1 = {
			...defaultDesign(),
			output: { colourSpace: 'srgb', sizeMm: 25.4, dpi: 150 },
		};
		const result = await exportSymbol({ ...input, design }, 'png', {});
		expect(result.ok && result.value.width).toBe(150);
	});

	it('draw the preview and the export with the fonts a website passes', async () => {
		const { studio } = studioWithCode({ fonts: createFontRegistry() });
		expect(studio.getSnapshot().preview).not.toBeNull();
		expect((await studio.run({ type: 'export', format: 'svg', options: {} })).ok).toBe(true);
	});
});

describe('the job and its runner, at their edges', () => {
	it('name the fills of a ground and of a logo plate, and nothing for a clear ground', () => {
		const registries = createRegistries();
		const fill = { kind: 'entry' as const, ref: { id: 'palette-scatter' } };
		const design: QrDesignV1 = {
			...defaultDesign(),
			background: null,
			logo: {
				source: { kind: 'asset', id: 'logo' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: { paint: fill, shape: 'circle' },
			},
		};
		expect(requiredEntries(design, registries)).toEqual([
			'fill:palette-scatter',
			'module-shape:square',
			'symbology:qr',
		]);
	});

	it('stop at once when a progress callback aborts the run', async () => {
		const time = new FakeTime();
		const job = {
			content: 'x',
			design: defaultDesign(),
			conditions: { sizeMm: 25, dpi: null, distanceMm: null },
			seed: 1,
			requires: [],
		};
		let steps = 0;
		const runner = slicedVerifyRunner(
			function* () {
				for (;;) {
					steps += 1;
					yield { done: steps, total: 100, axis: 'static' as const };
				}
			} as never,
			{ registries: createRegistries(), scheduler: time, clock: time.clock },
		);
		const controller = new AbortController();
		const result = runner.run(job, controller.signal, () => controller.abort());
		time.flush();
		expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
		expect(steps).toBe(1);
		expect(time.pending).toBe(0);
		expect(reportFor(job).seed).toBe(1);
	});

	it('ignore progress from a run that a newer one replaced', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		const first = runner.last;
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/newer' });
		const before = studio.getSnapshot();
		first.progress({ done: 5, total: 10, axis: 'noise' });
		expect(studio.getSnapshot()).toBe(before);
	});
});

describe('the library when the studio is disposed mid-command', () => {
	function slowStore(): { store: LibraryStore; release: () => void } {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const later = <T>(value: T): Promise<Result<T>> => gate.then(() => ok(value));
		const summary = { id: 'a', name: 'A', savedAt: 0, typeId: 'url' };
		const store: LibraryStore = {
			probe: () => Promise.resolve(ok({ available: true, enabled: true })),
			enable: () => later(null),
			disable: () => later(null),
			list: () => later([summary]),
			save: () => later(summary),
			load: () => later({ ...summary, document: {} as StudioDocument }),
			remove: () => later(null),
		};
		return { store, release };
	}

	it('stops a list that finishes after dispose', async () => {
		const slow = slowStore();
		const { studio } = studioWith({ library: slow.store });
		await settle();
		studio.dispose();
		slow.release();
		await settle();
		expect(studio.getSnapshot().library).toEqual({ status: 'on', items: [] });
	});

	it('cancels disable, remove and load each mid-flight', async () => {
		for (const command of [
			{ type: 'library/disable' },
			{ type: 'library/remove', id: 'a' },
			{ type: 'library/load', id: 'a' },
		] as const) {
			let release: () => void = () => undefined;
			const gate = new Promise<void>((resolve) => (release = resolve));
			const store: LibraryStore = {
				probe: () => Promise.resolve(ok({ available: true, enabled: true })),
				enable: () => Promise.resolve(ok(null)),
				disable: () => gate.then(() => ok(null)),
				list: () => Promise.resolve(ok([])),
				save: () => Promise.resolve(err(new QrStudioError('library/quota', 'full'))),
				load: () =>
					gate.then(() =>
						ok({ id: 'a', name: 'A', savedAt: 0, typeId: 'url', document: {} as StudioDocument }),
					),
				remove: () => gate.then(() => ok(null)),
			};
			const { studio } = studioWith({ library: store });
			await settle();
			const pending = studio.run(command);
			studio.dispose();
			release();
			const result = await pending;
			expect(!result.ok && result.error.code, command.type).toBe('cancelled');
		}
	});
});

describe('the scan check, when there is nothing to check or nothing drawn', () => {
	it('does not run for content too long for any code', () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWith({ verifyRunner: runner });
		studio.dispatch({ type: 'payload/type', typeId: 'text' });
		studio.dispatch({ type: 'payload/field', key: 'text', value: 'x'.repeat(5000) });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		expect(runner.runs).toHaveLength(0);
		expect(studio.getSnapshot().verify.status).toBe('idle');
	});

	it("checks at the person's conditions when the scene cannot be drawn", () => {
		const registries = createRegistries();
		registries.design.moduleShapes.register({
			id: 'explodes',
			labelKey: 'design.module.square',
			params: [],
			connects: false,
			path() {
				throw new QrStudioError('design/invalid', 'boom');
			},
		});
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ registries, verifyRunner: runner });
		studio.dispatch({
			type: 'design/patch',
			patch: [
				{ path: ['modules', 'shape'], value: { id: 'explodes' } },
				{ path: ['output', 'sizeMm'], value: 40 },
			],
		});
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		expect(runner.last.job.conditions).toBe(studio.getSnapshot().document.conditions);
	});
});
