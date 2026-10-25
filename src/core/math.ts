/**
 * Deterministic replacements for the transcendental members of Math.
 *
 * ECMAScript specifies `+ - * /` and `Math.sqrt` to IEEE 754 exactly and
 * leaves sin, cos, atan2, exp, log, pow and hypot "implementation-approximated".
 * V8, JavaScriptCore and SpiderMonkey really do differ in the last place, and
 * one disagreement in a curve flattening step moves an anti-aliased edge by a
 * level, the strict reader thresholds that edge, and the scan check gives a
 * different verdict in Safari than in Chrome. So everything here is built from
 * the specified operations alone, plus `Math.abs`, `Math.round` and integer
 * BigInt arithmetic, which are exact. The results are the same in every
 * engine, and accurate to better than 1e-12 relative (in practice within a
 * few units in the last place).
 *
 * The algorithms are the classical ones, after fdlibm: Cody-Waite range
 * reduction with pi/2 split into three 33 bit pieces, exp and log reduced by
 * ln 2, atan reduced by a table of atan(i/8). The polynomial kernels use
 * Taylor coefficients, exact rationals, with enough terms that truncation sits
 * far below rounding; that costs a few multiplications over a minimax fit and
 * means no coefficient here rests on anybody's memory of a table. The
 * constants that are not rationals are derived from series in the tests.
 *
 * Domains: sin and cos take any finite argument (beyond about 1.6 million the
 * reduction is done exactly in BigInt against 2/pi to 1216 bits, the way
 * fdlibm's Payne-Hanek path does it in floating point); atan2, hypot, exp and
 * ln follow Math for every input, special values included; pow takes a base
 * of zero or more (see its comment).
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;

/* pi/2 in three 33 bit pieces and a tail (fdlibm's pio2_1, pio2_2, pio2_3, pio2_3t). */
const PIO2_1 = 1.5707963267341256;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_3 = 2.0222662487111665e-21;
const PIO2_3T = 8.4784276603689e-32;
const INV_PIO2 = 0.6366197723675814;
const PIO4 = 0.7853981633974483;
/** Past this, n * PIO2_1 would need more than 53 bits: n < 2^20. */
const MEDIUM_LIMIT = 1.6e6;

const PI_LO = 1.2246467991473532e-16;
const PIO2_HI = 1.5707963267948966;
const PIO2_LO = 6.123233995736766e-17;

/** ln 2 as 32 significant bits and the rest, so k * LN2_HI is exact for any exponent k. */
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;
const SQRT2 = 1.4142135623730951;
/** ln of the largest double, and ln of half the smallest subnormal: past these exp is Infinity or 0. */
const EXP_MAX = 709.782712893384;
const EXP_MIN = -745.1332191019411;

const TWO_M27 = 1 / 134217728;
const TWO_54 = 18014398509481984;
/** 2^27 + 1, Veltkamp's splitter for exact products without a fused multiply-add. */
const SPLITTER = 134217729;

/* Exact helpers. */

let scratch: DataView | undefined;

function view(): DataView {
	scratch ??= new DataView(new ArrayBuffer(8));
	return scratch;
}

/** The unbiased binary exponent of a positive finite x, subnormals included. */
function exponentOf(x: number): number {
	const v = view();
	v.setFloat64(0, x);
	const biased = (v.getUint32(0) >>> 20) & 0x7ff;
	if (biased === 0) return exponentOf(x * TWO_54) - 54;
	return biased - 1023;
}

/** 2^k exactly, for an integer k from -1022 to 1023. */
function powerOfTwo(k: number): number {
	const v = view();
	v.setUint32(0, (k + 1023) << 20);
	v.setUint32(4, 0);
	return v.getFloat64(0);
}

/** x * 2^k, in steps the exponent range allows, so only the last step can round. */
function scale(x: number, k: number): number {
	let value = x;
	let rest = k;
	while (rest > 1000) {
		value *= powerOfTwo(1000);
		rest -= 1000;
	}
	while (rest < -1000) {
		value *= powerOfTwo(-1000);
		rest += 1000;
	}
	return value * powerOfTwo(rest);
}

