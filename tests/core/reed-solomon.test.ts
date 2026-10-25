/**
 * Reed-Solomon, against the specification, two other encoders, and the
 * algebra itself.
 *
 * The anchors, strongest first: the ISO/IEC 18004 Annex I worked example (pins
 * QR's field, generator and division at once); the `qrcode` package's encoder
 * on every block shape QR uses; bwip-js's Data Matrix symbols read back
 * module by module (the 0x12d field with first root 1); and the PDF417
 * generator coefficients from ISO/IEC 15438, with that standard's own encoding
 * procedure written out here as a second GF(929) encoder. The decoder is then
 * held to the theorem: every pattern of e errors and f erasures with
 * 2e + f <= ecCount comes back exactly, and nothing past that comes back as a
 * block that is not a codeword.
 */

import { createRequire } from 'node:module';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RsDecodeError } from '../../src/core/errors.js';
import type { Field } from '../../src/core/field.js';
import { QR_FIELD, binaryField, primeField } from '../../src/core/field.js';
import type { RsCode } from '../../src/core/reed-solomon.js';
import { rsDecode, rsEncode } from '../../src/core/reed-solomon.js';
import { DATA_MATRIX_BLOCKS, dataMatrixCodewords } from './datamatrix.js';
import { distinctPositions, seeded } from './helpers.js';

const require = createRequire(import.meta.url);

/** The `qrcode` package's own Reed-Solomon encoder, for check symbols over QR's field. */
const QrcodeEncoder = require('qrcode/lib/core/reed-solomon-encoder') as new (degree: number) => {
	encode(data: Uint8Array): Uint8Array;
};
const qrcodeBlocks = require('qrcode/lib/core/error-correction-code') as {
	getBlocksCount(version: number, level: unknown): number;
	getTotalCodewordsCount(version: number, level: unknown): number;
};
const qrcodeLevels = require('qrcode/lib/core/error-correction-level') as Record<string, unknown>;
const qrcodeUtils = require('qrcode/lib/core/utils') as {
	getSymbolTotalCodewords(version: number): number;
};

const DATA_MATRIX_FIELD = binaryField(8, 0x12d);
const PDF417_FIELD = primeField(929, 3);

const qr = (ecCount: number): RsCode => ({ field: QR_FIELD, ecCount, firstRoot: 0 });
const dataMatrix = (ecCount: number): RsCode => ({
	field: DATA_MATRIX_FIELD,
	ecCount,
	firstRoot: 1,
});
const pdf417 = (ecCount: number): RsCode => ({ field: PDF417_FIELD, ecCount, firstRoot: 1 });

/** Every (data, check) block shape in QR versions 1 to 40 at every level, as `qrcode` derives them. */
function qrBlockShapes(): { data: number; ec: number }[] {
	const shapes = new Map<string, { data: number; ec: number }>();
	for (let version = 1; version <= 40; version += 1) {
		for (const level of ['L', 'M', 'Q', 'H']) {
			const ecl = qrcodeLevels[level];
			const total = qrcodeUtils.getSymbolTotalCodewords(version);
			const blocks = qrcodeBlocks.getBlocksCount(version, ecl);
			const dataTotal = total - qrcodeBlocks.getTotalCodewordsCount(version, ecl);
			const group2 = total % blocks;
			const data = Math.floor(dataTotal / blocks);
			const ec = Math.floor(total / blocks) - data;
			shapes.set(`${data}:${ec}`, { data, ec });
			if (group2 > 0) shapes.set(`${data + 1}:${ec}`, { data: data + 1, ec });
		}
	}
	return [...shapes.values()];
}

function isCodeword(code: RsCode, codewords: readonly number[]): boolean {
	const data = codewords.slice(0, codewords.length - code.ecCount);
	return rsEncode(code, data).every((value, i) => value === codewords[data.length + i]);
}

