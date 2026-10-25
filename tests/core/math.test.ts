/**
 * The deterministic maths, against Math and against exact arithmetic.
 *
 * Math is the reference for accuracy here and only here: V8's sin, cos, exp,
 * log and atan2 are fdlibm ports, within an ulp of the true value, so a
 * difference of more than a few ulps from them is an error of ours. The
 * contract is 1e-12 relative; the bounds below are tighter, close to what the
 * implementation actually reaches, so a wrong coefficient (which would still
 * pass 1e-12 for some) shows up. Where Math is not good enough to judge by
 * (hypot, and the exactness promises of pow) the reference is BigInt.
 *
 * Every special value is compared with Object.is, so a lost signed zero
 * fails.
 */

import { describe, expect, it } from 'vitest';
import { PI, TAU, atan2, cos, exp, hypot, ln, pow, sin } from '../../src/core/math.js';
import type { Seeded } from './helpers.js';
import { seeded } from './helpers.js';

const ULP = 2 ** -52;

/** Relative difference, or absolute where the reference is below `floor`. */
function error(got: number, expected: number, floor = 0): number {
	if (Object.is(got, expected)) return 0;
	return Math.abs(got - expected) / Math.max(Math.abs(expected), floor);
}

interface Sample {
	readonly name: string;
	readonly draw: (random: Seeded) => number[];
}

function uniform(random: Seeded, low: number, high: number): number {
	return low + (high - low) * random.next();
}

/** Spread evenly over the exponents between low and high. */
function logUniform(random: Seeded, low: number, high: number): number {
	return Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * random.next());
}

function signed(random: Seeded, value: number): number {
	return random.next() < 0.5 ? -value : value;
}

/** The worst error over `count` draws, and where it was. */
function worst(
	sample: Sample,
	ours: (...args: number[]) => number,
	reference: (...args: number[]) => number,
	floor = 0,
	count = 20_000,
): { error: number; at: number[] } {
	const random = seeded(sample.name.length * 7919 + count);
	let found = { error: 0, at: [] as number[] };
	for (let i = 0; i < count; i += 1) {
		const args = sample.draw(random);
		const e = error(ours(...args), reference(...args), floor);
		if (!(e <= found.error)) found = { error: e, at: args };
	}
	return found;
}

function holds(
	samples: readonly Sample[],
	ours: (...args: number[]) => number,
	reference: (...args: number[]) => number,
	bound: number,
	floor = 0,
): void {
	for (const sample of samples) {
		const { error: e, at } = worst(sample, ours, reference, floor);
		expect(e, `${sample.name}: ${e} at ${at.join(', ')}`).toBeLessThanOrEqual(bound);
		// The contract, stated separately so a relaxed bound above cannot hide it.
		expect(e).toBeLessThanOrEqual(1e-12);
	}
}

describe('constants', () => {
	it('are the doubles nearest pi and 2 pi', () => {
		expect(PI).toBe(Math.PI);
		expect(TAU).toBe(2 * Math.PI);
	});
});

const TRIG_SAMPLES: readonly Sample[] = [
	{ name: 'inside pi/4', draw: (r) => [uniform(r, -0.78, 0.78)] },
	{ name: 'small', draw: (r) => [uniform(r, -10, 10)] },
	{ name: 'hundreds', draw: (r) => [uniform(r, -1000, 1000)] },
	{ name: 'up to the medium limit', draw: (r) => [uniform(r, -1.6e6, 1.6e6)] },
	{ name: 'past the medium limit', draw: (r) => [signed(r, logUniform(r, 1.6e6, 1e18))] },
	{ name: 'huge', draw: (r) => [signed(r, logUniform(r, 1e18, 1.7e308))] },
	{ name: 'tiny', draw: (r) => [signed(r, logUniform(r, 1e-300, 1e-5))] },
	{
		name: 'near multiples of pi/2',
		draw: (r) => [
			((2 * Math.floor(uniform(r, -2000, 2000)) + 1) * Math.PI) / 2 + uniform(r, -1e-7, 1e-7),
		],
	},
	{
		name: 'near multiples of pi',
		draw: (r) => [Math.floor(uniform(r, -2000, 2000)) * Math.PI + uniform(r, -1e-7, 1e-7)],
	},
];

