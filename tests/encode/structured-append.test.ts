/**
 * encodeStructuredAppend: the fewest symbols, all one size, balanced, with
 * the parity of the whole message, and no character ever cut in two.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { TooMuchDataError, isQrStudioError } from '../../src/core/errors.js';
import { encodeStructuredAppend } from '../../src/encode/structured-append.js';
import type { BitstreamProfile } from '../../src/segment/types.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';
import { cached, fakeRegistry, readBack } from './helpers.js';

const require = createRequire(import.meta.url);
const iconv = require('iconv-lite') as { encode(text: string, encoding: string): Buffer };

function xor(bytes: Iterable<number>): number {
	let parity = 0;
	for (const byte of bytes) parity ^= byte;
	return parity;
}

function readSet(set: readonly BuiltSymbol[]) {
	return set.map((symbol) => readBack(symbol).bitstream);
}

describe('encodeStructuredAppend', () => {
	it('returns one plain symbol when the message fits one', () => {
		const set = encodeStructuredAppend('short');
		expect(set).toHaveLength(1);
		expect(readBack(set[0]!).bitstream.structuredAppend).toBeNull();
	});

	it('splits over the fewest symbols, all one version, balanced, with the parity of every byte', () => {
		const text = 'Example Network, synthetic content for a split. '.repeat(20);
		const set = encodeStructuredAppend(text, { maxVersion: '8', ecLevel: 'Q' });
		const reads = readSet(set);
		expect(new Set(set.map((s) => s.version)).size).toBe(1);
		const parity = xor(new TextEncoder().encode(text));
		reads.forEach((read, index) => {
			expect(read.structuredAppend).toEqual({ index, total: set.length, parity });
		});
		expect(reads.map((r) => r.text).join('')).toBe(text);
		// The fewest: one fewer would not hold it even at the largest allowed.
		expect(() =>
			encodeStructuredAppend(text, { maxVersion: '8', ecLevel: 'Q', maxSymbols: set.length - 1 }),
		).toThrow(TooMuchDataError);
		// The smallest version for that many: one version down needs more.
		const version = Number(set[0]!.version);
		expect(
			encodeStructuredAppend(text, {
				maxVersion: String(version - 1),
				ecLevel: 'Q',
				maxSymbols: 16,
			}).length,
		).toBeGreaterThan(set.length);
		// Balanced: no part is much shorter than the longest.
		const lengths = reads.map((r) => r.text.length);
		expect(Math.min(...lengths)).toBeGreaterThan(Math.max(...lengths) * 0.9);
	});

	it('never cuts a UTF-8 sequence or a kanji pair, and decides kanji once for the whole set', () => {
		const text = '😀é日本語'.repeat(60);
		for (const kanji of ['never', 'always'] as const) {
			const set = encodeStructuredAppend(text, { maxVersion: '5', segmentation: { kanji } });
			expect(set.length).toBeGreaterThan(2);
			const reads = readSet(set);
			for (const read of reads) {
				expect(read.text).not.toContain('�');
				// Each part is whole text on its own.
				expect([...read.text].every((char) => '😀é日本語'.includes(char))).toBe(true);
			}
			expect(reads.map((r) => r.text).join('')).toBe(text);
			// 😀 and é have no kanji code, so even 'always' leaves this as UTF-8.
			expect(new Set(reads.map((r) => r.textSource))).toEqual(new Set(['utf-8']));
		}
		const kanjiText = '日本語の文章'.repeat(50);
		const set = encodeStructuredAppend(kanjiText, {
			maxVersion: '4',
			segmentation: { kanji: 'always' },
		});
		const reads = readSet(set);
		expect(new Set(reads.map((r) => r.textSource))).toEqual(new Set(['shift-jis']));
		// Under kanji the parity is taken over the Shift_JIS bytes.
		expect(reads[0]!.structuredAppend?.parity).toBe(xor(iconv.encode(kanjiText, 'shift_jis')));
		expect(reads.map((r) => r.text).join('')).toBe(kanjiText);
	});

	it('splits bytes, with FNC1 and ECI in every symbol', () => {
		const bytes = Uint8Array.from({ length: 600 }, (_, i) => (i * 37) & 0xff);
		const set = encodeStructuredAppend(bytes, { maxVersion: '6', ecLevel: 'L' });
		const reads = readSet(set);
		expect(reads.flatMap((r) => [...r.bytes])).toEqual([...bytes]);
		expect(reads[0]!.structuredAppend?.parity).toBe(xor(bytes));

		const gs1 = '0103453120000011\u001d10ABC'.repeat(12);
		const gs1Reads = readSet(encodeStructuredAppend(gs1, { maxVersion: '3', fnc1: 'gs1' }));
		expect(gs1Reads.every((r) => r.fnc1 === 'gs1')).toBe(true);
		expect(gs1Reads.map((r) => r.text).join('')).toBe(gs1);

		const declared = readSet(
			encodeStructuredAppend('Café '.repeat(40), {
				maxVersion: '3',
				segmentation: { eci: 'utf-8' },
			}),
		);
		expect(declared.every((r) => r.textSource === 'eci-26')).toBe(true);
	});

	it('stops at 16 symbols, or fewer when asked', () => {
		expect(
			encodeStructuredAppend('9'.repeat(41 * 16 - 120), { maxVersion: '1', ecLevel: 'L' }),
		).toHaveLength(16);
		const error = (() => {
			try {
				encodeStructuredAppend('9'.repeat(41 * 17), { maxVersion: '1', ecLevel: 'L' });
			} catch (caught) {
				return caught;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(TooMuchDataError);
		expect((error as TooMuchDataError).bitsAvailable).toBe(16 * 152);
		// A character that cannot fit even an otherwise empty symbol: 1-H holds
		// 72 bits, the headers take 36 of them, and an emoji needs 44.
		expect(() =>
			encodeStructuredAppend('😀😀', {
				maxVersion: '1',
				ecLevel: 'H',
				fnc1: 'gs1',
				segmentation: { eci: 'utf-8' },
			}),
		).toThrow(TooMuchDataError);
		for (const maxSymbols of [0, 17, 2.5]) {
			expect(() => encodeStructuredAppend('a', { maxSymbols })).toThrow(TypeError);
		}
	});

	it('refuses a symbology without structured append', () => {
		const bare = cached((profile: BitstreamProfile) => ({ ...profile, structuredAppend: false }));
		const registry = fakeRegistry([{ name: 'one', qr: '2', width: 25, height: 25, profile: bare }]);
		try {
			encodeStructuredAppend('a', { symbology: 'fake' }, registry);
			expect.unreachable();
		} catch (error) {
			expect(isQrStudioError(error) && error.params).toEqual({ feature: 'structured-append' });
		}
		expect(() => encodeStructuredAppend(7 as unknown as string)).toThrow(TypeError);
	});
});
