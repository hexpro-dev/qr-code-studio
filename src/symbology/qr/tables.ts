/**
 * QR Model 2's tables, as data.
 *
 * Lifted from the authenticator package (`src/qr/tables.ts` there), where
 * they were transcribed from ISO/IEC 18004:2015 Tables 1, 7, 9 and E.1 and
 * checked row by row against the arithmetic the specification guarantees.
 * `tests/symbology/qr/tables.test.ts` keeps those invariants (block sizes
 * summing to the total codeword count, group 2 always one data codeword
 * longer than group 1, alignment counts following from the version, the data
 * region holding exactly the codewords plus the remainder bits) and adds the
 * `qrcode` package's own tables as an oracle, which catches a transcription
 * slip without anyone proofreading 160 rows.
 */

import type { EcLevel } from '../../segment/types.js';

/* Error correction levels. */

/**
 * Two different orderings of the same four levels, and they are not
 * interchangeable.
 *
 * `EC_INDEX` is the order the block tables are written in: L, M, Q, H,
 * weakest to strongest. `EC_FORMAT_BITS` is the two-bit value written into
 * the format information, and the specification assigns those in a different
 * order: M, L, H, Q (Table 12). The two are a permutation with no fixed
 * point, so code that reaches for the wrong one is wrong for every symbol it
 * touches, at every level. Both are spelled out so a reader has to pick one.
 */
export const EC_INDEX: Readonly<Record<EcLevel, number>> = Object.freeze({
	L: 0,
	M: 1,
	Q: 2,
	H: 3,
});
export const EC_FORMAT_BITS: Readonly<Record<EcLevel, number>> = Object.freeze({
	M: 0b00,
	L: 0b01,
	H: 0b10,
	Q: 0b11,
});
/** Weakest to strongest, the order `boostEc` climbs. */
export const EC_LEVELS: readonly EcLevel[] = Object.freeze(['L', 'M', 'Q', 'H']);
/** The level for each two-bit format value. */
export const EC_FROM_FORMAT_BITS: readonly EcLevel[] = Object.freeze(['M', 'L', 'H', 'Q']);

/* Block structure (ISO/IEC 18004 Table 9). */

/**
 * Indexed `(version - 1) * 4 + EC_INDEX[level]`, so the rows below read
 * version by version in L, M, Q, H order.
 *
 * Each row is [check codewords per block, group 1 blocks, group 1 data
 * codewords, group 2 blocks, group 2 data codewords].
 */
