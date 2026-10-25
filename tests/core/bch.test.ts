/**
 * BCH, against the tables in ISO/IEC 18004 and the `qrcode` package.
 *
 * Annex C Table C.1 lists all 32 format codewords after the 0x5412 mask, and
 * Annex D Table D.1 all 34 version codewords. They are written out here in
 * full, in the order of their five or six data bits, and cross-checked against
 * the `qrcode` package's own encoders, which are a third independent source.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { bchEncode, bchNearest } from '../../src/core/bch.js';

const require = createRequire(import.meta.url);
const qrcodeFormat = require('qrcode/lib/core/format-info') as {
	getEncodedBits(level: unknown, mask: number): number;
};
const qrcodeVersion = require('qrcode/lib/core/version') as {
	getEncodedBits(version: number): number;
};
const qrcodeLevels = require('qrcode/lib/core/error-correction-level') as Record<string, unknown>;

/** Table C.1, indexed by the five data bits (level bits then mask), masked with 0x5412. */
const FORMAT_TABLE = [
	0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0, 0x77c4, 0x72f3, 0x7daa, 0x789d,
	0x662f, 0x6318, 0x6c41, 0x6976, 0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
	0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed,
];

/** Table D.1, versions 7 to 40. */
const VERSION_TABLE = [
	0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d, 0x0f928, 0x10b78, 0x1145d,
	0x12a17, 0x13532, 0x149a6, 0x15683, 0x168c9, 0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a,
	0x1d33f, 0x1ed75, 0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64, 0x27541,
	0x28c69,
];

const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;
const VERSION_GENERATOR = 0x1f25;

const formatCodewords = Array.from(
	{ length: 32 },
	(_, data) => bchEncode(data, 5, FORMAT_GENERATOR) ^ FORMAT_MASK,
);
const versionCodewords = Array.from({ length: 34 }, (_, i) =>
	bchEncode(i + 7, 6, VERSION_GENERATOR),
);

function distance(a: number, b: number): number {
	let rest = a ^ b;
	let count = 0;
	while (rest !== 0) {
		count += rest & 1;
		rest >>>= 1;
	}
	return count;
}

function minimumDistance(table: readonly number[]): number {
	let minimum = Infinity;
	for (let i = 0; i < table.length; i += 1) {
		for (let j = i + 1; j < table.length; j += 1) {
			minimum = Math.min(minimum, distance(table[i] as number, table[j] as number));
		}
	}
	return minimum;
}

/** Every set of up to `weight` bit positions below `bits`, as masks. */
function errorPatterns(bits: number, weight: number): number[] {
	const out: number[] = [0];
	const extend = (mask: number, from: number, left: number): void => {
		for (let bit = from; bit < bits; bit += 1) {
			const next = mask | (1 << bit);
			out.push(next);
			if (left > 1) extend(next, bit + 1, left - 1);
		}
	};
	extend(0, 0, weight);
	return out;
}

describe('bchEncode', () => {
	it('gives every format codeword in ISO/IEC 18004 Table C.1', () => {
		expect(formatCodewords).toEqual(FORMAT_TABLE);
	});

	it('gives every version codeword in ISO/IEC 18004 Table D.1', () => {
		expect(versionCodewords).toEqual(VERSION_TABLE);
	});

	it('agrees with the qrcode package on format and version information', () => {
		// qrcode indexes levels by their two format bits: M 00, L 01, H 10, Q 11.
		for (const level of ['L', 'M', 'Q', 'H']) {
			const bits = (qrcodeLevels[level] as { bit: number }).bit;
			for (let mask = 0; mask < 8; mask += 1) {
				expect(formatCodewords[(bits << 3) | mask]).toBe(
					qrcodeFormat.getEncodedBits(qrcodeLevels[level], mask),
				);
			}
		}
		for (let version = 7; version <= 40; version += 1) {
			expect(versionCodewords[version - 7]).toBe(qrcodeVersion.getEncodedBits(version));
		}
	});

	it('puts the data in the high bits and the remainder below', () => {
		expect(bchEncode(0b00111, 5, FORMAT_GENERATOR) >>> 10).toBe(0b00111);
		// The remainder of a generator by itself is zero.
		expect(bchEncode(1, 1, FORMAT_GENERATOR)).toBe(FORMAT_GENERATOR);
		expect(bchEncode(0, 5, FORMAT_GENERATOR)).toBe(0);
		// A code that uses all 31 bits.
		expect(bchEncode((1 << 20) - 1, 20, 0x805) >>> 11).toBe((1 << 20) - 1);
	});

	it('refuses shapes that do not fit 31 bits and data that does not fit its width', () => {
		expect(() => bchEncode(0, 5, 1)).toThrow(RangeError);
		expect(() => bchEncode(0, 5, 0x80000000)).toThrow(RangeError);
		expect(() => bchEncode(0, 5, 1335.5)).toThrow(RangeError);
		expect(() => bchEncode(0, 0, FORMAT_GENERATOR)).toThrow(RangeError);
		expect(() => bchEncode(0, 22, FORMAT_GENERATOR)).toThrow(RangeError);
		expect(() => bchEncode(0, 2.5, FORMAT_GENERATOR)).toThrow(RangeError);
		expect(() => bchEncode(32, 5, FORMAT_GENERATOR)).toThrow(RangeError);
		expect(() => bchEncode(-1, 5, FORMAT_GENERATOR)).toThrow(RangeError);
		expect(() => bchEncode(1.5, 5, FORMAT_GENERATOR)).toThrow(RangeError);
	});
});

