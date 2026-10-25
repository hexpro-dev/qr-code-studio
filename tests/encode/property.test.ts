/**
 * Encoding then reading is the identity, for any text and any bytes.
 *
 * fast-check draws strings over the whole of Unicode (every code point, with
 * surrogate pairs but never half of one), with a bias toward the characters
 * that change segmentation: digits, capitals, kanji with and without codes,
 * GS under FNC1. Options are drawn too, so every policy meets every kind of
 * content.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encode } from '../../src/encode/encode.js';
import { encodeStructuredAppend } from '../../src/encode/structured-append.js';
import { readBack } from './helpers.js';

const biased = fc.oneof(
	{ weight: 3, arbitrary: fc.string({ unit: 'binary', maxLength: 120 }) },
	{
		weight: 2,
		arbitrary: fc.string({
			unit: fc.constantFrom(
				'0',
				'9',
				'A',
				'Z',
				' ',
				'%',
				'a',
				'é',
				'日',
				'語',
				'～',
				'\\',
				'😀',
				'\u0000',
				'\ufeff',
			),
			maxLength: 200,
		}),
	},
);

const options = fc.record({
	ecLevel: fc.constantFrom('L', 'M', 'Q', 'H' as const),
	segmentation: fc.record({
		kanji: fc.constantFrom('never', 'when-smaller', 'always' as const),
		eci: fc.constantFrom('auto', 'never', 'utf-8' as const),
	}),
	mask: fc.oneof(fc.constant('auto' as const), fc.integer({ min: 0, max: 7 })),
	boostEc: fc.boolean(),
});

describe('encode then read', () => {
	it('gives back any text', () => {
		fc.assert(
			fc.property(biased, options, (text, chosen) => {
				const symbol = encode(text, chosen);
				const read = readBack(symbol);
				expect(read.bitstream.text).toBe(text);
				expect(read.ecLevel).toBe(symbol.ecLevel);
			}),
			{ numRuns: 400, seed: 0x7e57 },
		);
	});

	it('gives back any bytes', () => {
		fc.assert(
			fc.property(
				fc.uint8Array({ maxLength: 300 }),
				fc.constantFrom('L', 'M', 'Q', 'H' as const),
				(bytes, ecLevel) => {
					expect(readBack(encode(bytes, { ecLevel })).bitstream.bytes).toEqual(bytes);
				},
			),
			{ numRuns: 200, seed: 0xb7e5 },
		);
	});

	it('gives back GS1 text with any mix of separators and percent signs', () => {
		fc.assert(
			fc.property(
				fc.string({ unit: fc.constantFrom('0', '1', 'A', '%', '\u001d', '-', 'x'), maxLength: 80 }),
				(text) => {
					const read = readBack(encode(text, { fnc1: 'gs1' }));
					expect(read.bitstream.text).toBe(text);
					expect(read.bitstream.fnc1).toBe('gs1');
				},
			),
			{ numRuns: 300, seed: 0x651 },
		);
	});

	it('gives back any text split over a structured append set', () => {
		fc.assert(
			fc.property(
				fc.string({ unit: 'binary', minLength: 1, maxLength: 400 }),
				fc.integer({ min: 2, max: 6 }),
				(text, version) => {
					let set;
					try {
						set = encodeStructuredAppend(text, { maxVersion: String(version), ecLevel: 'M' });
					} catch {
						// Past 16 symbols at this version: the refusal is tested elsewhere.
						return;
					}
					const reads = set.map((symbol) => readBack(symbol).bitstream);
					expect(reads.map((r) => r.text).join('')).toBe(text);
					const parities = new Set(reads.map((r) => r.structuredAppend?.parity ?? -1));
					expect(parities.size).toBe(1);
				},
			),
			{ numRuns: 120, seed: 0x5a5a },
		);
	});
});
