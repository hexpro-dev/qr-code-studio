/**
 * QR's eight data masks and the penalty score that chooses between them.
 *
 * Masking exists so a symbol never holds a large blank area or an accidental
 * copy of a finder pattern, either of which sends a reader looking in the
 * wrong place. The encoder scores all eight and keeps the lowest; the reader
 * is told which was used in the format information, so a reader never has to
 * agree with the encoder's taste.
 *
 * Lifted from the authenticator package (`src/qr/mask.ts` there), rewritten
 * over the flat module array, with its reading of the one ambiguous rule kept:
 * rule 3's four light modules must lie inside the symbol (the quiet zone does
 * not count), and a finder-like run counts once even when both its sides are
 * clear. The `qrcode` package reads that last case as two, and also rounds
 * rule 4 differently above 50% dark; `tests/symbology/qr/mask.test.ts`
 * measures both and checks that every place the two packages choose different
 * masks is explained by one of those two readings and nothing else.
 *
 * The predicates take (row, column): ISO/IEC 18004 Table 10 writes them as
 * (i, j) with i the row, and swapping the two gives four masks that are the
 * transposes of the right ones, which round-trips within one implementation
 * and fails against every other.
 */

export type MaskPredicate = (row: number, column: number) => boolean;

export const QR_MASKS: readonly MaskPredicate[] = Object.freeze([
	(row: number, column: number) => (row + column) % 2 === 0,
	(row: number) => row % 2 === 0,
	(_row: number, column: number) => column % 3 === 0,
	(row: number, column: number) => (row + column) % 3 === 0,
	(row: number, column: number) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
	(row: number, column: number) => ((row * column) % 2) + ((row * column) % 3) === 0,
	(row: number, column: number) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
	(row: number, column: number) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
]);

/** Penalty weights, ISO/IEC 18004 7.8.3.1. */
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

export interface Penalty {
	readonly rule1: number;
	readonly rule2: number;
	readonly rule3: number;
	readonly rule4: number;
	readonly total: number;
}

/** Runs of five or more of one colour along a line: N1 plus one for each module past five. */
function runPenalty(data: Uint8Array, start: number, stride: number, length: number): number {
	let penalty = 0;
	let colour = data[start] as number;
	let run = 1;
	for (let i = 1; i < length; i += 1) {
		const value = data[start + i * stride] as number;
		if (value === colour) {
			run += 1;
			continue;
		}
		if (run >= 5) penalty += N1 + run - 5;
		colour = value;
		run = 1;
	}
	if (run >= 5) penalty += N1 + run - 5;
	return penalty;
}

const FINDER_LIKE = [1, 0, 1, 1, 1, 0, 1];

/**
 * Finder-like runs (dark, light, dark dark dark, light, dark) along a line
 * with four light modules inside the symbol before or after them, N3 each.
 */
function finderPenalty(data: Uint8Array, start: number, stride: number, length: number): number {
	let count = 0;
	const at = (i: number): number => data[start + i * stride] as number;
	const light = (from: number, to: number): boolean => {
		if (from < 0 || to > length) return false;
		for (let i = from; i < to; i += 1) if (at(i) !== 0) return false;
		return true;
	};
	for (let i = 0; i + 7 <= length; i += 1) {
		let matches = true;
		for (let k = 0; k < 7 && matches; k += 1) matches = at(i + k) === FINDER_LIKE[k];
		if (matches && (light(i - 4, i) || light(i + 7, i + 11))) count += 1;
	}
	return count * N3;
}

/** The four penalty rules of ISO/IEC 18004 7.8.3.1 over a square matrix, row major. */
export function penalty(data: Uint8Array, size: number): Penalty {
	let rule1 = 0;
	let rule3 = 0;
	for (let line = 0; line < size; line += 1) {
		rule1 += runPenalty(data, line * size, 1, size) + runPenalty(data, line, size, size);
		rule3 += finderPenalty(data, line * size, 1, size) + finderPenalty(data, line, size, size);
	}
	let blocks = 0;
	for (let y = 0; y + 1 < size; y += 1) {
		for (let x = 0; x + 1 < size; x += 1) {
			const at = y * size + x;
			const sum =
				(data[at] as number) +
				(data[at + 1] as number) +
				(data[at + size] as number) +
				(data[at + size + 1] as number);
			if (sum === 0 || sum === 4) blocks += 1;
		}
	}
	const rule2 = blocks * N2;
	let dark = 0;
	for (let i = 0; i < data.length; i += 1) dark += data[i] as number;
	// k steps of 5% away from half dark, counted down: 54.9% is k = 0. In
	// integers, floor(|20 dark - 10 total| / total), which is exact here.
	const rule4 = Math.floor((Math.abs(2 * dark - data.length) * 10) / data.length) * N4;
	return { rule1, rule2, rule3, rule4, total: rule1 + rule2 + rule3 + rule4 };
}
