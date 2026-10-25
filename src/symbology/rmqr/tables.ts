/**
 * Rectangular Micro QR's tables, as data.
 *
 * rMQR (ISO/IEC 23941:2022) is 32 sizes, 7 to 17 modules tall in odd steps
 * and 27 to 139 wide, each at error correction level M or H. It reuses QR's
 * field, Reed-Solomon code, BCH codes and mode encodings, and adds a long thin
 * geometry: a finder at the left end, a smaller finder sub-pattern at the
 * bottom right, corner patterns at the other two corners, and alignment
 * patterns joined top to bottom by timing lines every 20 to 28 columns.
 *
 * Sources. Each row below is transcribed from BWIPP (barcode.ps, MIT licence,
 * as shipped in bwip-js 4.11), `qrcode.metrics`: the height and width, the
 * count of data modules, and for each level the total check codewords and the
 * two block group counts. The block sizes are derived from those exactly as
 * BWIPP and ISO/IEC 23941 Table 8 do (data codewords split as evenly as they
 * go, the longer blocks last), and the tests compare every one with zxing-cpp
 * (Apache 2.0, core/src/qrcode/QRVersion.cpp, which cites ISO/IEC 23941:2022
 * 7.5.1 Table 8). Alignment pattern columns are zxing-cpp's, from ISO/IEC
 * 23941 Annex D Table D.1, and the tests derive them a second way from
 * BWIPP's. Character count widths are BWIPP's `qrcode.cclens` and agree with
 * zxing-cpp's QRCodecMode.cpp (ISO/IEC 23941 7.4.1 Table 3) in all 128
 * entries. Tables are facts; no code was copied.
 */

import { makeBlockLayout } from '../micro/blocks.js';
import type { BlockLayout } from '../types.js';
import type { EcLevel, Mode } from '../../segment/types.js';

export type RmqrLevel = 'M' | 'H';

export const RMQR_LEVELS: readonly RmqrLevel[] = Object.freeze(['M', 'H']);

/**
 * Per version, in ISO/IEC 23941's order (which is also the version indicator
 * written in the format information, 0 to 31): height, width, data modules,
 * then for M and for H the total check codewords and the count of blocks in
 * each of the two groups, the second group having one more data codeword.
 */
const ROWS: readonly (readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
])[] = [
	[7, 43, 104, 7, 1, 0, 10, 1, 0],
	[7, 59, 171, 9, 1, 0, 14, 1, 0],
	[7, 77, 261, 12, 1, 0, 22, 1, 0],
	[7, 99, 358, 16, 1, 0, 30, 1, 0],
	[7, 139, 545, 24, 1, 0, 44, 2, 0],
	[9, 43, 170, 9, 1, 0, 14, 1, 0],
	[9, 59, 267, 12, 1, 0, 22, 1, 0],
	[9, 77, 393, 18, 1, 0, 32, 1, 1],
	[9, 99, 532, 24, 1, 0, 44, 2, 0],
	[9, 139, 797, 36, 1, 1, 66, 3, 0],
	[11, 27, 122, 8, 1, 0, 10, 1, 0],
	[11, 43, 249, 12, 1, 0, 20, 1, 0],
	[11, 59, 376, 16, 1, 0, 32, 1, 1],
	[11, 77, 538, 24, 1, 0, 44, 1, 1],
	[11, 99, 719, 32, 1, 1, 60, 1, 1],
	[11, 139, 1062, 48, 2, 0, 90, 3, 0],
	[13, 27, 172, 9, 1, 0, 14, 1, 0],
	[13, 43, 329, 14, 1, 0, 28, 1, 0],
	[13, 59, 486, 22, 1, 0, 40, 2, 0],
	[13, 77, 684, 32, 1, 1, 56, 1, 1],
	[13, 99, 907, 40, 1, 1, 78, 1, 2],
	[13, 139, 1328, 60, 2, 1, 112, 2, 2],
	[15, 43, 409, 18, 1, 0, 36, 1, 1],
	[15, 59, 596, 26, 1, 0, 48, 2, 0],
	[15, 77, 830, 36, 1, 1, 72, 2, 1],
	[15, 99, 1095, 48, 2, 0, 88, 4, 0],
	[15, 139, 1594, 72, 2, 1, 130, 1, 4],
	[17, 43, 489, 22, 1, 0, 40, 1, 1],
	[17, 59, 706, 32, 2, 0, 60, 2, 0],
	[17, 77, 976, 44, 2, 0, 84, 1, 2],
	[17, 99, 1283, 60, 2, 1, 104, 4, 0],
	[17, 139, 1860, 80, 4, 0, 156, 2, 4],
];

/** Character count widths per version, numeric, alphanumeric, byte, kanji, in the same order. */
const CHAR_COUNT_BITS: readonly (readonly [number, number, number, number])[] = [
	[4, 3, 3, 2],
	[5, 5, 4, 3],
	[6, 5, 5, 4],
	[7, 6, 5, 5],
	[7, 6, 6, 5],
	[5, 5, 4, 3],
	[6, 5, 5, 4],
	[7, 6, 5, 5],
	[7, 6, 6, 5],
	[8, 7, 6, 6],
	[4, 4, 3, 2],
	[6, 5, 5, 4],
	[7, 6, 5, 5],
	[7, 6, 6, 5],
	[8, 7, 6, 6],
	[8, 7, 7, 6],
	[5, 5, 4, 3],
	[6, 6, 5, 5],
	[7, 6, 6, 5],
	[7, 7, 6, 6],
	[8, 7, 7, 6],
	[8, 8, 7, 7],
	[7, 6, 6, 5],
	[7, 7, 6, 5],
	[8, 7, 7, 6],
	[8, 7, 7, 6],
	[9, 8, 7, 7],
	[7, 6, 6, 5],
	[8, 7, 6, 6],
	[8, 7, 7, 6],
	[8, 8, 7, 6],
	[9, 8, 8, 7],
];

