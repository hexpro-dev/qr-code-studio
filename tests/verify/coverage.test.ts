/**
 * The logo budget's coverage model: modules to codewords to blocks.
 *
 * Checked two ways. By hand, for small symbols whose placement is easy to
 * follow (QR places codeword 0 in the bottom right corner, two modules wide
 * and four tall, then works up). And by brute force: flip modules in the
 * matrix and let the symbology's own reader say which blocks it had to
 * repair and how much, which is the ground truth the model must match.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encode } from '../../src/encode/encode.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';
import { interleaveOrder } from '../../src/symbology/qr/blocks.js';
import { codewordCoverage, reserveFor } from '../../src/verify/coverage.js';
import { registries } from './helpers.js';

function obscure(symbol: BuiltSymbol, cells: readonly [number, number][]): Uint8Array {
	const out = new Uint8Array(symbol.matrix.width * symbol.matrix.height);
	for (const [x, y] of cells) out[y * symbol.matrix.width + x] = 1;
	return out;
}

function rect(x0: number, y0: number, w: number, h: number): [number, number][] {
	const out: [number, number][] = [];
	for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) out.push([x, y]);
	return out;
}

describe('by hand', () => {
	it('gives t and the reserve from ec and p', () => {
		expect(reserveFor(0)).toBe(0);
		expect(reserveFor(4)).toBe(1);
		expect(reserveFor(8)).toBe(2);
		expect(reserveFor(9)).toBe(3);
		// Version 1-M: one block, 10 check codewords, p = 2 (ISO/IEC 18004 Table 9).
		const v1m = encode('HELLO', { ecLevel: 'M', maxVersion: '1' });
		const [block] = codewordCoverage(v1m, obscure(v1m, [])).blocks;
		expect(block).toEqual({
			index: 0,
			ec: 10,
			p: 2,
			t: 4,
			reserve: 1,
			coveredWorst: 0,
			coveredExpected: 0,
			margin: 3,
		});
		// 1-H keeps p = 1 of its 17.
		const v1h = encode('HELLO', { ecLevel: 'H', maxVersion: '1' });
		expect(codewordCoverage(v1h, obscure(v1h, [])).blocks[0]).toMatchObject({
			t: 8,
			reserve: 2,
			margin: 6,
		});
	});

	it('puts the bottom right corner in codeword 0 of block 0', () => {
		const v1 = encode('HELLO', { ecLevel: 'M', maxVersion: '1' });
		const coverage = codewordCoverage(v1, obscure(v1, [[20, 20]]));
		expect(coverage.blocks[0]?.coveredWorst).toBe(1);
		expect(coverage.worst[0]).toBe(1);
		// The whole first codeword is one codeword; the first two are two.
		expect(codewordCoverage(v1, obscure(v1, rect(19, 17, 2, 4))).blocks[0]?.coveredWorst).toBe(1);
		expect(codewordCoverage(v1, obscure(v1, rect(19, 13, 2, 8))).blocks[0]?.coveredWorst).toBe(2);
		// Function modules carry no codeword.
		expect(codewordCoverage(v1, obscure(v1, rect(0, 0, 7, 7))).blocks[0]?.coveredWorst).toBe(0);
	});

	it('spreads consecutive codewords across the blocks of version 5-Q', () => {
		const v5 = encode('A'.repeat(40), { ecLevel: 'Q', minVersion: '5', maxVersion: '5' });
		expect(v5.blocks.blocks.map((b) => b.dataCount)).toEqual([15, 15, 16, 16]);
		// Codewords 0, 1 and 2 run up the right edge from the corner, clear of the alignment pattern.
		const coverage = codewordCoverage(v5, obscure(v5, rect(35, 25, 2, 12)));
		expect(coverage.blocks.map((b) => b.coveredWorst)).toEqual([1, 1, 1, 0]);
		expect(coverage.blocks.map((b) => b.t)).toEqual([9, 9, 9, 9]);
		expect(coverage.blocks.map((b) => b.margin)).toEqual([5, 5, 5, 6]);
	});

	it('counts expected codewords only where an obscured module samples wrong', () => {
		const v1 = encode('HELLO', { ecLevel: 'M', maxVersion: '1' });
		const obscured = obscure(v1, rect(19, 13, 2, 8));
		const wrong = new Uint8Array(obscured.length);
		wrong[20 * 21 + 20] = 1;
		// Wrong but not obscured does not count.
		wrong[0] = 1;
		const coverage = codewordCoverage(v1, obscured, wrong);
		expect(coverage.blocks[0]).toMatchObject({ coveredWorst: 2, coveredExpected: 1 });
		expect(Array.from(coverage.expected.subarray(0, 2))).toEqual([1, 0]);
	});

	it('refuses a map of the wrong size', () => {
		const v1 = encode('HELLO');
		expect(() => codewordCoverage(v1, new Uint8Array(3))).toThrow(TypeError);
	});
});

/** The symbology's own reading of `symbol` with the modules in `flip` inverted. */
function readFlipped(symbol: BuiltSymbol, flip: Uint8Array) {
	const matrix = symbol.matrix.clone();
	for (let i = 0; i < flip.length; i += 1) {
		if (flip[i] === 1) matrix.xor(i % matrix.width, Math.floor(i / matrix.width));
	}
	const entry = registries.symbologies.require(symbol.symbology);
	return entry.read(matrix, { strict: false });
}

