/**
 * The strict profile's newer rules, each at its edges: the grid's geometry
 * (module width, the tiled floor, foreshortening), fixed patterns forgiven on
 * a drawn edge and refused under glare, finder rings under a smear, the
 * projective fit through many points, and the plain reader's luminance.
 *
 * The properties these rules exist for are held over whole corpora in
 * conservative.ts, styled-conservative.test.ts and tilt.test.ts.
 */

import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../src/core/image.js';
import { cos, sin } from '../../src/core/math.js';
import type { Binarised } from '../../src/decode/binarise.js';
import { binariseHybrid, binariseHybridMean } from '../../src/decode/binarise.js';
import { STRICT_MAX_PIXELS, decodeImage } from '../../src/decode/decoder.js';
import type { FinderPattern } from '../../src/decode/finder.js';
import {
	LENIENT_FINDER_TOLERANCE,
	STRICT_FINDER_TOLERANCE,
	moduleSizeAcross,
	orderFinders,
} from '../../src/decode/finder.js';
import type { GreyImage } from '../../src/decode/grey.js';
import { toGrey } from '../../src/decode/grey.js';
import type { Preset } from '../../src/design/types.js';
import { strictHypothesis } from '../../src/decode/locate-qr.js';
import { plainLuminance } from '../../src/decode/plain.js';
import {
	STRICT_MAX_FORESHORTENING,
	STRICT_MAX_SMEAR,
	STRICT_MIN_MODULE_PIXELS,
	STRICT_MIN_TILED_MODULE_PIXELS,
	finderCentresClosed,
	finderRingsTraceable,
	finderSmear,
	fixedPatternsAgree,
	foreshortening,
	ringShape,
	strictSamples,
} from '../../src/decode/strict.js';
import type { Homography } from '../../src/decode/transform.js';
import { apply, fitHomography, moduleWidth, quadToQuad } from '../../src/decode/transform.js';
import type { DecodeFrame, DecodeOptions } from '../../src/decode/types.js';
import { encode } from '../../src/encode/encode.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import { blur, motionBlur, shrink, warpInto } from '../helpers/damage.js';
import { drawGrid } from '../helpers/draw.js';
import { presets, styledCapture } from '../helpers/styled.js';

const STRICT: DecodeOptions = { profile: 'strict-v1' };

function outcome(image: RgbaImage, options: DecodeOptions = STRICT): string {
	const result = decodeImage(image, options);
	if (result.ok) return result.value.map((found) => found.read.bitstream.text).join('|');
	return `${result.error.code} ${result.error.params.stage}`;
}

function bits(width: number, height: number, dark: (x: number, y: number) => boolean): Binarised {
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) out[y * width + x] = dark(x, y) ? 1 : 0;
	return { width, height, bits: out, threshold: () => 128 };
}

function greyOf(width: number, height: number, level: (x: number, y: number) => number): GreyImage {
	const data = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) data[y * width + x] = level(x, y);
	return { width, height, data };
}

/** The grid the scanner lays over a picture, as a transform from module to pixel coordinates. */
function scannerGrid(image: RgbaImage, size: number): Homography {
	const result = decodeImage(image, {});
	if (!result.ok) throw new Error('the scanner did not read this picture');
	return quadToQuad(
		[
			{ x: 0, y: 0 },
			{ x: size, y: 0 },
			{ x: size, y: size },
			{ x: 0, y: size },
		],
		result.value[0]!.corners,
	);
}