describe("rsEncode over QR's field", () => {
	it('reproduces the worked example in ISO/IEC 18004 Annex I', () => {
		// Version 1-M, "01234567": these 16 data codewords give these 10 check
		// symbols. Pins the field, the generator and the division together.
		const data = [
			0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
			0x11,
		];
		expect(rsEncode(qr(10), data)).toEqual([
			0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55,
		]);
	});

	it('uses the generator polynomial the specification lists for 10 check symbols', () => {
		// ISO/IEC 18004 Annex A lists it by its exponents of alpha:
		// 0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45. Encoding the single data
		// symbol 1 gives the generator's coefficients below the leading one.
		const coefficients = rsEncode(qr(10), [1]);
		expect(coefficients.map((value) => QR_FIELD.log(value))).toEqual([
			251, 67, 46, 61, 118, 70, 64, 94, 32, 45,
		]);
	});

	it('agrees with the qrcode package on every block shape QR uses', () => {
		const shapes = qrBlockShapes();
		// 40 versions times 4 levels collapse to a few dozen shapes; the count is
		// asserted so a broken derivation cannot quietly test nothing.
		expect(shapes.length).toBeGreaterThan(60);
		const random = seeded(18004);
		for (const { data, ec } of shapes) {
			const oracle = new QrcodeEncoder(ec);
			for (let trial = 0; trial < 4; trial += 1) {
				const block = random.bytes(data);
				expect(rsEncode(qr(ec), block), `${data} data, ${ec} check`).toEqual([
					...oracle.encode(block),
				]);
			}
		}
	});

	it('agrees with the qrcode package on every check symbol count up to 68', () => {
		// Micro QR and rMQR use counts QR does not (2, 5, 6, 8, 14 and more).
		const random = seeded(68);
		for (let ec = 1; ec <= 68; ec += 1) {
			const oracle = new QrcodeEncoder(ec);
			const block = random.bytes(1 + random.int(255 - ec));
			expect(rsEncode(qr(ec), block), `${ec} check`).toEqual([...oracle.encode(block)]);
		}
	});

	it('encodes empty data as all-zero check symbols', () => {
		expect(rsEncode(qr(4), [])).toEqual([0, 0, 0, 0]);
	});
});

describe('rsEncode over the Data Matrix field, first root 1', () => {
	it('reproduces the ISO/IEC 16022 example read back from bwip-js', () => {
		const read = dataMatrixCodewords('123456');
		expect(read.size).toBe(10);
		expect(read.codewords).toEqual([142, 164, 186, 114, 25, 5, 88, 102]);
		expect(rsEncode(dataMatrix(5), [142, 164, 186])).toEqual([114, 25, 5, 88, 102]);
	});

	it('agrees with bwip-js on every single-region square size', () => {
		const random = seeded(16022);
		const seen = new Set<number>();
		const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .-/';
		for (let length = 1; length <= 44; length += 1) {
			let text = '';
			for (let i = 0; i < length; i += 1) text += alphabet[random.int(alphabet.length)];
			const read = dataMatrixCodewords(text);
			const shape = DATA_MATRIX_BLOCKS[read.size];
			if (!shape) continue;
			seen.add(read.size);
			expect(read.codewords.length).toBe(shape.data + shape.ec);
			const data = read.codewords.slice(0, shape.data);
			expect(rsEncode(dataMatrix(shape.ec), data), `${read.size} by ${read.size}`).toEqual(
				read.codewords.slice(shape.data),
			);
		}
		// Short texts in ASCII mode reach every size from 10 to 26.
		expect([...seen].sort((a, b) => a - b)).toEqual([10, 12, 14, 16, 18, 20, 22, 24, 26]);
	});
});

/**
 * ISO/IEC 15438 Annex A's encoding procedure, written out as the standard
 * gives it: a shift register over the coefficients a_0 to a_(k-1), with the
 * register complemented at the end. Independent of `field.ts` throughout.
 */
function pdf417Reference(
	data: readonly number[],
	k: number,
	coefficients: readonly number[],
): number[] {
	const c = new Array<number>(k).fill(0);
	for (const d of data) {
		const t1 = (d + (c[k - 1] as number)) % 929;
		for (let j = k - 1; j >= 1; j -= 1) {
			const t2 = (t1 * (coefficients[j] as number)) % 929;
			c[j] = ((c[j - 1] as number) + 929 - t2) % 929;
		}
		c[0] = (929 - ((t1 * (coefficients[0] as number)) % 929)) % 929;
	}
	// Transmitted highest first, each complemented.
	return c.map((value) => (929 - value) % 929).reverse();
}

/** The generator's coefficients a_0 .. a_(k-1) for roots 3^1 .. 3^k, by plain modular arithmetic. */
function pdf417Coefficients(k: number): number[] {
	let poly = [1]; // lowest first
	let root = 1;
	for (let i = 1; i <= k; i += 1) {
		root = (root * 3) % 929;
		const next = new Array<number>(poly.length + 1).fill(0);
		poly.forEach((coefficient, j) => {
			next[j + 1] = ((next[j + 1] as number) + coefficient) % 929;
			next[j] = ((next[j] as number) + 929 - ((root * coefficient) % 929)) % 929;
		});
		poly = next;
	}
	return poly.slice(0, k);
}

