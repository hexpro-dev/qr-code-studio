/**
 * Reading CSV: the RFC 4180 grammar (section 2, rules 1 to 7, each cited
 * beside its vector), what spreadsheets actually export, the refusals and
 * where they point, and a property: any table written by an independent
 * RFC 4180 writer reads back as the same table.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_ROWS, MAX_ROWS_LIMIT, parseCsv, sniffDelimiter } from '../../src/batch/csv.js';
import { MalformedCsvError, TooManyRowsError } from '../../src/batch/errors.js';
import type { CsvDelimiter } from '../../src/batch/types.js';
import { QrStudioError } from '../../src/core/errors.js';
import { referenceCsv } from './helpers.js';

function failure(run: () => unknown): QrStudioError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(QrStudioError);
		return error as QrStudioError;
	}
	throw new Error('expected a failure');
}

describe('RFC 4180 section 2', () => {
	it('rule 1: records separated by CRLF', () => {
		const table = parseCsv('aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n');
		expect(table.headers).toEqual(['aaa', 'bbb', 'ccc']);
		expect(table.rows).toEqual([['zzz', 'yyy', 'xxx']]);
		expect(table.rowNumbers).toEqual([2]);
		expect(table.issues).toEqual([]);
	});

	it('rule 2: the last record may end without a line break', () => {
		expect(parseCsv('aaa,bbb,ccc\r\nzzz,yyy,xxx').rows).toEqual([['zzz', 'yyy', 'xxx']]);
	});

	it('rule 3: the first record is the header, with the same number of fields', () => {
		const table = parseCsv('field_name,field_name2\r\naaa,bbb\r\n');
		expect(table.headers).toEqual(['field_name', 'field_name2']);
	});

	it('rule 4: spaces are part of a field, and a trailing comma is an empty last field', () => {
		const table = parseCsv('a,b,c\r\naaa, bbb ,\r\n');
		expect(table.rows).toEqual([['aaa', ' bbb ', '']]);
	});

	it('rule 5: fields may be in double quotes', () => {
		expect(parseCsv('a,b,c\r\n"aaa","bbb","ccc"\r\n').rows).toEqual([['aaa', 'bbb', 'ccc']]);
	});

	it('rule 6: quoted fields hold line breaks, quotes and commas', () => {
		const table = parseCsv('a,b,c\r\n"aaa","b\r\nbb","c,c"\r\n');
		// Every line break inside a cell is read as LF.
		expect(table.rows).toEqual([['aaa', 'b\nbb', 'c,c']]);
	});

	it('rule 7: a quote inside a quoted field is written twice', () => {
		expect(parseCsv('a,b,c\r\n"aaa","b""bb","ccc"\r\n').rows).toEqual([['aaa', 'b"bb', 'ccc']]);
		expect(parseCsv('a\r\n""""\r\n').rows).toEqual([['"']]);
	});
});

describe('what spreadsheets write', () => {
	it('drops a UTF-8 byte order mark from the first header', () => {
		const table = parseCsv('\ufeffsku,url\r\nA1,https://example.com/a\r\n');
		expect(table.headers).toEqual(['sku', 'url']);
	});

	it('reads LF, CRLF and a lone CR alike, and line breaks in cells as LF', () => {
		for (const eol of ['\n', '\r\n', '\r']) {
			const table = parseCsv(`a,b${eol}1,"x${eol}y"${eol}2,z`);
			expect(table.rows).toEqual([
				['1', 'x\ny'],
				['2', 'z'],
			]);
		}
	});

	it('reads an Excel "CSV UTF-8" export: BOM, commas, CRLF', () => {
		const text =
			'\ufeffSKU,Name,Price,URL\r\nEX-001,Example Mug,12.50,https://example.com/p/ex-001\r\n' +
			'EX-002,"Example Plate, large",30.00,https://example.com/p/ex-002\r\n';
		const table = parseCsv(text);
		expect(table.delimiter).toBe(',');
		expect(table.rows[1]).toEqual([
			'EX-002',
			'Example Plate, large',
			'30.00',
			'https://example.com/p/ex-002',
		]);
	});

	it('reads a German Excel export: semicolons, CRLF, decimal commas', () => {
		const text =
			'Artikel;Bezeichnung;Preis\r\nEX-001;Beispiel;12,50\r\nEX-002;"Beispiel; gross";3,00\r\n';
		const table = parseCsv(text);
		expect(table.delimiter).toBe(';');
		expect(table.rows).toEqual([
			['EX-001', 'Beispiel', '12,50'],
			['EX-002', 'Beispiel; gross', '3,00'],
		]);
	});

	it('reads a Google Sheets export: commas, quotes only where needed', () => {
		for (const eol of ['\r\n', '\n']) {
			const text = `name,phone,note${eol}Example Person,+61 400 000 000,"Line one${eol}line two"${eol}`;
			const table = parseCsv(text);
			expect(table.delimiter).toBe(',');
			expect(table.rows).toEqual([['Example Person', '+61 400 000 000', 'Line one\nline two']]);
		}
	});

	it('reads an Excel "Unicode text" export: tabs', () => {
		const table = parseCsv('ssid\tpassword\r\nExample Network\tcorrect, horse\r\n');
		expect(table.delimiter).toBe('\t');
		expect(table.rows).toEqual([['Example Network', 'correct, horse']]);
	});

	it('honours an Excel sep= line, and does not count it as a row', () => {
		const table = parseCsv('sep=;\r\na;b\r\n1,5;2\r\n');
		expect(table.delimiter).toBe(';');
		expect(table.headers).toEqual(['a', 'b']);
		expect(table.rows).toEqual([['1,5', '2']]);
		expect(table.rowNumbers).toEqual([2]);
		// With an explicit delimiter the line is still not data.
		expect(parseCsv('SEP=,\na,b\n1,2', { delimiter: ',' }).rows).toEqual([['1', '2']]);
		expect(() => parseCsv('sep=\t', { delimiter: ',' })).toThrow(MalformedCsvError);
		expect(parseCsv('sep=,\ra,b\r1,2').rows).toEqual([['1', '2']]);
		// Not a sep line: something follows the delimiter, or it names no delimiter.
		expect(parseCsv('sep=;x\n1').headers).toEqual(['sep=', 'x']);
		expect(parseCsv('sep=|\n1').headers).toEqual(['sep=|']);
	});

	it('skips blank lines but counts them as rows, as a spreadsheet shows them', () => {
		const table = parseCsv('a,b\n\n1,2\r\n\r\n3,4\n');
		expect(table.rows).toEqual([
			['1', '2'],
			['3', '4'],
		]);
		expect(table.rowNumbers).toEqual([3, 5]);
	});

	it('drops trailing rows of nothing but delimiters, and keeps them in the middle', () => {
		const table = parseCsv('a,b\n1,2\n,\n3,4\n,\n,,\n""\n');
		expect(table.rows).toEqual([
			['1', '2'],
			['', ''],
			['3', '4'],
		]);
		expect(table.rowNumbers).toEqual([2, 3, 4]);
		expect(table.issues).toEqual([]);
	});

	it('drops headers left empty at the end, as Excel exports formatted columns', () => {
		const table = parseCsv('a,b,,\n1,2,,\n');
		expect(table.headers).toEqual(['a', 'b']);
		expect(table.rows).toEqual([['1', '2']]);
		expect(table.issues).toEqual([]);
		expect(parseCsv(',\n1').headers).toEqual(['']);
	});

	it('pads a short row and cuts a long one, with a warning for each', () => {
		const table = parseCsv('a,b,c\n1\n1,2,3,4\n1,2,3,,\n');
		expect(table.rows).toEqual([
			['1', '', ''],
			['1', '2', '3'],
			['1', '2', '3'],
		]);
		expect(table.issues).toEqual([
			{
				code: 'batch.csv.short-row',
				path: ['rows', 0],
				severity: 'warning',
				params: { row: 2, cells: 1, expected: 3 },
			},
			{
				code: 'batch.csv.long-row',
				path: ['rows', 1],
				severity: 'warning',
				params: { row: 3, cells: 4, expected: 3 },
			},
		]);
	});

	it('warns of a header used twice, ignoring case and spaces', () => {
		const table = parseCsv('url,name, URL ,,\n1,2,3,,\n', { delimiter: ',' });
		expect(table.headers).toEqual(['url', 'name', ' URL ']);
		expect(table.issues).toEqual([
			{
				code: 'batch.csv.duplicate-header',
				path: ['headers', 2],
				severity: 'warning',
				params: { column: 3, first: 1 },
			},
		]);
	});

	it('reads a header with no rows, and a single column', () => {
		expect(parseCsv('a,b').rows).toEqual([]);
		const single = parseCsv('url\nhttps://example.com/1\nhttps://example.com/2');
		expect(single.delimiter).toBe(',');
		expect(single.rows).toEqual([['https://example.com/1'], ['https://example.com/2']]);
	});

	it('returns frozen data', () => {
		const table = parseCsv('a\n1');
		expect(Object.isFrozen(table)).toBe(true);
		expect(Object.isFrozen(table.rows)).toBe(true);
		expect(Object.isFrozen(table.rows[0])).toBe(true);
		expect(Object.isFrozen(table.headers)).toBe(true);
	});
});

describe('sniffing the delimiter', () => {
	const cases: [string, string, CsvDelimiter][] = [
		['commas', 'a,b,c\n1,2,3\n4,5,6\n', ','],
		['semicolons with decimal commas', 'a;b\n1,5;2,5\n3;4\n', ';'],
		['tabs with commas in text', 'a\tb\nx, y\tz\nw\tv, u\n', '\t'],
		['quoted delimiters ignored', '"a;b",c\n"x;y",z\n', ','],
		['quoted line breaks ignored', 'a;b\n"x\ny";z\n1;2\n', ';'],
		['a CRLF file', 'a;b\r\n1;2\r\n', ';'],
		['a single column', 'url\nhttps://example.com\n', ','],
		['blank lines between', 'a;b\n\n1;2\n', ';'],
		['nothing consistent: the header decides', 'a;b;c\n1;2\n3\n', ';'],
		['nothing consistent and no header delimiter', 'a\n1;2\n3,4,5\n', ','],
		['an equal count: tab before semicolon before comma', 'a,b;c\n1,2;3\n', ';'],
		['a header only', 'a\tb', '\t'],
		['empty', '', ','],
		['a BOM first', '\ufeffa;b\n1;2', ';'],
		['an unclosed quote', 'a;b\n"1;2\n3;4', ';'],
	];
	for (const [name, text, expected] of cases) {
		it(name, () => {
			expect(sniffDelimiter(text)).toBe(expected);
		});
	}

	it('looks at no more than the first twenty records', () => {
		const head = Array.from({ length: 25 }, () => 'a;b').join('\n');
		expect(sniffDelimiter(`${head}\n1,2,3,4\n`)).toBe(';');
	});

	it('does not count a record cut off by the end of the sample', () => {
		// 65,536 characters of one record with semicolons, then a comma record:
		// only complete records are counted, so the long one decides alone.
		const long = `${'x;'.repeat(40_000)}`;
		expect(sniffDelimiter(long)).toBe(';');
		expect(sniffDelimiter(`a,b\n${long}`)).toBe(',');
	});

	it('refuses what is not text', () => {
		expect(() => sniffDelimiter(1 as unknown as string)).toThrow(TypeError);
	});
});

describe('refusals', () => {
	it('an unterminated quote, at the row, column and line it opened', () => {
		const error = failure(() => parseCsv('a,b\n1,2\n3,"open\nstill open'));
		expect(error).toBeInstanceOf(MalformedCsvError);
		expect(error.code).toBe('batch/malformed-csv');
		expect(error.params).toEqual({ reason: 'unterminated-quote', row: 3, column: 2, line: 3 });
		expect((error as MalformedCsvError).reason).toBe('unterminated-quote');
	});

	it('a stray quote in an unquoted cell', () => {
		const error = failure(() => parseCsv('a,b\n1,5" screen\n'));
		expect(error.params).toEqual({ reason: 'stray-quote', row: 2, column: 2, line: 2 });
	});

	it('text straight after a closing quote, counting lines inside quoted cells', () => {
		const error = failure(() => parseCsv('a,b\n"x\r\ny\rz"q,1\n'));
		expect(error.params).toEqual({ reason: 'text-after-quote', row: 2, column: 1, line: 4 });
	});

	it('a file with no rows', () => {
		for (const text of ['', '\ufeff', '\n\r\n\r', 'sep=;\r\n']) {
			const error = failure(() => parseCsv(text));
			expect(error.params.reason).toBe('empty');
		}
	});

	it('never puts a cell into an error', () => {
		const secret = 'Example-Secret-Value';
		for (const text of [`a\n"${secret}`, `a\n${secret}"x`, `a\n"${secret}"x`]) {
			const error = failure(() => parseCsv(text));
			expect(error.message).not.toContain(secret);
			expect(JSON.stringify(error.params)).not.toContain(secret);
		}
	});

	it('too many rows, counted without the header or trailing empty rows', () => {
		expect(parseCsv('a\n1\n2\n,\n\n', { maxRows: 2 }).rows).toHaveLength(2);
		const error = failure(() => parseCsv('a\n1\n2\n3', { maxRows: 2 }));
		expect(error).toBeInstanceOf(TooManyRowsError);
		expect(error.code).toBe('batch/too-many-rows');
		expect(error.params).toEqual({ max: 2 });
		// Empty rows in the middle count once a row after them shows they are rows.
		expect(() => parseCsv('a,b\n1,2\n,\n,\n3,4', { maxRows: 3 })).toThrow(TooManyRowsError);
	});

	it('the default limit is 10,000 rows', () => {
		const text = `a\n${'1\n'.repeat(DEFAULT_MAX_ROWS)}`;
		expect(parseCsv(text).rows).toHaveLength(DEFAULT_MAX_ROWS);
		expect(() => parseCsv(`${text}1\n`)).toThrow(TooManyRowsError);
	});

	it('caller mistakes are TypeErrors', () => {
		expect(() => parseCsv(null as unknown as string)).toThrow(TypeError);
		expect(() => parseCsv('a', null as unknown as object)).toThrow(TypeError);
		expect(() => parseCsv('a', { delimiter: '|' as CsvDelimiter })).toThrow(TypeError);
		for (const maxRows of [0, 1.5, MAX_ROWS_LIMIT + 1, Number.NaN]) {
			expect(() => parseCsv('a', { maxRows })).toThrow(TypeError);
		}
	});
});

describe('round trips', () => {
	const cell = fc.oneof(
		{ weight: 4, arbitrary: fc.string({ maxLength: 8 }) },
		{
			weight: 4,
			arbitrary: fc
				.array(
					fc.constantFrom(
						'a',
						'Z',
						'1',
						' ',
						',',
						';',
						'\t',
						'"',
						'\r',
						'\n',
						'\r\n',
						'\u00e9',
						'\ud83d\ude00',
						'=',
					),
					{
						maxLength: 8,
					},
				)
				.map((parts) => parts.join('')),
		},
	);
	const header = cell.filter((text) => text !== '');
	const table = fc.integer({ min: 1, max: 5 }).chain((width) =>
		fc.record({
			headers: fc.array(header, { minLength: width, maxLength: width }),
			rows: fc.array(
				fc
					.array(cell, { minLength: width, maxLength: width })
					.filter((row) => row.some((c) => c !== '')),
				{ maxLength: 8 },
			),
		}),
	);
	const normal = (text: string): string => text.replace(/\r\n?/g, '\n');

	it('reads back anything the reference writer writes, with every delimiter and line ending', () => {
		fc.assert(
			fc.property(
				table,
				fc.constantFrom<CsvDelimiter>(',', ';', '\t'),
				fc.constantFrom('\r\n', '\n', '\r'),
				fc.boolean(),
				fc.boolean(),
				(written, delimiter, eol, quoteAll, bom) => {
					const text = referenceCsv([written.headers, ...written.rows], {
						delimiter,
						eol,
						quoteAll,
						bom,
					});
					const read = parseCsv(text, { delimiter });
					expect(read.headers).toEqual(written.headers.map(normal));
					expect(read.rows).toEqual(written.rows.map((row) => row.map(normal)));
					expect(read.issues.filter((found) => found.path[0] === 'rows')).toEqual([]);
				},
			),
			{ numRuns: 400 },
		);
	});

	it('sniffs the delimiter of any table with two or more columns, every cell quoted', () => {
		fc.assert(
			fc.property(
				table.filter((written) => written.headers.length > 1),
				fc.constantFrom<CsvDelimiter>(',', ';', '\t'),
				(written, delimiter) => {
					const text = referenceCsv([written.headers, ...written.rows], {
						delimiter,
						quoteAll: true,
					});
					const read = parseCsv(text);
					expect(read.delimiter).toBe(delimiter);
					expect(read.rows).toEqual(written.rows.map((row) => row.map(normal)));
				},
			),
			{ numRuns: 200 },
		);
	});
});
