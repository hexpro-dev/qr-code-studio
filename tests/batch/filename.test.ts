/**
 * File names built from a person's cells: nothing that leaves the folder,
 * nothing a system reads differently, and no two the same.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_NAME_BYTES, sanitiseFilename, uniqueFilenames } from '../../src/batch/filename.js';

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

describe('sanitiseFilename', () => {
	it('leaves an ordinary name alone', () => {
		for (const name of [
			'label-EX-001',
			'Example Mug',
			'caf\u00e9',
			'\u4f8b\u5b50',
			'\ud83d\udc69\u200d\ud83d\udcbb card',
		]) {
			expect(sanitiseFilename(name)).toBe(name);
		}
	});

	it('turns path separators and traversal into a plain name', () => {
		const cases: [string, string][] = [
			['../../etc/passwd', 'etc-passwd'],
			['..\\..\\Windows\\win.ini', 'Windows-win.ini'],
			['/absolute/path', 'absolute-path'],
			['C:\\Users\\Example', 'C-Users-Example'],
			['a/../b', 'a-.-b'],
			['a..b', 'a.b'],
			['...', ''],
			['.hidden', 'hidden'],
			['https://example.com/p/1?x=y', 'https-example.com-p-1-x=y'],
			['a<b>c:d"e|f?g*h', 'a-b-c-d-e-f-g-h'],
		];
		for (const [input, output] of cases) expect(sanitiseFilename(input), input).toBe(output);
	});

	it('removes control and invisible characters, and makes whitespace a single space', () => {
		expect(sanitiseFilename('a\u0000b\u0007c\u007fd\u009be')).toBe('abcde');
		expect(sanitiseFilename('two\tcells\r\non\u2028three   lines\u0085x')).toBe(
			'two cells on three lines x',
		);
		expect(sanitiseFilename('invoice\u202egpj.exe')).toBe('invoicegpj.exe');
		expect(sanitiseFilename('a\u200bb\u2060c\ufeffd\u00ade\u200ef\u061cg\u2066h\u2069')).toBe(
			'abcdefgh',
		);
		expect(sanitiseFilename('non\u00a0breaking')).toBe('non breaking');
		// Joiners stay: Persian and the Indic scripts need them.
		expect(sanitiseFilename('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645')).toBe(
			'\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645',
		);
	});

	it('drops unpaired surrogates, which a ZIP name cannot hold', () => {
		expect(sanitiseFilename('a\ud800b\udc00c')).toBe('abc');
		expect(sanitiseFilename('end\ud83d')).toBe('end');
	});

	it('normalises to NFC', () => {
		expect(sanitiseFilename('Cafe\u0301')).toBe('Caf\u00e9');
	});

	it('trims what systems treat specially at either end', () => {
		expect(sanitiseFilename('  -rf  ')).toBe('rf');
		expect(sanitiseFilename('--option')).toBe('option');
		expect(sanitiseFilename('name. . .')).toBe('name');
		expect(sanitiseFilename('name-')).toBe('name');
	});

	it("takes this layer's own extensions off, however many", () => {
		expect(sanitiseFilename('EX-001.png')).toBe('EX-001');
		expect(sanitiseFilename('EX-001.SVG.pdf.eps')).toBe('EX-001');
		expect(sanitiseFilename('report.docx')).toBe('report.docx');
	});

	it('prefixes Windows device names, with or without an extension', () => {
		for (const name of [
			'CON',
			'con',
			'Prn',
			'AUX',
			'NUL',
			'COM1',
			'com9',
			'LPT0',
			'COM\u00b9',
			'LPT\u00b3',
			'CONIN$',
			'conout$',
			'nul.txt',
			'con .tar.gz',
		]) {
			const out = sanitiseFilename(name);
			expect(out.startsWith('_'), name).toBe(true);
		}
		for (const name of ['CONSOLE', 'COM10', 'LPT', 'NULL', 'aux-1'])
			expect(sanitiseFilename(name)).toBe(name);
	});

	it('cuts a long name at a character boundary', () => {
		const long = sanitiseFilename('\u00e9'.repeat(200));
		expect(bytes(long)).toBeLessThanOrEqual(MAX_NAME_BYTES);
		expect(long).toBe('\u00e9'.repeat(60));
		expect(sanitiseFilename('\u4f8b'.repeat(100))).toBe('\u4f8b'.repeat(40));
		const emoji = sanitiseFilename('\ud83d\ude00'.repeat(50));
		expect(emoji).toBe('\ud83d\ude00'.repeat(30));
		expect(sanitiseFilename('a'.repeat(300), 10)).toBe('aaaaaaaaaa');
		// A cut that leaves a dot or a device name is cleaned again.
		expect(sanitiseFilename(`${'a'.repeat(9)}.b`, 10)).toBe('aaaaaaaaa');
		expect(sanitiseFilename(`con.${'a'.repeat(20)}`, 10)).toBe('_con.aaaaa');
	});

	it('gives an empty name when nothing usable is left', () => {
		for (const name of ['', '   ', '...', '-', '\u202e', '/', '.png'])
			expect(sanitiseFilename(name)).toBe('');
	});

	it('refuses caller mistakes', () => {
		expect(() => sanitiseFilename(1 as unknown as string)).toThrow(TypeError);
		for (const max of [7, 201, 1.5]) expect(() => sanitiseFilename('a', max)).toThrow(TypeError);
	});
});

describe('uniqueFilenames', () => {
	const named = (names: string[]) => names.map((name, i) => ({ name, fallback: `qr-${i + 2}` }));

	it('numbers duplicates from 2, case folded, keeping the first', () => {
		expect(uniqueFilenames(named(['a', 'A', 'b', 'a']))).toEqual([
			{ name: 'a', number: null },
			{ name: 'A-2', number: 2 },
			{ name: 'b', number: null },
			{ name: 'a-3', number: 3 },
		]);
	});

	it('skips a number another row already has as its own name', () => {
		expect(uniqueFilenames(named(['label', 'label', 'label-2'])).map((u) => u.name)).toEqual([
			'label',
			'label-3',
			'label-2',
		]);
	});

	it('uses the fallback for an empty name, and numbers it like any other', () => {
		expect(
			uniqueFilenames([
				{ name: '', fallback: 'qr-2' },
				{ name: 'qr-2', fallback: 'qr-3' },
			]).map((u) => u.name),
		).toEqual(['qr-2', 'qr-2-2']);
	});

	it('keeps a numbered name inside the length limit', () => {
		const long = 'x'.repeat(MAX_NAME_BYTES);
		const out = uniqueFilenames(named([long, long]));
		expect(out[1]?.name).toBe(`${'x'.repeat(MAX_NAME_BYTES - 2)}-2`);
		expect(bytes(out[1]?.name as string)).toBeLessThanOrEqual(MAX_NAME_BYTES);
		// A name made of one wide character too big to keep beside a number.
		const tiny = uniqueFilenames(
			named(['\ud83d\ude00\ud83d\ude00', '\ud83d\ude00\ud83d\ude00']),
			8,
		);
		expect(tiny[1]?.name).toBe('\ud83d\ude00-2');
	});
});

describe('properties', () => {
	const hostile = fc
		.array(
			fc.oneof(
				fc.constantFrom(
					'/',
					'\\',
					'..',
					'.',
					' ',
					'-',
					':',
					'\u0000',
					'\u202e',
					'\ud800',
					'\udc00',
					'CON',
					'nul',
					'.svg',
					'A',
					'a',
					'\u00e9',
					'e\u0301',
					'\ud83d\ude00',
					'\t',
					'\n',
				),
				fc.string({ maxLength: 4 }),
				fc.string({ unit: 'binary', maxLength: 4 }),
			),
			{ maxLength: 30 },
		)
		.map((parts) => parts.join(''));

	it('never gives a name with a separator, a "..", a control character or too many bytes, and is idempotent', () => {
		fc.assert(
			fc.property(hostile, (text) => {
				const out = sanitiseFilename(text);
				expect(out).not.toMatch(/[/\\]/);
				expect(out).not.toContain('..');
				expect([...out].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)).toBe(
					false,
				);
				expect(out).not.toMatch(/^[ .-]|[ .-]$/);
				expect(bytes(out)).toBeLessThanOrEqual(MAX_NAME_BYTES);
				expect(out.normalize('NFC')).toBe(out);
				expect(sanitiseFilename(out)).toBe(out);
			}),
			{ numRuns: 2000 },
		);
	});

	it('gives every row a unique, clean name that cleaning again leaves alone', () => {
		fc.assert(
			fc.property(
				fc.array(fc.oneof(hostile, fc.constantFrom('a', 'A', 'a-2', 'qr-2', '')), {
					maxLength: 40,
				}),
				(texts) => {
					const out = uniqueFilenames(
						texts.map((text, i) => ({ name: sanitiseFilename(text), fallback: `qr-${i + 2}` })),
					);
					const keys = out.map((u) => u.name.toLowerCase());
					expect(new Set(keys).size).toBe(keys.length);
					for (const { name } of out) {
						expect(name).not.toBe('');
						expect(name).not.toMatch(/[/\\]/);
						expect(name).not.toContain('..');
						expect(sanitiseFilename(name)).toBe(name);
					}
					// Doing it again changes nothing: runBatch relies on this.
					const again = uniqueFilenames(
						out.map((u, i) => ({ name: u.name, fallback: `qr-${i + 2}` })),
					);
					expect(again.map((u) => u.name)).toEqual(out.map((u) => u.name));
				},
			),
			{ numRuns: 500 },
		);
	});
});
