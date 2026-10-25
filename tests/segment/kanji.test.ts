/**
 * Which characters may go into kanji mode, re-derived from independent tables.
 *
 * The table in `src/segment/kanji.ts` comes from the runtime's WHATWG
 * decoder. Here the eligible set is worked out again from iconv-lite's
 * Shift_JIS and CP932 codecs and jsQR's Shift_JIS table (the strict JIS X
 * 0208 mapping a real reader decodes kanji with), and the two must be equal.
 *
 * One finding shapes the test: iconv-lite 0.7 implements CP932 and Shift_JIS
 * as one table (`cp932` is an alias of `shiftjis` in its dbcs-data.js), so
 * their intersection excludes nothing that either alone does not. The
 * divergent codes are therefore found from jsQR's table, which is the strict
 * mapping, plus the two whose divergence lives in readers neither table
 * models (0x815C, EM DASH in JIS X 0208:1997; 0x818F, folded into the
 * single-byte yen by some), and the brief's eight are checked by name.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const iconv = require('iconv-lite') as {
	decode(bytes: Buffer, encoding: string): string;
	encode(text: string, encoding: string): Buffer;
};

/** jsQR's Shift_JIS table, read out of its bundle: the strict JIS X 0208 mapping. */
function jsqrTable(): Map<number, number> {
	const source = readFileSync(require.resolve('jsqr/dist/jsQR.js'), 'utf8');
	const start = source.indexOf('exports.shiftJISTable = {');
	const body = source.slice(start, source.indexOf('};', start));
	const table = new Map<number, number>();
	for (const match of body.matchAll(/0x([0-9A-F]+):\s*0x([0-9A-F]+)/g)) {
		table.set(Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16));
	}
	return table;
}

function* kanjiRangeCodes(): Generator<number> {
	for (const [first, last] of [
		[0x81, 0x9f],
		[0xe0, 0xeb],
	] as const) {
		for (let lead = first; lead <= last; lead += 1) {
			for (let trail = 0x40; trail <= 0xfc; trail += 1) {
				const code = (lead << 8) | trail;
				if (trail !== 0x7f && code <= 0xebbf) yield code;
			}
		}
	}
}

