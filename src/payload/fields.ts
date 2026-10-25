/**
 * Checking a value against its field schema, and reading fields back out.
 *
 * Every content type starts its `validate` here and adds the rules its own
 * specification makes on top. The schema rules are generic on purpose: "this
 * is required" and "this is 80 characters and the limit is 70" read the same
 * beside any field, so they have one message key each rather than one per
 * field, and the issue's path says which field it is.
 *
 * Paths start at `fields`, as `core/issue.ts` documents: `['fields', 'ssid']`,
 * and `['fields', 'phones', 2]` for the third item of a list.
 *
 * A value of the wrong JavaScript type (a number where text belongs) is
 * reported as an issue rather than thrown. Values arrive from saved documents
 * and from CSV rows as well as from typed code, and validation has to be able
 * to say what is wrong with any of them.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { ibanProblem, isBic } from './banking.js';
import type { FieldKind, FieldSchema, FieldValue, PayloadValue } from './types.js';

/** The generic issue codes. Content types add their own under `payload.<id>.issue.*`. */
export const FIELD_ISSUES = {
	wrongKind: 'payload.issue.wrong-kind',
	required: 'payload.issue.required',
	tooLong: 'payload.issue.too-long',
	tooMany: 'payload.issue.too-many',
	lineBreak: 'payload.issue.line-break',
	controlCharacter: 'payload.issue.control-character',
	unpairedSurrogate: 'payload.issue.unpaired-surrogate',
	notANumber: 'payload.issue.not-a-number',
	notAnInteger: 'payload.issue.not-an-integer',
	belowMin: 'payload.issue.below-min',
	aboveMax: 'payload.issue.above-max',
	invalidOption: 'payload.issue.invalid-option',
	invalidUrl: 'payload.issue.invalid-url',
	urlScheme: 'payload.issue.url-scheme',
	invalidEmail: 'payload.issue.invalid-email',
	invalidTel: 'payload.issue.invalid-tel',
	invalidDate: 'payload.issue.invalid-date',
	invalidDatetime: 'payload.issue.invalid-datetime',
	invalidIban: 'payload.issue.invalid-iban',
	ibanCountry: 'payload.issue.iban-country',
	ibanLength: 'payload.issue.iban-length',
	ibanChecksum: 'payload.issue.iban-checksum',
	invalidBic: 'payload.issue.invalid-bic',
	amountDecimals: 'payload.issue.amount-decimals',
	invalidCurrency: 'payload.issue.invalid-currency',
	invalidCountry: 'payload.issue.invalid-country',
	invalidLatitude: 'payload.issue.invalid-latitude',
	invalidLongitude: 'payload.issue.invalid-longitude',
} as const;

const STRING_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
	'text',
	'multiline',
	'url',
	'email',
	'tel',
	'select',
	'date',
	'datetime',
	'iban',
	'bic',
	'currency',
	'country',
	'secret',
]);

const NUMBER_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
	'number',
	'integer',
	'amount',
	'latitude',
	'longitude',
]);

/** Length in code points, which is what a person counts and what most specifications mean by a character. */
export function charLength(text: string): number {
	let count = 0;
	for (const _ of text) count += 1;
	return count;
}

export function fieldPath(key: string, index?: number): readonly (string | number)[] {
	return index === undefined ? ['fields', key] : ['fields', key, index];
}

/** Text with no line breaks or control characters, which every single-line format needs. */
function characterIssues(
	text: string,
	path: readonly (string | number)[],
	multiline: boolean,
): Issue[] {
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				i += 1;
				continue;
			}
			return [issue(FIELD_ISSUES.unpairedSurrogate, path, 'error', { position: i })];
		}
		if (code >= 0xdc00 && code <= 0xdfff) {
			return [issue(FIELD_ISSUES.unpairedSurrogate, path, 'error', { position: i })];
		}
		if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) {
			if (multiline && code === 0x0a) continue;
			return [
				issue(multiline ? FIELD_ISSUES.controlCharacter : FIELD_ISSUES.lineBreak, path, 'error', {
					position: i,
				}),
			];
		}
		if (multiline && code === 0x09) continue;
		if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
			return [issue(FIELD_ISSUES.controlCharacter, path, 'error', { position: i })];
		}
	}
	return [];
}

/**
 * An email address as a QR code needs one: a dot-atom local part, a domain
 * with at least one dot, ASCII only, at most 254 characters (RFC 5321's path
 * limit less the angle brackets). Quoted local parts are valid RFC 5322 and
 * are refused here, because no phone's mail app handles one from a link.
 */
const EMAIL =
	/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isEmail(text: string): boolean {
	return text.length <= 254 && EMAIL.test(text);
}

