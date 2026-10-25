/**
 * Reed-Solomon codes over any field in `field.ts`, with errors and erasures.
 *
 * Lifted from the authenticator package's QR-only decoder and generalised in
 * three directions: the field (QR's GF(2^8), Data Matrix's other GF(2^8),
 * PDF417's GF(929)), the first root of the generator polynomial (0 for QR, 1
 * for Data Matrix and PDF417), and erasures, positions a reader already knows
 * are unreliable, each of which costs one check symbol to repair instead of
 * two.
 *
 * Decoding is the classical pipeline: syndromes, Berlekamp-Massey started from
 * the erasure locator (Forney's way of folding known positions in), Chien
 * search for the roots, Forney's formula for the values, and then a syndrome
 * check of the result, because the one outcome worse than failing is
 * succeeding wrongly.
 *
 * Conventions. Codewords arrive most significant first, as they sit in a
 * symbol: index 0 is the coefficient of x^(n-1). Inside the algebra,
 * polynomials are arrays with index i holding the coefficient of x^i. The
 * conversion happens at the edges of `rsDecode` and nowhere else, because
 * mixing the two inside the algebra produces code that works for symmetric
 * inputs and fails for everything else.
 *
 * Nothing here assumes characteristic 2. Subtraction is `field.sub`, integer
 * multiples (the formal derivative) are repeated additions, and the check
 * symbols are the negated remainder, which is the remainder itself in GF(2^8)
 * and its complement mod 929 in PDF417.
 */

import { RsDecodeError } from './errors.js';
import type { Field } from './field.js';

export interface RsCode {
	readonly field: Field;
	/** Check symbols per block. */
	readonly ecCount: number;
	/** The generator's roots are generator^firstRoot onwards: 0 for QR, 1 for Data Matrix. */
	readonly firstRoot: number;
}

export interface RsDecodeOptions {
	/** Positions (indexes into the received block) known to be unreliable. */
	readonly erasures?: readonly number[];
	/** Refuse more than this many errors even if the code could correct them (misdecode protection). */
	readonly maxErrors?: number;
}

export interface RsDecoded {
	/** Corrected, data and check symbols. */
	readonly codewords: number[];
	/** Symbol errors corrected (erasures not counted). */
	readonly errors: number;
	/** Erasures used. */
	readonly erasures: number;
}

/** The longest block a field can carry: every position needs its own power of the generator. */
function checkCode(code: RsCode, length: number): void {
	const { field, ecCount, firstRoot } = code;
	if (!Number.isInteger(ecCount) || ecCount < 1) {
		throw new RangeError('a Reed-Solomon code has at least one check symbol');
	}
	if (!Number.isSafeInteger(firstRoot)) {
		throw new RangeError('the first root of a Reed-Solomon code is a whole power');
	}
	if (length > field.size - 1) {
		throw new RangeError(
			`a block in a field of ${field.size} elements is at most ${field.size - 1} symbols, not ${length}`,
		);
	}
}

/**
 * The first root as a power in [0, size - 1). Powers of the generator repeat
 * with that period, so this changes no answer, and it keeps every exponent
 * formed from it a safe integer however large the caller's value.
 */
function rootPower(code: RsCode): number {
	const order = code.field.size - 1;
	return ((code.firstRoot % order) + order) % order;
}

let generators: WeakMap<Field, Map<string, readonly number[]>> | undefined;

/**
 * The generator polynomial, monic, most significant coefficient first:
 * (x - a^b)(x - a^(b+1))...(x - a^(b+ecCount-1)) for generator a and first
 * root b. Cached per field, because an encoder asks for the same few dozen
 * again and again.
 */
function generatorPolynomial(code: RsCode): readonly number[] {
	const { field, ecCount } = code;
	const firstRoot = rootPower(code);
	generators ??= new WeakMap();
	let byField = generators.get(field);
	if (byField === undefined) {
		byField = new Map();
		generators.set(field, byField);
	}
	const key = `${ecCount}:${firstRoot}`;
	const cached = byField.get(key);
	if (cached !== undefined) return cached;

	let poly = [1];
	for (let i = 0; i < ecCount; i += 1) {
		const root = field.exp(firstRoot + i);
		const next = new Array<number>(poly.length + 1);
		next[0] = poly[0] as number;
		for (let j = 1; j < poly.length; j += 1) {
			next[j] = field.sub(poly[j] as number, field.mul(root, poly[j - 1] as number));
		}
		next[poly.length] = field.sub(0, field.mul(root, poly[poly.length - 1] as number));
		poly = next;
	}
	const frozen = Object.freeze(poly);
	byField.set(key, frozen);
	return frozen;
}

/**
 * The `ecCount` check symbols for `data`, most significant first.
 *
 * Appending them to the data gives a block divisible by the generator
 * polynomial, which is what every reader checks.
 */
