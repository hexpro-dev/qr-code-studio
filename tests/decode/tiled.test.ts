/**
 * zxing-cpp's tiled grid, as the strict profile lays it from version 7 (see
 * src/decode/tiled.ts): the walk round a finder's ring, the four sides fitted
 * to it, the corners that come of them, and the grid sampled through them.
 */

import { describe, expect, it, vi } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { PI, cos, hypot, sin } from '../../src/core/math.js';
import { Registry } from '../../src/core/registry.js';
import type { Binarised } from '../../src/decode/binarise.js';
import { decodeImage } from '../../src/decode/decoder.js';
import type { Homography } from '../../src/decode/transform.js';
import {
	TILED_NUDGES,
	finderCorners,
	fitQuadrilateral,
	ringPoints,
	tileCorners,
	tiledGrid,
	tiledGrids,
} from '../../src/decode/tiled.js';
import type { Point } from '../../src/decode/types.js';
import { encode } from '../../src/encode/encode.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import type { SymbologyEntry } from '../../src/symbology/types.js';
import { drawGrid } from '../helpers/draw.js';
import { presets, styledCapture } from '../helpers/styled.js';

function bits(width: number, height: number, dark: (x: number, y: number) => boolean): Binarised {
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) out[y * width + x] = dark(x, y) ? 1 : 0;
	return { width, height, bits: out, threshold: () => 128 };
}

/**
 * A finder of `m` pixels a module with its top left at (ox, oy), every square
 * of it (ring, light ring and centre) with its corners cut by `cut` modules
 * along the diagonal, as an octagon is.
 */
function finderAt(m: number, ox: number, oy: number, cut = 0): (x: number, y: number) => boolean {
	const within = (u: number, v: number, side: number, c: number): boolean =>
		u >= 0 &&
		v >= 0 &&
		u <= side &&
		v <= side &&
		u + v >= c &&
		side - u + v >= c &&
		u + side - v >= c &&
		2 * side - u - v >= c;
	return (x, y) => {
		const u = (x + 0.5 - ox) / m;
		const v = (y + 0.5 - oy) / m;
		const ring = within(u, v, 7, cut) && !within(u - 1, v - 1, 5, (cut * 5) / 7);
		return ring || within(u - 2, v - 2, 3, (cut * 3) / 7);
	};
}

function finder(m: number, o: number, cut = 0): (x: number, y: number) => boolean {
	return finderAt(m, o, o, cut);
}

/** Module coordinates of a point, for a finder of `m` pixels a module at (o, o). */
function modules(p: Point, m: number, o: number): [number, number] {
	return [(p.x - o) / m, (p.y - o) / m];
}

describe('the walk round a ring', () => {
	const m = 6;
	const o = 10;
	const image = bits(80, 80, finder(m, o));
	const centre = { x: o + 3.5 * m, y: o + 3.5 * m };

	it('walks the inner and outer edges of the dark ring all the way round', () => {
		const inner = ringPoints(image, centre, 7 * m, 2, false);
		const outer = ringPoints(image, centre, 7 * m, 3, true);
		expect(inner.length).toBeGreaterThan(4 * 4 * m);
		expect(outer.length).toBeGreaterThan(inner.length);
		// Every point on a dark pixel, next to the light ring or the paper.
		for (const p of [...inner, ...outer]) {
			const [u, v] = modules(p, m, o);
			expect(Math.min(u, v, 7 - u, 7 - v)).toBeLessThan(1);
		}
	});

	it('gives up on a ring with no edge in reach, or off the picture', () => {
		expect(ringPoints(image, centre, 7 * m, 6, false)).toEqual([]);
		// The finder cut by the picture's edge: the walk runs off it.
		const cut = bits(40, 80, finder(m, o));
		expect(ringPoints(cut, centre, 7 * m, 3, true)).toEqual([]);
	});

	it('gives up on a walk that strays past twice the width or goes on too long', () => {
		// A ring with a long arm out of it: the walk follows the arm away.
		const armed = bits(160, 80, (x, y) => finder(m, o)(x, y) || (y >= 30 && y < 32 && x < 150));
		expect(ringPoints(armed, centre, 7 * m, 3, true)).toEqual([]);
		// A ring fine enough that its walk is longer than the width allows.
		expect(ringPoints(image, centre, 8, 3, true)).toEqual([]);
	});

	it('gives up at a dead end, and on an edge that does not go round the centre', () => {
		// One dark pixel to the right of a light centre: the walk is boxed in.
		const speck = bits(20, 20, (x, y) => x === 14 && y === 10);
		expect(ringPoints(speck, { x: 10.5, y: 10.5 }, 10, 1, false)).toEqual([]);
		// A blob beside the centre: the walk closes round the blob, not round the centre.
		const blob = bits(30, 30, (x, y) => x >= 14 && x < 20 && y >= 8 && y < 14);
		expect(ringPoints(blob, { x: 10.5, y: 10.5 }, 10, 1, false)).toEqual([]);
		// An edge through the centre's own pixel.
		const half = bits(30, 30, (x, y) => (x >= 12 && y >= 10 && y < 20) || (x === 10 && y === 10));
		expect(ringPoints(half, { x: 10.5, y: 10.5 }, 10, 2, false)).toEqual([]);
	});
});

