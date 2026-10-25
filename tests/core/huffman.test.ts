/**
 * The length-limited Huffman construction behind the compressor.
 *
 * Checked against the definition rather than against another encoder: the
 * Kraft sum of a complete code is exactly one, no length passes its limit, the
 * total cost is the optimum (found here by an exhaustive search over every
 * length assignment for small alphabets, and by the textbook Huffman
 * algorithm wherever the limit does not bind), and the canonical codes are the
 * ones RFC 1951 section 3.2.2 derives in its own example.
 */

import { describe, expect, it } from 'vitest';
import { canonicalCodes, codeLengths, reverseBits } from '../../src/core/huffman.js';
import { seeded } from './helpers.js';

function kraft(lengths: Uint8Array): number {
	let sum = 0;
	for (const length of lengths) if (length > 0) sum += 2 ** -length;
	return sum;
}

function cost(frequencies: readonly number[], lengths: Uint8Array): number {
	return frequencies.reduce((total, f, i) => total + f * (lengths[i] as number), 0);
}

/** The cost of an unrestricted Huffman code: repeatedly merge the two lightest. */
function huffmanCost(frequencies: readonly number[]): number {
	const weights = frequencies.filter((f) => f > 0).sort((a, b) => a - b);
	if (weights.length < 2) return weights.length === 1 ? (weights[0] as number) : 0;
	let total = 0;
	while (weights.length > 1) {
		const merged = (weights.shift() as number) + (weights.shift() as number);
		total += merged;
		let at = 0;
		while (at < weights.length && (weights[at] as number) < merged) at += 1;
		weights.splice(at, 0, merged);
	}
	return total;
}

/** The cheapest complete code of lengths 1..limit, by trying every assignment. */
function bruteForceCost(frequencies: readonly number[], limit: number): number {
	const used = frequencies.filter((f) => f > 0);
	let best = Infinity;
	const lengths = new Array<number>(used.length).fill(1);
	const walk = (i: number, sum: number, total: number): void => {
		if (sum > 1 || total >= best) return;
		if (i === used.length) {
			if (sum === 1) best = total;
			return;
		}
		for (let length = 1; length <= limit; length += 1) {
			lengths[i] = length;
			walk(i + 1, sum + 2 ** -length, total + (used[i] as number) * length);
		}
	};
	walk(0, 0, 0);
	return best;
}

