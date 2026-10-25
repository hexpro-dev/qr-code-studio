/**
 * The scanner: the lenient profile over drawn and damaged pictures.
 *
 * Symbols come from this package's encoder and from three others, so a
 * reading that agrees with the text put in is evidence about the reader and
 * not about one encoder's habits. Every picture is drawn and damaged here, by
 * seed.
 */

import { describe, expect, it } from 'vitest';
import type { BitMatrix } from '../../src/core/bit-matrix.js';
import { QrStudioError } from '../../src/core/errors.js';
import type { RgbaImage } from '../../src/core/image.js';
import { createPrng } from '../../src/core/prng.js';
import { Registry } from '../../src/core/registry.js';
import { DEFAULT_MAX_PIXELS, decodeImage, decodeMatrix } from '../../src/decode/decoder.js';
import type { DecodeFrame, DecodeOptions, DecodedSymbol } from '../../src/decode/types.js';
import { encode } from '../../src/encode/encode.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import type { SymbologyEntry } from '../../src/symbology/types.js';
import {
	blur,
	dim,
	glare,
	gradient,
	invert,
	mirror,
	noise,
	pad,
	paint,
	perspective,
	place,
	rotate,
	rotateQuarter,
	shrink,
} from '../helpers/damage.js';
import { blankImage, drawGrid, paste } from '../helpers/draw.js';
import { bwipMatrix, generatorMatrix, qrcodeMatrix } from '../helpers/oracles.js';

const TEXT = 'https://example.com/menu/table-12?visit=1';

function draw(matrix: BitMatrix, scale = 6): RgbaImage {
	return drawGrid(matrix, { scale });
}

function ours(text = TEXT, ecLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): BitMatrix {
	return encode(text, { ecLevel }).matrix;
}

function read(image: RgbaImage, options: DecodeOptions = {}): readonly DecodedSymbol[] {
	const result = decodeImage(image, options);
	if (!result.ok) throw result.error;
	return result.value;
}

function texts(image: RgbaImage, options: DecodeOptions = {}): string[] {
	return read(image, options).map((symbol) => symbol.read.bitstream.text);
}

function failure(image: RgbaImage, options: DecodeOptions = {}): QrStudioError {
	const result = decodeImage(image, options);
	if (result.ok) throw new Error('expected the read to fail');
	return result.error;
}

describe('reading clean renders', () => {
	it('reads a symbol from each of four encoders', () => {
		for (const matrix of [ours(), qrcodeMatrix(TEXT), generatorMatrix(TEXT), bwipMatrix(TEXT)]) {
			expect(texts(draw(matrix))).toEqual([TEXT]);
		}
	});

	it('reads every error correction level', () => {
		for (const level of ['L', 'M', 'Q', 'H'] as const) {
			const [symbol] = read(draw(ours(TEXT, level)));
			expect(symbol?.read.ecLevel).toBe(level);
			expect(symbol?.read.bitstream.text).toBe(TEXT);
		}
	});

	it.each([2, 3, 4, 8, 12])('reads at %i pixels a module', (scale) => {
		expect(texts(draw(ours(), scale))).toEqual([TEXT]);
	});

	it.each([
		[1, 10],
		[7, 120],
		[15, 400],
		[27, 1000],
		[40, 2400],
	])('reads version %i', (version, length) => {
		const text = 'A1b2C3d4'.repeat(Math.ceil(length / 8)).slice(0, length);
		const built = encode(text, { ecLevel: 'L', minVersion: String(version) });
		expect(built.version).toBe(String(version));
		const [symbol] = read(draw(built.matrix, 4));
		expect(symbol?.read.version).toBe(String(version));
		expect(symbol?.read.bitstream.text).toBe(text);
	});

	it('reports a clean symbol fully confident, the right way round and its corners where it was drawn', () => {
		const matrix = ours();
		const [symbol] = read(draw(matrix, 6));
		expect(symbol?.minConfidence).toBeGreaterThan(0.95);
		expect(symbol?.inverted).toBe(false);
		expect(symbol?.read.mirrored).toBe(false);
		expect(symbol?.symbology).toBe('qr');
		const near = 4 * 6;
		const far = (4 + matrix.width) * 6;
		const corners = symbol?.corners.map((p) => [Math.round(p.x), Math.round(p.y)]);
		expect(corners).toEqual([
			[near, near],
			[far, near],
			[far, far],
			[near, far],
		]);
	});

	it('reads a symbol in a much larger picture', () => {
		expect(texts(pad(draw(ours(), 5), 300))).toEqual([TEXT]);
	});

	it('reads a transparent background as the paper it will be printed on', () => {
		const image = draw(ours());
		const { data } = image;
		for (let i = 0; i < data.length; i += 4) {
			// Light pixels become transparent black, the way many writers store them.
			if (data[i] === 255) {
				data[i] = 0;
				data[i + 1] = 0;
				data[i + 2] = 0;
				data[i + 3] = 0;
			}
		}
		expect(texts(image)).toEqual([TEXT]);
	});
});

