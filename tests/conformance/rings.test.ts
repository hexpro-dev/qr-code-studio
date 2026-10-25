/**
 * The catalogue's finder rings as the strict reader takes them, measured by
 * its own tests (`ringKind`, `strictFindsFinder`) over a wider grid than the
 * conformance checks use: 5, 6, 8 and 11 pixels a module, four sub-pixel
 * phases, square and rolled 3 degrees.
 *
 * The circle is round, which zxing-cpp loses at a slant, so the validator
 * warns where it is chosen; the ring of dots is dotted, which it loses
 * anywhere, so the validator refuses it as a QR finder and no centre pairs
 * with it there; every other ring is cornered.
 */

import { describe, expect, it } from 'vitest';
import {
	STRICT_PHASES,
	finderPicture,
	measureRingKind,
	pictureRingKind,
	strictFinderProblems,
} from '../../src/conformance/finder.js';
import { sampleParams } from '../../src/conformance/sample.js';
import { defaultDesign } from '../../src/design/document.js';
import { regionPairConforms, ringKindOf } from '../../src/design/finder.js';
import { resolveParams } from '../../src/design/params.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { QrDesignV1, RegionShape } from '../../src/design/types.js';
import { validateDesign } from '../../src/design/validate.js';

const registries = createDesignRegistries();
const shapes = registries.regionShapes.list();
const rings = shapes.filter((s) => s.part === 'outer' && s.kinds.includes('concentric-7'));
const centres = shapes.filter((s) => s.part === 'inner' && s.kinds.includes('concentric-7'));
const squareCentre = registries.regionShapes.require('square-centre');
const DENSITIES = [5, 6, 8, 11];
const wide = { densities: DENSITIES, phases: STRICT_PHASES };

function withFinder(outer: string, inner: string): QrDesignV1 {
	return {
		...defaultDesign(),
		regions: { finder: { outer: { id: outer }, inner: { id: inner } } },
	};
}

const defaults = (shape: RegionShape) => resolveParams(shape.params, undefined);

describe("the catalogue's rings, as the strict reader traces them", () => {
	it('find the circle round, and the validator warns about it as the QR finder', () => {
		const circle = registries.regionShapes.require('circle');
		expect(ringKindOf(circle)).toBe('round');
		for (const centre of centres) {
			expect(measureRingKind(circle, {}, centre, defaults(centre), wide), centre.id).toBe('round');
		}
		const { design, issues } = validateDesign(withFinder('circle', 'circle-centre'), registries);
		expect(design).not.toBeNull();
		expect(issues).toEqual([
			{
				code: 'design.issue.ring-round',
				path: ['regions', 'finder', 'outer'],
				severity: 'warning',
			},
		]);
	});

	it('find the ring of dots dotted, refused as a QR finder whatever its centre', () => {
		const dots = registries.regionShapes.require('dot-ring');
		expect(ringKindOf(dots)).toBe('dotted');
		for (const params of sampleParams(dots.params)) {
			expect(measureRingKind(dots, params, squareCentre, {}, wide), JSON.stringify(params)).toBe(
				'dotted',
			);
		}
		for (const centre of centres) {
			expect(
				regionPairConforms(dots, defaults(dots), centre, defaults(centre), 'concentric-7'),
				centre.id,
			).toBe(false);
			const { design, issues } = validateDesign(withFinder('dot-ring', centre.id), registries);
			expect(design, centre.id).toBeNull();
			expect(issues.map((found) => `${found.severity} ${found.code}`)).toEqual([
				'error design.issue.ring-not-traceable',
			]);
		}
	});

	it('find every other ring cornered, at every setting, density and phase', () => {
		const others = rings.filter((ring) => ring.id !== 'circle' && ring.id !== 'dot-ring');
		expect(others.length).toBeGreaterThan(5);
		const wrong: string[] = [];
		for (const ring of others) {
			expect(ringKindOf(ring), ring.id).toBe('cornered');
			for (const params of sampleParams(ring.params)) {
				const kind = measureRingKind(ring, params, squareCentre, {}, wide);
				if (kind !== 'cornered') wrong.push(`${ring.id} ${JSON.stringify(params)}: ${kind}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	for (const modulePixels of DENSITIES) {
		it(`find every pair the design layer accepts at ${modulePixels} pixels a module, each phase and a small roll`, () => {
			let pairs = 0;
			const missed: string[] = [];
			for (const ring of rings) {
				for (const centre of centres) {
					if (!regionPairConforms(ring, defaults(ring), centre, defaults(centre), 'concentric-7')) {
						continue;
					}
					pairs += 1;
					const problems = strictFinderProblems(ring, defaults(ring), centre, defaults(centre), {
						densities: [modulePixels],
						rolls: [0, 3],
					});
					if (problems.length > 0) {
						missed.push(`${ring.id} + ${centre.id}: ${problems.map((p) => p.detail).join('; ')}`);
					}
				}
			}
			expect(pairs).toBeGreaterThan(30);
			expect(missed).toEqual([]);
		});
	}
});

describe('the strict measure of a ring', () => {
	it('draws the pair on white, centred where it says', () => {
		const square = registries.regionShapes.require('square');
		const picture = finderPicture(square, {}, squareCentre, {}, 6, 0.5);
		expect(picture.grey.width).toBe(13 * 6);
		expect(picture.centre).toBeCloseTo((3 + 0.5 / 6 + 3.5) * 6, 9);
		// The corner of the white margin, and the middle of the centre.
		expect(picture.grey.data[0]).toBe(255);
		const middle = Math.floor(picture.centre);
		expect(picture.grey.data[middle * picture.grey.width + middle]).toBe(0);
		expect(pictureRingKind(picture, 6)).toBe('cornered');
	});

	it('cannot measure a ring that draws nothing, and says so', () => {
		const square = registries.regionShapes.require('square');
		const nothing: RegionShape = { ...square, id: 'nothing', path: () => undefined };
		expect(measureRingKind(nothing, {}, squareCentre, {})).toBeNull();
		const problems = strictFinderProblems(nothing, {}, squareCentre, {}, { rolls: [0, 3] });
		expect(problems.map((p) => p.rule)).toEqual(['ring-kind', 'strict-finder']);
		expect(problems[0]?.detail).toContain('traces it as nothing it can measure');
		expect(problems[1]?.detail).toContain('8 px phase 0.75 roll 3');
	});

	it('calls a ring unsteady when the densities and phases disagree about it', () => {
		// A ring that is drawn round and square by turns.
		const square = registries.regionShapes.require('square');
		const circle = registries.regionShapes.require('circle');
		let calls = 0;
		const fickle: RegionShape = {
			...square,
			id: 'fickle',
			path: (ctx, out) => {
				calls += 1;
				(calls % 2 === 0 ? circle : square).path(ctx, out);
			},
		};
		expect(measureRingKind(fickle, {}, squareCentre, {})).toBe('unsteady');
	});
});
