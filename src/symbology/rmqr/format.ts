/**
 * rMQR's format information: the level and the version, in eighteen modules,
 * twice.
 *
 * Six data bits, the level (0 for M, 1 for H) then the 5 bit version
 * indicator, extended to eighteen with the BCH(18, 6) code QR Model 2 uses for
 * its version information (generator 0x1f25, minimum distance 8, so up to 3
 * flipped bits are correctable). Each copy is XORed with a mask of its own,
 * 0x1fab2 beside the finder and 0x20a7b beside the sub-pattern, so the two can
 * never be read for each other (ISO/IEC 23941, the format information clause;
 * the constants are in BWIPP's `qrcode.latevars`). There is no mask
 * reference: rMQR has a single fixed mask.
 *
 * The version is in the format because a long thin symbol is hard to measure:
 * a reader that finds the finder and sub-pattern still needs to know how many
 * columns lie between them. A sampled matrix has its size already, so here
 * the version read back must agree with it.
 */

import { bchEncode, bchNearest } from '../../core/index.js';
import type { BitMatrix } from '../../core/index.js';

const GENERATOR = 0x1f25;
export const RMQR_FORMAT_MASKS = Object.freeze([0x1fab2, 0x20a7b] as const);

let tables: readonly (readonly number[])[] | undefined;

/** The 64 masked words of each copy, indexed by level bit * 32 + version indicator. */
export function rmqrFormatTables(): readonly (readonly number[])[] {
	tables ??= Object.freeze(
		RMQR_FORMAT_MASKS.map((mask) =>
			Object.freeze(Array.from({ length: 64 }, (_, data) => bchEncode(data, 6, GENERATOR) ^ mask)),
		),
	);
	return tables;
}

export function writeRmqrFormat(
	matrix: BitMatrix,
	copies: readonly (readonly (readonly [number, number])[])[],
	data: number,
): void {
	const words = rmqrFormatTables();
	copies.forEach((modules, copy) => {
		const word = (words[copy] as readonly number[])[data] as number;
		modules.forEach(([x, y], i) => matrix.set(x, y, ((word >>> (17 - i)) & 1) === 1));
	});
}

export function readRmqrFormatWord(
	matrix: BitMatrix,
	modules: readonly (readonly [number, number])[],
): number {
	let word = 0;
	for (const [x, y] of modules) word = (word << 1) | matrix.get(x, y);
	return word;
}

export interface RmqrFormat {
	/** Level bit * 32 + version indicator. */
	readonly data: number;
	/**
	 * Bits corrected: in a strict read, the larger of the two copies, since
	 * both were relied on; in a lenient one, the copy that was believed.
	 */
	readonly distance: number;
}

/**
 * The format both copies support.
 *
 * Strict, for the scan check: each copy within one bit of a valid word, and
 * the two naming the same symbol. Lenient: each copy is decoded within three
 * bits on its own; if both decode they must agree, unless one is strictly
 * nearer, in which case it is believed; if only one decodes it is enough. Two
 * copies that decode to different symbols at the same distance are refused
 * rather than guessed between.
 */
export function decodeRmqrFormat(
	words: readonly [number, number],
	strict: boolean,
): RmqrFormat | undefined {
	const tablesNow = rmqrFormatTables();
	const limit = strict ? 1 : 3;
	const [first, second] = words.map((word, copy) =>
		bchNearest(word, tablesNow[copy] as readonly number[], limit),
	);
	if (strict) {
		if (first === undefined || second === undefined || first.index !== second.index)
			return undefined;
		return { data: first.index, distance: Math.max(first.distance, second.distance) };
	}
	if (first === undefined || second === undefined) {
		const only = first ?? second;
		return only === undefined ? undefined : { data: only.index, distance: only.distance };
	}
	if (first.index === second.index) {
		return { data: first.index, distance: Math.min(first.distance, second.distance) };
	}
	if (first.distance === second.distance) return undefined;
	const nearer = first.distance < second.distance ? first : second;
	return { data: nearer.index, distance: nearer.distance };
}
