/**
 * A phone number to call: a tel: URI (RFC 3966).
 *
 * RFC 3966 allows the visual separators "-", ".", "(" and ")" in a number but
 * not spaces, so spaces a person types are dropped and everything else is kept
 * as written. Parameters such as ";ext=" are not offered: phone cameras dial
 * the number and ignore them.
 *
 * Star and hash codes are refused on purpose. They are service codes rather
 * than numbers, and a printed code that dials one is a known way to change a
 * phone's settings without the person meaning to.
 */

import { definePayload, field, unparseable } from '../define.js';
import { compactTel, textOf } from '../fields.js';
import { percentDecode } from '../escape.js';

const ID = 'phone';

export type PhoneValue = { readonly number: string };

function parse(text: string): PhoneValue {
	if (!/^tel:/i.test(text)) throw unparseable(ID, 'not-tel');
	const rest = text.slice(4).replace(/^\/\//, '');
	const number = percentDecode(rest.split(';')[0] as string);
	if (number === undefined || number === '') throw unparseable(ID, 'missing-number');
	return { number };
}

export const phoneType = definePayload<PhoneValue>({
	id: ID,
	category: 'contact',
	fields: [field(ID, 'number', 'tel', { required: true, hint: true })],
	write: (value) => `tel:${compactTel(textOf(value, 'number'))}`,
	detect: (text) => (/^tel:/i.test(text) ? 1 : 0),
	parse,
	vectors: [
		{
			text: 'tel:+1-201-555-0123',
			value: { number: '+1-201-555-0123' },
			source: 'RFC 3966 section 6, first example.',
		},
	],
});
