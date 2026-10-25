/**
 * Where everything in a QR symbol is, per version: the role of every module,
 * the colour of every function module, the order codewords are placed in, and
 * the positions of format and version information.
 *
 * Shared by `build` and `read` on purpose, as the authenticator package's
 * `function-patterns.ts` (lifted here) shared it between its encoder and
 * decoder. If the two ever disagreed by one module about which modules carry
 * data, the encoder would write a payload the decoder reads one bit out of
 * step from that module on, which looks like damage rather than like a
 * geometry bug. The role map is also what design styles by and what verify
 * counts, so it is one structure, computed once per version and cached.
 */

import type { SymbolLayout, StyleableRegion } from '../types.js';
import { ROLE_CODES } from '../roles.js';
import { ALIGNMENT_CENTRES, TOTAL_CODEWORDS } from './tables.js';

export interface QrGeometry {
	readonly version: number;
	readonly size: number;
	readonly layout: SymbolLayout;
	/** Function module colours (1 dark), 0 in the data region and in format and version information. */
	readonly template: Uint8Array;
	/** Module index (y * size + x) of every data-region module, in placement order, remainder bits last. */
	readonly placement: Int32Array;
	/** Format information, most significant bit first (ISO/IEC 18004 Figure 25). */
	readonly formatFirst: Int32Array;
	readonly formatSecond: Int32Array;
	/** Version information, least significant bit first; empty below version 7. */
	readonly versionFirst: Int32Array;
	readonly versionSecond: Int32Array;
}

let cache: Map<number, QrGeometry> | undefined;

export function qrSize(version: number): number {
	return 17 + 4 * version;
}

function geometry(version: number): QrGeometry {
	const size = qrSize(version);
	const roles = new Uint8Array(size * size);
	const template = new Uint8Array(size * size);
	const at = (x: number, y: number): number => y * size + x;
	const stamp = (x: number, y: number, role: number, dark: boolean): void => {
		roles[at(x, y)] = role;
		template[at(x, y)] = dark ? 1 : 0;
	};

	// Timing first, so the alignment patterns that cross row or column 6 in
	// larger versions overwrite it. They agree on every module they share, so
	// the order changes the role, never the colour.
	for (let i = 8; i < size - 8; i += 1) {
		stamp(i, 6, ROLE_CODES.timing, i % 2 === 0);
		stamp(6, i, ROLE_CODES.timing, i % 2 === 0);
	}

	const centres = ALIGNMENT_CENTRES[version - 1] as readonly number[];
	for (const cy of centres) {
		for (const cx of centres) {
			// The three pairs that would land on a finder are left out.
			const onFinder =
				(cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8);
			if (onFinder) continue;
			for (let dy = -2; dy <= 2; dy += 1) {
				for (let dx = -2; dx <= 2; dx += 1) {
					stamp(cx + dx, cy + dy, ROLE_CODES.alignment, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
				}
			}
		}
	}

	const finders: readonly (readonly [number, number])[] = [
		[0, 0],
		[size - 7, 0],
		[0, size - 7],
	];
	for (const [ox, oy] of finders) {
		for (let dy = -1; dy <= 7; dy += 1) {
			for (let dx = -1; dx <= 7; dx += 1) {
				const x = ox + dx;
				const y = oy + dy;
				if (x < 0 || y < 0 || x >= size || y >= size) continue;
				const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
				const ring = inFinder && (dx === 0 || dx === 6 || dy === 0 || dy === 6);
				const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
				stamp(x, y, inFinder ? ROLE_CODES.finder : ROLE_CODES.separator, ring || core);
			}
		}
	}

	// Format information: along row 8 and up column 8 beside the top-left
	// finder, skipping the timing module each crosses, and again split between
	// the other two finders.
	const formatFirst = Int32Array.from(
		[
			[0, 8],
			[1, 8],
			[2, 8],
			[3, 8],
			[4, 8],
			[5, 8],
			[7, 8],
			[8, 8],
			[8, 7],
			[8, 5],
			[8, 4],
			[8, 3],
			[8, 2],
			[8, 1],
			[8, 0],
		].map(([x, y]) => at(x as number, y as number)),
	);
	const formatSecond = new Int32Array(15);
	for (let i = 0; i < 7; i += 1) formatSecond[i] = at(8, size - 1 - i);
	for (let i = 0; i < 8; i += 1) formatSecond[7 + i] = at(size - 8 + i, 8);
	for (const index of [...formatFirst, ...formatSecond]) roles[index] = ROLE_CODES.format;

	// The dark module, always dark, beside the second copy's column run.
	stamp(8, size - 8, ROLE_CODES['dark-module'], true);

	// Version information from version 7: a 6 by 3 block above the
	// bottom-left finder and its transpose left of the top-right one. Getting
	// the transpose the wrong way round still draws 18 plausible modules in
	// each corner; what breaks is the reservation, which shifts every data
	// module placed after it, so versions 1 to 6 stay perfect and everything
	// from 7 up reads as noise.
	const versionFirst = new Int32Array(version >= 7 ? 18 : 0);
	const versionSecond = new Int32Array(version >= 7 ? 18 : 0);
	for (let i = 0; i < versionFirst.length; i += 1) {
		versionFirst[i] = at(Math.floor(i / 3), size - 11 + (i % 3));
		versionSecond[i] = at(size - 11 + (i % 3), Math.floor(i / 3));
		roles[versionFirst[i] as number] = ROLE_CODES.version;
		roles[versionSecond[i] as number] = ROLE_CODES.version;
	}

	// The placement walk (ISO/IEC 18004 7.7.3): two columns at a time, right to
	// left, upwards then downwards, skipping column 6 entirely because the
	// vertical timing pattern owns it. That one exception is the detail
	// implementations most often get wrong.
	const placement: number[] = [];
	let upward = true;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let step = 0; step < size; step += 1) {
			const y = upward ? size - 1 - step : step;
			for (let column = 0; column < 2; column += 1) {
				const index = at(right - column, y);
				if (roles[index] === ROLE_CODES.data) placement.push(index);
			}
		}
		upward = !upward;
	}

	const dataBits = new Int32Array(size * size).fill(-1);
	const codewordBits = (TOTAL_CODEWORDS[version - 1] as number) * 8;
	for (let i = 0; i < codewordBits; i += 1) {
		dataBits[placement[i] as number] = (i >>> 3) * 8 + (7 - (i & 7));
	}

	const regions: readonly StyleableRegion[] = Object.freeze(
		finders.map(([x, y]) =>
			Object.freeze({
				role: 'finder',
				kind: 'concentric-7',
				x,
				y,
				width: 7,
				height: 7,
				rotation: 0,
			} as const),
		),
	);

	return Object.freeze({
		version,
		size,
		layout: Object.freeze({ width: size, height: size, roles, dataBits, regions }),
		template,
		placement: Int32Array.from(placement),
		formatFirst,
		formatSecond,
		versionFirst,
		versionSecond,
	});
}

/**
 * The geometry of a version, built on first use and then the same object
 * every time. The arrays inside are shared, so nothing that receives them may
 * write to them.
 */
export function qrGeometry(version: number): QrGeometry {
	if (!Number.isInteger(version) || version < 1 || version > 40) {
		throw new TypeError('a QR version is a whole number from 1 to 40');
	}
	cache ??= new Map();
	let found = cache.get(version);
	if (found === undefined) {
		found = geometry(version);
		cache.set(version, found);
	}
	return found;
}
