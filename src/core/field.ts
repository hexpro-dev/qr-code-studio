/**
 * Finite fields, so that Reed-Solomon is not QR's alone.
 *
 * QR uses GF(2^8) with the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
 * (0x11d). Data Matrix and Aztec use the same size with 0x12d; PDF417 works in
 * the prime field GF(929) with generator 3. All of them reduce to the same few
 * operations once multiplication goes through exp and log tables, so one
 * interface serves every symbology this package may grow.
 *
 * Elements are integers in [0, size). Each operation checks its operands,
 * because an element past the end of a log table reads `undefined`, which
 * becomes NaN, which becomes a codeword nobody can explain. The check is two
 * comparisons and the tables are the expensive part anyway. Messages give the
 * field size, never the element: an element is a codeword, and a codeword is
 * somebody's content.
 *
 * Tables are built on first use and cached on the field, so importing this
 * module costs nothing and `QR_FIELD` is free until something multiplies.
 */

export interface Field {
	/** 256 for GF(2^8), 929 for GF(929). */
	readonly size: number;
	/** The primitive element used for exp and log. */
	readonly generator: number;
	add(a: number, b: number): number;
	sub(a: number, b: number): number;
	mul(a: number, b: number): number;
	/** Throws RangeError on b = 0. */
	div(a: number, b: number): number;
	/** Throws RangeError on 0. */
	inv(a: number): number;
	/** generator^i, with i taken mod (size - 1), so negative powers work. */
	exp(i: number): number;
	/** Throws RangeError on 0. */
	log(a: number): number;
}

interface Tables {
	/** exp[i] = generator^i for i in [0, 2(size - 1)), doubled so a sum of two logs needs no modulo. */
	readonly exp: Uint32Array;
	/** log[generator^i] = i. log[0] is never read. */
	readonly log: Uint32Array;
}

interface Spec {
	readonly size: number;
	readonly generator: number;
	readonly name: string;
	readonly add: (a: number, b: number) => number;
	readonly sub: (a: number, b: number) => number;
	/** Multiply an element by the generator without tables, to build the tables. */
	readonly timesGenerator: (a: number) => number;
}

function buildTables(spec: Spec): Tables {
	const order = spec.size - 1;
	const exp = new Uint32Array(order * 2);
	const log = new Uint32Array(spec.size);
	const seen = new Uint8Array(spec.size);
	let value = 1;
	for (let i = 0; i < order; i += 1) {
		// A power that repeats early, or reaches zero, means the generator does not
		// reach every non-zero element: either it is not primitive or (in a binary
		// field) the polynomial is reducible and there is no field at all.
		if (value === 0 || seen[value] === 1) {
			throw new TypeError(`${spec.generator} does not generate ${spec.name}`);
		}
		seen[value] = 1;
		exp[i] = value;
		exp[i + order] = value;
		log[value] = i;
		value = spec.timesGenerator(value);
	}
	return { exp, log };
}

function makeField(spec: Spec, eager: boolean): Field {
	const { size } = spec;
	const order = size - 1;
	let tables: Tables | undefined = eager ? buildTables(spec) : undefined;
	const get = (): Tables => (tables ??= buildTables(spec));

	const check = (a: number): void => {
		// `(a | 0) === a` rejects fractions and NaN; the bounds do the rest.
		if ((a | 0) !== a || a < 0 || a >= size) {
			throw new RangeError(`a ${spec.name} element is an integer from 0 to ${order}`);
		}
	};

	return Object.freeze({
		size,
		generator: spec.generator,
		add(a: number, b: number): number {
			check(a);
			check(b);
			return spec.add(a, b);
		},
		sub(a: number, b: number): number {
			check(a);
			check(b);
			return spec.sub(a, b);
		},
		mul(a: number, b: number): number {
			check(a);
			check(b);
			if (a === 0 || b === 0) return 0;
			const { exp, log } = get();
			return exp[(log[a] as number) + (log[b] as number)] as number;
		},
		div(a: number, b: number): number {
			check(a);
			check(b);
			if (b === 0) throw new RangeError(`division by zero in ${spec.name}`);
			if (a === 0) return 0;
			const { exp, log } = get();
			return exp[(log[a] as number) + order - (log[b] as number)] as number;
		},
		inv(a: number): number {
			check(a);
			if (a === 0) throw new RangeError(`0 has no inverse in ${spec.name}`);
			const { exp, log } = get();
			return exp[order - (log[a] as number)] as number;
		},
		exp(i: number): number {
			if (!Number.isSafeInteger(i)) {
				throw new RangeError('a power of the generator is a whole number');
			}
			return get().exp[((i % order) + order) % order] as number;
		},
		log(a: number): number {
			check(a);
			if (a === 0) throw new RangeError(`log(0) is undefined in ${spec.name}`);
			return get().log[a] as number;
		},
	});
}

