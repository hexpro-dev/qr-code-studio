/**
 * Changing the design: patches, presets, files, shuffles, and the content
 * constraints that win over all of them.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkPreset } from '../../src/conformance/preset.js';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { DesignPaint, Ink, Preset, QrDesignV1 } from '../../src/design/types.js';
import { validateDesign } from '../../src/design/validate.js';
import { contrastRatio, luminance } from '../../src/studio/contrast.js';
import { applyPatch, pathProblem } from '../../src/studio/patch.js';
import { sameJson, share } from '../../src/studio/share.js';
import { conformingPairs, hslHex, shuffleDesign } from '../../src/studio/shuffle.js';
import { logoPatches, removeLogoPatches } from '../../src/studio/logo.js';
import { assetOf, discImage } from '../design/helpers.js';
import { studioWith, studioWithCode } from './helpers.js';

const registries = createDesignRegistries();

describe('design/patch', () => {
	it('applies a path-addressed change and keeps the validator warnings in the snapshot', () => {
		const { studio } = studioWithCode();
		studio.dispatch({
			type: 'design/patch',
			patch: {
				path: ['regions', 'finder'],
				value: { outer: { id: 'circle' }, inner: { id: 'square-centre' } },
			},
		});
		const snapshot = studio.getSnapshot();
		expect(snapshot.refusal).toBeNull();
		expect(snapshot.document.design.regions.finder?.outer.id).toBe('circle');
		// A round ring round a square centre does not make a finder the strict reader finds.
		expect(snapshot.design.issues.map((found) => found.code)).toContain('design.issue.region-pair');
	});

	it('refuses a change the validator cannot accept, with its issues, and changes nothing', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot();
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['modules', 'shape'], value: { id: 'no-such-shape' } },
		});
		const after = studio.getSnapshot();
		expect(after.document).toBe(before.document);
		expect(after.revision).toBe(before.revision);
		expect(after.refusal?.action).toBe('design/patch');
		expect(after.refusal?.issues.some((found) => found.severity === 'error')).toBe(true);
		// The next change that lands clears it.
		studio.dispatch({ type: 'design/patch', patch: { path: ['quietZone'], value: 5 } });
		expect(studio.getSnapshot().refusal).toBeNull();
	});

	it('says so when a change is dropped by the validator, rather than seeming to ignore it', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot().document;
		studio.dispatch({ type: 'design/patch', patch: { path: ['madeUp'], value: 1 } });
		expect(studio.getSnapshot().document).toBe(before);
		expect(studio.getSnapshot().refusal?.issues.map((found) => found.code)).toEqual([
			'design.issue.unknown-key',
		]);
		// A patch that sets what is already there is no change and no refusal.
		studio.dispatch({ type: 'design/patch', patch: { path: ['quietZone'], value: 4 } });
		expect(studio.getSnapshot().refusal?.issues.map((found) => found.code)).toEqual([
			'design.issue.unknown-key',
		]);
	});

	it('refuses paths no design has, prototypes above all', () => {
		const { studio } = studioWithCode();
		for (const path of [
			[],
			['__proto__', 'polluted'],
			['constructor'],
			['a', ''],
			[1.5],
			[-1],
			'modules',
		]) {
			studio.dispatch({ type: 'design/patch', patch: { path: path as never, value: 1 } });
			expect(studio.getSnapshot().refusal?.issues[0]?.code, String(path)).toBe(
				'studio.issue.patch-path',
			);
		}
		studio.dispatch({ type: 'design/patch', patch: null as never });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.patch-path');
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		// An empty list is nothing to do.
		const before = studio.getSnapshot();
		studio.dispatch({ type: 'design/patch', patch: [] });
		expect(studio.getSnapshot()).toBe(before);
	});

	it('takes a logo picture and its asset together as one step', () => {
		const { studio } = studioWithCode();
		const asset = assetOf(discImage(32));
		const before = studio.getSnapshot().document.design;
		studio.dispatch({ type: 'design/patch', patch: logoPatches(before, asset) });
		const design = studio.getSnapshot().document.design;
		expect(studio.getSnapshot().refusal).toBeNull();
		expect(design.logo?.source).toEqual({ kind: 'asset', id: 'logo' });
		expect(design.assets?.logo).toEqual(asset);
		expect(studio.getSnapshot().preview?.svg).toContain('data:image/png;base64,');
		// A second picture replaces the first and keeps the logo's settings.
		studio.dispatch({ type: 'design/patch', patch: { path: ['logo', 'size'], value: 0.25 } });
		studio.dispatch({
			type: 'design/patch',
			patch: logoPatches(studio.getSnapshot().document.design, assetOf(discImage(16))),
		});
		expect(studio.getSnapshot().document.design.logo?.size).toBe(0.25);
		studio.dispatch({
			type: 'design/patch',
			patch: removeLogoPatches(studio.getSnapshot().document.design),
		});
		expect(studio.getSnapshot().document.design.logo).toBeNull();
		expect(studio.getSnapshot().document.design.assets).toBeUndefined();
		expect(removeLogoPatches(defaultDesign())).toEqual([{ path: ['logo'], value: null }]);
		studio.dispatch({ type: 'history/undo' });
		studio.dispatch({ type: 'history/undo' });
		studio.dispatch({ type: 'history/undo' });
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design).toBe(before);
	});

	it('draws a picture that will not decode as missing, with the scene saying so', () => {
		const { studio } = studioWithCode();
		const asset = assetOf(discImage(32));
		// A valid signature and length, damaged after the header.
		const bytes = Buffer.from(asset.png, 'base64');
		bytes.fill(0, 40);
		const damaged = { ...asset, png: bytes.toString('base64') };
		studio.dispatch({
			type: 'design/patch',
			patch: logoPatches(studio.getSnapshot().document.design, damaged),
		});
		const preview = studio.getSnapshot().preview;
		expect(preview).not.toBeNull();
		expect(preview?.issues.length).toBeGreaterThan(0);
	});
});

describe('the patch helpers', () => {
	it('copy only the objects on the path, and make the missing steps', () => {
		const target = { a: { b: 1 }, c: { d: 2 } };
		const out = applyPatch(target, ['a', 'b'], 3) as typeof target;
		expect(out).toEqual({ a: { b: 3 }, c: { d: 2 } });
		expect(out.c).toBe(target.c);
		expect(applyPatch({}, ['x', 0], 'y')).toEqual({ x: ['y'] });
		expect(applyPatch([1, 2, 3], [1], undefined)).toEqual([1, 3]);
		expect(applyPatch({ a: 1, b: 2 }, ['a'], undefined)).toEqual({ b: 2 });
		expect(applyPatch(null, ['a'], 1)).toEqual({ a: 1 });
		expect(pathProblem(new Array(17).fill('a'))).toBe('shape');
		expect(pathProblem([2000])).toBe('shape');
		expect(pathProblem(['a'.repeat(65)])).toBe('shape');
		expect(pathProblem([true])).toBe('shape');
		expect(pathProblem(['prototype'])).toBe('key');
		expect(pathProblem(['modules', 0])).toBeNull();
	});

	it('share keeps every equal subtree of the old value', () => {
		const old = { a: { x: 1 }, b: [1, { y: 2 }], c: 'same' };
		const next = { a: { x: 1 }, b: [1, { y: 3 }], c: 'same', d: true };
		const shared = share(old, next);
		expect(shared).toEqual(next);
		expect(shared.a).toBe(old.a);
		expect(shared.b).not.toBe(old.b);
		expect(share(old, structuredClone(old))).toBe(old);
		expect(share(1, 2)).toBe(2);
		expect(share([1], { a: 1 })).toEqual({ a: 1 });
		expect(sameJson([1, 2], [1, 2, 3])).toBe(false);
		expect(sameJson([1], { 0: 1 })).toBe(false);
		expect(sameJson({ a: 1 }, { b: 1 })).toBe(false);
		expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
		expect(sameJson({ a: 1 }, null)).toBe(false);
	});
});

describe('design/preset', () => {
	it("applies a preset, keeping the size, the name and the person's own picture", () => {
		const { studio } = studioWithCode();
		const asset = assetOf(discImage(32));
		studio.dispatch({
			type: 'design/patch',
			patch: logoPatches(studio.getSnapshot().document.design, asset),
		});
		studio.dispatch({
			type: 'design/patch',
			patch: [
				{ path: ['name'], value: 'Shop window' },
				{ path: ['output', 'sizeMm'], value: 40 },
				{ path: ['symbol', 'ecLevel'], value: 'H' },
			],
		});
		const preset = registries.presets
			.list()
			.find((candidate) => candidate.design.logo === null) as Preset;
		studio.dispatch({ type: 'design/preset', id: preset.id });
		const design = studio.getSnapshot().document.design;
		expect(studio.getSnapshot().refusal).toBeNull();
		expect(design.modules).toEqual(preset.design.modules);
		expect(design.name).toBe('Shop window');
		expect(design.output.sizeMm).toBe(40);
		expect(design.logo?.source).toEqual({ kind: 'asset', id: 'logo' });
		expect(design.assets?.logo).toEqual(asset);
		expect(design.symbol.ecLevel).toBe(
			preset.ecLevels.includes('H') ? 'H' : preset.design.symbol.ecLevel,
		);
	});

	it("takes the preset's logo and level when it brings one", () => {
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'design/patch', patch: { path: ['symbol', 'ecLevel'], value: 'L' } });
		const preset = registries.presets
			.list()
			.find((candidate) => candidate.design.logo !== null) as Preset;
		studio.dispatch({ type: 'design/preset', id: preset.id });
		const design = studio.getSnapshot().document.design;
		expect(design.logo).toEqual(preset.design.logo);
		expect(preset.ecLevels).toContain(design.symbol.ecLevel);
	});

	it('refuses a preset it does not have', () => {
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'design/preset', id: 'no-such-preset' });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.unknown-preset');
		studio.dispatch({ type: 'design/preset', id: 7 as never });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.unknown-preset');
	});
});

describe('design/replace', () => {
	it('opens a design file as JSON text or as an object', () => {
		const { studio } = studioWithCode();
		const theirs: QrDesignV1 = { ...defaultDesign(), quietZone: 6, name: 'From a file' };
		studio.dispatch({ type: 'design/replace', design: JSON.stringify(theirs) });
		expect(studio.getSnapshot().document.design).toEqual(theirs);
		studio.dispatch({ type: 'design/replace', design: { ...theirs, quietZone: 7 } });
		expect(studio.getSnapshot().document.design.quietZone).toBe(7);
	});

	it('reports every way a file can be wrong as issues, never as a throw', () => {
		const { studio } = studioWithCode();
		const cases: unknown[] = [
			'{not json',
			'"a string"',
			'null',
			JSON.stringify({ schema: 'qr-design', version: 99 }),
			JSON.stringify({ schema: 'other' }),
			JSON.stringify({ ...defaultDesign(), quietZone: 'four' }),
			'x'.repeat(4 * 1024 * 1024 + 1),
			42,
			[defaultDesign()],
		];
		let deep: unknown = {};
		for (let i = 0; i < 100; i += 1) deep = { schema: 'qr-design', version: 1, nested: deep };
		cases.push(deep);
		for (const input of cases) {
			const before = studio.getSnapshot().document;
			expect(() => studio.dispatch({ type: 'design/replace', design: input })).not.toThrow();
			expect(studio.getSnapshot().document).toBe(before);
			expect(studio.getSnapshot().refusal?.issues.length).toBeGreaterThan(0);
		}
	});

	it('never throws for fuzzed JSON, only reports', () => {
		const { studio } = studioWithCode();
		fc.assert(
			fc.property(fc.jsonValue({ maxDepth: 6 }), fc.boolean(), (value, asText) => {
				const design = asText ? JSON.stringify(value) : value;
				expect(() => studio.dispatch({ type: 'design/replace', design })).not.toThrow();
				const snapshot = studio.getSnapshot();
				expect(validateDesign(snapshot.document.design, registries).design).not.toBeNull();
			}),
			{ numRuns: 300, seed: 8 },
		);
		// And over designs nearly right, a part at a time.
		const base = defaultDesign() as unknown as Record<string, unknown>;
		fc.assert(
			fc.property(
				fc.constantFrom(...Object.keys(base)),
				fc.jsonValue({ maxDepth: 3 }),
				(key, value) => {
					expect(() =>
						studio.dispatch({ type: 'design/replace', design: { ...base, [key]: value } }),
					).not.toThrow();
				},
			),
			{ numRuns: 300, seed: 9 },
		);
	});
});

/** Every ink a paint puts down, colour params of an entry fill included. */
function inksOf(paint: DesignPaint | undefined): Ink[] {
	if (paint === undefined) return [];
	if (paint.kind === 'solid') return [paint.ink];
	if (paint.kind === 'entry')
		return Object.values(paint.ref.params ?? {}).filter((v): v is string => typeof v === 'string');
	return paint.stops.map((stop) => stop.ink);
}