export function rsEncode(code: RsCode, data: ArrayLike<number>): number[] {
	checkCode(code, data.length + code.ecCount);
	const { field, ecCount } = code;
	const generator = generatorPolynomial(code);
	// The running remainder of data(x) * x^ecCount over the generator, highest
	// coefficient first, kept as a shift register rather than a full division.
	const remainder = new Array<number>(ecCount).fill(0);
	for (let i = 0; i < data.length; i += 1) {
		const factor = field.add(data[i] as number, remainder[0] as number);
		for (let j = 0; j < ecCount - 1; j += 1) {
			remainder[j] = field.sub(
				remainder[j + 1] as number,
				field.mul(factor, generator[j + 1] as number),
			);
		}
		remainder[ecCount - 1] = field.sub(0, field.mul(factor, generator[ecCount] as number));
	}
	// data * x^ecCount - remainder is the codeword, so the check symbols are the
	// negated remainder.
	return remainder.map((value) => field.sub(0, value));
}

/** Evaluate a lowest-first polynomial at x, by Horner's rule. */
function evaluate(field: Field, poly: readonly number[], x: number): number {
	let result = 0;
	for (let i = poly.length - 1; i >= 0; i -= 1) {
		result = field.add(field.mul(result, x), poly[i] as number);
	}
	return result;
}

/** k copies of a added together: the integer multiple a field needs for a formal derivative. */
function times(field: Field, k: number, a: number): number {
	let result = 0;
	let addend = a;
	for (let n = k; n > 0; n >>>= 1) {
		if (n & 1) result = field.add(result, addend);
		addend = field.add(addend, addend);
	}
	return result;
}

/** S_k = r(a^(b+k)) for k in [0, ecCount). All zero means a valid codeword. */
function syndromes(code: RsCode, received: ArrayLike<number>): number[] {
	const { field, ecCount } = code;
	const firstRoot = rootPower(code);
	const out = new Array<number>(ecCount);
	for (let k = 0; k < ecCount; k += 1) {
		const x = field.exp(firstRoot + k);
		// The block is most significant first, so Horner runs forwards over it.
		let value = 0;
		for (let i = 0; i < received.length; i += 1) {
			value = field.add(field.mul(value, x), received[i] as number);
		}
		out[k] = value;
	}
	return out;
}

/**
 * Correct a block of data followed by check symbols. The block passed in is
 * not modified; the corrected one is a new array.
 *
 * Corrects any pattern of e errors and f erasures with 2e + f <= ecCount.
 * Throws `RsDecodeError` when there is no such pattern, when e is past
 * `maxErrors`, or when the corrected block fails its own syndrome check.
 * A block past the code's reach either throws or comes back as some valid
 * codeword; it never comes back as a block that is not a codeword.
 */
