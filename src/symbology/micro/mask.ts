/**
 * Micro QR's four masks and the score that chooses between them.
 *
 * The masks are four of QR Model 2's eight (ISO/IEC 18004, the Micro QR mask
 * table), renumbered: Micro reference 00 is QR's 001, 01 is 100, 10 is 110 and
 * 11 is 111. BWIPP keeps the same correspondence (`qrcode.formatmaskbits`,
 * micro: 1 4 6 7). The specification writes each as a condition on i, the
 * row, and j, the column; here they take (x, y), column first, like BitMatrix,
 * and the swap is done once, below, rather than at every call site.
 *
 * The score is not QR's four penalty rules. A Micro QR symbol has a single
 * finder and its far edges are data, so what matters is that those edges are
 * dark enough for a reader to find where the symbol ends. Count the dark
 * modules of the right column (SUM1) and of the bottom row (SUM2), leaving out
 * the timing module each starts with, and score SUM1 * 16 + SUM2 when SUM1 <=
 * SUM2, else SUM2 * 16 + SUM1. The highest score wins, so the weaker edge
 * counts sixteen times over and both edges are kept dark. On a tie the lowest
 * mask number wins, as it does in BWIPP.
 */

import type { BitMatrix } from '../../core/index.js';
import type { MaskPredicate } from './modules.js';

export const MICRO_MASKS: readonly MaskPredicate[] = Object.freeze([
	// 00, QR 001: i mod 2 = 0.
	(_x: number, y: number) => y % 2 === 0,
	// 01, QR 100: ((i div 2) + (j div 3)) mod 2 = 0.
	(x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
	// 10, QR 110: ((i j) mod 2 + (i j) mod 3) mod 2 = 0.
	(x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
	// 11, QR 111: ((i + j) mod 2 + (i j) mod 3) mod 2 = 0.
	(x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]);

/** The evaluation score of a finished symbol; higher is better. */
export function microMaskScore(matrix: BitMatrix): number {
	const last = matrix.width - 1;
	let right = 0;
	let bottom = 0;
	for (let i = 1; i <= last; i += 1) {
		right += matrix.get(last, i);
		bottom += matrix.get(i, last);
	}
	return right <= bottom ? right * 16 + bottom : bottom * 16 + right;
}
