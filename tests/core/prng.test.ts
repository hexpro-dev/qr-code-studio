/**
 * The seeded generator, against the published algorithms.
 *
 * The vectors were produced by the reference C code for xoshiro128** 1.1
 * (prng.di.unimi.it/xoshiro128starstar.c) seeded by splitmix32 with the
 * constants used here, compiled and run once; the program is short enough to
 * be described in the comments below rather than kept. Beyond the vectors, an
 * independent implementation in BigInt arithmetic (no Math.imul, no int32
 * coercion anywhere) is checked against the C output for the state 1, 2, 3, 4,
 * and then against this package for thousands of outputs from many seeds.
 */

import { describe, expect, it } from 'vitest';
import { createPrng } from '../../src/core/prng.js';

const MASK = 0xffffffffn;

function rotl(x: bigint, k: bigint): bigint {
	return ((x << k) | (x >> (32n - k))) & MASK;
}

/** xoshiro128** 1.1 in BigInt, from the paper's description. */
function referenceStream(state: readonly bigint[]): () => bigint {
	const s = [...state];
	return () => {
		const [s0, s1, s2, s3] = s as [bigint, bigint, bigint, bigint];
		const result = (rotl((s1 * 5n) & MASK, 7n) * 9n) & MASK;
		const t = (s1 << 9n) & MASK;
		const n2 = s2 ^ s0;
		const n3 = s3 ^ s1;
		const n1 = s1 ^ n2;
		const n0 = s0 ^ n3;
		s[0] = n0;
		s[1] = n1;
		s[2] = n2 ^ t;
		s[3] = rotl(n3, 11n);
		return result;
	};
}

/** splitmix32 in BigInt: add the golden ratio, then the hash prospector finaliser. */
function referenceSeed(seed: number): bigint[] {
	let state = BigInt(seed);
	const out: bigint[] = [];
	for (let i = 0; i < 4; i += 1) {
		state = (state + 0x9e3779b9n) & MASK;
		let z = state;
		z = ((z ^ (z >> 16n)) * 0x21f0aaadn) & MASK;
		z = ((z ^ (z >> 15n)) * 0x735a2d97n) & MASK;
		out.push(z ^ (z >> 15n));
	}
	return out;
}

const draws = (seed: number, count: number): number[] => {
	const prng = createPrng(seed);
	return Array.from({ length: count }, () => prng.next() * 4294967296);
};

describe('createPrng', () => {
	it('matches the reference C program for the seeds it was run with', () => {
		// Output of the C program described above.
		expect(draws(0, 8)).toEqual([
			1789933344, 44971166, 2521387044, 3848737593, 1138324114, 749234105, 1899511038, 1995189375,
		]);
		expect(draws(1, 8)).toEqual([
			393288148, 2174103013, 3814759091, 2092745082, 1865176206, 2179171167, 3207394750, 2858353069,
		]);
		expect(draws(42, 8)).toEqual([
			660444221, 3652823732, 77672526, 910233633, 2297337756, 3786072677, 3123505064, 1891482476,
		]);
		expect(draws(0xdeadbeef, 8)).toEqual([
			3842467093, 879304004, 3694663928, 2788030634, 934155191, 702880729, 3422146658, 169081873,
		]);
		expect(draws(0xffffffff, 8)).toEqual([
			4104197751, 1825856343, 1152209388, 2427537429, 3685145430, 609215610, 4161674276, 1502890106,
		]);
	});

	it('has a BigInt reference that agrees with the C program', () => {
		// The C program's state 1, 2, 3, 4 and its splitmix32 seeding of 0.
		const stream = referenceStream([1n, 2n, 3n, 4n]);
		expect(Array.from({ length: 8 }, () => Number(stream()))).toEqual([
			11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
		]);
		expect(referenceSeed(0).map(Number)).toEqual([1684164658, 3653269916, 2939563536, 2141751570]);
	});

	it('agrees with the BigInt reference for thousands of outputs from many seeds', () => {
		for (const seed of [0, 1, 2, 3, 255, 65536, 123456789, 0x80000000, 0xfffffffe]) {
			const reference = referenceStream(referenceSeed(seed));
			const ours = createPrng(seed);
			for (let i = 0; i < 4000; i += 1) {
				const expected = Number(reference());
				const got = ours.next() * 4294967296;
				if (got !== expected) expect(got, `seed ${seed}, draw ${i}`).toBe(expected);
			}
		}
	});

	it('returns numbers in [0, 1) carrying exactly 32 bits', () => {
		const prng = createPrng(7);
		let sum = 0;
		for (let i = 0; i < 100_000; i += 1) {
			const value = prng.next();
			expect(value >= 0 && value < 1).toBe(true);
			expect(Number.isInteger(value * 4294967296)).toBe(true);
			sum += value;
		}
		expect(Math.abs(sum / 100_000 - 0.5)).toBeLessThan(0.005);
	});

	it('refuses a seed that is not an unsigned 32 bit integer', () => {
		for (const seed of [-1, 4294967296, 1.5, Number.NaN]) {
			expect(() => createPrng(seed)).toThrow(RangeError);
		}
	});
});