describe('design/shuffle', () => {
	const pairs = conformingPairs(registries);

	it('is the same design for the same seed, and a different one for another', () => {
		const a = shuffleDesign(defaultDesign(), 12, registries, pairs);
		expect(shuffleDesign(defaultDesign(), 12, registries, pairs)).toEqual(a);
		expect(shuffleDesign(defaultDesign(), 13, registries, pairs)).not.toEqual(a);
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'design/shuffle', seed: 12 });
		expect(studio.getSnapshot().document.design).toEqual(a);
	});

	it('passes preset conformance for every seed, finders, scenes and contrast included', () => {
		for (let seed = 0; seed < 120; seed += 1) {
			const design = shuffleDesign(defaultDesign(), seed, registries, pairs);
			const preset: Preset = {
				id: 'shuffled',
				labelKey: 'design.preset.classic-black',
				category: 'colour',
				design,
				minSizeMm: 30,
				ecLevels: [design.symbol.ecLevel ?? 'M'],
			};
			expect(checkPreset(preset, null, registries), `seed ${seed}`).toEqual([]);
		}
	});

	it('holds every dark ink at 7:1 or more against the ground', () => {
		let gradients = 0;
		let fills = 0;
		for (let seed = 0; seed < 300; seed += 1) {
			const design = shuffleDesign(defaultDesign(), seed, registries, pairs);
			const ground = inksOf(design.background ?? undefined)[0] as Ink;
			const darks = [
				...inksOf(design.modules.paint),
				...inksOf(design.regions.finder?.outerPaint),
				...inksOf(design.regions.finder?.innerPaint),
			];
			if (design.modules.paint.kind !== 'solid') gradients += 1;
			if (design.modules.paint.kind === 'entry') fills += 1;
			for (const dark of darks) {
				expect(contrastRatio(dark, ground), `seed ${seed}`).toBeGreaterThanOrEqual(7);
				expect(luminance(dark)).toBeLessThan(luminance(ground));
			}
		}
		// The draw reaches every kind of paint it offers.
		expect(gradients).toBeGreaterThan(50);
		expect(fills).toBeGreaterThan(5);
	});

	it("keeps what is the person's: the symbol settings, the logo, the output and the name", () => {
		const base: QrDesignV1 = {
			...defaultDesign(),
			symbol: { symbology: 'qr', ecLevel: 'H', maxVersion: '20' },
			quietZone: 6,
			logo: {
				source: { kind: 'icon', id: 'star' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
			output: { sizeMm: 30, colourSpace: 'cmyk' },
			name: 'Mine',
			assets: { logo: assetOf(discImage(8)) },
		};
		const design = shuffleDesign(base, 4, registries, pairs);
		expect(design.symbol).toBe(base.symbol);
		expect(design.quietZone).toBe(6);
		expect(design.logo).toBe(base.logo);
		expect(design.output).toBe(base.output);
		expect(design.name).toBe('Mine');
		expect(design.assets).toBe(base.assets);
	});

	it('keeps square rings for Micro QR and draws no frame round rMQR', () => {
		for (let seed = 0; seed < 40; seed += 1) {
			const micro = shuffleDesign(
				{ ...defaultDesign(), symbol: { symbology: 'micro' } },
				seed,
				registries,
				pairs,
			);
			expect(micro.regions.finder?.outer.id).toBe('square');
			const rmqr = shuffleDesign(
				{ ...defaultDesign(), symbol: { symbology: 'rmqr' } },
				seed,
				registries,
				pairs,
			);
			expect(rmqr.frame).toBeNull();
		}
	});

	it('makes do with registries that hold little', () => {
		const bare = createDesignRegistries();
		const empty = {
			...bare,
			moduleShapes: new (
				bare.moduleShapes.constructor as never as new (kind: string) => typeof bare.moduleShapes
			)('module-shape'),
			fills: new (bare.fills.constructor as never as new (kind: string) => typeof bare.fills)(
				'fill',
			),
			frames: new (bare.frames.constructor as never as new (kind: string) => typeof bare.frames)(
				'frame',
			),
		};
		for (let seed = 0; seed < 30; seed += 1) {
			const design = shuffleDesign(defaultDesign(), seed, empty, []);
			expect(design.modules.shape).toEqual({ id: 'square' });
			expect(design.regions).toEqual({});
			expect(design.frame).toBeNull();
			expect(design.modules.paint.kind).not.toBe('entry');
		}
	});

	it('takes any number as a seed', () => {
		const { studio } = studioWithCode();
		for (const seed of [-5, 1.7, Number.NaN, 2 ** 40, Number.POSITIVE_INFINITY]) {
			expect(() => studio.dispatch({ type: 'design/shuffle', seed })).not.toThrow();
		}
	});

	it('writes HSL as hex by the CSS formula', () => {
		expect(hslHex(0, 1, 0.5)).toBe('#ff0000');
		expect(hslHex(1 / 3, 1, 0.5)).toBe('#00ff00');
		expect(hslHex(0, 0, 1)).toBe('#ffffff');
		expect(hslHex(0, 0, 0)).toBe('#000000');
	});
});