describe('reading damaged pictures', () => {
	const clean = draw(ours(TEXT, 'M'), 8);

	it.each([1, 2, 3])('reads a symbol turned %i quarter turns', (turns) => {
		expect(texts(rotateQuarter(clean, turns))).toEqual([TEXT]);
	});

	it.each([5, 12, 33, 45])('reads a symbol rotated %i degrees', (degrees) => {
		expect(texts(rotate(clean, degrees))).toEqual([TEXT]);
	});

	it('reads a mirrored symbol and says so', () => {
		const [symbol] = read(mirror(clean));
		expect(symbol?.read.bitstream.text).toBe(TEXT);
		expect(symbol?.read.mirrored).toBe(true);
	});

	it('reads a dark-mode screenshot and says it was inverted', () => {
		const [symbol] = read(invert(clean));
		expect(symbol?.read.bitstream.text).toBe(TEXT);
		expect(symbol?.inverted).toBe(true);
	});

	it('reads an inverted symbol when told it is light-on-dark, first rung', () => {
		const frames: DecodeFrame[] = [];
		read(invert(clean), { polarity: 'light-on-dark', onTelemetry: (frame) => frames.push(frame) });
		const decoded = frames.find((frame) => frame.stage === 'decoded');
		expect(decoded?.stage === 'decoded' && decoded.attempts).toBe(1);
	});

	it('reads under a brightness gradient', () => {
		expect(texts(gradient(clean, 140))).toEqual([TEXT]);
	});

	it('reads a slightly out of focus symbol', () => {
		expect(texts(blur(clean, 2))).toEqual([TEXT]);
	});

	it('reads a noisy capture', () => {
		expect(texts(noise(clean, 70, 7))).toEqual([TEXT]);
	});

	it('reads a keystoned symbol', () => {
		expect(texts(perspective(pad(clean, 30), 0.25))).toEqual([TEXT]);
	});

	it('reads a symbol photographed at an angle', () => {
		const large = encode('x'.repeat(200), { ecLevel: 'M' }).matrix;
		const photo = place(draw(large, 6), { yaw: 28, pitch: 12, background: 236 });
		expect(texts(photo.image)).toEqual(['x'.repeat(200)]);
	});

	it('reads through glare', () => {
		expect(texts(glare(clean, 150))).toEqual([TEXT]);
	});

	it('reads a dim, noisy capture that needs half scale', () => {
		expect(texts(noise(dim(clean, 0.3, 14), 30, 3))).toEqual([TEXT]);
	});

	it('reads a symbol below the sampling floor by scaling it up', () => {
		const frames: DecodeFrame[] = [];
		const image = pad(blur(shrink(draw(ours(), 10), 10 / 2.2), 1), 8);
		expect(texts(image, { onTelemetry: (frame) => frames.push(frame) })).toEqual([TEXT]);
		const decoded = frames.find((frame) => frame.stage === 'decoded');
		expect(decoded?.stage === 'decoded' && decoded.attempts).toBe(9);
	});

	it('reads a photograph with several problems at once', () => {
		const image = noise(blur(gradient(perspective(pad(clean, 40), 0.15), 70), 1), 20, 11);
		expect(texts(image)).toEqual([TEXT]);
	});
});

