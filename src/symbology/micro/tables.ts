/**
 * Micro QR's tables, as data.
 *
 * Micro QR (ISO/IEC 18004, the Micro QR clauses) is four symbol sizes, M1 to
 * M4, each 2 modules wider than the last: 11, 13, 15 and 17. One finder, no
 * alignment patterns, a single Reed-Solomon block, and a bitstream whose
 * fields get wider with the version, down to an M1 that carries digits only
 * and has no mode indicator at all.
 *
 * Sources. The rows were transcribed from BWIPP (barcode.ps, MIT licence, as
 * shipped in bwip-js 4.11): `qrcode.metrics` for the module and codeword
 * counts, `qrcode.mids` for the mode indicators, `qrcode.cclens` for the
 * character count widths and `qrcode.termlens` for the terminators. The block
 * table was checked row by row against zxing-cpp (Apache 2.0,
 * core/src/qrcode/QRVersion.cpp, which cites ISO/IEC 18004:2006 Table 9) and
 * the character count widths against zxing-cpp's QRCodecMode.cpp. The
 * misdecode protection counts `p` are ISO/IEC 18004 Table 9's, which neither
 * of those carries; see `MICRO_P`. The tests then hold every row to the
 * arithmetic the specification guarantees and prove the whole by building
 * symbols that match bwip-js module for module and that zxing-wasm reads.
 * Tables are facts; no code was copied.
 */

import { makeBlockLayout } from './blocks.js';
import type { BlockLayout } from '../types.js';
import type { EcLevel, Mode } from '../../segment/types.js';

export type MicroVersion = 'M1' | 'M2' | 'M3' | 'M4';

export const MICRO_VERSIONS: readonly MicroVersion[] = Object.freeze(['M1', 'M2', 'M3', 'M4']);

export interface MicroLevelSpec {
	readonly ecLevel: EcLevel;
	/**
	 * The three bit symbol number written into the format information
	 * (ISO/IEC 18004 Table 13). It names the version and the level together,
	 * which is why Micro QR's format has no separate level field: 000 is M1,
	 * 001 and 010 are M2-L and M2-M, and so on up to 111 for M4-Q.
	 */
	readonly symbolNumber: number;
	readonly dataCodewords: number;
	readonly ecCodewords: number;
	/** Misdecode protection codewords: errors correctable are floor((ec - p) / 2). */
	readonly p: number;
}

export interface MicroVersionSpec {
	readonly version: MicroVersion;
	/** 1 to 4. The mode indicator is (number - 1) bits wide and the terminator 2 * number + 1. */
	readonly number: number;
	readonly size: number;
	/** Codewords in the symbol, counting M1's and M3's half codeword as one. */
	readonly totalCodewords: number;
	/** M1 and M3 end their data with a 4 bit codeword, because their module count is 4 short of a byte. */
	readonly lastDataCodewordBits: 8 | 4;
	readonly levels: readonly MicroLevelSpec[];
	readonly modes: readonly Mode[];
	/** Character count indicator widths, for the modes this version carries. */
	readonly charCountBits: Readonly<Partial<Record<Mode, number>>>;
}

/**
 * Misdecode protection, from ISO/IEC 18004 Table 9.
 *
 * Small Reed-Solomon codes are easy to "correct" into the wrong codeword: with
 * five check symbols and a damaged block, a decoder that spends all of them
 * finds some valid block nearby surprisingly often. So the specification holds
 * back p of the check symbols from correction in the smallest symbols and uses
 * them only to detect. Table 9 prints each level as (c, k, r), total, data and
 * correctable errors, with p = c - k - 2r:
 *
 *   M1     (5, 3, 0)   p = 2, detection only
 *   M2-L   (10, 5, 1)  p = 3     M2-M  (10, 4, 2)  p = 2
 *   M3-L   (17, 11, 2) p = 2     M3-M  (17, 9, 4)  p = 0
 *   M4-L   (24, 16, 3) p = 2     M4-M  (24, 14, 5) p = 0    M4-Q (24, 10, 7) p = 0
 *
 * Neither BWIPP nor zxing-cpp needs these (an encoder never does, and zxing-cpp
 * corrects as far as the code reaches), so they are transcribed from the
 * standard's table as it is widely reproduced, and should be checked against
 * the owner's copy of ISO/IEC 18004:2024 when it arrives. A wrong p cannot make
 * a symbol unreadable by another reader; it only changes how far this one
 * trusts a repair.
 */
const MICRO_P = {
	M1: { L: 2 },
	M2: { L: 3, M: 2 },
	M3: { L: 2, M: 0 },
	M4: { L: 2, M: 0, Q: 0 },
} as const;

