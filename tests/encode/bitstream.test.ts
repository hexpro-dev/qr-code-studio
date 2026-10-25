/**
 * Terminator and padding (ISO/IEC 18004 7.4.9 and 7.4.10), including the
 * 4-bit final codeword Micro QR M1 and M3 end on, which no QR symbol has but
 * the contract does.
 */

import { describe, expect, it } from 'vitest';
import { dataCodewords } from '../../src/encode/bitstream.js';
import { qrProfile } from '../../src/segment/profile.js';
import type { BitstreamProfile, Mode, Segment } from '../../src/segment/types.js';
import { qrBlocks } from '../../src/symbology/qr/blocks.js';
import type { BlockLayout } from '../../src/symbology/types.js';

const digits = (text: string): Segment => ({
	mode: 'numeric',
	chars: text.length,
	data: Uint8Array.from([...text].map((c) => c.charCodeAt(0))),
});

describe('dataCodewords', () => {
	it('writes the terminator, zero bits to a codeword, then EC and 11 alternately', () => {
		const out = dataCodewords([digits('01234567')], {}, qrProfile(1), qrBlocks(1, 'M'));
		expect(Array.from(out)).toEqual([
			0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
			0x11,
		]);
	});

	it('cuts the terminator short when the symbol is nearly full, and leaves it out when full', () => {
		// 1-L holds 152 bits; 41 digits take 4 + 10 + 137 = 151, so one zero bit of
		// terminator fits and nothing else.
		const full = dataCodewords([digits('1'.repeat(41))], {}, qrProfile(1), qrBlocks(1, 'L'));
		expect(full).toHaveLength(19);
		expect((full[18] as number) & 1).toBe(0);
		expect(() =>
			dataCodewords([digits('1'.repeat(42))], {}, qrProfile(1), qrBlocks(1, 'L')),
		).toThrow(RangeError);
	});

	it('pads a 4-bit final codeword with 0000, in the high nibble', () => {
		const m1: BitstreamProfile = {
			modes: ['numeric'],
			modeIndicatorBits: 0,
			modeIndicator: (kind) => (kind === 'numeric' ? 0 : undefined),
			charCountBits: (_mode: Mode) => 3,
			terminatorBits: 3,
			eci: false,
			fnc1: false,
			structuredAppend: false,
		};
		const layout: BlockLayout = {
			blocks: [{ dataCount: 3, ecCount: 2 }],
			totalCodewords: 5,
			p: 2,
			lastDataCodewordBits: 4,
			dataBits: 20,
		};
		// Count 010, digits 12 as 0001100, terminator 000, then 000 to the
		// codeword boundary, and the 4-bit codeword's pad, 0000.
		expect(Array.from(dataCodewords([digits('12')], {}, m1, layout))).toEqual([
			0b01000011, 0b00000000, 0b00000000,
		]);
		// Five digits fill all 20 bits, the last four in the high nibble, and
		// leave no room for a terminator: 101, 0001111011, 0101101.
		expect(Array.from(dataCodewords([digits('12345')], {}, m1, layout))).toEqual([
			0b10100011, 0b11011010, 0b11010000,
		]);
	});
});
