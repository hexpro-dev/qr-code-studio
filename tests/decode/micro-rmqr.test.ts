/**
 * Reading Micro QR and rMQR from pictures, end to end.
 *
 * Clean pictures only, which is the scope these two are read in: this
 * package's renders, screenshots and scans, every quarter turn, mild rotation,
 * mirror images and dark mode. Perspective is out of scope for them in this
 * version (see locate-single.ts). Neither is read by most phone cameras, and
 * the tests here say nothing to the contrary.
 */

import bwipjs from 'bwip-js';
import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import type { RgbaImage } from '../../src/core/image.js';
import { decodeImage } from '../../src/decode/decoder.js';
import type { DecodeOptions, DecodedSymbol } from '../../src/decode/types.js';
import { encode } from '../../src/encode/encode.js';
import type { EncodeOptions } from '../../src/encode/plan.js';
import { capture } from '../helpers/corpus.js';
import { invert, mirror, rotate, rotateQuarter } from '../helpers/damage.js';
import { blankImage, drawGrid, paste } from '../helpers/draw.js';

function picture(text: string, options: EncodeOptions, scale = 6): RgbaImage {
	return drawGrid(encode(text, options).matrix, { scale, quiet: 2 });
}

function read(image: RgbaImage, options: DecodeOptions = {}): readonly DecodedSymbol[] {
	const result = decodeImage(image, options);
	if (!result.ok) throw result.error;
	return result.value;
}

function bwip(bcid: string, text: string, version: string): BitMatrix {
	const raw = bwipjs.raw({ bcid, text, version } as unknown as Parameters<
		typeof bwipjs.raw
	>[0]) as unknown as { pixs: number[]; pixx: number; pixy: number }[];
	const symbol = raw[0] as { pixs: number[]; pixx: number; pixy: number };
	return new BitMatrix(symbol.pixx, symbol.pixy, Uint8Array.from(symbol.pixs));
}

const MICRO: readonly [string, EncodeOptions][] = [
	['12345', { symbology: 'micro', ecLevel: 'L', maxVersion: 'M1' }],
	['HELLO', { symbology: 'micro', minVersion: 'M2' }],
	['HELLO 2026', { symbology: 'micro', minVersion: 'M3' }],
	['HELLO MICRO', { symbology: 'micro', minVersion: 'M4', ecLevel: 'Q' }],
];

const RMQR: readonly [string, EncodeOptions][] = [
	['HELLO', { symbology: 'rmqr', rmqrPreference: 'height' }],
	['HELLO WORLD 2026', { symbology: 'rmqr' }],
	['https://example.com/r', { symbology: 'rmqr', rmqrPreference: 'width' }],
	['x'.repeat(60), { symbology: 'rmqr', ecLevel: 'H' }],
];

describe('Micro QR', () => {
	for (const [text, options] of MICRO) {
		const built = encode(text, options);
		it(`reads ${built.version} in both profiles, every quarter turn`, () => {
			const clean = drawGrid(built.matrix, { scale: 6, quiet: 2 });
			for (let turns = 0; turns < 4; turns += 1) {
				for (const profile of ['lenient', 'strict-v1'] as const) {
					const [symbol] = read(rotateQuarter(clean, turns), { profile });
					expect(symbol?.symbology, `${turns} turns, ${profile}`).toBe('micro');
					expect(symbol?.read.version).toBe(built.version);
					expect(symbol?.read.bitstream.text).toBe(text);
				}
			}
		});
	}

	it('reads a mildly rotated symbol, and one bwip-js made', () => {
		const image = picture('HELLO 2026', { symbology: 'micro', minVersion: 'M3' }, 8);
		for (const degrees of [5, -10, 15]) {
			expect(read(rotate(image, degrees))[0]?.read.bitstream.text, `${degrees}`).toBe('HELLO 2026');
		}
		const other = drawGrid(bwip('microqrcode', '0123456789', 'M3'), { scale: 6, quiet: 2 });
		expect(read(other)[0]?.read.bitstream.text).toBe('0123456789');
	});

	it('reads a mirror image and dark mode as the scanner, and refuses both when strict', () => {
		const image = picture('HELLO', { symbology: 'micro' });
		const [mirrored] = read(mirror(image));
		expect(mirrored?.read.mirrored).toBe(true);
		expect(decodeImage(mirror(image), { profile: 'strict-v1' }).ok).toBe(false);
		const [dark] = read(invert(image));
		expect(dark?.inverted).toBe(true);
		expect(decodeImage(invert(image), { profile: 'strict-v1' }).ok).toBe(false);
		expect(
			read(invert(image), { profile: 'strict-v1', polarity: 'light-on-dark' })[0]?.read.bitstream
				.text,
		).toBe('HELLO');
	});
});