let sumError = 0;

/** a + b, leaving the exact rounding error in `sumError` (Knuth's TwoSum). */
function twoSum(a: number, b: number): number {
	const s = a + b;
	const bb = s - a;
	sumError = a - (s - bb) + (b - bb);
	return s;
}

/** The exact error of the product p = a * b, for |a|, |b| below 2^996 (Dekker). */
function productError(a: number, b: number, p: number): number {
	let c = SPLITTER * a;
	const ah = c - (c - a);
	const al = a - ah;
	c = SPLITTER * b;
	const bh = c - (c - b);
	const bl = b - bh;
	return ah * bh - p + ah * bl + al * bh + al * bl;
}

/* sin and cos. */

/* Taylor coefficients of sin: (-1)^k / (2k + 1)!. */
const S1 = -1 / 6;
const S2 = 1 / 120;
const S3 = -1 / 5040;
const S4 = 1 / 362880;
const S5 = -1 / 39916800;
const S6 = 1 / 6227020800;
const S7 = -1 / 1307674368000;
const S8 = 1 / 355687428096000;
/* Taylor coefficients of cos from x^4: (-1)^k / (2k)!. */
const C1 = 1 / 24;
const C2 = -1 / 720;
const C3 = 1 / 40320;
const C4 = -1 / 3628800;
const C5 = 1 / 479001600;
const C6 = -1 / 87178291200;
const C7 = 1 / 20922789888000;
const C8 = -1 / 6402373705728000;

/**
 * sin(x + y) for |x| <= pi/4 and y a tail below an ulp of x. The series runs
 * to x^17, whose successor is below 1e-19 of the result.
 */
function kernelSin(x: number, y: number): number {
	const z = x * x;
	const v = z * x;
	const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * (S6 + z * (S7 + z * S8)))));
	return x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** cos(x + y), same conditions. 1 - x^2/2 is formed with its rounding error recovered. */
function kernelCos(x: number, y: number): number {
	const z = x * x;
	const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * (C6 + z * (C7 + z * C8)))))));
	const hz = 0.5 * z;
	const w = 1 - hz;
	return w + (1 - w - hz + (z * r - x * y));
}

let reducedHi = 0;
let reducedLo = 0;

/**
 * x - n pi/2 for the nearest integer n, as reducedHi + reducedLo, returning n.
 *
 * Each piece of pi/2 has 33 bits and n fewer than 21, so every product is
 * exact, and the subtractions are TwoSums, so the reduced argument carries
 * about 150 bits of pi/2: enough for the closest any double in range comes to
 * a multiple of pi/2.
 */
function reduceMedium(x: number): number {
	const n = Math.round(x * INV_PIO2);
	const r1 = x - n * PIO2_1;
	const r2 = twoSum(r1, -(n * PIO2_2));
	let tail = sumError;
	const r3 = twoSum(r2, -(n * PIO2_3));
	tail += sumError - n * PIO2_3T;
	reducedHi = r3 + tail;
	reducedLo = tail - (reducedHi - r3);
	return n;
}

/** Fraction bits of 2/pi and of pi/2 for the exact reduction. */
const TWO_OVER_PI_BITS = 1216;
const PIO2_BITS = 128;
let exact: { readonly twoOverPi: bigint; readonly pio2: bigint } | undefined;

/**
 * floor(2/pi * 2^1216) and floor(pi/2 * 2^128), from Machin's formula in
 * BigInt, on first use. Integer arithmetic throughout, so the constants are
 * the same everywhere and nothing has to be copied from a table.
 */
