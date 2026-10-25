import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { PathBuilder } from '../../src/geometry/path.js';
import type { Path } from '../../src/geometry/path.js';
import { parseColour } from '../../src/render/colour.js';
import { CoverageScratch, EdgeSet, accumulate } from '../../src/render/coverage.js';
import { MAX_PIXELS, rasterise } from '../../src/render/raster.js';
import type { Colour, RgbaImage, Scene, SceneNode, ScenePaint } from '../../src/render/types.js';
import { pointReference, stripReference } from './reference.js';
import type { Polygon } from './reference.js';
import { seeded } from './scenes.js';

const black = parseColour('#000000');
const white = parseColour('#ffffff');

function solid(colour: Colour): ScenePaint {
	return { kind: 'solid', colour };
}

function scene(layers: SceneNode[], size = 4, background: ScenePaint | null = null): Scene {
	return { width: size, height: size, background, layers };
}

function pixel(image: RgbaImage, x: number, y: number): number[] {
	const at = (y * image.width + x) * 4;
	return Array.from(image.data.slice(at, at + 4));
}

/** Coverage of every pixel, straight from the edge set. */
function coverageOf(path: Path, width: number, height: number): Float64Array {
	const edges = EdgeSet.fromPath(path, new CoverageScratch(width), height, 1, 1);
	const out = new Float64Array(width * height);
	const row = new Float64Array(width);
	for (let y = 0; y < height; y += 1) {
		if (!edges.coverage(y, row)) continue;
		for (let x = edges.start; x < edges.end; x += 1) out[y * width + x] = row[x] as number;
	}
	return out;
}

function randomPolygons(random: () => number, size: number): Polygon[] {
	const polygons: Polygon[] = [];
	const count = 1 + Math.floor(random() * 3);
	for (let p = 0; p < count; p += 1) {
		const points: number[] = [];
		const n = 3 + Math.floor(random() * 8);
		// Reaching past every side of the picture, so clipping is exercised too.
		for (let i = 0; i < n; i += 1)
			points.push(random() * (size + 8) - 4, random() * (size + 8) - 4);
		polygons.push(points);
	}
	return polygons;
}

function pathOf(polygons: readonly Polygon[]): Path {
	const builder = new PathBuilder();
	for (const polygon of polygons) builder.polygon([...polygon]);
	return builder.build();
}

