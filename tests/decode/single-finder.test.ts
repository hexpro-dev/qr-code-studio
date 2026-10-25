/**
 * The one-finder locators, Micro QR and rMQR, on their own: the finder's
 * frame, the quarter turn, the size from the timing pattern or the far
 * sub-pattern, and the grid sampled through it, checked module for module
 * against matrices bwip-js made.
 *
 * Clean pictures and mild rotation only, which is the scope these two are
 * read in (see locate-single.ts).
 */

import bwipjs from 'bwip-js';
import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import type { RgbaImage } from '../../src/core/image.js';
import { PI } from '../../src/core/math.js';
import { binariseHybrid } from '../../src/decode/binarise.js';
import { LENIENT_FINDER_TOLERANCE, findFinderPatterns } from '../../src/decode/finder.js';
import { axis, finderFrame, frameTransform, perpendicular } from '../../src/decode/frame.js';
import { toGrey } from '../../src/decode/grey.js';
import { microHypotheses, rmqrHypotheses } from '../../src/decode/locate-single.js';
import { sampleGrid } from '../../src/decode/sample.js';
import { apply } from '../../src/decode/transform.js';
import { mirror, rotate, rotateQuarter } from '../helpers/damage.js';
import { drawGrid } from '../helpers/draw.js';

const MICRO_SIZES = [11, 13, 15, 17];
const RMQR_SIZES = [
	[7, [43, 59, 77, 99, 139]],
	[9, [43, 59, 77, 99, 139]],
	[11, [27, 43, 59, 77, 99, 139]],
	[13, [27, 43, 59, 77, 99, 139]],
	[15, [43, 59, 77, 99, 139]],
	[17, [43, 59, 77, 99, 139]],
] as const;
const RMQR_ALL = RMQR_SIZES.flatMap(([height, widths]) =>
	widths.map((width) => ({ width, height })),
);

function bwip(bcid: string, text: string, version: string): BitMatrix {
	const raw = bwipjs.raw({ bcid, text, version } as unknown as Parameters<
		typeof bwipjs.raw
	>[0]) as unknown as {
		pixs: number[];
		pixx: number;
		pixy: number;
	}[];
	const symbol = raw[0] as { pixs: number[]; pixx: number; pixy: number };
	return new BitMatrix(symbol.pixx, symbol.pixy, Uint8Array.from(symbol.pixs));
}

function micro(version: string): BitMatrix {
	return bwip('microqrcode', '12345', version);
}

function rmqr(version: string): BitMatrix {
	return bwip('rectangularmicroqrcode', 'ABC123', version);
}

function differences(a: BitMatrix, b: BitMatrix): number {
	if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
	let count = 0;
	for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) count += 1;
	return count;
}

/** The fewest wrong modules over every grid the locator offers, against the matrix (or its transpose). */
function best(
	image: RgbaImage,
	matrix: BitMatrix,
	kind: 'micro' | 'rmqr',
	mirroredToo = false,
): number {
	const grey = toGrey(image);
	const binarised = binariseHybrid(grey);
	let fewest = Number.POSITIVE_INFINITY;
	for (const pattern of findFinderPatterns(binarised, LENIENT_FINDER_TOLERANCE)) {
		const frame = finderFrame(binarised, pattern);
		if (frame === null) continue;
		const hypotheses =
			kind === 'micro'
				? microHypotheses(binarised, frame, MICRO_SIZES)
				: rmqrHypotheses(binarised, frame, RMQR_ALL, mirroredToo);
		for (const hypothesis of hypotheses) {
			const grid = sampleGrid(
				{ grey, binarised },
				hypothesis.transform,
				hypothesis.width,
				hypothesis.height,
				{
					robust: false,
					outside: 0,
				},
			);
			if (grid === null) continue;
			fewest = Math.min(fewest, differences(grid.matrix, matrix));
			if (matrix.width === matrix.height)
				fewest = Math.min(fewest, differences(grid.matrix, matrix.mirrored()));
		}
	}
	return fewest;
}

