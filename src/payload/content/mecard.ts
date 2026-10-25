/**
 * A short contact card: NTT DoCoMo's MECARD, as ZXing documents it (ZXing
 * wiki, "Barcode Contents", MECARD), MECARD:N:Family,Given;TEL:...;;
 *
 * Smaller than a vCard for the same details, which matters on a business card
 * where the code has to stay small enough to scan. Reserved characters (\ ; ,
 * and :) take a backslash. ORG is ZXing's addition rather than DoCoMo's, so
 * it is marked as such for readers that only know the original.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { backslashEscape, backslashUnescape, splitUnescaped } from '../escape.js';
import { compactTel, listOf, textOf } from '../fields.js';
import { analyseUrl } from '../url-safety.js';

const ID = 'mecard';
const RESERVED = '\\;,:';

export type MecardValue = {
	readonly familyName: string;
	readonly givenName: string;
	readonly nickname: string;
	readonly phones: readonly string[];
	readonly email: readonly string[];
	readonly url: string;
	readonly address: string;
	readonly organisation: string;
	readonly note: string;
	readonly birthday: string;
};

function rules(value: MecardValue): Issue[] {
	if (textOf(value, 'familyName') !== '' || textOf(value, 'givenName') !== '') return [];
	return [issue('payload.mecard.issue.no-name', ['fields', 'familyName'])];
}

function write(value: MecardValue): string {
	const escape = (text: string) => backslashEscape(text, RESERVED);
	const family = escape(textOf(value, 'familyName'));
	const given = escape(textOf(value, 'givenName'));
	const parts = [`N:${given === '' ? family : `${family},${given}`}`];
	const add = (name: string, text: string) => {
		if (text !== '') parts.push(`${name}:${text}`);
	};
	add('NICKNAME', escape(textOf(value, 'nickname')));
	for (const phone of listOf(value, 'phones')) add('TEL', compactTel(phone));
	for (const address of listOf(value, 'email')) add('EMAIL', escape(address));
	add('URL', escape(textOf(value, 'url')));
	add('ADR', escape(textOf(value, 'address')));
	add('ORG', escape(textOf(value, 'organisation')));
	add('NOTE', escape(textOf(value, 'note')));
	add('BDAY', textOf(value, 'birthday').replace(/-/g, ''));
	return `MECARD:${parts.join(';')};;`;
}

function parse(text: string): MecardValue {
	if (!/^MECARD:/i.test(text)) throw unparseable(ID, 'not-mecard');
	const single: Record<string, string> = {};
	const phones: string[] = [];
	const email: string[] = [];
	let familyName = '';
	let givenName = '';
	for (const piece of splitUnescaped(text.slice(7), ';')) {
		const colon = piece.indexOf(':');
		if (colon <= 0) continue;
		const name = piece.slice(0, colon).toUpperCase();
		const raw = piece.slice(colon + 1);
		if (name === 'N') {
			const [family = '', ...given] = splitUnescaped(raw, ',');
			familyName = backslashUnescape(family);
			givenName = backslashUnescape(given.join(','));
		} else if (name === 'TEL') phones.push(backslashUnescape(raw));
		else if (name === 'EMAIL') email.push(backslashUnescape(raw));
		else if (!(name in single)) single[name] = backslashUnescape(raw);
	}
	if (familyName === '' && givenName === '') throw unparseable(ID, 'missing-name');
	const bday = /^(\d{4})(\d{2})(\d{2})$/.exec(single.BDAY ?? '');
	return {
		familyName,
		givenName,
		nickname: single.NICKNAME ?? '',
		phones,
		email,
		url: single.URL ?? '',
		address: single.ADR ?? '',
		organisation: single.ORG ?? '',
		note: single.NOTE ?? '',
		birthday: bday ? `${bday[1]}-${bday[2]}-${bday[3]}` : '',
	};
}

export const mecardType = definePayload<MecardValue>({
	id: ID,
	category: 'contact',
	fields: [
		field(ID, 'familyName', 'text', { maxLength: 100, group: 'name' }),
		field(ID, 'givenName', 'text', { maxLength: 100, group: 'name' }),
		field(ID, 'nickname', 'text', { maxLength: 100, advanced: true }),
		field(ID, 'phones', 'tel', { multiple: true, maxItems: 5 }),
		field(ID, 'email', 'email', { multiple: true, maxItems: 5 }),
		field(ID, 'url', 'url'),
		field(ID, 'address', 'text', { maxLength: 300 }),
		field(ID, 'organisation', 'text', { maxLength: 200, hint: true }),
		field(ID, 'note', 'text', { maxLength: 500 }),
		field(ID, 'birthday', 'date'),
	],
	compatibility: [
		// ZXing wiki, Barcode Contents, contact information:
		// https://github.com/zxing/zxing/wiki/Barcode-Contents#contact-information
		{ reader: 'docomo', noteKey: 'payload.mecard.compat.org' },
	],
	rules,
	write,
	detect: (text) => (/^MECARD:/i.test(text) ? 1 : 0),
	parse,
	safety: (value) => (textOf(value, 'url') === '' ? [] : analyseUrl(textOf(value, 'url')).findings),
});
