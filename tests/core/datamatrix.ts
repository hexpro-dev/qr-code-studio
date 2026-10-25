/**
 * Codewords read back out of a Data Matrix symbol drawn by bwip-js.
 *
 * This is how the Reed-Solomon tests get an independent oracle for the other
 * GF(2^8) (polynomial 0x12d, first root 1): bwip-js encodes, this reads the
 * modules back into codewords, and the check symbols bwip-js chose must be the
 * ones `rsEncode` computes. Only the single-region square sizes (10 by 10 to
 * 26 by 26) are read, which is every size with one Reed-Solomon block and no
 * alignment patterns to step over.
 *
 * The placement is the "utah" walk from ISO/IEC 16022 Annex F, transcribed. It
 * is checked by the specification's own example: "123456" in a 10 by 10
 * symbol is data 142 164 186 and check symbols 114 25 5 88 102.
 */

import bwipjs from 'bwip-js';

/** Each module's codeword (from 1) times 10 plus its bit (1 = most significant), or 0. */
function placement(
	rows: number,
	cols: number,
): { readonly map: Int32Array; readonly count: number } {
	const map = new Int32Array(rows * cols);
	const place = (row: number, col: number, chr: number, bit: number): void => {
		let r = row;
		let c = col;
		if (r < 0) {
			r += rows;
			c += 4 - ((rows + 4) % 8);
		}
		if (c < 0) {
			c += cols;
			r += 4 - ((cols + 4) % 8);
		}
		map[r * cols + c] = 10 * chr + bit;
	};
	const utah = (row: number, col: number, chr: number): void => {
		place(row - 2, col - 2, chr, 1);
		place(row - 2, col - 1, chr, 2);
		place(row - 1, col - 2, chr, 3);
		place(row - 1, col - 1, chr, 4);
		place(row - 1, col, chr, 5);
		place(row, col - 2, chr, 6);
		place(row, col - 1, chr, 7);
		place(row, col, chr, 8);
	};
	const corner = (chr: number, cells: readonly (readonly [number, number])[]): void => {
		cells.forEach(([r, c], i) => place(r, c, chr, i + 1));
	};
	const last = rows - 1;
	const right = cols - 1;
	let chr = 1;
	let row = 4;
	let col = 0;
	do {
		if (row === rows && col === 0) {
			corner(chr++, [
				[last, 0],
				[last, 1],
				[last, 2],
				[0, right - 1],
				[0, right],
				[1, right],
				[2, right],
				[3, right],
			]);
		}
		if (row === rows - 2 && col === 0 && cols % 4 !== 0) {
			corner(chr++, [
				[rows - 3, 0],
				[rows - 2, 0],
				[last, 0],
				[0, right - 3],
				[0, right - 2],
				[0, right - 1],
				[0, right],
				[1, right],
			]);
		}
		if (row === rows - 2 && col === 0 && cols % 8 === 4) {
			corner(chr++, [
				[rows - 3, 0],
				[rows - 2, 0],
				[last, 0],
				[0, right - 1],
				[0, right],
				[1, right],
				[2, right],
				[3, right],
			]);
		}
		if (row === rows + 4 && col === 2 && cols % 8 === 0) {
			corner(chr++, [
				[last, 0],
				[last, right],
				[0, right - 2],
				[0, right - 1],
				[0, right],
				[1, right - 2],
				[1, right - 1],
				[1, right],
			]);
		}
		do {
			if (row < rows && col >= 0 && map[row * cols + col] === 0) utah(row, col, chr++);
			row -= 2;
			col += 2;
		} while (row >= 0 && col < cols);
		row += 1;
		col += 3;
		do {
			if (row >= 0 && col < cols && map[row * cols + col] === 0) utah(row, col, chr++);
			row += 2;
			col -= 2;
		} while (row < rows && col >= 0);
		row += 3;
		col += 1;
	} while (row < rows || col < cols);
	return { map, count: chr - 1 };
}

/** Data and check symbol counts for the single-region square sizes, from ISO/IEC 16022 Table 7. */
export const DATA_MATRIX_BLOCKS: Readonly<Record<number, { data: number; ec: number }>> = {
	10: { data: 3, ec: 5 },
	12: { data: 5, ec: 7 },
	14: { data: 8, ec: 10 },
	16: { data: 12, ec: 12 },
	18: { data: 18, ec: 14 },
	20: { data: 22, ec: 18 },
	22: { data: 30, ec: 20 },
	24: { data: 36, ec: 24 },
	26: { data: 44, ec: 28 },
};

export interface DataMatrixRead {
	readonly size: number;
	readonly codewords: number[];
}

/** Encode `text` with bwip-js and read the symbol's codewords back. */
export function dataMatrixCodewords(text: string): DataMatrixRead {
	const [symbol] = bwipjs.raw('datamatrix', text, {}) as {
		pixs: number[];
		pixx: number;
		pixy: number;
	}[];
	if (!symbol || symbol.pixx !== symbol.pixy || symbol.pixx > 26) {
		throw new Error('expected a single-region square symbol');
	}
	const size = symbol.pixx;
	const inner = size - 2;
	const { map, count } = placement(inner, inner);
	const codewords = new Array<number>(count).fill(0);
	for (let r = 0; r < inner; r += 1) {
		for (let c = 0; c < inner; c += 1) {
			const cell = map[r * inner + c] as number;
			if (cell < 10) continue;
			const chr = Math.floor(cell / 10);
			const bit = cell % 10;
			if (symbol.pixs[(r + 1) * size + (c + 1)] === 1) {
				codewords[chr - 1] = (codewords[chr - 1] as number) | (1 << (8 - bit));
			}
		}
	}
	return { size, codewords };
}