function exactConstants(): { readonly twoOverPi: bigint; readonly pio2: bigint } {
	if (exact) return exact;
	const working = TWO_OVER_PI_BITS + PIO2_BITS + 64;
	const one = 1n << BigInt(working);
	const arctanInverse = (n: bigint): bigint => {
		const n2 = n * n;
		let term = one / n;
		let sum = term;
		for (let k = 1n; term !== 0n; k += 1n) {
			term /= n2;
			sum += (k & 1n ? -term : term) / (2n * k + 1n);
		}
		return sum;
	};
	// pi = 16 atan(1/5) - 4 atan(1/239), scaled by 2^working.
	const pi = 16n * arctanInverse(5n) - 4n * arctanInverse(239n);
	exact = {
		twoOverPi: (1n << BigInt(working + TWO_OVER_PI_BITS + 1)) / pi,
		pio2: pi >> BigInt(working - PIO2_BITS + 1),
	};
	return exact;
}

function bitLength(value: bigint): number {
	const hex = value.toString(16);
	return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0] as string, 16)));
}

/**
 * The same reduction for |x| >= 1.6e6, done exactly: x is an integer times a
 * power of two, so x * 2/pi mod 4 is a product of integers, and only the
 * final reduced argument is rounded.
 */
function reduceLarge(x: number): number {
	const { twoOverPi, pio2 } = exactConstants();
	const ax = Math.abs(x);
	const e = exponentOf(ax) - 52;
	const mantissa = BigInt(scale(ax, -e));
	// x * 2/pi * 2^shift, and its value mod 4.
	const shift = TWO_OVER_PI_BITS - e;
	const big = BigInt(shift);
	const wrapped = (mantissa * twoOverPi) & ((1n << (big + 2n)) - 1n);
	const nearest = (wrapped + (1n << (big - 1n))) >> big;
	const fraction = wrapped - (nearest << big);
	// fraction / 2^shift * pi/2, kept to 110 bits as a double-double.
	const product = fraction * pio2;
	const magnitude = product < 0n ? -product : product;
	const drop = Math.max(0, bitLength(magnitude) - 110);
	const top = magnitude >> BigInt(drop);
	const hi = Number(top);
	const lo = Number(top - BigInt(hi));
	const exponent = drop - shift - PIO2_BITS;
	const sign = product < 0n !== x < 0 ? -1 : 1;
	const yHi = sign * scale(hi, exponent);
	const yLo = sign * scale(lo, exponent);
	reducedHi = yHi + yLo;
	reducedLo = yLo - (reducedHi - yHi);
	const n = Number(nearest & 3n);
	return x < 0 ? (4 - n) & 3 : n;
}

function reduce(x: number): number {
	return Math.abs(x) < MEDIUM_LIMIT ? reduceMedium(x) & 3 : reduceLarge(x);
}

export function sin(x: number): number {
	const ax = Math.abs(x);
	if (!(ax < Infinity)) return Number.NaN;
	if (ax < TWO_M27) return x;
	if (ax <= PIO4) return kernelSin(x, 0);
	switch (reduce(x)) {
		case 0:
			return kernelSin(reducedHi, reducedLo);
		case 1:
			return kernelCos(reducedHi, reducedLo);
		case 2:
			return -kernelSin(reducedHi, reducedLo);
		default:
			return -kernelCos(reducedHi, reducedLo);
	}
}

export function cos(x: number): number {
	const ax = Math.abs(x);
	if (!(ax < Infinity)) return Number.NaN;
	if (ax < TWO_M27) return 1;
	if (ax <= PIO4) return kernelCos(x, 0);
	switch (reduce(x)) {
		case 0:
			return kernelCos(reducedHi, reducedLo);
		case 1:
			return -kernelSin(reducedHi, reducedLo);
		case 2:
			return -kernelCos(reducedHi, reducedLo);
		default:
			return kernelSin(reducedHi, reducedLo);
	}
}

/* atan2. */

/** atan(i/8) for i = 0..8, as the nearest double and the rest. */
const ATAN_HI = [
	0, 0.12435499454676144, 0.24497866312686414, 0.35877067027057225, 0.4636476090008061,
	0.5585993153435624, 0.6435011087932844, 0.7188299996216245, 0.7853981633974483,
];
const ATAN_LO = [
	0, -3.1253241424539383e-18, 1.0698755618734451e-17, -2.4623815582638635e-17,
	2.2698777452961687e-17, -5.4556305485916264e-18, 1.5834785051444286e-17, -2.1478388444456983e-17,
	3.061616997868383e-17,
];

