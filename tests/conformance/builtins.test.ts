/**
 * The gate: every built-in entry passes its conformance checks.
 *
 * Adding a shape, frame, preset or content type that fails here fails the
 * suite, which is the point. A failing entry is cut or fixed, never let through by loosening
 * a rule. The region shapes are checked against every built-in partner of
 * the other part, and the whole pair table is recorded below, so a change
 * that loses a pair shows up as a diff of the table rather than as a
 * mystery in a scan test. The content types are checked against the
 * vectors in `BUILT_IN_VECTORS`, because the types themselves carry none.
 */

import { describe, expect, it } from 'vitest';
import { checkFrame } from '../../src/conformance/frame.js';
import { checkModuleShape } from '../../src/conformance/module-shape.js';
import { checkPayloadType } from '../../src/conformance/payload-type.js';
import { checkPreset, contrast, darkInks, paintInks } from '../../src/conformance/preset.js';
import { checkRegionShape } from '../../src/conformance/region-shape.js';
import { regionPairConforms } from '../../src/design/finder.js';
import { resolveParams } from '../../src/design/params.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { BUILT_IN_PAYLOAD_TYPES } from '../../src/payload/registry.js';
import { BUILT_IN_VECTORS } from '../../src/payload/vectors/index.js';

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

	it('pair as recorded, each ring and centre at its defaults, the QR finder by module family', () => {
		const shapes = registries.regionShapes.list();
		const table: Record<string, Record<string, string[]>> = {};
		const tables = [
			['concentric-7 square', 'concentric-7', 'square'],
			['concentric-7 dot', 'concentric-7', 'dot'],
			['concentric-7 hex', 'concentric-7', 'hex'],
			['concentric-5', 'concentric-5', 'square'],
		] as const;
		for (const [name, kind, family] of tables) {
			table[name] = {};
			for (const outer of shapes.filter((shape) => shape.part === 'outer')) {
				(table[name] as Record<string, string[]>)[outer.id] = shapes
					.filter((inner) => inner.part === 'inner' && inner.kinds.includes(kind))
					.filter((inner) =>
						regionPairConforms(
							outer,
							resolveParams(outer.params, undefined),
							inner,
							resolveParams(inner.params, undefined),
							kind,
							family,
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

// The strict scan check is plugged into the same `checkPreset` hook in
// tests/verify/gate-*.test.ts, split four ways so the presets are checked in
// parallel; here the presets meet the design layer's own rules.
describe('presets', () => {
	for (const preset of registries.presets.list()) {
		it(preset.id, () => {
			expect(checkPreset(preset, null, registries)).toEqual([]);
		});
	}

	it("give a size for every level they allow, the own level's being minSizeMm", () => {
		for (const preset of registries.presets.list()) {
			expect(Object.keys(preset.sizesMm ?? {}).sort(), preset.id).toEqual(
				[...preset.ecLevels].sort(),
			);
			expect(preset.sizesMm?.[preset.design.symbol.ecLevel ?? 'M'], preset.id).toBe(
				preset.minSizeMm,
			);
		}
	});

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

describe('content types', () => {
	for (const type of BUILT_IN_PAYLOAD_TYPES) {
		it(type.id, () => {
			const vectors = BUILT_IN_VECTORS[type.id];
			expect(vectors?.length, 'no vectors to check').toBeGreaterThan(0);
			expect(checkPayloadType(type, vectors)).toEqual([]);
		});
	}
});