describe('coverage', () => {
	it('matches the strip reference within 1/255 for random self-intersecting polygons', () => {
		// Random vertices give crossings, overlaps of the same winding, holes
		// of the opposite winding and slivers, which is everything the nonzero
		// rule has to get right.
		const random = seeded(1);
		const size = 16;
		let worst = 0;
		for (let trial = 0; trial < 80; trial += 1) {
			const polygons = randomPolygons(random, size);
			const ours = coverageOf(pathOf(polygons), size, size);
			const reference = stripReference(polygons, size, size);
			for (let i = 0; i < ours.length; i += 1) {
				worst = Math.max(worst, Math.abs((ours[i] as number) - (reference[i] as number)));
			}
		}
		expect(worst).toBeLessThan(1 / 255);
	});

	it('agrees with a 16 by 16 supersample to within its own sampling error', () => {
		// The point sampled reference is the textbook one and shares nothing
		// with the other two, but it is only good to about 1/32 of a pixel for
		// each edge that crosses the pixel. So it holds the exact coverage to
		// that (two edges' worth at most, in practice) and to a small mean, and
		// the strip reference above is what holds it to 1/255.
		const random = seeded(2);
		const size = 12;
		let worst = 0;
		let total = 0;
		let count = 0;
		for (let trial = 0; trial < 40; trial += 1) {
			const polygons = randomPolygons(random, size);
			const ours = coverageOf(pathOf(polygons), size, size);
			const reference = pointReference(polygons, size, size, 16);
			for (let i = 0; i < ours.length; i += 1) {
				const difference = Math.abs((ours[i] as number) - (reference[i] as number));
				worst = Math.max(worst, difference);
				total += difference;
				count += 1;
			}
		}
		expect(worst).toBeLessThanOrEqual(1 / 16);
		expect((total / count) * 255).toBeLessThan(0.5);
	});

	it('is exactly a half where an edge halves a pixel, in either direction', () => {
		const right = coverageOf(new PathBuilder().rect(0.5, 0, 3.5, 1).build(), 4, 1);
		expect(Array.from(right)).toEqual([0.5, 1, 1, 1]);
		const diagonal = coverageOf(new PathBuilder().polygon([0, 0, 1, 1, 0, 1]).build(), 1, 1);
		expect(diagonal[0]).toBe(0.5);
		const wide = coverageOf(new PathBuilder().polygon([0, 0, 4, 1, 0, 1]).build(), 4, 1);
		expect(Array.from(wide)).toEqual([0.875, 0.625, 0.375, 0.125]);
	});

	it('counts an overlap of two shapes in one outline once', () => {
		const twice = coverageOf(
			new PathBuilder().rect(0.25, 0, 0.5, 1).rect(0.5, 0, 0.5, 1).build(),
			1,
			1,
		);
		expect(twice[0]).toBe(0.75);
	});

	it('leaves a hole wound the other way empty, and a doubled hole filled', () => {
		const ring = new PathBuilder().rect(0, 0, 4, 4).rect(3, 1, -2, 2).build();
		const holed = coverageOf(ring, 4, 4);
		expect(Array.from(holed.slice(4, 8))).toEqual([1, 0, 0, 1]);
		const doubled = new PathBuilder().rect(0, 0, 4, 4).rect(1, 1, 2, 2).build();
		expect(Array.from(coverageOf(doubled, 4, 4).slice(4, 8))).toEqual([1, 1, 1, 1]);
	});

	it('handles geometry beyond every side of the picture', () => {
		const left = coverageOf(new PathBuilder().rect(-100, 0, 100.5, 1).build(), 2, 1);
		expect(Array.from(left)).toEqual([0.5, 0]);
		const across = coverageOf(
			new PathBuilder().polygon([-10, -10, 20, -10, 20, 20, -10, 20]).build(),
			2,
			2,
		);
		expect(Array.from(across)).toEqual([1, 1, 1, 1]);
		const far = coverageOf(
			new PathBuilder().polygon([-1e300, 0.5, 1e300, 0.5, 1e300, 1e300]).build(),
			2,
			2,
		);
		for (const value of far) expect(value).toBeGreaterThanOrEqual(0);
		expect(Array.from(coverageOf(new PathBuilder().rect(5, 5, 1, 1).build(), 2, 2))).toEqual([
			0, 0, 0, 0,
		]);
		// A sliver that ends exactly on the right edge touches nothing.
		expect(
			Array.from(coverageOf(new PathBuilder().polygon([2, 0, 3, 0, 2, 1]).build(), 2, 1)),
		).toEqual([0, 0]);
	});

	it('bounds the work on a tangle of edges crossing in one row, and stays close', () => {
		// Two hundred edges zigzagging across a single pixel row cross each other
		// about ten thousand times, past the split budget, so the rest of the
		// row is sampled in thin strips. Measured: mean error 0.0006 of a pixel.
		const random = seeded(9);
		const points: number[] = [];
		for (let i = 0; i < 200; i += 1) points.push(random() * 10, i % 2 === 0 ? 0.05 : 0.95);
		const ours = coverageOf(new PathBuilder().polygon(points).build(), 10, 1);
		const reference = stripReference([points], 10, 1);
		let total = 0;
		for (let i = 0; i < ours.length; i += 1) {
			expect(ours[i]).toBeGreaterThanOrEqual(0);
			expect(ours[i]).toBeLessThanOrEqual(1);
			total += Math.abs((ours[i] as number) - (reference[i] as number));
		}
		expect(total / ours.length).toBeLessThan(1 / 255);
	});

	it('accumulates a steep and a shallow edge exactly', () => {
		const acc = new Float64Array(6);
		accumulate(acc, 1.25, 1.75, 1, 1);
		expect(Array.from(acc)).toEqual([0, 0.5, 0.5, 0, 0, 0]);
		const shallow = new Float64Array(6);
		accumulate(shallow, 0, 4, 1, 1);
		let sum = 0;
		const covered = Array.from(shallow).map((value) => (sum += value));
		expect(covered).toEqual([0.125, 0.375, 0.625, 0.875, 1, 1]);
	});
});