/**
 * A phone number as a person types it: an optional leading +, digits, and
 * RFC 3966's visual separators plus spaces. Spaces are dropped when the text
 * is built, because a tel: URI cannot hold one. 3 to 15 digits: 15 is E.164's
 * maximum, and 3 lets an emergency or short code through.
 */
const TEL = /^\+?[0-9 ().-]+$/;

export function telDigits(text: string): string {
	return text.replace(/[^0-9]/g, '');
}

export function isTel(text: string): boolean {
	if (!TEL.test(text)) return false;
	const digits = telDigits(text).length;
	return digits >= 3 && digits <= 15;
}

/** The number as written into a URI: no spaces, everything else as typed. */
export function compactTel(text: string): string {
	return text.replace(/ /g, '');
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 'YYYY-MM-DD', a real calendar date. */
export function isDate(text: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** 'YYYY-MM-DDTHH:MM', with ':SS' optional, as a datetime-local input gives it. */
export function isDateTime(text: string): boolean {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
	if (!match || !isDate(match[1] as string)) return false;
	return Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4] ?? 0) <= 59;
}

/** An absolute http or https URL with a host, and no whitespace a reader could cut it at. */
function urlIssues(text: string, path: readonly (string | number)[]): Issue[] {
	if (/\s/.test(text)) return [issue(FIELD_ISSUES.invalidUrl, path)];
	let parsed: URL;
	try {
		parsed = new URL(text);
	} catch {
		return [issue(FIELD_ISSUES.invalidUrl, path)];
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return [issue(FIELD_ISSUES.urlScheme, path)];
	}
	return [];
}

