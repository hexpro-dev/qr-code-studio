/**
 * A product link: a GS1 Digital Link URI (GS1 Digital Link Standard: URI
 * Syntax, release 1.7.0, August 2026), https://<domain>/01/<GTIN-14>, with
 * the batch (10) and serial number (21) as path qualifiers and the expiry
 * date (17) and best-before date (15) in the query.
 *
 * A curated subset of the Application Identifiers, the ones printed on a
 * pack: a till or a phone reads the same URI as a web link and as the GS1
 * data, and these are the parts both need.
 *
 * - A GTIN-8, 12 or 13 is written as 14 digits with leading zeros, as the
 *   standard has required since 1.4.0, and its check digit is checked.
 * - Qualifiers keep the order 01, 10, 21; query parameters are sorted
 *   lexically, which is the standard's canonical form.
 * - Batch and serial use GS1's character set 82, and the characters the
 *   standard lists in section 4.2 are percent-encoded (# / % & + , ! ( ) * '
 *   : ; < = > ?). The double quote is written as itself, as the standard's
 *   grammar defines it.
 * - Dates are YYMMDD, as the Application Identifiers carry them, with 00 as
 *   the day meaning the end of the month (GS1 General Specifications 3.4).
 *   The century is not decided here: that takes today's date.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { gs1CheckDigit } from '../check-digits.js';
import { definePayload, field, unparseable } from '../define.js';
import { percentDecode } from '../escape.js';
import { textOf } from '../fields.js';
import { analyseUrl } from '../url-safety.js';

const ID = 'gs1-digital-link';
const STANDARD =
	'https://ref.gs1.org/standards/digital-link/uri-syntax/1.7.0/GS1-Digital-Link-Standard-URI-Syntax-i1-7-r-2026-08-06.pdf';

export type Gs1DigitalLinkValue = {
	readonly domain: string;
	readonly gtin: string;
	readonly batch: string;
	readonly serial: string;
	readonly expiry: string;
	readonly bestBefore: string;
};

/** GS1 AI encodable character set 82 (GS1 General Specifications, figure 7.11-1). */
const SET_82 = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]*$/;
const PERCENT_ENCODED = new Set([..."#/%&+,!()*':;<=>?"]);