describe('the four sides fitted to a walk', () => {
	const square: Point[] = [];
	for (let i = 0; i < 10; i += 1) square.push({ x: 10, y: i });
	for (let i = 10; i > 0; i -= 1) square.push({ x: i, y: 10 });
	for (let i = 10; i > 0; i -= 1) square.push({ x: 0, y: i });
	for (let i = 0; i < 10; i += 1) square.push({ x: i, y: 0 });
	const centre = { x: 5, y: 5 };

	it('puts the corners where the sides meet', () => {
		const corners = fitQuadrilateral(centre, square);
		expect(corners).not.toBeNull();
		const rounded = corners!.map((p) => [
			Math.round(p.x * 100) / 100 + 0,
			Math.round(p.y * 100) / 100 + 0,
		]);
		for (const corner of [
			[10, 10],
			[0, 10],
			[0, 0],
			[10, 0],
		]) {
			expect(rounded).toContainEqual(corner);
		}
	});

	it('refuses a circle, a side that wanders and a side with nothing on it', () => {
		const circle: Point[] = [];
		for (let i = 0; i < 64; i += 1) {
			const t = (i / 64) * 2 * PI;
			circle.push({ x: 5 + 5 * cos(t), y: 5 + 5 * sin(t) });
		}
		expect(fitQuadrilateral(centre, circle)).toBeNull();
		// One point three pixels out from the middle of a side 20 long: more than
		// the eighth of its length a side's points may stray.
		const large: Point[] = [];
		for (let i = 0; i < 20; i += 1) large.push({ x: i === 10 ? 23 : 20, y: i });
		for (let i = 20; i > 0; i -= 1) large.push({ x: i, y: 20 });
		for (let i = 20; i > 0; i -= 1) large.push({ x: 0, y: i });
		for (let i = 0; i < 20; i += 1) large.push({ x: i, y: 0 });
		expect(fitQuadrilateral({ x: 10, y: 10 }, large)).toBeNull();
		// Eight points round a square, the first side with one point between
		// its corners: no line through one point.
		const sparse = [
			{ x: 10.5, y: 10.5 },
			{ x: 5, y: 10 },
			{ x: 0, y: 10 },
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 5 },
			{ x: 10, y: 8 },
		];
		expect(fitQuadrilateral(centre, sparse)).toBeNull();
	});
});