describe('rsEncode over GF(929), PDF417 style', () => {
	it('uses the generator coefficients ISO/IEC 15438 tabulates', () => {
		// Error correction levels 0, 1 and 2, as a_0 first.
		const table: Record<number, number[]> = {
			2: [27, 917],
			4: [522, 568, 723, 809],
			8: [237, 308, 436, 284, 646, 653, 428, 379],
		};
		for (const [k, expected] of Object.entries(table)) {
			expect(pdf417Coefficients(Number(k))).toEqual(expected);
			// Encoding the single data symbol 1 gives the coefficients, highest first.
			expect(rsEncode(pdf417(Number(k)), [1]).reverse()).toEqual(expected);
		}
	});

	it("agrees with the standard's own procedure", () => {
		const random = seeded(15438);
		for (const level of [0, 1, 2, 3, 4, 5, 6]) {
			const k = 2 << level;
			const coefficients = pdf417Coefficients(k);
			for (let trial = 0; trial < 5; trial += 1) {
				const length = 1 + random.int(Math.min(400, 928 - k));
				const data = Array.from({ length }, () => random.int(929));
				expect(rsEncode(pdf417(k), data), `level ${level}`).toEqual(
					pdf417Reference(data, k, coefficients),
				);
			}
		}
	});
});

interface Damage {
	readonly ec: number;
	readonly data: number[];
	readonly erasures: number[];
	readonly erasedValues: number[];
	readonly errors: number[];
	readonly deltas: number[];
}

/**
 * A random block with e errors (non-zero changes) and f erasures (positions
 * flagged and replaced by anything, including their own value), 2e + f <= ec.
 */
function damage(size: number, maxEc: number, maxLength: number): fc.Arbitrary<Damage> {
	return fc.integer({ min: 1, max: maxEc }).chain((ec) =>
		fc.integer({ min: ec, max: maxLength }).chain((n) =>
			fc.integer({ min: 0, max: ec }).chain((f) =>
				fc.integer({ min: 0, max: Math.floor((ec - f) / 2) }).chain((e) =>
					fc
						.record({
							ec: fc.constant(ec),
							data: fc.array(fc.integer({ min: 0, max: size - 1 }), {
								minLength: n - ec,
								maxLength: n - ec,
							}),
							positions: fc.shuffledSubarray(
								Array.from({ length: n }, (_, i) => i),
								{ minLength: e + f, maxLength: e + f },
							),
							erasedValues: fc.array(fc.integer({ min: 0, max: size - 1 }), {
								minLength: f,
								maxLength: f,
							}),
							deltas: fc.array(fc.integer({ min: 1, max: size - 1 }), {
								minLength: e,
								maxLength: e,
							}),
						})
						.map(({ ec, data, positions, erasedValues, deltas }) => ({
							ec,
							data,
							erasures: positions.slice(0, f),
							erasedValues,
							errors: positions.slice(f),
							deltas,
						})),
				),
			),
		),
	);
}

function corrupt(field: Field, clean: readonly number[], d: Damage): number[] {
	const received = clean.slice();
	d.erasures.forEach((position, i) => {
		received[position] = d.erasedValues[i] as number;
	});
	d.errors.forEach((position, i) => {
		received[position] = field.add(received[position] as number, d.deltas[i] as number);
	});
	return received;
}

const CODES: readonly {
	name: string;
	make: (ec: number) => RsCode;
	maxEc: number;
	maxLength: number;
}[] = [
	{ name: 'QR', make: qr, maxEc: 30, maxLength: 255 },
	{ name: 'Data Matrix', make: dataMatrix, maxEc: 68, maxLength: 255 },
	{ name: 'PDF417', make: pdf417, maxEc: 64, maxLength: 300 },
];

