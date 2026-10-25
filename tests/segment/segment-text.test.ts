/**
 * Segmentation is optimal, checked against a search that tries everything.
 *
 * The dynamic programme in `src/segment/segment-text.ts` claims the fewest
 * bits for any content. The claim rests on an argument (costs in sixths,
 * keeping only the cheapest partial solution per mode), and an argument with
 * a hole in it still produces valid symbols, just occasionally a version too
 * large. So the test does not trust it: for every string of up to eight
 * characters over an alphabet that reaches every mode, in each of the three
 * count groups, it enumerates every assignment of a mode to every character,
 * prices each with ISO/IEC 18004's formulas written out again here, and
 * requires the segmenter to match the cheapest. The costs here are written
 * independently of `src/segment/write.ts` on purpose.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BitBuffer } from '../../src/core/bits.js';
import { isQrStudioError } from '../../src/core/errors.js';
import { qrCountGroup, qrProfile } from '../../src/segment/profile.js';
import { readSegments } from '../../src/segment/read.js';
import {
	DEFAULT_SEGMENTATION,
	fittingPrefix,
	segmentBytes,
	segmentText,
} from '../../src/segment/segment-text.js';
import type { BitstreamProfile, Mode, Segment } from '../../src/segment/types.js';
import { segmentsBitLength, writeSegments } from '../../src/segment/write.js';

/** ISO/IEC 18004 Table 3, by group. */
const COUNT_BITS: Record<Mode, readonly [number, number, number]> = {
	numeric: [10, 12, 14],
	alphanumeric: [9, 11, 13],
	byte: [8, 16, 16],
	kanji: [8, 10, 12],
};

function bodyBits(mode: Mode, chars: number): number {
	if (mode === 'numeric') return 10 * Math.floor(chars / 3) + [0, 4, 7][chars % 3]!;
	if (mode === 'alphanumeric') return 11 * Math.floor(chars / 2) + 6 * (chars % 2);
	if (mode === 'byte') return 8 * chars;
	return 13 * chars;
}

/** What one character costs in a mode: characters of that mode it takes, or undefined. */
type Options = ReadonlyMap<Mode, number>;

function options(char: string, kanji: boolean, fnc1: boolean): Options {
	const out = new Map<Mode, number>();
	const code = char.codePointAt(0)!;
	if (code >= 0x30 && code <= 0x39) out.set('numeric', 1);
	if (fnc1 && code === 0x1d) out.set('alphanumeric', 1);
	else if ('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'.includes(char)) {
		out.set('alphanumeric', fnc1 && char === '%' ? 2 : 1);
	}
	if (code < 0x80 || !kanji) out.set('byte', new TextEncoder().encode(char).length);
	if (code >= 0x80 && kanji) out.set('kanji', 1);
	return out;
}

/**
 * The cheapest total over every way of cutting the text into segments, by
 * exhaustive recursion: each character picks a mode and, when it shares the
 * previous character's mode, whether to start a new segment anyway. That
 * second choice only ever pays under FNC1, where a GS (written `%`) followed
 * in one alphanumeric segment by a GS or a `%` would read back wrongly, so
 * those segments are refused as invalid rather than priced.
 */
function bruteForce(
	chars: readonly string[],
	group: 0 | 1 | 2,
	kanji: boolean,
	fnc1: boolean,
): number {
	const per = chars.map((char) => options(char, kanji, fnc1));
	const close = (mode: Mode | null, run: number): number =>
		mode === null ? 0 : 4 + COUNT_BITS[mode][group] + bodyBits(mode, run);
	let best = Infinity;
	const walk = (
		i: number,
		mode: Mode | null,
		run: number,
		cost: number,
		afterGs: boolean,
	): void => {
		if (i === chars.length) {
			best = Math.min(best, cost + close(mode, run));
			return;
		}
		const char = chars[i]!;
		const gs = fnc1 && char === '\u001d';
		for (const [next, take] of per[i]!) {
			const fresh = cost + close(mode, run);
			const afterThis = next === 'alphanumeric' && gs;
			if (next === mode) {
				const ambiguous = afterGs && (gs || char === '%');
				if (!ambiguous) walk(i + 1, mode, run + take, cost, afterThis);
				if (fnc1 && mode === 'alphanumeric') walk(i + 1, next, take, fresh, afterThis);
			} else {
				walk(i + 1, next, take, fresh, afterThis);
			}
		}
	};
	walk(0, null, 0, 0, false);
	return best;
}

