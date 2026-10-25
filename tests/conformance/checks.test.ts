/**
 * The conformance checks catch what they are for: each rule, broken on
 * purpose by an entry made to break it.
 */

import { describe, expect, it } from 'vitest';
import { checkFrame } from '../../src/conformance/frame.js';
import { checkModuleShape } from '../../src/conformance/module-shape.js';
import {
	checkPreset,
	contrast,
	darkInks,
	emptySymbol,
	luminance,
	paintInks,
} from '../../src/conformance/preset.js';
import { checkRegionShape } from '../../src/conformance/region-shape.js';
import { sampleParams } from '../../src/conformance/sample.js';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type {
	DesignRegistries,
	FrameEntry,
	ModuleShape,
	ParamSchema,
	Preset,
	RegionShape,
} from '../../src/design/types.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { assetOf, discImage } from '../design/helpers.js';

const registries = createDesignRegistries();

function rules(violations: readonly { rule: string }[]): string[] {
	return [...new Set(violations.map((violation) => violation.rule))].sort();
}

describe('sampleParams', () => {
	it('draws the defaults, each end of each range, every option, both ends together and seeded mixtures', () => {
		const schema: ParamSchema[] = [
			{ key: 'n', kind: 'number', labelKey: 'x', default: 0.5, min: 0, max: 1, step: 0.25 },
			{ key: 'free', kind: 'number', labelKey: 'x', default: 2 },
			{ key: 'i', kind: 'integer', labelKey: 'x', default: 2, min: 1, max: 4 },
			{ key: 'b', kind: 'boolean', labelKey: 'x', default: false },
			{
				key: 's',
				kind: 'select',
				labelKey: 'x',
				default: 'a',
				options: [
					{ value: 'a', labelKey: 'x' },
					{ value: 'b', labelKey: 'x' },
				],
			},
			{ key: 'c', kind: 'colour', labelKey: 'x', default: '#000000' },
		];
		const samples = sampleParams(schema, 3, 4);
		expect(samples[0]).toEqual({ n: 0.5, free: 2, i: 2, b: false, s: 'a', c: '#000000' });
		const values = (key: string) => new Set(samples.map((sample) => sample[key]));
		expect(
			[...values('n')].every((value) => [0, 0.25, 0.5, 0.75, 1].includes(value as number)),
		).toBe(true);
		expect(values('b')).toEqual(new Set([false, true]));
		expect(values('s')).toEqual(new Set(['a', 'b']));
		expect(values('i').has(1)).toBe(true);
		expect(values('i').has(4)).toBe(true);
		expect(sampleParams(schema, 3, 4)).toEqual(samples);
		expect(sampleParams([], 1)).toEqual([{}]);
		const bare: ParamSchema[] = [{ key: 's', kind: 'select', labelKey: 'x', default: 'only' }];
		expect(sampleParams(bare, 1, 2)).toEqual([{ s: 'only' }]);
		const unstepped: ParamSchema[] = [
			{ key: 'u', kind: 'number', labelKey: 'x', default: 1, min: 0, max: 2 },
		];
		expect(sampleParams(unstepped, 1, 2).length).toBeGreaterThan(3);
	});
});

const square = registries.moduleShapes.require('square');

