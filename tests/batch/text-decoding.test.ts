/**
 * Decoding a dropped file: UTF-16 by its byte order mark, strict UTF-8, and
 * the fallback the caller chose when the bytes are not UTF-8, each checked
 * against iconv-lite. Every sample is synthetic text encoded here.
 */

import iconv from 'iconv-lite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import {
	CSV_FALLBACK_ENCODINGS,
	DEFAULT_CSV_FALLBACK,
	decodeCsvBytes,
	decodeWindows1252,
	isCsvFallbackEncoding,
} from '../../src/batch/text-decoding.js';
import type { CsvFallbackEncoding } from '../../src/batch/types.js';
import { QrStudioError } from '../../src/core/errors.js';

const SAMPLE =
	'Name;Preis\r\nCaf\u00e9 \u00c9xample;12,50 \u20ac\r\nStra\u00dfe;\u2018quoted\u2019\r\n';

/** A short spreadsheet in each fallback's own script, as that locale's Excel would save it. */
const SAMPLES: Readonly<Record<CsvFallbackEncoding, string>> = {
	'windows-1252': SAMPLE,
	shift_jis: '\u540d\u524d,\u30ea\u30f3\u30af\r\n\u898b\u672c,https://example.com/1\r\n',
	gb18030: '\u540d\u79f0,\u94fe\u63a5\r\n\u793a\u4f8b,https://example.com/1\r\n',
	big5: '\u540d\u7a31,\u9023\u7d50\r\n\u7bc4\u4f8b,https://example.com/1\r\n',
	'euc-kr': '\uc774\ub984,\ub9c1\ud06c\r\n\uc608\uc2dc,https://example.com/1\r\n',
	'windows-1251':
		'\u0418\u043c\u044f,\u0421\u0441\u044b\u043b\u043a\u0430\r\n\u041f\u0440\u0438\u043c\u0435\u0440,https://example.com/1\r\n',
	'windows-1256':
		'\u0627\u0644\u0627\u0633\u0645,\u0627\u0644\u0631\u0627\u0628\u0637\r\n\u0645\u062b\u0627\u0644,https://example.com/1\r\n',
};

function encoded(text: string, encoding: string): Uint8Array {
	return new Uint8Array(iconv.encode(text, encoding));
}

function fallbackIssue(encoding: CsvFallbackEncoding) {
	return {
		code: 'batch.csv.fallback-encoding',
		path: [],
		severity: 'warning',
		params: { encoding },
	};
}