describe('a projective map through many points', () => {
	const truth: Homography = [3, 0.4, 12, -0.3, 2.6, 30, 0.002, -0.001, 1];
	const source = [
		{ x: 0, y: 0 },
		{ x: 40, y: 0 },
		{ x: 40, y: 40 },
		{ x: 0, y: 40 },
		{ x: 20, y: 20 },
		{ x: 31, y: 9 },
	];
	const destination = source.map((p) => apply(truth, p.x, p.y));

	it('recovers the map exactly from four points or more', () => {
		for (const count of [4, 6]) {
			const fitted = fitHomography(source.slice(0, count), destination.slice(0, count))!;
			for (const p of source) {
				const want = apply(truth, p.x, p.y);
				const got = apply(fitted, p.x, p.y);
				expect(got.x, `${count} points`).toBeCloseTo(want.x, 6);
				expect(got.y, `${count} points`).toBeCloseTo(want.y, 6);
			}
		}
	});

	it('averages through points that do not all agree', () => {
		const noisy = destination.map((p, i) => ({ x: p.x + (i % 2 === 0 ? 0.3 : -0.3), y: p.y }));
		const fitted = fitHomography(source, noisy)!;
		const centre = apply(fitted, 20, 20);
		const want = apply(truth, 20, 20);
		expect(Math.abs(centre.x - want.x)).toBeLessThan(0.3);
	});

	it('fits nothing from too few points, unequal lists, or points that fix no map', () => {
		expect(fitHomography(source.slice(0, 3), destination.slice(0, 3))).toBeNull();
		expect(fitHomography(source, destination.slice(0, 5))).toBeNull();
		const line = [0, 1, 2, 3, 4].map((i) => ({ x: i, y: 2 * i }));
		expect(fitHomography(line, line)).toBeNull();
		const point = [0, 1, 2, 3].map(() => ({ x: 5, y: 5 }));
		expect(fitHomography(point, destination.slice(0, 4))).toBeNull();
	});
});

describe("the strict profile's geometry", () => {
	it('measures module width and foreshortening the same way round', () => {
		expect(moduleWidth([3, 0, 0, 0, 3, 0, 0, 0, 1], 5, 5)).toBeCloseTo(3, 9);
		expect(foreshortening([3, 0, 0, 0, 3, 0, 0, 0, 1], 5, 5)).toBeCloseTo(1, 9);
		expect(foreshortening([4, 0, 0, 0, 2, 0, 0, 0, 1], 5, 5)).toBeCloseTo(2, 9);
		// Turned, it stretches the same.
		const c = cos(0.5);
		const s = sin(0.5);
		const turned: Homography = [4 * c, -2 * s, 0, 4 * s, 2 * c, 0, 0, 0, 1];
		expect(foreshortening(turned, 5, 5)).toBeCloseTo(2, 9);
	});

	it('samples only modules wide enough, wider from version 7, and not drawn out too far', () => {
		const at = (width: number): Homography => [width, 0, 0, 0, width, 0, 0, 0, 1];
		expect(strictSamples(at(STRICT_MIN_MODULE_PIXELS), 21, 21, false)).toBe(true);
		expect(strictSamples(at(STRICT_MIN_MODULE_PIXELS - 0.01), 21, 21, false)).toBe(false);
		expect(strictSamples(at(2.8), 45, 45, false)).toBe(true);
		expect(strictSamples(at(2.8), 45, 45, true)).toBe(false);
		expect(strictSamples(at(STRICT_MIN_TILED_MODULE_PIXELS), 45, 45, true)).toBe(true);
		const drawnOut = STRICT_MAX_FORESHORTENING + 0.01;
		expect(strictSamples([5 * drawnOut, 0, 0, 0, 5, 0, 0, 0, 1], 21, 21, false)).toBe(false);
		expect(strictSamples([5 * 1.7, 0, 0, 0, 5, 0, 0, 0, 1], 21, 21, false)).toBe(true);
	});

	it('refuses a symbol at two pixels a module that the scanner reads', () => {
		const text = 'https://example.com/m';
		const image = drawGrid(encode(text, { ecLevel: 'H' }).matrix, { scale: 2 });
		expect(outcome(image, {})).toBe(text);
		expect(outcome(image)).toBe('decode/unreadable margin');
	});

	it('reads version 6 at 2.5 pixels a module, and refuses version 7 there', () => {
		for (const [version, verdict] of [
			['6', 'read'],
			['7', 'decode/unreadable margin'],
		] as const) {
			const text = `https://example.com/v${version}`;
			const matrix = encode(text, {
				ecLevel: 'L',
				minVersion: version,
				maxVersion: version,
			}).matrix;
			const image = shrink(drawGrid(matrix, { scale: 5 }), 2);
			expect(outcome(image, {}), `version ${version}`).toBe(text);
			const strict = outcome(image);
			expect(strict === text ? 'read' : strict, `version ${version}`).toBe(verdict);
		}
	});

	it('refuses a symbol squashed to half its height, and reads one squashed to 0.6', () => {
		const text = 'https://example.com/squash';
		const image = drawGrid(encode(text, { ecLevel: 'H' }).matrix, { scale: 8 });
		const squash = (share: number): RgbaImage =>
			warpInto(
				image,
				[
					{ x: 0, y: 0 },
					{ x: image.width, y: 0 },
					{ x: image.width, y: image.height * share },
					{ x: 0, y: image.height * share },
				],
				image.width,
				Math.ceil(image.height * share),
			);
		expect(outcome(squash(0.5), {})).toBe(text);
		expect(outcome(squash(0.5))).toBe('decode/unreadable margin');
		expect(outcome(squash(0.6))).toBe(text);
	});

	it("works at the picture's own size up to twelve megapixels", () => {
		const frames: DecodeFrame[] = [];
		const image = drawGrid(encode('https://example.com/large').matrix, { scale: 60 });
		expect(image.width * image.height).toBeGreaterThan(2_500_000);
		expect(image.width * image.height).toBeLessThan(STRICT_MAX_PIXELS);
		decodeImage(image, { ...STRICT, onTelemetry: (frame) => frames.push(frame) });
		decodeImage(image, { onTelemetry: (frame) => frames.push(frame) });
		const sources = frames.filter((frame) => frame.stage === 'source');
		expect(sources.map((frame) => frame.workWidth)).toEqual([
			image.width,
			expect.any(Number) as number,
		]);
		expect(sources[1]!.workWidth).toBeLessThan(image.width);
	});
});