describe('sin and cos', () => {
	it('agree with Math to about an ulp everywhere, including huge arguments', () => {
		holds(TRIG_SAMPLES, sin, Math.sin, 3 * ULP, 1e-300);
		holds(TRIG_SAMPLES, cos, Math.cos, 3 * ULP, 1e-300);
	});

	it('reduce the hardest double there is correctly', () => {
		// 6381956970095103 * 2^797 is the double closest to a multiple of pi/2
		// (Muller, Elementary Functions, table 11.1): its reduced argument is
		// about 4.7e-19, so any shortfall in the bits of 2/pi shows up whole.
		const x = 6381956970095103 * 2 ** 797;
		expect(error(sin(x), Math.sin(x))).toBeLessThanOrEqual(3 * ULP);
		expect(error(cos(x), Math.cos(x))).toBeLessThanOrEqual(3 * ULP);
		expect(Math.min(Math.abs(sin(x)), Math.abs(cos(x)))).toBeLessThan(1e-18);
	});

	it('give the exact values the kernels promise', () => {
		expect(Object.is(sin(0), 0)).toBe(true);
		expect(Object.is(sin(-0), -0)).toBe(true);
		expect(cos(0)).toBe(1);
		expect(cos(-0)).toBe(1);
		expect(sin(1e-10)).toBe(1e-10);
		expect(sin(-5e-324)).toBe(-5e-324);
		expect(cos(1e-10)).toBe(1);
		for (const value of [Number.NaN, Infinity, -Infinity]) {
			expect(sin(value)).toBeNaN();
			expect(cos(value)).toBeNaN();
		}
	});

	it('are odd and even', () => {
		const random = seeded(301);
		for (let i = 0; i < 2000; i += 1) {
			const x = signed(random, logUniform(random, 1e-3, 1e12));
			expect(sin(-x)).toBe(-sin(x));
			expect(cos(-x)).toBe(cos(x));
		}
	});
});

const BITS = 260n;

/** atan(p/q) * 2^260 for 0 <= p < q, from its Taylor series in BigInt. */
function atanFixed(p: bigint, q: bigint): bigint {
	const one = 1n << BITS;
	let term = (one * p) / q;
	let sum = term;
	for (let k = 1n; term !== 0n; k += 1n) {
		term = (term * p * p) / (q * q);
		sum += (k & 1n ? -term : term) / (2n * k + 1n);
	}
	return sum;
}

/** A 2^260 fixed-point value rounded once to the nearest double. */
function toDouble(fixed: bigint): number {
	return Number(fixed) * 2 ** -Number(BITS);
}

let piFixed: bigint | undefined;

/** pi times 2^260, from Machin's formula. */
function exactPiFixed(): bigint {
	if (piFixed !== undefined) return piFixed;
	const one = 1n << (BITS + 16n);
	const arctanInverse = (n: bigint): bigint => {
		let term = one / n;
		let sum = term;
		for (let k = 1n; term !== 0n; k += 1n) {
			term /= n * n;
			sum += (k & 1n ? -term : term) / (2n * k + 1n);
		}
		return sum;
	};
	piFixed = (16n * arctanInverse(5n) - 4n * arctanInverse(239n)) >> 16n;
	return piFixed;
}

describe('atan2', () => {
	const samples: readonly Sample[] = [
		{ name: 'square', draw: (r) => [uniform(r, -10, 10), uniform(r, -10, 10)] },
		{
			name: 'every magnitude',
			draw: (r) => [
				signed(r, logUniform(r, 1e-150, 1e150)),
				signed(r, logUniform(r, 1e-150, 1e150)),
			],
		},
		{
			name: 'near the diagonals',
			draw: (r) => {
				const x = signed(r, logUniform(r, 1e-3, 1e3));
				return [signed(r, Math.abs(x) * (1 + uniform(r, -1e-9, 1e-9))), x];
			},
		},
		{
			name: 'near the table points',
			draw: (r) => {
				const x = logUniform(r, 1e-3, 1e3);
				return [x * ((Math.floor(uniform(r, 0, 17)) + uniform(r, -0.5, 0.5)) / 16), signed(r, x)];
			},
		},
	];

	it('agrees with Math to about an ulp in every quadrant', () => {
		holds(samples, atan2, Math.atan2, 3 * ULP);
	});

	it('hits the table points exactly, as atan(i/8) correctly rounded', () => {
		// The reference is BigInt: atan(i/8) by its Taylor series to 260 bits,
		// rounded once by Number(). Math.atan2(3, 8) is an ulp low, so Math cannot
		// be the judge here.
		for (let i = 0; i <= 8; i += 1) {
			const fixed = i === 8 ? exactPiFixed() / 4n : atanFixed(BigInt(i), 8n);
			expect(atan2(i, 8), `${i}/8`).toBe(toDouble(fixed));
			// Reflected into the third quadrant, one more rounding is allowed.
			const reflected = -toDouble(exactPiFixed() - fixed);
			expect(error(atan2(-i || -0, -8), reflected), `-${i}/-8`).toBeLessThanOrEqual(ULP);
		}
	});

	it('matches Math.atan2 on every combination of signed zeros, infinities and NaN', () => {
		const values = [0, -0, 1, -1, 2.5, -2.5, Infinity, -Infinity, Number.NaN, 5e-324, -5e-324];
		const special = (v: number): boolean => v === 0 || !Number.isFinite(v);
		for (const y of values) {
			for (const x of values) {
				const expected = Math.atan2(y, x);
				const got = atan2(y, x);
				if (special(x) || special(y)) {
					expect(Object.is(got, expected), `atan2(${y}, ${x})`).toBe(true);
				} else {
					// Two finite values: Math is the one an ulp out at (2.5, -1), so
					// only closeness is asked of the pair.
					expect(error(got, expected), `atan2(${y}, ${x})`).toBeLessThanOrEqual(ULP);
				}
			}
		}
	});
});