describe('int', () => {
	it('is uniform over a small range', () => {
		const prng = createPrng(11);
		const counts = new Array<number>(6).fill(0);
		const n = 120_000;
		for (let i = 0; i < n; i += 1) {
			const value = prng.int(6);
			counts[value] = (counts[value] as number) + 1;
		}
		// Chi-square with 5 degrees of freedom; 20.5 is the 0.1% critical value.
		const expected = n / 6;
		const chi = counts.reduce((total, c) => total + (c - expected) ** 2 / expected, 0);
		expect(chi).toBeLessThan(20.5);
	});

	it('rejects rather than folds, so a bound near 2^32 is not biased', () => {
		// 3 * 2^30 does not divide 2^32: folding by modulo would land in
		// [0, 2^30) half the time instead of a third.
		const prng = createPrng(12);
		const bound = 3 * 2 ** 30;
		let low = 0;
		const n = 60_000;
		for (let i = 0; i < n; i += 1) {
			const value = prng.int(bound);
			expect(value >= 0 && value < bound && Number.isInteger(value)).toBe(true);
			if (value < 2 ** 30) low += 1;
		}
		expect(Math.abs(low / n - 1 / 3)).toBeLessThan(0.01);
	});

	it('uses one draw per value when nothing is rejected', () => {
		// 2^32 and every power of two divide the range, so int is the raw draw.
		const a = createPrng(13);
		const b = createPrng(13);
		for (let i = 0; i < 100; i += 1) expect(a.int(4294967296)).toBe(b.next() * 4294967296);
		const c = createPrng(13);
		const d = createPrng(13);
		for (let i = 0; i < 100; i += 1) expect(c.int(256)).toBe((d.next() * 4294967296) % 256);
		expect(createPrng(1).int(1)).toBe(0);
	});

	it('draws again on a rejection', () => {
		// Just over 2^31: almost half of all draws fall past the limit.
		const bound = 2 ** 31 + 1;
		const prng = createPrng(14);
		const raw = createPrng(14);
		let rejections = 0;
		for (let i = 0; i < 1000; i += 1) {
			const value = prng.int(bound);
			let draw = raw.next() * 4294967296;
			while (draw >= bound) {
				rejections += 1;
				draw = raw.next() * 4294967296;
			}
			expect(value).toBe(draw);
		}
		expect(rejections).toBeGreaterThan(300);
	});

	it('refuses a bound outside 1 to 2^32', () => {
		const prng = createPrng(15);
		for (const bound of [0, -3, 4294967297, 2.5, Number.NaN]) {
			expect(() => prng.int(bound)).toThrow(RangeError);
		}
	});
});

describe('fork', () => {
	it('gives the same stream for a label however much of the parent is used', () => {
		const parent = createPrng(21);
		const early = parent.fork(3);
		for (let i = 0; i < 1000; i += 1) parent.next();
		const late = parent.fork(3);
		const again = createPrng(21).fork(3);
		for (let i = 0; i < 100; i += 1) {
			const value = early.next();
			expect(late.next()).toBe(value);
			expect(again.next()).toBe(value);
		}
	});

	it('gives unrelated streams for different labels, and none equal to the parent', () => {
		const parent = createPrng(22);
		const streams = [0, 1, 2, 0xffffffff].map((label) => parent.fork(label));
		const first = streams.map((stream) => Array.from({ length: 64 }, () => stream.next()));
		const own = Array.from({ length: 64 }, () => createPrng(22).next());
		for (let i = 0; i < first.length; i += 1) {
			expect(first[i]).not.toEqual(own);
			for (let j = i + 1; j < first.length; j += 1) expect(first[i]).not.toEqual(first[j]);
		}
		// Weakly correlated, as independent streams should be.
		const a = createPrng(22).fork(1);
		const b = createPrng(22).fork(2);
		let ab = 0;
		let aa = 0;
		let bb = 0;
		for (let i = 0; i < 50_000; i += 1) {
			const x = a.next() - 0.5;
			const y = b.next() - 0.5;
			ab += x * y;
			aa += x * x;
			bb += y * y;
		}
		expect(Math.abs(ab / Math.sqrt(aa * bb))).toBeLessThan(0.02);
	});

	it('forks of forks are deterministic too', () => {
		const a = createPrng(23).fork(1).fork(2);
		const b = createPrng(23).fork(1).fork(2);
		const c = createPrng(23).fork(2).fork(1);
		const values = Array.from({ length: 16 }, () => a.next());
		expect(Array.from({ length: 16 }, () => b.next())).toEqual(values);
		expect(Array.from({ length: 16 }, () => c.next())).not.toEqual(values);
	});

	it('pins the streams it derives', () => {
		// Regression values from this implementation: a change here changes every
		// seeded verdict the scan check has ever reported.
		const take = (prng: ReturnType<typeof createPrng>): number[] =>
			Array.from({ length: 4 }, () => prng.next() * 4294967296);
		expect(take(createPrng(0).fork(0))).toEqual(FORK_VECTORS['0/0']);
		expect(take(createPrng(42).fork(7))).toEqual(FORK_VECTORS['42/7']);
		expect(take(createPrng(42).fork(7).fork(1))).toEqual(FORK_VECTORS['42/7/1']);
	});

	it('keeps a fork whose label equals its seed out of the all-zero state', () => {
		// createPrng(n).fork(n) mixes a state with itself; the fallback must still
		// give a live stream, distinct from the parent's.
		const forked = createPrng(9).fork(9);
		const values = Array.from({ length: 32 }, () => forked.next());
		expect(values.some((value) => value !== 0)).toBe(true);
		expect(new Set(values).size).toBe(32);
		expect(values).not.toEqual(Array.from({ length: 32 }, () => createPrng(9).next()));
	});

	it('refuses a label that is not an unsigned 32 bit integer', () => {
		const prng = createPrng(24);
		for (const label of [-1, 4294967296, 0.5, Number.NaN]) {
			expect(() => prng.fork(label)).toThrow(RangeError);
		}
	});
});

/** From this implementation, pinned. '0/0' goes through the all-zero fallback. */
const FORK_VECTORS: Record<string, number[]> = {
	'0/0': [2366085622, 351697206, 3050139616, 2889411009],
	'42/7': [3521672405, 132683674, 3360304385, 372652105],
	'42/7/1': [569172564, 1275480503, 1271616639, 599735134],
};
