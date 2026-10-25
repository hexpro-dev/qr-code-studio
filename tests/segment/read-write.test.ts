/**
 * Writing and reading bitstreams: headers, character sets, and every way a
 * stream can break the rules.
 *
 * Character sets are checked against iconv-lite, an independent table, rather
 * than against the TextDecoder the reader itself uses, so a wrong ECI mapping
 * fails here even where the runtime's decoder is right about its own label.
 * ISO-8859-1 is checked byte for byte, because WHATWG's "iso-8859-1" is
 * windows-1252 and reading 0x80 as a euro sign is exactly the slip this
 * guards against.
 */

import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitBuffer } from '../../src/core/bits.js';
import { isQrStudioError } from '../../src/core/errors.js';
import { qrCountGroup, qrProfile } from '../../src/segment/profile.js';
import { readSegments } from '../../src/segment/read.js';
import { segmentText } from '../../src/segment/segment-text.js';
import type { BitstreamProfile, Indicator, Mode, Segment } from '../../src/segment/types.js';
import {
	dataBitLength,
	headerBitLength,
	segmentsBitLength,
	validApplicationIndicator,
	writeSegments,
} from '../../src/segment/write.js';

const require = createRequire(import.meta.url);
const iconv = require('iconv-lite') as {
	decode(bytes: Buffer, encoding: string): string;
	encodingExists(name: string): boolean;
};

const QR1 = qrProfile(1);

/** A stream from (value, width) pairs. */
function stream(...fields: [number, number][]): { bytes: Uint8Array; bits: number } {
	const out = new BitBuffer();
	for (const [value, width] of fields) out.append(value, width);
	return { bytes: out.toBytes(), bits: out.length };
}

function read(fields: [number, number][], profile: BitstreamProfile = QR1) {
	const { bytes, bits } = stream(...fields);
	return readSegments(bytes, bits, profile);
}

function failure(run: () => unknown): { code: string; params: Readonly<Record<string, unknown>> } {
	try {
		run();
	} catch (error) {
		if (isQrStudioError(error)) return { code: error.code, params: error.params };
		// A module re-imported after vi.resetModules has its own error classes.
		if (error instanceof Error && error.name === 'QrStudioError') {
			const { code, params } = error as unknown as {
				code: string;
				params: Record<string, unknown>;
			};
			return { code, params };
		}
		throw error;
	}
	throw new Error('expected a QrStudioError');
}