/** Alignment pattern centre columns by symbol width (ISO/IEC 23941 Annex D, Table D.1). */
const ALIGNMENT_COLUMNS: Readonly<Record<number, readonly number[]>> = {
	27: [],
	43: [21],
	59: [19, 39],
	77: [25, 51],
	99: [23, 49, 75],
	139: [27, 55, 83, 111],
};

export interface RmqrLevelSpec {
	readonly ecLevel: RmqrLevel;
	readonly blocks: BlockLayout;
}

export interface RmqrVersionSpec {
	/** 'R7x43' to 'R17x139': height first, as ISO/IEC 23941 names them. */
	readonly version: string;
	/** The 5 bit version indicator in the format information. */
	readonly indicator: number;
	readonly width: number;
	readonly height: number;
	/** Codewords placed; the modules left over are remainder bits. */
	readonly totalCodewords: number;
	readonly remainderBits: number;
	readonly alignmentColumns: readonly number[];
	readonly charCountBits: Readonly<Record<Mode, number>>;
	readonly levels: readonly RmqrLevelSpec[];
}

/**
 * rMQR has no misdecode protection codewords. ISO/IEC 23941 does not reserve
 * check symbols from correction the way ISO/IEC 18004 Table 9 does for the
 * smallest QR and Micro QR symbols, and no reference transcription carries a
 * p column for it; where a level has an odd number of check symbols the odd
 * one is a detection margin either way, since floor(ec / 2) already leaves it.
 * To be confirmed against the owner's copy of the standard.
 */
const RMQR_P = 0;

function levelBlocks(
	totalCodewords: number,
	ecTotal: number,
	first: number,
	second: number,
): BlockLayout {
	const count = first + second;
	const data = totalCodewords - ecTotal;
	const shorter = Math.floor(data / count);
	return makeBlockLayout(
		[
			{ count: first, dataCount: shorter },
			{ count: second, dataCount: shorter + 1 },
		],
		ecTotal / count,
		RMQR_P,
		8,
	);
}

let byName: ReadonlyMap<string, RmqrVersionSpec> | undefined;
let inIsoOrder: readonly RmqrVersionSpec[] | undefined;

function build(): readonly RmqrVersionSpec[] {
	if (inIsoOrder !== undefined) return inIsoOrder;
	const specs = ROWS.map((row, indicator): RmqrVersionSpec => {
		const [height, width, modules, ecM, m1, m2, ecH, h1, h2] = row;
		const totalCodewords = Math.floor(modules / 8);
		const [numeric, alphanumeric, byte, kanji] = CHAR_COUNT_BITS[indicator] as readonly [
			number,
			number,
			number,
			number,
		];
		return Object.freeze({
			version: `R${height}x${width}`,
			indicator,
			width,
			height,
			totalCodewords,
			remainderBits: modules % 8,
			alignmentColumns: Object.freeze([...(ALIGNMENT_COLUMNS[width] as readonly number[])]),
			charCountBits: Object.freeze({ numeric, alphanumeric, byte, kanji }),
			levels: Object.freeze([
				Object.freeze({ ecLevel: 'M' as const, blocks: levelBlocks(totalCodewords, ecM, m1, m2) }),
				Object.freeze({ ecLevel: 'H' as const, blocks: levelBlocks(totalCodewords, ecH, h1, h2) }),
			]),
		});
	});
	inIsoOrder = Object.freeze(specs);
	byName = new Map(specs.map((spec) => [spec.version, spec]));
	return inIsoOrder;
}

/** Every version in ISO/IEC 23941's order, the order of the version indicator. */
export function rmqrSpecs(): readonly RmqrVersionSpec[] {
	return build();
}

/** Throws TypeError for anything that is not one of the 32 names: versions are chosen from a list, never typed. */
export function rmqrSpec(version: string): RmqrVersionSpec {
	build();
	const spec = (byName as ReadonlyMap<string, RmqrVersionSpec>).get(version);
	if (spec === undefined) {
		throw new TypeError('an rMQR version is one of the 32 sizes from R7x43 to R17x139');
	}
	return spec;
}

/** Throws TypeError for any level but M and H. */
export function rmqrBlocks(version: string, ec: EcLevel): BlockLayout {
	const found = rmqrSpec(version).levels.find((candidate) => candidate.ecLevel === ec);
	if (found === undefined) throw new TypeError('rMQR has error correction levels M and H only');
	return found.blocks;
}

/** The version a sampled grid of this width and height would be, if any. */
export function rmqrBySize(width: number, height: number): RmqrVersionSpec | undefined {
	return build().find((spec) => spec.width === width && spec.height === height);
}

let sizeOrder: readonly string[] | undefined;

/**
 * The version names smallest first, by area, as the contract asks of
 * `versions`. ISO/IEC 23941's own order runs by height and then width, so
 * R11x27, which is smaller than R7x43, comes eleventh there; here it comes
 * first. Equal areas (R7x99 and R9x77, both 693 modules) keep ISO's order.
 * The encode layer's 'height' and 'width' preferences sort for themselves.
 */
export function rmqrVersionsBySize(): readonly string[] {
	sizeOrder ??= Object.freeze(
		[...build()]
			.sort((a, b) => a.width * a.height - b.width * b.height || a.indicator - b.indicator)
			.map((spec) => spec.version),
	);
	return sizeOrder;
}
