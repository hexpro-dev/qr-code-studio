/**
 * The logo budget: what a logo costs in error correction, block by block.
 *
 * A logo hides modules, and a reader sees a hidden module as whatever colour
 * the logo or its plate happens to be there. Reed-Solomon repairs whole
 * codewords, so what matters is how many codewords have any hidden module,
 * and in which block each one sits: interleaving spreads a codeword's
 * neighbours across blocks, and the block that loses most is the one that
 * fails. So the obscured map goes through `layout.dataBits` (which codeword
 * and bit each module carries) and then through the interleave order (which
 * block each codeword belongs to).
 *
 * Two counts per block:
 *
 * - `coveredWorst`: codewords with any obscured module, as if every one of
 *   them read wrong. This is what the check fails on, because whether a
 *   hidden module reads right is luck: the same logo over the same content
 *   with a different mask hides a different share of dark modules.
 * - `coveredExpected`: codewords whose obscured modules actually sample wrong
 *   in a clean capture. Never more than `coveredWorst`; the check warns when
 *   it alone leaves less than the reserve to spare.
 *
 * A block may correct t = floor((ec - p) / 2) errors, p being the misdecode
 * protection the smallest versions keep back (ISO/IEC 18004 Table 9). The
 * strict profile holds a quarter of that, rounded up, in reserve for the
 * real world: print, light and the angle a person holds the phone at all
 * cost errors too, and a design that spends every correction on its logo
 * has none left for them.
 */

import { blockCapacity, interleaveOrder } from '../symbology/qr/blocks.js';
import type { BuiltSymbol } from '../symbology/types.js';

/** The share of each block's corrections the strict profile keeps back for capture damage. */
export const RESERVE_SHARE = 0.25;

/** The corrections a block of capacity t keeps in reserve. */
export function reserveFor(t: number): number {
	return Math.ceil(RESERVE_SHARE * t);
}

export interface BlockCoverage {
	readonly index: number;
	readonly ec: number;
	readonly p: number;
	readonly t: number;
	readonly reserve: number;
	readonly coveredWorst: number;
	readonly coveredExpected: number;
	/** t - reserve - coveredWorst: below zero, the logo alone spends the reserve. */
	readonly margin: number;
}

export interface Coverage {
	readonly blocks: readonly BlockCoverage[];
	/** One flag per codeword in the interleaved sequence: 1 where any of its modules is obscured. */
	readonly worst: Uint8Array;
	/** One flag per codeword: 1 where an obscured module of it samples wrong. */
	readonly expected: Uint8Array;
}

/**
 * Per block, the codewords a logo covers.
 *
 * `obscured` and `wrong` are one byte per module, row major over the symbol;
 * `wrong` marks modules that sample to the other colour in a clean capture,
 * and only those that are also obscured count.
 */
export function codewordCoverage(
	symbol: BuiltSymbol,
	obscured: Uint8Array,
	wrong?: Uint8Array,
): Coverage {
	const { layout, blocks } = symbol;
	if (obscured.length !== layout.width * layout.height) {
		throw new TypeError('codewordCoverage: one obscured flag per module, row major.');
	}
	const order = interleaveOrder(blocks);
	const total = order.block.length;
	const worst = new Uint8Array(total);
	const expected = new Uint8Array(total);
	for (let i = 0; i < obscured.length; i += 1) {
		if (obscured[i] === 0) continue;
		const bit = layout.dataBits[i] as number;
		if (bit < 0) continue;
		const codeword = bit >> 3;
		worst[codeword] = 1;
		if (wrong !== undefined && wrong[i] !== 0) expected[codeword] = 1;
	}
	const counts = blocks.blocks.map(() => ({ worst: 0, expected: 0 }));
	for (let i = 0; i < total; i += 1) {
		const count = counts[order.block[i] as number] as { worst: number; expected: number };
		count.worst += worst[i] as number;
		count.expected += expected[i] as number;
	}
	return {
		blocks: blocks.blocks.map((block, index) => {
			const t = blockCapacity(block.ecCount, blocks.p);
			const reserve = reserveFor(t);
			const count = counts[index] as { worst: number; expected: number };
			return {
				index,
				ec: block.ecCount,
				p: blocks.p,
				t,
				reserve,
				coveredWorst: count.worst,
				coveredExpected: count.expected,
				margin: t - reserve - count.worst,
			};
		}),
		worst,
		expected,
	};
}