/** atan(u) - u for |u| <= 1/16, by its series to u^21: the next term is below 1e-28 of u. */
function atanTail(u: number): number {
	const z = u * u;
	let p = 1 / 21;
	p = -1 / 19 + z * p;
	p = 1 / 17 + z * p;
	p = -1 / 15 + z * p;
	p = 1 / 13 + z * p;
	p = -1 / 11 + z * p;
	p = 1 / 9 + z * p;
	p = -1 / 7 + z * p;
	p = 1 / 5 + z * p;
	p = -1 / 3 + z * p;
	return u * z * p;
}

/**
 * atan(t) for t in [0, 1]: t is moved to the nearest c = i/8, and
 * atan(t) = atan(c) + atan((t - c) / (1 + t c)), where t - c is exact and the
 * quotient is at most 1/16.
 */
function atanUnit(t: number): number {
	const i = Math.round(t * 8);
	if (i === 0) return t + atanTail(t);
	const c = i / 8;
	const u = (t - c) / (1 + t * c);
	return (ATAN_HI[i] as number) + ((ATAN_LO[i] as number) + (u + atanTail(u)));
}

/** atan(y / x) in the right quadrant, matching Math.atan2 on every special value, signed zeros included. */
export function atan2(y: number, x: number): number {
	if (y !== y || x !== x) return Number.NaN;
	const ax = Math.abs(x);
	const ay = Math.abs(y);
	const negative = y < 0 || Object.is(y, -0);
	let angle: number;
	if (ay === 0) {
		// On the x axis: +0 or pi, with the sign of y.
		angle = x > 0 || Object.is(x, 0) ? 0 : PI;
	} else if (ax === 0) {
		angle = PIO2_HI;
	} else if (ax === Infinity) {
		angle = ay === Infinity ? (x > 0 ? PIO4 : 3 * PIO4) : x > 0 ? 0 : PI;
	} else if (ay === Infinity) {
		angle = PIO2_HI;
	} else if (ay <= ax) {
		// Divide the smaller by the larger, so the quotient is in [0, 1], and
		// finish each quadrant in one rounding: pi - a, pi/2 - a and pi/2 + a all
		// take a's own value with the tail of the constant, rather than
		// reflecting an angle that has already been rounded.
		const a = atanUnit(ay / ax);
		angle = x > 0 ? a : PI - (a - PI_LO);
	} else {
		const a = atanUnit(ax / ay);
		angle = x > 0 ? PIO2_HI - (a - PIO2_LO) : PIO2_HI + (a + PIO2_LO);
	}
	return negative ? -angle : angle;
}

/* hypot. */

const BIG = 2.5822498780869086e120; // 2^400
const SMALL = 3.8725919148493183e-121; // 2^-400
const DOWN = 2.409919865102884e-181; // 2^-600
const UP = 4.149515568880993e180; // 2^600

/**
 * sqrt(a^2 + b^2) for a >= b with a in [2^-474, 2^424], where both squares and
 * their rounding errors are normal numbers. The sum of squares is formed
 * exactly as a pair, and one Newton step on the square root folds the low
 * part in, so the result is almost always the correctly rounded one (the
 * plain formula, and V8's Math.hypot, are off by an ulp about a sixth and a
 * third of the time respectively).
 */
function hypotKernel(a: number, b: number): number {
	const aa = a * a;
	const bb = b * b;
	const high = twoSum(aa, bb);
	const low = sumError + productError(a, a, aa) + productError(b, b, bb);
	const root = Math.sqrt(high);
	const square = root * root;
	// high - square is exact: the two are within an ulp of each other.
	return root + (high - square - productError(root, root, square) + low) / (2 * root);
}

/**
 * sqrt(x^2 + y^2) without overflow or underflow on the way: both are scaled
 * by a power of two (exactly) when the larger is far from 1. Matches
 * Math.hypot on special values: Infinity wins over NaN.
 */