/** ECI then one byte segment holding `bytes`, version 1. */
function eciBytes(designator: number, bytes: readonly number[]): [number, number][] {
	const eci: [number, number][] =
		designator < 128
			? [[designator, 8]]
			: designator < 16384
				? [[0x8000 | designator, 16]]
				: [[0xc00000 | designator, 24]];
	return [
		[0b0111, 4],
		...eci,
		[0b0100, 4],
		[bytes.length, 8],
		...bytes.map((b): [number, number] => [b, 8]),
	];
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('the QR profile', () => {
	it('has the count widths of ISO/IEC 18004 Table 3 by group', () => {
		const widths = (version: number) =>
			(['numeric', 'alphanumeric', 'byte', 'kanji'] as Mode[]).map((m) =>
				qrProfile(version).charCountBits(m),
			);
		for (const version of [1, 9]) expect(widths(version)).toEqual([10, 9, 8, 8]);
		for (const version of [10, 26]) expect(widths(version)).toEqual([12, 11, 16, 10]);
		for (const version of [27, 40]) expect(widths(version)).toEqual([14, 13, 16, 12]);
		expect(qrProfile(3)).toBe(qrProfile(7));
		expect(qrProfile(9)).not.toBe(qrProfile(10));
	});

	it('has the indicators of Table 2', () => {
		const kinds: Indicator[] = [
			'numeric',
			'alphanumeric',
			'structured-append',
			'byte',
			'fnc1-first',
			'eci',
			'kanji',
			'fnc1-second',
		];
		expect(kinds.map((kind) => QR1.modeIndicator(kind))).toEqual([1, 2, 3, 4, 5, 7, 8, 9]);
		expect([
			QR1.modeIndicatorBits,
			QR1.terminatorBits,
			QR1.eci,
			QR1.fnc1,
			QR1.structuredAppend,
		]).toEqual([4, 4, true, true, true]);
	});

	it('refuses what is not a version or a mode', () => {
		for (const version of [0, 41, 1.5, Number.NaN])
			expect(() => qrCountGroup(version)).toThrow(TypeError);
		expect(() => QR1.charCountBits('ascii' as Mode)).toThrow(TypeError);
	});
});

describe('writeSegments', () => {
	it('writes structured append, then ECI, then FNC1, then the segments', () => {
		const segments = segmentText('A', QR1, { kanji: 'never', eci: 'utf-8' });
		const out = new BitBuffer();
		writeSegments(segments, QR1, out, {
			structuredAppend: { index: 2, total: 5, parity: 0xa5 },
			fnc1: 'gs1',
		});
		const expected = stream(
			[0b0011, 4],
			[2, 4],
			[4, 4],
			[0xa5, 8],
			[0b0111, 4],
			[26, 8],
			[0b0101, 4],
			[0b0010, 4],
			[1, 9],
			[10, 6],
		);
		expect(out.length).toBe(expected.bits);
		expect(out.toBytes()).toEqual(expected.bytes);
		expect(
			headerBitLength({ structuredAppend: { index: 0, total: 1, parity: 0 }, fnc1: 'gs1' }, QR1),
		).toBe(24);
		expect(headerBitLength({ fnc1: { applicationIndicator: 37 } }, QR1)).toBe(12);
		expect(headerBitLength(undefined, QR1)).toBe(0);
		expect(segmentsBitLength(segments, QR1)).toBe(12 + 4 + 9 + 6);
	});

	it('writes an ECI wherever it changes, and counts it', () => {
		const segments: Segment[] = [
			{ mode: 'byte', chars: 1, data: Uint8Array.of(0xe9), eci: 3 },
			{ mode: 'byte', chars: 1, data: Uint8Array.of(0xe9), eci: 3 },
			{ mode: 'byte', chars: 2, data: Uint8Array.of(0xc3, 0xa9), eci: 26 },
			{ mode: 'numeric', chars: 1, data: Uint8Array.of(0x37) },
		];
		const out = new BitBuffer();
		writeSegments(segments, QR1, out);
		expect(out.length).toBe(segmentsBitLength(segments, QR1));
		expect(out.length).toBe(12 + 3 * 12 + 2 * 8 + 12 + 16 + 4 + 10 + 4);
		const decoded = readSegments(out.toBytes(), out.length, QR1);
		expect(decoded.text).toBe('ééé7');
		expect(decoded.textSource).toBe('eci-3');
		expect(decoded.segments.map((s) => s.eci)).toEqual([3, 3, 26, 26]);
	});

	it('writes two and three byte ECI designators', () => {
		for (const [eci, bits] of [
			[899, 16],
			[100000, 24],
		] as const) {
			const segments: Segment[] = [{ mode: 'byte', chars: 1, data: Uint8Array.of(0x41), eci }];
			const out = new BitBuffer();
			writeSegments(segments, QR1, out);
			expect(out.length).toBe(4 + bits + 20);
			expect(segmentsBitLength(segments, QR1)).toBe(out.length);
		}
		const out = new BitBuffer();
		writeSegments([{ mode: 'byte', chars: 1, data: Uint8Array.of(0xe9), eci: 899 }], QR1, out);
		expect(readSegments(out.toBytes(), out.length, QR1)).toMatchObject({
			text: 'é',
			textSource: 'eci-899',
		});
	});

	it('writes FNC1 in second position with its application indicator', () => {
		const out = new BitBuffer();
		writeSegments([{ mode: 'numeric', chars: 1, data: Uint8Array.of(0x31) }], QR1, out, {
			fnc1: { applicationIndicator: 197 },
		});
		const decoded = readSegments(out.toBytes(), out.length, QR1);
		expect(decoded.fnc1).toEqual({ applicationIndicator: 197 });
		expect(decoded.text).toBe('1');
		expect([0, 99, 165, 190, 197, 222].every(validApplicationIndicator)).toBe(true);
		expect([-1, 100, 164, 191, 196, 223, 1.5].some(validApplicationIndicator)).toBe(false);
	});

	it('refuses what a caller should never pass', () => {
		const write =
			(segments: Segment[], header = {}, profile = QR1) =>
			() =>
				writeSegments(segments, profile, new BitBuffer(), header);
		const digit = { mode: 'numeric', chars: 1, data: Uint8Array.of(0x31) } as const;
		expect(write([digit], { structuredAppend: { index: 0, total: 17, parity: 0 } })).toThrow(
			RangeError,
		);
		expect(write([digit], { structuredAppend: { index: 3, total: 3, parity: 0 } })).toThrow(
			RangeError,
		);
		expect(write([digit], { structuredAppend: { index: 0, total: 2, parity: 256 } })).toThrow(
			RangeError,
		);
		expect(write([digit], { fnc1: { applicationIndicator: 120 } })).toThrow(RangeError);
		const bare: BitstreamProfile = {
			...QR1,
			eci: false,
			fnc1: false,
			structuredAppend: false,
			modes: ['numeric'],
		};
		expect(write([digit], { structuredAppend: { index: 0, total: 2, parity: 0 } }, bare)).toThrow(
			TypeError,
		);
		expect(write([digit], { fnc1: 'gs1' }, bare)).toThrow(TypeError);
		expect(write([{ ...digit, eci: 26 }], {}, bare)).toThrow(TypeError);
		expect(write([{ mode: 'byte', chars: 1, data: Uint8Array.of(1) }], {}, bare)).toThrow(
			TypeError,
		);
		expect(
			write([{ mode: 'numeric', chars: 1024, data: new Uint8Array(1024).fill(0x30) }]),
		).toThrow(RangeError);
		expect(write([{ mode: 'numeric', chars: 2, data: Uint8Array.of(0x31) }])).toThrow(RangeError);
		expect(write([{ mode: 'numeric', chars: 1, data: Uint8Array.of(0x41) }])).toThrow(RangeError);
		expect(write([{ mode: 'alphanumeric', chars: 1, data: Uint8Array.of(0x61) }])).toThrow(
			RangeError,
		);
		expect(write([{ mode: 'alphanumeric', chars: 1, data: Uint8Array.of(0xc1) }])).toThrow(
			RangeError,
		);
		expect(write([{ mode: 'kanji', chars: 1, data: Uint8Array.of(0x81, 0x7f) }])).toThrow(
			RangeError,
		);
		const noIndicator: BitstreamProfile = { ...QR1, modeIndicator: () => undefined };
		expect(write([digit], {}, noIndicator)).toThrow(TypeError);
		expect(() => dataBitLength('ascii' as Mode, 1)).toThrow(TypeError);
		expect(() =>
			segmentsBitLength([{ mode: 'byte', chars: 1, data: Uint8Array.of(1), eci: 1_000_000 }], QR1),
		).toThrow(TypeError);
	});
});

describe('readSegments: character sets', () => {
	// Every byte from 0x80 up, plus some ASCII, so each table is exercised
	// where the character sets differ.
	const HIGH = [0x41, ...Array.from({ length: 128 }, (_, i) => 0x80 + i)];

	it('reads each single-byte ECI as iconv-lite does', () => {
		const sets: [number, string][] = [
			[0, 'cp437'],
			[2, 'cp437'],
			[4, 'iso-8859-2'],
			[5, 'iso-8859-3'],
			[6, 'iso-8859-4'],
			[7, 'iso-8859-5'],
			[8, 'iso-8859-6'],
			[10, 'iso-8859-8'],
			[12, 'iso-8859-10'],
			[15, 'iso-8859-13'],
			[16, 'iso-8859-14'],
			[17, 'iso-8859-15'],
			[18, 'iso-8859-16'],
			[21, 'windows-1250'],
			[22, 'windows-1251'],
			[23, 'windows-1252'],
			[24, 'windows-1256'],
		];
		for (const [designator, name] of sets) {
			const decoded = read(eciBytes(designator, HIGH));
			const expected = iconv.decode(Buffer.from(HIGH), name);
			// Positions iconv leaves undefined, WHATWG fills with U+FFFD or a C1
			// control; compare where iconv has a character.
			const ours = [...decoded.text];
			[...expected].forEach((char, i) => {
				if (char !== '�' && char !== '�')
					expect(ours[i], `ECI ${designator} byte ${HIGH[i]}`).toBe(char);
			});
			expect(decoded.textSource).toBe(`eci-${designator}`);
		}
	});

	it('reads ISO-8859-1 as byte equals code point, never as windows-1252', () => {
		for (const designator of [1, 3, 899]) {
			const decoded = read(eciBytes(designator, HIGH));
			expect(decoded.text).toBe(String.fromCharCode(...HIGH));
		}
		expect(read(eciBytes(27, [0x41, 0x80])).text).toBe('A�');
		expect(read(eciBytes(170, [0x41, 0x80])).text).toBe('A�');
	});

	it('reads the multi-byte ECIs', () => {
		const cases: [number, string, number[]][] = [
			[20, 'shift_jis', [0x93, 0xfa, 0x96, 0x7b]],
			[25, 'utf-16be', [0x65, 0xe5, 0x00, 0x41]],
			[26, 'utf-8', [0xc3, 0xa9, 0xe2, 0x82, 0xac]],
			[28, 'big5', [0xa4, 0xa4, 0xa4, 0xe5]],
			[29, 'gbk', [0xd6, 0xd0, 0xce, 0xc4]],
			[30, 'euc-kr', [0xc7, 0xd1, 0xb1, 0xdb]],
			[31, 'gbk', [0xd6, 0xd0]],
			[32, 'gb18030', [0x81, 0x30, 0x81, 0x30]],
			[33, 'utf-16le', [0xe5, 0x65]],
		];
		for (const [designator, name, bytes] of cases) {
			expect(read(eciBytes(designator, bytes)).text, `ECI ${designator}`).toBe(
				iconv.decode(Buffer.from(bytes), name),
			);
		}
		// The byte order mark is content, and is kept.
		expect(read(eciBytes(26, [0xef, 0xbb, 0xbf, 0x41])).text).toBe('﻿A');
		// Decoding under a declared set is not fatal.
		expect(read(eciBytes(26, [0xff])).text).toBe('�');
		expect(read(eciBytes(9, [0xe1])).text).toBe('α');
		expect(read(eciBytes(11, [0xd0])).text).toBe('Ğ');
		expect(read(eciBytes(13, [0xa1])).text).toBe('ก');
	});

	it('reads two and three byte designators', () => {
		expect(read(eciBytes(899, [0x41])).segments[0]?.eci).toBe(899);
		const big = failure(() => read(eciBytes(100000, [0x41])));
		expect(big).toEqual({
			code: 'decode/unsupported',
			params: { stage: 'segments', feature: 'eci', eci: 100000 },
		});
	});

	it('refuses a designator it has no decoder for, rather than guessing', () => {
		for (const designator of [14, 19, 34, 99, 900]) {
			expect(failure(() => read(eciBytes(designator, [0x41])))).toEqual({
				code: 'decode/unsupported',
				params: { stage: 'segments', feature: 'eci', eci: designator },
			});
		}
		// An ECI with nothing after it decodes nothing, so needs no decoder.
		expect(
			read([
				[0b0111, 4],
				[99, 8],
			]).text,
		).toBe('');
	});

	it('tries strict UTF-8 first and ISO-8859-1 for everything when that fails', () => {
		const utf8 = segmentText('Café', QR1);
		const out = new BitBuffer();
		writeSegments(utf8, QR1, out);
		expect(readSegments(out.toBytes(), out.length, QR1)).toMatchObject({
			text: 'Café',
			textSource: 'utf-8',
		});
		const latin = read([
			[0b0100, 4],
			[2, 8],
			[0x41, 8],
			[0xe9, 8],
			[0b1000, 4],
			[1, 8],
			[0xd9f, 13],
			[0b0100, 4],
			[2, 8],
			[0xc3, 8],
			[0xa9, 8],
		]);
		// One run is not UTF-8, so every ECI-less run is read as ISO-8859-1,
		// and the kanji between them as Shift_JIS.
		expect(latin.text).toBe('Aé点Ã©');
		expect(latin.textSource).toBe('latin1-fallback');
		expect(latin.bytes).toEqual(Uint8Array.of(0x41, 0xe9, 0x93, 0x5f, 0xc3, 0xa9));
	});

	it('names Shift_JIS as the source when kanji carries the only non-ASCII text', () => {
		const decoded = read([
			[0b1000, 4],
			[2, 8],
			[0xd9f, 13],
			[0x1aaa, 13],
		]);
		expect(decoded).toMatchObject({ text: '点茗', textSource: 'shift-jis' });
	});

	it('refuses kanji, and ECI 20, where the runtime has no Shift_JIS decoder', async () => {
		const real = globalThis.TextDecoder;
		vi.stubGlobal(
			'TextDecoder',
			class extends real {
				constructor(label?: string, options?: TextDecoderOptions) {
					if (String(label) === 'shift_jis') throw new RangeError('not in this build');
					super(label, options);
				}
			},
		);
		const fresh = await import('../../src/segment/read.js');
		const kanji = stream([0b1000, 4], [1, 8], [0xd9f, 13]);
		expect(failure(() => fresh.readSegments(kanji.bytes, kanji.bits, QR1))).toEqual({
			code: 'decode/unsupported',
			params: { stage: 'segments', feature: 'kanji' },
		});
		const eci = stream(...eciBytes(20, [0x93, 0xfa]));
		expect(failure(() => fresh.readSegments(eci.bytes, eci.bits, QR1)).params).toEqual({
			stage: 'segments',
			feature: 'eci',
			eci: 20,
		});
	});
});

describe('readSegments: headers', () => {
	it('reads structured append, only first', () => {
		const decoded = read([
			[0b0011, 4],
			[3, 4],
			[15, 4],
			[0x5a, 8],
			[0b0001, 4],
			[1, 10],
			[7, 4],
		]);
		expect(decoded.structuredAppend).toEqual({ index: 3, total: 16, parity: 0x5a });
		expect(decoded.text).toBe('7');
		const late = failure(() =>
			read([
				[0b0001, 4],
				[1, 10],
				[7, 4],
				[0b0011, 4],
				[0, 4],
				[1, 4],
				[0, 8],
			]),
		);
		expect(late).toEqual({ code: 'decode/unreadable', params: { stage: 'segments' } });
		expect(
			failure(() =>
				read([
					[0b0011, 4],
					[2, 4],
					[1, 4],
					[0, 8],
				]),
			).code,
		).toBe('decode/unreadable');
	});

	it('reads FNC1 once, before data, and turns % back into GS', () => {
		// "%" is GS, "%%" a literal percent, within the segment.
		// A, %, %, %, B as alphanumeric values.
		const chars = [10, 38, 38, 38, 11];
		const pairs: [number, number][] = [
			[chars[0]! * 45 + chars[1]!, 11],
			[chars[2]! * 45 + chars[3]!, 11],
			[chars[4]!, 6],
		];
		const decoded = read([[0b0101, 4], [0b0010, 4], [5, 9], ...pairs]);
		expect(decoded.fnc1).toBe('gs1');
		expect(decoded.text).toBe('A%\u001dB');
		expect(decoded.bytes).toEqual(Uint8Array.of(0x41, 0x25, 0x1d, 0x42));
		// Without FNC1 the same characters are just percent signs.
		expect(read([[0b0010, 4], [5, 9], ...pairs]).text).toBe('A%%%B');
		expect(
			failure(() =>
				read([
					[0b0001, 4],
					[1, 10],
					[7, 4],
					[0b0101, 4],
				]),
			).code,
		).toBe('decode/unreadable');
		expect(
			failure(() =>
				read([
					[0b0101, 4],
					[0b1001, 4],
					[37, 8],
				]),
			).code,
		).toBe('decode/unreadable');
	});
});

describe('readSegments: malformed streams', () => {
	const cases: [string, [number, number][]][] = [
		[
			'a numeric group above 999',
			[
				[0b0001, 4],
				[3, 10],
				[1000, 10],
			],
		],
		[
			'a numeric pair above 99',
			[
				[0b0001, 4],
				[2, 10],
				[100, 7],
			],
		],
		[
			'a numeric digit above 9',
			[
				[0b0001, 4],
				[1, 10],
				[10, 4],
			],
		],
		[
			'an alphanumeric pair past 45 squared',
			[
				[0b0010, 4],
				[2, 9],
				[2025, 11],
			],
		],
		[
			'an alphanumeric character past 44',
			[
				[0b0010, 4],
				[1, 9],
				[45, 6],
			],
		],
		[
			'a count past the end',
			[
				[0b0100, 4],
				[3, 8],
				[0x41, 8],
			],
		],
		[
			'a count field cut short',
			[
				[0b0100, 4],
				[3, 5],
			],
		],
		[
			'an unassigned mode',
			[
				[0b0110, 4],
				[0, 8],
			],
		],
		// 5949 is offset 0x1EBD, which would be 0x9FFD, past the first range.
		[
			'a kanji value outside the ranges',
			[
				[0b1000, 4],
				[1, 8],
				[5949, 13],
			],
		],
		[
			'an ECI designator with a bad prefix',
			[
				[0b0111, 4],
				[0xe0, 8],
			],
		],
		[
			'an ECI designator past 999999',
			[
				[0b0111, 4],
				[0xdfffff, 24],
			],
		],
		[
			'an ECI designator cut short',
			[
				[0b0111, 4],
				[0x80, 8],
			],
		],
	];
	for (const [what, fields] of cases) {
		it(`refuses ${what}`, () => {
			expect(failure(() => read(fields))).toEqual({
				code: 'decode/unreadable',
				params: { stage: 'segments' },
			});
		});
	}

	it('ends at the terminator, or at fewer bits than an indicator', () => {
		expect(
			read([
				[0b0001, 4],
				[1, 10],
				[7, 4],
				[0, 4],
				[0xec, 8],
			]).text,
		).toBe('7');
		expect(
			read([
				[0b0001, 4],
				[1, 10],
				[7, 4],
				[0, 3],
			]).text,
		).toBe('7');
		expect(read([]).text).toBe('');
		expect(() => readSegments(new Uint8Array(1), 9, QR1)).toThrow(RangeError);
		expect(() => readSegments([1] as unknown as Uint8Array, 8, QR1)).toThrow(TypeError);
	});

	it('finds the end by its run of zeros where the terminator is longer than an indicator', () => {
		// Shaped like Micro QR M4: 3-bit indicators where numeric is 000, and a
		// 9-bit terminator.
		const m4: BitstreamProfile = {
			modes: ['numeric', 'alphanumeric', 'byte', 'kanji'],
			modeIndicatorBits: 3,
			modeIndicator: (kind) => ({ numeric: 0, alphanumeric: 1, byte: 2, kanji: 3 })[kind as Mode],
			charCountBits: (mode) => ({ numeric: 6, alphanumeric: 5, byte: 5, kanji: 4 })[mode],
			terminatorBits: 9,
			eci: false,
			fnc1: false,
			structuredAppend: false,
		};
		const decoded = read(
			[
				[0, 3],
				[2, 6],
				[12, 7],
				[1, 3],
				[1, 5],
				[10, 6],
				[0, 9],
			],
			m4,
		);
		expect(decoded.text).toBe('12A');
		expect(decoded.segments.map((s) => s.mode)).toEqual(['numeric', 'alphanumeric']);
		// ECI's indicator is meaningless to a profile without ECI.
		expect(
			failure(() =>
				read(
					[
						[0b100, 3],
						[0, 8],
					],
					m4,
				),
			).code,
		).toBe('decode/unreadable');
	});
});
