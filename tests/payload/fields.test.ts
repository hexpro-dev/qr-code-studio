import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import {
	definePayload,
	field,
	invalidPayload,
	keySegment,
	unparseable,
} from '../../src/payload/define.js';
import {
	booleanOf,
	charLength,
	compactTel,
	decimalPlaces,
	FIELD_ISSUES,
	formatDecimal,
	isDate,
	isDateTime,
	isEmail,
	isTel,
	listOf,
	numberOf,
	plainNumber,
	textOf,
	validateFields,
} from '../../src/payload/fields.js';
import type { FieldKind, FieldSchema, PayloadValue } from '../../src/payload/types.js';

const one = (kind: FieldKind, extras: Partial<FieldSchema> = {}): FieldSchema => ({
	key: 'f',
	kind,
	labelKey: 'payload.test.field.f',
	...extras,
});

function codes(schema: FieldSchema, value: unknown): string[] {
	return validateFields([schema], { f: value } as PayloadValue).map((found) => found.code);
}

describe('validateFields', () => {
	it('reports a required field that is empty, in any of its empty forms', () => {
		for (const empty of [undefined, null, '', []]) {
			expect(codes(one('text', { required: true }), empty)).toEqual([FIELD_ISSUES.required]);
		}
		expect(codes(one('text'), '')).toEqual([]);
	});

	it('reports a value of the wrong kind rather than throwing', () => {
		expect(codes(one('text'), 3)).toEqual([FIELD_ISSUES.wrongKind]);
		expect(codes(one('number'), '3')).toEqual([FIELD_ISSUES.wrongKind]);
		expect(codes(one('boolean'), 'yes')).toEqual([FIELD_ISSUES.wrongKind]);
		expect(codes(one('email', { multiple: true }), 'a@example.com')).toEqual([
			FIELD_ISSUES.wrongKind,
		]);
		expect(codes(one('email', { multiple: true }), [1])).toEqual([FIELD_ISSUES.wrongKind]);
		expect(validateFields([one('text')], null as unknown as PayloadValue)).toEqual([
			{
				code: FIELD_ISSUES.wrongKind,
				path: ['fields'],
				severity: 'error',
				params: { expected: 'record' },
			},
		]);
		expect(validateFields([one('tel', { multiple: true })], { f: 7 })[0]?.params).toEqual({
			expected: 'tel-list',
		});
	});

	it('counts length in code points and says by how much', () => {
		const found = validateFields([one('text', { maxLength: 3 })], { f: 'a😀bc' });
		expect(found).toEqual([
			{
				code: FIELD_ISSUES.tooLong,
				path: ['fields', 'f'],
				severity: 'error',
				params: { length: 4, max: 3 },
			},
		]);
		expect(codes(one('text', { maxLength: 3 }), '😀😀😀')).toEqual([]);
	});

	it('keeps line breaks and control characters out of single-line text', () => {
		expect(codes(one('text'), 'a\nb')).toEqual([FIELD_ISSUES.lineBreak]);
		expect(codes(one('text'), 'a\rb')).toEqual([FIELD_ISSUES.lineBreak]);
		expect(codes(one('text'), 'a\u2028b')).toEqual([FIELD_ISSUES.lineBreak]);
		expect(codes(one('text'), 'a\tb')).toEqual([FIELD_ISSUES.controlCharacter]);
		expect(codes(one('text'), 'a\u0085b')).toEqual([FIELD_ISSUES.controlCharacter]);
		expect(codes(one('multiline'), 'a\nb\tc')).toEqual([]);
		expect(codes(one('multiline'), 'a\r\nb')).toEqual([FIELD_ISSUES.controlCharacter]);
		expect(codes(one('multiline'), 'a\u0000b')).toEqual([FIELD_ISSUES.controlCharacter]);
	});

	it('reports half a surrogate pair, which cannot be written as UTF-8', () => {
		expect(codes(one('text'), 'a\ud800b')).toEqual([FIELD_ISSUES.unpairedSurrogate]);
		expect(codes(one('text'), 'a\udc00')).toEqual([FIELD_ISSUES.unpairedSurrogate]);
		expect(codes(one('text'), '\ud800')).toEqual([FIELD_ISSUES.unpairedSurrogate]);
		expect(codes(one('text'), '😀')).toEqual([]);
	});

	it('checks each kind of text', () => {
		expect(codes(one('url'), 'https://example.com/')).toEqual([]);
		expect(codes(one('url'), 'example.com')).toEqual([FIELD_ISSUES.invalidUrl]);
		expect(codes(one('url'), 'https://example.com/a b')).toEqual([FIELD_ISSUES.invalidUrl]);
		expect(codes(one('url'), 'ftp://example.com/')).toEqual([FIELD_ISSUES.urlScheme]);
		expect(codes(one('email'), 'someone@example.com')).toEqual([]);
		expect(codes(one('email'), 'someone@localhost')).toEqual([FIELD_ISSUES.invalidEmail]);
		expect(codes(one('tel'), '+61 400 000 000')).toEqual([]);
		expect(codes(one('tel'), '12')).toEqual([FIELD_ISSUES.invalidTel]);
		expect(codes(one('date'), '2026-02-29')).toEqual([FIELD_ISSUES.invalidDate]);
		expect(codes(one('date'), '2028-02-29')).toEqual([]);
		expect(codes(one('datetime'), '2026-10-25T24:00')).toEqual([FIELD_ISSUES.invalidDatetime]);
		expect(codes(one('select', { options: [{ value: 'a', labelKey: 'x' }] }), 'b')).toEqual([
			FIELD_ISSUES.invalidOption,
		]);
		expect(codes(one('select'), 'b')).toEqual([FIELD_ISSUES.invalidOption]);
		expect(codes(one('iban'), 'GB82 WEST 1234 5698 7654 32')).toEqual([]);
		expect(codes(one('iban'), 'GB82WEST12345698765433')).toEqual([FIELD_ISSUES.ibanChecksum]);
		expect(codes(one('iban'), 'XX82WEST12345698765432')).toEqual([FIELD_ISSUES.ibanCountry]);
		expect(codes(one('iban'), 'not an iban')).toEqual([FIELD_ISSUES.invalidIban]);
		expect(validateFields([one('iban')], { f: 'GB82WEST1234569876543' })[0]?.params).toEqual({
			length: 21,
			expected: 22,
		});
		expect(codes(one('bic'), 'DEUTDEFF')).toEqual([]);
		expect(codes(one('bic'), 'DEUT')).toEqual([FIELD_ISSUES.invalidBic]);
		expect(codes(one('currency'), 'EUR')).toEqual([]);
		expect(codes(one('currency'), 'eur')).toEqual([FIELD_ISSUES.invalidCurrency]);
		expect(codes(one('country'), 'CH')).toEqual([]);
		expect(codes(one('country'), 'CHE')).toEqual([FIELD_ISSUES.invalidCountry]);
		expect(codes(one('secret'), 'anything at all')).toEqual([]);
	});

	it('checks numbers against their kind and range', () => {
		expect(codes(one('number'), Number.NaN)).toEqual([FIELD_ISSUES.notANumber]);
		expect(codes(one('number'), Number.POSITIVE_INFINITY)).toEqual([FIELD_ISSUES.notANumber]);
		expect(codes(one('integer'), 1.5)).toEqual([FIELD_ISSUES.notAnInteger]);
		expect(codes(one('latitude'), 90.5)).toEqual([FIELD_ISSUES.invalidLatitude]);
		expect(codes(one('longitude'), -180.5)).toEqual([FIELD_ISSUES.invalidLongitude]);
		expect(validateFields([one('amount', { min: 0.01 })], { f: 0 })[0]?.params).toEqual({
			min: 0.01,
		});
		expect(validateFields([one('amount', { max: 10 })], { f: 11 })[0]?.params).toEqual({ max: 10 });
		expect(codes(one('number'), null)).toEqual([]);
	});

	it('checks every item of a list, drops empty rows and limits the count', () => {
		const list = one('email', { multiple: true, maxItems: 2, required: true });
		expect(
			validateFields([list], { f: ['a@example.com', '', 'nope', 'b@example.com'] }).map((found) => [
				found.code,
				found.path,
			]),
		).toEqual([
			[FIELD_ISSUES.tooMany, ['fields', 'f']],
			[FIELD_ISSUES.invalidEmail, ['fields', 'f', 2]],
		]);
		expect(codes(list, ['', ''])).toEqual([FIELD_ISSUES.required]);
		expect(codes(one('email', { multiple: true }), ['a@example.com'])).toEqual([]);
	});

	it('never puts the value into an issue', () => {
		const secret = 'correct horse battery staple';
		const found = validateFields([one('email', { maxLength: 5 })], { f: secret });
		expect(JSON.stringify(found)).not.toContain(secret);
	});
});

