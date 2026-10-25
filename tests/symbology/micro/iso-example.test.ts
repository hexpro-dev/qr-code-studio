/**
 * The specification's worked Micro QR example: "01234567" in M2-L.
 *
 * ISO/IEC 18004:2015 7.4.3 gives the bit stream for these eight digits in an
 * M2 symbol as its second numeric mode example: mode indicator 0, count 1000,
 * then 0000001100 0101011001 1000011 for 012, 345 and 67. The standard's
 * symbol encoding walk-through carries the same symbol on to its codewords,
 * mask and format word. That text is not reproduced in any permissively
 * licensed source this package could find, so the numbers below were taken
 * from a published walk-through of GOST R ISO/IEC 18004-2015, the Russian
 * adoption of the same text (habr.com/en/articles/784828), and each is checked
 * here against what both independent encoders, BWIPP and zint, produce for the
 * same input. When the owner's copy of ISO/IEC 18004:2024 arrives, this file
 * is the one to hold against it.
 */

import { describe, expect, it } from 'vitest';
import { buildMicro, readMicroCodewords } from '../../../src/symbology/micro/entry.js';
import { microFormatWord, readMicroFormatWord } from '../../../src/symbology/micro/format.js';
import { microMaskScore } from '../../../src/symbology/micro/mask.js';
import { MICRO_FIELDS } from './fields.js';
import { bwipMatrix, dataCodewords, zxingRead, zxingWrite } from './helpers.js';

const DATA = [0x40, 0x18, 0xac, 0xc3, 0x00];
const CHECK = [0x86, 0x0d, 0x22, 0xae, 0x30];

describe('the ISO/IEC 18004 Micro QR example, 01234567 in M2-L', () => {
	const built = buildMicro(Uint8Array.from(DATA), 'M2', 'L', 'auto');

	it('has the data codewords of the example bit stream', () => {
		const ours = dataCodewords(
			{ mode: 'numeric', text: '01234567', chars: 8 },
			MICRO_FIELDS.M2,
			5,
			8,
		);
		expect([...ours]).toEqual(DATA);
	});

	it('adds the example check codewords', () => {
		expect([...built.codewords]).toEqual([...DATA, ...CHECK]);
	});

	it('chooses mask 01, which ties 10 at a score of 136 and wins as the lower', () => {
		const scores = [0, 1, 2, 3].map((mask) =>
			microMaskScore(buildMicro(Uint8Array.from(DATA), 'M2', 'L', mask).matrix),
		);
		expect(scores).toEqual([72, 136, 136, 68]);
		expect(built.mask).toBe(1);
	});

	it('writes format word 101000010011001', () => {
		expect(microFormatWord(1, 1)).toBe(0x5099);
		expect(readMicroFormatWord(built.matrix)).toBe(0x5099);
	});

	it('is the symbol BWIPP and zint make, and zxing-cpp reads it', async () => {
		expect(
			built.matrix.equals(
				bwipMatrix({ bcid: 'microqrcode', text: '01234567', version: 'M2', eclevel: 'L' }),
			),
		).toBe(true);
		const zint = await zxingWrite('01234567', 'MicroQRCode', 'version=2,ecLevel=L');
		expect(built.matrix.equals(zint)).toBe(true);
		const read = await zxingRead(built.matrix, 'MicroQRCode');
		expect([read?.text, read?.version, read?.ecLevel]).toEqual(['01234567', 'M2', 'L']);
	});

	it('reads back to the same codewords', () => {
		const read = readMicroCodewords(built.matrix, { strict: true });
		expect([...read.data]).toEqual(DATA);
		expect([read.version, read.ecLevel, read.mask, read.formatErrors]).toEqual(['M2', 'L', 1, 0]);
	});
});