describe('rMQR', () => {
	for (const [text, options] of RMQR) {
		const built = encode(text, options);
		it(`reads ${built.version} in both profiles, every quarter turn`, () => {
			const clean = drawGrid(built.matrix, { scale: 4, quiet: 2 });
			for (let turns = 0; turns < 4; turns += 1) {
				for (const profile of ['lenient', 'strict-v1'] as const) {
					const [symbol] = read(rotateQuarter(clean, turns), { profile });
					expect(symbol?.symbology, `${turns} turns, ${profile}`).toBe('rmqr');
					expect(symbol?.read.version).toBe(built.version);
					expect(symbol?.read.bitstream.text).toBe(text);
				}
			}
		});
	}

	it('reads the shortest and the longest, a mild rotation, and one bwip-js made', () => {
		for (const version of ['R7x43', 'R17x139']) {
			const built = encode('RMQR', { symbology: 'rmqr', minVersion: version, maxVersion: version });
			expect(built.version).toBe(version);
			expect(read(drawGrid(built.matrix, { scale: 3, quiet: 2 }))[0]?.read.version).toBe(version);
		}
		const image = picture('HELLO WORLD 2026', { symbology: 'rmqr' }, 6);
		for (const degrees of [4, -8]) {
			expect(read(rotate(image, degrees))[0]?.read.bitstream.text, `${degrees}`).toBe(
				'HELLO WORLD 2026',
			);
		}
		const other = drawGrid(bwip('rectangularmicroqrcode', 'ABC123', 'R11x43'), {
			scale: 5,
			quiet: 2,
		});
		expect(read(other)[0]?.read.bitstream.text).toBe('ABC123');
	});

	it('reads a mirror image the right way round and says so; strict refuses it', () => {
		const image = mirror(picture('HELLO WORLD 2026', { symbology: 'rmqr' }));
		const [symbol] = read(image);
		expect(symbol?.read.mirrored).toBe(true);
		expect(symbol?.read.bitstream.text).toBe('HELLO WORLD 2026');
		expect(decodeImage(image, { profile: 'strict-v1' }).ok).toBe(false);
	});
});

describe('the three together', () => {
	it('finds a QR code, a Micro QR symbol and an rMQR symbol in one picture', () => {
		const qr = drawGrid(encode('https://example.com/qr').matrix, { scale: 5 });
		const micro = picture('12345678', { symbology: 'micro' }, 5);
		const rmqr = picture('RECTANGLE', { symbology: 'rmqr' }, 5);
		const image = blankImage(
			Math.max(qr.width + micro.width + 20, rmqr.width),
			qr.height + rmqr.height + 20,
		);
		paste(image, qr, 0, 0);
		paste(image, micro, qr.width + 20, 0);
		paste(image, rmqr, 0, qr.height + 20);
		const found = read(image)
			.map((symbol) => `${symbol.symbology}:${symbol.read.bitstream.text}`)
			.sort();
		expect(found).toEqual(['micro:12345678', 'qr:https://example.com/qr', 'rmqr:RECTANGLE']);
		expect(read(image, { symbologies: ['micro'] }).map((symbol) => symbol.symbology)).toEqual([
			'micro',
		]);
	});

	it('reads no Micro QR or rMQR, and nothing wrong, from damaged QR captures', () => {
		const wrong: string[] = [];
		for (let seed = 50_000; seed < 50_300; seed += 1) {
			const shot = capture(seed);
			const result = decodeImage(shot.image);
			if (!result.ok) continue;
			for (const symbol of result.value) {
				if (symbol.symbology !== 'qr' || symbol.read.bitstream.text !== shot.text) {
					wrong.push(`${seed}: ${symbol.symbology}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});
});