describe('by brute force, against the reader', () => {
	const symbols: [string, BuiltSymbol][] = [
		['QR 1-L', encode('HELLO', { ecLevel: 'L', maxVersion: '1' })],
		['QR 2-H', encode('EXAMPLE 2H', { ecLevel: 'H', minVersion: '2', maxVersion: '2' })],
		['QR 5-Q', encode('A'.repeat(40), { ecLevel: 'Q', minVersion: '5', maxVersion: '5' })],
		[
			'Micro QR M3-M',
			encode('12345', { symbology: 'micro', ecLevel: 'M', minVersion: 'M3', maxVersion: 'M3' }),
		],
		[
			'rMQR R11x43',
			encode('HELLO', { symbology: 'rmqr', minVersion: 'R11x43', maxVersion: 'R11x43' }),
		],
	];

	for (const [name, symbol] of symbols) {
		it(`${name}: every data module alone costs one error in the block the model names`, () => {
			const { layout } = symbol;
			const order = interleaveOrder(symbol.blocks);
			for (let i = 0; i < layout.dataBits.length; i += 1) {
				const bit = layout.dataBits[i] as number;
				if (bit < 0) continue;
				const flip = new Uint8Array(layout.dataBits.length);
				flip[i] = 1;
				const coverage = codewordCoverage(symbol, flip);
				const block = order.block[bit >> 3] as number;
				expect(coverage.blocks.map((b) => b.coveredWorst)).toEqual(
					coverage.blocks.map((_, index) => (index === block ? 1 : 0)),
				);
				const read = readFlipped(symbol, flip);
				expect(read.errorsPerBlock, `${name} module ${i}`).toEqual(
					coverage.blocks.map((b) => b.coveredWorst),
				);
			}
		});
	}

	it('every covered codeword corrupted costs exactly coveredWorst errors per block, or the read fails past t', () => {
		const symbol = symbols[2]?.[1] as BuiltSymbol;
		const { width } = symbol.matrix;
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: width - 1 }),
				fc.integer({ min: 0, max: width - 1 }),
				fc.integer({ min: 1, max: 9 }),
				fc.integer({ min: 1, max: 9 }),
				(x, y, w, h) => {
					const flip = obscure(symbol, rect(x, y, Math.min(w, width - x), Math.min(h, width - y)));
					// Only the data modules are flipped: a reader can lose a timing
					// module, but that is the function pattern check's business.
					for (let i = 0; i < flip.length; i += 1)
						if ((symbol.layout.dataBits[i] as number) < 0) flip[i] = 0;
					const coverage = codewordCoverage(symbol, flip);
					const within = coverage.blocks.every((b) => b.coveredWorst <= b.t);
					if (!within) {
						expect(() => readFlipped(symbol, flip)).toThrow();
						return;
					}
					expect(readFlipped(symbol, flip).errorsPerBlock).toEqual(
						coverage.blocks.map((b) => b.coveredWorst),
					);
				},
			),
			{ numRuns: 120, seed: 11 },
		);
	});
});
