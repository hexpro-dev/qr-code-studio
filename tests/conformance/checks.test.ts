/**
 * The conformance checks catch what they are for: each rule, broken on
 * purpose by an entry made to break it.
 */

import { describe, expect, it } from 'vitest';
import { checkFrame } from '../../src/conformance/frame.js';
import { checkModuleShape } from '../../src/conformance/module-shape.js';
import { checkPayloadType } from '../../src/conformance/payload-type.js';
import type { PayloadTypeLike, PayloadVectorLike } from '../../src/conformance/payload-type.js';
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
import { QrStudioError } from '../../src/core/errors.js';
import { issue } from '../../src/core/issue.js';
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
const circleRing = registries.regionShapes.require('circle');
const circleCentre = registries.regionShapes.require('circle-centre');
const octagonCentre = registries.regionShapes.require('octagon-centre');

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

	it('finds a ring that traces as something other than it says', () => {
		// A circle that leaves its kind unsaid is taken as cornered, and the
		// strict reader traces it as round.
		const quiet: RegionShape = { ...circleRing, id: 'quiet-circle' };
		delete (quiet as { ringKind?: unknown }).ringKind;
		const found = checkRegionShape(quiet);
		expect(rules(found)).toEqual(['ring-kind']);
		expect(found[0]?.detail).toContain('says it is cornered');
		expect(found[0]?.detail).toContain('traces it as round');
		// A square ring that says it is a ring of dots is held to that too.
		const said: RegionShape = { ...squareRing, id: 'said-dotted', ringKind: 'dotted' };
		const dotted = checkRegionShape(said, { partners: [squareCentre] });
		expect(rules(dotted)).toEqual(['ring-kind']);
		expect(dotted[0]?.detail).toContain('traces it as cornered');
		// And one that draws too little to measure at all.
		const speck: RegionShape = {
			...said,
			id: 'speck',
			path: ({ kind, params }, out) => {
				if (kind === 'corner-l') squareRing.path({ kind, params }, out);
				else out.rect(0, 0, 0.5, 0.5);
			},
		};
		const unmeasured = checkRegionShape(speck, { partners: [squareCentre] });
		expect(unmeasured.find((v) => v.rule === 'ring-kind')?.detail).toContain(
			'traces it as nothing it can measure',
		);
		// A centre is not blamed for how its partner's ring traces.
		expect(checkRegionShape(circleCentre, { partners: [quiet] })).toEqual([]);
	});

	it('finds a pair the runs measured here accept and the strict reader misses', () => {
		// The octagon centre at a cut of 0.4, below its range: inside the round
		// ring its diagonals pass the design layer's runs, and the strict
		// search misses the pair at 6 pixels a module.
		const deep: RegionShape = {
			...octagonCentre,
			id: 'deep-cut',
			params: [],
			path: ({ kind }, out) => octagonCentre.path({ kind, params: { cut: 0.4 } }, out),
		};
		const found = checkRegionShape(deep, { partners: [circleRing] });
		expect(rules(found)).toEqual(['finder', 'strict-finder']);
		expect(found.find((v) => v.rule === 'strict-finder')?.detail).toContain('6 px');
		// With a ring the strict reader finds it in, the centre has a partner,
		// and the miss with the round ring is still its violation.
		expect(rules(checkRegionShape(deep, { partners: [circleRing, squareRing] }))).toEqual([
			'strict-finder',
		]);
	});

	it('asks a ring of dots only to be one, and never pairs it as the QR finder', () => {
		const dots = registries.regionShapes.require('dot-ring');
		expect(checkRegionShape(dots)).toEqual([]);
		// With no partners, only the sub-finder misses one: as the finder it
		// needs none, and there is no centre to measure it round.
		const alone = checkRegionShape(dots, { partners: [] });
		expect(rules(alone)).toEqual(['finder']);
		expect(alone.every((v) => v.detail.includes('concentric-5:'))).toBe(true);
		// A centre is never asked to pair with it there.
		expect(checkRegionShape(squareCentre, { partners: [dots] }).map((v) => v.rule)).toEqual([
			'finder',
		]);
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
		// With no finder style of its own, the square finder is drawn.
		expect(checkPreset({ ...preset, design: { ...preset.design, regions: {} } })).toEqual([]);
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

	it('finds a finder ring that is round or dotted, or traces otherwise than it says', () => {
		const withRing = (outer: string, inner: string): Preset => ({
			...preset,
			design: {
				...preset.design,
				regions: { finder: { outer: { id: outer }, inner: { id: inner } } },
			},
		});
		const round = checkPreset(withRing('circle', 'circle-centre'), null, registries);
		expect(round.map((v) => v.detail)).toEqual([
			'validation reports design.issue.ring-round at regions.finder.outer',
		]);
		const dotted = checkPreset(withRing('dot-ring', 'square-centre'), null, registries);
		expect(dotted.map((v) => v.detail)).toEqual([
			'validation reports design.issue.ring-not-traceable at regions.finder.outer',
		]);
		// A round ring that does not say so validates cleanly, and the strict
		// reader's own measure finds it out.
		const own = createDesignRegistries();
		const quiet: RegionShape = { ...circleRing, id: 'quiet-circle' };
		delete (quiet as { ringKind?: unknown }).ringKind;
		own.regionShapes.register(quiet);
		const found = checkPreset(withRing('quiet-circle', 'circle-centre'), null, own);
		expect(rules(found)).toEqual(['finder']);
		expect(found[0]?.detail).toContain('traces it as round');
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

describe('checkPayloadType', () => {
	type Value = { readonly name: string; readonly tags: readonly string[] };

	/** A content type that writes `NOTE:<name>|<tag>,<tag>` and reads it back, done properly. */
	function noteType(overrides: Partial<PayloadTypeLike<Value>> = {}): PayloadTypeLike<Value> {
		return {
			id: 'note',
			validate: (value) => (value.name === '' ? [issue('example.empty', ['fields', 'name'])] : []),
			build: (value) => {
				if (value.name === '') throw new TypeError('a value with error issues');
				return { text: `NOTE:${value.name}|${value.tags.join(',')}` };
			},
			parse: (text) => {
				const match = /^NOTE:([^|]*)\|(.*)$/.exec(text);
				if (match === null) {
					throw new QrStudioError('payload/unparseable', 'not a note', { type: 'note' });
				}
				const tags = match[2] as string;
				return { name: match[1] as string, tags: tags === '' ? [] : tags.split(',') };
			},
			...overrides,
		};
	}

	const vector = (
		text: string,
		value: Value,
		source = 'Example specification, section 1',
	): PayloadVectorLike<Value> => ({
		text,
		value,
		source,
	});
	const good = vector('NOTE:Example|a,b', { name: 'Example', tags: ['a', 'b'] });

	it('passes a type that reads and writes its vectors, its own or the ones it is given', () => {
		expect(checkPayloadType(noteType(), [good])).toEqual([]);
		// Left out, the vectors come from the type, which is how a type from
		// outside this package carries them.
		expect(checkPayloadType(noteType({ vectors: [good] }))).toEqual([]);
		// Given, they replace the type's own.
		const wrong = vector('NOTE:Other|', { name: 'Example', tags: [] });
		expect(checkPayloadType(noteType({ vectors: [wrong] }), [good])).toEqual([]);
		expect(rules(checkPayloadType(noteType({ vectors: [wrong] })))).toEqual(['vector-parse']);
		// A type with no vectors anywhere has nothing to check.
		expect(checkPayloadType(noteType())).toEqual([]);
		expect(checkPayloadType(noteType({ vectors: [good] }), [])).toEqual([]);
	});

	it('finds a vector that cites nothing', () => {
		const found = checkPayloadType(noteType(), [good, { ...good, source: '  ' }]);
		expect(found).toEqual([
			{ entry: 'note', rule: 'vector-source', detail: 'vector 1 cites no source' },
		]);
	});

	it('finds a vector that reads as some other value, and names the fields but not their content', () => {
		const found = checkPayloadType(noteType(), [
			vector('NOTE:Secret|x', { name: 'Example', tags: ['x'] }),
			vector('NOTE:Example|x,y', { name: 'Example', tags: ['x'] }),
		]);
		expect(found.map((violation) => violation.rule)).toEqual(['vector-parse', 'vector-parse']);
		expect(found[0]?.detail).toBe('vector 0 reads as a different value (fields name)');
		expect(found[1]?.detail).toBe('vector 1 reads as a different value (fields tags)');
		expect(JSON.stringify(found)).not.toContain('Secret');
		const scalar = noteType({ parse: () => 'just text' as unknown as Value });
		expect(checkPayloadType(scalar, [good])[0]?.detail).toBe(
			'vector 0 reads as a different value (not a record)',
		);
	});

	it('finds a vector that does not read, and says what was thrown without its message', () => {
		const unreadable = vector('NOT A NOTE', { name: 'Example', tags: [] });
		expect(checkPayloadType(noteType(), [unreadable])).toEqual([
			{
				entry: 'note',
				rule: 'vector-parse',
				detail: 'vector 0 does not read: parse threw QrStudioError payload/unparseable',
			},
		]);
		const plain = noteType({
			parse: () => {
				throw new RangeError('NOT A NOTE was here');
			},
		});
		const detail = checkPayloadType(plain, [unreadable]).map((violation) => violation.detail);
		expect(detail[0]).toBe('vector 0 does not read: parse threw RangeError');
		expect(detail.join()).not.toContain('NOT A NOTE');
		const odd = noteType({
			parse: () => {
				throw 'NOT A NOTE';
			},
		});
		expect(checkPayloadType(odd, [unreadable])[0]?.detail).toBe(
			'vector 0 does not read: parse threw a non-error value',
		);
	});

	it('holds a vector that does not validate to reading, and to build refusing it', () => {
		// The shape of BIP 21's example: a published text that fails its own
		// check. Reading it is still required, writing it is not.
		const broken = vector('NOTE:|a', { name: '', tags: ['a'] });
		expect(checkPayloadType(noteType(), [broken])).toEqual([]);
		const writesAnyway = noteType({ build: (value) => ({ text: `NOTE:${value.name}|` }) });
		expect(checkPayloadType(writesAnyway, [broken])).toEqual([
			{
				entry: 'note',
				rule: 'vector-build',
				detail: 'vector 0: build returned a text for a value with error issues, not a TypeError',
			},
		]);
		const wrongError = noteType({
			build: () => {
				throw new Error('no');
			},
		});
		expect(checkPayloadType(wrongError, [broken])[0]?.detail).toBe(
			'vector 0: build threw Error for a value with error issues, not a TypeError',
		);
	});

	it('holds a type that cannot be made to refusing every value', () => {
		const readOnly = noteType({
			generate: false,
			build: () => {
				throw new TypeError('This type is read only.');
			},
		});
		expect(checkPayloadType(readOnly, [good])).toEqual([]);
		expect(checkPayloadType(noteType({ generate: false }), [good])).toEqual([
			{
				entry: 'note',
				rule: 'vector-build',
				detail: 'vector 0: build returned a text for a type that cannot be made, not a TypeError',
			},
		]);
	});

	it('finds a value that does not survive being written and read back', () => {
		const lossy = noteType({ build: (value) => ({ text: `NOTE:${value.name}|` }) });
		expect(checkPayloadType(lossy, [good])).toEqual([
			{
				entry: 'note',
				rule: 'vector-round-trip',
				detail: 'vector 0: what build writes reads back differently (fields tags)',
			},
		]);
		const garbled = noteType({ build: () => ({ text: 'garbled' }) });
		expect(checkPayloadType(garbled, [good])).toEqual([
			{
				entry: 'note',
				rule: 'vector-round-trip',
				detail: 'vector 0: writing and reading back threw QrStudioError payload/unparseable',
			},
		]);
	});

	it('compares values as the suite does: no key and an undefined one agree, and 0 is not -0', () => {
		type Loose = { readonly n: number; readonly extra?: string; readonly list: readonly string[] };
		const loose = (parsed: Loose): PayloadTypeLike<Loose> => ({
			id: 'loose',
			generate: false,
			validate: () => [],
			build: () => {
				throw new TypeError('read only');
			},
			parse: () => parsed,
		});
		const check = (parsed: Loose, value: Loose) =>
			checkPayloadType(loose(parsed), [{ text: 'x', value, source: 'Example specification' }]);
		expect(check({ n: 1, extra: undefined, list: [] }, { n: 1, list: [] })).toEqual([]);
		expect(check({ n: Number.NaN, list: ['a'] }, { n: Number.NaN, list: ['a'] })).toEqual([]);
		expect(rules(check({ n: -0, list: [] }, { n: 0, list: [] }))).toEqual(['vector-parse']);
		expect(rules(check({ n: 1, list: ['a'] }, { n: 1, list: ['b'] }))).toEqual(['vector-parse']);
		const notAList = { n: 1, list: { 0: 'a', length: 1 } } as unknown as Loose;
		expect(rules(check(notAList, { n: 1, list: ['a'] }))).toEqual(['vector-parse']);
		const nothing = { n: 1, list: null } as unknown as Loose;
		expect(rules(check(nothing, { n: 1, list: [] }))).toEqual(['vector-parse']);
	});
});