function level(
	ecLevel: EcLevel,
	symbolNumber: number,
	dataCodewords: number,
	ecCodewords: number,
	p: number,
): MicroLevelSpec {
	return Object.freeze({ ecLevel, symbolNumber, dataCodewords, ecCodewords, p });
}

let specs: ReadonlyMap<string, MicroVersionSpec> | undefined;

/**
 * Every version, built on first use.
 *
 * Total codewords are BWIPP's data module counts (36, 80, 132 and 192) over 8,
 * rounded up for M1 and M3, whose last data codeword is a nibble. The data and
 * check codeword splits are BWIPP's EC codeword row and agree with zxing-cpp's
 * ECBlocks.
 */
function table(): ReadonlyMap<string, MicroVersionSpec> {
	if (specs !== undefined) return specs;
	const rows: MicroVersionSpec[] = [
		{
			version: 'M1',
			number: 1,
			size: 11,
			totalCodewords: 5,
			lastDataCodewordBits: 4,
			levels: [level('L', 0, 3, 2, MICRO_P.M1.L)],
			modes: ['numeric'],
			charCountBits: { numeric: 3 },
		},
		{
			version: 'M2',
			number: 2,
			size: 13,
			totalCodewords: 10,
			lastDataCodewordBits: 8,
			levels: [level('L', 1, 5, 5, MICRO_P.M2.L), level('M', 2, 4, 6, MICRO_P.M2.M)],
			modes: ['numeric', 'alphanumeric'],
			charCountBits: { numeric: 4, alphanumeric: 3 },
		},
		{
			version: 'M3',
			number: 3,
			size: 15,
			totalCodewords: 17,
			lastDataCodewordBits: 4,
			levels: [level('L', 3, 11, 6, MICRO_P.M3.L), level('M', 4, 9, 8, MICRO_P.M3.M)],
			modes: ['numeric', 'alphanumeric', 'byte', 'kanji'],
			charCountBits: { numeric: 5, alphanumeric: 4, byte: 4, kanji: 3 },
		},
		{
			version: 'M4',
			number: 4,
			size: 17,
			totalCodewords: 24,
			lastDataCodewordBits: 8,
			levels: [
				level('L', 5, 16, 8, MICRO_P.M4.L),
				level('M', 6, 14, 10, MICRO_P.M4.M),
				level('Q', 7, 10, 14, MICRO_P.M4.Q),
			],
			modes: ['numeric', 'alphanumeric', 'byte', 'kanji'],
			charCountBits: { numeric: 6, alphanumeric: 5, byte: 5, kanji: 4 },
		},
	];
	specs = new Map(
		rows.map((row) => [
			row.version,
			Object.freeze({
				...row,
				levels: Object.freeze(row.levels),
				modes: Object.freeze(row.modes),
				charCountBits: Object.freeze(row.charCountBits),
			}),
		]),
	);
	return specs;
}

/** Throws TypeError for anything but 'M1' to 'M4': a version is chosen from `versions`, never typed. */
export function microSpec(version: string): MicroVersionSpec {
	const spec = table().get(version);
	if (spec === undefined) {
		throw new TypeError('a Micro QR version is one of M1, M2, M3 and M4');
	}
	return spec;
}

/** Throws TypeError for a level the version does not have (M1 has only L, M2 and M3 have L and M). */
export function microLevel(version: string, ec: EcLevel): MicroLevelSpec {
	const found = microSpec(version).levels.find((candidate) => candidate.ecLevel === ec);
	if (found === undefined) {
		throw new TypeError('that error correction level is not available at this Micro QR version');
	}
	return found;
}

/** The version whose side is `size` modules, if there is one. */
export function microBySize(size: number): MicroVersionSpec | undefined {
	for (const spec of table().values()) {
		if (spec.size === size) return spec;
	}
	return undefined;
}

let blockLayouts: Map<string, BlockLayout> | undefined;

/** The block structure for a version and level: always one block, cached and frozen. */
export function microBlocks(version: string, ec: EcLevel): BlockLayout {
	const spec = microSpec(version);
	const found = microLevel(version, ec);
	const key = `${spec.version}-${found.ecLevel}`;
	blockLayouts ??= new Map();
	let blocks = blockLayouts.get(key);
	if (blocks === undefined) {
		blocks = makeBlockLayout(
			[{ count: 1, dataCount: found.dataCodewords }],
			found.ecCodewords,
			found.p,
			spec.lastDataCodewordBits,
		);
		blockLayouts.set(key, blocks);
	}
	return blocks;
}