export function rsDecode(
	code: RsCode,
	received: ArrayLike<number>,
	options: RsDecodeOptions = {},
): RsDecoded {
	const { field, ecCount } = code;
	const n = received.length;
	checkCode(code, n);
	const firstRoot = rootPower(code);
	if (n < ecCount) {
		throw new RangeError(`a block with ${ecCount} check symbols is at least that long, not ${n}`);
	}
	const codewords = new Array<number>(n);
	for (let i = 0; i < n; i += 1) {
		const value = received[i] as number;
		if ((value | 0) !== value || value < 0 || value >= field.size) {
			throw new RangeError(`symbol ${i} is not an element of a field of ${field.size}`);
		}
		codewords[i] = value;
	}

	const erased = options.erasures ?? [];
	const erasedSet = new Set<number>();
	for (const position of erased) {
		if (!Number.isInteger(position) || position < 0 || position >= n) {
			throw new RangeError(`an erasure is a position in the block, 0 to ${n - 1}`);
		}
		if (erasedSet.has(position)) {
			throw new TypeError(`position ${position} is listed as an erasure twice`);
		}
		erasedSet.add(position);
	}
	const { maxErrors } = options;
	if (maxErrors !== undefined && (!Number.isInteger(maxErrors) || maxErrors < 0)) {
		throw new RangeError('maxErrors is a whole number of errors');
	}

	const f = erased.length;
	if (f > ecCount) throw new RsDecodeError('too-many-erasures');

	const s = syndromes(code, codewords);
	if (s.every((value) => value === 0)) {
		return { codewords, errors: 0, erasures: f };
	}

	// Position i in the block is the coefficient of x^(n-1-i), and its locator
	// is a^(n-1-i).
	const power = (i: number): number => n - 1 - i;

	// The erasure locator, the product of (1 - X x) over the erased positions.
	let gamma = [1];
	for (const position of erased) {
		const x = field.exp(power(position));
		const next = new Array<number>(gamma.length + 1).fill(0);
		for (let i = 0; i < gamma.length; i += 1) {
			next[i] = field.add(next[i] as number, gamma[i] as number);
			next[i + 1] = field.sub(next[i + 1] as number, field.mul(x, gamma[i] as number));
		}
		gamma = next;
	}

	// Berlekamp-Massey, started from the erasure locator rather than from 1.
	// That is the same as running it on Forney's modified syndromes and
	// multiplying by gamma afterwards, without forming either: the register
	// starts f long, steps begin at f, and the length update carries f along.
	let lambda = gamma.slice();
	let previous = gamma.slice();
	let length = f;
	let shift = 1;
	let lastDiscrepancy = 1;
	for (let step = f; step < ecCount; step += 1) {
		let discrepancy = 0;
		for (let i = 0; i <= length && i < lambda.length; i += 1) {
			discrepancy = field.add(discrepancy, field.mul(lambda[i] as number, s[step - i] as number));
		}
		if (discrepancy === 0) {
			shift += 1;
			continue;
		}
		const scale = field.div(discrepancy, lastDiscrepancy);
		const updated = new Array<number>(Math.max(lambda.length, previous.length + shift)).fill(0);
		for (let i = 0; i < lambda.length; i += 1) updated[i] = lambda[i] as number;
		for (let i = 0; i < previous.length; i += 1) {
			updated[i + shift] = field.sub(
				updated[i + shift] as number,
				field.mul(scale, previous[i] as number),
			);
		}
		if (2 * length <= step + f) {
			previous = lambda;
			length = step + 1 + f - length;
			lastDiscrepancy = discrepancy;
			shift = 1;
		} else {
			shift += 1;
		}
		lambda = updated;
	}

	const errorCount = length - f;
	if (2 * errorCount + f > ecCount) throw new RsDecodeError('too-many-errors');
	if (maxErrors !== undefined && errorCount > maxErrors) throw new RsDecodeError('over-limit');

	// The locator must have exactly `length` roots, all inside the block.
	let degree = lambda.length - 1;
	while (degree > 0 && lambda[degree] === 0) degree -= 1;
	if (degree !== length) throw new RsDecodeError('no-solution');
	lambda = lambda.slice(0, degree + 1);

	const positions: number[] = [];
	for (let i = 0; i < n; i += 1) {
		if (evaluate(field, lambda, field.exp(-power(i))) === 0) positions.push(i);
	}
	if (positions.length !== degree) throw new RsDecodeError('no-solution');

	// Omega = S(x) Lambda(x) mod x^ecCount, and the formal derivative of Lambda.
	const omega = new Array<number>(ecCount).fill(0);
	for (let i = 0; i < ecCount; i += 1) {
		for (let j = 0; j < lambda.length && i + j < ecCount; j += 1) {
			omega[i + j] = field.add(
				omega[i + j] as number,
				field.mul(s[i] as number, lambda[j] as number),
			);
		}
	}
	const derivative = new Array<number>(degree);
	for (let i = 1; i <= degree; i += 1) derivative[i - 1] = times(field, i, lambda[i] as number);

	let errors = 0;
	let phantom = false;
	for (const position of positions) {
		const j = power(position);
		const xInverse = field.exp(-j);
		// Never zero: Chien search found `degree` distinct roots, so Lambda splits
		// into distinct linear factors and its derivative cannot vanish at any of
		// them.
		const denominator = evaluate(field, derivative, xInverse);
		// Forney, for roots starting at a^b: Y = -X^(1-b) Omega(X^-1) / Lambda'(X^-1).
		const magnitude = field.sub(
			0,
			field.mul(
				field.exp(j * (1 - firstRoot)),
				field.div(evaluate(field, omega, xInverse), denominator),
			),
		);
		codewords[position] = field.sub(codewords[position] as number, magnitude);
		if (erasedSet.has(position)) continue;
		// An error position whose value is zero is not an error: the locator
		// claimed more than the block holds, which only happens past the code's
		// reach.
		phantom ||= magnitude === 0;
		errors += 1;
	}

	// Verify rather than trust. With the root count checked above this cannot
	// fire: a register of length L that generates all the syndromes and splits
	// into L distinct roots inside the block describes an error pattern exactly
	// (the syndromes are then a combination of those roots' powers, and Forney
	// computes its coefficients), and a zero coefficient would contradict the
	// register being the shortest. It stays because the cost is one more pass
	// over the syndromes, and the alternative to a theorem being implemented
	// correctly is somebody's Wi-Fi password decoded wrongly with confidence.
	// No test can reach it without a bug to reach it through, hence the hint.
	/* v8 ignore next 3 */
	if (phantom || syndromes(code, codewords).some((value) => value !== 0)) {
		throw new RsDecodeError('no-solution');
	}
	return { codewords, errors, erasures: f };
}