describe('the finder frame', () => {
	it('finds the angle of a finder rotated by any amount, to within a degree', () => {
		const finder = drawGrid(
			{ width: 7, height: 7, get: (x, y) => Math.max(Math.abs(x - 3), Math.abs(y - 3)) !== 2 },
			{ scale: 10, quiet: 3 },
		);
		for (const degrees of [0, 7, 22, 38, 45, 61, 89]) {
			const binarised = binariseHybrid(toGrey(rotate(finder, degrees)));
			const [pattern] = findFinderPatterns(binarised, LENIENT_FINDER_TOLERANCE);
			expect(pattern, `${degrees} degrees`).toBeDefined();
			const frame = finderFrame(binarised, pattern!);
			expect(frame, `${degrees} degrees`).not.toBeNull();
			const found = (frame!.angle * 180) / PI;
			const expected = ((degrees % 90) + 90) % 90;
			const error = Math.min(Math.abs(found - expected), 90 - Math.abs(found - expected));
			expect(error, `${degrees} degrees`).toBeLessThanOrEqual(1);
			expect(frame!.module).toBeCloseTo(10, 0);
		}
	});

	it('refuses a pattern cut by the picture edge, and a shape with no rings', () => {
		const ring = drawGrid(
			{ width: 7, height: 7, get: (x, y) => Math.max(Math.abs(x - 3), Math.abs(y - 3)) !== 2 },
			{ scale: 8, quiet: 0 },
		);
		const binarised = binariseHybrid(toGrey(ring));
		expect(finderFrame(binarised, { x: 28, y: 28, moduleSize: 8, count: 3 })).toBeNull();
		const block = drawGrid({ width: 7, height: 7, get: () => true }, { scale: 6, quiet: 6 });
		const solid = binariseHybrid(toGrey(block));
		expect(finderFrame(solid, { x: 57, y: 57, moduleSize: 6, count: 3 })).toBeNull();
	});

	it('builds affine frames either way round', () => {
		const ex = { x: 2, y: 0 };
		expect(perpendicular(ex, false)).toEqual({ x: -0, y: 2 });
		expect(perpendicular(ex, true)).toEqual({ x: 0, y: -2 });
		const transform = frameTransform({ x: 100, y: 50 }, ex, perpendicular(ex, false));
		expect(apply(transform, 3.5, 3.5)).toEqual({ x: 100, y: 50 });
		expect(apply(transform, 4.5, 3.5)).toEqual({ x: 102, y: 50 });
		const unit = axis({ centre: { x: 0, y: 0 }, angle: 0, module: 1 }, 1);
		expect(unit.x).toBeCloseTo(0, 12);
		expect(unit.y).toBeCloseTo(1, 12);
	});
});

describe('Micro QR grids', () => {
	for (const version of ['M1', 'M2', 'M3', 'M4']) {
		it(`samples ${version} exactly, every quarter turn`, () => {
			const matrix = micro(version);
			const clean = drawGrid(matrix, { scale: 6, quiet: 2 });
			for (let turns = 0; turns < 4; turns += 1) {
				expect(best(rotateQuarter(clean, turns), matrix, 'micro'), `${turns} turns`).toBe(0);
			}
		});
	}

	it('samples a mildly rotated and a mirrored symbol', () => {
		const matrix = micro('M4');
		const clean = drawGrid(matrix, { scale: 8, quiet: 2 });
		for (const degrees of [4, -9, 15]) {
			expect(
				best(rotate(clean, degrees), matrix, 'micro'),
				`${degrees} degrees`,
			).toBeLessThanOrEqual(1);
		}
		expect(best(mirror(clean), matrix, 'micro')).toBe(0);
	});

	it('offers no grid where the timing pattern does not run', () => {
		const matrix = micro('M2');
		const broken = matrix.clone();
		for (let i = 8; i < matrix.width; i += 1) {
			broken.set(i, 0, false);
			broken.set(0, i, false);
		}
		expect(best(drawGrid(broken, { scale: 6, quiet: 2 }), matrix, 'micro')).toBe(
			Number.POSITIVE_INFINITY,
		);
	});
});

describe('rMQR grids', () => {
	for (const version of ['R7x43', 'R9x59', 'R11x27', 'R13x77', 'R15x99', 'R17x139']) {
		it(`samples ${version} exactly`, () => {
			const matrix = rmqr(version);
			expect(best(drawGrid(matrix, { scale: 4, quiet: 2 }), matrix, 'rmqr')).toBe(0);
		});
	}

	it('samples every quarter turn and a mild rotation', () => {
		const matrix = rmqr('R13x59');
		const clean = drawGrid(matrix, { scale: 5, quiet: 2 });
		for (let turns = 1; turns < 4; turns += 1) {
			expect(best(rotateQuarter(clean, turns), matrix, 'rmqr'), `${turns} turns`).toBe(0);
		}
		for (const degrees of [3, -7]) {
			expect(
				best(rotate(clean, degrees), matrix, 'rmqr'),
				`${degrees} degrees`,
			).toBeLessThanOrEqual(2);
		}
	});

	it('offers no grid whose top and bottom rows do not alternate', () => {
		const matrix = rmqr('R13x59');
		const broken = matrix.clone();
		for (let x = 8; x < matrix.width - 4; x += 1) {
			broken.set(x, 0, true);
			broken.set(x, matrix.height - 1, true);
		}
		expect(best(drawGrid(broken, { scale: 5, quiet: 2 }), matrix, 'rmqr')).toBe(
			Number.POSITIVE_INFINITY,
		);
	});

	it('samples a mirror image the right way round when it may, and not otherwise', () => {
		const matrix = rmqr('R11x43');
		const flipped = mirror(drawGrid(matrix, { scale: 5, quiet: 2 }));
		expect(best(flipped, matrix, 'rmqr', true)).toBe(0);
		expect(best(flipped, matrix, 'rmqr', false)).toBe(Number.POSITIVE_INFINITY);
	});
});
