/**
 * A UPI payment (India): upi://pay with pa (the payee's address), pn (their
 * name), and optionally am (the amount), cu (always INR) and tn (a note), from
 * NPCI's "UPI Linking Specifications" (version 1.6, November 2017,
 * "Common URL Specifications for Deep Linking and Proximity Integration").
 *
 * The specification asks for spaces as %20 under RFC 3986 and gives no
 * syntax for a payment address beyond name@handle, so the address check here
 * is the shape every UPI app accepts rather than a rule from NPCI: letters,
 * digits, dot, hyphen and underscore, an @, then a handle that starts with a
 * letter. Merchant parameters (mc, tr, mode, sign, orgid) belong to signed
 * merchant codes, which only a bank can issue, and are not offered.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { parseQuery } from '../escape.js';
import { decimalPlaces, FIELD_ISSUES, numberOf, textOf } from '../fields.js';

const ID = 'upi';
const NPCI = 'NPCI, UPI Linking Specifications version 1.6, section 3 (URL specification)';

export type UpiValue = {
	readonly address: string;
	readonly name: string;
	readonly amount: number | null;
	readonly note: string;
};

const ADDRESS = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;

function encode(text: string): string {
	// The @ of a payment address is written as it is; every app reads it, and
	// several do not decode %40 in pa.
	return encodeURIComponent(text).replace(/%40/g, '@');
}

function rules(value: UpiValue, flagged: (key: string) => boolean): Issue[] {
	const found: Issue[] = [];
	const address = textOf(value, 'address');
	if (address !== '' && !flagged('address') && !ADDRESS.test(address)) {
		found.push(issue('payload.upi.issue.address', ['fields', 'address']));
	}
	const amount = numberOf(value, 'amount');
	if (amount !== null && !flagged('amount') && decimalPlaces(amount) > 2) {
		found.push(issue(FIELD_ISSUES.amountDecimals, ['fields', 'amount'], 'error', { max: 2 }));
	}
	return found;
}

function write(value: UpiValue): string {
	const query = [`pa=${encode(textOf(value, 'address'))}`, `pn=${encode(textOf(value, 'name'))}`];
	const amount = numberOf(value, 'amount');
	if (amount !== null) query.push(`am=${amount.toFixed(2)}`);
	query.push('cu=INR');
	if (textOf(value, 'note') !== '') query.push(`tn=${encode(textOf(value, 'note'))}`);
	return `upi://pay?${query.join('&')}`;
}

function parse(text: string): UpiValue {
	const match = /^upi:\/\/pay\?(.*)$/i.exec(text);
	if (!match) throw unparseable(ID, 'not-upi');
	const pairs = parseQuery(match[1] as string);
	if (pairs === undefined) throw unparseable(ID, 'malformed-escape');
	const get = (name: string) => pairs.find(([key]) => key === name)?.[1];
	const address = get('pa');
	if (address === undefined || address === '') throw unparseable(ID, 'missing-address');
	const currency = get('cu');
	if (currency !== undefined && currency !== 'INR') throw unparseable(ID, 'currency');
	const amountText = get('am');
	if (amountText !== undefined && amountText !== '' && !/^\d+(?:\.\d{1,2})?$/.test(amountText)) {
		throw unparseable(ID, 'amount');
	}
	return {
		address,
		name: get('pn') ?? '',
		amount: amountText === undefined || amountText === '' ? null : Number(amountText),
		note: get('tn') ?? '',
	};
}

export const upiType = definePayload<UpiValue>({
	id: ID,
	category: 'payment',
	fields: [
		field(ID, 'address', 'text', { required: true, maxLength: 321, hint: true }),
		field(ID, 'name', 'text', { required: true, maxLength: 99 }),
		field(ID, 'amount', 'amount', { min: 0.01, max: 1000000 }),
		field(ID, 'note', 'text', { maxLength: 80 }),
	],
	rules,
	write,
	detect: (text) => (/^upi:\/\/pay\?/i.test(text) ? 1 : 0),
	parse,
	safety: () => [{ code: 'payload/payment', severity: 'caution' }],
	vectors: [
		{
			text: 'upi://pay?pa=example@upi&pn=Example%20Shop&am=10.00&cu=INR&tn=Order%201',
			value: { address: 'example@upi', name: 'Example Shop', amount: 10, note: 'Order 1' },
			source: `${NPCI}: pa, pn, am, cu and tn, spaces as %20; synthetic payee.`,
		},
	],
});
