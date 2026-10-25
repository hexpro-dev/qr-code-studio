/**
 * A text message ready to send.
 *
 * Built as SMSTO:number:message, the form ZXing introduced and both phone
 * platforms' cameras read (ZXing wiki, "Barcode Contents"). Read from that
 * form, its MMSTO: twin, and RFC 5724's sms: URI with ?body=, which is the
 * standard one and the one fewer cameras handle. RFC 5724 allows several
 * recipients; this type has one number, so the first is kept.
 *
 * The message runs to the end of the text in SMSTO:, colons included, which
 * is why the number may not contain one.
 */

import { definePayload, field, unparseable } from '../define.js';
import { compactTel, textOf } from '../fields.js';
import { parseQuery, percentDecode } from '../escape.js';

const ID = 'sms';

export type SmsValue = { readonly number: string; readonly message: string };

function write(value: SmsValue): string {
	const number = compactTel(textOf(value, 'number'));
	const message = textOf(value, 'message');
	return message === '' ? `SMSTO:${number}` : `SMSTO:${number}:${message}`;
}

function parseSmsto(text: string): SmsValue {
	const rest = text.slice(6);
	const colon = rest.indexOf(':');
	const number = colon === -1 ? rest : rest.slice(0, colon);
	if (number === '') throw unparseable(ID, 'missing-number');
	return { number, message: colon === -1 ? '' : rest.slice(colon + 1) };
}

/** sms:+15105550101,+15105550102?body=hello%20there (RFC 5724 section 2). */
function parseSmsUri(text: string): SmsValue {
	const rest = text.slice(text.indexOf(':') + 1).replace(/^\/\//, '');
	const mark = rest.indexOf('?');
	const recipients = mark === -1 ? rest : rest.slice(0, mark);
	const pairs = parseQuery(mark === -1 ? '' : rest.slice(mark + 1));
	// The first recipient, without RFC 5724's per-recipient parameters.
	const number = percentDecode((recipients.split(',')[0] as string).split(';')[0] as string);
	if (pairs === undefined || number === undefined) throw unparseable(ID, 'malformed-escape');
	if (number === '') throw unparseable(ID, 'missing-number');
	const body = pairs.find(([name]) => name.toLowerCase() === 'body');
	return { number, message: body ? body[1] : '' };
}

function parse(text: string): SmsValue {
	if (/^(?:smsto|mmsto):/i.test(text)) return parseSmsto(text);
	if (/^(?:sms|mms):/i.test(text)) return parseSmsUri(text);
	throw unparseable(ID, 'not-sms');
}

export const smsType = definePayload<SmsValue>({
	id: ID,
	category: 'message',
	fields: [
		field(ID, 'number', 'tel', { required: true, hint: true }),
		field(ID, 'message', 'multiline', { maxLength: 1600 }),
	],
	write,
	detect: (text) => (/^(?:smsto|mmsto|sms|mms):/i.test(text) ? 1 : 0),
	parse,
	safety: () => [{ code: 'payload/sends-message', severity: 'note' }],
	vectors: [
		{
			text: 'SMSTO:+61400000000:Hello from the example',
			value: { number: '+61400000000', message: 'Hello from the example' },
			source: 'ZXing wiki, Barcode Contents, "SMS": SMSTO:number:message.',
		},
		{
			text: 'sms:+15105550101?body=hello%20there',
			value: { number: '+15105550101', message: 'hello there' },
			source: 'RFC 5724 section 2.5.',
		},
	],
});