describe('fixed patterns under two thresholds', () => {
	const qr = createSymbologyRegistry().require('qr');
	const layout = qr.layout('1');
	const matrix = encode('fixed', { ecLevel: 'L', minVersion: '1', maxVersion: '1' }).matrix;
	const scale = 6;
	const grey = toGrey(drawGrid(matrix, { scale }));
	const transform: Homography = [scale, 0, 4 * scale, 0, scale, 4 * scale, 0, 0, 1];
	const mean = binariseHybridMean(grey);

	/** The picture thresholded as `mean` is, but for the pixel under module (u, v)'s centre. */
	function splitAt(u: number, v: number): Binarised {
		const p = apply(transform, u + 0.5, v + 0.5);
		const out = Uint8Array.from(mean.bits);
		const index = Math.floor(p.y) * mean.width + Math.floor(p.x);
		out[index] = out[index] === 1 ? 0 : 1;
		return { ...mean, bits: out };
	}

	it('agree when the two thresholds give the same picture', () => {
		expect(fixedPatternsAgree(mean, mean, grey, transform, layout)).toBe(true);
	});

	it('forgive a split on a module whose neighbourhood keeps its contrast', () => {
		// A timing module: dark and light either side of it, the picture crisp.
		expect(fixedPatternsAgree(mean, splitAt(9, 6), grey, transform, layout)).toBe(true);
	});

	it('refuse a split on a module whose neighbourhood has gone pale', () => {
		const pale = greyOf(grey.width, grey.height, (x, y) => {
			const u = x / scale - 4;
			const v = y / scale - 4;
			// Glare over the timing pattern round module (9, 6).
			return Math.abs(u - 9.5) < 2 && Math.abs(v - 6.5) < 2
				? 200
				: (grey.data[y * grey.width + x] as number);
		});
		expect(fixedPatternsAgree(mean, splitAt(9, 6), pale, transform, layout)).toBe(false);
	});

	it('measure only what is on the picture for a symbol cut by its edge', () => {
		// Cropped two and a half modules into the symbol, up and left: the first
		// columns and rows are off the picture, and so is part of the
		// neighbourhood of the split, a module of the finder's ring.
		const crop = 6.5 * scale;
		const cut = greyOf(
			grey.width - crop,
			grey.height - crop,
			(x, y) => grey.data[(y + crop) * grey.width + x + crop] as number,
		);
		const shifted: Homography = [scale, 0, -2.5 * scale, 0, scale, -2.5 * scale, 0, 0, 1];
		const threshold = binariseHybridMean(cut);
		const p = apply(shifted, 3.5, 6.5);
		const split = Uint8Array.from(threshold.bits);
		const index = Math.floor(p.y) * threshold.width + Math.floor(p.x);
		split[index] = split[index] === 1 ? 0 : 1;
		expect(fixedPatternsAgree(threshold, { ...threshold, bits: split }, cut, shifted, layout)).toBe(
			true,
		);
	});
});

