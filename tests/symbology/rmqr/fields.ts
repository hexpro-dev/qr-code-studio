/**
 * rMQR's tables written out a second time, for the tests, from a different
 * transcription than the source's.
 *
 * zxing-cpp (Apache 2.0): core/src/qrcode/QRCodecMode.cpp for the character
 * count widths (citing ISO/IEC 23941:2022 7.4.1 Table 3) and
 * core/src/qrcode/QRVersion.cpp for the alignment columns (Annex D Table D.1)
 * and the blocks (7.5.1 Table 8). The source's tables are BWIPP's. Each row of
 * ZXING_BLOCKS is [check symbols per block, group 1 count, group 1 data
 * codewords, group 2 count, group 2 data codewords] for M, then for H, in
 * version indicator order.
 */

import type { TestProfile } from '../micro/helpers.js';

export const RMQR_NAMES: readonly string[] = [
	'R7x43',
	'R7x59',
	'R7x77',
	'R7x99',
	'R7x139',
	'R9x43',
	'R9x59',
	'R9x77',
	'R9x99',
	'R9x139',
	'R11x27',
	'R11x43',
	'R11x59',
	'R11x77',
	'R11x99',
	'R11x139',
	'R13x27',
	'R13x43',
	'R13x59',
	'R13x77',
	'R13x99',
	'R13x139',
	'R15x43',
	'R15x59',
	'R15x77',
	'R15x99',
	'R15x139',
	'R17x43',
	'R17x59',
	'R17x77',
	'R17x99',
	'R17x139',
];

const NUMERIC = [
	4, 5, 6, 7, 7, 5, 6, 7, 7, 8, 4, 6, 7, 7, 8, 8, 5, 6, 7, 7, 8, 8, 7, 7, 8, 8, 9, 7, 8, 8, 8, 9,
];
const ALPHANUMERIC = [
	3, 5, 5, 6, 6, 5, 5, 6, 6, 7, 4, 5, 6, 6, 7, 7, 5, 6, 6, 7, 7, 8, 6, 7, 7, 7, 8, 6, 7, 7, 8, 8,
];
const BYTE = [
	3, 4, 5, 5, 6, 4, 5, 5, 6, 6, 3, 5, 5, 6, 6, 7, 4, 5, 6, 6, 7, 7, 6, 6, 7, 7, 7, 6, 6, 7, 7, 8,
];
const KANJI = [
	2, 3, 4, 5, 5, 3, 4, 5, 5, 6, 2, 4, 5, 5, 6, 6, 3, 5, 5, 6, 6, 7, 5, 5, 6, 6, 7, 5, 6, 6, 6, 7,
];

export function rmqrFields(indicator: number): TestProfile {
	return {
		modeBits: 3,
		modeIndicator: { numeric: 1, alphanumeric: 2, byte: 3, kanji: 4 },
		charCountBits: {
			numeric: NUMERIC[indicator]!,
			alphanumeric: ALPHANUMERIC[indicator]!,
			byte: BYTE[indicator]!,
			kanji: KANJI[indicator]!,
		},
		terminatorBits: 3,
	};
}

export const ZXING_ALIGNMENT: readonly (readonly number[])[] = [
	[21],
	[19, 39],
	[25, 51],
	[23, 49, 75],
	[27, 55, 83, 111],
	[21],
	[19, 39],
	[25, 51],
	[23, 49, 75],
	[27, 55, 83, 111],
	[],
	[21],
	[19, 39],
	[25, 51],
	[23, 49, 75],
	[27, 55, 83, 111],
	[],
	[21],
	[19, 39],
	[25, 51],
	[23, 49, 75],
	[27, 55, 83, 111],
	[21],
	[19, 39],
	[25, 51],
	[23, 49, 75],
	[27, 55, 83, 111],
	[21],
	[19, 39],
	[25, 51],
	[23, 49, 75],
	[27, 55, 83, 111],
];

type Blocks = readonly [number, number, number, number, number];

export const ZXING_BLOCKS: readonly (readonly [Blocks, Blocks])[] = [
	[
		[7, 1, 6, 0, 0],
		[10, 1, 3, 0, 0],
	],
	[
		[9, 1, 12, 0, 0],
		[14, 1, 7, 0, 0],
	],
	[
		[12, 1, 20, 0, 0],
		[22, 1, 10, 0, 0],
	],
	[
		[16, 1, 28, 0, 0],
		[30, 1, 14, 0, 0],
	],
	[
		[24, 1, 44, 0, 0],
		[22, 2, 12, 0, 0],
	],
	[
		[9, 1, 12, 0, 0],
		[14, 1, 7, 0, 0],
	],
	[
		[12, 1, 21, 0, 0],
		[22, 1, 11, 0, 0],
	],
	[
		[18, 1, 31, 0, 0],
		[16, 1, 8, 1, 9],
	],
	[
		[24, 1, 42, 0, 0],
		[22, 2, 11, 0, 0],
	],
	[
		[18, 1, 31, 1, 32],
		[22, 3, 11, 0, 0],
	],
	[
		[8, 1, 7, 0, 0],
		[10, 1, 5, 0, 0],
	],
	[
		[12, 1, 19, 0, 0],
		[20, 1, 11, 0, 0],
	],
	[
		[16, 1, 31, 0, 0],
		[16, 1, 7, 1, 8],
	],
	[
		[24, 1, 43, 0, 0],
		[22, 1, 11, 1, 12],
	],
	[
		[16, 1, 28, 1, 29],
		[30, 1, 14, 1, 15],
	],
	[
		[24, 2, 42, 0, 0],
		[30, 3, 14, 0, 0],
	],
	[
		[9, 1, 12, 0, 0],
		[14, 1, 7, 0, 0],
	],
	[
		[14, 1, 27, 0, 0],
		[28, 1, 13, 0, 0],
	],
	[
		[22, 1, 38, 0, 0],
		[20, 2, 10, 0, 0],
	],
	[
		[16, 1, 26, 1, 27],
		[28, 1, 14, 1, 15],
	],
	[
		[20, 1, 36, 1, 37],
		[26, 1, 11, 2, 12],
	],
	[
		[20, 2, 35, 1, 36],
		[28, 2, 13, 2, 14],
	],
	[
		[18, 1, 33, 0, 0],
		[18, 1, 7, 1, 8],
	],
	[
		[26, 1, 48, 0, 0],
		[24, 2, 13, 0, 0],
	],
	[
		[18, 1, 33, 1, 34],
		[24, 2, 10, 1, 11],
	],
	[
		[24, 2, 44, 0, 0],
		[22, 4, 12, 0, 0],
	],
	[
		[24, 2, 42, 1, 43],
		[26, 1, 13, 4, 14],
	],
	[
		[22, 1, 39, 0, 0],
		[20, 1, 10, 1, 11],
	],
	[
		[16, 2, 28, 0, 0],
		[30, 2, 14, 0, 0],
	],
	[
		[22, 2, 39, 0, 0],
		[28, 1, 12, 2, 13],
	],
	[
		[20, 2, 33, 1, 34],
		[26, 4, 14, 0, 0],
	],
	[
		[20, 4, 38, 0, 0],
		[26, 2, 12, 4, 13],
	],
];
