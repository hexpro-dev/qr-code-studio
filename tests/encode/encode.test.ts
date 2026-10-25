/**
 * encode: version, level, mask, segmentation policy, FNC1, and what it says
 * when content does not fit.
 */

import { describe, expect, it } from 'vitest';
import {
	QrStudioError,
	TooMuchDataError,
	UnknownEntryError,
	isQrStudioError,
} from '../../src/core/errors.js';
import { encode } from '../../src/encode/encode.js';
import type { BitstreamProfile } from '../../src/segment/types.js';
import { cached, fakeRegistry, readBack } from './helpers.js';

function thrown(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error('expected a throw');
}

describe('encode: version and level', () => {
	it('picks the smallest version that fits, at M by default', () => {
		expect(encode('a'.repeat(14))).toMatchObject({ version: '1', ecLevel: 'M' });
		expect(encode('a'.repeat(15)).version).toBe('2');
		expect(encode('a'.repeat(17), { ecLevel: 'L' }).version).toBe('1');
		expect(encode('a'.repeat(18), { ecLevel: 'L' }).version).toBe('2');
		expect(encode('1'.repeat(41), { ecLevel: 'L' }).version).toBe('1');
		expect(encode('1'.repeat(42), { ecLevel: 'L' }).version).toBe('2');
		expect(encode('').version).toBe('1');
		expect(readBack(encode('')).bitstream.text).toBe('');
	});

	it('segments again in each count group, so a version boundary uses the right widths', () => {
		// 9-L holds 230 bytes of data codewords; with a 16-bit count from version
		// 10, 230 bytes no longer fit version 10 with an 8-bit count's saving.
		const text = 'a'.repeat(230);
		const symbol = encode(text, { ecLevel: 'L' });
		expect(symbol.version).toBe('9');
		expect(readBack(symbol).bitstream.text).toBe(text);
		expect(encode('a'.repeat(231), { ecLevel: 'L' }).version).toBe('10');
	});

	it('honours minVersion and maxVersion, and refuses bad ones', () => {
		expect(encode('a', { minVersion: '10' }).version).toBe('10');
		expect(encode('a', { minVersion: '3', maxVersion: '3' }).version).toBe('3');
		expect(() => encode('a', { minVersion: '0' })).toThrow(TypeError);
		expect(() => encode('a', { maxVersion: 'M1' })).toThrow(TypeError);
		expect(() => encode('a', { minVersion: '5', maxVersion: '4' })).toThrow(TypeError);
	});

	it('raises the level with boostEc as far as the version allows', () => {
		expect(encode('hello', { boostEc: true })).toMatchObject({ version: '1', ecLevel: 'H' });
		// 12 bytes: 1-Q holds 11 and 1-M 14, so it stops at M.
		expect(encode('a'.repeat(12), { ecLevel: 'L', boostEc: true })).toMatchObject({
			version: '1',
			ecLevel: 'M',
		});
		expect(encode('a'.repeat(12), { ecLevel: 'L' }).ecLevel).toBe('L');
		expect(() => encode('a', { boostEc: 'yes' as unknown as boolean })).toThrow(TypeError);
	});

	it('forces a mask or chooses one', () => {
		for (let mask = 0; mask < 8; mask += 1) expect(encode('HELLO', { mask }).mask).toBe(mask);
		expect(encode('HELLO', { mask: 'auto' }).mask).toBe(encode('HELLO').mask);
		expect(() => encode('a', { mask: 8 })).toThrow(TypeError);
		expect(() => encode('a', { mask: 1.5 })).toThrow(TypeError);
	});

	it('says how much was needed and how much there was, at the largest allowed size', () => {
		const error = thrown(() => encode('a'.repeat(20), { ecLevel: 'L', maxVersion: '1' }));
		expect(error).toBeInstanceOf(TooMuchDataError);
		expect((error as TooMuchDataError).params).toEqual({
			bitsNeeded: 4 + 8 + 160,
			bitsAvailable: 152,
		});
		const largest = thrown(() => encode('a'.repeat(2954), { ecLevel: 'L' }));
		expect((largest as TooMuchDataError).params).toEqual({
			bitsNeeded: 4 + 16 + 2954 * 8,
			bitsAvailable: 2956 * 8,
		});
		// With kanji in play, the closer of the two segmentations is reported.
		const kanji = thrown(() => encode('日'.repeat(30), { maxVersion: '1' }));
		expect((kanji as TooMuchDataError).params).toEqual({
			bitsNeeded: 4 + 8 + 30 * 13,
			bitsAvailable: 128,
		});
	});

	it('refuses options that are not options', () => {
		expect(() => encode('a', null as unknown as object)).toThrow(TypeError);
		expect(() => encode('a', { ecLevel: 'X' as 'L' })).toThrow(TypeError);
		expect(() => encode('a', { rmqrPreference: 'tall' as 'area' })).toThrow(TypeError);
		expect(() => encode(42 as unknown as string)).toThrow(TypeError);
		expect(() => encode('a', { symbology: 'aztec' })).toThrow(UnknownEntryError);
		expect(() => encode('a', { segmentation: { kanji: 'maybe' as 'never' } })).toThrow(TypeError);
		expect(() => encode('a', { segmentation: { eci: 'latin1' as 'auto' } })).toThrow(TypeError);
	});
});

