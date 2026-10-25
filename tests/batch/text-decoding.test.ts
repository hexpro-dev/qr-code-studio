/**
 * Decoding a dropped file: UTF-16 by its byte order mark, strict UTF-8, and
 * Windows-1252 when the bytes are not UTF-8, each checked against iconv-lite.
 */

import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import { decodeCsvBytes, decodeWindows1252 } from '../../src/batch/text-decoding.js';

const SAMPLE =
	'Name;Preis\r\nCaf\u00e9 \u00c9xample;12,50 \u20ac\r\nStra\u00dfe;\u2018quoted\u2019\r\n';

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

	it('falls back to Windows-1252 for a German Excel export, with a warning', () => {
		const bytes = new Uint8Array(iconv.encode(SAMPLE, 'windows-1252'));
		const decoded = decodeCsvBytes(bytes);
		expect(decoded.text).toBe(SAMPLE);
		expect(decoded.encoding).toBe('windows-1252');
		expect(decoded.issues).toEqual([
			{ code: 'batch.csv.windows-1252', path: [], severity: 'warning' },
		]);
		expect(parseCsv(decoded.text).rows[0]).toEqual(['Caf\u00e9 \u00c9xample', '12,50 \u20ac']);
	});

	it('reads the rest as Windows-1252 when a UTF-8 byte order mark is followed by bytes that are not', () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xe9, 0x62]);
		expect(decodeCsvBytes(bytes).text).toBe('a\u00e9b');
	});

	it('reads an empty file as empty text', () => {
		expect(decodeCsvBytes(new Uint8Array(0))).toEqual({ text: '', encoding: 'utf-8', issues: [] });
	});

	it('refuses what is not bytes', () => {
		expect(() => decodeCsvBytes('a' as unknown as Uint8Array)).toThrow(TypeError);
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
