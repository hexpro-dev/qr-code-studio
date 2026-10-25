/**
 * Planning a batch: cells read as their fields' kinds, every row validated by
 * its content type exactly as the form is, file names cleaned and numbered,
 * and the mistakes a caller can make refused.
 */

import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import { UnknownColumnError } from '../../src/batch/errors.js';
import { planBatch } from '../../src/batch/plan.js';
import type { BatchMapping, BatchRow, CsvTable } from '../../src/batch/types.js';
import { QrStudioError } from '../../src/core/errors.js';
import { definePayload, field } from '../../src/payload/define.js';
import { registries } from './helpers.js';

const reg = registries();

function plan(csv: string, mapping: BatchMapping): readonly BatchRow[] {
	return planBatch(parseCsv(csv), mapping, reg);
}

function codes(row: BatchRow | undefined): string[] {
	return (row as BatchRow).issues.map((found) => found.code);
}

describe('planBatch', () => {
	it('builds each row from a link template, validated as the form would', () => {
		const rows = plan('sku,name\r\nEX-001,Example Mug\r\nEX 002/b,Example Plate\r\n', {
			typeId: 'url',
			fields: { url: { template: 'https://example.com/p/{sku}?n={name}' } },
			filename: 'label-{sku}',
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			index: 0,
			rowNumber: 2,
			typeId: 'url',
			filename: 'label-EX-001',
			content: 'https://example.com/p/EX-001?n=Example%20Mug',
			issues: [],
		});
		expect(rows[1]?.content).toBe('https://example.com/p/EX%20002%2Fb?n=Example%20Plate');
		expect(rows[1]?.filename).toBe('label-EX 002-b');
		expect(codes(rows[1])).toEqual(['batch.issue.filename-cleaned']);
		expect(Object.isFrozen(rows)).toBe(true);
		expect(Object.isFrozen(rows[0])).toBe(true);
		expect(Object.isFrozen(rows[0]?.issues)).toBe(true);
	});

	it('reports a row the content type refuses, and makes no content for it', () => {
		const rows = plan('link\r\nftp://example.com/a\r\nnot a link\r\nhttps://example.com/ok\r\n', {
			typeId: 'url',
			fields: { url: { column: 'link' } },
			filename: '{link}',
		});
		expect(rows.map((row) => row.content)).toEqual([null, null, 'https://example.com/ok']);
		expect(codes(rows[0])).toContain('payload.issue.url-scheme');
		expect(codes(rows[1])).toContain('payload.issue.invalid-url');
		expect(rows[0]?.issues[0]?.path).toEqual(['fields', 'url']);
		expect(
			reg.payloads
				.require('url')
				.validate({ url: 'not a link' } as never)
				.map((i) => i.code),
		).toEqual(['payload.issue.invalid-url']);
	});

	it('reads Wi-Fi rows: choices ignoring case, yes or no, defaults, and passwords exactly', () => {
		const rows = plan(
			'name,pass,sec,hidden\nExample Network, spaced pass ,WPA,TRUE\nExample Two,,,no\nExample Three,x,wpa,maybe\n',
			{
				typeId: 'wifi',
				fields: {
					ssid: { column: 'name' },
					password: { column: 'pass' },
					security: { column: 'sec' },
					hidden: { column: 'hidden' },
				},
				filename: 'wifi-{name}',
			},
		);
		expect(rows[0]?.content).toBe('WIFI:T:WPA;S:Example Network;H:true;P: spaced pass ;;');
		// An empty choice takes the field's default; no password is an issue of the type's own.
		expect(rows[1]?.content).toBeNull();
		expect(codes(rows[1])).toContain('payload.wifi.issue.password-required');
		expect(codes(rows[2])).toContain('payload.issue.wrong-kind');
		expect(rows[2]?.issues.find((i) => i.code === 'payload.issue.wrong-kind')?.params).toEqual({
			expected: 'boolean',
		});
	});

	it('reads numbers only as plain decimals, and says why a comma is refused', () => {
		const rows = plan('lat,lng,alt\n-33.8568, 151.2153 ,\n"1,5",151,1e3\nabc,151,10\n', {
			typeId: 'geo',
			fields: {
				latitude: { column: 'lat' },
				longitude: { column: 'lng' },
				altitude: { column: 'alt' },
			},
			filename: 'place',
		});
		expect(rows[0]?.content).toBe('geo:-33.8568,151.2153');
		expect(rows[1]?.content).toBeNull();
		expect(rows[1]?.issues.filter((i) => i.severity === 'error')).toEqual([
			{ code: 'batch.issue.number-format', path: ['fields', 'latitude'], severity: 'error' },
		]);
		expect(codes(rows[2])).toContain('payload.issue.not-a-number');
		for (const text of ['1.250,50', '1 250', "1'250", '+1,0']) {
			const [row] = plan(`lat,lng\n"${text}",1\n`, {
				typeId: 'geo',
				fields: { latitude: { column: 'lat' }, longitude: { column: 'lng' } },
				filename: 'x',
			});
			expect(codes(row), text).toContain('batch.issue.number-format');
		}
	});

	it('splits lists: addresses at semicolons and commas, links at spaces, numbers at semicolons', () => {
		const [email] = plan('to\n"a@example.com; b@example.com,c@example.com\n"\n', {
			typeId: 'email',
			fields: { to: { column: 'to' } },
			filename: 'mail',
		});
		expect(email?.content).toBe('mailto:a@example.com,b@example.com,c@example.com');
		const [card] = plan(
			'given,family,mobile,web\nExample,Person,+61 400 000 000; +61 400 000 001,https://example.com/a https://example.com/b\n',
			{
				typeId: 'vcard',
				fields: {
					givenName: { column: 'given' },
					familyName: { column: 'family' },
					mobile: { column: 'mobile' },
					website: { template: '{web}' },
				},
				filename: '{given} {family}',
			},
		);
		expect(card?.issues).toEqual([]);
		expect(card?.content).toContain('TEL;TYPE=CELL:+61400000000');
		expect(card?.content).toContain('TEL;TYPE=CELL:+61400000001');
		expect(card?.content).toContain('URL:https://example.com/a');
		expect(card?.content).toContain('URL:https://example.com/b');
		const [empty] = plan('given,mobile\nExample,\n', {
			typeId: 'vcard',
			fields: { givenName: { column: 'given' }, mobile: { column: 'mobile' } },
			filename: 'x',
		});
		expect(empty?.content).not.toContain('TEL');
	});

	it('writes codes in capitals, and trims links but never text', () => {
		const [row] = plan(
			'name,iban,bic,amount\n Example ,DE89370400440532013000, deutdeff ,12.30\n',
			{
				typeId: 'epc',
				fields: {
					name: { column: 'name' },
					iban: { column: 'iban' },
					bic: { column: 'bic' },
					amount: { column: 'amount' },
				},
				filename: 'pay',
			},
		);
		expect(row?.content).toContain('\nDEUTDEFF\n');
		expect(row?.content).toContain('\n Example \n');
		expect(row?.content).toContain('EUR12.3');
	});

	it('takes a constant from a template with no placeholders', () => {
		const [row] = plan('ssid,pw\nExample Network,examplepass\n', {
			typeId: 'wifi',
			fields: {
				ssid: { column: 'ssid' },
				password: { column: 'pw' },
				security: { template: 'SAE' },
			},
			filename: 'wifi',
		});
		expect(row?.content).toBe('WIFI:T:SAE;S:Example Network;P:examplepass;;');
	});

	it('skips a row with every mapped cell empty, and a mapping that reads no cells', () => {
		const rows = plan('a,b\n1,x\n,y\n', {
			typeId: 'url',
			fields: { url: { template: 'https://example.com/{a}' } },
			filename: '{b}',
		});
		expect(rows[1]?.content).toBeNull();
		expect(rows[1]?.issues).toEqual([
			{ code: 'batch.issue.empty-row', path: [], severity: 'warning' },
		]);
		const constant = plan('a\n1\n', {
			typeId: 'url',
			fields: { url: { template: 'https://example.com/' } },
			filename: 'x',
		});
		expect(codes(constant[0])).toEqual(['batch.issue.empty-row']);
		const nothing = plan('a\n1\n', { typeId: 'url', fields: {}, filename: 'x' });
		expect(codes(nothing[0])).toEqual(['batch.issue.empty-row']);
	});

	it("carries the file's own warnings onto the rows they belong to", () => {
		const rows = plan('a,b\n1\nhttps://example.com/2,x,y\n', {
			typeId: 'url',
			fields: { url: { template: 'https://example.com/{a}' } },
			filename: 'f',
		});
		expect(codes(rows[0])).toEqual(['batch.csv.short-row']);
		expect(codes(rows[1])[0]).toBe('batch.csv.long-row');
	});

	it('names files from the template, falls back to the row number, and numbers duplicates', () => {
		const rows = plan('sku\nA\n\n../..\nA\na\n', {
			typeId: 'text',
			fields: { text: { column: 'sku' } },
			filename: '{sku}',
		});
		expect(rows.map((row) => row.filename)).toEqual(['A', 'qr-4', 'A-2', 'a-3']);
		expect(rows.map((row) => row.rowNumber)).toEqual([2, 4, 5, 6]);
		expect(codes(rows[1])).toEqual(['batch.issue.filename-fallback']);
		expect(rows[2]?.issues).toEqual([
			{
				code: 'batch.issue.filename-numbered',
				path: ['filename'],
				severity: 'info',
				params: { number: 2 },
			},
		]);
	});

	it('finds columns by exact name, then ignoring case and spaces', () => {
		const [row] = plan(' URL ,Url\nhttps://example.com/a,https://example.com/b\n', {
			typeId: 'url',
			fields: { url: { column: 'Url' } },
			filename: '{url}',
		});
		expect(row?.content).toBe('https://example.com/b');
		expect(row?.filename).toBe('https-example.com-a');
	});

	it('numbers rows from 2 when the table carries no row numbers', () => {
		const table = { headers: ['text'], rows: [['a'], ['b']] } as unknown as CsvTable;
		const rows = planBatch(
			table,
			{ typeId: 'text', fields: { text: { column: 'text' } }, filename: '' },
			reg,
		);
		expect(rows.map((row) => [row.rowNumber, row.filename])).toEqual([
			[2, 'qr-2'],
			[3, 'qr-3'],
		]);
	});

	it('splits a list of another kind at line breaks, and reads a choice with no options', () => {
		const bag = registries();
		bag.payloads.register(
			definePayload<{ lines: readonly string[]; pick: string }>({
				id: 'list-test',
				category: 'text',
				fields: [
					field('list-test', 'lines', 'text', { multiple: true }),
					{ key: 'pick', kind: 'select', labelKey: 'payload.list-test.field.pick' },
				],
				write: (value) => value.lines.join('|'),
				detect: () => 0,
				parse: () => ({ lines: [], pick: '' }),
				vectors: [],
			}),
		);
		const rows = planBatch(
			parseCsv('lines,pick\n"one; two\nthree",\nfour,any\n'),
			{
				typeId: 'list-test',
				fields: { lines: { column: 'lines' }, pick: { column: 'pick' } },
				filename: 'x',
			},
			bag,
		);
		expect(rows[0]?.content).toBe('one; two|three');
		expect(codes(rows[1])).toContain('payload.issue.invalid-option');
	});

	it('reads a row shorter than the header in a table made by hand', () => {
		const table = { headers: ['a', 'b', 'c'], rows: [['', 'x']] } as unknown as CsvTable;
		const [row] = planBatch(
			table,
			{ typeId: 'text', fields: { text: { template: '{a}{c}{b}' } }, filename: '{c}' },
			reg,
		);
		expect(row?.content).toBe('x');
		expect(row?.filename).toBe('qr-2');
	});

	it('never puts a cell into an issue', () => {
		const secret = 'Example-Secret-Value';
		const rows = plan(`ssid,pw\n${secret},"${'x'.repeat(300)}${secret}"\n`, {
			typeId: 'wifi',
			fields: { ssid: { column: 'ssid' }, password: { column: 'pw' } },
			filename: '{pw}',
		});
		expect(JSON.stringify(rows[0]?.issues)).not.toContain(secret);
		expect(codes(rows[0])).toContain('payload.issue.too-long');
	});
});