describe.each(CODES)('rsDecode, $name', ({ make, maxEc, maxLength }) => {
	const field = make(1).field;

	it('corrects every pattern with 2e + f within the check symbols, exactly', () => {
		fc.assert(
			fc.property(damage(field.size, maxEc, maxLength), (d) => {
				const code = make(d.ec);
				const clean = [...d.data, ...rsEncode(code, d.data)];
				const received = corrupt(field, clean, d);
				const before = received.slice();
				const result = rsDecode(code, received, { erasures: d.erasures });
				expect(result.codewords).toEqual(clean);
				expect(result.errors).toBe(d.errors.length);
				expect(result.erasures).toBe(d.erasures.length);
				// The input is not touched.
				expect(received).toEqual(before);
			}),
			{ seed: 2718, numRuns: 400 },
		);
	});

	it('returns a clean block unchanged, with or without erasures named', () => {
		const code = make(8);
		const data = [1, 2, 3, 4, 5];
		const clean = [...data, ...rsEncode(code, data)];
		expect(rsDecode(code, clean)).toEqual({ codewords: clean, errors: 0, erasures: 0 });
		expect(rsDecode(code, clean, { erasures: [0, 6] })).toEqual({
			codewords: clean,
			errors: 0,
			erasures: 2,
		});
	});

	it("never returns a block that is not a codeword, past the code's reach", () => {
		const random = seeded(field.size * 31);
		const reasons = new Set<string>();
		let refused = 0;
		let counted = 0;
		for (let trial = 0; trial < 400; trial += 1) {
			const ec = 2 + random.int(Math.min(maxEc, 30) - 1);
			const n = ec + 1 + random.int(Math.min(maxLength, field.size - 1) - ec);
			const code = make(ec);
			const data = Array.from({ length: n - ec }, () => random.int(field.size));
			const clean = [...data, ...rsEncode(code, data)];
			const f = random.int(Math.floor(ec / 4) + 1);
			const e = Math.floor((ec - f) / 2) + 1 + random.int(3);
			const positions = distinctPositions(random, n, Math.min(n, e + f));
			const received = clean.slice();
			for (const position of positions.slice(f)) {
				received[position] = field.add(
					received[position] as number,
					1 + random.int(field.size - 1),
				);
			}
			// A short code past its reach lands inside another codeword's radius
			// often (about half the time for two check symbols), so the refusal
			// rate is only counted where it is meaningful. Validity is checked
			// everywhere.
			const meaningful = ec >= 10;
			if (meaningful) counted += 1;
			try {
				const result = rsDecode(code, received, { erasures: positions.slice(0, f) });
				expect(isCodeword(code, result.codewords), `trial ${trial}`).toBe(true);
			} catch (error) {
				expect(error).toBeInstanceOf(RsDecodeError);
				reasons.add((error as RsDecodeError).reason);
				if (meaningful) refused += 1;
			}
		}
		expect(counted).toBeGreaterThan(200);
		expect(refused).toBeGreaterThan(counted * 0.9);
		expect(reasons).toContain('no-solution');
	});
});

