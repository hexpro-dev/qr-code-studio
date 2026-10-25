/**
 * The gate: every built-in entry passes its conformance checks.
 *
 * Adding a shape, frame or preset that fails here fails the suite, which is
 * the point. A failing entry is cut or fixed, never let through by loosening
 * a rule. The region shapes are checked against every built-in partner of
 * the other part, and the whole pair table is recorded below, so a change
 * that loses a pair shows up as a diff of the table rather than as a
 * mystery in a scan test.
 */

import { describe, expect, it } from 'vitest';
import { checkFrame } from '../../src/conformance/frame.js';
import { checkModuleShape } from '../../src/conformance/module-shape.js';
import { checkPreset, contrast, darkInks, paintInks } from '../../src/conformance/preset.js';
import { checkRegionShape } from '../../src/conformance/region-shape.js';
import { regionPairConforms } from '../../src/design/finder.js';
import { resolveParams } from '../../src/design/params.js';
import { createDesignRegistries } from '../../src/design/registries.js';

const registries = createDesignRegistries();

describe('module shapes', () => {
	for (const shape of registries.moduleShapes.list()) {
		it(shape.id, () => {
			expect(checkModuleShape(shape)).toEqual([]);
		});
	}
});

describe('region shapes', () => {
	for (const shape of registries.regionShapes.list()) {
		it(shape.id, () => {
			expect(checkRegionShape(shape)).toEqual([]);
		});
	}

	it('pair as recorded, each ring and centre at its defaults', () => {
		const shapes = registries.regionShapes.list();
		const table: Record<string, Record<string, string[]>> = {};
		for (const kind of ['concentric-7', 'concentric-5'] as const) {
			table[kind] = {};
			for (const outer of shapes.filter((shape) => shape.part === 'outer')) {
				(table[kind] as Record<string, string[]>)[outer.id] = shapes
					.filter((inner) => inner.part === 'inner' && inner.kinds.includes(kind))
					.filter((inner) =>
						regionPairConforms(
							outer,
							resolveParams(outer.params, undefined),
							inner,
							resolveParams(inner.params, undefined),
							kind,
						),
					)
					.map((inner) => inner.id);
			}
		}
		expect(table).toMatchSnapshot();
	});
});

describe('frames', () => {
	for (const frame of registries.frames.list()) {
		it(frame.id, () => {
			expect(checkFrame(frame)).toEqual([]);
		});
	}
});

describe('presets', () => {
	for (const preset of registries.presets.list()) {
		it(preset.id, () => {
			expect(checkPreset(preset, null, registries)).toEqual([]);
		});
	}

	it('aim for 7:1 and all but a few reach it', () => {
		const under: string[] = [];
		for (const preset of registries.presets.list()) {
			const grounds = paintInks(preset.design.background!, registries);
			const worst = Math.min(
				...darkInks(preset.design, registries).flatMap((dark) =>
					grounds.map((ground) => contrast(dark, ground)),
				),
			);
			if (worst < 7) under.push(preset.id);
		}
		expect(under).toEqual([]);
	});
});
