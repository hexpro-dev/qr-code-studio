/**
 * The pieces of the pipeline at their edges: the cases a whole picture rarely
 * reaches but a camera eventually will.
 */

import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import { QrStudioError } from '../../src/core/errors.js';
import { Registry } from '../../src/core/registry.js';
import type { Binarised } from '../../src/decode/binarise.js';
import {
	binarise,
	binariseHybrid,
	binariseHybridMean,
	binariseOtsu,
	binariseSauvola,
	otsuThreshold,
} from '../../src/decode/binarise.js';
import { decodeImage, decodeMatrix } from '../../src/decode/decoder.js';
import { erasureFlags } from '../../src/decode/erasures.js';
import type { FinderPattern } from '../../src/decode/finder.js';
import { candidateTriples, moduleSizeAcross, orderFinders } from '../../src/decode/finder.js';
import { finderFrame, solve4 } from '../../src/decode/frame.js';
import type { GreyImage } from '../../src/decode/grey.js';
import {
	downscaleArea,
	downscaleHalf,
	fitPixels,
	looksInverted,
	toGrey,
	upscaleSmooth,
} from '../../src/decode/grey.js';
import {
	candidateSizes,
	diagonalAlignments,
	qrHypotheses,
	strictHypothesis,
	tripleModuleSize,
} from '../../src/decode/locate-qr.js';
import { plainReaderGrid, plainReaderLocations, plainThreshold } from '../../src/decode/plain.js';
import type { SampledGrid } from '../../src/decode/sample.js';
import { finderRingsTraceable, speckle } from '../../src/decode/strict.js';
import { encode } from '../../src/encode/encode.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import { ROLE_CODES } from '../../src/symbology/roles.js';
import type { Homography } from '../../src/decode/transform.js';
import { presets, styledCapture } from '../helpers/styled.js';
import type { SymbologyEntry } from '../../src/symbology/types.js';
import { mirror, rotateQuarter } from '../helpers/damage.js';
import { drawGrid } from '../helpers/draw.js';

function grey(width: number, height: number, fill: (x: number, y: number) => number): GreyImage {
	const data = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) data[y * width + x] = fill(x, y);
	return { data, width, height };
}

function bits(width: number, height: number, dark: (x: number, y: number) => boolean): Binarised {
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) out[y * width + x] = dark(x, y) ? 1 : 0;
	return { width, height, bits: out, threshold: () => 128 };
}

function pattern(x: number, y: number, moduleSize = 4): FinderPattern {
	return { x, y, moduleSize, count: 3 };
}

describe('grey and the resolution policy', () => {
	it('composites alpha over white', () => {
		const data = new Uint8ClampedArray([
			0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128, 255, 255, 255, 255,
		]);
		expect(Array.from(toGrey({ width: 4, height: 1, data }).data)).toEqual([255, 0, 127, 255]);
	});

	it('halves odd sizes, averages any footprint, and interpolates up', () => {
		const image = grey(5, 3, (x) => x * 50);
		const half = downscaleHalf(image);
		expect([half.width, half.height]).toEqual([2, 1]);
		expect(Array.from(half.data)).toEqual([25, 125]);
		const area = downscaleArea(
			grey(6, 6, (x) => (x < 3 ? 0 : 255)),
			4,
			4,
		);
		expect(Array.from(area.data.subarray(0, 4))).toEqual([0, 0, 255, 255]);
		const up = upscaleSmooth(
			grey(2, 1, (x) => x * 200),
			2,
		);
		expect(Array.from(up.data)).toEqual([0, 50, 150, 200, 0, 50, 150, 200]);
	});

	it('lands on its cap by whole halvings and one area pass, never over it, keeping the aspect', () => {
		const image = grey(1600, 1200, () => 128);
		expect(fitPixels(image, 1600 * 1200)).toBe(image);
		const halved = fitPixels(image, 800 * 600);
		expect([halved.width, halved.height]).toEqual([800, 600]);
		for (const cap of [100_000, 333_333, 1_000_000]) {
			const fitted = fitPixels(image, cap);
			expect(fitted.width * fitted.height).toBeLessThanOrEqual(cap);
			expect(fitted.width / fitted.height).toBeCloseTo(4 / 3, 1);
		}
		const tiny = fitPixels(
			grey(10, 1, () => 1),
			1,
		);
		expect([tiny.width, tiny.height]).toEqual([1, 1]);
		const tall = fitPixels(
			grey(1, 4000, () => 1),
			100,
		);
		expect([tall.width, tall.height]).toEqual([1, 100]);
	});

	it('guesses the polarity from the corners, against the levels of the picture itself', () => {
		const dark = grey(64, 64, (x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? 200 : 20));
		const light = grey(64, 64, (x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? 20 : 200));
		expect(looksInverted(dark)).toBe(true);
		expect(looksInverted(light)).toBe(false);
		// A dim picture keeps its answer: the levels are relative.
		expect(
			looksInverted(grey(64, 64, (x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? 10 : 63))),
		).toBe(false);
		expect(looksInverted(grey(1, 1, () => 255))).toBe(false);
	});
});

