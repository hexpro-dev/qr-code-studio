/**
 * QR Model 2 as a `SymbologyEntry`: versions 1 to 40, levels L, M, Q and H,
 * masks 0 to 7.
 *
 * Versions travel as strings ('1' to '40') because the contract is shared
 * with Micro QR ('M1') and rMQR ('R7x43'). A version string that is not one
 * of these is a caller's mistake and throws TypeError; it never reaches a
 * table lookup as `undefined`.
 */

import type { BitMatrix } from '../../core/bit-matrix.js';
import { qrProfile } from '../../segment/profile.js';
import type { BitstreamProfile, EcLevel } from '../../segment/types.js';
import type {
	BlockLayout,
	BuiltSymbol,
	MatrixRead,
	ReadOptions,
	SymbolLayout,
	SymbologyEntry,
} from '../types.js';
import { qrBlocks } from './blocks.js';
import { buildQr } from './build.js';
import { qrGeometry, qrSize } from './layout.js';
import { readQr } from './read.js';
import { EC_LEVELS } from './tables.js';

const VERSIONS: readonly string[] = Object.freeze(
	Array.from({ length: 40 }, (_, i) => String(i + 1)),
);
const MASKS: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);

function versionNumber(version: string): number {
	const index = VERSIONS.indexOf(version);
	if (index < 0) throw new TypeError("a QR version is '1' to '40'");
	return index + 1;
}

function level(ec: EcLevel): EcLevel {
	if (!EC_LEVELS.includes(ec))
		throw new TypeError("a QR error correction level is 'L', 'M', 'Q' or 'H'");
	return ec;
}

/** QR Model 2. Stateless; the caches behind it are shared between every entry made. */
export function createQrSymbology(): SymbologyEntry {
	return Object.freeze({
		id: 'qr',
		labelKey: 'symbology.qr.label',
		quietZone: 4,
		phoneReadable: true,
		versions: VERSIONS,
		ecLevels: (version: string): readonly EcLevel[] => {
			versionNumber(version);
			return EC_LEVELS;
		},
		size: (version: string): { width: number; height: number } => {
			const side = qrSize(versionNumber(version));
			return { width: side, height: side };
		},
		profile: (version: string): BitstreamProfile => qrProfile(versionNumber(version)),
		blocks: (version: string, ec: EcLevel): BlockLayout =>
			qrBlocks(versionNumber(version), level(ec)),
		layout: (version: string): SymbolLayout => qrGeometry(versionNumber(version)).layout,
		masks: (version: string): readonly number[] => {
			versionNumber(version);
			return MASKS;
		},
		build: (
			codewords: Uint8Array,
			version: string,
			ec: EcLevel,
			mask: number | 'auto',
		): BuiltSymbol => buildQr(codewords, versionNumber(version), level(ec), mask),
		read: (matrix: BitMatrix, options: ReadOptions): MatrixRead => readQr(matrix, options),
	});
}