/** How many decimal places a number is written with, from its shortest round-trip form. */
export function decimalPlaces(value: number): number {
	const text = String(value);
	const exponent = /e-(\d+)$/.exec(text);
	if (exponent) {
		const mantissa = text.slice(0, text.indexOf('e'));
		const dot = mantissa.indexOf('.');
		return Number(exponent[1]) + (dot === -1 ? 0 : mantissa.length - dot - 1);
	}
	const dot = text.indexOf('.');
	return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * A number written out in plain decimal, never in exponent form, with at most
 * `maxDecimals` places and no trailing zeros. `String(1e-7)` is "1e-7", which
 * no payment or geo URI accepts.
 */
export function formatDecimal(value: number, maxDecimals: number): string {
	const fixed = value.toFixed(maxDecimals);
	if (maxDecimals === 0) return fixed;
	const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
	return trimmed === '-0' ? '0' : trimmed;
}

/**
 * A number's shortest round-trip digits in plain decimal. `String()` gives
 * the right digits but switches to exponent form below 1e-6 and from 1e21,
 * and a coordinate of 1e-7 has to be written 0.0000001 to be a geo URI.
 */
export function plainNumber(value: number): string {
	const text = String(value);
	const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
	if (!match) return text;
	const [, sign, lead, rest = '', exponentText] = match as unknown as [
		string,
		string,
		string,
		string | undefined,
		string,
	];
	const digits = `${lead}${rest}`;
	const exponent = Number(exponentText);
	if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
	return `${sign}${digits}${'0'.repeat(exponent - rest.length)}`;
}

function stringItemIssues(
	field: FieldSchema,
	text: string,
	path: readonly (string | number)[],
): Issue[] {
	const found = characterIssues(text, path, field.kind === 'multiline');
	if (found.length > 0) return found;
	if (field.maxLength !== undefined) {
		const length = charLength(text);
		if (length > field.maxLength) {
			return [issue(FIELD_ISSUES.tooLong, path, 'error', { length, max: field.maxLength })];
		}
	}
	// Empty values never get here: an empty field is handled before this,
	// and an empty row of a list is skipped.
	switch (field.kind) {
		case 'url':
			return urlIssues(text, path);
		case 'email':
			return isEmail(text) ? [] : [issue(FIELD_ISSUES.invalidEmail, path)];
		case 'tel':
			return isTel(text) ? [] : [issue(FIELD_ISSUES.invalidTel, path)];
		case 'date':
			return isDate(text) ? [] : [issue(FIELD_ISSUES.invalidDate, path)];
		case 'datetime':
			return isDateTime(text) ? [] : [issue(FIELD_ISSUES.invalidDatetime, path)];
		case 'select':
			return field.options?.some((option) => option.value === text)
				? []
				: [issue(FIELD_ISSUES.invalidOption, path)];
		case 'iban': {
			const problem = ibanProblem(text);
			if (problem === undefined) return [];
			if (problem.code === 'length') {
				return [
					issue(FIELD_ISSUES.ibanLength, path, 'error', {
						length: problem.length,
						expected: problem.expected,
					}),
				];
			}
			const codes = {
				format: FIELD_ISSUES.invalidIban,
				country: FIELD_ISSUES.ibanCountry,
				checksum: FIELD_ISSUES.ibanChecksum,
			} as const;
			return [issue(codes[problem.code], path)];
		}
		case 'bic':
			return isBic(text) ? [] : [issue(FIELD_ISSUES.invalidBic, path)];
		case 'currency':
			return /^[A-Z]{3}$/.test(text) ? [] : [issue(FIELD_ISSUES.invalidCurrency, path)];
		case 'country':
			return /^[A-Z]{2}$/.test(text) ? [] : [issue(FIELD_ISSUES.invalidCountry, path)];
		default:
			return [];
	}
}

function numberIssues(
	field: FieldSchema,
	value: number,
	path: readonly (string | number)[],
): Issue[] {
	if (!Number.isFinite(value)) return [issue(FIELD_ISSUES.notANumber, path)];
	if (field.kind === 'integer' && !Number.isInteger(value)) {
		return [issue(FIELD_ISSUES.notAnInteger, path)];
	}
	if (field.kind === 'latitude' && (value < -90 || value > 90)) {
		return [issue(FIELD_ISSUES.invalidLatitude, path)];
	}
	if (field.kind === 'longitude' && (value < -180 || value > 180)) {
		return [issue(FIELD_ISSUES.invalidLongitude, path)];
	}
	if (field.min !== undefined && value < field.min) {
		return [issue(FIELD_ISSUES.belowMin, path, 'error', { min: field.min })];
	}
	if (field.max !== undefined && value > field.max) {
		return [issue(FIELD_ISSUES.aboveMax, path, 'error', { max: field.max })];
	}
	return [];
}

function isEmpty(value: FieldValue | undefined): boolean {
	return (
		value === undefined ||
		value === null ||
		value === '' ||
		(Array.isArray(value) && value.length === 0)
	);
}

function wrongKind(field: FieldSchema): Issue {
	return issue(FIELD_ISSUES.wrongKind, fieldPath(field.key), 'error', {
		expected: field.multiple ? `${field.kind}-list` : field.kind,
	});
}

function fieldIssues(field: FieldSchema, raw: FieldValue | undefined): Issue[] {
	const path = fieldPath(field.key);
	if (isEmpty(raw)) return field.required ? [issue(FIELD_ISSUES.required, path)] : [];
	if (field.multiple) {
		if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string'))
			return [wrongKind(field)];
		const items = raw as readonly string[];
		const found: Issue[] = [];
		if (field.maxItems !== undefined && items.length > field.maxItems) {
			found.push(
				issue(FIELD_ISSUES.tooMany, path, 'error', { count: items.length, max: field.maxItems }),
			);
		}
		items.forEach((item, index) => {
			// An empty row in a list is a row the person has not filled in yet,
			// and it is dropped when the text is built.
			if (item !== '') found.push(...stringItemIssues(field, item, fieldPath(field.key, index)));
		});
		if (field.required && items.every((item) => item === ''))
			found.push(issue(FIELD_ISSUES.required, path));
		return found;
	}
	if (STRING_KINDS.has(field.kind)) {
		return typeof raw === 'string' ? stringItemIssues(field, raw, path) : [wrongKind(field)];
	}
	if (NUMBER_KINDS.has(field.kind)) {
		return typeof raw === 'number' ? numberIssues(field, raw, path) : [wrongKind(field)];
	}
	return typeof raw === 'boolean' ? [] : [wrongKind(field)];
}

/** Every schema problem in the value, in field order. */
export function validateFields(fields: readonly FieldSchema[], value: PayloadValue): Issue[] {
	if (typeof value !== 'object' || value === null) {
		return [issue(FIELD_ISSUES.wrongKind, ['fields'], 'error', { expected: 'record' })];
	}
	return fields.flatMap((field) => fieldIssues(field, value[field.key]));
}

/** A string field, or '' when it is absent or not a string. */
export function textOf(value: PayloadValue, key: string): string {
	const raw = value[key];
	return typeof raw === 'string' ? raw : '';
}

/** A number field, or null when it is absent or not a number. */
export function numberOf(value: PayloadValue, key: string): number | null {
	const raw = value[key];
	return typeof raw === 'number' ? raw : null;
}

export function booleanOf(value: PayloadValue, key: string): boolean {
	return value[key] === true;
}

/** A list field without its empty rows. */
export function listOf(value: PayloadValue, key: string): readonly string[] {
	const raw = value[key];
	if (!Array.isArray(raw)) return [];
	return raw.filter((item): item is string => typeof item === 'string' && item !== '');
}