describe('the binarisers', () => {
	const split = grey(64, 64, (x) => (x % 8 < 4 ? 40 : 210));

	it('agree on a clean split, and keep the threshold that made each decision', () => {
		for (const id of ['hybrid', 'hybrid-mean', 'otsu', 'sauvola'] as const) {
			const result = binarise(split, id);
			expect(result.bits[32 * 64 + 9], id).toBe(1);
			expect(result.bits[32 * 64 + 13], id).toBe(0);
			expect(result.threshold(10, 10), id).toBeGreaterThanOrEqual(0);
		}
		expect(otsuThreshold(split)).toBe(40);
		expect(otsuThreshold(grey(4, 4, () => 7))).toBe(0);
	});

	it('fall back to a global threshold on a picture too small for local statistics', () => {
		const small = grey(20, 20, (x) => (x < 10 ? 0 : 255));
		expect(binariseHybrid(small).threshold(0, 0)).toBe(binariseOtsu(small).threshold(0, 0));
		expect(binariseHybridMean(small).threshold(0, 0)).toBe(binariseOtsu(small).threshold(0, 0));
		expect(binariseHybridMean(grey(48, 30, () => 9)).bits.length).toBe(48 * 30);
	});

	it('treat a flat light field as light, and a flat dark one under light neighbours as dark', () => {
		const field = grey(64, 64, (x, y) => (x >= 24 && x < 40 && y >= 24 && y < 40 ? 30 : 230));
		for (const result of [binariseHybrid(field), binariseHybridMean(field)]) {
			expect(result.bits[0]).toBe(0);
			expect(result.bits[32 * 64 + 32]).toBe(1);
		}
		// Sauvola has no such rule: in the middle of a flat dark area it sees no
		// variance and calls it light, and only near an edge does it see the
		// contrast.
		const sauvola = binariseSauvola(field, 15, 0.3);
		expect(sauvola.bits[32 * 64 + 25]).toBe(1);
	});
});

