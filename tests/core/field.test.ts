/**
 * The fields, checked exhaustively where that is affordable.
 *
 * GF(2^8) has 65 536 ordered pairs and GF(929) has 863 041, so every product,
 * quotient and inverse is checked against an independent table-free
 * implementation written here (carry-less multiplication for the binary
 * fields, plain modular arithmetic for the prime one). A field whose tables
 * were built from a wrong polynomial would still be self-consistent; it would
 * not agree with long multiplication.
 */

import { describe, expect, it } from 'vitest';
import type { Field } from '../../src/core/field.js';
import { QR_FIELD, binaryField, primeField } from '../../src/core/field.js';

/** Carry-less multiplication reduced by the polynomial: GF(2^m) from first principles. */
function slowBinaryMul(a: number, b: number, m: number, primitive: number): number {
	let product = 0;
	for (let bit = 0; bit < m; bit += 1) if ((b >> bit) & 1) product ^= a << bit;
	for (let bit = 2 * m - 2; bit >= m; bit -= 1) {
		if ((product >> bit) & 1) product ^= primitive << (bit - m);
	}
	return product;
}

const BINARY: readonly { name: string; field: Field; m: number; primitive: number }[] = [
	{ name: 'QR, 0x11d', field: QR_FIELD, m: 8, primitive: 0x11d },
	{ name: 'QR, built by hand', field: binaryField(8, 0x11d), m: 8, primitive: 0x11d },
	{ name: 'Data Matrix, 0x12d', field: binaryField(8, 0x12d), m: 8, primitive: 0x12d },
];

describe.each(BINARY)('GF(2^8), $name', ({ field, m, primitive }) => {
	it('has 256 elements and generator 2', () => {
		expect(field.size).toBe(256);
		expect(field.generator).toBe(2);
	});

	it('agrees with long multiplication on every pair, and divides back', () => {
		for (let a = 0; a < 256; a += 1) {
			for (let b = 0; b < 256; b += 1) {
				const product = field.mul(a, b);
				if (product !== slowBinaryMul(a, b, m, primitive)) {
					expect(product, `${a} * ${b}`).toBe(slowBinaryMul(a, b, m, primitive));
				}
				if (b !== 0 && field.div(product, b) !== a) {
					expect(field.div(product, b), `(${a} * ${b}) / ${b}`).toBe(a);
				}
			}
		}
	});

	it('adds and subtracts as XOR', () => {
		for (let a = 0; a < 256; a += 1) {
			for (let b = 0; b < 256; b += 17) {
				expect(field.add(a, b)).toBe(a ^ b);
				expect(field.sub(a, b)).toBe(a ^ b);
			}
		}
	});

	it('has an inverse for every non-zero element', () => {
		for (let a = 1; a < 256; a += 1) {
			expect(field.mul(a, field.inv(a)), `${a}`).toBe(1);
			expect(field.div(1, a)).toBe(field.inv(a));
		}
	});

	it('has exp and log as inverses, with exp periodic in 255', () => {
		const seen = new Set<number>();
		for (let i = 0; i < 255; i += 1) {
			const value = field.exp(i);
			seen.add(value);
			expect(field.log(value)).toBe(i);
			expect(field.exp(i + 255)).toBe(value);
			expect(field.exp(i - 255)).toBe(value);
			expect(field.exp(i - 255 * 7)).toBe(value);
		}
		expect(seen.size).toBe(255);
		expect(field.exp(1)).toBe(2);
		expect(field.exp(8)).toBe(primitive & 0xff);
	});
});

describe('GF(929), the PDF417 field', () => {
	const field = primeField(929, 3);

	it('has 929 elements and generator 3', () => {
		expect(field.size).toBe(929);
		expect(field.generator).toBe(3);
	});

	it('agrees with modular arithmetic on every pair', () => {
		for (let a = 0; a < 929; a += 1) {
			for (let b = 0; b < 929; b += 1) {
				const product = field.mul(a, b);
				if (product !== (a * b) % 929) expect(product, `${a} * ${b}`).toBe((a * b) % 929);
				if (b !== 0 && field.div(product, b) !== a) {
					expect(field.div(product, b), `(${a} * ${b}) / ${b}`).toBe(a);
				}
				const sum = field.add(a, b);
				if (sum !== (a + b) % 929) expect(sum, `${a} + ${b}`).toBe((a + b) % 929);
				const difference = field.sub(a, b);
				if (difference !== (a - b + 929) % 929) {
					expect(difference, `${a} - ${b}`).toBe((a - b + 929) % 929);
				}
			}
		}
	});

	it('has an inverse for every non-zero element and exp and log as inverses', () => {
		for (let a = 1; a < 929; a += 1) {
			expect(field.mul(a, field.inv(a))).toBe(1);
			expect(field.exp(field.log(a))).toBe(a);
		}
		let power = 1;
		for (let i = 0; i < 928; i += 1) {
			expect(field.exp(i)).toBe(power);
			power = (power * 3) % 929;
		}
		expect(field.exp(928)).toBe(1);
		expect(field.exp(-1)).toBe(field.inv(3));
	});
});

