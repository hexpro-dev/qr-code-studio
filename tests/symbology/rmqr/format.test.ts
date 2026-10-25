/**
 * rMQR's format information: two BCH(18, 6) copies under different masks, and
 * how a reader weighs them.
 */

import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../../src/core/index.js';
import {
	decodeRmqrFormat,
	readRmqrFormatWord,
	RMQR_FORMAT_MASKS,
	rmqrFormatTables,
	writeRmqrFormat,
} from '../../../src/symbology/rmqr/format.js';
import {
	rmqrFormatModulesNearFinder,
	rmqrFormatModulesNearSubFinder,
} from '../../../src/symbology/rmqr/layout.js';

function popcount(value: number): number {
	let count = 0;
	for (let rest = value; rest !== 0; rest &= rest - 1) count += 1;
	return count;
}

const [FIRST, SECOND] = rmqrFormatTables() as [readonly number[], readonly number[]];

describe('rMQR format information', () => {
	it('uses the masks from the standard', () => {
		expect(RMQR_FORMAT_MASKS).toEqual([0x1fab2, 0x20a7b]);
		// Data 0 encodes to 0, so each copy's word for R7x43-M is its mask.
		expect([FIRST[0], SECOND[0]]).toEqual([0x1fab2, 0x20a7b]);
	});

	it('keeps every pair of words in a copy at least 8 bits apart', () => {
		for (const table of [FIRST, SECOND]) {
			let closest = 18;
			for (let a = 0; a < 64; a += 1) {
				for (let b = a + 1; b < 64; b += 1)
					closest = Math.min(closest, popcount(table[a]! ^ table[b]!));
			}
			expect(closest).toBe(8);
		}
	});

	it('writes both copies and reads each back', () => {
		const matrix = new BitMatrix(59, 13);
		const copies = [rmqrFormatModulesNearFinder(), rmqrFormatModulesNearSubFinder(59, 13)];
		writeRmqrFormat(matrix, copies, 32 + 18);
		expect(readRmqrFormatWord(matrix, copies[0]!)).toBe(FIRST[50]);
		expect(readRmqrFormatWord(matrix, copies[1]!)).toBe(SECOND[50]);
	});

	it('holds a strict read to both copies within a bit and agreeing', () => {
		expect(decodeRmqrFormat([FIRST[9]!, SECOND[9]!], true)).toEqual({ data: 9, distance: 0 });
		expect(decodeRmqrFormat([FIRST[9]! ^ 1, SECOND[9]! ^ 2], true)).toEqual({
			data: 9,
			distance: 1,
		});
		expect(decodeRmqrFormat([FIRST[9]! ^ 3, SECOND[9]!], true)).toBeUndefined();
		expect(decodeRmqrFormat([FIRST[9]!, SECOND[10]!], true)).toBeUndefined();
		expect(decodeRmqrFormat([FIRST[9]!, 0], true)).toBeUndefined();
	});

	it('lets a lenient read lean on either copy', () => {
		// Both agree: the better copy's distance is reported.
		expect(decodeRmqrFormat([FIRST[40]! ^ 0b111, SECOND[40]! ^ 0b1], false)).toEqual({
			data: 40,
			distance: 1,
		});
		// One copy gone: the other is enough.
		expect(decodeRmqrFormat([FIRST[40]! ^ 0b11, SECOND[40]! ^ 0b11110], false)).toEqual({
			data: 40,
			distance: 2,
		});
		expect(decodeRmqrFormat([FIRST[40]! ^ 0b11110, SECOND[40]! ^ 0b1], false)).toEqual({
			data: 40,
			distance: 1,
		});
		// Both gone.
		expect(decodeRmqrFormat([FIRST[40]! ^ 0b1111, SECOND[40]! ^ 0b1111], false)).toBeUndefined();
		// Disagreeing: the strictly nearer copy is believed, either way round.
		expect(decodeRmqrFormat([FIRST[3]!, SECOND[7]! ^ 0b101], false)).toEqual({
			data: 3,
			distance: 0,
		});
		expect(decodeRmqrFormat([FIRST[3]! ^ 0b101, SECOND[7]!], false)).toEqual({
			data: 7,
			distance: 0,
		});
		// Disagreeing at the same distance: refused rather than guessed.
		expect(decodeRmqrFormat([FIRST[3]! ^ 1, SECOND[7]! ^ 1], false)).toBeUndefined();
	});
});
