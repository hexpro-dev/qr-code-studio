/**
 * Micro QR's format information: which symbol this is and which mask it uses,
 * in fifteen modules.
 *
 * Five data bits, the three bit symbol number (version and level together)
 * then the two bit mask reference, extended to fifteen with QR's BCH(15, 5)
 * code (generator 0x537) and XORed with 0x4445 rather than QR's 0x5412, so
 * that a Micro QR format can never be mistaken for a QR one (ISO/IEC 18004,
 * the Micro QR format information clause; the same constants are in BWIPP's
 * `qrcode.latevars`). The code has minimum distance 7, so up to 3 flipped
 * bits are correctable in principle.
 *
 * There is a single copy. QR Model 2 writes its format twice and a reader can
 * insist the copies agree; Micro QR has no room for a second, so the strict
 * reading here is the distance bound alone.
 */

import { bchEncode, bchNearest } from '../../core/index.js';
import type { BitMatrix } from '../../core/index.js';
import { MICRO_FORMAT_MODULES } from './layout.js';

const GENERATOR = 0x537;
const XOR_MASK = 0x4445;

let table: readonly number[] | undefined;

/** All 32 masked format words, indexed by symbol number * 4 + mask. */
export function microFormatTable(): readonly number[] {
	table ??= Object.freeze(
		Array.from({ length: 32 }, (_, data) => bchEncode(data, 5, GENERATOR) ^ XOR_MASK),
	);
	return table;
}

export function microFormatWord(symbolNumber: number, mask: number): number {
	return microFormatTable()[symbolNumber * 4 + mask] as number;
}

export function writeMicroFormat(matrix: BitMatrix, word: number): void {
	MICRO_FORMAT_MODULES.forEach(([x, y], i) => {
		matrix.set(x, y, ((word >>> (14 - i)) & 1) === 1);
	});
}

export function readMicroFormatWord(matrix: BitMatrix): number {
	let word = 0;
	for (const [x, y] of MICRO_FORMAT_MODULES) word = (word << 1) | matrix.get(x, y);
	return word;
}

export interface MicroFormat {
	readonly symbolNumber: number;
	readonly mask: number;
	/** Bits that differed from the nearest valid word. */
	readonly distance: number;
}

/** The nearest valid format within `maxDistance` bits, or undefined when none is unambiguous. */
export function decodeMicroFormat(word: number, maxDistance: number): MicroFormat | undefined {
	const found = bchNearest(word, microFormatTable(), maxDistance);
	if (found === undefined) return undefined;
	return { symbolNumber: found.index >>> 2, mask: found.index & 3, distance: found.distance };
}
