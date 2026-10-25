/**
 * The contract every entry point of the geometry and render layers meets on
 * input nobody vetted: it returns, or it throws a TypeError. Nothing else
 * escapes (no RangeError from a stack, no NaN written into an SVG), and every
 * call finishes.
 *
 * Scenes arrive from design files and from a worker's structured clone, so
 * every field here can be missing, the wrong type, NaN, an infinity, or a
 * finite number large enough to overflow on the way to device pixels.
 */

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { flattenPath } from '../../src/geometry/flatten.js';
import { area, bounds } from '../../src/geometry/measure.js';
import { PathBuilder } from '../../src/geometry/path.js';
import type { Path } from '../../src/geometry/path.js';
import { traceGrid } from '../../src/geometry/trace.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { Scene } from '../../src/render/types.js';
import { startWatchdog } from '../fuzz/watchdog.js';

const watchdog = startWatchdog();
afterAll(async () => {
	await watchdog.stop();
});

const awkward = fc.constantFrom(
	Number.NaN,
	Infinity,
	-Infinity,
	0,
	-0,
	1e308,
	-1e308,
	5e-324,
	1e15,
	-1e15,
	0.5,
	255,
	256,
);
const number = fc.oneof(
	{ weight: 6, arbitrary: fc.double({ min: -40, max: 40, noNaN: true }) },
	{ weight: 2, arbitrary: fc.integer({ min: -5, max: 300 }) },
	{ weight: 1, arbitrary: awkward },
	{ weight: 1, arbitrary: fc.double() },
);
const anything = fc.oneof(
	number,
	fc.string({ maxLength: 4 }),
	fc.constant(null),
	fc.constant(undefined),
	fc.boolean(),
);

/**
 * Mostly well formed values, so the fuzz reaches past the first check and
 * into the drawing code, with a few that are not. `rare` is the share of
 * each field that is something else entirely.
 */
function mostly<T>(good: fc.Arbitrary<T>, rare = 1, weight = 40): fc.Arbitrary<T> {
	return fc.oneof(
		{ weight, arbitrary: good },
		{ weight: rare, arbitrary: anything as fc.Arbitrary<never> },
	);
}

/** Coordinates: mostly small, sometimes far enough out to overflow, rarely not numbers at all. */
const coordinate = fc.oneof(
	{ weight: 240, arbitrary: fc.double({ min: -40, max: 40, noNaN: true }) },
	{ weight: 2, arbitrary: fc.constantFrom(1e15, -1e15, 1e300, -1e308, 5e-324) },
	{ weight: 1, arbitrary: fc.constantFrom(Number.NaN, Infinity, -Infinity) },
);

const path: fc.Arbitrary<Path> = fc.oneof(
	{
		weight: 30,
		arbitrary: fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 10 }).chain((commands) => {
			const count = commands.reduce((sum, c) => sum + [2, 2, 4, 6, 0][c]!, 0);
			return fc.array(coordinate, { minLength: count, maxLength: count }).map((points) => ({
				commands: Uint8Array.from(commands),
				points: Float64Array.from(points),
			}));
		}),
	},
	{
		weight: 1,
		arbitrary: fc
			.record({
				commands: fc.array(fc.integer({ min: -1, max: 6 }), { maxLength: 6 }),
				points: fc.array(number, { maxLength: 14 }),
			})
			.map(({ commands, points }) => ({
				commands: Uint8Array.from(commands.map((c) => c & 255)),
				points: Float64Array.from(points),
			})),
	},
	{ weight: 1, arbitrary: anything as fc.Arbitrary<never> },
);

