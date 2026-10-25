/**
 * The image pipeline alone, before any symbology reads what it samples:
 * grey, threshold, finders, triples, grids, and the soft samples on them.
 *
 * Every picture is drawn here from a matrix another encoder made, so the
 * check is exact: the grid the pipeline samples is the matrix that was drawn,
 * module for module, on clean pictures and on mildly damaged ones.
 */

import { describe, expect, it } from 'vitest';
import type { BitMatrix } from '../../src/core/bit-matrix.js';
import type { RgbaImage } from '../../src/core/image.js';
import { binariseHybrid } from '../../src/decode/binarise.js';
import {
	LENIENT_FINDER_TOLERANCE,
	STRICT_FINDER_TOLERANCE,
	candidateTriples,
	findFinderPatterns,
} from '../../src/decode/finder.js';
import { toGrey } from '../../src/decode/grey.js';
import { qrHypotheses, qrTimingAgreement } from '../../src/decode/locate-qr.js';
import { sampleGrid } from '../../src/decode/sample.js';
import { blur, noise, perspective, place, rotate, rotateQuarter } from '../helpers/damage.js';
import { drawGrid } from '../helpers/draw.js';
import { qrcodeMatrix } from '../helpers/oracles.js';

const LEGAL = new Set(Array.from({ length: 40 }, (_, i) => 21 + i * 4));

/** Every grid the pipeline would sample from a picture, best first, as bit matrices. */
function sampledGrids(image: RgbaImage, strict = false, robust = false, limit = 64): BitMatrix[] {
	const grey = toGrey(image);
	const binarised = binariseHybrid(grey);
	const tolerance = strict ? STRICT_FINDER_TOLERANCE : LENIENT_FINDER_TOLERANCE;
	const out: BitMatrix[] = [];
	for (const triple of candidateTriples(findFinderPatterns(binarised, tolerance))) {
		for (const hypothesis of qrHypotheses(binarised, triple, LEGAL, strict)) {
			const grid = sampleGrid(
				{ grey, binarised },
				hypothesis.transform,
				hypothesis.width,
				hypothesis.height,
				{ robust, outside: 0 },
			);
			if (grid !== null) out.push(grid.matrix);
			if (out.length >= limit) return out;
		}
	}
	return out;
}

function differences(a: BitMatrix, b: BitMatrix): number {
	if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
	let count = 0;
	for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) count += 1;
	return count;
}

/** The fewest modules any sampled grid gets wrong, against the matrix or its transpose. */
function bestDifference(image: RgbaImage, matrix: BitMatrix, strict = false): number {
	let best = Number.POSITIVE_INFINITY;
	for (const grid of sampledGrids(image, strict, !strict)) {
		best = Math.min(best, differences(grid, matrix), differences(grid, matrix.mirrored()));
	}
	return best;
}

const TEXTS = [
	'HELLO WORLD',
	'https://example.com/menu?table=12',
	'x'.repeat(120),
	'0'.repeat(400),
];

describe('sampling clean renders', () => {
	for (const text of TEXTS) {
		for (const scale of [2, 3, 5, 8]) {
			it(`samples a ${text.length}-character symbol exactly at ${scale} pixels a module`, () => {
				const matrix = qrcodeMatrix(text, { ecLevel: 'M' });
				const image = drawGrid(matrix, { scale });
				expect(bestDifference(image, matrix)).toBe(0);
				expect(bestDifference(image, matrix, true)).toBe(0);
			});
		}
	}

	it('finds the three finder patterns of a clean symbol and nothing else', () => {
		const matrix = qrcodeMatrix('HELLO WORLD');
		const grey = toGrey(drawGrid(matrix, { scale: 6 }));
		const patterns = findFinderPatterns(binariseHybrid(grey), STRICT_FINDER_TOLERANCE);
		expect(patterns).toHaveLength(3);
		const centres = patterns.map((p) => [Math.round(p.x), Math.round(p.y)]).sort();
		// Quiet zone 4, finder centre 3.5 modules in, 6 pixels a module.
		const near = 4 * 6 + 3.5 * 6;
		const far = (4 + matrix.width - 3.5) * 6;
		expect(centres).toEqual(
			[
				[near, near],
				[near, far],
				[far, near],
			].sort(),
		);
	});

	it('reads the timing pattern of a grid that landed at one, and of a misplaced grid near a half', () => {
		const matrix = qrcodeMatrix('https://example.com/menu?table=12');
		expect(qrTimingAgreement(matrix.data, matrix.width)).toBe(1);
		const shifted = new Uint8Array(matrix.data.length);
		shifted.set(matrix.data.subarray(1));
		expect(qrTimingAgreement(shifted, matrix.width)).toBeLessThan(0.85);
	});
});

describe('sampling damaged renders', () => {
	const matrix = qrcodeMatrix('https://example.com/menu?table=12', { ecLevel: 'M' });
	const clean = drawGrid(matrix, { scale: 6 });

	it.each([1, 2, 3])('samples a symbol turned %i quarter turns', (turns) => {
		expect(bestDifference(rotateQuarter(clean, turns), matrix)).toBe(0);
	});

	it.each([7, 19, 33, 45])(
		'samples a symbol rotated %i degrees with few module errors',
		(degrees) => {
			expect(bestDifference(rotate(clean, degrees), matrix)).toBeLessThanOrEqual(3);
		},
	);

	it('samples a keystoned symbol with few module errors', () => {
		expect(bestDifference(perspective(clean, 0.2), matrix)).toBeLessThanOrEqual(3);
	});

	it('samples a symbol photographed at an angle', () => {
		const large = qrcodeMatrix('x'.repeat(180), { ecLevel: 'M' });
		const photo = place(drawGrid(large, { scale: 6 }), { yaw: 25, pitch: 10, background: 236 });
		expect(bestDifference(photo.image, large)).toBeLessThanOrEqual(6);
	});

	it('samples a soft, noisy symbol with few module errors', () => {
		expect(bestDifference(noise(blur(clean, 1), 30, 4), matrix)).toBeLessThanOrEqual(3);
	});
});