describe('field helpers', () => {
	it('read fields leniently', () => {
		const value: PayloadValue = { s: 'x', n: 2, b: true, l: ['a', '', 'b'] };
		expect(textOf(value, 's')).toBe('x');
		expect(textOf(value, 'n')).toBe('');
		expect(numberOf(value, 'n')).toBe(2);
		expect(numberOf(value, 's')).toBeNull();
		expect(booleanOf(value, 'b')).toBe(true);
		expect(booleanOf(value, 's')).toBe(false);
		expect(listOf(value, 'l')).toEqual(['a', 'b']);
		expect(listOf(value, 's')).toEqual([]);
	});

	it('check dates, times, emails and numbers', () => {
		expect(isDate('2026-13-01')).toBe(false);
		expect(isDate('2026-04-31')).toBe(false);
		expect(isDate('1900-02-29')).toBe(false);
		expect(isDate('2000-02-29')).toBe(true);
		expect(isDate('26-01-01')).toBe(false);
		expect(isDateTime('2026-10-25T09:30')).toBe(true);
		expect(isDateTime('2026-10-25T09:30:59')).toBe(true);
		expect(isDateTime('2026-10-25T09:60')).toBe(false);
		expect(isDateTime('2026-10-25T09:30:60')).toBe(false);
		expect(isDateTime('2026-02-30T09:30')).toBe(false);
		expect(isEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
		expect(isTel('+1234567890123456')).toBe(false);
		expect(isTel('+61-400 (000) 000.0')).toBe(true);
		expect(compactTel('+61 400 000 000')).toBe('+61400000000');
		expect(charLength('a😀')).toBe(2);
	});

	it('write numbers in plain decimal and count their places', () => {
		expect(formatDecimal(12.3, 2)).toBe('12.3');
		expect(formatDecimal(12, 2)).toBe('12');
		expect(formatDecimal(0.00000001, 8)).toBe('0.00000001');
		expect(formatDecimal(-0.0000001, 2)).toBe('0');
		expect(formatDecimal(5, 0)).toBe('5');
		expect(plainNumber(1e-7)).toBe('0.0000001');
		expect(plainNumber(-1.25e-7)).toBe('-0.000000125');
		expect(plainNumber(1e21)).toBe('1000000000000000000000');
		expect(plainNumber(1.5e22)).toBe('15000000000000000000000');
		expect(plainNumber(48.201)).toBe('48.201');
		expect(Number(plainNumber(1.2345678901234e-7))).toBe(1.2345678901234e-7);
		expect(decimalPlaces(12)).toBe(0);
		expect(decimalPlaces(12.25)).toBe(2);
		expect(decimalPlaces(1e-7)).toBe(7);
		expect(decimalPlaces(1.5e-7)).toBe(8);
	});
});

describe('definePayload', () => {
	const type = definePayload<{ readonly name: string }>({
		id: 'example',
		category: 'text',
		fields: [field('example', 'name', 'text', { required: true, hint: true, options: ['a-b'] })],
		write: (value) => `EXAMPLE:${value.name}`,
		detect: () => 0,
		parse: (text) => {
			throw unparseable('example', text.length > 3 ? 'long' : 'short');
		},
		vectors: [],
	});

	it('names message keys after the type and the field', () => {
		expect(type.labelKey).toBe('payload.example.label');
		expect(type.descriptionKey).toBe('payload.example.description');
		expect(type.actionKey).toBe('payload.example.action');
		expect(type.fields[0]?.labelKey).toBe('payload.example.field.name');
		expect(type.fields[0]?.hintKey).toBe('payload.example.hint.name');
		expect(type.fields[0]?.options).toEqual([
			{ value: 'a-b', labelKey: 'payload.example.option.name.a-b' },
		]);
		expect(keySegment('anonymousIdentity')).toBe('anonymous-identity');
		expect(Object.isFrozen(type)).toBe(true);
		expect('generate' in type).toBe(false);
	});

	it('keeps vectors a type brings with it, and adds none to one that brings none', () => {
		// A type from outside this package may carry its vectors inline, and
		// conformance runs them; the built-ins carry theirs in ./vectors.
		expect(type.vectors).toEqual([]);
		const bare = definePayload<{ readonly name: string }>({
			id: 'bare',
			category: 'text',
			fields: [],
			write: () => '',
			detect: () => 0,
			parse: () => ({ name: '' }),
		});
		expect('vectors' in bare).toBe(false);
	});

	it('refuses to build a value with an error, without saying what the value was', () => {
		expect(() => type.build({ name: '' })).toThrow(TypeError);
		expect(type.build({ name: 'x' }).text).toBe('EXAMPLE:x');
		try {
			type.build({ name: 12 as unknown as string });
		} catch (error) {
			expect((error as Error).message).not.toContain('12');
		}
	});

	it('throws content-free errors from parsing', () => {
		const secret = 'a private value';
		try {
			type.parse(secret);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).code).toBe('payload/unparseable');
			expect((error as QrStudioError).message).not.toContain(secret);
			expect(JSON.stringify((error as QrStudioError).params)).not.toContain(secret);
		}
		const invalid = invalidPayload('example', 'crc');
		expect(invalid.code).toBe('payload/invalid');
		expect(invalid.params).toEqual({ type: 'example', reason: 'crc' });
	});

	it('does not run the specification rules on a value that is not a record', () => {
		const ruled = definePayload<{ readonly name: string }>({
			id: 'ruled',
			category: 'text',
			fields: [],
			rules: () => {
				throw new Error('rules ran');
			},
			write: () => '',
			detect: () => 0,
			parse: () => ({ name: '' }),
			vectors: [],
		});
		expect(ruled.validate(null as unknown as { name: string })).toHaveLength(1);
	});
});