describe('rsDecode limits and refusals', () => {
	const code = qr(10);
	const data = Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);
	const clean = [...data, ...rsEncode(code, data)];
	const withErrors = (positions: readonly number[]): number[] => {
		const received = clean.slice();
		for (const position of positions) received[position] = (received[position] as number) ^ 0x5a;
		return received;
	};

	it('corrects a single error at every position', () => {
		for (let position = 0; position < clean.length; position += 1) {
			const result = rsDecode(code, withErrors([position]));
			expect(result.codewords, `error at ${position}`).toEqual(clean);
			expect(result.errors).toBe(1);
		}
	});

	it('refuses more errors than maxErrors even when it could correct them', () => {
		const received = withErrors([1, 7, 20]);
		expect(rsDecode(code, received, { maxErrors: 3 }).codewords).toEqual(clean);
		expect(() => rsDecode(code, received, { maxErrors: 2 })).toThrow(RsDecodeError);
		try {
			rsDecode(code, received, { maxErrors: 2 });
		} catch (error) {
			expect((error as RsDecodeError).reason).toBe('over-limit');
		}
		// Erasures do not count against it.
		expect(
			rsDecode(code, withErrors([1, 7, 20]), { erasures: [1, 7, 20], maxErrors: 0 }).codewords,
		).toEqual(clean);
		expect(rsDecode(code, clean, { maxErrors: 0 }).errors).toBe(0);
	});

	it('refuses more erasures than check symbols before doing any algebra', () => {
		try {
			rsDecode(code, clean, { erasures: Array.from({ length: 11 }, (_, i) => i) });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(RsDecodeError);
			expect((error as RsDecodeError).reason).toBe('too-many-erasures');
			expect((error as RsDecodeError).code).toBe('decode/unreadable');
			expect((error as RsDecodeError).params).toEqual({ stage: 'reed-solomon' });
		}
	});

	it('corrects as many erasures as there are check symbols', () => {
		const positions = [0, 3, 5, 8, 13, 17, 19, 21, 24, 25];
		const received = clean.slice();
		for (const position of positions) received[position] = 0;
		expect(rsDecode(code, received, { erasures: positions })).toEqual({
			codewords: clean,
			errors: 0,
			erasures: 10,
		});
	});

	it('refuses when the locator needs more errors than the check symbols allow', () => {
		const random = seeded(99);
		let tooMany = 0;
		for (let trial = 0; trial < 200; trial += 1) {
			const received = clean.slice();
			for (const position of distinctPositions(random, clean.length, 8)) {
				received[position] = (received[position] as number) ^ (1 + random.int(255));
			}
			try {
				rsDecode(code, received);
			} catch (error) {
				if ((error as RsDecodeError).reason === 'too-many-errors') tooMany += 1;
			}
		}
		expect(tooMany).toBeGreaterThan(0);
	});

	it('refuses parameters and blocks that are bugs in the caller', () => {
		expect(() => rsEncode(qr(0), [1])).toThrow(RangeError);
		expect(() => rsEncode(qr(1.5), [1])).toThrow(RangeError);
		expect(() => rsEncode({ field: QR_FIELD, ecCount: 4, firstRoot: 0.5 }, [1])).toThrow(
			RangeError,
		);
		expect(() => rsEncode(qr(10), new Array(246).fill(0))).toThrow(RangeError);
		expect(() => rsEncode(qr(10), [256])).toThrow(RangeError);
		expect(() => rsDecode(qr(10), new Array(256).fill(0))).toThrow(RangeError);
		expect(() => rsDecode(qr(10), new Array(9).fill(0))).toThrow(RangeError);
		expect(() => rsDecode(code, [...clean.slice(0, -1), 256])).toThrow(RangeError);
		expect(() => rsDecode(code, [...clean.slice(0, -1), 1.5])).toThrow(RangeError);
		expect(() => rsDecode(code, clean, { erasures: [26] })).toThrow(RangeError);
		expect(() => rsDecode(code, clean, { erasures: [-1] })).toThrow(RangeError);
		expect(() => rsDecode(code, clean, { erasures: [0.5] })).toThrow(RangeError);
		expect(() => rsDecode(code, clean, { erasures: [3, 3] })).toThrow(TypeError);
		expect(() => rsDecode(code, clean, { maxErrors: -1 })).toThrow(RangeError);
		expect(() => rsDecode(code, clean, { maxErrors: 1.5 })).toThrow(RangeError);
	});

	it('keeps symbol values out of its messages', () => {
		try {
			rsDecode(code, [...clean.slice(0, -1), 4321]);
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).not.toContain('4321');
		}
	});

	it('treats first roots a whole period apart as the same code', () => {
		// 255 is the order of QR's field, so b and b + 255k name the same roots.
		// A huge first root must not push any exponent past a safe integer.
		const data = [1, 2, 3, 4, 5, 6];
		const base: RsCode = { field: QR_FIELD, ecCount: 8, firstRoot: 1 };
		const shifted: RsCode = { field: QR_FIELD, ecCount: 8, firstRoot: 1 + 255 * 3 };
		const huge: RsCode = { field: QR_FIELD, ecCount: 8, firstRoot: 1 + 255 * 2 ** 44 };
		const negative: RsCode = { field: QR_FIELD, ecCount: 8, firstRoot: 1 - 255 * 2 };
		const check = rsEncode(base, data);
		for (const code of [shifted, huge, negative]) {
			expect(rsEncode(code, data)).toEqual(check);
			const received = [...data, ...check];
			received[2] = (received[2] as number) ^ 0x77;
			received[9] = (received[9] as number) ^ 0x11;
			expect(rsDecode(code, received).codewords).toEqual([...data, ...check]);
		}
	});

	it('decodes a block of check symbols alone', () => {
		const zero = qr(6);
		const received = [0, 0, 7, 0, 0, 0];
		expect(rsDecode(zero, received).codewords).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it('accepts any ArrayLike, including a Uint8Array, and returns plain numbers', () => {
		const received = Uint8Array.from(withErrors([2]));
		const result = rsDecode(code, received);
		expect(Array.isArray(result.codewords)).toBe(true);
		expect(result.codewords).toEqual(clean);
		expect(rsEncode(code, Uint8Array.from(data))).toEqual(clean.slice(16));
	});
});
