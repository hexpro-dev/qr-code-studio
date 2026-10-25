/**
 * Seeded randomness, for everything in the determinism zone that needs it:
 * the scan check's simulated damage, dithering, a random-looking design that
 * must look the same tomorrow.
 *
 * xoshiro128** 1.1 (Blackman and Vigna), seeded by splitmix32. Both are
 * integer arithmetic over 32 bits with `Math.imul` and shifts, which
 * ECMAScript fixes exactly, so a seed gives the same stream in every engine.
 * `Math.random` is banned here for the opposite reason: it is unseeded and
 * differs everywhere, and a verdict that depends on it cannot be reproduced.
 *
 * `fork` gives an independent stream per label, derived from the stream's
 * starting state rather than its current position. So a job can hand
 * `fork(1)` to one stage and `fork(2)` to another, and adding a draw to one
 * stage never shifts the numbers the other sees.
 */

export interface Prng {
	/** A number in [0, 1) with 32 bits of randomness. */
	next(): number;
	/** An integer in [0, maxExclusive), unbiased. maxExclusive is 1 to 2^32. */
	int(maxExclusive: number): number;
	/** An independent stream for `label` (0 to 2^32 - 1), the same however much of this one is used. */
	fork(label: number): Prng;
}

const GOLDEN = 0x9e3779b9;
const TWO_32 = 4294967296;

/** The splitmix32 output function: a bijection on 32 bits with good avalanche. */
function mix32(value: number): number {
	let z = value >>> 0;
	z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
	z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
	return (z ^ (z >>> 15)) >>> 0;
}

/**
 * Four consecutive splitmix32 outputs from `seed`.
 *
 * Each is mix32 of a different input and mix32 is zero only at zero, so at
 * most one of the four is zero and the state is never all zero, which is the
 * one state xoshiro cannot leave.
 */
function splitmix(seed: number): [number, number, number, number] {
	let state = seed >>> 0;
	const word = (): number => {
		state = (state + GOLDEN) >>> 0;
		return mix32(state);
	};
	return [word(), word(), word(), word()];
}

function checkUint32(value: number, what: string): void {
	if (!Number.isInteger(value) || value < 0 || value >= TWO_32) {
		throw new RangeError(`${what} is an integer from 0 to 2^32 - 1`);
	}
}

class Xoshiro128 implements Prng {
	private s0: number;
	private s1: number;
	private s2: number;
	private s3: number;
	private readonly origin: readonly [number, number, number, number];

	constructor(state: readonly [number, number, number, number]) {
		this.origin = state;
		[this.s0, this.s1, this.s2, this.s3] = state;
	}

	next(): number {
		return this.step() / TWO_32;
	}

	int(maxExclusive: number): number {
		if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_32) {
			throw new RangeError('int() takes a bound from 1 to 2^32');
		}
		// Rejection sampling: draws in the top partial copy of [0, n) would make
		// the low values likelier, so they are drawn again. Exact in doubles,
		// since everything here is below 2^33.
		const limit = TWO_32 - (TWO_32 % maxExclusive);
		for (;;) {
			const draw = this.step();
			if (draw < limit) return draw % maxExclusive;
		}
	}

	fork(label: number): Prng {
		checkUint32(label, 'a fork label');
		const [w0, w1, w2, w3] = splitmix(label);
		const [o0, o1, o2, o3] = this.origin;
		const child: [number, number, number, number] = [
			mix32(o0 ^ w0),
			mix32(o1 ^ w1),
			mix32(o2 ^ w2),
			mix32(o3 ^ w3),
		];
		// All zero only when the starting state equals the label's words, as it
		// does for createPrng(n).fork(n). The origin is never all zero, so this
		// rotation of it, mixed, never is either.
		if ((child[0] | child[1] | child[2] | child[3]) === 0) {
			return new Xoshiro128([mix32(o1), mix32(o2), mix32(o3), mix32(o0)]);
		}
		return new Xoshiro128(child);
	}

	/** xoshiro128** 1.1, one step. */
	private step(): number {
		const s1 = this.s1;
		const scaled = Math.imul(s1, 5);
		const result = Math.imul((scaled << 7) | (scaled >>> 25), 9) >>> 0;
		const t = s1 << 9;
		this.s2 ^= this.s0;
		this.s3 ^= s1;
		this.s1 ^= this.s2;
		this.s0 ^= this.s3;
		this.s2 ^= t;
		this.s3 = (this.s3 << 11) | (this.s3 >>> 21);
		return result;
	}
}

/** A stream seeded by `seed`, an integer from 0 to 2^32 - 1. */
export function createPrng(seed: number): Prng {
	checkUint32(seed, 'a seed');
	return new Xoshiro128(splitmix(seed));
}