describe('several codes in one picture', () => {
	function scene(count: number, scale = 4): { image: RgbaImage; expected: string[] } {
		const symbols = Array.from({ length: count }, (_, i) =>
			draw(ours(`https://example.com/code/${i}`, 'M'), scale),
		);
		const side = symbols[0]!.width;
		const columns = Math.ceil(Math.sqrt(count));
		const image = blankImage(columns * side, Math.ceil(count / columns) * side);
		symbols.forEach((symbol, i) =>
			paste(image, symbol, (i % columns) * side, Math.floor(i / columns) * side),
		);
		return { image, expected: symbols.map((_, i) => `https://example.com/code/${i}`) };
	}

	it('finds every code, each once', () => {
		for (const count of [2, 3, 4, 6]) {
			const { image, expected } = scene(count);
			expect(texts(image).sort(), `${count} codes`).toEqual(expected.sort());
		}
	});

	it('stops at maxSymbols', () => {
		const { image } = scene(4);
		expect(read(image, { maxSymbols: 2 })).toHaveLength(2);
		expect(read(image, { maxSymbols: 1 })).toHaveLength(1);
	});

	it('finds codes of different sizes side by side, and a rotated one', () => {
		const small = draw(ours('https://example.com/a', 'L'), 3);
		const large = rotate(draw(ours('https://example.com/b'.repeat(3), 'H'), 4), 20);
		const image = blankImage(small.width + large.width + 20, Math.max(small.height, large.height));
		paste(image, small, 0, 0);
		paste(image, large, small.width + 20, 0);
		expect(texts(image).sort()).toEqual([
			'https://example.com/a',
			'https://example.com/b'.repeat(3),
		]);
	});

	it('gives the corners of each code where it was drawn', () => {
		const { image } = scene(2);
		const symbols = read(image);
		const lefts = symbols.map((symbol) => Math.round(symbol.corners[0].x)).sort((a, b) => a - b);
		const side = image.width / 2;
		expect(lefts).toEqual([16, side + 16]);
	});
});

