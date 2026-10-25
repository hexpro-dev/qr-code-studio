/**
 * Making a QR symbol from its data codewords.
 *
 * Lifted from the authenticator package's encoder (`src/qr/encode/encoder.ts`
 * there), whose matrix was pinned module for module to the ISO/IEC 18004
 * Annex I example and to the `qrcode` package, and reorganised around the
 * cached geometry: the function patterns are a template copied per symbol,
 * the data goes where the placement walk says, and each candidate mask is a
 * pass over the data modules only.
 *
 * Reed-Solomon and interleaving happen here, through `interleaveBlocks`,
 * rather than in encode: `read` undoes both inside the symbology, so keeping
 * the forward direction here too makes build and read mirror images, and lets
 * a symbology with its own block quirks (Micro QR's 4-bit codewords) keep
 * them to itself.
 */

import { BitMatrix } from '../../core/bit-matrix.js';
import type { EcLevel } from '../../segment/types.js';
import type { BuiltSymbol } from '../types.js';
import { interleaveBlocks, qrBlocks } from './blocks.js';
import { formatBits, versionBits } from './info.js';
import type { QrGeometry } from './layout.js';
import { qrGeometry } from './layout.js';
import { QR_MASKS, penalty } from './mask.js';

/** Flip the data modules the mask selects. Function patterns are never masked. */
function applyMask(modules: Uint8Array, geometry: QrGeometry, mask: number): void {
	// buildQr has checked the mask is 0 to 7.
	const predicate = QR_MASKS[mask] as (row: number, column: number) => boolean;
	const { size, placement } = geometry;
	for (let i = 0; i < placement.length; i += 1) {
		const index = placement[i] as number;
		if (predicate(Math.floor(index / size), index % size))
			modules[index] = (modules[index] as number) ^ 1;
	}
}

/** Write format information (both copies, most significant bit first) and version information. */
function writeInformation(
	modules: Uint8Array,
	geometry: QrGeometry,
	ec: EcLevel,
	mask: number,
): void {
	const format = formatBits(ec, mask);
	for (let i = 0; i < 15; i += 1) {
		const bit = (format >>> (14 - i)) & 1;
		modules[geometry.formatFirst[i] as number] = bit;
		modules[geometry.formatSecond[i] as number] = bit;
	}
	if (geometry.versionFirst.length === 0) return;
	const version = versionBits(geometry.version);
	for (let i = 0; i < 18; i += 1) {
		const bit = (version >>> i) & 1;
		modules[geometry.versionFirst[i] as number] = bit;
		modules[geometry.versionSecond[i] as number] = bit;
	}
}

export function buildQr(
	data: Uint8Array,
	version: number,
	ec: EcLevel,
	mask: number | 'auto',
): BuiltSymbol {
	if (mask !== 'auto' && (!Number.isInteger(mask) || mask < 0 || mask > 7)) {
		throw new TypeError("a QR mask is 0 to 7, or 'auto'");
	}
	const geometry = qrGeometry(version);
	const blocks = qrBlocks(version, ec);
	const codewords = interleaveBlocks(data, blocks);

	const base = Uint8Array.from(geometry.template);
	const bits = codewords.length * 8;
	for (let i = 0; i < bits; i += 1) {
		base[geometry.placement[i] as number] = ((codewords[i >>> 3] as number) >>> (7 - (i & 7))) & 1;
	}
	// The remainder bits after the last codeword stay light before masking,
	// as the specification asks; they carry nothing.

	let chosen = -1;
	let chosenModules = base;
	let lowest = Infinity;
	for (const candidate of mask === 'auto' ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask]) {
		const modules = base.slice();
		applyMask(modules, geometry, candidate);
		writeInformation(modules, geometry, ec, candidate);
		// The whole symbol is scored, format and version information included,
		// as the `qrcode` package and zxing score it. Ties keep the lower mask.
		const score = mask === 'auto' ? penalty(modules, geometry.size).total : 0;
		if (score < lowest) {
			lowest = score;
			chosen = candidate;
			chosenModules = modules;
		}
	}

	return Object.freeze({
		symbology: 'qr',
		version: String(version),
		ecLevel: ec,
		mask: chosen,
		matrix: new BitMatrix(geometry.size, geometry.size, chosenModules),
		layout: geometry.layout,
		blocks,
		codewords,
	});
}
