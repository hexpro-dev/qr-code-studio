/**
 * Templates: placeholders, escaped braces, columns found by name, and cells
 * kept to one piece of a link.
 */

import { describe, expect, it } from 'vitest';
import {
	compileTemplate,
	fillTemplate,
	findColumn,
	parseTemplate,
} from '../../src/batch/template.js';
import type { CompiledTemplate } from '../../src/batch/template.js';

function compiled(template: string, headers: string[]): CompiledTemplate {
	const result = compileTemplate(template, headers);
	if ('missing' in result) throw new Error(`missing ${result.missing}`);
	return result;
}

describe('parseTemplate', () => {
	it('splits literal text and placeholders', () => {
		expect(parseTemplate('https://example.com/p/{sku}?ref={ref}')).toEqual([
			{ literal: 'https://example.com/p/' },
			{ column: 'sku' },
			{ literal: '?ref=' },
			{ column: 'ref' },
		]);
		expect(parseTemplate('{a}{b}')).toEqual([{ column: 'a' }, { column: 'b' }]);
		expect(parseTemplate('')).toEqual([]);
	});

	it('reads doubled braces as literal braces', () => {
		expect(parseTemplate('{{sku}}')).toEqual([{ literal: '{sku}' }]);
		expect(parseTemplate('{{{sku}}}')).toEqual([
			{ literal: '{' },
			{ column: 'sku' },
			{ literal: '}' },
		]);
	});

	it('keeps a brace that starts nothing as written', () => {
		expect(parseTemplate('a{b')).toEqual([{ literal: 'a{b' }]);
		expect(parseTemplate('a{}b')).toEqual([{ literal: 'a{}b' }]);
		expect(parseTemplate('a}b')).toEqual([{ literal: 'a}b' }]);
		expect(parseTemplate('{a{b}')).toEqual([{ literal: '{a' }, { column: 'b' }]);
		expect(parseTemplate('{ sku }')).toEqual([{ column: ' sku ' }]);
	});
});

describe('findColumn', () => {
	const headers = ['SKU', ' Name ', 'name', 'url'];
	it('prefers an exact match, then ignores case and surrounding spaces', () => {
		expect(findColumn(headers, 'name')).toBe(2);
		expect(findColumn(headers, 'NAME')).toBe(1);
		expect(findColumn(headers, ' sku ')).toBe(0);
		expect(findColumn(headers, 'price')).toBe(-1);
		expect(findColumn(headers, '  ')).toBe(-1);
		expect(findColumn(['', 'a'], '')).toBe(0);
	});
});

describe('compileTemplate', () => {
	it('finds each column, or names the first that is missing', () => {
		expect(compileTemplate('{sku}-{name}', ['sku', 'name'])).toEqual({
			parts: [{ index: 0 }, { literal: '-' }, { index: 1 }],
			columns: [0, 1],
		});
		expect(compileTemplate('{sku}-{price}-{other}', ['sku'])).toEqual({ missing: 'price' });
	});
});

describe('fillTemplate', () => {
	it('fills cells in as they are, outside links', () => {
		const template = compiled('label-{sku}/{name}', ['sku', 'name']);
		expect(fillTemplate(template, ['A&B', 'x y'], false)).toBe('label-A&B/x y');
		expect(fillTemplate(template, [], false)).toBe('label-/');
	});

	it('escapes every value placed after the scheme of a link, as one URL component', () => {
		const template = compiled('https://example.com/p/{sku}?campaign={c}#{f}', ['sku', 'c', 'f']);
		expect(fillTemplate(template, ['A/B 1', 'spring&ref=evil', 'top#x'], true)).toBe(
			'https://example.com/p/A%2FB%201?campaign=spring%26ref%3Devil#top%23x',
		);
		expect(fillTemplate(template, ['caf\u00e9', '?', ''], true)).toBe(
			'https://example.com/p/caf%C3%A9?campaign=%3F#',
		);
	});

	it('escapes a host too, so a cell cannot add a user name or a port', () => {
		const template = compiled('https://{host}/x', ['host']);
		expect(fillTemplate(template, ['example.com'], true)).toBe('https://example.com/x');
		expect(fillTemplate(template, ['example.com@evil.example'], true)).toBe(
			'https://example.com%40evil.example/x',
		);
	});

	it('inserts a value that supplies the start of the link as it is', () => {
		expect(fillTemplate(compiled('{url}', ['url']), ['https://example.com/a?b=c'], true)).toBe(
			'https://example.com/a?b=c',
		);
		const site = compiled('{site}/p/{sku}', ['site', 'sku']);
		expect(fillTemplate(site, ['https://example.com', 'A/B'], true)).toBe(
			'https://example.com/p/A%2FB',
		);
		// Until the scheme is written, a value is still the start of the link.
		const scheme = compiled('{scheme}://example.com/{path}', ['scheme', 'path']);
		expect(fillTemplate(scheme, ['https', 'a b'], true)).toBe('https://example.com/a%20b');
	});

	it('leaves text with an unpaired surrogate as it is, for validation to report', () => {
		const template = compiled('https://example.com/{x}', ['x']);
		expect(fillTemplate(template, ['a\ud800b'], true)).toBe('https://example.com/a\ud800b');
		expect(fillTemplate(template, ['a\udc00'], true)).toBe('https://example.com/a\udc00');
		expect(fillTemplate(template, ['\ud83d\ude00'], true)).toBe('https://example.com/%F0%9F%98%80');
	});
});