export function hypot(x: number, y: number): number {
	let a = Math.abs(x);
	let b = Math.abs(y);
	if (a === Infinity || b === Infinity) return Infinity;
	if (a !== a || b !== b) return Number.NaN;
	if (a < b) {
		const swap = a;
		a = b;
		b = swap;
	}
	if (b === 0) return a;
	if (a > BIG) return hypotKernel(a * DOWN, b * DOWN) * UP;
	if (a < SMALL) return hypotKernel(a * UP, b * UP) * DOWN;
	return hypotKernel(a, b);
}

/* exp, ln and pow. */

/* 1 / k! for k = 2..15. */
const E2 = 1 / 2;
const E3 = 1 / 6;
const E4 = 1 / 24;
const E5 = 1 / 120;
const E6 = 1 / 720;
const E7 = 1 / 5040;
const E8 = 1 / 40320;
const E9 = 1 / 362880;
const E10 = 1 / 3628800;
const E11 = 1 / 39916800;
const E12 = 1 / 479001600;
const E13 = 1 / 6227020800;
const E14 = 1 / 87178291200;
const E15 = 1 / 1307674368000;

/**
 * e^(x + tail), x already checked to be in range.
 *
 * x = k ln 2 + r with |r| <= ln 2 / 2, r carried with its rounding error, then
 * e^r by its series to r^15 (the next term is below 3e-21) and a scaling by
 * 2^k, which is exact unless the result is subnormal.
 */
function expKernel(x: number, tail: number): number {
	const k = Math.round(x * INV_LN2);
	const hi = x - k * LN2_HI;
	const r = twoSum(hi, tail - k * LN2_LO);
	const c = sumError;
	let p = E15;
	p = E14 + r * p;
	p = E13 + r * p;
	p = E12 + r * p;
	p = E11 + r * p;
	p = E10 + r * p;
	p = E9 + r * p;
	p = E8 + r * p;
	p = E7 + r * p;
	p = E6 + r * p;
	p = E5 + r * p;
	p = E4 + r * p;
	p = E3 + r * p;
	p = E2 + r * p;
	const series = r * r * p;
	const em1 = r + series;
	return scale(1 + (em1 + c * (1 + em1)), k);
}

export function exp(x: number): number {
	if (x !== x) return Number.NaN;
	if (x > EXP_MAX) return Infinity;
	if (x < EXP_MIN) return 0;
	return expKernel(x, 0);
}

/* 2 / (2j + 1) for j = 1..12: the series of log((1 + s) / (1 - s)) / s - 2 in s^2. */
const L1 = 2 / 3;
const L2 = 2 / 5;
const L3 = 2 / 7;
const L4 = 2 / 9;
const L5 = 2 / 11;
const L6 = 2 / 13;
const L7 = 2 / 15;
const L8 = 2 / 17;
const L9 = 2 / 19;
const L10 = 2 / 21;
const L11 = 2 / 23;
const L12 = 2 / 25;

let lnLo = 0;

/**
 * ln(x) for positive finite x, as a double, with a second-order tail left in
 * `lnLo` for pow.
 *
 * x = 2^k m with m in [sqrt(1/2), sqrt(2)), f = m - 1 (exact), and
 * ln(1 + f) = f - f^2/2 + s (f^2/2 + R) with s = f / (2 + f), as fdlibm
 * arranges it so the large terms are exact and only small ones round. R is
 * the series in s^2 to s^24, past which the terms are below 1e-21.
 */
