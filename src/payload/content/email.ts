/**
 * An email ready to send: a mailto: URI (RFC 6068).
 *
 * Built as mailto:, which every phone opens in its mail app. DoCoMo's older
 * MATMSG: form is read as well, because codes made with it are still about,
 * and is explained as the same thing.
 *
 * RFC 6068 section 5 asks for line breaks in the body as %0D%0A, so a body
 * typed with newlines is written that way and read back with plain newlines.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { backslashUnescape, parseQuery, percentDecode, splitUnescaped } from '../escape.js';
import { listOf, textOf } from '../fields.js';

const ID = 'email';

export type EmailValue = {
	readonly to: readonly string[];
	readonly cc: readonly string[];
	readonly bcc: readonly string[];
	readonly subject: string;
	readonly body: string;
};

/**
 * An address in a mailto: URI. encodeURIComponent leaves the unreserved
 * characters alone; "@" and "+" are put back because RFC 6068's qchar allows
 * both and an address is unreadable without the first.
 */
function encodeAddress(address: string): string {
	return encodeURIComponent(address).replace(/%40/g, '@').replace(/%2B/g, '+');
}

function write(value: EmailValue): string {
	const query: string[] = [];
	const cc = listOf(value, 'cc');
	const bcc = listOf(value, 'bcc');
	if (cc.length > 0) query.push(`cc=${cc.map(encodeAddress).join(',')}`);
	if (bcc.length > 0) query.push(`bcc=${bcc.map(encodeAddress).join(',')}`);
	const subject = textOf(value, 'subject');
	if (subject !== '') query.push(`subject=${encodeURIComponent(subject)}`);
	const body = textOf(value, 'body');
	if (body !== '') query.push(`body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`);
	const to = listOf(value, 'to').map(encodeAddress).join(',');
	return `mailto:${to}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}

function addresses(text: string): string[] {
	return text
		.split(',')
		.map((address) => address.trim())
		.filter((address) => address !== '');
}

function parseMailto(text: string): EmailValue {
	const rest = text.slice('mailto:'.length);
	const mark = rest.indexOf('?');
	const toPart = percentDecode(mark === -1 ? rest : rest.slice(0, mark));
	const pairs = parseQuery(mark === -1 ? '' : rest.slice(mark + 1));
	if (toPart === undefined || pairs === undefined) throw unparseable(ID, 'malformed-escape');
	const to = addresses(toPart);
	const cc: string[] = [];
	const bcc: string[] = [];
	let subject = '';
	let body = '';
	for (const [name, raw] of pairs) {
		switch (name.toLowerCase()) {
			case 'to':
				to.push(...addresses(raw));
				break;
			case 'cc':
				cc.push(...addresses(raw));
				break;
			case 'bcc':
				bcc.push(...addresses(raw));
				break;
			case 'subject':
				subject = raw;
				break;
			case 'body':
				body = raw.replace(/\r\n/g, '\n');
				break;
			default:
				// RFC 6068 allows any header here; a phone ignores all but these.
				break;
		}
	}
	return { to, cc, bcc, subject, body };
}

/** MATMSG:TO:address;SUB:subject;BODY:body;; with MECARD's backslash escaping. */
function parseMatmsg(text: string): EmailValue {
	let to = '';
	let subject = '';
	let body = '';
	for (const piece of splitUnescaped(text.slice('MATMSG:'.length), ';')) {
		const colon = piece.indexOf(':');
		if (colon === -1) continue;
		const value = backslashUnescape(piece.slice(colon + 1));
		const name = piece.slice(0, colon).toUpperCase();
		if (name === 'TO') to = value;
		else if (name === 'SUB') subject = value;
		else if (name === 'BODY') body = value;
	}
	if (to === '') throw unparseable(ID, 'missing-recipient');
	return { to: addresses(to), cc: [], bcc: [], subject, body };
}

function parse(text: string): EmailValue {
	if (/^mailto:/i.test(text)) return parseMailto(text);
	if (/^MATMSG:/i.test(text)) return parseMatmsg(text);
	throw unparseable(ID, 'not-mailto');
}

function rules(value: EmailValue): Issue[] {
	const recipients = ['to', 'cc', 'bcc'].reduce(
		(count, key) => count + listOf(value, key).length,
		0,
	);
	return recipients === 0 ? [issue('payload.email.issue.no-recipient', ['fields', 'to'])] : [];
}

const addressList = (key: string, advanced: boolean) =>
	field(ID, key, 'email', { multiple: true, maxItems: 20, ...(advanced ? { advanced } : {}) });

export const emailType = definePayload<EmailValue>({
	id: ID,
	category: 'message',
	fields: [
		addressList('to', false),
		addressList('cc', true),
		addressList('bcc', true),
		field(ID, 'subject', 'text', { maxLength: 255 }),
		field(ID, 'body', 'multiline'),
	],
	rules,
	write,
	detect: (text) => {
		if (/^mailto:/i.test(text)) return 1;
		return /^MATMSG:/i.test(text) ? 0.95 : 0;
	},
	parse,
	safety: () => [{ code: 'payload/sends-message', severity: 'note' }],
});
