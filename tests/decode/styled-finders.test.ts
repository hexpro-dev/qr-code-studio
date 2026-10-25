/**
 * The design layer and the strict reader agree about finder patterns.
 *
 * `regionPairConforms` is what the design layer asks before it draws a ring
 * and a centre as a finder: their runs measured along both axes and both
 * diagonals through the exact centre, with sub-pixel edges, at 0.35 of a
 * module. The strict reader measures whole pixels from the nearest pixels to
 * a centre it knows to a fraction of one, so it allows half a module on the
 * diagonals, where that quantisation is worst (see `STRICT_FINDER_TOLERANCE`).
 * Every pair the design layer accepts must therefore be a pattern the strict
 * reader finds, at every density the scan check draws at and every sub-pixel
 * phase and small roll a camera gives it. This holds the two to that, from 5
 * pixels a module. At 4, the density the design layer measures at, one pair
 * (a squircle ring round a circle centre) is missed at one phase and roll of
 * the eight: a whole pixel there is a quarter of a module, most of the slack.
 */

import { describe, expect, it } from 'vitest';
import { toGrey } from '../../src/decode/grey.js';
import { ringKind, strictFindsFinder } from '../../src/decode/strict.js';
import { regionPairConforms, regionPath } from '../../src/design/finder.js';
import { resolveParams } from '../../src/design/params.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { rotate } from '../../src/geometry/matrix.js';
import { rasterise } from '../../src/render/raster.js';
import { designRegistries } from '../helpers/styled.js';

const SPAN = 15;
const AT = 4;

function finderPicture(
	outerId: string,
	innerId: string,
	modulePixels: number,
	phase: number,
	roll: number,
) {
	const shapes = designRegistries().regionShapes;
	const outer = shapes.require(outerId);
	const inner = shapes.require(innerId);
	const offset = AT + phase / modulePixels;
	const both = new PathBuilder()
		.append(regionPath(outer, 'concentric-7', resolveParams(outer.params, {}), offset, offset))
		.append(regionPath(inner, 'concentric-7', resolveParams(inner.params, {}), offset, offset))
		.build();
	const centre = offset + 3.5;
	const turned = new PathBuilder()
		.transform(rotate(roll, centre, centre))
		.append(both)
		.build();
	const image = rasterise(
		{
			width: SPAN,
			height: SPAN,
			background: { kind: 'solid', colour: { r: 1, g: 1, b: 1, a: 1 } },
			layers: [
				{
					kind: 'path',
					path: turned,
					paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
				},
			],
		},
		{ width: SPAN * modulePixels },
	);
	return { image, centre: centre * modulePixels };
}

function conformingPairs(): [string, string][] {
	const shapes = designRegistries().regionShapes.list();
	// A ring of dots is left out: the strict reader refuses it whatever its
	// centre (see finderRingsTraceable), so whether it finds one says nothing.
	const outers = shapes.filter(
		(s) => s.part === 'outer' && s.kinds.includes('concentric-7') && s.id !== 'dot-ring',
	);
	const inners = shapes.filter((s) => s.part === 'inner' && s.kinds.includes('concentric-7'));
	const out: [string, string][] = [];
	for (const o of outers) {
		for (const i of inners) {
			if (
				regionPairConforms(
					o,
					resolveParams(o.params, {}),
					i,
					resolveParams(i.params, {}),
					'concentric-7',
				)
			) {
				out.push([o.id, i.id]);
			}
		}
	}
	return out;
}

describe('finders the design layer accepts, as the strict reader sees them', () => {
	const pairs = conformingPairs();

	it('are a good many of the possible pairs', () => {
		expect(pairs.length).toBeGreaterThan(30);
	});

	for (const modulePixels of [5, 6, 8, 11]) {
		it(`are all found at ${modulePixels} pixels a module, every phase and a small roll`, () => {
			const missed: string[] = [];
			for (const [outer, inner] of pairs) {
				for (const phase of [0, 0.25, 0.5, 0.75]) {
					for (const roll of [0, 3]) {
						const { image, centre } = finderPicture(outer, inner, modulePixels, phase, roll);
						const at = { x: centre, y: centre };
						if (!strictFindsFinder(toGrey(image), at, modulePixels)) {
							missed.push(`${outer} + ${inner}, phase ${phase}, roll ${roll}`);
						}
					}
				}
			}
			expect(missed).toEqual([]);
		});
	}
});

describe("the design layer's rings, as the strict reader takes them", () => {
	it('are cornered but for the circle, which is round, and the ring of dots', () => {
		// Each outer shape round a square centre, square on at 6 and 8 pixels a
		// module, through the grid it was drawn on: what `ringKind` tells the
		// design layer before any photograph. A round ring is refused at a slant
		// or under a smear, a dotted one always (see finderRingsTraceable).
		const shapes = designRegistries().regionShapes;
		const centre = shapes.require('square-centre');
		const kinds = new Map<string, string>();
		for (const outer of shapes
			.list()
			.filter((shape) => shape.part === 'outer' && shape.kinds.includes('concentric-7'))) {
			for (const modulePixels of [6, 8]) {
				const both = new PathBuilder()
					.append(regionPath(outer, 'concentric-7', resolveParams(outer.params, {}), AT, AT))
					.append(regionPath(centre, 'concentric-7', resolveParams(centre.params, {}), AT, AT))
					.build();
				const image = rasterise(
					{
						width: SPAN,
						height: SPAN,
						background: { kind: 'solid', colour: { r: 1, g: 1, b: 1, a: 1 } },
						layers: [
							{
								kind: 'path',
								path: both,
								paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
							},
						],
					},
					{ width: SPAN * modulePixels },
				);
				const m = modulePixels;
				const kind = ringKind(toGrey(image), [m, 0, AT * m, 0, m, AT * m, 0, 0, 1], 3.5, 3.5);
				const before = kinds.get(outer.id);
				kinds.set(outer.id, before === undefined || before === kind ? String(kind) : 'unsteady');
			}
		}
		const round = [...kinds].filter(([, kind]) => kind === 'round').map(([id]) => id);
		const dotted = [...kinds].filter(([, kind]) => kind === 'dotted').map(([id]) => id);
		expect(round).toEqual(['circle']);
		expect(dotted).toEqual(['dot-ring']);
		expect([...kinds.values()].filter((kind) => kind === 'cornered').length).toBe(kinds.size - 2);
	});
});
