/**
 * zxing-cpp (through zxing-wasm) reads what this package encodes.
 *
 * Every other test here compares matrices or reads them with our own reader.
 * This one hands a real decoder pixels: each symbol drawn at four pixels a
 * module with a four-module quiet zone, as a printer would get it, and read
 * with zxing-cpp's QR reader. The sample is seeded and spans versions 1 to
 * 40, every level and every mode, plus the headers that are easiest to get
 * subtly wrong: ECI, kanji, FNC1 in both positions, and structured append.
 * The wasm comes from node_modules; nothing is fetched.
 */

import { describe, expect, it } from 'vitest';
import { encode } from '../../../src/encode/encode.js';
import { encodeStructuredAppend } from '../../../src/encode/structured-append.js';
import type { EcLevel } from '../../../src/segment/types.js';
import { EC_LEVELS } from '../../../src/symbology/qr/tables.js';
import { seeded } from '../../core/helpers.js';
import { draw, zxingRead } from './oracles.js';

const PIECES = [
	'0123456789',
	'HELLO WORLD ',
	'lower case, punctuation; ',
	'Café ',
	'naïve ',
	'日本語の文章',
	'€ ',
	'😀',
	'/:$%*+-',
];

describe('zxing-cpp reads our symbols', () => {
	it('across versions, levels and modes', async () => {
		const random = seeded(0x2c11);
		const versions = new Set<string>();
		for (let round = 0; round < 80; round += 1) {
			let text = '';
			// The last ten are large, at level L, so the biggest versions appear.
			const large = round >= 70;
			const target = large ? 700 + random.int(600) : 1 + random.int(200);
			while (text.length < target) text += PIECES[random.int(PIECES.length)]!;
			const level = large ? 'L' : (EC_LEVELS[random.int(4)] as EcLevel);
			const pinned = !large && random.int(3) === 0;
			const symbol = encode(text, {
				ecLevel: level,
				...(pinned ? { minVersion: String(10 + random.int(31)) } : {}),
			});
			versions.add(symbol.version);
			const [result] = await zxingRead(draw(symbol.matrix));
			expect(result?.text, `round ${round}, version ${symbol.version}-${level}`).toBe(text);
			expect(result?.ecLevel).toBe(level);
		}
		expect(versions.size).toBeGreaterThan(30);
		expect(versions.has('40')).toBe(true);
	});

	it('with an ECI, with kanji, and with GS1 and application indicator FNC1', async () => {
		const eci = encode('Café ×3', { segmentation: { eci: 'utf-8' } });
		const [eciRead] = await zxingRead(draw(eci.matrix));
		expect(eciRead).toMatchObject({ text: 'Café ×3', hasECI: true });

		const kanji = encode('日本語の文章を漢字モードで', { segmentation: { kanji: 'always' } });
		const [kanjiRead] = await zxingRead(draw(kanji.matrix));
		expect(kanjiRead?.text).toBe('日本語の文章を漢字モードで');

		// GS1: (01) 03453120000011 (17) 191125 (10) ABCD1234, GS after the lot.
		const gs1 = encode('0103453120000011171911251' + '0ABCD1234\u001d21X%1', { fnc1: 'gs1' });
		const [gs1Read] = await zxingRead(draw(gs1.matrix));
		expect(gs1Read?.symbologyIdentifier).toBe(']Q3');
		expect(gs1Read?.text).toBe('0103453120000011171911251' + '0ABCD1234\u001d21X%1');

		const ai = encode('ABC123', { fnc1: { applicationIndicator: 37 } });
		const [aiRead] = await zxingRead(draw(ai.matrix));
		expect(aiRead?.symbologyIdentifier).toBe(']Q5');
		expect(aiRead?.text).toBe('37ABC123');
	});

	it('as a structured append set, part by part', async () => {
		const text = 'Example Network, pass phrase: example only. '.repeat(12) + '日本語';
		const set = encodeStructuredAppend(text, { maxVersion: '6' });
		expect(set.length).toBeGreaterThan(2);
		let joined = '';
		const ids = new Set<string>();
		for (const [index, symbol] of set.entries()) {
			const [read] = await zxingRead(draw(symbol.matrix));
			expect(read?.sequenceIndex).toBe(index);
			expect(read?.sequenceSize).toBe(set.length);
			ids.add(read!.sequenceId);
			joined += read!.text;
		}
		expect(ids.size).toBe(1);
		expect(joined).toBe(text);
	});
});
