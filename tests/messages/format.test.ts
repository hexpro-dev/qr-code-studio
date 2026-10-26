/**
 * The offline catalogue's formatter: plain `{name}`, and the plural and
 * select blocks the website's formatter reads, in English. Whatever cannot be
 * filled is left as written.
 */

import { describe, expect, it } from 'vitest';
import { formatMessage, messageArguments } from '../../src/messages/format.js';

const CODES = 'Made {count, plural, =0 {no codes} one {# code} other {# codes}}.';

describe('formatMessage', () => {
	it('fills a plain placeholder, and leaves one with no param as written', () => {
		expect(formatMessage('Row {row}, column {column}.', { row: 3, column: 'B' })).toBe(
			'Row 3, column B.',
		);
		expect(formatMessage('Row {row}.')).toBe('Row {row}.');
		expect(formatMessage('Row { row }.', { row: 2 })).toBe('Row 2.');
		expect(formatMessage('No placeholders.', { row: 2 })).toBe('No placeholders.');
	});

	it('chooses a plural branch by English rules: =N, then one for exactly 1, then other', () => {
		expect(formatMessage(CODES, { count: 0 })).toBe('Made no codes.');
		expect(formatMessage(CODES, { count: 1 })).toBe('Made 1 code.');
		expect(formatMessage(CODES, { count: 2 })).toBe('Made 2 codes.');
		expect(formatMessage(CODES, { count: 1.5 })).toBe('Made 1.5 codes.');
		expect(formatMessage(CODES, { count: '1' })).toBe('Made 1 code.');
		const bare = '{n, plural, one {# square} other {# squares}}';
		expect(formatMessage(bare, { n: 0 })).toBe('0 squares');
		expect(formatMessage('{n, plural, =1 {exactly one} one {one} other {#}}', { n: 1 })).toBe(
			'exactly one',
		);
	});

	it('writes # as the param was given, and only inside a plural', () => {
		expect(formatMessage('{n, plural, other {# rows}}', { n: '10,000' })).toBe(
			'{n, plural, other {# rows}}',
		);
		expect(formatMessage('{n, plural, other {# rows}}', { n: '12' })).toBe('12 rows');
		expect(formatMessage('Item #{n}', { n: 4 })).toBe('Item #4');
		expect(formatMessage('{k, select, a {# a} other {b}}', { k: 'a' })).toBe('# a');
	});

	it('nests blocks and placeholders, with # the innermost plural count', () => {
		const nested =
			'{kind, select, logo {The logo covers {n, plural, one {# piece} other {# pieces}}} other {Nothing on {target}}}.';
		expect(formatMessage(nested, { kind: 'logo', n: 1 })).toBe('The logo covers 1 piece.');
		expect(formatMessage(nested, { kind: 'frame', n: 1, target: 'it' })).toBe('Nothing on it.');
		const inner = '{a, plural, other {# then {b, plural, one {#} other {# more}}}}';
		expect(formatMessage(inner, { a: 3, b: 1 })).toBe('3 then 1');
		expect(formatMessage(inner, { a: 3, b: 2 })).toBe('3 then 2 more');
		const pound = '{a, plural, other {{k, select, x {# x} other {#}}}}';
		expect(formatMessage(pound, { a: 5, k: 'x' })).toBe('5 x');
	});

	it('chooses a select branch by value, else other', () => {
		const names =
			'Read as {encoding, select, shift_jis {Japanese} euc-kr {Korean} other {{encoding}}}.';
		expect(formatMessage(names, { encoding: 'shift_jis' })).toBe('Read as Japanese.');
		expect(formatMessage(names, { encoding: 'euc-kr' })).toBe('Read as Korean.');
		expect(formatMessage(names, { encoding: 'big5' })).toBe('Read as big5.');
		expect(formatMessage('{k, select, a {A}}', { k: 'b' })).toBe('{k, select, a {A}}');
	});

	it('leaves a block whose param is missing or not a count as written', () => {
		expect(formatMessage(CODES)).toBe(CODES);
		expect(formatMessage(CODES, { count: 'many' })).toBe(CODES);
		expect(formatMessage(CODES, { count: ' ' })).toBe(CODES);
		expect(formatMessage(CODES, { count: Number.NaN })).toBe(CODES);
		expect(formatMessage('{n, plural, one {#}}', { n: 2 })).toBe('{n, plural, one {#}}');
		expect(formatMessage('{k, select, a {A} other {B}}')).toBe('{k, select, a {A} other {B}}');
	});

	it('reads a malformed block as text, and still fills what it can', () => {
		const cases = [
			'{n, plural, one {# row} other {# rows}',
			'{n, plural,}',
			'{n, plural, one}',
			'{n, plural, one {# row} =x {y}}',
			'{n, number}',
			'{n, plural other {x}}',
			'{}',
			'{#}',
			'a } b',
		];
		for (const template of cases)
			expect(formatMessage(template, { n: 1 }), template).toBe(template);
		expect(formatMessage('{n, plural, one {{m} row} other', { n: 1, m: 2 })).toBe(
			'{n, plural, one {2 row} other',
		);
	});

	it('keeps the first branch when a selector is repeated', () => {
		expect(formatMessage('{n, plural, one {first} one {second} other {x}}', { n: 1 })).toBe(
			'first',
		);
	});

	it('does not treat a key of Object.prototype as a param', () => {
		expect(formatMessage('{toString} {constructor, plural, other {#}}', {})).toBe(
			'{toString} {constructor, plural, other {#}}',
		);
	});
});

describe('messageArguments', () => {
	it('names every param a message reads, at any depth, once', () => {
		expect(messageArguments('No placeholders.')).toEqual([]);
		expect(messageArguments('Row {row}, column {column}, row {row}.')).toEqual(['row', 'column']);
		expect(
			messageArguments(
				'{kind, select, logo {{n, plural, one {# piece} other {{n} pieces of {total}}}} other {}}',
			),
		).toEqual(['kind', 'n', 'total']);
		// A malformed block is text, so only the placeholders in it are read.
		expect(messageArguments('{n, plural, one {#} other {{m}')).toEqual(['m']);
	});
});