function binarySpec(m: number, primitive: number, generator: number): Spec {
	const size = 1 << m;
	return {
		size,
		generator,
		name: `GF(2^${m})`,
		add: (a, b) => a ^ b,
		sub: (a, b) => a ^ b,
		timesGenerator(a) {
			// Carry-less multiply, then reduce by the primitive polynomial from the
			// top bit down. Both factors are below 2^16, so the product fits in 31
			// bits and every shift stays positive.
			let product = 0;
			for (let bit = 0; bit < m; bit += 1) {
				if ((generator >>> bit) & 1) product ^= a << bit;
			}
			for (let bit = 2 * m - 2; bit >= m; bit -= 1) {
				if ((product >>> bit) & 1) product ^= primitive << (bit - m);
			}
			return product;
		},
	};
}

/**
 * GF(2^m), elements as polynomials over GF(2) packed into integers, reduced by
 * `primitive` (degree m, written with its x^m bit: 0x11d for QR).
 *
 * Throws TypeError when `generator` does not reach every non-zero element,
 * which also catches a reducible polynomial.
 */
export function binaryField(m: number, primitive: number, generator = 2): Field {
	if (!Number.isInteger(m) || m < 2 || m > 16) {
		throw new RangeError('a binary field here is GF(2^2) to GF(2^16)');
	}
	if (!Number.isInteger(primitive) || primitive >>> m !== 1) {
		throw new RangeError(`the polynomial for GF(2^${m}) has degree ${m}`);
	}
	if (!Number.isInteger(generator) || generator < 2 || generator >= 1 << m) {
		throw new RangeError(`a generator of GF(2^${m}) is an element from 2 to ${(1 << m) - 1}`);
	}
	return makeField(binarySpec(m, primitive, generator), true);
}

/**
 * GF(p) for a prime p below 65536, with `generator` a primitive root mod p.
 *
 * Throws TypeError when p is not prime or the generator is not a primitive
 * root.
 */
export function primeField(p: number, generator: number): Field {
	if (!Number.isInteger(p) || p < 3 || p > 65521) {
		throw new RangeError('a prime field here is GF(3) to GF(65521)');
	}
	for (let d = 2; d * d <= p; d += 1) {
		if (p % d === 0) throw new TypeError('a prime field needs a prime size');
	}
	if (!Number.isInteger(generator) || generator < 2 || generator >= p) {
		throw new RangeError(`a generator of GF(${p}) is an element from 2 to ${p - 1}`);
	}
	return makeField(
		{
			size: p,
			generator,
			name: `GF(${p})`,
			add: (a, b) => {
				const sum = a + b;
				return sum >= p ? sum - p : sum;
			},
			sub: (a, b) => (a >= b ? a - b : a - b + p),
			// Both factors are below 2^16, so the product is exact in a double.
			timesGenerator: (a) => (a * generator) % p,
		},
		true,
	);
}

/**
 * GF(2^8) with x^8 + x^4 + x^3 + x^2 + 1 and generator 2, as ISO/IEC 18004
 * fixes it. Built without the eager check, because the polynomial is known
 * good and a module-level constant must cost nothing at import.
 */
export const QR_FIELD: Field = makeField(binarySpec(8, 0x11d, 2), false);
