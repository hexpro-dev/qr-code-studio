/**
 * Micro QR's format information: the BCH(15, 5) words, their placement, and
 * how far a damaged word is trusted.
 */

import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../../src/core/index.js';
import {
	decodeMicroFormat,
	microFormatTable,
	microFormatWord,
	readMicroFormatWord,
	writeMicroFormat,
} from '../../../src/symbology/micro/format.js';
import { seeded } from './helpers.js';

function popcount(value: number): number {
	let count = 0;
	for (let rest = value; rest !== 0; rest &= rest - 1) count += 1;
	return count;
}

describe('Micro QR format information', () => {
	it('gives M2-L with mask 01 the word in the specification worked example', () => {
		// ISO/IEC 18004 Annex C, Table C.1, as the M2-L "01234567" example cites
		// it: symbol number 001, mask 01, 101000010011001.
		expect(microFormatWord(1, 1)).toBe(0b101000010011001);
	});

	it('keeps every pair of words at least 7 bits apart', () => {
		const words = microFormatTable();
		expect(words).toHaveLength(32);
		let closest = 15;
		for (let a = 0; a < 32; a += 1) {
			for (let b = a + 1; b < 32; b += 1)
				closest = Math.min(closest, popcount(words[a]! ^ words[b]!));
		}
		expect(closest).toBe(7);
	});

	it('never produces an all-light word, which is what the 0x4445 mask is for', () => {
		expect(microFormatTable().every((word) => word !== 0)).toBe(true);
	});

	it('writes and reads back every word through the matrix', () => {
		for (let data = 0; data < 32; data += 1) {
			const matrix = new BitMatrix(17, 17);
			writeMicroFormat(matrix, microFormatTable()[data]!);
			expect(readMicroFormatWord(matrix)).toBe(microFormatTable()[data]);
			expect(decodeMicroFormat(readMicroFormatWord(matrix), 0)).toEqual({
				symbolNumber: data >>> 2,
				mask: data & 3,
				distance: 0,
			});
		}
	});

	it('corrects up to three bits leniently and one strictly', () => {
		const random = seeded(0xf0);
		for (let trial = 0; trial < 200; trial += 1) {
			const data = random.int(32);
			const flips = 1 + random.int(3);
			let word = microFormatTable()[data]!;
			const used = new Set<number>();
			while (used.size < flips) used.add(random.int(15));
			for (const bit of used) word ^= 1 << bit;
			expect(decodeMicroFormat(word, 3)?.symbolNumber).toBe(data >>> 2);
			expect(decodeMicroFormat(word, 3)?.distance).toBe(flips);
			if (flips === 1) expect(decodeMicroFormat(word, 1)?.mask).toBe(data & 3);
			else expect(decodeMicroFormat(word, 1)).toBeUndefined();
		}
	});
});
