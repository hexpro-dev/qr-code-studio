import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { adler32, crc32 } from '../../src/core/checksums.js';
import { seeded } from './helpers.js';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Adler-32 straight from RFC 1950 section 9, a modulo per byte. */
function slowAdler(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (const byte of bytes) {
		a = (a + byte) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}

describe('crc32', () => {
	it('gives the check value of the CRC-32 catalogue', () => {
		// "123456789" is the standard check input for every CRC in the catalogue.
		expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
		expect(crc32(new Uint8Array(0))).toBe(0);
		// The CRC PNG writes for an IEND chunk, over its type alone.
		expect(crc32(ascii('IEND'))).toBe(0xae426082);
	});

	it('chains through its seed', () => {
		const whole = ascii('IHDR and the data after it');
		expect(crc32(whole.subarray(4), crc32(whole.subarray(0, 4)))).toBe(crc32(whole));
		expect(crc32(new Uint8Array(0), 0x12345678)).toBe(0x12345678);
	});

	it("agrees with zlib's on seeded random input of every small length", () => {
		const random = seeded(3309);
		for (let length = 0; length < 300; length += 1) {
			const bytes = random.bytes(length);
			expect(crc32(bytes), `${length} bytes`).toBe(zlibCrc32(bytes));
			const seed = random.int(0x100000000);
			expect(crc32(bytes, seed)).toBe(zlibCrc32(bytes, seed));
		}
	});

	it('refuses a seed that is not an unsigned 32 bit integer', () => {
		expect(() => crc32(new Uint8Array(1), -1)).toThrow(RangeError);
		expect(() => crc32(new Uint8Array(1), 0x100000000)).toThrow(RangeError);
		expect(() => crc32(new Uint8Array(1), 0.5)).toThrow(RangeError);
	});
});

describe('adler32', () => {
	it('gives the published value for "Wikipedia"', () => {
		expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398);
		expect(adler32(new Uint8Array(0))).toBe(1);
	});

	it('matches the definition across the 5552 byte reduction boundary', () => {
		// All 0xff is the input that grows the sums fastest.
		for (const length of [5551, 5552, 5553, 11104, 100_000]) {
			const bytes = new Uint8Array(length).fill(0xff);
			expect(adler32(bytes), `${length} bytes`).toBe(slowAdler(bytes));
		}
		const random = seeded(1950);
		const bytes = random.bytes(70_000);
		expect(adler32(bytes)).toBe(slowAdler(bytes));
	});
});