describe('checkModuleShape', () => {
	it('finds a shape that leaves the centre light, or draws nothing', () => {
		const ring: ModuleShape = {
			...square,
			id: 'ring',
			path: (_ctx, out) => void out.rect(0, 0, 1, 0.2),
		};
		expect(rules(checkModuleShape(ring))).toEqual(['centre-cross']);
		const blank: ModuleShape = { ...square, id: 'blank', path: () => undefined };
		expect(checkModuleShape(blank)[0]?.detail).toContain('nothing is drawn');
	});

	it('finds ink outside the cell, into a light neighbour, and beyond the neighbours', () => {
		const spill: ModuleShape = {
			...square,
			id: 'spill',
			path: (_ctx, out) => void out.rect(0, 0, 1.6, 1),
		};
		expect(rules(checkModuleShape(spill))).toEqual(['light-neighbour', 'outside-cell']);
		const far: ModuleShape = {
			...square,
			id: 'far',
			path: (_ctx, out) => void out.rect(0, 0, 1, 1).rect(5, 5, 1, 1),
		};
		expect(rules(checkModuleShape(far))).toEqual(['outside-cell']);
		// A connecting shape may reach a dark edge neighbour, never a corner one.
		const corner: ModuleShape = {
			...square,
			id: 'corner',
			connects: true,
			path: ({ neighbours }, out) => {
				out.rect(0, 0, 1, 1);
				if ((neighbours & 2) !== 0) out.rect(1, -0.5, 0.5, 0.5);
				if ((neighbours & 4) !== 0) out.rect(1, 0, 0.5, 1);
			},
		};
		expect(rules(checkModuleShape(corner))).toEqual(['outside-cell']);
	});

	it('finds a shape that draws differently each time', () => {
		let calls = 0;
		const restless: ModuleShape = {
			...square,
			id: 'restless',
			path: (_ctx, out) => {
				calls += 1;
				out.rect(0, 0, 1, calls % 2 === 0 ? 1 : 0.99);
			},
		};
		expect(rules(checkModuleShape(restless))).toEqual(['deterministic']);
		const lengths: ModuleShape = {
			...square,
			id: 'lengths',
			path: (_ctx, out) => {
				calls += 1;
				out.rect(0, 0, 1, 1);
				if (calls % 2 === 0) out.rect(0.4, 0.4, 0.2, 0.2);
			},
		};
		expect(rules(checkModuleShape(lengths))).toEqual(['deterministic']);
		const commands: ModuleShape = {
			...square,
			id: 'commands',
			path: (_ctx, out) => {
				calls += 1;
				if (calls % 2 === 0) out.rect(0, 0, 1, 1);
				else out.moveTo(0, 0).lineTo(1, 0).lineTo(1, 1).quadTo(0.5, 1.2, 0, 1).close();
			},
		};
		expect(rules(checkModuleShape(commands, { seed: 2, mixtures: 0 }))).toContain('deterministic');
		// The same number of commands and points, in a different order.
		const reordered: ModuleShape = {
			...square,
			id: 'reordered',
			path: (_ctx, out) => {
				calls += 1;
				if (calls % 2 === 0)
					out.moveTo(0, 0).quadTo(0.5, -0.1, 1, 0).lineTo(1, 1).lineTo(0, 1).close();
				else out.moveTo(0, 0).lineTo(1, 0).quadTo(1.1, 0.5, 1, 1).lineTo(0, 1).close();
			},
		};
		expect(rules(checkModuleShape(reordered, { mixtures: 0 }))).toContain('deterministic');
	});
});

const squareRing = registries.regionShapes.require('square');
const squareCentre = registries.regionShapes.require('square-centre');