function lnKernel(x: number): number {
	let k = exponentOf(x);
	let m = scale(x, -k);
	if (m > SQRT2) {
		m *= 0.5;
		k += 1;
	}
	const f = m - 1;
	const s = f / (2 + f);
	const z = s * s;
	let R = L12;
	R = L11 + z * R;
	R = L10 + z * R;
	R = L9 + z * R;
	R = L8 + z * R;
	R = L7 + z * R;
	R = L6 + z * R;
	R = L5 + z * R;
	R = L4 + z * R;
	R = L3 + z * R;
	R = L2 + z * R;
	R = L1 + z * R;
	R *= z;
	// f^2 / 2 exactly, as a pair, so the one term of order f^2 does not round.
	const square = f * f;
	const hfsq = 0.5 * square;
	const hfsqLo = 0.5 * productError(f, f, square);
	const small = s * (hfsq + R) + k * LN2_LO - hfsqLo;
	// k ln2_hi + f - hfsq + small, summed so the rounding errors are kept.
	const a = twoSum(k * LN2_HI, f);
	let tail = sumError;
	const b = twoSum(a, -hfsq);
	tail += sumError;
	const c = twoSum(b, small);
	tail += sumError;
	const result = c + tail;
	lnLo = tail - (result - c);
	return result;
}

export function ln(x: number): number {
	if (x !== x || x < 0) return Number.NaN;
	if (x === 0) return -Infinity;
	if (x === Infinity) return Infinity;
	return lnKernel(x);
}

/**
 * b^n exactly, when every step of binary exponentiation is exact and stays
 * where Dekker's product check is valid; otherwise undefined. So pow(10, 3) is
 * 1000 and pow(2, -10) is 1/1024, rather than the nearest thing exp and ln
 * can reach.
 */
function exactPower(base: number, exponent: number): number | undefined {
	// 2^-969 and 2^996: Dekker's split overflows above the one, and below the
	// other the error term of a product can underflow and look exact.
	const inRange = (v: number): boolean => v >= 2.004168360008973e-292 && v < 6.696928794914171e299;
	let result = 1;
	let square = base;
	for (let n = Math.abs(exponent); ;) {
		if (n & 1) {
			const product = result * square;
			if (!inRange(product) || productError(result, square, product) !== 0) return undefined;
			result = product;
		}
		n >>>= 1;
		if (n === 0) break;
		const next = square * square;
		if (!inRange(next) || productError(square, square, next) !== 0) return undefined;
		square = next;
	}
	if (exponent > 0) return result;
	const inverse = 1 / result;
	return inRange(inverse) && inverse * result === 1 && productError(inverse, result, 1) === 0
		? inverse
		: undefined;
}

/**
 * base^exponent for base >= 0.
 *
 * A negative base throws RangeError: every use in this package raises a length
 * or a ratio, a negative one is a bug, and a NaN would travel silently into an
 * export. A zero base, of either sign, is treated as +0. Everything else
 * matches Math.pow, including pow(1, Infinity) being NaN and pow(NaN, 0) being
 * 1. Integer exponents up to 64 in size give exact results whenever the exact
 * result is a double; otherwise the result is exp(exponent ln base) carried in
 * double-double, which keeps it within about 1e-14 relative even at the edges
 * of the range.
 */
export function pow(base: number, exponent: number): number {
	if (exponent === 0) return 1;
	if (base !== base || exponent !== exponent) return Number.NaN;
	if (base < 0) throw new RangeError('pow takes a base of zero or more');
	if (base === 0) return exponent > 0 ? 0 : Infinity;
	if (exponent === Infinity) return base > 1 ? Infinity : base < 1 ? 0 : Number.NaN;
	if (exponent === -Infinity) return base > 1 ? 0 : base < 1 ? Infinity : Number.NaN;
	if (base === Infinity) return exponent > 0 ? Infinity : 0;
	if (base === 1 || exponent === 1) return base;
	if (exponent === 0.5) return Math.sqrt(base);
	if (Number.isInteger(exponent) && Math.abs(exponent) <= 64) {
		const found = exactPower(base, exponent);
		if (found !== undefined) return found;
	}
	const hi = lnKernel(base);
	const lo = lnLo;
	const product = exponent * hi;
	if (product > EXP_MAX + 1) return Infinity;
	if (product < EXP_MIN - 1) return 0;
	const tail = productError(exponent, hi, product) + exponent * lo;
	const total = product + tail;
	if (total > EXP_MAX) return Infinity;
	if (total < EXP_MIN) return 0;
	return expKernel(product, tail);
}