describe('content constraints', () => {
	it("lock the Swiss QR-bill's design: every design change is refused with an issue", () => {
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'design/shuffle', seed: 3 });
		studio.dispatch({ type: 'payload/type', typeId: 'swiss-qr-bill' });
		const snapshot = studio.getSnapshot();
		expect(snapshot.design.locked).toBe(true);
		expect(snapshot.form.designLocked).toBe(true);
		const effective = snapshot.design.effective;
		expect(effective.modules.paint).toEqual({ kind: 'solid', ink: '#000000' });
		expect(effective.output.sizeMm).toBe(46);
		expect(effective.symbol.ecLevel).toBe('M');
		expect(snapshot.design.issues.map((found) => found.code)).toEqual(
			expect.arrayContaining(['design.issue.design-locked', 'design.issue.overlay-required']),
		);
		for (const action of [
			{ type: 'design/patch', patch: { path: ['modules', 'shape'], value: { id: 'dot' } } },
			{ type: 'design/preset', id: 'classic-black' },
			{ type: 'design/shuffle', seed: 9 },
			{
				type: 'design/replace',
				design: {
					...defaultDesign(),
					modules: { ...defaultDesign().modules, shape: { id: 'dot' } },
				},
			},
		] as const) {
			const before = studio.getSnapshot().document;
			expect(() => studio.dispatch(action)).not.toThrow();
			expect(studio.getSnapshot().document, action.type).toBe(before);
			expect(studio.getSnapshot().refusal?.issues[0]?.code, action.type).toBe(
				'studio.issue.design-locked',
			);
		}
		// The person's own design comes back with another kind of content.
		studio.dispatch({ type: 'payload/type', typeId: 'url' });
		expect(studio.getSnapshot().design.locked).toBe(false);
		expect(studio.getSnapshot().design.effective).toBe(studio.getSnapshot().document.design);
	});

	it('still let the parts the lock leaves alone change: the name, and a wider quiet zone', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/type', typeId: 'swiss-qr-bill' });
		studio.dispatch({ type: 'design/patch', patch: { path: ['name'], value: 'Invoice codes' } });
		expect(studio.getSnapshot().refusal).toBeNull();
		expect(studio.getSnapshot().design.effective.name).toBe('Invoice codes');
		studio.dispatch({ type: 'design/patch', patch: { path: ['quietZone'], value: 6 } });
		expect(studio.getSnapshot().design.effective.quietZone).toBe(6);
	});

	it('set EPC to error correction M, saying what they changed', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'design/patch', patch: { path: ['symbol', 'ecLevel'], value: 'H' } });
		studio.dispatch({ type: 'payload/type', typeId: 'epc' });
		const snapshot = studio.getSnapshot();
		expect(snapshot.design.effective.symbol.ecLevel).toBe('M');
		expect(snapshot.design.effective.symbol.maxVersion).toBe('13');
		expect(snapshot.design.issues.map((found) => found.code)).toContain(
			'design.issue.ec-level-constrained',
		);
		// Asking for another level now is refused: the content sets it.
		studio.dispatch({ type: 'design/patch', patch: { path: ['symbol', 'ecLevel'], value: 'Q' } });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.constrained');
		// A change the constraint leaves alone lands.
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['modules', 'shape'], value: { id: 'dot' } },
		});
		expect(studio.getSnapshot().refusal).toBeNull();
	});
});