describe('checkRegionShape', () => {
	it('requires rings to support the finder and the corner pattern, and centres the finder', () => {
		const partial: RegionShape = { ...squareRing, id: 'partial', kinds: ['concentric-5'] };
		expect(rules(checkRegionShape(partial))).toEqual(['kinds']);
		const centreless: RegionShape = { ...squareCentre, id: 'centreless', kinds: [] };
		expect(rules(checkRegionShape(centreless))).toEqual(['kinds']);
	});

	it('finds a ring no centre makes a finder with, and says when no partner draws the kind', () => {
		const thin: RegionShape = {
			...squareRing,
			id: 'thin',
			kinds: ['concentric-7', 'corner-l'],
			path: ({ kind }, out) => {
				if (kind === 'corner-l') return squareRing.path({ kind, params: {} }, out);
				out.rect(0, 0, 7, 7).rect(6.6, 0.4, -6.2, 6.2);
			},
		};
		const found = checkRegionShape(thin, { partners: [squareCentre] });
		expect(rules(found)).toEqual(['finder']);
		expect(found[0]?.detail).toContain('run');
		const lonely: RegionShape = {
			...squareRing,
			id: 'lonely',
			kinds: ['concentric-7', 'concentric-5', 'corner-l'],
		};
		const none = checkRegionShape(lonely, {
			partners: [registries.regionShapes.require('star-centre')],
		});
		expect(none.map((violation) => violation.detail).join(' ')).toContain(
			'no partner supports this kind',
		);
		// With no partners given, the built-ins of the other part are used.
		expect(checkRegionShape(squareRing)).toEqual([]);
	});

	it('finds a shape that leaves its box, or a centre that leaves the hole', () => {
		const big: RegionShape = {
			...squareRing,
			id: 'big',
			path: ({ kind, params }, out) => {
				if (kind === 'corner-l') return squareRing.path({ kind, params }, out);
				out.rect(-0.5, 0, 8, 7);
			},
		};
		expect(rules(checkRegionShape(big))).toEqual(['outside-box']);
		const sprawling: RegionShape = {
			...squareCentre,
			id: 'sprawling',
			path: (_ctx, out) => void out.rect(0.5, 2, 6, 3),
		};
		expect(rules(checkRegionShape(sprawling))).toEqual(['outside-box']);
		const empty: RegionShape = { ...squareCentre, id: 'empty', path: () => undefined };
		expect(rules(checkRegionShape(empty))).toEqual(['outside-box']);
	});

	it('finds a corner pattern that misses a module, inks the light one, or spills', () => {
		const broken = (draw: (out: PathBuilder) => void, id: string): RegionShape => ({
			...squareRing,
			id,
			path: ({ kind, params }, out) => {
				if (kind === 'corner-l') draw(out);
				else squareRing.path({ kind, params }, out);
			},
		});
		expect(
			rules(
				checkRegionShape(
					broken((out) => void out.polygon([0, 0, 2, 0, 2, 1, 1, 1, 1, 3, 0, 3]), 'short'),
				),
			),
		).toEqual(['corner-cross']);
		expect(
			rules(
				checkRegionShape(
					broken(
						(out) => void out.rect(0, 0, 3, 1).rect(0, 0, 1, 3).rect(1.2, 1.2, 0.6, 0.6),
						'filled',
					),
				),
			),
		).toEqual(['corner-light']);
		expect(
			rules(
				checkRegionShape(
					broken((out) => void out.rect(0, 0, 3, 1).rect(0, 0, 1, 3).rect(2, 2, 1, 1), 'foreign'),
				),
			),
		).toEqual(['corner-outside']);
		expect(
			rules(
				checkRegionShape(broken((out) => void out.rect(-1, 0, 4, 1).rect(0, 0, 1, 3), 'outside')),
			),
		).toEqual(['corner-outside']);
	});

	it('finds a shape that draws differently each time', () => {
		let calls = 0;
		const restless: RegionShape = {
			...squareCentre,
			id: 'restless',
			path: ({ kind, params }, out) => {
				calls += 1;
				if (calls % 2 === 0) out.rect(2, 2, 3, 3);
				else squareCentre.path({ kind, params }, out);
			},
		};
		expect(rules(checkRegionShape(restless))).toContain('deterministic');
		const extra: RegionShape = {
			...squareCentre,
			id: 'extra',
			path: ({ kind, params }, out) => {
				calls += 1;
				squareCentre.path({ kind, params }, out);
				if (calls % 3 === 0) out.rect(3, 3, 0.2, 0.2);
			},
		};
		expect(rules(checkRegionShape(extra))).toContain('deterministic');
		const reordered: RegionShape = {
			...squareCentre,
			id: 'reordered',
			path: (_ctx, out) => {
				calls += 1;
				if (calls % 2 === 0)
					out.moveTo(2, 2).quadTo(3.5, 1.9, 5, 2).lineTo(5, 5).lineTo(2, 5).close();
				else out.moveTo(2, 2).lineTo(5, 2).quadTo(5.1, 3.5, 5, 5).lineTo(2, 5).close();
			},
		};
		expect(rules(checkRegionShape(reordered))).toContain('deterministic');
		const nudged: RegionShape = {
			...squareCentre,
			id: 'nudged',
			path: (_ctx, out) => {
				calls += 1;
				out.rect(2, 2, 3, calls % 2 === 0 ? 3 : 2.99);
			},
		};
		expect(rules(checkRegionShape(nudged))).toContain('deterministic');
	});
});