const EC_BLOCK_ROWS: readonly (readonly [number, number, number, number, number])[] = [
	// v1
	[7, 1, 19, 0, 0],
	[10, 1, 16, 0, 0],
	[13, 1, 13, 0, 0],
	[17, 1, 9, 0, 0],
	// v2
	[10, 1, 34, 0, 0],
	[16, 1, 28, 0, 0],
	[22, 1, 22, 0, 0],
	[28, 1, 16, 0, 0],
	// v3
	[15, 1, 55, 0, 0],
	[26, 1, 44, 0, 0],
	[18, 2, 17, 0, 0],
	[22, 2, 13, 0, 0],
	// v4
	[20, 1, 80, 0, 0],
	[18, 2, 32, 0, 0],
	[26, 2, 24, 0, 0],
	[16, 4, 9, 0, 0],
	// v5
	[26, 1, 108, 0, 0],
	[24, 2, 43, 0, 0],
	[18, 2, 15, 2, 16],
	[22, 2, 11, 2, 12],
	// v6
	[18, 2, 68, 0, 0],
	[16, 4, 27, 0, 0],
	[24, 4, 19, 0, 0],
	[28, 4, 15, 0, 0],
	// v7
	[20, 2, 78, 0, 0],
	[18, 4, 31, 0, 0],
	[18, 2, 14, 4, 15],
	[26, 4, 13, 1, 14],
	// v8
	[24, 2, 97, 0, 0],
	[22, 2, 38, 2, 39],
	[22, 4, 18, 2, 19],
	[26, 4, 14, 2, 15],
	// v9
	[30, 2, 116, 0, 0],
	[22, 3, 36, 2, 37],
	[20, 4, 16, 4, 17],
	[24, 4, 12, 4, 13],
	// v10
	[18, 2, 68, 2, 69],
	[26, 4, 43, 1, 44],
	[24, 6, 19, 2, 20],
	[28, 6, 15, 2, 16],
	// v11
	[20, 4, 81, 0, 0],
	[30, 1, 50, 4, 51],
	[28, 4, 22, 4, 23],
	[24, 3, 12, 8, 13],
	// v12
	[24, 2, 92, 2, 93],
	[22, 6, 36, 2, 37],
	[26, 4, 20, 6, 21],
	[28, 7, 14, 4, 15],
	// v13
	[26, 4, 107, 0, 0],
	[22, 8, 37, 1, 38],
	[24, 8, 20, 4, 21],
	[22, 12, 11, 4, 12],
	// v14
	[30, 3, 115, 1, 116],
	[24, 4, 40, 5, 41],
	[20, 11, 16, 5, 17],
	[24, 11, 12, 5, 13],
	// v15
	[22, 5, 87, 1, 88],
	[24, 5, 41, 5, 42],
	[30, 5, 24, 7, 25],
	[24, 11, 12, 7, 13],
	// v16
	[24, 5, 98, 1, 99],
	[28, 7, 45, 3, 46],
	[24, 15, 19, 2, 20],
	[30, 3, 15, 13, 16],
	// v17
	[28, 1, 107, 5, 108],
	[28, 10, 46, 1, 47],
	[28, 1, 22, 15, 23],
	[28, 2, 14, 17, 15],
	// v18
	[30, 5, 120, 1, 121],
	[26, 9, 43, 4, 44],
	[28, 17, 22, 1, 23],
	[28, 2, 14, 19, 15],
	// v19
	[28, 3, 113, 4, 114],
	[26, 3, 44, 11, 45],
	[26, 17, 21, 4, 22],
	[26, 9, 13, 16, 14],
	// v20
	[28, 3, 107, 5, 108],
	[26, 3, 41, 13, 42],
	[30, 15, 24, 5, 25],
	[28, 15, 15, 10, 16],
	// v21
	[28, 4, 116, 4, 117],
	[26, 17, 42, 0, 0],
	[28, 17, 22, 6, 23],
	[30, 19, 16, 6, 17],
	// v22
	[28, 2, 111, 7, 112],
	[28, 17, 46, 0, 0],
	[30, 7, 24, 16, 25],
	[24, 34, 13, 0, 0],
	// v23
	[30, 4, 121, 5, 122],
	[28, 4, 47, 14, 48],
	[30, 11, 24, 14, 25],
	[30, 16, 15, 14, 16],
	// v24
	[30, 6, 117, 4, 118],
	[28, 6, 45, 14, 46],
	[30, 11, 24, 16, 25],
	[30, 30, 16, 2, 17],
	// v25
	[26, 8, 106, 4, 107],
	[28, 8, 47, 13, 48],
	[30, 7, 24, 22, 25],
	[30, 22, 15, 13, 16],
	// v26
	[28, 10, 114, 2, 115],
	[28, 19, 46, 4, 47],
	[28, 28, 22, 6, 23],
	[30, 33, 16, 4, 17],
	// v27
	[30, 8, 122, 4, 123],
	[28, 22, 45, 3, 46],
	[30, 8, 23, 26, 24],
	[30, 12, 15, 28, 16],
	// v28
	[30, 3, 117, 10, 118],
	[28, 3, 45, 23, 46],
	[30, 4, 24, 31, 25],
	[30, 11, 15, 31, 16],
	// v29
	[30, 7, 116, 7, 117],
	[28, 21, 45, 7, 46],
	[30, 1, 23, 37, 24],
	[30, 19, 15, 26, 16],
	// v30
	[30, 5, 115, 10, 116],
	[28, 19, 47, 10, 48],
	[30, 15, 24, 25, 25],
	[30, 23, 15, 25, 16],
	// v31
	[30, 13, 115, 3, 116],
	[28, 2, 46, 29, 47],
	[30, 42, 24, 1, 25],
	[30, 23, 15, 28, 16],
	// v32
	[30, 17, 115, 0, 0],
	[28, 10, 46, 23, 47],
	[30, 10, 24, 35, 25],
	[30, 19, 15, 35, 16],
	// v33
	[30, 17, 115, 1, 116],
	[28, 14, 46, 21, 47],
	[30, 29, 24, 19, 25],
	[30, 11, 15, 46, 16],
	// v34
	[30, 13, 115, 6, 116],
	[28, 14, 46, 23, 47],
	[30, 44, 24, 7, 25],
	[30, 59, 16, 1, 17],
	// v35
	[30, 12, 121, 7, 122],
	[28, 12, 47, 26, 48],
	[30, 39, 24, 14, 25],
	[30, 22, 15, 41, 16],
	// v36
	[30, 6, 121, 14, 122],
	[28, 6, 47, 34, 48],
	[30, 46, 24, 10, 25],
	[30, 2, 15, 64, 16],
	// v37
	[30, 17, 122, 4, 123],
	[28, 29, 46, 14, 47],
	[30, 49, 24, 10, 25],
	[30, 24, 15, 46, 16],
	// v38
	[30, 4, 122, 18, 123],
	[28, 13, 46, 32, 47],
	[30, 48, 24, 14, 25],
	[30, 42, 15, 32, 16],
	// v39
	[30, 20, 117, 4, 118],
	[28, 40, 47, 7, 48],
	[30, 43, 24, 22, 25],
	[30, 10, 15, 67, 16],
	// v40
	[30, 19, 118, 6, 119],
	[28, 18, 47, 31, 48],
	[30, 34, 24, 34, 25],
	[30, 20, 15, 61, 16],
];