describe('the codes as tables', () => {
	it('have the minimum distances their constructions promise', () => {
		// Theorems rather than values from the same source as the encoder:
		// BCH(15, 5) has distance 7, the (18, 6) version code distance 8.
		expect(minimumDistance(formatCodewords)).toBe(7);
		expect(minimumDistance(versionCodewords)).toBe(8);
		// The mask exists so that a blank region cannot read as valid format.
		expect(formatCodewords).not.toContain(0);
	});
});

describe('bchNearest', () => {
	it('recovers every format codeword through every pattern of up to 3 flipped bits', () => {
		const patterns = errorPatterns(15, 3);
		expect(patterns.length).toBe(1 + 15 + 105 + 455);
		formatCodewords.forEach((codeword, index) => {
			for (const pattern of patterns) {
				const found = bchNearest(codeword ^ pattern, formatCodewords, 3);
				if (found?.index !== index || found.distance !== distance(pattern, 0)) {
					expect(found, `format ${index}, flips ${pattern.toString(2)}`).toEqual({
						index,
						distance: distance(pattern, 0),
					});
				}
			}
		});
	});

	it('recovers every version codeword through every pattern of up to 3 flipped bits', () => {
		const patterns = errorPatterns(18, 3);
		versionCodewords.forEach((codeword, index) => {
			for (const pattern of patterns) {
				const found = bchNearest(codeword ^ pattern, versionCodewords, 3);
				if (found?.index !== index) {
					expect(found?.index, `version ${index + 7}, flips ${pattern.toString(2)}`).toBe(index);
				}
			}
		});
	});

	it('refuses every 4-bit corruption of a version codeword, which sits outside every radius', () => {
		// Distance 8 means 4 flips leave a word at least 4 from every codeword.
		for (const codeword of versionCodewords) {
			for (let a = 0; a < 18; a += 1) {
				const pattern =
					(1 << a) | (1 << ((a + 4) % 18)) | (1 << ((a + 9) % 18)) | (1 << ((a + 13) % 18));
				expect(bchNearest(codeword ^ pattern, versionCodewords, 3)).toBeUndefined();
			}
		}
	});

	it('returns undefined past maxDistance, on an empty table, and on a tie', () => {
		expect(bchNearest(formatCodewords[3] as number, formatCodewords, 0)).toEqual({
			index: 3,
			distance: 0,
		});
		expect(bchNearest((formatCodewords[3] as number) ^ 1, formatCodewords, 0)).toBeUndefined();
		expect(bchNearest(5, [], 10)).toBeUndefined();
		// 0b011 is one flip from both entries: a guess, so no answer.
		expect(bchNearest(0b011, [0b001, 0b010], 3)).toBeUndefined();
		expect(bchNearest(0b011, [0b001, 0b010, 0b011], 3)).toEqual({ index: 2, distance: 0 });
		// A tie further away than the best does not count.
		expect(bchNearest(0b0001, [0b0001, 0b0011, 0b0101], 3)).toEqual({ index: 0, distance: 0 });
	});

	it('compares all 32 bits', () => {
		expect(bchNearest(0xffffffff, [0, 0xffffffff], 0)).toEqual({ index: 1, distance: 0 });
		expect(bchNearest(0x80000000, [0, 0xffffffff], 1)).toEqual({ index: 0, distance: 1 });
	});

	it('refuses words that are not unsigned 32 bit integers', () => {
		expect(() => bchNearest(-1, [0], 1)).toThrow(RangeError);
		expect(() => bchNearest(0x100000000, [0], 1)).toThrow(RangeError);
		expect(() => bchNearest(1.5, [0], 1)).toThrow(RangeError);
		expect(() => bchNearest(0, [-1], 1)).toThrow(RangeError);
		expect(() => bchNearest(0, [0], -1)).toThrow(RangeError);
		expect(() => bchNearest(0, [0], 0.5)).toThrow(RangeError);
	});
});