describe('planBatch refusals', () => {
	const table = parseCsv('sku,url\nA,https://example.com\n');
	const ok: BatchMapping = { typeId: 'url', fields: { url: { column: 'url' } }, filename: '{sku}' };

	function thrown(run: () => unknown): unknown {
		try {
			run();
		} catch (error) {
			return error;
		}
		throw new Error('expected a failure');
	}

	it('a column the file does not have, by which part of the mapping asked', () => {
		const field = thrown(() =>
			planBatch(table, { ...ok, fields: { url: { column: 'link' } } }, reg),
		);
		expect(field).toBeInstanceOf(UnknownColumnError);
		expect((field as QrStudioError).code).toBe('batch/unknown-column');
		expect((field as QrStudioError).params).toEqual({ part: 'field', field: 'url' });
		const template = thrown(() =>
			planBatch(
				table,
				{ ...ok, fields: { url: { template: 'https://example.com/{price}' } } },
				reg,
			),
		);
		expect((template as QrStudioError).params).toEqual({ part: 'field', field: 'url' });
		const filename = thrown(() => planBatch(table, { ...ok, filename: 'label-{price}' }, reg));
		expect((filename as QrStudioError).params).toEqual({ part: 'filename' });
		expect((filename as QrStudioError).message).not.toContain('price');
	});

	it('a content type this copy does not have', () => {
		const error = thrown(() => planBatch(table, { ...ok, typeId: 'fax' }, reg));
		expect((error as QrStudioError).code).toBe('design/unknown-entry');
	});

	it('caller mistakes as TypeErrors', () => {
		const bad: unknown[] = [
			() => planBatch(null as unknown as CsvTable, ok, reg),
			() => planBatch({ headers: [1], rows: [] } as unknown as CsvTable, ok, reg),
			() => planBatch({ headers: ['a'], rows: [[1]] } as unknown as CsvTable, ok, reg),
			() => planBatch({ ...table, rowNumbers: [1] } as unknown as CsvTable, ok, reg),
			() => planBatch({ ...table, rowNumbers: 'x' } as unknown as CsvTable, ok, reg),
			() => planBatch(table, null as unknown as BatchMapping, reg),
			() => planBatch(table, { ...ok, filename: 1 } as unknown as BatchMapping, reg),
			() => planBatch(table, { ...ok, fields: null } as unknown as BatchMapping, reg),
			() => planBatch(table, { ...ok, fields: { nope: { column: 'url' } } }, reg),
			() =>
				planBatch(table, { ...ok, fields: { url: { column: 1 } } } as unknown as BatchMapping, reg),
			() => planBatch(table, { ...ok, fields: { url: null } } as unknown as BatchMapping, reg),
			() =>
				planBatch(
					table,
					{ ...ok, fields: { url: { column: 'url', template: 'x' } } } as unknown as BatchMapping,
					reg,
				),
			() => planBatch(table, { ...ok, typeId: 'zatca', fields: {} }, reg),
			() => planBatch(table, ok, null as unknown as typeof reg),
		];
		for (const run of bad) expect(run as () => unknown).toThrow(TypeError);
	});
});