function single(text: string): number | undefined {
	const points = [...text];
	return points.length === 1 && text !== '�' ? points[0]!.codePointAt(0) : undefined;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('the kanji table', () => {
	it('is the codes iconv-lite and WHATWG agree on, less row 13 and the divergent codes', async () => {
		const { DIVERGENT, kanjiCode } = await import('../../src/segment/kanji.js');
		const whatwg = new TextDecoder('shift_jis');
		const strict = jsqrTable();

		const agreed = new Set<number>();
		const divergent = new Set<number>();
		for (const code of kanjiRangeCodes()) {
			if (code >>> 8 === 0x87) continue;
			const bytes = Buffer.from([code >>> 8, code & 0xff]);
			const web = single(whatwg.decode(bytes));
			const sjis = single(iconv.decode(bytes, 'shift_jis'));
			const cp932 = single(iconv.decode(bytes, 'cp932'));
			if (web === undefined || web !== sjis || web !== cp932) continue;
			const char = String.fromCodePoint(web);
			const back = [iconv.encode(char, 'shift_jis'), iconv.encode(char, 'cp932')];
			if (!back.every((encoded) => encoded.length === 2 && encoded.readUInt16BE(0) === code))
				continue;
			const jis = strict.get(code);
			if (jis !== undefined && jis !== web) divergent.add(code);
			else agreed.add(code);
		}
		// Divergence outside both tables, named in the source with its reason.
		for (const code of [0x815c, 0x818f]) {
			agreed.delete(code);
			divergent.add(code);
		}

		const runtime = new Set<number>();
		for (const code of kanjiRangeCodes()) {
			const char = single(whatwg.decode(Uint8Array.from([code >>> 8, code & 0xff])));
			if (char !== undefined && kanjiCode(char) === code) runtime.add(code);
		}
		expect(runtime.size).toBeGreaterThan(6800);
		expect([...runtime].sort((a, b) => a - b)).toEqual([...agreed].sort((a, b) => a - b));
		expect([...DIVERGENT.keys()].sort((a, b) => a - b)).toEqual(
			[...divergent].sort((a, b) => a - b),
		);
		// Each listed pair says what WHATWG reads and what the strict table reads.
		for (const [code, [web, jis]] of DIVERGENT) {
			expect(
				single(whatwg.decode(Uint8Array.from([code >>> 8, code & 0xff]))),
				code.toString(16),
			).toBe(web);
			const listed = strict.get(code);
			if (listed !== web) expect(listed, code.toString(16)).toBe(jis);
		}
	});

	it('leaves out the eight codes readers are known to disagree on', async () => {
		const { kanjiCode } = await import('../../src/segment/kanji.js');
		const whatwg = new TextDecoder('shift_jis');
		for (const code of [0x8160, 0x8161, 0x817c, 0x8191, 0x8192, 0x81ca, 0x815f, 0x818f]) {
			const char = whatwg.decode(Uint8Array.from([code >>> 8, code & 0xff]));
			expect(kanjiCode(char.codePointAt(0)!), code.toString(16)).toBeUndefined();
		}
	});

	it('maps no ASCII and no character twice, and nothing from row 13', async () => {
		const { kanjiCode } = await import('../../src/segment/kanji.js');
		for (let code = 0; code < 0x80; code += 1) expect(kanjiCode(code)).toBeUndefined();
		const whatwg = new TextDecoder('shift_jis');
		const seen = new Map<number, number>();
		for (const code of kanjiRangeCodes()) {
			const char = single(whatwg.decode(Uint8Array.from([code >>> 8, code & 0xff])));
			if (char === undefined || kanjiCode(char) !== code) continue;
			expect(seen.has(char)).toBe(false);
			seen.set(char, code);
			expect(code >>> 8).not.toBe(0x87);
		}
	});

	it('is built on first use, not at import', async () => {
		const real = globalThis.TextDecoder;
		const labels: string[] = [];
		vi.stubGlobal(
			'TextDecoder',
			class extends real {
				constructor(label?: string, options?: TextDecoderOptions) {
					super(label, options);
					labels.push(String(label));
				}
			},
		);
		const kanji = await import('../../src/segment/kanji.js');
		await import('../../src/segment/index.js');
		expect(labels).toEqual([]);
		expect(kanji.kanjiCode('日'.codePointAt(0)!)).toBe(0x93fa);
		expect(labels).toEqual(['shift_jis']);
		expect(kanji.kanjiAvailable()).toBe(true);
		expect(labels).toEqual(['shift_jis']);
	});

	it('is absent where the runtime has no Shift_JIS decoder, and kanji is then never chosen', async () => {
		const real = globalThis.TextDecoder;
		vi.stubGlobal(
			'TextDecoder',
			class extends real {
				constructor(label?: string, options?: TextDecoderOptions) {
					if (String(label).toLowerCase() === 'shift_jis')
						throw new RangeError('not in this build');
					super(label, options);
				}
			},
		);
		const kanji = await import('../../src/segment/kanji.js');
		const { segmentText } = await import('../../src/segment/segment-text.js');
		const { qrProfile } = await import('../../src/segment/profile.js');
		expect(kanji.kanjiAvailable()).toBe(false);
		expect(kanji.kanjiCode('日'.codePointAt(0)!)).toBeUndefined();
		const segments = segmentText('日本語', qrProfile(1), { kanji: 'always', eci: 'auto' });
		expect(segments.map((s) => s.mode)).toEqual(['byte']);
	});
});

describe('kanji values', () => {
	it('round-trip every code in the ranges through the 13-bit value', async () => {
		const { kanjiCodeFromValue, kanjiValue, validKanjiCode } =
			await import('../../src/segment/kanji.js');
		const values = new Set<number>();
		for (const code of kanjiRangeCodes()) {
			expect(validKanjiCode(code)).toBe(true);
			const value = kanjiValue(code);
			expect(value).toBeLessThan(1 << 13);
			expect(kanjiCodeFromValue(value)).toBe(code);
			values.add(value);
		}
		// ISO/IEC 18004 7.4.6's worked example: 0x935F is 0xD9F, 0xE4AA is 0x1AAA.
		expect(kanjiValue(0x935f)).toBe(0xd9f);
		expect(kanjiValue(0xe4aa)).toBe(0x1aaa);
		let invalid = 0;
		for (let value = 0; value < 1 << 13; value += 1) {
			if (!values.has(value)) {
				expect(kanjiCodeFromValue(value)).toBeUndefined();
				invalid += 1;
			}
		}
		expect(invalid).toBeGreaterThan(0);
		expect(validKanjiCode(0x817f)).toBe(false);
		expect(validKanjiCode(0xa040)).toBe(false);
		expect(validKanjiCode(0x8130)).toBe(false);
	});
});