describe('rasterise', () => {
	it('fills whole pixels with the exact colour', () => {
		const image = rasterise(
			scene([
				{
					kind: 'path',
					path: new PathBuilder().rect(1, 1, 2, 2).build(),
					paint: solid(parseColour('#0b76d9')),
				},
			]),
			{ width: 4 },
		);
		expect(image.width).toBe(4);
		expect(image.height).toBe(4);
		expect(pixel(image, 1, 1)).toEqual([11, 118, 217, 255]);
		expect(pixel(image, 0, 0)).toEqual([0, 0, 0, 0]);
		expect(image.data).toBeInstanceOf(Uint8ClampedArray);
	});

	it('rounds half coverage up, once', () => {
		const image = rasterise(
			scene(
				[{ kind: 'path', path: new PathBuilder().rect(0.5, 0, 1, 1).build(), paint: solid(black) }],
				2,
			),
			{ width: 2 },
		);
		expect(pixel(image, 0, 0)).toEqual([0, 0, 0, 128]);
		expect(pixel(image, 1, 0)).toEqual([0, 0, 0, 128]);
	});

	it('composites layers source over in sRGB, and blends a layer as one region', () => {
		const red = parseColour('#ff000080');
		const left = new PathBuilder().rect(0, 0, 3, 4).build();
		const right = new PathBuilder().rect(1, 0, 3, 4).build();
		const separate = rasterise(
			scene(
				[
					{ kind: 'path', path: left, paint: solid(red) },
					{ kind: 'path', path: right, paint: solid(red) },
				],
				4,
				solid(white),
			),
			{ width: 4 },
		);
		const together = rasterise(
			scene(
				[
					{
						kind: 'path',
						path: new PathBuilder().append(left).append(right).build(),
						paint: solid(red),
					},
				],
				4,
				solid(white),
			),
			{ width: 4 },
		);
		// One layer of 128/255 red over white.
		const once = Math.floor(255 * (1 - 128 / 255) + 0.5);
		expect(pixel(together, 0, 0)).toEqual([255, once, once, 255]);
		expect(pixel(together, 2, 0)).toEqual([255, once, once, 255]);
		// Two layers darken where they overlap.
		const a = 128 / 255;
		const twice = Math.floor(255 * (1 - a) * (1 - a) + 0.5);
		expect(pixel(separate, 2, 0)).toEqual([255, twice, twice, 255]);
	});

	it('isolates a group with an opacity, as SVG does', () => {
		const left = new PathBuilder().rect(0, 0, 3, 4).build();
		const right = new PathBuilder().rect(1, 0, 3, 4).build();
		const group: SceneNode = {
			kind: 'group',
			opacity: 0.5,
			children: [
				{ kind: 'path', path: left, paint: solid(black) },
				{ kind: 'path', path: right, paint: solid(black) },
			],
		};
		const image = rasterise(scene([group], 4, solid(white)), { width: 4 });
		expect(pixel(image, 0, 0)).toEqual(pixel(image, 2, 0));
		expect(pixel(image, 2, 0)).toEqual([128, 128, 128, 255]);
	});

	it('clips a group and an image', () => {
		const clip = new PathBuilder().rect(0, 0, 2, 4).build();
		const image: RgbaImage = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) };
		const clipped = rasterise(
			scene([
				{
					kind: 'group',
					clip,
					children: [
						{ kind: 'path', path: new PathBuilder().rect(0, 0, 4, 2).build(), paint: solid(black) },
					],
				},
				{ kind: 'image', image, x: 0, y: 2, width: 4, height: 2, clip },
			]),
			{ width: 4 },
		);
		expect(pixel(clipped, 1, 0)).toEqual([0, 0, 0, 255]);
		expect(pixel(clipped, 2, 0)).toEqual([0, 0, 0, 0]);
		expect(pixel(clipped, 1, 3)).toEqual([255, 0, 0, 255]);
		expect(pixel(clipped, 2, 3)).toEqual([0, 0, 0, 0]);
		// A clip with nothing in a row leaves the row alone.
		const thin = new PathBuilder().rect(0, 0, 4, 1).build();
		const partial = rasterise(
			scene([
				{
					kind: 'group',
					clip: thin,
					opacity: 0.5,
					children: [
						{ kind: 'path', path: new PathBuilder().rect(0, 0, 4, 4).build(), paint: solid(black) },
					],
				},
				{ kind: 'image', image, x: 0, y: 0, width: 4, height: 4, clip: thin },
			]),
			{ width: 4 },
		);
		expect(pixel(partial, 0, 2)).toEqual([0, 0, 0, 0]);
		expect(pixel(partial, 0, 0)).toEqual([255, 0, 0, 255]);
	});

	it('draws an image at its own size exactly, and between texels bilinearly', () => {
		const data = new Uint8ClampedArray([
			255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 0,
		]);
		const image: RgbaImage = { width: 2, height: 2, data };
		const same = rasterise(scene([{ kind: 'image', image, x: 0, y: 0, width: 2, height: 2 }], 2), {
			width: 2,
		});
		expect(Array.from(same.data)).toEqual([
			255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 0, 0, 0, 0,
		]);
		const strip: RgbaImage = {
			width: 2,
			height: 1,
			data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
		};
		const wide = rasterise(
			{
				width: 4,
				height: 1,
				background: null,
				layers: [{ kind: 'image', image: strip, x: 0, y: 0, width: 4, height: 1 }],
			},
			{ width: 4 },
		);
		// Premultiplied, so fading to transparent keeps the colour: no dark fringe.
		expect(pixel(wide, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(pixel(wide, 1, 0)).toEqual([255, 0, 0, 191]);
		expect(pixel(wide, 2, 0)).toEqual([255, 0, 0, 64]);
		expect(pixel(wide, 3, 0)).toEqual([0, 0, 0, 0]);
		// A box that ends inside a pixel: that pixel's centre is past the image,
		// and it takes the edge texel.
		const four: RgbaImage = {
			width: 4,
			height: 1,
			data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255]),
		};
		const narrow = rasterise(
			{
				width: 2,
				height: 1,
				background: null,
				layers: [{ kind: 'image', image: four, x: 0, y: 0, width: 1.3, height: 1 }],
			},
			{ width: 2 },
		);
		expect(pixel(narrow, 1, 0)).toEqual([0, 0, 255, 77]);
		const late = rasterise(
			{
				width: 2,
				height: 1,
				background: null,
				layers: [{ kind: 'image', image: four, x: 0.7, y: 0, width: 1.3, height: 1 }],
			},
			{ width: 2 },
		);
		expect(pixel(late, 0, 0)).toEqual([0, 0, 0, 77]);
		const shrunk = rasterise(
			scene([{ kind: 'image', image, x: 0.5, y: 0.5, width: 1, height: 1 }], 2),
			{ width: 2 },
		);
		expect(pixel(shrunk, 0, 0)[3]).toBe(64);
	});

	it('refuses a malformed image and leaves out one with no area or an empty clip', () => {
		const good: RgbaImage = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) };
		const node = (overrides: Record<string, unknown>): SceneNode =>
			({ kind: 'image', image: good, x: 0, y: 0, width: 1, height: 1, ...overrides }) as SceneNode;
		const refused = [
			node({ image: null }),
			node({ image: { width: 0, height: 1, data: new Uint8ClampedArray(0) } }),
			node({ image: { width: 1, height: 1.5, data: new Uint8ClampedArray(4) } }),
			node({ image: { width: 1, height: 1, data: [1, 2, 3, 4] } }),
			node({ image: { width: 1, height: 1, data: new Uint8ClampedArray(3) } }),
			node({ width: -1 }),
			node({ height: -1 }),
			node({ x: Number.NaN }),
		];
		for (const layer of refused)
			expect(() => rasterise(scene([layer]), { width: 2 })).toThrow(TypeError);
		// A Uint8Array is as good as a Uint8ClampedArray.
		const plain = node({
			image: { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) },
			width: 4,
			height: 4,
		});
		expect(pixel(rasterise(scene([plain]), { width: 4 }), 0, 0)).toEqual([1, 2, 3, 255]);
		for (const layer of [
			node({ width: 0 }),
			node({ height: 0 }),
			node({ clip: new PathBuilder().build() }),
		]) {
			expect(Array.from(rasterise(scene([layer]), { width: 2 }).data).every((v) => v === 0)).toBe(
				true,
			);
		}
	});

	it('evaluates gradients at pixel centres in user space and pads beyond the ends', () => {
		const stops = [
			{ offset: 0, colour: black },
			{ offset: 1, colour: white },
		];
		const linear = rasterise(scene([], 4, { kind: 'linear', x1: 1, y1: 0, x2: 3, y2: 0, stops }), {
			width: 4,
		});
		expect([0, 1, 2, 3].map((x) => pixel(linear, x, 0)[0])).toEqual([0, 64, 191, 255]);
		const radial = rasterise(scene([], 4, { kind: 'radial', cx: 2, cy: 2, r: 2, stops }), {
			width: 4,
		});
		const t = Math.sqrt(0.5) / 2;
		expect(pixel(radial, 1, 1)[0]).toBe(Math.floor(t * 255 + 0.5));
		// Past the radius the last stop pads out.
		expect(pixel(radial, 0, 0)[0]).toBe(255);
		const hard = rasterise(
			scene([], 4, {
				kind: 'linear',
				x1: 0,
				y1: 0,
				x2: 4,
				y2: 0,
				stops: [
					{ offset: 0, colour: black },
					{ offset: 0.5, colour: black },
					{ offset: 0.5, colour: white },
					{ offset: 1, colour: white },
				],
			}),
			{ width: 4 },
		);
		expect([0, 1, 2, 3].map((x) => pixel(hard, x, 0)[0])).toEqual([0, 0, 255, 255]);
		// Unpremultiplied interpolation: halfway to transparent white is grey.
		const fade = rasterise({ width: 2, height: 1, background: null, layers: [] }, { width: 2 });
		expect(pixel(fade, 0, 0)).toEqual([0, 0, 0, 0]);
		const toClear = rasterise(
			{
				width: 2,
				height: 1,
				background: {
					kind: 'linear',
					x1: 0.5,
					y1: 0,
					x2: 1.5,
					y2: 0,
					stops: [
						{ offset: 0, colour: black },
						{ offset: 1, colour: parseColour('#ffffff00') },
					],
				},
				layers: [],
			},
			{ width: 4 },
		);
		expect(pixel(toClear, 1, 0)).toEqual([64, 64, 64, 191]);
	});

	it('never lets a degenerate gradient or image poison the layers drawn over it', () => {
		const stops = [
			{ offset: 0, colour: black },
			{ offset: 1, colour: white },
		];
		const square = new PathBuilder().rect(0, 0, 4, 4).build();
		const image: RgbaImage = { width: 1, height: 1, data: new Uint8ClampedArray([9, 9, 9, 255]) };
		const under: SceneNode[] = [
			{
				kind: 'path',
				path: square,
				paint: { kind: 'linear', x1: -1e308, y1: 0, x2: 1e308, y2: 0, stops },
			},
			{
				kind: 'path',
				path: square,
				paint: { kind: 'linear', x1: 0, y1: 0, x2: 1e-200, y2: 0, stops },
			},
			{ kind: 'path', path: square, paint: { kind: 'radial', cx: 1e300, cy: 1e300, r: 1, stops } },
			{ kind: 'image', image, x: 0, y: 0, width: 4, height: 1e-310 },
			{ kind: 'image', image, x: -1e308, y: 0, width: 1e308, height: 4 },
		];
		for (const layer of under) {
			const drawn = rasterise(
				scene([layer, { kind: 'path', path: square, paint: solid(parseColour('#0b76d9')) }]),
				{ width: 4 },
			);
			for (let i = 0; i < 16; i += 1)
				expect(pixel(drawn, i % 4, Math.floor(i / 4))).toEqual([11, 118, 217, 255]);
		}
	});

	it('keeps gradients round when the picture is stretched', () => {
		const stops = [
			{ offset: 0, colour: black },
			{ offset: 1, colour: white },
		];
		const image = rasterise(scene([], 4, { kind: 'radial', cx: 2, cy: 2, r: 2, stops }), {
			width: 8,
			height: 4,
		});
		expect(image.height).toBe(4);
		expect(pixel(image, 2, 1)).toEqual(pixel(image, 5, 1));
	});

	it('lays the matte under the background and everything else', () => {
		const image = rasterise(
			scene([
				{
					kind: 'path',
					path: new PathBuilder().rect(0, 0, 2, 4).build(),
					paint: solid(parseColour('#00000080')),
				},
			]),
			{ width: 4, background: white },
		);
		expect(pixel(image, 3, 0)).toEqual([255, 255, 255, 255]);
		expect(pixel(image, 0, 0)).toEqual([127, 127, 127, 255]);
		const translucent = rasterise(scene([]), { width: 1, background: parseColour('#ff000080') });
		expect(pixel(translucent, 0, 0)).toEqual([255, 0, 0, 128]);
	});

	it('works out the height from the aspect ratio, at least one pixel', () => {
		expect(
			rasterise({ width: 3, height: 2, background: null, layers: [] }, { width: 30 }).height,
		).toBe(20);
		expect(
			rasterise({ width: 1000, height: 1, background: null, layers: [] }, { width: 10 }).height,
		).toBe(1);
	});

	it('gives the same bytes every time', () => {
		const path = new PathBuilder()
			.circle(5.3, 4.7, 3.9)
			.roundedRect(1.1, 2.2, 6.6, 3.3, [1, 0.5, 2, 0])
			.build();
		const make = (): RgbaImage =>
			rasterise(
				scene(
					[
						{
							kind: 'path',
							path,
							paint: {
								kind: 'radial',
								cx: 5,
								cy: 5,
								r: 4,
								stops: [
									{ offset: 0, colour: parseColour('#0b76d9') },
									{ offset: 1, colour: parseColour('#9f9f9f80') },
								],
							},
						},
					],
					10,
				),
				{ width: 97 },
			);
		expect(make().data).toEqual(make().data);
	});

	it('refuses options that are not whole positive sizes or a checked colour', () => {
		const empty = scene([]);
		for (const width of [0, -1, 1.5, Number.NaN, Infinity, '4']) {
			expect(() => rasterise(empty, { width: width as number })).toThrow(TypeError);
		}
		for (const height of [0, 2.5, Number.NaN]) {
			expect(() => rasterise(empty, { width: 4, height })).toThrow(TypeError);
		}
		expect(() => rasterise(empty, { width: 4, background: { r: 0, g: 0, b: 0, a: 2 } })).toThrow(
			TypeError,
		);
		expect(() => rasterise(empty, null as never)).toThrow(TypeError);
		expect(() => rasterise(null as never, { width: 4 })).toThrow(TypeError);
	});

	it('refuses a surface too large to allocate with the package error, before allocating it', () => {
		try {
			rasterise(scene([]), { width: 20000, height: 20000 });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).code).toBe('render/surface-too-large');
			expect((error as QrStudioError).params).toEqual({
				width: 20000,
				height: 20000,
				maxPixels: MAX_PIXELS,
			});
		}
	});

	it('writes every fully transparent pixel as zeros', () => {
		const image = rasterise(
			scene([
				{
					kind: 'path',
					path: new PathBuilder().rect(0, 0, 4, 4).build(),
					paint: solid(parseColour('#ff000001')),
				},
			]),
			{ width: 4 },
		);
		expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 1]);
		const faint = rasterise(
			scene([
				{
					kind: 'group',
					opacity: 0.001,
					children: [
						{
							kind: 'path',
							path: new PathBuilder().rect(0, 0, 4, 4).build(),
							paint: solid(parseColour('#ff0000')),
						},
					],
				},
			]),
			{ width: 4 },
		);
		expect(pixel(faint, 0, 0)).toEqual([0, 0, 0, 0]);
	});
});