describe('erasures', () => {
	it('reads a code under a mid-grey logo with erasures that it cannot read without them', () => {
		const image = paint(
			draw(encode('https://example.com/menu/table-12', { ecLevel: 'Q' }).matrix, 6),
			{ x: 0.33, y: 0.33, width: 0.34, height: 0.34 },
			128,
		);
		const [symbol] = read(image, { erasures: true });
		expect(symbol?.read.bitstream.text).toBe('https://example.com/menu/table-12');
		expect(symbol?.read.erasuresUsed).toBeGreaterThan(0);
		expect(symbol?.minConfidence).toBeLessThan(0.2);
		expect(decodeImage(image, { erasures: false }).ok).toBe(false);
	});

	it('marks the uncertain modules in telemetry', () => {
		const frames: DecodeFrame[] = [];
		const image = paint(draw(ours(TEXT, 'H'), 6), { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 128);
		read(image, { onTelemetry: (frame) => frames.push(frame) });
		const sampled = frames.find((frame) => frame.stage === 'sampled');
		expect(sampled?.stage === 'sampled' && sampled.uncertain.some((flag) => flag === 1)).toBe(true);
	});

	it('reads a symbol whose corner runs off the picture, the missing modules as erasures', () => {
		// Turned 45 degrees so the bottom right corner, the one with no finder,
		// points down, then cut off two modules short of that corner's tip.
		const matrix = ours('https://example.com/edge', 'H');
		const turned = rotate(draw(matrix, 6), 45);
		const tip = turned.height / 2 + ((matrix.width * 6) / 2) * Math.SQRT2;
		const cropped = blankImage(turned.width, Math.round(tip - 2 * 6 * Math.SQRT2));
		paste(cropped, turned, 0, 0);
		const frames: DecodeFrame[] = [];
		expect(texts(cropped, { onTelemetry: (frame) => frames.push(frame) })).toEqual([
			'https://example.com/edge',
		]);
		const located = frames.find((frame) => frame.stage === 'located');
		const bottom = located?.stage === 'located' ? Math.max(...located.corners.map((p) => p.y)) : 0;
		expect(bottom).toBeGreaterThan(cropped.height);
	});
});

describe('budgets and determinism', () => {
	it('gives the same answer twice, down to every number', () => {
		const image = noise(rotate(draw(ours(), 5), 17), 40, 9);
		expect(JSON.stringify(read(image))).toBe(JSON.stringify(read(image)));
	});

	it('does not read a clock it was not given, and does not depend on the one it was', () => {
		const image = draw(ours());
		let calls = 0;
		const slow = (): number => {
			calls += 1;
			return calls * 1000;
		};
		const timed = read(image, { clock: slow });
		expect(calls).toBeGreaterThan(0);
		expect(JSON.stringify(timed)).toBe(JSON.stringify(read(image)));
	});

	it('stops starting rungs when the clock passes the time budget', () => {
		const image = noise(blankImage(200, 200, 128), 127, 5);
		const frames: DecodeFrame[] = [];
		let now = 0;
		const result = decodeImage(image, {
			clock: () => (now += 10),
			budget: { maxMs: 25 },
			onTelemetry: (frame) => frames.push(frame),
		});
		expect(result.ok).toBe(false);
		const failed = frames.find((frame) => frame.stage === 'failed');
		expect(failed?.stage === 'failed' && failed.attempts).toBeLessThan(9);
		expect(failed?.stage === 'failed' && failed.ms).toBeGreaterThan(0);
	});

	it('tries only maxAttempts rungs', () => {
		const image = pad(blur(shrink(draw(ours(), 10), 10 / 2.2), 1), 8);
		expect(decodeImage(image, { budget: { maxAttempts: 5 } }).ok).toBe(false);
		expect(decodeImage(image).ok).toBe(true);
	});

	it('works on at most maxPixels, scaling the corners back to the source', () => {
		const frames: DecodeFrame[] = [];
		const image = draw(ours(), 12);
		const [symbol] = read(image, {
			budget: { maxPixels: 120_000 },
			onTelemetry: (frame) => frames.push(frame),
		});
		const source = frames.find((frame) => frame.stage === 'source');
		expect(source?.stage === 'source' && source.workWidth * source.workHeight).toBeLessThanOrEqual(
			120_000,
		);
		expect(symbol?.corners[0].x).toBeCloseTo(48, -1);
		expect(DEFAULT_MAX_PIXELS).toBe(2_500_000);
	});
});

describe('failures', () => {
	it('reports nothing found in a blank or noisy picture', () => {
		for (const image of [
			blankImage(200, 200, 255),
			blankImage(200, 200, 0),
			noise(blankImage(200, 200, 128), 127, 3),
		]) {
			const error = failure(image);
			expect(error.code).toBe('decode/not-found');
			expect(error.params.stage).toBe('finders');
		}
	});

	it('reports a symbol found but too damaged as unreadable, with the furthest stage', () => {
		const image = paint(draw(ours(TEXT, 'L'), 6), { x: 0.3, y: 0.3, width: 0.45, height: 0.45 }, 0);
		const error = failure(image);
		expect(error.code).toBe('decode/unreadable');
		expect(['reed-solomon', 'format', 'version']).toContain(error.params.stage);
	});

	it('reports finders with no symbol behind them as not found, at geometry', () => {
		const matrix = ours();
		// Three finders and nothing between them but noise: the timing pattern
		// never reads, so no grid lands.
		const scrambled = matrix.clone();
		const random = createPrng(31);
		// Seeded noise rather than a formula: a periodic pattern can be one of
		// QR's own masks, which unmasks to all-zero codewords and so to a valid,
		// empty symbol.
		for (let y = 0; y < matrix.height; y += 1) {
			for (let x = 0; x < matrix.width; x += 1) {
				const finder =
					(x < 8 && y < 8) || (x >= matrix.width - 8 && y < 8) || (x < 8 && y >= matrix.height - 8);
				if (!finder) scrambled.set(x, y, random.int(2) === 1);
			}
		}
		const error = failure(draw(scrambled));
		expect(error.code).toBe('decode/not-found');
		expect(error.params.stage).toBe('geometry');
	});

	it('refuses a caller mistake with a TypeError', () => {
		const image = draw(ours());
		const bad: unknown[] = [
			{ profile: 'careful' },
			{ polarity: 'sideways' },
			{ maxSymbols: 0 },
			{ budget: { maxPixels: -1 } },
			{ budget: { maxAttempts: 1.5 } },
			{ budget: { maxMs: 10 } },
			{ budget: { maxMs: -1 }, clock: () => 0 },
			{ clock: 5 },
			{ symbologies: ['data-matrix'] },
			{ symbologies: 'qr' },
		];
		for (const options of bad) {
			expect(() => decodeImage(image, options as DecodeOptions), JSON.stringify(options)).toThrow(
				TypeError,
			);
		}
		expect(() => decodeImage({ width: 2, height: 2, data: new Uint8ClampedArray(3) })).toThrow(
			TypeError,
		);
		expect(() => decodeImage(null as unknown as RgbaImage)).toThrow(TypeError);
	});

	it('finds nothing with a symbology it has no locator for, which decodeMatrix still reads', () => {
		const qr = createSymbologyRegistry().require('qr');
		const custom: SymbologyEntry = { ...qr, id: 'custom-square' };
		const registry = new Registry<SymbologyEntry>('symbology', [custom]);
		const built = encode(TEXT);
		const error = decodeImage(draw(built.matrix), {}, registry);
		expect(error.ok).toBe(false);
		expect(error.ok || error.error.code).toBe('decode/not-found');
		expect(decodeMatrix(built.matrix, {}, registry).bitstream.text).toBe(TEXT);
	});
});

describe('decodeMatrix', () => {
	it('reads a matrix with whichever symbology has its size', () => {
		const built = encode(TEXT, { ecLevel: 'Q' });
		const read = decodeMatrix(built.matrix);
		expect(read.bitstream.text).toBe(TEXT);
		expect(read.ecLevel).toBe('Q');
		expect(decodeMatrix(built.matrix, { strict: true }).bitstream.text).toBe(TEXT);
		expect(decodeMatrix(built.matrix.mirrored()).mirrored).toBe(true);
	});

	it('refuses a mirrored matrix when strict, and a size no symbology has', () => {
		const built = encode(TEXT);
		expect(() => decodeMatrix(built.matrix.mirrored(), { strict: true })).toThrow(QrStudioError);
		const odd = encode(TEXT).matrix;
		const wrong = new (odd.constructor as typeof BitMatrix)(20, 20);
		try {
			decodeMatrix(wrong);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).params.stage).toBe('version');
		}
	});

	it('keeps to the symbologies it is asked for', () => {
		const built = encode(TEXT);
		const registry = new Registry<SymbologyEntry>('symbology', [
			createSymbologyRegistry().require('qr'),
			{ ...createSymbologyRegistry().require('qr'), id: 'other' },
		]);
		expect(decodeMatrix(built.matrix, { symbologies: ['other'] }, registry).bitstream.text).toBe(
			TEXT,
		);
		expect(() => decodeMatrix(built.matrix, { symbologies: ['absent'] })).toThrow(TypeError);
		expect(() => decodeMatrix(built.matrix, { strict: 'yes' as unknown as boolean })).toThrow(
			TypeError,
		);
	});
});