export interface EcRow {
	readonly ecPerBlock: number;
	readonly group1Blocks: number;
	readonly group1Data: number;
	readonly group2Blocks: number;
	readonly group2Data: number;
}

export function ecRow(version: number, level: EcLevel): EcRow {
	const row = EC_BLOCK_ROWS[(version - 1) * 4 + (EC_INDEX[level] as number)];
	if (row === undefined) throw new TypeError('there is no QR version or level like that');
	const [ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data] = row;
	return { ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data };
}

/**
 * Misdecode protection, the p of ISO/IEC 18004 Table 9.
 *
 * The smallest symbols keep a few check codewords back from correction, so
 * that a damaged block is refused rather than "corrected" into a different
 * valid block: with only 7 check codewords, using all of them to correct 3
 * errors leaves nothing to notice a fourth. Errors correctable per block are
 * floor((ec - p) / 2).
 */
export function misdecodeProtection(version: number, level: EcLevel): number {
	if (version === 1) return level === 'L' ? 3 : level === 'M' ? 2 : 1;
	if (version === 2 && level === 'L') return 2;
	if (version === 3 && level === 'L') return 1;
	return 0;
}

/** Total codewords in a symbol, indexed by version - 1. */
export const TOTAL_CODEWORDS: readonly number[] = Object.freeze([
	26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
	1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034,
	3196, 3362, 3532, 3706,
]);

/**
 * Bits left over after the codewords, indexed by version - 1.
 *
 * The data region is not always a whole number of codewords, so a few zero bits
 * are written at the end. They carry nothing but they occupy module positions,
 * so a decoder that forgets them reads the last codeword from the wrong place.
 */
export const REMAINDER_BITS: readonly number[] = Object.freeze([
	0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3,
	3, 0, 0, 0, 0, 0, 0,
]);

/** Row and column coordinates of alignment pattern centres, indexed by version - 1. */
export const ALIGNMENT_CENTRES: readonly (readonly number[])[] = Object.freeze([
	[],
	[6, 18],
	[6, 22],
	[6, 26],
	[6, 30],
	[6, 34],
	[6, 22, 38],
	[6, 24, 42],
	[6, 26, 46],
	[6, 28, 50],
	[6, 30, 54],
	[6, 32, 58],
	[6, 34, 62],
	[6, 26, 46, 66],
	[6, 26, 48, 70],
	[6, 26, 50, 74],
	[6, 30, 54, 78],
	[6, 30, 56, 82],
	[6, 30, 58, 86],
	[6, 34, 62, 90],
	[6, 28, 50, 72, 94],
	[6, 26, 50, 74, 98],
	[6, 30, 54, 78, 102],
	[6, 28, 54, 80, 106],
	[6, 32, 58, 84, 110],
	[6, 30, 58, 86, 114],
	[6, 34, 62, 90, 118],
	[6, 26, 50, 74, 98, 122],
	[6, 30, 54, 78, 102, 126],
	[6, 26, 52, 78, 104, 130],
	[6, 30, 56, 82, 108, 134],
	[6, 34, 60, 86, 112, 138],
	[6, 30, 58, 86, 114, 142],
	[6, 34, 62, 90, 118, 146],
	[6, 30, 54, 78, 102, 126, 150],
	[6, 24, 50, 76, 102, 128, 154],
	[6, 28, 54, 80, 106, 132, 158],
	[6, 32, 58, 84, 110, 136, 162],
	[6, 26, 54, 82, 110, 138, 166],
	[6, 30, 58, 86, 114, 142, 170],
]);
