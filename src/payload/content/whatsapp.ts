/**
 * A WhatsApp chat with a number, optionally with a message typed in ready to
 * send: WhatsApp's "click to chat" link (faq.whatsapp.com/5913398998672934),
 * https://wa.me/<number>?text=<message>.
 *
 * WhatsApp asks for the number in full international format with no plus,
 * zeros, brackets or dashes, so the field takes it the way a person writes it
 * (with the +) and the link carries the digits. The older
 * api.whatsapp.com/send?phone= form and the app's whatsapp://send are read
 * too.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { parseQuery } from '../escape.js';
import { telDigits, textOf } from '../fields.js';

const ID = 'whatsapp';
const FAQ = 'https://faq.whatsapp.com/5913398998672934';

export type WhatsappValue = { readonly number: string; readonly message: string };

function write(value: WhatsappValue): string {
	const message = textOf(value, 'message');
	const link = `https://wa.me/${telDigits(textOf(value, 'number'))}`;
	return message === '' ? link : `${link}?text=${encodeURIComponent(message)}`;
}

function rules(value: WhatsappValue, flagged: (key: string) => boolean): Issue[] {
	const number = textOf(value, 'number');
	if (flagged('number') || number.startsWith('+')) return [];
	return [issue('payload.whatsapp.issue.international', ['fields', 'number'])];
}

interface Located {
	readonly digits: string;
	readonly query: string;
}

function locate(text: string): Located | undefined {
	const wa = /^https?:\/\/wa\.me\/(\d{3,15})\/?(?:\?(.*))?$/i.exec(text);
	if (wa) return { digits: wa[1] as string, query: wa[2] ?? '' };
	const api =
		/^(?:https?:\/\/(?:api|web)\.whatsapp\.com\/send\/?|whatsapp:\/\/send\/?)\?(.*)$/i.exec(text);
	if (!api) return undefined;
	const pairs = parseQuery(api[1] as string, true) ?? [];
	const phone = pairs.find(([name]) => name === 'phone')?.[1] ?? '';
	const digits = telDigits(phone);
	if (digits.length < 3 || digits.length > 15) return undefined;
	const rest = pairs.filter(([name]) => name === 'text');
	return { digits, query: rest.map(([, v]) => `text=${encodeURIComponent(v)}`).join('&') };
}

function parse(text: string): WhatsappValue {
	const found = locate(text);
	if (found === undefined) throw unparseable(ID, 'not-whatsapp');
	// WhatsApp's own links write a space in the message as either %20 or +.
	const pairs = parseQuery(found.query, true);
	if (pairs === undefined) throw unparseable(ID, 'malformed-escape');
	const message = pairs.find(([name]) => name === 'text')?.[1] ?? '';
	return { number: `+${found.digits}`, message };
}

export const whatsappType = definePayload<WhatsappValue>({
	id: ID,
	category: 'message',
	fields: [
		field(ID, 'number', 'tel', { required: true, hint: true }),
		field(ID, 'message', 'multiline', { maxLength: 1000 }),
	],
	compatibility: [{ reader: 'whatsapp', noteKey: 'payload.whatsapp.compat.app', source: FAQ }],
	rules,
	write,
	detect: (text) => (locate(text) === undefined ? 0 : 0.9),
	parse,
	safety: () => [{ code: 'payload/sends-message', severity: 'note' }],
	vectors: [
		{
			text: 'https://wa.me/15551234567',
			value: { number: '+15551234567', message: '' },
			source: `WhatsApp Help Centre, "How to use click to chat", ${FAQ}.`,
		},
		{
			text: "https://wa.me/15551234567?text=I'm%20interested%20in%20your%20car%20for%20sale",
			value: { number: '+15551234567', message: "I'm interested in your car for sale" },
			source: `WhatsApp Help Centre, "How to use click to chat", ${FAQ}.`,
		},
	],
});