function thrownBy(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error('expected a failure');
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('decodeCsvBytes', () => {
	it('reads UTF-8, with or without a byte order mark', () => {
		const plain = decodeCsvBytes(new Uint8Array(Buffer.from(SAMPLE, 'utf8')));
		expect(plain).toEqual({ text: SAMPLE, encoding: 'utf-8', issues: [] });
		const marked = decodeCsvBytes(new Uint8Array(Buffer.from(`\ufeff${SAMPLE}`, 'utf8')));
		expect(marked.text).toBe(SAMPLE);
		expect(marked.encoding).toBe('utf-8');
	});

	it('reads UTF-16 by its byte order mark, in both byte orders, as Excel writes "Unicode text"', () => {
		const text = 'ssid\tpassword\r\nExample Network\t\ud83d\ude00\r\n';
		const le = decodeCsvBytes(new Uint8Array(iconv.encode(text, 'utf-16le', { addBOM: true })));
		expect(le.text).toBe(text);
		expect(le.encoding).toBe('utf-16le');
		expect(le.issues).toEqual([{ code: 'batch.csv.utf-16', path: [], severity: 'info' }]);
		const be = decodeCsvBytes(new Uint8Array(iconv.encode(text, 'utf-16be', { addBOM: true })));
		expect(be.text).toBe(text);
		expect(be.encoding).toBe('utf-16be');
	});

	it('drops the half character at the end of an odd-length UTF-16 file, and says so', () => {
		const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62]);
		const decoded = decodeCsvBytes(bytes);
		expect(decoded.text).toBe('a');
		expect(decoded.issues.map((found) => found.code)).toEqual([
			'batch.csv.utf-16',
			'batch.csv.odd-length',
		]);
	});

	it('keeps an unpaired surrogate from UTF-16, for validation to report', () => {
		const decoded = decodeCsvBytes(new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x61, 0x00]));
		expect(decoded.text).toBe('\ud800a');
	});

	it('falls back to Windows-1252 by default for a German Excel export, with a warning naming it', () => {
		const bytes = encoded(SAMPLE, 'windows-1252');
		expect(DEFAULT_CSV_FALLBACK).toBe('windows-1252');
		for (const decoded of [decodeCsvBytes(bytes), decodeCsvBytes(bytes, {})]) {
			expect(decoded.text).toBe(SAMPLE);
			expect(decoded.encoding).toBe('windows-1252');
			expect(decoded.issues).toEqual([fallbackIssue('windows-1252')]);
		}
		expect(parseCsv(decodeCsvBytes(bytes).text).rows[0]).toEqual([
			'Caf\u00e9 \u00c9xample',
			'12,50 \u20ac',
		]);
	});

	it.each(CSV_FALLBACK_ENCODINGS.map((label) => [label]))(
		'reads a %s export in that fallback, and names it in a param, never the content',
		(label) => {
			const text = SAMPLES[label];
			const bytes = encoded(text, label);
			// The sample is in the fallback's own script, so its bytes are not UTF-8.
			expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
			const decoded = decodeCsvBytes(bytes, { fallback: label });
			expect(decoded).toEqual({ text, encoding: label, issues: [fallbackIssue(label)] });
			expect(JSON.stringify(decoded.issues)).not.toContain('example.com');
		},
	);

	it('lists the fallbacks it reads, and says which a value is', () => {
		expect([...CSV_FALLBACK_ENCODINGS]).toEqual([
			'windows-1252',
			'shift_jis',
			'gb18030',
			'big5',
			'euc-kr',
			'windows-1251',
			'windows-1256',
		]);
		expect(Object.isFrozen(CSV_FALLBACK_ENCODINGS)).toBe(true);
		expect(isCsvFallbackEncoding('shift_jis')).toBe(true);
		expect(isCsvFallbackEncoding('Shift_JIS')).toBe(false);
		expect(isCsvFallbackEncoding('utf-8')).toBe(false);
		expect(isCsvFallbackEncoding(undefined)).toBe(false);
	});

	it('reads a byte order mark and valid UTF-8 as what they are, whatever the fallback', () => {
		const japanese = SAMPLES.shift_jis;
		const utf8 = decodeCsvBytes(new Uint8Array(Buffer.from(japanese, 'utf8')), {
			fallback: 'shift_jis',
		});
		expect(utf8).toEqual({ text: japanese, encoding: 'utf-8', issues: [] });
		const marked = decodeCsvBytes(new Uint8Array(Buffer.from(`\ufeff${japanese}`, 'utf8')), {
			fallback: 'gb18030',
		});
		expect(marked).toEqual({ text: japanese, encoding: 'utf-8', issues: [] });
		const utf16 = decodeCsvBytes(
			new Uint8Array(iconv.encode(japanese, 'utf-16le', { addBOM: true })),
			{ fallback: 'big5' },
		);
		expect(utf16.text).toBe(japanese);
		expect(utf16.encoding).toBe('utf-16le');
		// An ASCII file is UTF-8 too, and needs no fallback at all.
		expect(decodeCsvBytes(encoded('a,b\r\n1,2\r\n', 'euc-kr'), { fallback: 'euc-kr' })).toEqual({
			text: 'a,b\r\n1,2\r\n',
			encoding: 'utf-8',
			issues: [],
		});
	});

	it('reads the rest in the fallback when a UTF-8 byte order mark is followed by bytes that are not', () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xe9, 0x62]);
		expect(decodeCsvBytes(bytes).text).toBe('a\u00e9b');
		const japanese = new Uint8Array([0xef, 0xbb, 0xbf, ...encoded(SAMPLES.shift_jis, 'shift_jis')]);
		expect(decodeCsvBytes(japanese, { fallback: 'shift_jis' }).text).toBe(SAMPLES.shift_jis);
	});

	it('reads an empty file as empty text', () => {
		expect(decodeCsvBytes(new Uint8Array(0))).toEqual({ text: '', encoding: 'utf-8', issues: [] });
	});

	it('refuses what is not bytes, and a fallback it does not read, as mistakes', () => {
		const bytes = new Uint8Array([0xe9]);
		expect(() => decodeCsvBytes('a' as unknown as Uint8Array)).toThrow(TypeError);
		expect(() => decodeCsvBytes(bytes, null as never)).toThrow(TypeError);
		expect(() => decodeCsvBytes(bytes, 'shift_jis' as never)).toThrow(TypeError);
		for (const fallback of ['utf-8', 'Shift_JIS', 'latin1', 'koi8-r', '']) {
			expect(() => decodeCsvBytes(bytes, { fallback: fallback as never }), fallback).toThrow(
				TypeError,
			);
		}
	});

	it('refuses out loud when this engine cannot read the fallback, rather than reading it wrongly', () => {
		const Real = TextDecoder;
		// An engine without full ICU: UTF-8 and nothing else.
		class Utf8Only extends Real {
			constructor(label?: string, options?: TextDecoderOptions) {
				if (label !== 'utf-8') throw new RangeError(`The "${label}" encoding is not supported`);
				super(label, options);
			}
		}
		vi.stubGlobal('TextDecoder', Utf8Only);
		const bytes = encoded(SAMPLES.shift_jis, 'shift_jis');
		const thrown = thrownBy(() => decodeCsvBytes(bytes, { fallback: 'shift_jis' }));
		expect(thrown).toBeInstanceOf(QrStudioError);
		expect(thrown).toMatchObject({
			code: 'platform/unavailable',
			params: { feature: 'text-encoding', encoding: 'shift_jis' },
		});
		expect((thrown as Error).message).not.toContain('example.com');
		// Windows-1252 is this package's own table, so it reads without the engine's help.
		expect(decodeCsvBytes(encoded(SAMPLE, 'windows-1252')).text).toBe(SAMPLE);
		// UTF-8 needs no fallback, so a missing one does not matter.
		expect(
			decodeCsvBytes(new Uint8Array(Buffer.from(SAMPLES.shift_jis, 'utf8')), {
				fallback: 'shift_jis',
			}).encoding,
		).toBe('utf-8');

		// A decoder that takes the label and reads something else (a polyfill
		// that knows only UTF-8) counts as none.
		class Pretender extends Real {
			constructor(label?: string, options?: TextDecoderOptions) {
				super(label === undefined || label === 'utf-8' ? label : 'utf-8', options);
			}
		}
		vi.stubGlobal('TextDecoder', Pretender);
		expect(thrownBy(() => decodeCsvBytes(bytes, { fallback: 'gb18030' }))).toMatchObject({
			code: 'platform/unavailable',
			params: { feature: 'text-encoding', encoding: 'gb18030' },
		});
	});
});

describe('decodeWindows1252', () => {
	it('agrees with iconv-lite on every defined byte, and gives the C1 control for the five undefined', () => {
		const undefinedBytes = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
		for (let byte = 0; byte < 256; byte += 1) {
			const ours = decodeWindows1252(new Uint8Array([byte]));
			if (undefinedBytes.has(byte)) {
				// The WHATWG Encoding Standard's index maps these to U+0081 and so on.
				expect(ours.charCodeAt(0), `byte ${byte}`).toBe(byte);
				continue;
			}
			expect(ours, `byte ${byte}`).toBe(iconv.decode(Buffer.from([byte]), 'windows-1252'));
		}
	});

	it('decodes long input in chunks', () => {
		const bytes = new Uint8Array(100_000).fill(0x80);
		expect(decodeWindows1252(bytes)).toBe('\u20ac'.repeat(100_000));
	});
});