function* strings(alphabet: readonly string[], maxLength: number): Generator<string[]> {
	for (let length = 0; length <= maxLength; length += 1) {
		const indexes = new Array<number>(length).fill(0);
		for (;;) {
			yield indexes.map((i) => alphabet[i]!);
			let k = length - 1;
			while (k >= 0 && indexes[k] === alphabet.length - 1) {
				indexes[k] = 0;
				k -= 1;
			}
			if (k < 0) break;
			indexes[k]! += 1;
		}
	}
}

const GROUP_VERSIONS = [1, 10, 27] as const;

function roundTrip(segments: readonly Segment[], profile: BitstreamProfile, fnc1: boolean): string {
	const out = new BitBuffer();
	writeSegments(segments, profile, out, fnc1 ? { fnc1: 'gs1' } : {});
	return readSegments(out.toBytes(), out.length, profile).text;
}

describe('segmentText against exhaustive search', () => {
	// Digit (numeric, alphanumeric or byte), letter (alphanumeric or byte),
	// lower case (byte only) and a kanji (kanji, or three bytes of UTF-8).
	const ALPHABET = ['0', 'A', 'a', '日'];

	for (const version of GROUP_VERSIONS) {
		it(`is optimal for every string of up to 8 characters in count group ${qrCountGroup(version)}`, () => {
			const profile = qrProfile(version);
			const group = qrCountGroup(version);
			let checked = 0;
			for (const chars of strings(ALPHABET, 8)) {
				const text = chars.join('');
				const never = segmentText(text, profile, { kanji: 'never', eci: 'auto' });
				expect(segmentsBitLength(never, profile), text).toBe(
					bruteForce(chars, group, false, false),
				);
				if (chars.includes('日')) {
					const always = segmentText(text, profile, { kanji: 'always', eci: 'auto' });
					const kanjiBits = bruteForce(chars, group, true, false);
					expect(segmentsBitLength(always, profile), text).toBe(kanjiBits);
					const smaller = segmentText(text, profile, { kanji: 'when-smaller', eci: 'auto' });
					expect(segmentsBitLength(smaller, profile), text).toBe(
						Math.min(kanjiBits, segmentsBitLength(never, profile)),
					);
				}
				if (checked % 11 === 0) expect(roundTrip(never, profile, false)).toBe(text);
				checked += 1;
			}
			expect(checked).toBe((Math.pow(4, 9) - 1) / 3);
		});
	}

	it('is optimal under FNC1, where % costs two alphanumeric characters and GS one', () => {
		const alphabet = ['0', '%', '\u001d', 'a'];
		for (const version of GROUP_VERSIONS) {
			const profile = qrProfile(version);
			for (const chars of strings(alphabet, 7)) {
				const text = chars.join('');
				const segments = segmentText(text, profile, DEFAULT_SEGMENTATION, { fnc1: true });
				expect(segmentsBitLength(segments, profile), text).toBe(
					bruteForce(chars, qrCountGroup(version), false, true),
				);
				expect(roundTrip(segments, profile, true), text).toBe(text);
			}
		}
	});
});