describe('codeLengths', () => {
	it('gives nothing to unused symbols and one bit to a lone symbol', () => {
		expect([...codeLengths([0, 0, 0], 15)]).toEqual([0, 0, 0]);
		expect([...codeLengths([0, 5, 0], 15)]).toEqual([0, 1, 0]);
		expect([...codeLengths([3, 0, 9], 15)]).toEqual([1, 0, 1]);
	});

	it('is optimal and complete for every small alphabet it is given', () => {
		const random = seeded(1952);
		for (let trial = 0; trial < 300; trial += 1) {
			const size = 2 + random.int(6);
			const frequencies = Array.from({ length: size }, () =>
				random.next() < 0.2 ? 0 : 1 + random.int(random.next() < 0.5 ? 10 : 1000),
			);
			if (frequencies.filter((f) => f > 0).length < 2) continue;
			const used = frequencies.filter((f) => f > 0).length;
			const limit = Math.max(Math.ceil(Math.log2(used)), 1 + random.int(5));
			const lengths = codeLengths(frequencies, limit);
			const label = `${frequencies.join(',')} limit ${limit}`;
			expect(kraft(lengths), label).toBe(1);
			expect(Math.max(...lengths), label).toBeLessThanOrEqual(limit);
			expect(cost(frequencies, lengths), label).toBe(bruteForceCost(frequencies, limit));
		}
	});

	it('matches unrestricted Huffman when the limit does not bind', () => {
		// A limit of 30 cannot bind here: a code 28 deep needs a total weight of
		// at least the 30th Fibonacci number, more than 286 symbols of at most
		// 5000 can reach.
		const random = seeded(286);
		for (let trial = 0; trial < 50; trial += 1) {
			const frequencies = Array.from({ length: 286 }, () =>
				random.next() < 0.3 ? 0 : 1 + random.int(5000),
			);
			const lengths = codeLengths(frequencies, 30);
			expect(kraft(lengths)).toBe(1);
			expect(cost(frequencies, lengths)).toBe(huffmanCost(frequencies));
		}
	});

	it('costs more than unrestricted Huffman only when the limit binds', () => {
		const random = seeded(15);
		let bound = 0;
		for (let trial = 0; trial < 50; trial += 1) {
			const frequencies = Array.from({ length: 286 }, () =>
				random.next() < 0.3 ? 0 : 1 + random.int(random.next() < 0.1 ? 3 : 50_000),
			);
			const limited = codeLengths(frequencies, 15);
			const free = codeLengths(frequencies, 30);
			expect(kraft(limited)).toBe(1);
			expect(Math.max(...limited)).toBeLessThanOrEqual(15);
			if (Math.max(...free) <= 15) {
				expect(cost(frequencies, limited)).toBe(cost(frequencies, free));
			} else {
				bound += 1;
				expect(cost(frequencies, limited)).toBeGreaterThanOrEqual(cost(frequencies, free));
			}
		}
		expect(bound).toBeGreaterThan(0);
	});

	it('holds the limit when Fibonacci frequencies would need much longer codes', () => {
		// Fibonacci weights are the worst case: unrestricted Huffman gives the
		// lightest symbols a length of n - 1.
		const fibonacci = [1, 1];
		while (fibonacci.length < 30) {
			fibonacci.push((fibonacci.at(-1) as number) + (fibonacci.at(-2) as number));
		}
		for (const limit of [7, 9, 15]) {
			const lengths = codeLengths(fibonacci, limit);
			expect(Math.max(...lengths)).toBe(limit);
			expect(kraft(lengths)).toBe(1);
		}
		// Small enough to search exhaustively, with the limit binding hard.
		const small = fibonacci.slice(0, 9);
		expect(cost(small, codeLengths(small, 4))).toBe(bruteForceCost(small, 4));
	});

	it('fills a code exactly when the alphabet needs every slot', () => {
		const lengths = codeLengths(new Array<number>(16).fill(1), 4);
		expect([...lengths]).toEqual(new Array<number>(16).fill(4));
		const seven = codeLengths(new Array<number>(128).fill(3), 7);
		expect(Math.max(...seven)).toBe(7);
		expect(Math.min(...seven)).toBe(7);
	});

	it('breaks ties by symbol, so equal frequencies give equal codes everywhere', () => {
		const lengths = codeLengths([5, 5, 5], 15);
		expect([...lengths]).toEqual([2, 2, 1]);
		expect(codeLengths([5, 5, 5], 15)).toEqual(lengths);
	});

	it('refuses a limit too short for the alphabet', () => {
		expect(() => codeLengths(new Array<number>(17).fill(1), 4)).toThrow(RangeError);
		expect(() => codeLengths([1, 1], 0)).toThrow(RangeError);
		expect(() => codeLengths([1, 1], 31)).toThrow(RangeError);
		expect(() => codeLengths([1, 1], 2.5)).toThrow(RangeError);
	});
});

describe('canonicalCodes', () => {
	it('gives the codes in the example of RFC 1951 section 3.2.2', () => {
		// Lengths (3, 3, 3, 3, 3, 2, 4, 4) for A to H give 010, 011, 100, 101,
		// 110, 00, 1110, 1111. Stored reversed, as the stream sends them.
		const lengths = Uint8Array.from([3, 3, 3, 3, 3, 2, 4, 4]);
		const expected = [0b010, 0b011, 0b100, 0b101, 0b110, 0b00, 0b1110, 0b1111];
		const codes = canonicalCodes(lengths);
		expect([...codes]).toEqual(expected.map((code, i) => reverseBits(code, lengths[i] as number)));
	});

	it('skips unused symbols', () => {
		expect([...canonicalCodes(Uint8Array.from([0, 1, 0, 1]))]).toEqual([0, 0, 0, 1]);
	});
});

describe('reverseBits', () => {
	it('reverses the low bits only', () => {
		expect(reverseBits(0b1011, 4)).toBe(0b1101);
		expect(reverseBits(0b1, 3)).toBe(0b100);
		expect(reverseBits(0xffff, 0)).toBe(0);
	});
});