describe("a finder's corners", () => {
	it('lands on the centres of the corner modules of a square ring', () => {
		for (const m of [4, 6]) {
			const o = 10;
			const image = bits(80, 80, finder(m, o));
			const corners = finderCorners(image, { x: o + 3.5 * m, y: o + 3.5 * m }, 7 * m);
			const found = corners!.map((p) => modules(p, m, o).map((c) => Math.round(c * 100) / 100 + 0));
			for (const corner of [
				[0.5, 0.5],
				[6.5, 0.5],
				[6.5, 6.5],
				[0.5, 6.5],
			]) {
				expect(found, `${m} pixels a module`).toContainEqual(corner);
			}
		}
	});

	it('lands a fifth of a module or more away on an octagon, at any density', () => {
		for (const m of [4, 6, 10]) {
			const o = 10;
			const image = bits(100, 100, finder(m, o, 1));
			const corners = finderCorners(image, { x: o + 3.5 * m, y: o + 3.5 * m }, 7 * m);
			const worst = Math.max(
				...corners!.map((p) => {
					const [u, v] = modules(p, m, o);
					return Math.min(
						...[
							[0.5, 0.5],
							[6.5, 0.5],
							[6.5, 6.5],
							[0.5, 6.5],
						].map(([a, b]) => hypot(u - a!, v - b!)),
					);
				}),
			);
			expect(worst, `${m} pixels a module`).toBeGreaterThan(0.2);
		}
	});

	it('refuses a ring whose inner or outer edge does not fit', () => {
		const m = 6;
		const o = 10;
		const centre = { x: o + 3.5 * m, y: o + 3.5 * m };
		// Corners cut deep: the inner edge's sides wander off their lines.
		expect(finderCorners(bits(80, 80, finder(m, o, 2)), centre, 7 * m)).toBeNull();
		// The outer edge led away by a bar joined to it: its walk strays out of reach.
		const barred = bits(160, 80, (x, y) => finder(m, o)(x, y) || (y >= 30 && y < 32 && x >= 52));
		expect(finderCorners(barred, centre, 7 * m)).toBeNull();
		// A ring four times as wide as it is tall: no plausible square.
		const long = bits(80, 40, (x, y) => {
			const d = Math.max(Math.abs(x - 40) / 4, Math.abs(y - 20));
			return d < 3 || (d >= 6 && d < 9);
		});
		expect(finderCorners(long, { x: 40.5, y: 20.5 }, 40)).toBeNull();
	});
});

/** A version 7 symbol drawn straight into a thresholded picture, `m` pixels a module. */
function drawn(m: number, cut = 0) {
	const matrix = encode('https://example.com/tiles', {
		ecLevel: 'M',
		minVersion: '7',
		maxVersion: '7',
	}).matrix;
	const size = matrix.width;
	const quiet = 4;
	const image = bits((size + 2 * quiet) * m, (size + 2 * quiet) * m, (x, y) => {
		const u = Math.floor(x / m) - quiet;
		const v = Math.floor(y / m) - quiet;
		for (const [fu, fv] of [
			[0, 0],
			[size - 7, 0],
			[0, size - 7],
		] as const) {
			if (u >= fu && u < fu + 7 && v >= fv && v < fv + 7) {
				return finderAt(m, (quiet + fu) * m, (quiet + fv) * m, cut)(x, y);
			}
		}
		return u >= 0 && v >= 0 && u < size && v < size && matrix.get(u, v) === 1;
	});
	const transform: Homography = [m, 0, quiet * m, 0, m, quiet * m, 0, 0, 1];
	return { matrix, size, image, transform };
}

describe("zxing-cpp's tiled grid", () => {
	it('samples a square-finder symbol exactly, its corners where the grid has them', () => {
		const { matrix, size, image, transform } = drawn(5);
		expect(tiledGrid(image, transform, size).equals(matrix)).toBe(true);
		const corners = tileCorners(image, transform, size);
		expect(corners.length).toBe(3);
		expect(corners[0]![0]).toEqual({ x: (4 + 6.5) * 5, y: (4 + 6.5) * 5 });
	});

	it('keeps the grid corner where a ring does not fit, and moves it where an octagon does', () => {
		const deep = drawn(5, 2);
		const kept = tileCorners(deep.image, deep.transform, deep.size);
		expect(kept[0]![0]).toEqual({ x: (4 + 6.5) * 5, y: (4 + 6.5) * 5 });
		const octagon = drawn(5, 1);
		const moved = tileCorners(octagon.image, octagon.transform, octagon.size)[0]![0]!;
		expect(hypot(moved.x - 52.5, moved.y - 52.5) / 5).toBeGreaterThan(0.2);
	});

	it('lays one grid from every nearby centre on square rings and unfitted ones, several on octagons', () => {
		expect(TILED_NUDGES.length).toBe(9);
		expect(Object.isFrozen(TILED_NUDGES)).toBe(true);
		expect(TILED_NUDGES).toContainEqual({ x: 0, y: 0 });
		const square = drawn(5);
		const grids = tiledGrids(square.image, square.transform, square.size);
		expect(grids.length).toBe(1);
		expect(grids[0]!.equals(square.matrix)).toBe(true);
		const octagon = drawn(5, 1);
		expect(tiledGrids(octagon.image, octagon.transform, octagon.size).length).toBeGreaterThan(1);
		// A ring that does not fit from its own centre is not fitted from beside it.
		const deep = drawn(5, 2);
		expect(tiledGrids(deep.image, deep.transform, deep.size).length).toBe(1);
	});

	it('takes no corner further than half a finder from the prediction', () => {
		// A grid laid two finders off the drawn one: the rings fitted are nowhere near.
		const { size, image } = drawn(5);
		const shifted: Homography = [5, 0, 20 + 70, 0, 5, 20, 0, 0, 1];
		const corners = tileCorners(image, shifted, size);
		expect(corners[0]![0]).toEqual({ x: 90 + 6.5 * 5, y: 20 + 6.5 * 5 });
	});
});

