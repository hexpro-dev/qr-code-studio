import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	crc16CcittFalse,
	gs1CheckDigit,
	luhn,
	mod10Recursive,
	mod97,
} from '../../src/payload/check-digits.js';

const ascii = (text: string) => new TextEncoder().encode(text);

/** A table-driven CRC-16/CCITT-FALSE, written differently from the bitwise one under test. */
const TABLE = Array.from({ length: 256 }, (_, n) => {
	let crc = n << 8;
	for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
	return crc & 0xffff;
});
function tableCrc(bytes: Uint8Array): number {
	let crc = 0xffff;
	for (const byte of bytes)
		crc = ((crc << 8) ^ (TABLE[((crc >> 8) ^ byte) & 0xff] as number)) & 0xffff;
	return crc;
}

describe('crc16CcittFalse', () => {
	it('gives the catalogue check value for "123456789"', () => {
		// Greg Cook, "Catalogue of parametrised CRC algorithms", CRC-16/IBM-3740
		// (alias CRC-16/CCITT-FALSE): check = 0x29b1.
		expect(crc16CcittFalse(ascii('123456789'))).toBe(0x29b1);
	});

	it('reproduces the CRC of the Pix manual static example', () => {
		// BCB, Manual de Padroes para Iniciacao do Pix v2.10.0: 0x1D3D, over
		// everything up to and including "6304".
		const body =
			'00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
		expect(crc16CcittFalse(ascii(body))).toBe(0x1d3d);
	});

	it('is 0xffff over nothing', () => {
		expect(crc16CcittFalse(new Uint8Array())).toBe(0xffff);
	});

	it('agrees with a table-driven implementation', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
				expect(crc16CcittFalse(bytes)).toBe(tableCrc(bytes));
			}),
		);
	});
});

describe('mod97', () => {
	it('leaves 1 for the ISO 13616 example IBAN, rearranged', () => {
		// GB82 WEST 1234 5698 7654 32: bank code and account, then GB82 as 161182.
		expect(mod97('3214282912345698765432161182')).toBe(1);
	});

	it('agrees with BigInt on long numbers', () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[0-9]{1,60}$/), (digits) => {
				expect(mod97(digits)).toBe(Number(BigInt(digits) % 97n));
			}),
		);
	});

	it('refuses anything but digits', () => {
		expect(() => mod97('')).toThrow(TypeError);
		expect(() => mod97('12a')).toThrow(TypeError);
		expect(() => mod97(12 as unknown as string)).toThrow(TypeError);
	});
});

describe('mod10Recursive', () => {
	it('gives the check digit of the Swiss QR-bill example reference', () => {
		// SIX Implementation Guidelines QR-bill v2.4, example 2:
		// 210000000003139471430009017, check digit 7.
		expect(mod10Recursive('21000000000313947143000901')).toBe(7);
	});

	it('gives 0 for a body of zeros', () => {
		expect(mod10Recursive('00000000000000000000000000')).toBe(0);
	});

	it('detects every single-digit substitution', () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[0-9]{26}$/),
				fc.nat(25),
				fc.integer({ min: 1, max: 9 }),
				(body, position, delta) => {
					const changed =
						body.slice(0, position) +
						String((Number(body[position]) + delta) % 10) +
						body.slice(position + 1);
					expect(mod10Recursive(changed)).not.toBe(mod10Recursive(body));
				},
			),
		);
	});

	it('refuses anything but digits', () => {
		expect(() => mod10Recursive('2100x')).toThrow(TypeError);
	});
});

describe('gs1CheckDigit', () => {
	it('gives the check digits of GS1 example GTINs', () => {
		// GS1 Digital Link Standard 1.7.0 section 5.5: 09520123456788.
		expect(gs1CheckDigit('0952012345678')).toBe(8);
		// GS1's example GTIN-13 9506000134352, used throughout its documentation.
		expect(gs1CheckDigit('950600013435')).toBe(2);
		// A GTIN-8 worked by hand: weights 3 1 3 1 3 1 3 from the right of
		// 9638507 give 21 + 0 + 15 + 8 + 9 + 6 + 27 = 86, so the check is 4.
		expect(gs1CheckDigit('9638507')).toBe(4);
	});

	it('gives the same digit whatever the leading zeros', () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[0-9]{7,13}$/), (digits) => {
				expect(gs1CheckDigit(digits.padStart(13, '0'))).toBe(gs1CheckDigit(digits));
			}),
		);
	});

	it('refuses anything but digits', () => {
		expect(() => gs1CheckDigit('95 06')).toThrow(TypeError);
	});
});

describe('luhn', () => {
	it('gives the check digit of the usual worked example', () => {
		// 7992739871: doubling every second digit from the right gives
		// 7 18 9 4 7 6 9 16 7 2, digit sums 7 9 9 4 7 6 9 7 7 2 = 67, so the
		// check digit is 3 and the full number 79927398713.
		expect(luhn('7992739871')).toBe(3);
	});

	it('detects every single-digit substitution', () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[0-9]{5,19}$/),
				fc.nat(),
				fc.integer({ min: 1, max: 9 }),
				(body, at, delta) => {
					const position = at % body.length;
					const changed =
						body.slice(0, position) +
						String((Number(body[position]) + delta) % 10) +
						body.slice(position + 1);
					expect(luhn(changed)).not.toBe(luhn(body));
				},
			),
		);
	});

	it('refuses anything but digits', () => {
		expect(() => luhn('-1')).toThrow(TypeError);
	});
});