const none = registries.frames.require('none');
const card = registries.frames.require('rounded-card');

describe('checkFrame', () => {
	it('finds ink in the quiet zone, whatever kind of node carries it', () => {
		const leaky: FrameEntry = {
			...card,
			id: 'leaky',
			layout: (ctx) => {
				const layout = card.layout(ctx);
				const blot = new PathBuilder().rect(layout.symbol.x + 1, layout.symbol.y + 1, 1, 1).build();
				const image = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
				return {
					...layout,
					over: [
						{
							kind: 'group',
							clip: new PathBuilder().rect(0, 0, layout.width, layout.height).build(),
							children: [
								{ kind: 'group', children: [{ kind: 'path', path: blot, paint: ctx.paint }] },
								{
									kind: 'image',
									image,
									x: layout.symbol.x + 2,
									y: layout.symbol.y + 2,
									width: 1,
									height: 1,
								},
								{ kind: 'image', image, x: 0, y: 0, width: 0.5, height: 0.5, clip: blot },
							],
						},
					],
				};
			},
		};
		expect(rules(checkFrame(leaky))).toEqual(['quiet-zone']);
	});

	it('finds a quiet zone outside the artwork, and caption boxes that are missing, outside or in the way', () => {
		const shifted: FrameEntry = {
			...card,
			id: 'shifted',
			layout: (ctx) => ({ ...card.layout(ctx), symbol: { x: -1, y: 0 } }),
		};
		expect(rules(checkFrame(shifted))).toEqual(['layout']);
		const boxless: FrameEntry = {
			...card,
			id: 'boxless',
			layout: (ctx) => ({ ...card.layout(ctx), textBox: null }),
		};
		expect(rules(checkFrame(boxless))).toEqual(['text-box']);
		const inside: FrameEntry = {
			...card,
			id: 'inside',
			layout: (ctx) => {
				const layout = card.layout(ctx);
				return {
					...layout,
					textBox: {
						x: layout.symbol.x + 1,
						y: layout.symbol.y + 1,
						width: 2,
						height: 2,
						align: 'centre',
					},
				};
			},
		};
		expect(checkFrame(inside)[0]?.detail).toContain('overlaps the quiet zone');
		const outside: FrameEntry = {
			...card,
			id: 'outside',
			layout: (ctx) => ({
				...card.layout(ctx),
				textBox: { x: 0, y: 0, width: -1, height: 1, align: 'start' },
			}),
		};
		expect(checkFrame(outside)[0]?.detail).toContain('leaves the artwork');
		expect(checkFrame(none)).toEqual([]);
	});

	it('finds a frame that lays out differently each time', () => {
		let calls = 0;
		const restless: FrameEntry = {
			...card,
			id: 'restless',
			layout: (ctx) => {
				calls += 1;
				const layout = card.layout(ctx);
				return { ...layout, width: layout.width + (calls % 2) };
			},
		};
		expect(
			rules(checkFrame(restless, { sizes: [{ width: 21, height: 21, quietZone: 4 }] })),
		).toContain('deterministic');
	});
});

