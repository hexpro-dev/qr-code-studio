/**
 * Format and version information: the error correction level, the mask and
 * the version, each protected by a small BCH code (core `bch.ts`).
 *
 * Format information is BCH(15, 5) with generator 0x537, XORed with 0x5412 so
 * that level M with mask 0 (all-zero data) is not an all-zero codeword a
 * blank corner would match. Version information, from version 7, is
 * BCH(18, 6) with generator 0x1F25 and no mask. Both are decoded by nearest
 * codeword over the full table, which `bchNearest` does, refusing ties.
 */

import { bchEncode, bchNearest } from '../../core/bch.js';
import type { EcLevel } from '../../segment/types.js';
import { EC_FORMAT_BITS, EC_FROM_FORMAT_BITS } from './tables.js';

const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;
const VERSION_GENERATOR = 0x1f25;

/** The 15 format bits for a level and mask, mask applied. */
export function formatBits(level: EcLevel, mask: number): number {
	// The two level bits come from EC_FORMAT_BITS (M, L, H, Q), never EC_INDEX.
	return bchEncode((EC_FORMAT_BITS[level] << 3) | mask, 5, FORMAT_GENERATOR) ^ FORMAT_MASK;
}

/** The 18 version bits, for versions 7 to 40. */
export function versionBits(version: number): number {
	return bchEncode(version, 6, VERSION_GENERATOR);
}

let formatTable: readonly number[] | undefined;
let versionTable: readonly number[] | undefined;

/** All 32 format codewords, indexed (format level bits << 3) | mask. */
function formats(): readonly number[] {
	formatTable ??= Object.freeze(
		Array.from({ length: 32 }, (_, i) =>
			formatBits(EC_FROM_FORMAT_BITS[i >>> 3] as EcLevel, i & 7),
		),
	);
	return formatTable;
}

/** All 34 version codewords, indexed version - 7. */
function versions(): readonly number[] {
	versionTable ??= Object.freeze(Array.from({ length: 34 }, (_, i) => versionBits(i + 7)));
	return versionTable;
}

export interface FormatRead {
	readonly ecLevel: EcLevel;
	readonly mask: number;
	/** Bits that differed from the nearest codeword. */
	readonly distance: number;
}

/** The format a received word is nearest, within `maxDistance` bits and not tied. */
export function readFormat(received: number, maxDistance: number): FormatRead | undefined {
	const found = bchNearest(received, formats(), maxDistance);
	if (found === undefined) return undefined;
	return {
		ecLevel: EC_FROM_FORMAT_BITS[found.index >>> 3] as EcLevel,
		mask: found.index & 7,
		distance: found.distance,
	};
}

/** The version a received word is nearest, within `maxDistance` bits and not tied. */
export function readVersion(
	received: number,
	maxDistance: number,
): { readonly version: number; readonly distance: number } | undefined {
	const found = bchNearest(received, versions(), maxDistance);
	return found === undefined ? undefined : { version: found.index + 7, distance: found.distance };
}