describe('encode: content', () => {
	it('takes bytes and gives the same bytes back', () => {
		const bytes = Uint8Array.from([0x00, 0xff, 0x80, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0xc3]);
		const read = readBack(encode(bytes, { segmentation: { eci: 'utf-8', kanji: 'always' } }));
		expect(read.bitstream.bytes).toEqual(bytes);
		expect(read.bitstream.textSource).toBe('latin1-fallback');
	});

	it('uses kanji under when-smaller only when it saves a version', () => {
		// Seven kanji: 180 bits as UTF-8 needs 2-L; 103 as kanji fits 1-L.
		const saves = encode('日本語漢字文章', { ecLevel: 'L' });
		expect(saves.version).toBe('1');
		expect(readBack(saves).bitstream).toMatchObject({
			text: '日本語漢字文章',
			textSource: 'shift-jis',
		});
		// Two kanji fit 1-M either way, so they stay UTF-8.
		const same = encode('日本');
		expect(same.version).toBe('1');
		expect(readBack(same).bitstream.textSource).toBe('utf-8');
		expect(
			readBack(encode('日本', { segmentation: { kanji: 'always' } })).bitstream.textSource,
		).toBe('shift-jis');
		expect(
			readBack(encode('日本語漢字文章', { ecLevel: 'L', segmentation: { kanji: 'never' } })),
		).toMatchObject({ version: '2' });
	});

	it('writes ECI 26 only when asked', () => {
		expect(readBack(encode('Café')).bitstream.textSource).toBe('utf-8');
		expect(readBack(encode('Café', { segmentation: { eci: 'never' } })).bitstream.textSource).toBe(
			'utf-8',
		);
		const declared = readBack(encode('Café', { segmentation: { eci: 'utf-8' } })).bitstream;
		expect(declared).toMatchObject({ text: 'Café', textSource: 'eci-26' });
	});

	it('writes FNC1 for GS1 and for an application indicator', () => {
		const gs1 = readBack(encode('01034531200000111\u001d10AB%', { fnc1: 'gs1' })).bitstream;
		expect(gs1).toMatchObject({ fnc1: 'gs1', text: '01034531200000111\u001d10AB%' });
		const ai = readBack(encode('ABC', { fnc1: { applicationIndicator: 99 } })).bitstream;
		expect(ai.fnc1).toEqual({ applicationIndicator: 99 });
		expect(() => encode('a', { fnc1: { applicationIndicator: 100 } })).toThrow(TypeError);
		expect(() => encode('a', { fnc1: 'gs2' as 'gs1' })).toThrow(TypeError);
		expect(() => encode('a', { fnc1: null as unknown as 'gs1' })).toThrow(TypeError);
	});

	it('refuses a lone surrogate at every version, as content', () => {
		const error = thrown(() => encode('a\ud800'));
		expect(isQrStudioError(error) && error.code).toBe('encode/unsupported-content');
	});
});

describe('encode over other symbologies', () => {
	it('chooses by area, height or width between rectangles', () => {
		const registry = fakeRegistry([
			{ name: 'tall', qr: '3', width: 10, height: 60 },
			{ name: 'wide', qr: '4', width: 50, height: 11 },
			{ name: 'square', qr: '5', width: 25, height: 25 },
		]);
		const text = 'a'.repeat(30);
		expect(encode(text, { symbology: 'fake' }, registry).version).toBe('wide');
		expect(encode(text, { symbology: 'fake', rmqrPreference: 'height' }, registry).version).toBe(
			'wide',
		);
		expect(encode(text, { symbology: 'fake', rmqrPreference: 'width' }, registry).version).toBe(
			'tall',
		);
		// Only versions large enough count: 70 bytes need QR version 4 or 5.
		expect(
			encode('a'.repeat(70), { symbology: 'fake', rmqrPreference: 'width' }, registry).version,
		).toBe('square');
	});

	it('keeps the symbology order between versions of the same size', () => {
		const registry = fakeRegistry([
			{ name: 'first', qr: '2', width: 25, height: 25 },
			{ name: 'second', qr: '3', width: 25, height: 25 },
		]);
		expect(encode('a', { symbology: 'fake' }, registry).version).toBe('first');
		expect(encode('a', { symbology: 'fake', rmqrPreference: 'height' }, registry).version).toBe(
			'first',
		);
	});

	it('skips versions whose modes cannot carry the content, and says so when none can', () => {
		const digitsOnly = cached((profile: BitstreamProfile) => ({
			...profile,
			modes: ['numeric'] as const,
		}));
		const registry = fakeRegistry([
			{ name: 'small', qr: '1', width: 21, height: 21, profile: digitsOnly },
			{ name: 'large', qr: '2', width: 25, height: 25 },
		]);
		expect(encode('123', { symbology: 'fake' }, registry).version).toBe('small');
		expect(encode('abc', { symbology: 'fake' }, registry).version).toBe('large');
		const error = thrown(() => encode('abc', { symbology: 'fake', maxVersion: 'small' }, registry));
		expect(error).toBeInstanceOf(QrStudioError);
		expect((error as QrStudioError).params).toMatchObject({ reason: 'mode' });
	});

	it('refuses FNC1, structured append and a level where no allowed version has them', () => {
		const bare = cached((profile: BitstreamProfile) => ({
			...profile,
			fnc1: false,
			structuredAppend: false,
		}));
		const registry = fakeRegistry([
			{ name: 'one', qr: '2', width: 25, height: 25, profile: bare, ecLevels: ['M', 'H'] },
		]);
		const error = thrown(() => encode('a', { symbology: 'fake', fnc1: 'gs1' }, registry));
		expect(isQrStudioError(error) && error.params).toEqual({ feature: 'fnc1' });
		expect(() => encode('a', { symbology: 'fake', ecLevel: 'L' }, registry)).toThrow(TypeError);
		expect(encode('a', { symbology: 'fake', ecLevel: 'H' }, registry).ecLevel).toBe('H');
	});
});