describe('finder rings under a smear', () => {
	// Midnight dots with the round ring it had before the presets were given
	// cornered ones: the catalogue still offers the ring, with a warning.
	const dots = presets().find((preset) => preset.id === 'midnight-dots')!;
	const midnight: Preset = {
		...dots,
		design: {
			...dots.design,
			regions: {
				...dots.design.regions,
				finder: { outer: { id: 'circle' }, inner: { id: 'circle-centre' } },
			},
		},
	};
	const classic = presets().find((preset) => preset.id === 'classic-black')!;
	const shot = (preset: typeof midnight): RgbaImage =>
		styledCapture({ preset, modulePixels: 10, version: 2, seed: 3 }).image;

	function smearOf(image: RgbaImage, size: number): number {
		const grid = scannerGrid(image, size);
		const grey = toGrey(image);
		return Math.max(
			...[
				[3.5, 3.5],
				[size - 3.5, 3.5],
				[3.5, size - 3.5],
			].map(([u, v]) => finderSmear(grey, grid, u!, v!)),
		);
	}

	function traceable(image: RgbaImage, size: number, threshold?: Binarised): boolean {
		const grid = scannerGrid(image, size);
		const grey = toGrey(image);
		return finderRingsTraceable(grey, threshold ?? binariseHybrid(grey), grid, size);
	}

	it('measures a lens blur as even and a moving camera as uneven', () => {
		const image = shot(classic);
		expect(smearOf(image, 25)).toBeLessThan(0.15);
		expect(smearOf(blur(image, 3), 25)).toBeLessThan(0.3);
		expect(smearOf(motionBlur(image, 12, 75), 25)).toBeGreaterThan(STRICT_MAX_SMEAR);
	});

	it('refuses a smeared round ring and keeps a smeared square one', () => {
		expect(traceable(shot(midnight), 25)).toBe(true);
		expect(traceable(motionBlur(shot(midnight), 10, 30), 25)).toBe(false);
		expect(traceable(motionBlur(shot(classic), 10, 30), 25)).toBe(true);
	});

	it('asks a smeared ring to be one closed ring in the threshold it is given', () => {
		const matrix = encode('https://example.com/smear').matrix;
		const sharp = drawGrid(matrix, { scale: 10 });
		const smeared = motionBlur(sharp, 11, 0);
		expect(smearOf(smeared, 25)).toBeGreaterThan(STRICT_MAX_SMEAR);
		const light = bits(smeared.width, smeared.height, () => false);
		expect(traceable(smeared, 25)).toBe(true);
		expect(traceable(smeared, 25, light)).toBe(false);
		// Without a smear the threshold is not consulted.
		expect(traceable(sharp, 25, light)).toBe(true);
	});

	it('cannot measure a smear with no edge in reach, nor a ring cut off along its diagonals', () => {
		const blank = greyOf(40, 40, () => 255);
		expect(finderSmear(blank, [4, 0, 6, 0, 4, 6, 0, 0, 1], 3.5, 3.5)).toBe(
			Number.POSITIVE_INFINITY,
		);
		// A square finder turned 45 degrees in a picture that holds its sides but
		// not its corners: the diagonal rays leave the picture first.
		const m = 4;
		const c = 0.7071067811865476;
		const turnedGrid: Homography = [m * c, -m * c, 20, m * c, m * c, 20 - 7 * m * c, 0, 0, 1];
		const turned = greyOf(40, 40, (x, y) => {
			const du = (x + 0.5 - 20 + (y + 0.5 - 20)) / (2 * m * c);
			const dv = (-(x + 0.5 - 20) + (y + 0.5 - 20)) / (2 * m * c);
			const d = Math.max(Math.abs(du), Math.abs(dv));
			return d < 1.5 || (d >= 2.5 && d < 3.5) ? 0 : 255;
		});
		expect(apply(turnedGrid, 3.5, 3.5)).toEqual({ x: 20, y: 20 });
		expect(ringShape(turned, turnedGrid, 3.5, 3.5)).toBeNull();
	});
});