describe('finders and triples', () => {
	const empty = bits(100, 100, () => false);

	it('gives no module size where the runs never complete, and falls back to the row scan', () => {
		expect(moduleSizeAcross(empty, { x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull();
		expect(moduleSizeAcross(empty, { x: 10, y: 10 }, { x: 90, y: 10 })).toBeNull();
		expect(moduleSizeAcross(empty, { x: -5, y: 10 }, { x: 90, y: 10 })).toBeNull();
		const triple = orderFinders(pattern(10, 10, 3), pattern(90, 10, 4), pattern(10, 90, 5));
		expect(tripleModuleSize(empty, triple)).toBe(4);
	});

	it('measures half a pattern when the other half is off the picture', () => {
		const ring = bits(40, 40, (x, y) => {
			const d = Math.max(Math.abs(x - 3), Math.abs(y - 20));
			return d < 6 || (d >= 10 && d < 14);
		});
		expect(moduleSizeAcross(ring, { x: 3.5, y: 20.5 }, { x: 39, y: 20.5 })).toBeGreaterThan(0);
	});

	it('measures from one end when the other end is off the picture', () => {
		const ring = bits(40, 40, (x, y) => {
			const d = Math.max(Math.abs(x - 20), Math.abs(y - 20));
			return d < 2 || (d >= 3 && d < 4);
		});
		const size = moduleSizeAcross(ring, { x: 20.5, y: 20.5 }, { x: -30, y: 20.5 });
		expect(size).toBeGreaterThan(0.5);
		expect(size).toBeLessThan(1.5);
	});

	it('orders a triple either way round, and drops one that cannot be a symbol', () => {
		const ordered = orderFinders(pattern(10, 10), pattern(10, 90), pattern(90, 10));
		expect(ordered.topRight.x).toBe(90);
		expect(ordered.bottomLeft.y).toBe(90);
		expect(candidateTriples([pattern(10, 10), pattern(10, 10), pattern(10, 10)])).toEqual([]);
		expect(candidateTriples([pattern(10, 10), pattern(20, 10), pattern(30, 10)])).toEqual([]);
		expect(candidateTriples([pattern(10, 10), pattern(90, 10, 40), pattern(10, 90)])).toEqual([]);
	});
});

describe('QR grid hypotheses', () => {
	const legal = new Set(Array.from({ length: 40 }, (_, i) => 21 + 4 * i));

	it('offers the nearest legal size and its neighbours', () => {
		expect(candidateSizes(29, legal)).toEqual([29, 25, 33, 21, 37]);
		expect(candidateSizes(21, legal)).toEqual([21, 25, 29]);
		expect(candidateSizes(27.2, legal)).toEqual([29, 25, 33, 21, 37]);
	});

	it('offers nothing for a triple that collapses to a point', () => {
		const triple = orderFinders(pattern(10, 10), pattern(10, 10), pattern(10, 10));
		const blank = bits(50, 50, () => false);
		expect([...qrHypotheses(blank, triple, legal)]).toEqual([]);
		expect(strictHypothesis(blank, triple, legal)).toBeNull();
	});
});

describe('the strict margins and the plain reader', () => {
	it('measures speckle, and none on a picture too small to have any', () => {
		expect(speckle(bits(2, 2, () => true))).toBe(0);
		expect(speckle(bits(10, 10, (x, y) => x % 3 === 1 && y % 3 === 1))).toBeGreaterThan(0.05);
		expect(speckle(bits(10, 10, (x) => x < 5))).toBe(0);
	});

	it('finds no location where there are fewer than three finder shapes', () => {
		expect(plainReaderLocations(bits(60, 60, () => false))).toEqual([]);
		const one = drawGrid(
			{ width: 7, height: 7, get: (x, y) => Math.max(Math.abs(x - 3), Math.abs(y - 3)) !== 2 },
			{ scale: 4, quiet: 2 },
		);
		expect(plainReaderLocations(binariseHybrid(toGrey(one)))).toEqual([]);
	});

	it('orders the finders of a symbol the right way round however it is turned or reflected', () => {
		const built = encode('https://example.com/plain', { ecLevel: 'M' });
		const clean = drawGrid(built.matrix, { scale: 5 });
		for (const image of [mirror(clean), rotateQuarter(clean, 1), rotateQuarter(mirror(clean), 3)]) {
			const [location] = plainReaderLocations(binariseHybridMean(toGrey(image)));
			const { topLeft, topRight, bottomLeft } = location!;
			const cross =
				(topRight.x - topLeft.x) * (bottomLeft.y - topLeft.y) -
				(topRight.y - topLeft.y) * (bottomLeft.x - topLeft.x);
			expect(cross).toBeGreaterThan(0);
		}
	});

	it('thresholds as jsQR does, its bottom edge included', () => {
		const stripes = (x: number) => (x % 8 < 4 ? 40 : 210);
		const whole = grey(64, 64, stripes);
		const plain = plainThreshold(whole, false);
		const mean = binariseHybridMean(whole);
		expect(Array.from(plain.bits)).toEqual(Array.from(mean.bits));
		// Light-on-dark flips the decisions and keeps the thresholds.
		const flipped = plainThreshold(whole, true);
		expect(flipped.bits[0]).toBe(1 - (plain.bits[0] as number));
		expect(flipped.threshold(3, 3)).toBe(plain.threshold(3, 3));
		// A height that is not a multiple of 8: the last block row reads past the
		// end and its level is stored as 0, dragging down every threshold whose
		// neighbourhood reaches it.
		const short = plainThreshold(grey(64, 60, stripes), false);
		expect(short.threshold(20, 59)).toBeLessThan(short.threshold(20, 4));
	});

	it('lays a grid only at a size a symbol has, and reads a clean one exactly', () => {
		const built = encode('https://example.com/plain', { ecLevel: 'M' });
		const image = binariseHybridMean(toGrey(drawGrid(built.matrix, { scale: 5 })));
		const [location] = plainReaderLocations(image);
		expect(location?.size).toBe(built.matrix.width);
		expect(plainReaderGrid(image, location!)?.equals(built.matrix)).toBe(true);
		expect(plainReaderGrid(image, { ...location!, size: 23 })).toBeNull();
		expect(plainReaderGrid(image, { ...location!, size: 181 })).toBeNull();
	});
});

describe('the rest', () => {
	it('solves a 4 by 4 system, pivoting where it must, and refuses a singular one', () => {
		// The first column's largest entry is in the last row.
		const m = Float64Array.from([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 4, 0, 0, 1]);
		const solved = solve4(m, Float64Array.from([1, 4, 9, 6]));
		expect(solved?.map((value) => Math.round(value * 1e9) / 1e9)).toEqual([1, 2, 3, 2]);
		expect(solve4(new Float64Array(16), new Float64Array(4))).toBeNull();
	});

	it('flags no erasures when the grid and layout disagree in size or nothing is uncertain', () => {
		const layout = createSymbologyRegistry().require('qr').layout('1');
		const grid = (uncertain: Uint8Array): SampledGrid => ({
			matrix: new BitMatrix(21, 21),
			confidence: new Float32Array(uncertain.length),
			uncertain,
			minConfidence: 0,
		});
		expect(erasureFlags(grid(new Uint8Array(20)), layout)).toBeNull();
		expect(erasureFlags(grid(new Uint8Array(441)), layout)).toBeNull();
		const finderOnly = new Uint8Array(441);
		finderOnly[0] = 1;
		expect(erasureFlags(grid(finderOnly), layout)).toBeNull();
	});

	it('ranks a refusal with a stage it does not know as format, and passes on what is not one', () => {
		const qr = createSymbologyRegistry().require('qr');
		const odd: SymbologyEntry = {
			...qr,
			read: () => {
				throw new QrStudioError('decode/unreadable', 'x', { stage: 'somewhere-else' });
			},
		};
		const result = decodeImage(
			drawGrid(encode('odd').matrix),
			{},
			new Registry('symbology', [odd]),
		);
		expect(result.ok || result.error.params.stage).toBe('format');
		const broken: SymbologyEntry = {
			...qr,
			read: () => {
				throw new RangeError('a bug in a symbology');
			},
		};
		expect(() =>
			decodeImage(drawGrid(encode('odd').matrix), {}, new Registry('symbology', [broken])),
		).toThrow(RangeError);
		expect(() =>
			decodeImage(
				drawGrid(encode('odd').matrix),
				{ profile: 'strict-v1' },
				new Registry('symbology', [broken]),
			),
		).toThrow(RangeError);
		expect(() =>
			decodeMatrix(encode('odd').matrix, {}, new Registry('symbology', [broken])),
		).toThrow(RangeError);
		// A symbology that reads once and then fails in some other way: the
		// strict profile's second reading, through the plain reader's grid,
		// passes that on too.
		let calls = 0;
		const flaky: SymbologyEntry = {
			...qr,
			read: (matrix, options) => {
				calls += 1;
				if (calls > 1) throw new RangeError('a bug on the second read');
				return qr.read(matrix, options);
			},
		};
		expect(() =>
			decodeImage(
				drawGrid(encode('odd').matrix),
				{ profile: 'strict-v1' },
				new Registry('symbology', [flaky]),
			),
		).toThrow(RangeError);
	});

	it('refuses a finder frame that fits no square', () => {
		const cross = bits(80, 80, (x, y) => {
			const d = Math.max(Math.abs(x - 40), Math.abs(y - 40));
			const ring = d < 6 || (d >= 10 && d < 14);
			// Cut the outer ring away on the diagonals, so the edge is a cross.
			return ring && (Math.abs(x - 40) < 4 || Math.abs(y - 40) < 4 || d < 6);
		});
		expect(finderFrame(cross, pattern(40.5, 40.5, 4))).toBeNull();
		expect(
			finderFrame(
				bits(1, 1, () => true),
				pattern(0, 0),
			),
		).toBeNull();
	});
});

describe('the alignment walk and the finder rings', () => {
	it('lists the diagonal alignment patterns every QR version has', () => {
		const qr = createSymbologyRegistry().require('qr');
		for (let version = 1; version <= 40; version += 1) {
			const layout = qr.layout(String(version));
			const size = layout.width;
			const expected: number[] = [];
			for (let i = 7; i < size; i += 1) {
				// The centre of an alignment pattern on the diagonal is dark with an
				// alignment ring around it.
				const at = (x: number, y: number) => layout.roles[y * size + x];
				if (at(i, i) === ROLE_CODES.alignment && at(i - 2, i - 2) === ROLE_CODES.alignment) {
					if (at(i + 2, i + 2) === ROLE_CODES.alignment && at(i - 3, i) !== ROLE_CODES.alignment) {
						expected.push(i);
					}
				}
			}
			expect(diagonalAlignments(size), `version ${version}`).toEqual(expected);
		}
	});

	it('refuses dotted rings always, round rings at a slant, and neither square on', () => {
		const ids = ['classic-black', 'midnight-dots', 'charcoal-dots'];
		const verdicts = ids.map((id) => {
			const preset = presets().find((candidate) => candidate.id === id)!;
			return [0, 20].map((tilt) => {
				const shot = styledCapture({
					preset,
					modulePixels: 8,
					version: 3,
					seed: 5,
					tilt: tilt || undefined,
				});
				const result = decodeImage(shot.image, { profile: 'strict-v1' });
				return result.ok ? 'read' : String(result.error.params.stage);
			});
		});
		expect(verdicts).toEqual([
			['read', 'read'],
			['read', 'margin'],
			['margin', 'margin'],
		]);
	});

	it('refuses a ring it cannot measure, cut off by the picture edge', () => {
		const grey = { width: 20, height: 20, data: new Uint8Array(400).fill(255) };
		const shift: Homography = [1, 0, -2, 0, 1, -2, 0, 0, 1];
		const blank = bits(20, 20, () => false);
		expect(finderRingsTraceable(grey, blank, shift, 21)).toBe(false);
	});
});
