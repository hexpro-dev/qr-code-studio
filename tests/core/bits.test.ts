import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BitBuffer, BitReader } from '../../src/core/bits.js';

function written(fields: readonly (readonly [value: number, bits: number])[]): BitBuffer {
	const buffer = new BitBuffer();
	for (const [value, bits] of fields) buffer.append(value, bits);
	return buffer;
}

describe('BitBuffer', () => {
	it('writes most significant bit first', () => {
		// The property everything else rests on. Every bit field in a QR symbol is
		// MSB first, and getting it backwards produces output that looks like data
		// and decodes to rubbish.
		expect(written([[0b101, 3]]).toBytes()).toEqual(new Uint8Array([0b1010_0000]));
	});

	it('packs fields without gaps and pads the last byte with zeros', () => {
		const buffer = written([
			[0b0100, 4],
			[0b0000_0011, 8],
			[0b1, 1],
		]);
		expect(buffer.length).toBe(13);
		expect(buffer.toBytes()).toEqual(new Uint8Array([0b0100_0000, 0b0011_1000]));
	});

	it('writes zero-width fields as nothing and 32 bit fields whole', () => {
		const buffer = written([
			[0, 0],
			[0xdeadbeef, 32],
			[0xffffffff, 32],
		]);
		expect(buffer.length).toBe(64);
		expect(buffer.toBytes()).toEqual(
			new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xff, 0xff, 0xff, 0xff]),
		);
	});

	it('reads single bits back', () => {
		const buffer = written([[0b1011, 4]]);
		expect([0, 1, 2, 3].map((i) => buffer.bit(i))).toEqual([1, 0, 1, 1]);
	});

	it('grows past its first allocation', () => {
		const buffer = new BitBuffer();
		for (let i = 0; i < 1000; i += 1) buffer.append(i & 0xff, 8);
		expect(buffer.length).toBe(8000);
		const bytes = buffer.toBytes();
		expect(bytes.length).toBe(1000);
		expect(bytes[999]).toBe(999 & 0xff);
	});

	it('grows by more than one doubling when a large buffer is appended at once', () => {
		const large = new BitBuffer();
		for (let i = 0; i < 300; i += 1) large.append(0xa5, 8);
		const small = written([[1, 1]]);
		small.appendBits(large);
		expect(small.length).toBe(2401);
		expect(small.bit(0)).toBe(1);
		expect(small.bit(1)).toBe(1);
		expect(small.bit(2400)).toBe(1);
	});

	it('appends another buffer, including itself', () => {
		const a = written([[0b101, 3]]);
		const b = written([[0b0110, 4]]);
		a.appendBits(b);
		expect(a.length).toBe(7);
		expect(a.toBytes()).toEqual(new Uint8Array([0b1010_1100]));
		// Appending a buffer to itself copies what was there when the call began.
		a.appendBits(a);
		expect(a.length).toBe(14);
		expect(a.toBytes()).toEqual(new Uint8Array([0b1010_1101, 0b0101_1000]));
	});

	it('hands out a copy, so later appends do not reach it', () => {
		const buffer = written([[0xff, 8]]);
		const before = buffer.toBytes();
		buffer.append(0, 8);
		before[0] = 0;
		expect(buffer.toBytes()).toEqual(new Uint8Array([0xff, 0x00]));
	});

	it('refuses widths outside 0 to 32 and values that do not fit', () => {
		const buffer = new BitBuffer();
		expect(() => buffer.append(0, 33)).toThrow(RangeError);
		expect(() => buffer.append(0, -1)).toThrow(RangeError);
		expect(() => buffer.append(0, 1.5)).toThrow(RangeError);
		expect(() => buffer.append(8, 3)).toThrow(RangeError);
		expect(() => buffer.append(-1, 8)).toThrow(RangeError);
		expect(() => buffer.append(0.5, 8)).toThrow(RangeError);
		expect(() => buffer.append(0x100000000, 32)).toThrow(RangeError);
		expect(buffer.length).toBe(0);
	});

	it('keeps the refused value out of the message', () => {
		// A value written here is part of somebody's content.
		try {
			new BitBuffer().append(4242, 4);
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).not.toContain('4242');
		}
	});

	it('refuses to read a bit that was never written', () => {
		const buffer = written([[1, 1]]);
		expect(() => buffer.bit(1)).toThrow(RangeError);
		expect(() => buffer.bit(-1)).toThrow(RangeError);
		expect(() => buffer.bit(0.5)).toThrow(RangeError);
	});
});

describe('BitReader', () => {
	it('reads most significant bit first, across byte boundaries', () => {
		const reader = new BitReader(new Uint8Array([0b0100_0000, 0b0011_1010]));
		expect(reader.read(4)).toBe(0b0100);
		expect(reader.read(8)).toBe(0b0000_0011);
		expect(reader.position).toBe(12);
		expect(reader.read(4)).toBe(0b1010);
		expect(reader.remaining).toBe(0);
	});

	it('reads 32 bits as an unsigned number and 0 bits as zero', () => {
		const reader = new BitReader(new Uint8Array([0xff, 0xff, 0xff, 0xfe]));
		expect(reader.read(0)).toBe(0);
		expect(reader.read(32)).toBe(0xfffffffe);
	});

	it('stops at a bit length shorter than the bytes', () => {
		// Micro QR M1 and M3 end on a half codeword.
		const reader = new BitReader(new Uint8Array([0xff, 0xf0]), 12);
		expect(reader.remaining).toBe(12);
		expect(reader.read(12)).toBe(0xfff);
		expect(() => reader.read(1)).toThrow(RangeError);
	});

	it('refuses to read past the end, and a length the bytes cannot hold', () => {
		expect(() => new BitReader(new Uint8Array(1)).read(9)).toThrow(RangeError);
		expect(() => new BitReader(new Uint8Array(1)).read(33)).toThrow(RangeError);
		expect(() => new BitReader(new Uint8Array(1), 9)).toThrow(RangeError);
		expect(() => new BitReader(new Uint8Array(1), -1)).toThrow(RangeError);
		expect(() => new BitReader(new Uint8Array(1), 2.5)).toThrow(RangeError);
	});
});

describe('BitBuffer and BitReader together', () => {
	it('round trip any sequence of fields', () => {
		const field = fc
			.integer({ min: 0, max: 32 })
			.chain((bits) =>
				fc.tuple(
					fc.integer({ min: 0, max: bits === 32 ? 0xffffffff : 2 ** bits - 1 }),
					fc.constant(bits),
				),
			);
		fc.assert(
			fc.property(fc.array(field, { maxLength: 40 }), (fields) => {
				const buffer = written(fields);
				const reader = new BitReader(buffer.toBytes(), buffer.length);
				for (const [value, bits] of fields) expect(reader.read(bits)).toBe(value);
				expect(reader.remaining).toBe(0);
			}),
			{ seed: 0x51c0de, numRuns: 300 },
		);
	});
});