describe("the finders' centres", () => {
	it('settle where the centre is one dark patch, and not where glare holes it', () => {
		const matrix = encode('https://example.com/centres').matrix;
		const scale = 8;
		const picture = binariseHybrid(toGrey(drawGrid(matrix, { scale })));
		const grid: Homography = [scale, 0, 4 * scale, 0, scale, 4 * scale, 0, 0, 1];
		expect(finderCentresClosed(picture, grid, matrix.width)).toBe(true);
		// A light hole a module across in the middle of the bottom left finder's centre.
		const holed = Uint8Array.from(picture.bits);
		const centre = apply(grid, 3.5, matrix.width - 3.5);
		for (let y = -4; y < 4; y += 1) {
			for (let x = -4; x < 4; x += 1) {
				holed[(Math.floor(centre.y) + y) * picture.width + Math.floor(centre.x) + x] = 0;
			}
		}
		expect(finderCentresClosed({ ...picture, bits: holed }, grid, matrix.width)).toBe(false);
	});
});

describe('the strict finder search', () => {
	it('holds the axes to a third of a module and the diagonals to a half', () => {
		expect(STRICT_FINDER_TOLERANCE).toEqual({ runs: 0.35, diagonals: 0.5 });
		expect(LENIENT_FINDER_TOLERANCE).toEqual({ runs: 0.5, diagonals: 0.5 });
		expect(Object.isFrozen(STRICT_FINDER_TOLERANCE)).toBe(true);
	});

	it('takes the geometric mean of the module sizes at the two ends of a line', () => {
		// Two finders, one at 4 pixels a module and one at 9, facing each other.
		const finder = (cx: number, m: number) => (x: number, y: number) => {
			const d = Math.max(Math.abs(x + 0.5 - cx), Math.abs(y + 0.5 - 40)) / m;
			return d < 1.5 || (d >= 2.5 && d < 3.5);
		};
		const left = finder(30, 4);
		const right = finder(130, 9);
		const image = bits(180, 80, (x, y) => left(x, y) || right(x, y));
		const a: FinderPattern = { x: 30, y: 40, moduleSize: 4, count: 3 };
		const b: FinderPattern = { x: 130, y: 40, moduleSize: 9, count: 3 };
		expect(moduleSizeAcross(image, a, b)).toBeCloseTo(6, 1);
	});
});

describe('the strict grid', () => {
	it('lays no grid over finders in a line or on one spot', () => {
		const legal = new Set(Array.from({ length: 40 }, (_, i) => 21 + 4 * i));
		const pattern = (x: number, y: number): FinderPattern => ({ x, y, moduleSize: 4, count: 3 });
		const line = orderFinders(pattern(20, 20), pattern(120, 20), pattern(220, 20));
		const blank = bits(260, 60, () => false);
		expect(strictHypothesis(blank, line, legal)).toBeNull();
		// Two finders on one spot: every grid from version 2 collapses and the walk
		// down the diagonal stops before it starts, which leaves version 1's.
		const collapsed = {
			topLeft: pattern(20, 20),
			topRight: pattern(20, 20),
			bottomLeft: pattern(20, 120),
		};
		expect(
			strictHypothesis(
				bits(60, 160, () => false),
				collapsed,
				legal,
			)?.width,
		).toBe(21);
	});
});

describe("the plain reader's luminance", () => {
	it('weighs red, green and blue as BT.709 does, and ignores alpha', () => {
		const image: RgbaImage = {
			width: 4,
			height: 1,
			data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 200, 200, 200, 7]),
		};
		expect(Array.from(plainLuminance(image).data)).toEqual([54, 182, 18, 200]);
	});
});
