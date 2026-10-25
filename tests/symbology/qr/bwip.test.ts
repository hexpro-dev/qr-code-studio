/**
 * Our symbols, module for module, against BWIPP (through bwip-js), and our
 * reader on BWIPP's symbols.
 *
 * BWIPP is the third encoder, written in PostScript by a different author
 * from the other two and from this package. It takes a forced mask (numbered
 * 1 to 8) but always optimises modes itself, so it is given only content
 * whose optimum is one segment in an obvious mode: digits, capitals or lower
 * case. Kanji is left to the other oracles, because BWIPP does not choose
 * kanji mode from Shift_JIS bytes. Every (version, level, mask) appears once.
 */

import { describe, expect, it } from 'vitest';
import type { Mode } from '../../../src/segment/types.js';
import { buildQr } from '../../../src/symbology/qr/build.js';
import { readQr } from '../../../src/symbology/qr/read.js';
import { EC_LEVELS } from '../../../src/symbology/qr/tables.js';
import { seeded } from '../../core/helpers.js';
import { bwipAuto, bwipMatrix, capacity, ourData, payload } from './oracles.js';

const MODES: readonly Mode[] = ['numeric', 'alphanumeric', 'byte'];

describe('QR matrices against bwip-js', () => {
	for (const level of EC_LEVELS) {
		it(`match at every version and mask at level ${level}`, () => {
			const random = seeded(0xb317 + level.charCodeAt(0));
			for (let version = 1; version <= 40; version += 1) {
				for (let mask = 0; mask < 8; mask += 1) {
					const mode = MODES[random.int(MODES.length)]!;
					const p = payload(random, mode, 1 + random.int(capacity(mode, version, level)));
					const ours = buildQr(ourData(p, version, level), version, level, mask);
					const theirs = bwipMatrix(p.text, version, level, mask);
					expect(
						theirs.equals(ours.matrix),
						`${version}-${level} mask ${mask}, ${p.text.length} ${mode}`,
					).toBe(true);
				}
			}
		});
	}
});

describe('reading what bwip-js makes', () => {
	it('reads its mixed-mode symbols, its ECI and its GS1 data', () => {
		const random = seeded(0xbead);
		for (let round = 0; round < 40; round += 1) {
			let text = '';
			for (let i = 0; i < 1 + random.int(8); i += 1) {
				const piece = ['0123456789', 'HELLO WORLD', 'example.com/a?b=c', '$%*+-./:'][
					random.int(4)
				]!;
				text += piece.slice(0, 1 + random.int(piece.length));
			}
			const level = EC_LEVELS[random.int(4)]!;
			const read = readQr(bwipAuto(text, { eclevel: level }), { strict: true });
			expect(read.bitstream.text, `round ${round}`).toBe(text);
			expect(read.ecLevel).toBe(level);
		}
		const eci = readQr(
			bwipAuto('^ECI000026' + String.fromCharCode(0xc3, 0xa9), { parsefnc: true }),
			{ strict: true },
		);
		expect(eci.bitstream).toMatchObject({ text: 'é', textSource: 'eci-26' });
		const gs1 = readQr(bwipAuto('^FNC10103453120000011^FNC110ABC%1', { parsefnc: true }), {
			strict: true,
		});
		expect(gs1.bitstream.fnc1).toBe('gs1');
		expect(gs1.bitstream.text).toBe('0103453120000011\u001d10ABC%1');
	});
});
