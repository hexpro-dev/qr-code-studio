import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	backslashEscape,
	backslashUnescape,
	escapeText,
	foldLine,
	parseContentLine,
	parseQuery,
	percentDecode,
	splitCompound,
	splitUnescaped,
	unescapeText,
	unfoldLines,
} from '../../src/payload/escape.js';
import { takeQueryParams, withQueryParams } from '../../src/payload/uri.js';

const octets = (text: string) => new TextEncoder().encode(text).length;

describe('backslash escaping', () => {
	it('escapes the reserved characters and nothing else', () => {
		expect(backslashEscape('a;b,c:d\\e"f', '\\;,:"')).toBe('a\\;b\\,c\\:d\\\\e\\"f');
		expect(backslashEscape('plain text', '\\;')).toBe('plain text');
	});

	it('round-trips, and splits only at unescaped separators', () => {
		fc.assert(
			fc.property(
				fc.array(fc.string({ unit: fc.constantFrom(...'ab;,:\\" é') }), { maxLength: 4 }),
				(pieces) => {
					const joined = pieces.map((piece) => backslashEscape(piece, '\\;,:"')).join(';');
					const split = splitUnescaped(joined, ';').map(backslashUnescape);
					expect(split).toEqual(pieces.length === 0 ? [''] : pieces);
				},
			),
		);
	});

	it('keeps a trailing lone backslash', () => {
		expect(backslashUnescape('abc\\')).toBe('abc\\');
		expect(splitUnescaped('a\\', ';')).toEqual(['a\\']);
	});
});

describe('vCard and iCalendar text', () => {
	it('escapes as RFC 5545 section 3.3.11 shows', () => {
		expect(escapeText('Project XYZ Final Review\nConference Room - 3B\nCome Prepared.')).toBe(
			'Project XYZ Final Review\\nConference Room - 3B\\nCome Prepared.',
		);
		expect(escapeText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
	});

	it('round-trips, and reads \\N as a newline', () => {
		fc.assert(
			fc.property(fc.string({ unit: fc.constantFrom(...'ab,;\\\n:é') }), (text) => {
				expect(unescapeText(escapeText(text))).toBe(text);
			}),
		);
		expect(unescapeText('a\\Nb\\:c\\')).toBe('a\nb:c\\');
	});

	it('splits compound values at unescaped semicolons', () => {
		expect(splitCompound('Doe\\;Smith;John;;Dr.;')).toEqual(['Doe;Smith', 'John', '', 'Dr.', '']);
	});
});

describe('line folding', () => {
	it('folds at 75 octets without splitting a character, and unfolds back', () => {
		fc.assert(
			fc.property(
				fc.string({ unit: fc.constantFrom('a', 'é', '中', '😀', ' '), maxLength: 300 }),
				(text) => {
					const folded = foldLine(`NOTE:${text}`);
					for (const line of folded.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75);
					expect(unfoldLines(folded)).toEqual([`NOTE:${text}`]);
				},
			),
		);
	});

	it('unfolds LF and tab continuations from lenient writers', () => {
		expect(unfoldLines('A:one\n two\n\tthree\nB:x\r\nC:y')).toEqual([
			'A:onetwothree',
			'B:x',
			'C:y',
		]);
		expect(unfoldLines(' leading')).toEqual([' leading']);
	});
});

describe('content lines', () => {
	it('reads the name, parameters and value', () => {
		const line = parseContentLine('item1.TEL;TYPE="work,voice";PREF=1:tel:+1-418-656-9254;ext=102');
		expect(line?.name).toBe('TEL');
		// A quoted parameter value is one value under RFC 6350's grammar, commas
		// and all; the vCard type splits TYPE lists itself.
		expect(line?.params.get('TYPE')).toEqual(['work,voice']);
		expect(line?.params.get('PREF')).toEqual(['1']);
		expect(line?.value).toBe('tel:+1-418-656-9254;ext=102');
	});

	it('reads vCard 2.1 bare types and quoted colons', () => {
		const line = parseContentLine('TEL;CELL;VOICE:+61400000000');
		expect(line?.params.get('TYPE')).toEqual(['CELL', 'VOICE']);
		expect(parseContentLine('X;LABEL="a:b":value')?.value).toBe('value');
		expect(parseContentLine('no colon at all')).toBeUndefined();
	});
});

describe('percent-decoding', () => {
	it('decodes, optionally reading + as a space, and answers undefined when malformed', () => {
		expect(percentDecode('a%20b+c')).toBe('a b+c');
		expect(percentDecode('a%20b+c', true)).toBe('a b c');
		expect(percentDecode('%E0%A4%A')).toBeUndefined();
		expect(parseQuery('')).toEqual([]);
		expect(parseQuery('a=1&&b&c=%20')).toEqual([
			['a', '1'],
			['b', ''],
			['c', ' '],
		]);
		expect(parseQuery('a=%ZZ')).toBeUndefined();
	});
});

describe('query parameters on a URL as text', () => {
	it('appends, replaces, and keeps the fragment and the rest as written', () => {
		expect(withQueryParams('https://example.com/a', [['utm_source', 'x y']])).toBe(
			'https://example.com/a?utm_source=x%20y',
		);
		expect(
			withQueryParams('https://EXAMPLE.com/a?b=1&utm_source=old#top', [['utm_source', 'new']]),
		).toBe('https://EXAMPLE.com/a?b=1&utm_source=new#top');
		expect(withQueryParams('https://example.com/?', [])).toBe('https://example.com/?');
		expect(withQueryParams('https://example.com/?&', [['a', 'b']])).toBe(
			'https://example.com/?a=b',
		);
		expect(withQueryParams('https://example.com/?%ZZ=1', [['a', 'b']])).toBe(
			'https://example.com/?%ZZ=1&a=b',
		);
	});

	it('takes named parameters out and leaves the rest', () => {
		expect(
			takeQueryParams('https://example.com/?a=1&utm_source=s+t&utm_source=u#f', ['utm_source']),
		).toEqual({
			url: 'https://example.com/?a=1#f',
			taken: new Map([['utm_source', 's t']]),
		});
		expect(takeQueryParams('https://example.com/?utm_term', ['utm_term'])).toEqual({
			url: 'https://example.com/',
			taken: new Map([['utm_term', '']]),
		});
		const untouched = takeQueryParams('https://example.com/?a=1', ['utm_source']);
		expect(untouched.url).toBe('https://example.com/?a=1');
		expect(untouched.taken.size).toBe(0);
		expect(
			takeQueryParams('https://example.com/?utm_source=%ZZ', ['utm_source']).taken.get(
				'utm_source',
			),
		).toBe('%ZZ');
	});

	it('round-trips parameters it set', () => {
		fc.assert(
			fc.property(fc.string({ unit: fc.constantFrom(...'ab &=+%#?é😀') }), (value) => {
				const url = withQueryParams('https://example.com/p?x=1', [['utm_content', value]]);
				const taken = takeQueryParams(url, ['utm_content']);
				expect(taken.url).toBe('https://example.com/p?x=1');
				expect(taken.taken.get('utm_content')).toBe(value);
			}),
		);
	});
});
