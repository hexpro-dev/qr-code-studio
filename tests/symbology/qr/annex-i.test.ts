/**
 * ISO/IEC 18004:2015 Annex I, the specification's own worked example: the
 * digits 01234567 as a 1-M symbol.
 *
 * The Annex lists the bit stream (0001 0000001000 0000001100 0101011001
 * 1000011, then the terminator), the 16 data codewords and the 10 check
 * codewords, and those are asserted here exactly as printed. The grid that
 * follows from them is then held module for module at every mask against
 * qrcode and bwip-js, and pinned as a picture at the mask this package's
 * scorer chooses (mask 0, which qrcode also chooses), so a change to
 * placement, masking or format information shows up as a diff of the
 * picture.
 */

import { describe, expect, it } from 'vitest';
import { encode } from '../../../src/encode/encode.js';
import { qrProfile } from '../../../src/segment/profile.js';
import { segmentText } from '../../../src/segment/segment-text.js';
import { BitBuffer } from '../../../src/core/bits.js';
import { writeSegments } from '../../../src/segment/write.js';
import { buildQr } from '../../../src/symbology/qr/build.js';
import { formatBits } from '../../../src/symbology/qr/info.js';
import { readQr } from '../../../src/symbology/qr/read.js';
import { bwipMatrix, qrcodeMatrix } from './oracles.js';

const DATA = [
	0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
];
const CHECK = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];

const PICTURE = [
	'#######...###.#######',
	'#.....#.###...#.....#',
	'#.###.#..##...#.###.#',
	'#.###.#..#.##.#.###.#',
	'#.###.#.##.##.#.###.#',
	'#.....#....#..#.....#',
	'#######.#.#.#.#######',
	'.....................',
	'#.#.#.#...#.#...#..#.',
	'##.#....#.##.#.#...#.',
	'...##.###.##.###.###.',
	'##..##.#.#.###.##..#.',
	'..#..###.###.###....#',
	'........#.#...#....#.',
	'#######.....#...#...#',
	'#.....#...#...#..#.##',
	'#.###.#.###.#.#.###.#',
	'#.###.#..#.#.#.#.###.',
	'#.###.#.##.#.###..#.#',
	'#.....#....###.###...',
	'#######.#..#.###..#.#',
];

describe('ISO/IEC 18004 Annex I', () => {
	it('gives the bit stream the Annex prints', () => {
		const segments = segmentText('01234567', qrProfile(1));
		const out = new BitBuffer();
		writeSegments(segments, qrProfile(1), out);
		let bits = '';
		for (let i = 0; i < out.length; i += 1) bits += out.bit(i);
		expect(bits).toBe('0001' + '0000001000' + '0000001100' + '0101011001' + '1000011');
	});

	it('gives the data and check codewords the Annex prints', () => {
		const symbol = encode('01234567', { ecLevel: 'M', maxVersion: '1' });
		expect(symbol.version).toBe('1');
		expect(Array.from(symbol.codewords)).toEqual([...DATA, ...CHECK]);
	});

	it('draws the same grid as qrcode and bwip-js at every mask, and this one at mask 0', () => {
		for (let mask = 0; mask < 8; mask += 1) {
			const ours = buildQr(Uint8Array.from(DATA), 1, 'M', mask);
			expect(Array.from(ours.matrix.data), `mask ${mask}`).toEqual(
				Array.from(qrcodeMatrix({ mode: 'numeric', text: '01234567' }, 1, 'M', mask).modules),
			);
			expect(bwipMatrix('01234567', 1, 'M', mask).equals(ours.matrix), `mask ${mask}`).toBe(true);
			// The format information reads back as M and this mask.
			let word = 0;
			for (let i = 0; i <= 5; i += 1) word = word * 2 + ours.matrix.get(i, 8);
			expect(word).toBe(formatBits('M', mask) >>> 9);
		}
		const chosen = encode('01234567', { ecLevel: 'M', maxVersion: '1' });
		expect(chosen.mask).toBe(0);
		expect(qrcodeMatrix({ mode: 'numeric', text: '01234567' }, 1, 'M').mask).toBe(0);
		const picture = Array.from({ length: 21 }, (_, y) =>
			Array.from({ length: 21 }, (_, x) => (chosen.matrix.get(x, y) ? '#' : '.')).join(''),
		);
		expect(picture).toEqual(PICTURE);
		expect(readQr(chosen.matrix, { strict: true }).bitstream.text).toBe('01234567');
	});
});