const channel = mostly(fc.integer({ min: 0, max: 255 }), 1, 120);
const alpha = mostly(fc.double({ min: 0, max: 1, noNaN: true }), 1, 120);
const colour = mostly(fc.record({ r: channel, g: channel, b: channel, a: alpha }));
const finiteish = mostly(fc.double({ min: -40, max: 40, noNaN: true }), 1, 30);
const stops = mostly(fc.array(fc.record({ offset: finiteish, colour }), { maxLength: 5 }));
const paint = fc.oneof(
	{ weight: 10, arbitrary: fc.record({ kind: fc.constant('solid'), colour }) },
	{
		weight: 10,
		arbitrary: fc.record({
			kind: fc.constant('linear'),
			x1: finiteish,
			y1: finiteish,
			x2: finiteish,
			y2: finiteish,
			stops,
		}),
	},
	{
		weight: 10,
		arbitrary: fc.record({
			kind: fc.constant('radial'),
			cx: finiteish,
			cy: finiteish,
			r: mostly(fc.double({ min: 0, max: 40, noNaN: true }), 1, 30),
			stops,
		}),
	},
	{
		weight: 10,
		arbitrary: fc.record({
			kind: fc.constant('conic'),
			cx: finiteish,
			cy: finiteish,
			angle: mostly(fc.double({ min: -1e6, max: 1e6, noNaN: true }), 1, 30),
			stops,
		}),
	},
	{ weight: 1, arbitrary: fc.record({ kind: fc.constantFrom('tartan', 'conic-ish'), colour }) },
	{ weight: 1, arbitrary: anything },
);
const image = mostly(
	fc
		.record({ width: fc.integer({ min: 1, max: 4 }), height: fc.integer({ min: 1, max: 4 }) })
		.chain(({ width, height }) =>
			fc
				.uint8Array({ minLength: width * height * 4, maxLength: width * height * 4 })
				.map((bytes) => ({ width, height, data: new Uint8ClampedArray(bytes) })),
		),
);
const extent = mostly(fc.double({ min: 0, max: 40, noNaN: true }), 1, 30);

const { node } = fc.letrec<{ node: unknown }>((tie) => ({
	node: fc.oneof(
		{ depthSize: 'small', withCrossShrink: true },
		{ weight: 20, arbitrary: fc.record({ kind: fc.constant('path'), path, paint }) },
		{
			weight: 6,
			arbitrary: fc.record(
				{
					kind: fc.constant('image'),
					image,
					x: finiteish,
					y: finiteish,
					width: extent,
					height: extent,
					clip: path,
				},
				{ requiredKeys: ['kind', 'image', 'x', 'y', 'width', 'height'] },
			),
		},
		{
			weight: 6,
			arbitrary: fc.record(
				{
					kind: fc.constant('group'),
					children: fc.array(tie('node'), { maxLength: 3 }),
					clip: path,
					opacity: finiteish,
				},
				{ requiredKeys: ['kind', 'children'] },
			),
		},
		{ weight: 1, arbitrary: anything },
	),
}));

const scene = fc.record(
	{
		width: mostly(fc.double({ min: 0.5, max: 64, noNaN: true })),
		height: mostly(fc.double({ min: 0.5, max: 64, noNaN: true })),
		unitsPerMm: mostly(fc.double({ min: 0.1, max: 20, noNaN: true })),
		background: fc.oneof(fc.constant(null), paint),
		layers: mostly(fc.array(node, { maxLength: 4 })),
		title: mostly(fc.string()),
	},
	{ requiredKeys: ['width', 'height', 'background', 'layers'] },
);

function onlyTypeErrors(run: () => unknown): void {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(TypeError);
	}
}

let label = 0;

describe('the fuzz contract', () => {
	it('rasterise and sceneToSvg return or throw a TypeError, and finish', () => {
		fc.assert(
			fc.property(
				scene,
				fc.integer({ min: 1, max: 20 }),
				fc.option(fc.integer({ min: 1, max: 20 })),
				(input, width, height) => {
					label += 1;
					watchdog.beat(`render scene ${label}`);
					onlyTypeErrors(() =>
						rasterise(input as unknown as Scene, height === null ? { width } : { width, height }),
					);
					onlyTypeErrors(() => {
						const svg = sceneToSvg(input as unknown as Scene);
						expect(svg).not.toMatch(/NaN|Infinity|undefined/);
					});
				},
			),
			{ numRuns: 600, seed: 20261025 },
		);
	});

	it('the geometry entry points return or throw a TypeError, and finish', () => {
		fc.assert(
			fc.property(path, number, number, number, number, (candidate, a, b, c, d) => {
				label += 1;
				watchdog.beat(`geometry ${label}`);
				onlyTypeErrors(() => bounds(candidate));
				onlyTypeErrors(() => area(candidate));
				onlyTypeErrors(() =>
					flattenPath(candidate, { tolerance: 0.25, matrix: [a, 0, 0, a, b, c] }, () => {}),
				);
				onlyTypeErrors(() =>
					new PathBuilder().transform([a, b, c, d, a, b]).append(candidate).build(),
				);
				onlyTypeErrors(() =>
					new PathBuilder().roundedRect(a, b, c, d, [a, b, c, d]).circle(a, b, c).build(),
				);
				onlyTypeErrors(() =>
					traceGrid(
						Math.abs(Math.trunc(a)) % 9,
						Math.abs(Math.trunc(b)) % 9,
						(x, y) => (x * 31 + y * 17 + c) % 3 < 1,
					),
				);
			}),
			{ numRuns: 600, seed: 20261026 },
		);
	});
});