describe('segmentText', () => {
	const profile = qrProfile(1);

	it('mixes modes where that is cheaper and keeps one segment where it is not', () => {
		const modes = (text: string): string[] =>
			segmentText(text, profile).map((segment) => `${segment.mode}:${segment.chars}`);
		expect(modes('ABC123456789')).toEqual(['alphanumeric:3', 'numeric:9']);
		expect(modes('A1B2')).toEqual(['alphanumeric:4']);
		expect(modes('')).toEqual([]);
	});

	it('uses kanji only when every character outside ASCII has a code, and never beside non-ASCII bytes', () => {
		const always = { kanji: 'always', eci: 'auto' } as const;
		expect(segmentText('日本語', profile, always).map((s) => s.mode)).toEqual(['kanji']);
		// é has no Shift_JIS code, so the whole text goes into UTF-8 rather than
		// mixing kanji with a non-ASCII byte segment.
		expect(segmentText('日本é', profile, always).map((s) => s.mode)).toEqual(['byte']);
		expect(
			segmentText('日本語', profile, { kanji: 'never', eci: 'auto' }).map((s) => s.mode),
		).toEqual(['byte']);
	});

	it('never leaves a GS before a GS or a % in one alphanumeric segment', () => {
		// GS GS as "%%" would read back as one literal %.
		for (const text of ['\u001d\u001d', '\u001d%', 'A\u001d%B', '\u001d\u001d\u001d']) {
			const segments = segmentText(text, profile, DEFAULT_SEGMENTATION, { fnc1: true });
			expect(roundTrip(segments, profile, true), JSON.stringify(text)).toBe(text);
		}
		// A literal % before a GS is fine: "%%%" reads as % then GS.
		const fine = segmentText('AB%\u001d', profile, DEFAULT_SEGMENTATION, { fnc1: true });
		expect(fine.map((s) => [s.mode, s.chars])).toEqual([['alphanumeric', 5]]);
		expect(roundTrip(fine, profile, true)).toBe('AB%\u001d');
	});

	it('prefers no kanji on a tie under when-smaller', () => {
		// One kanji alone: 4 + 8 + 13 = 25 bits as kanji, 4 + 8 + 24 = 36 as UTF-8,
		// so kanji wins; after ASCII bytes, switching costs a header (12 + 13 = 25)
		// against 24 for three more bytes, so bytes win and kanji is left out.
		expect(segmentText('日', profile).map((s) => s.mode)).toEqual(['kanji']);
		expect(segmentText('ab日', profile).map((s) => s.mode)).toEqual(['byte']);
	});

	it('writes ECI 26 on every segment under the utf-8 policy and none otherwise', () => {
		const utf8 = segmentText('A1', profile, { kanji: 'never', eci: 'utf-8' });
		expect(utf8.every((segment) => segment.eci === 26)).toBe(true);
		expect(segmentText('é', profile, { kanji: 'never', eci: 'auto' })[0]?.eci).toBeUndefined();
		expect(segmentText('é', profile, { kanji: 'never', eci: 'never' })[0]?.eci).toBeUndefined();
	});

	it('refuses a lone surrogate, and a character the profile has no mode for', () => {
		for (const text of ['ab\ud800', 'a\udc00b', '\ud800\ud800']) {
			try {
				segmentText(text, profile);
				expect.unreachable();
			} catch (error) {
				expect(isQrStudioError(error) && error.code).toBe('encode/unsupported-content');
				expect(isQrStudioError(error) && error.params.reason).toBe('lone-surrogate');
			}
		}
		const numericOnly: BitstreamProfile = { ...profile, modes: ['numeric'] };
		try {
			segmentText('12a', numericOnly);
			expect.unreachable();
		} catch (error) {
			expect(isQrStudioError(error) && error.params).toEqual({ reason: 'mode', position: 2 });
		}
	});

	it('refuses ECI on a profile without it, and bad policies', () => {
		const noEci: BitstreamProfile = { ...profile, eci: false };
		expect(() => segmentText('a', noEci, { kanji: 'never', eci: 'utf-8' })).toThrow(
			expect.objectContaining({ code: 'encode/unsupported-feature', params: { feature: 'eci' } }),
		);
		expect(() => segmentText('a', profile, { kanji: 'sometimes' as 'never', eci: 'auto' })).toThrow(
			TypeError,
		);
		expect(() => segmentText('a', profile, { kanji: 'never', eci: 'latin1' as 'auto' })).toThrow(
			TypeError,
		);
		expect(() => segmentText(5 as unknown as string, profile)).toThrow(TypeError);
		expect(() => segmentBytes('a' as unknown as Uint8Array, profile)).toThrow(TypeError);
	});

	it('splits a run longer than its count field can record', () => {
		// 300 lower-case bytes in versions 1 to 9 is more than 255.
		const segments = segmentText('a'.repeat(300), profile);
		expect(segments.map((s) => s.chars)).toEqual([255, 45]);
		const wide = segmentText('é'.repeat(130), profile);
		// 260 bytes of UTF-8, split between code points, never inside one.
		expect(wide.map((s) => s.chars)).toEqual([254, 6]);
		expect(roundTrip(wide, profile, false)).toBe('é'.repeat(130));
		// Under FNC1 a literal % takes two alphanumeric characters, so a cut
		// lands between whole characters and the count stays within 511.
		const gs1 = segmentText('AB%'.repeat(150), profile, DEFAULT_SEGMENTATION, { fnc1: true });
		expect(gs1.map((s) => [s.mode, s.chars])).toEqual([
			['alphanumeric', 510],
			['alphanumeric', 90],
		]);
		expect(roundTrip(gs1, profile, true)).toBe('AB%'.repeat(150));
	});

	it('segments binary content by the same programme, as the same bytes', () => {
		const bytes = Uint8Array.from([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0xff, 0x00, 0x41]);
		const segments = segmentBytes(bytes, profile);
		expect(segments.map((s) => s.mode)).toEqual(['numeric', 'byte']);
		const out = new BitBuffer();
		writeSegments(segments, profile, out);
		expect(readSegments(out.toBytes(), out.length, profile).bytes).toEqual(bytes);
		expect(segmentBytes(new Uint8Array(), profile)).toEqual([]);
		const gs1 = segmentBytes(Uint8Array.from([0x41, 0x25, 0x1d, 0x42]), profile, { fnc1: true });
		expect(gs1.map((s) => [s.mode, Array.from(s.data)])).toEqual([
			['alphanumeric', [0x41, 0x25, 0x25, 0x25, 0x42]],
		]);
	});
});

