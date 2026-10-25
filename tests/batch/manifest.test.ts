/**
 * The manifest: what became of each row, never the content unless asked,
 * and nothing a spreadsheet would run as a formula.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import {
	MANIFEST_NAME,
	batchManifest,
	manifestIssues,
	neutraliseFormula,
	writeCsv,
} from '../../src/batch/manifest.js';
import type { BatchOutcome } from '../../src/batch/types.js';
import { issue } from '../../src/core/issue.js';
import { utf8Text } from './helpers.js';

const written: BatchOutcome = {
	index: 0,
	rowNumber: 2,
	typeId: 'url',
	filename: 'label-EX-001.svg',
	status: 'written',
	check: 'pass',
	sheet: null,
	issues: [
		issue('batch.issue.filename-cleaned', ['filename'], 'info'),
		issue('payload.url.issue.utm-incomplete', ['fields', 'utmMedium'], 'warning'),
		issue('payload.url.issue.utm-incomplete', ['fields', 'utmCampaign'], 'warning'),
	],
};
const skipped: BatchOutcome = {
	index: 1,
	rowNumber: 4,
	typeId: 'url',
	filename: null,
	status: 'skipped',
	check: null,
	sheet: null,
	issues: [
		issue('payload.issue.invalid-url', ['fields', 'url']),
		issue('batch.issue.empty-row', [], 'warning'),
	],
};

describe('neutraliseFormula', () => {
	it('puts an apostrophe before what a spreadsheet would run', () => {
		for (const cell of [
			'=1+1',
			'+61 400 000 000',
			'-1',
			'@SUM(A1)',
			'\tx',
			'\rx',
			'=HYPERLINK("https://example.com")',
		]) {
			expect(neutraliseFormula(cell), cell).toBe(`'${cell}`);
		}
		for (const cell of ['', 'plain', ' =1', '1=1', "'=1", 'https://example.com/?a=b']) {
			expect(neutraliseFormula(cell), cell).toBe(cell);
		}
	});
});

describe('writeCsv', () => {
	it('quotes only what needs it, and ends every line with CRLF', () => {
		expect(writeCsv([['a', 'b,c', 'd"e', 'f\ng', 'h\ri'], []])).toBe(
			'a,"b,c","d""e","f\ng","h\ri"\r\n\r\n',
		);
	});

	it('reads back through parseCsv as the cells it was given, neutralised', () => {
		const cell = fc.oneof(
			fc.string({ maxLength: 6 }),
			fc
				.array(fc.constantFrom('a', ',', '"', '\n', '=', '+', '-', '@', '\t', ' ', '\u00e9'), {
					maxLength: 6,
				})
				.map((parts) => parts.join('')),
		);
		fc.assert(
			fc.property(
				fc.array(
					fc.array(cell, { minLength: 3, maxLength: 3 }).filter((row) => row.some((c) => c !== '')),
					{
						minLength: 1,
						maxLength: 6,
					},
				),
				(rows) => {
					const read = parseCsv(writeCsv([['x', 'y', 'z'], ...rows]), { delimiter: ',' });
					expect(read.rows).toEqual(rows.map((row) => row.map(neutraliseFormula)));
				},
			),
			{ numRuns: 300 },
		);
	});
});

describe('batchManifest', () => {
	it('has no content column unless asked, a byte order mark, and the warnings and errors once each', () => {
		const bytes = batchManifest([written, skipped]);
		expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		expect(utf8Text(bytes)).toBe(
			'row,file,type,status,check,issues\r\n' +
				'2,label-EX-001.svg,url,written,pass,payload.url.issue.utm-incomplete\r\n' +
				'4,,url,skipped,,payload.issue.invalid-url batch.issue.empty-row\r\n',
		);
		expect(MANIFEST_NAME).toBe('manifest.csv');
	});

	it('writes content when asked, with formulas neutralised there and in file names', () => {
		const hostile = { ...written, filename: '=cmd.svg' };
		const contents = ['=HYPERLINK("https://example.com/x","click")', null];
		const text = utf8Text(
			batchManifest([hostile, skipped], { content: (index) => contents[index] ?? null }),
		);
		const table = parseCsv(text);
		expect(table.headers).toEqual(['row', 'file', 'type', 'status', 'check', 'issues', 'content']);
		expect(table.rows[0]?.[1]).toBe("'=cmd.svg");
		expect(table.rows[0]?.[6]).toBe('\'=HYPERLINK("https://example.com/x","click")');
		expect(table.rows[1]?.[6]).toBe('');
	});

	it('adds the page and label for a sheet', () => {
		const placed = { ...written, filename: null, sheet: { page: 2, label: 7 } };
		const table = parseCsv(utf8Text(batchManifest([placed, skipped])));
		expect(table.headers).toEqual([
			'row',
			'file',
			'type',
			'status',
			'check',
			'issues',
			'page',
			'label',
		]);
		expect(table.rows).toEqual([
			['2', '', 'url', 'written', 'pass', 'payload.url.issue.utm-incomplete', '2', '7'],
			['4', '', 'url', 'skipped', '', 'payload.issue.invalid-url batch.issue.empty-row', '', ''],
		]);
	});

	it('lists warnings and errors, never info', () => {
		expect(manifestIssues([issue('a.b', [], 'info')])).toBe('');
	});
});