describe('checkPreset', () => {
	const preset = registries.presets.require('classic-navy');

	it('passes a good preset and runs the scan check it is given', () => {
		expect(checkPreset(preset)).toEqual([]);
		const verify = (found: Preset, own: DesignRegistries) => [
			{ entry: found.id, rule: 'scan', detail: `${own.presets.ids().length} presets` },
		];
		expect(checkPreset(preset, verify, registries)).toEqual([
			{ entry: 'classic-navy', rule: 'scan', detail: `${registries.presets.ids().length} presets` },
		]);
	});

	it('finds a bad category, size and level list', () => {
		const bad = { ...preset, category: 'loud', minSizeMm: 0, ecLevels: ['H'] } as unknown as Preset;
		expect(rules(checkPreset(bad, null, registries))).toEqual([
			'category',
			'ec-levels',
			'min-size',
		]);
		const unset = {
			...preset,
			design: { ...preset.design, symbol: { symbology: 'qr' } },
			ecLevels: ['L'],
		} as Preset;
		expect(rules(checkPreset(unset, null, registries))).toEqual(['ec-levels']);
	});

	it('finds a design that does not validate cleanly, or does not build cleanly', () => {
		const repaired = { ...preset, design: { ...preset.design, extra: 1 } } as unknown as Preset;
		expect(rules(checkPreset(repaired, null, registries))).toEqual(['validates']);
		const picture: Preset = {
			...preset,
			design: {
				...preset.design,
				logo: {
					source: { kind: 'asset', id: 'mark' },
					size: 0.2,
					clear: 'box',
					padding: 1,
					plate: null,
				},
				// Valid, but nothing loads it for the scene.
				assets: { mark: assetOf(discImage(4)) },
			},
		};
		expect(rules(checkPreset(picture, null, registries))).toEqual(['scene']);
	});

	it('finds colours that are too close, inverted, or unknowable', () => {
		const pale = {
			...preset,
			design: {
				...preset.design,
				modules: { ...preset.design.modules, paint: { kind: 'solid' as const, ink: '#9f9f9f' } },
			},
		};
		expect(checkPreset(pale, null, registries)[0]?.detail).toMatch(/2\.\d\d:1/);
		const inverted = {
			...preset,
			design: {
				...preset.design,
				background: { kind: 'solid' as const, ink: '#000000' },
				modules: { ...preset.design.modules, paint: { kind: 'solid' as const, ink: '#ffffff' } },
			},
		};
		expect(checkPreset(inverted, null, registries)[0]?.detail).toContain('lighter than the ground');
		const clear = { ...preset, design: { ...preset.design, background: null } };
		expect(rules(checkPreset(clear, null, registries))).toEqual(['contrast']);
	});

	it('measures luminance and contrast as WCAG does, over every ink a paint can put down', () => {
		expect(luminance('#ffffff')).toBeCloseTo(1, 12);
		expect(luminance('#000000')).toBe(0);
		expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 10);
		expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 10);
		expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
		const own = createDesignRegistries();
		expect(
			paintInks(
				{
					kind: 'entry',
					ref: { id: 'palette-scatter', params: { count: 2, 'colour-1': '#111111' } },
				},
				own,
			),
		).toEqual(['#111111', '#2b4c7e']);
		expect(paintInks({ kind: 'entry', ref: { id: 'two-tone-diagonal' } }, own)).toEqual([
			'#14213d',
			'#7a1f3d',
		]);
		expect(paintInks({ kind: 'entry', ref: { id: 'missing' } }, own)).toEqual([]);
		expect(paintInks({ kind: 'entry', ref: { id: 'palette-scatter', params: {} } }, own)).toEqual([
			'#14213d',
			'#2b4c7e',
			'#6a1b4d',
		]);
		expect(
			paintInks(
				{
					kind: 'linear',
					angle: 0,
					space: 'symbol',
					stops: [
						{ offset: 0, ink: '#000' },
						{ offset: 1, ink: '#111' },
					],
				},
				own,
			),
		).toEqual(['#000', '#111']);
		const design = {
			...defaultDesign(),
			regions: {
				finder: {
					outer: { id: 'square' },
					inner: { id: 'square-centre' },
					outerPaint: { kind: 'solid' as const, ink: '#100000' },
					innerPaint: { kind: 'solid' as const, ink: '#200000' },
				},
			},
			logo: {
				source: { kind: 'icon' as const, id: 'wifi' },
				size: 0.2,
				clear: 'box' as const,
				padding: 1,
				plate: null,
				paint: { kind: 'solid' as const, ink: '#300000' },
			},
		};
		expect(darkInks(design, own)).toEqual(['#000000', '#100000', '#200000', '#300000']);
		const noPaint = {
			...design,
			regions: { finder: { outer: { id: 'square' }, inner: { id: 'square-centre' } } },
			logo: null,
		};
		expect(darkInks(noPaint, own)).toEqual(['#000000']);
	});

	it('builds an empty symbol without the encoder', () => {
		const symbol = emptySymbol('3', 'H');
		expect(symbol.version).toBe('3');
		expect(symbol.matrix.width).toBe(29);
		expect(emptySymbol('1').ecLevel).toBe('M');
	});
});