describe('the strict profile and the tiled grid', () => {
	const text = 'https://example.com/events/2026/spring-market/stall-holders/register?ref=window';
	const v7 = () => encode(text, { ecLevel: 'M', minVersion: '7', maxVersion: '7' }).matrix;
	const qr = createSymbologyRegistry().require('qr');

	/** A symbology whose second reading, the tiled grid's, is replaced. */
	function second(read: SymbologyEntry['read']): Registry<SymbologyEntry> {
		let calls = 0;
		return new Registry('symbology', [
			{
				...qr,
				read: (matrix, options) => {
					calls += 1;
					return calls === 2 ? read(matrix, options) : qr.read(matrix, options);
				},
			},
		]);
	}

	it('reads a version 7 symbol whose tiled grid reads the same', () => {
		const result = decodeImage(drawGrid(v7(), { scale: 4 }), { profile: 'strict-v1' });
		expect(result.ok && result.value[0]!.read.bitstream.text).toBe(text);
	});

	it('refuses where the tiled grid does not read, reads otherwise, or reads worse', () => {
		const image = drawGrid(v7(), { scale: 6 });
		const stage = (registry: Registry<SymbologyEntry>, picture = image): string => {
			const result = decodeImage(picture, { profile: 'strict-v1' }, registry);
			return result.ok ? 'read' : String(result.error.params.stage);
		};
		expect(
			stage(
				second(() => {
					throw new QrStudioError('decode/unreadable', 'x', { stage: 'reed-solomon' });
				}),
			),
		).toBe('margin');
		expect(stage(second(() => qr.read(encode('something else').matrix, { strict: false })))).toBe(
			'margin',
		);
		expect(
			stage(
				second((matrix, options) => {
					const read = qr.read(matrix, options);
					return { ...read, errorsPerBlock: read.errorsPerBlock.map((errors) => errors + 2) };
				}),
			),
		).toBe('margin');
		expect(
			stage(
				second((matrix, options) => {
					const read = qr.read(matrix, options);
					return { ...read, errorsPerBlock: read.errorsPerBlock.map((errors) => errors + 1) };
				}),
			),
		).toBe('read');
		// Below six pixels a module, not even one.
		expect(
			stage(
				second((matrix, options) => {
					const read = qr.read(matrix, options);
					return { ...read, errorsPerBlock: read.errorsPerBlock.map((errors) => errors + 1) };
				}),
				drawGrid(v7(), { scale: 4 }),
			),
		).toBe('margin');
		expect(() =>
			stage(
				second(() => {
					throw new RangeError('a bug on the tiled read');
				}),
			),
		).toThrow(RangeError);
	});

	it('refuses an octagonal finder at 4 pixels a module that it reads with the check left out', async () => {
		// Minimal diamond with the octagonal finder it had before its finder was
		// made sturdier against starved ink.
		const diamond = presets().find((candidate) => candidate.id === 'minimal-diamond')!;
		const preset = {
			...diamond,
			design: {
				...diamond.design,
				regions: {
					...diamond.design.regions,
					finder: { outer: { id: 'octagon' }, inner: { id: 'octagon-centre' } },
				},
			},
		};
		const shot = styledCapture({ preset, modulePixels: 4, version: 7, seed: 1 });
		const strict = decodeImage(shot.image, { profile: 'strict-v1' });
		expect(strict.ok || strict.error.params.stage).toBe('margin');
		expect(decodeImage(shot.image, {}).ok).toBe(true);
		vi.resetModules();
		vi.doMock('../../src/decode/tiled.js', async (original) => ({
			...(await original<typeof import('../../src/decode/tiled.js')>()),
			TILED_SIZE: Number.POSITIVE_INFINITY,
		}));
		const unchecked = await import('../../src/decode/decoder.js');
		const without = unchecked.decodeImage(shot.image, { profile: 'strict-v1' });
		vi.doUnmock('../../src/decode/tiled.js');
		expect(without.ok && without.value[0]!.read.bitstream.text).toBe(shot.text);
	});
});