describe('field construction', () => {
	it('builds other binary fields, with other generators', () => {
		// GF(2^4) with x^4 + x + 1, the textbook example, and GF(2^16).
		const small = binaryField(4, 0b10011);
		expect(small.size).toBe(16);
		for (let a = 0; a < 16; a += 1) {
			for (let b = 0; b < 16; b += 1) {
				expect(small.mul(a, b)).toBe(slowBinaryMul(a, b, 4, 0b10011));
			}
		}
		// 4 is alpha^2 in QR's field and gcd(2, 255) = 1, so it generates too; 3 is
		// alpha^25 and does not.
		const withFour = binaryField(8, 0x11d, 4);
		expect(withFour.generator).toBe(4);
		expect(withFour.exp(1)).toBe(4);
		expect(withFour.mul(0x53, 0xca)).toBe(slowBinaryMul(0x53, 0xca, 8, 0x11d));
		expect(() => binaryField(8, 0x11d, 3)).toThrow(TypeError);
		const large = binaryField(16, 0x1100b);
		expect(large.mul(0xffff, 0xffff)).toBe(slowBinaryMul(0xffff, 0xffff, 16, 0x1100b));
		expect(large.mul(large.inv(12345), 12345)).toBe(1);
	});

	it('refuses a reducible polynomial and a generator that is not primitive', () => {
		// x^8 + 1 = (x + 1)^8 is no field at all.
		expect(() => binaryField(8, 0x101)).toThrow(TypeError);
		// 0x11b (the AES polynomial) is irreducible but 2 is not primitive in it.
		expect(() => binaryField(8, 0x11b)).toThrow(TypeError);
		expect(binaryField(8, 0x11b, 3).exp(255)).toBe(1);
		// 2 is not a primitive root mod 929: its order divides 928 / 2.
		expect(() => primeField(929, 2)).toThrow(TypeError);
		expect(() => primeField(931, 3)).toThrow(TypeError);
	});

	it('refuses sizes and generators out of range', () => {
		expect(() => binaryField(1, 0b11)).toThrow(RangeError);
		expect(() => binaryField(17, 0x20000)).toThrow(RangeError);
		expect(() => binaryField(8.5, 0x11d)).toThrow(RangeError);
		expect(() => binaryField(8, 0x1d)).toThrow(RangeError);
		expect(() => binaryField(8, 0x21d)).toThrow(RangeError);
		expect(() => binaryField(8, 1.5)).toThrow(RangeError);
		expect(() => binaryField(8, 0x11d, 1)).toThrow(RangeError);
		expect(() => binaryField(8, 0x11d, 256)).toThrow(RangeError);
		expect(() => binaryField(8, 0x11d, 2.5)).toThrow(RangeError);
		expect(() => primeField(2, 1)).toThrow(RangeError);
		expect(() => primeField(65537, 3)).toThrow(RangeError);
		expect(() => primeField(929.5, 3)).toThrow(RangeError);
		expect(() => primeField(929, 1)).toThrow(RangeError);
		expect(() => primeField(929, 929)).toThrow(RangeError);
		expect(() => primeField(929, 3.5)).toThrow(RangeError);
	});

	it('refuses operands that are not elements, and the undefined operations', () => {
		for (const field of [QR_FIELD, primeField(929, 3)]) {
			for (const bad of [-1, field.size, 1.5, Number.NaN]) {
				expect(() => field.add(bad, 1)).toThrow(RangeError);
				expect(() => field.sub(1, bad)).toThrow(RangeError);
				expect(() => field.mul(bad, 1)).toThrow(RangeError);
				expect(() => field.mul(1, bad)).toThrow(RangeError);
				expect(() => field.div(bad, 1)).toThrow(RangeError);
				expect(() => field.div(1, bad)).toThrow(RangeError);
				expect(() => field.inv(bad)).toThrow(RangeError);
				expect(() => field.log(bad)).toThrow(RangeError);
			}
			expect(() => field.div(1, 0)).toThrow(RangeError);
			expect(() => field.inv(0)).toThrow(RangeError);
			expect(() => field.log(0)).toThrow(RangeError);
			expect(() => field.exp(0.5)).toThrow(RangeError);
			expect(() => field.exp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
			expect(field.mul(0, 5)).toBe(0);
			expect(field.div(0, 5)).toBe(0);
		}
	});

	it('keeps element values out of its messages', () => {
		try {
			QR_FIELD.mul(1234, 1);
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).not.toContain('1234');
		}
	});

	it('is frozen', () => {
		expect(Object.isFrozen(QR_FIELD)).toBe(true);
	});
});