/** sqrt(a^2 + b^2) rounded to the nearest double, from BigInt arithmetic. */
function exactHypot(a: number, b: number): number {
	const parts = (v: number): [bigint, number] => {
		let m = Math.abs(v);
		let e = 0;
		while (!Number.isInteger(m)) {
			m *= 2;
			e -= 1;
		}
		while (m > Number.MAX_SAFE_INTEGER) {
			m /= 2;
			e += 1;
		}
		return [BigInt(m), e];
	};
	const [ma, ea] = parts(a);
	const [mb, eb] = parts(b);
	const e = Math.min(ea, eb);
	const big = ma ** 2n * 4n ** BigInt(ea - e) + mb ** 2n * 4n ** BigInt(eb - e);
	// sqrt(big) * 2^e, computed to 200 extra bits, then rounded once by Number().
	const extra = 200;
	const target = big << BigInt(2 * extra);
	let root = 1n << BigInt(Math.ceil(target.toString(2).length / 2));
	for (;;) {
		const next = (root + target / root) >> 1n;
		if (next >= root) break;
		root = next;
	}
	return Number(root) * 2 ** (e - extra);
}

describe('hypot', () => {
	it('is correctly rounded, checked against exact arithmetic', () => {
		const random = seeded(401);
		let misses = 0;
		for (let i = 0; i < 4000; i += 1) {
			const a = signed(random, logUniform(random, 1e-3, 1e3));
			const b = signed(random, logUniform(random, 1e-3, 1e3) * (random.next() < 0.2 ? 1e-9 : 1));
			if (hypot(a, b) !== exactHypot(a, b)) misses += 1;
		}
		expect(misses).toBe(0);
	});

	it('agrees with Math.hypot across the whole range without overflowing', () => {
		const samples: readonly Sample[] = [
			{ name: 'square', draw: (r) => [uniform(r, -10, 10), uniform(r, -10, 10)] },
			{
				name: 'huge and tiny',
				draw: (r) => [logUniform(r, 1e-320, 1e308), logUniform(r, 1e-320, 1e308)],
			},
			{
				name: 'both huge',
				draw: (r) => [logUniform(r, 1e300, 1e308), logUniform(r, 1e300, 1e308)],
			},
			{
				name: 'both tiny',
				draw: (r) => [logUniform(r, 5e-324, 1e-300), logUniform(r, 5e-324, 1e-300)],
			},
		];
		// Subnormal results are compared absolutely, to a few of the smallest
		// subnormals: the scaled path rounds once to 53 bits and again on the way
		// back down.
		holds(samples, hypot, Math.hypot, 3 * ULP, 2.2250738585072014e-308);
	});

	it('gives exact answers where there are exact answers', () => {
		expect(hypot(3, 4)).toBe(5);
		expect(hypot(-5, 12)).toBe(13);
		expect(hypot(0, -7)).toBe(7);
		expect(hypot(3e300, 4e300)).toBe(5e300);
		expect(hypot(3e-300, 4e-300)).toBe(5e-300);
		expect(hypot(5e-324, 0)).toBe(5e-324);
		expect(hypot(Number.MAX_VALUE, 1)).toBe(Number.MAX_VALUE);
		expect(hypot(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(Infinity);
	});

	it('matches Math.hypot on special values', () => {
		const values = [0, -0, 1, -1, Infinity, -Infinity, Number.NaN];
		for (const x of values) {
			for (const y of values) {
				expect(Object.is(hypot(x, y), Math.hypot(x, y)), `hypot(${x}, ${y})`).toBe(true);
			}
		}
	});
});

describe('exp and ln', () => {
	it('exp agrees with Math to about an ulp, and to the last subnormal bit below', () => {
		holds(
			[
				{ name: 'small', draw: (r) => [uniform(r, -2, 2)] },
				{ name: 'normal results', draw: (r) => [uniform(r, -708, 709.78)] },
				{ name: 'tiny arguments', draw: (r) => [signed(r, logUniform(r, 1e-300, 1e-3))] },
			],
			exp,
			Math.exp,
			3 * ULP,
		);
		// Subnormal results carry fewer bits: compared absolutely, in units of
		// the smallest subnormal.
		const random = seeded(402);
		for (let i = 0; i < 5000; i += 1) {
			const x = uniform(random, -745.13, -708.4);
			expect(Math.abs(exp(x) - Math.exp(x)), `exp(${x})`).toBeLessThanOrEqual(5e-324);
		}
	});

	it('exp gives the exact and limiting values', () => {
		expect(exp(0)).toBe(1);
		expect(exp(-0)).toBe(1);
		expect(error(exp(1), Math.E)).toBeLessThanOrEqual(ULP);
		expect(exp(709.78)).toBeLessThan(Infinity);
		expect(error(exp(709.782712893384), Math.exp(709.782712893384))).toBeLessThanOrEqual(2 * ULP);
		expect(exp(709.7827128933841)).toBe(Infinity);
		expect(exp(-745.1332191019411)).toBe(5e-324);
		expect(exp(-745.2)).toBe(0);
		expect(exp(Infinity)).toBe(Infinity);
		expect(exp(-Infinity)).toBe(0);
		expect(exp(Number.NaN)).toBeNaN();
	});

	it('ln agrees with Math to about an ulp, subnormals included', () => {
		holds(
			[
				{ name: 'every magnitude', draw: (r) => [logUniform(r, 1e-300, 1e300)] },
				{ name: 'near one', draw: (r) => [1 + uniform(r, -0.3, 0.3)] },
				{ name: 'very near one', draw: (r) => [1 + uniform(r, -1e-9, 1e-9)] },
				{ name: 'subnormal', draw: (r) => [logUniform(r, 5e-324, 2.2e-308)] },
				{ name: 'largest', draw: (r) => [logUniform(r, 1e300, 1.7976931348623157e308)] },
			],
			ln,
			Math.log,
			3 * ULP,
		);
	});

	it('ln gives the exact and limiting values', () => {
		expect(Object.is(ln(1), 0)).toBe(true);
		expect(ln(2)).toBe(Math.LN2);
		expect(ln(0)).toBe(-Infinity);
		expect(ln(-0)).toBe(-Infinity);
		expect(ln(Infinity)).toBe(Infinity);
		expect(ln(-1)).toBeNaN();
		expect(ln(-Infinity)).toBeNaN();
		expect(ln(Number.NaN)).toBeNaN();
		expect(error(ln(Math.E), 1)).toBeLessThanOrEqual(ULP);
		expect(error(ln(5e-324), Math.log(5e-324))).toBeLessThanOrEqual(ULP);
	});

	it('round trip within an ulp or two', () => {
		const random = seeded(403);
		for (let i = 0; i < 5000; i += 1) {
			const x = uniform(random, -700, 700);
			expect(error(ln(exp(x)), x, 1)).toBeLessThanOrEqual(4 * ULP);
		}
	});
});

describe('pow', () => {
	it('agrees with Math in ordinary use to a few ulps', () => {
		holds(
			[
				{ name: 'gamma-like', draw: (r) => [uniform(r, 0, 1), uniform(r, 0.3, 3)] },
				{ name: 'moderate', draw: (r) => [logUniform(r, 1e-5, 1e5), uniform(r, -20, 20)] },
				{ name: 'near one', draw: (r) => [1 + uniform(r, -1e-3, 1e-3), uniform(r, -1e4, 1e4)] },
				{
					name: 'integer exponents',
					draw: (r) => [uniform(r, 0, 100), Math.floor(uniform(r, -30, 30))],
				},
			],
			pow,
			Math.pow,
			8 * ULP,
		);
	});

	it('stays within 1e-13 at the edges of the range', () => {
		// Large results from bases far from one need e ln(b) to about 17
		// significant digits; this is where the double-double tail earns its keep.
		holds(
			[
				{
					name: 'results near overflow and underflow',
					draw: (r) => {
						const base = logUniform(r, 1.0001, 1e10);
						return [r.next() < 0.5 ? base : 1 / base, uniform(r, -700, 700) / Math.log(base)];
					},
				},
			],
			pow,
			Math.pow,
			1e-13,
		);
	});

	it('is exact for integer powers whose results are doubles', () => {
		expect(pow(10, 22)).toBe(1e22);
		expect(pow(10, 15)).toBe(1e15);
		expect(pow(2, 10)).toBe(1024);
		expect(pow(2, -10)).toBe(1 / 1024);
		expect(pow(0.5, 64)).toBe(2 ** -64);
		expect(pow(3, 33)).toBe(5559060566555523);
		expect(pow(1.5, 2)).toBe(2.25);
		expect(pow(0.5, -3)).toBe(8);
		// Not exact as doubles, so these take the general path and stay close.
		expect(error(pow(10, -3), 0.001)).toBeLessThanOrEqual(ULP);
		expect(error(pow(3, 40), 3 ** 40)).toBeLessThanOrEqual(2 * ULP);
		expect(error(pow(7, -9), 7 ** -9)).toBeLessThanOrEqual(2 * ULP);
		expect(pow(1e200, 2)).toBe(Infinity);
		expect(pow(1e-200, 2)).toBe(0);
		expect(pow(1e-200, -2)).toBe(Infinity);
		expect(pow(2, 0.5)).toBe(Math.SQRT2);
	});

	it('matches Math.pow on every special value with a base of zero or more', () => {
		const bases = [0, 0.5, 1, 2, Infinity, Number.NaN, 5e-324, 1e308];
		const exponents = [
			0,
			-0,
			1,
			-1,
			0.5,
			2,
			-2,
			3,
			-3,
			2.5,
			Infinity,
			-Infinity,
			Number.NaN,
			1e10,
			-1e10,
		];
		for (const base of bases) {
			for (const exponent of exponents) {
				const expected = Math.pow(base, exponent);
				const got = pow(base, exponent);
				const same = Object.is(got, expected) || error(got, expected) <= 4 * ULP;
				expect(same, `pow(${base}, ${exponent}): ${got} against ${expected}`).toBe(true);
			}
		}
	});

	it('overflows and underflows exactly where the result does', () => {
		// Just past the limits, where the quick bound passes and the exact one
		// does not.
		expect(pow(Math.E, 710)).toBe(Infinity);
		expect(pow(Math.E, -745.5)).toBe(0);
		expect(pow(2, 1024)).toBe(Infinity);
		// The correctly rounded answer is sqrt(2) scaled by an exact power of two.
		// Not Math.pow: V8 changed its last bit here between Node 22 and Node 24,
		// which is exactly why this package does not call it.
		expect(error(pow(2, 1023.5), Math.SQRT2 * 2 ** 1023)).toBeLessThanOrEqual(2.3e-16);
		expect(pow(2, -1074)).toBe(5e-324);
		expect(pow(2, -1076)).toBe(0);
		expect(error(pow(Math.E, 709.78), Math.pow(Math.E, 709.78))).toBeLessThanOrEqual(1e-13);
	});

	it('treats a zero base of either sign as +0, and refuses a negative base', () => {
		expect(Object.is(pow(-0, 3), 0)).toBe(true);
		expect(pow(-0, -3)).toBe(Infinity);
		expect(pow(-0, 0)).toBe(1);
		expect(() => pow(-2, 2)).toThrow(RangeError);
		expect(() => pow(-Infinity, 2)).toThrow(RangeError);
		expect(() => pow(-1e-300, 0.5)).toThrow(RangeError);
		// Exponent 0 wins even over a negative base, as in Math.pow.
		expect(pow(-2, 0)).toBe(1);
	});
});

describe('determinism', () => {
	it('pins a few results to the bit', () => {
		// Regression values from this implementation. Every engine must produce
		// these exact doubles; if one changes, so does every curve and verdict
		// built on it.
		const results = [
			sin(1),
			cos(1),
			sin(1e22),
			cos(1e300),
			atan2(1, 3),
			atan2(-2, -7),
			hypot(1, 1),
			exp(1),
			exp(-3.5),
			ln(10),
			ln(1e-310),
			pow(2.2, 1 / 2.2),
			pow(1.0001, 12345.678),
		];
		expect(results).toEqual(PINNED);
	});
});

/** From this implementation. sin(1e22) is the classic check of a full reduction. */
const PINNED: readonly number[] = [
	0.8414709848078965, 0.5403023058681398, -0.8522008497671888, -0.5753861119575491,
	0.3217505543966422, -2.8632929945846817, 1.4142135623730951, 2.718281828459045,
	0.0301973834223185, 2.302585092994046, -713.8013788281542, 1.4310231948121672, 3.436680641432771,
];