describe('fittingPrefix', () => {
	it('agrees with segmenting each prefix in full', () => {
		const profile = qrProfile(1);
		fc.assert(
			fc.property(
				fc.string({
					unit: fc.constantFrom('0', '7', 'A', '%', 'a', 'é', '日', '\u001d'),
					maxLength: 40,
				}),
				fc.integer({ min: 0, max: 200 }),
				fc.boolean(),
				fc.boolean(),
				(text, limit, fnc1, withEci) => {
					const kanji = !/[é]/.test(text);
					const eci = withEci ? 26 : undefined;
					const taken = fittingPrefix(
						text,
						profile,
						{ kanji, fnc1, ...(eci ? { eci } : {}) },
						limit,
					);
					const chars = [...text];
					const bits = (k: number): number =>
						segmentsBitLength(
							segmentText(
								chars.slice(0, k).join(''),
								profile,
								{ kanji: kanji ? 'always' : 'never', eci: withEci ? 'utf-8' : 'auto' },
								{ fnc1 },
							),
							profile,
						) + (withEci && k === 0 ? 12 : 0);
					expect(taken).toBeLessThanOrEqual(chars.length);
					expect(bits(taken)).toBeLessThanOrEqual(Math.max(limit, withEci ? 12 : 0));
					if (taken < chars.length) expect(bits(taken + 1)).toBeGreaterThan(limit);
				},
			),
			{ numRuns: 400, seed: 18004 },
		);
	});

	it('takes bytes, and nothing when even the ECI does not fit', () => {
		const profile = qrProfile(1);
		expect(fittingPrefix(Uint8Array.from([1, 2, 3]), profile, {}, 12 + 16)).toBe(2);
		expect(fittingPrefix('abc', profile, { eci: 26 }, 11)).toBe(0);
	});
});