function encodeValue(text: string): string {
	let out = '';
	for (const char of text) {
		out += PERCENT_ENCODED.has(char)
			? `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
			: char;
	}
	return out;
}

/** The GTIN as 14 digits, or undefined when it is not 8, 12, 13 or 14 digits. */
export function gtin14(gtin: string): string | undefined {
	return /^(?:\d{8}|\d{12,14})$/.test(gtin) ? gtin.padStart(14, '0') : undefined;
}

function validDate(text: string): boolean {
	const match = /^(\d{2})(\d{2})(\d{2})$/.exec(text);
	if (!match) return false;
	const month = Number(match[2]);
	const day = Number(match[3]);
	// Without the century, 29 February is possible in any year.
	const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	return days !== undefined && day <= days;
}

const DOMAIN =
	/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(?:\/[A-Za-z0-9._~-]+)*$/;

function rules(value: Gs1DigitalLinkValue, flagged: (key: string) => boolean): Issue[] {
	const found: Issue[] = [];
	const domain = textOf(value, 'domain');
	if (domain !== '' && !flagged('domain') && !DOMAIN.test(domain)) {
		found.push(issue('payload.gs1-digital-link.issue.domain', ['fields', 'domain']));
	}
	const gtin = textOf(value, 'gtin');
	if (gtin !== '' && !flagged('gtin')) {
		const full = gtin14(gtin);
		if (full === undefined)
			found.push(issue('payload.gs1-digital-link.issue.gtin', ['fields', 'gtin']));
		else if (gs1CheckDigit(full.slice(0, 13)) !== Number(full[13])) {
			found.push(issue('payload.gs1-digital-link.issue.gtin-check-digit', ['fields', 'gtin']));
		}
	}
	for (const key of ['batch', 'serial']) {
		if (!flagged(key) && !SET_82.test(textOf(value, key))) {
			found.push(issue('payload.gs1-digital-link.issue.character', ['fields', key]));
		}
	}
	for (const key of ['expiry', 'bestBefore']) {
		const date = textOf(value, key);
		if (date !== '' && !flagged(key) && !validDate(date)) {
			found.push(issue('payload.gs1-digital-link.issue.date', ['fields', key]));
		}
	}
	return found;
}

function write(value: Gs1DigitalLinkValue): string {
	let path = `/01/${gtin14(textOf(value, 'gtin')) as string}`;
	if (textOf(value, 'batch') !== '') path += `/10/${encodeValue(textOf(value, 'batch'))}`;
	if (textOf(value, 'serial') !== '') path += `/21/${encodeValue(textOf(value, 'serial'))}`;
	const query: string[] = [];
	if (textOf(value, 'bestBefore') !== '') query.push(`15=${textOf(value, 'bestBefore')}`);
	if (textOf(value, 'expiry') !== '') query.push(`17=${textOf(value, 'expiry')}`);
	// A host is case-insensitive and the path prefix is not, so only the host
	// is lowered, which is also how it reads back.
	const domain = textOf(value, 'domain');
	const slash = domain.indexOf('/');
	const host =
		slash === -1
			? domain.toLowerCase()
			: `${domain.slice(0, slash).toLowerCase()}${domain.slice(slash)}`;
	return `https://${host}${path}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}

function parse(text: string): Gs1DigitalLinkValue {
	const match =
		/^https?:\/\/([^/?#]+)((?:\/[^/?#]+)*?)\/01\/(\d{14}|\d{13}|\d{12}|\d{8})((?:\/[^/?#]+)*)\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(
			text,
		);
	if (!match) throw unparseable(ID, 'not-digital-link');
	const [, host, prefix = '', gtin, qualifiers = '', query = ''] = match as unknown as [
		string,
		string,
		string,
		string,
		string,
		string,
	];
	const parts = qualifiers.split('/').slice(1);
	if (parts.length % 2 !== 0) throw unparseable(ID, 'qualifiers');
	const found = new Map<string, string>();
	let order = 0;
	for (let i = 0; i < parts.length; i += 2) {
		const ai = parts[i] as string;
		// Only 10 then 21, each once, in that order (section 4.6).
		const rank = ai === '10' ? 1 : ai === '21' ? 2 : 0;
		if (rank <= order) throw unparseable(ID, 'qualifiers');
		order = rank;
		const decoded = percentDecode(parts[i + 1] as string);
		if (decoded === undefined) throw unparseable(ID, 'malformed-escape');
		found.set(ai, decoded);
	}
	for (const pair of query.split(/[&;]/)) {
		const [key = '', raw = ''] = pair.split('=');
		if (key === '17' || key === '15') found.set(key, raw);
	}
	return {
		domain: `${host.toLowerCase()}${prefix}`,
		gtin: gtin14(gtin) as string,
		batch: found.get('10') ?? '',
		serial: found.get('21') ?? '',
		expiry: found.get('17') ?? '',
		bestBefore: found.get('15') ?? '',
	};
}

export const gs1DigitalLinkType = definePayload<Gs1DigitalLinkValue>({
	id: ID,
	category: 'commerce',
	fields: [
		field(ID, 'domain', 'text', {
			required: true,
			default: 'id.gs1.org',
			maxLength: 253,
			hint: true,
		}),
		field(ID, 'gtin', 'text', { required: true, maxLength: 14, hint: true }),
		field(ID, 'batch', 'text', { maxLength: 20 }),
		field(ID, 'serial', 'text', { maxLength: 20 }),
		field(ID, 'expiry', 'text', { maxLength: 6, hint: true }),
		field(ID, 'bestBefore', 'text', { maxLength: 6, hint: true }),
	],
	rules,
	write,
	detect: (text) => {
		try {
			parse(text);
			return 0.9;
		} catch {
			return 0;
		}
	},
	parse,
	safety: (value) =>
		gtin14(textOf(value, 'gtin')) === undefined ? [] : analyseUrl(write(value)).findings,
	vectors: [
		{
			text: 'https://id.gs1.org/01/09520123456788/10/ABC1/21/12345?17=180426',
			value: {
				domain: 'id.gs1.org',
				gtin: '09520123456788',
				batch: 'ABC1',
				serial: '12345',
				expiry: '180426',
				bestBefore: '',
			},
			source: `GS1 Digital Link Standard: URI Syntax 1.7.0, section 5.5 example. ${STANDARD}`,
		},
	],
});
