/**
 * A Pix payment (Brazil): the static BR Code, an EMVCo merchant-presented QR
 * payload as Banco Central do Brasil specifies it (Manual de Padroes para
 * Iniciacao do Pix, version 2.10.0, section 2.6; Manual BR Code, version 2.0.1).
 *
 * The objects, in order: 00 payload format "01"; 26 the Pix account template
 * with 00 the GUI "br.gov.bcb.pix", 01 the key and 02 an optional message;
 * 52 merchant category "0000"; 53 currency "986" (real); 54 an optional
 * amount; 58 "BR"; 59 the receiver's name, up to 25; 60 the city, up to 15;
 * 62 with 05 the transaction ID, "***" when there is none; 63 the CRC.
 *
 * The key, the message and the GUI share the template's 99 characters, so the
 * longest key leaves little room for a message. Dynamic codes, which carry a
 * URL (26-25) to fetch the charge from, are not static payloads and are not
 * read here.
 *
 * BCB lifted the old alphanumeric-only rule, but plenty of banking apps still
 * mangle accented names, so letters outside ASCII are a warning rather than an
 * error.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, invalidPayload, unparseable } from '../define.js';
import { emvObject, readEmv, readEmvObjects, writeEmv } from '../emv.js';
import type { EmvObject } from '../emv.js';
import { charLength, decimalPlaces, FIELD_ISSUES, isEmail, numberOf, textOf } from '../fields.js';

const ID = 'pix';
const GUI = 'br.gov.bcb.pix';
const MANUAL =
	'https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf';

export type PixValue = {
	readonly key: string;
	readonly name: string;
	readonly city: string;
	readonly amount: number | null;
	readonly description: string;
	readonly txid: string;
};

/** CPF check digits: weights 10 down to 2, then 11 down to 2, remainder mod 11 (Receita Federal). */
function validCpf(digits: string): boolean {
	if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
	for (const length of [9, 10]) {
		let sum = 0;
		for (let i = 0; i < length; i += 1) sum += Number(digits[i]) * (length + 1 - i);
		const check = ((sum * 10) % 11) % 10;
		if (check !== Number(digits[length])) return false;
	}
	return true;
}

/**
 * CNPJ check digits, numeric or the alphanumeric form issued from July 2026
 * (Receita Federal, IN RFB 2.229/2024): each character counts as its code
 * minus 48, so digits keep their old values and the old rule still holds.
 */
function validCnpj(text: string): boolean {
	if (!/^[0-9A-Z]{12}\d{2}$/.test(text) || /^(\d)\1{13}$/.test(text)) return false;
	const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
	for (const length of [12, 13]) {
		let sum = 0;
		const offset = 13 - length;
		for (let i = 0; i < length; i += 1)
			sum += (text.charCodeAt(i) - 48) * (weights[i + offset] as number);
		const remainder = sum % 11;
		const check = remainder < 2 ? 0 : 11 - remainder;
		if (check !== Number(text[length])) return false;
	}
	return true;
}

/**
 * The five kinds of Pix key (Manual de Padroes, section 2.6.1): CPF, CNPJ,
 * email, phone, random (EVP). DICT holds email and random keys in lower
 * case, so a key written with capitals is one the payer's bank will not find.
 */
export function isPixKey(key: string): boolean {
	return (
		validCpf(key) ||
		validCnpj(key) ||
		(isEmail(key) && key.length <= 77 && key === key.toLowerCase()) ||
		/^\+55\d{10,11}$/.test(key) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)
	);
}

function accountTemplate(value: PixValue): EmvObject[] {
	const objects = [
		{ id: '00', value: GUI },
		{ id: '01', value: textOf(value, 'key') },
	];
	if (textOf(value, 'description') !== '')
		objects.push({ id: '02', value: textOf(value, 'description') });
	return objects;
}

function templateLength(objects: readonly EmvObject[]): number {
	return objects.reduce((sum, object) => sum + 4 + charLength(object.value), 0);
}

function rules(value: PixValue, flagged: (key: string) => boolean): Issue[] {
	const found: Issue[] = [];
	const key = textOf(value, 'key');
	if (key !== '' && !flagged('key') && !isPixKey(key))
		found.push(issue('payload.pix.issue.key', ['fields', 'key']));
	const length = templateLength(accountTemplate(value));
	if (length > 99) {
		found.push(
			issue('payload.pix.issue.account-too-long', ['fields', 'description'], 'error', {
				length,
				max: 99,
			}),
		);
	}
	const txid = textOf(value, 'txid');
	if (txid !== '' && !flagged('txid') && !/^[A-Za-z0-9]{1,25}$/.test(txid)) {
		found.push(issue('payload.pix.issue.txid', ['fields', 'txid']));
	}
	const amount = numberOf(value, 'amount');
	if (amount !== null && !flagged('amount') && decimalPlaces(amount) > 2) {
		found.push(issue(FIELD_ISSUES.amountDecimals, ['fields', 'amount'], 'error', { max: 2 }));
	}
	for (const name of ['name', 'city', 'description']) {
		if (!flagged(name) && /[^\x20-\x7e]/.test(textOf(value, name))) {
			found.push(issue('payload.pix.issue.non-ascii', ['fields', name], 'warning'));
		}
	}
	return found;
}

function write(value: PixValue): string {
	const objects: EmvObject[] = [
		{ id: '00', value: '01' },
		{
			id: '26',
			value: accountTemplate(value)
				.map((o) => emvObject(o.id, o.value))
				.join(''),
		},
		{ id: '52', value: '0000' },
		{ id: '53', value: '986' },
	];
	const amount = numberOf(value, 'amount');
	if (amount !== null) objects.push({ id: '54', value: amount.toFixed(2) });
	objects.push(
		{ id: '58', value: 'BR' },
		{ id: '59', value: textOf(value, 'name') },
		{ id: '60', value: textOf(value, 'city') },
		// BCB: a code without a transaction ID carries "***" in its place.
		{ id: '62', value: emvObject('05', textOf(value, 'txid') || '***') },
	);
	return writeEmv(objects);
}

function parse(text: string): PixValue {
	const read = readEmv(text);
	if (!read.ok)
		throw read.reason === 'crc' ? invalidPayload(ID, 'crc') : unparseable(ID, 'not-emv');
	const top = new Map(read.value.map((object) => [object.id, object.value]));
	let account: Map<string, string> | undefined;
	for (const object of read.value) {
		const id = Number(object.id);
		if (id < 26 || id > 51) continue;
		const inner = readEmvObjects(object.value);
		if (inner?.[0]?.id === '00' && inner[0].value.toLowerCase() === GUI) {
			account = new Map(inner.map((o) => [o.id, o.value]));
			break;
		}
	}
	if (account === undefined) throw unparseable(ID, 'not-pix');
	if (account.has('25') || !account.has('01')) throw unparseable(ID, 'dynamic');
	if (top.get('53') !== '986' || top.get('58') !== 'BR') throw unparseable(ID, 'not-brl');
	const amountText = top.get('54');
	if (amountText !== undefined && !/^\d+(?:\.\d{1,2})?$/.test(amountText))
		throw unparseable(ID, 'amount');
	const additional = readEmvObjects(top.get('62') ?? '') ?? [];
	const txid = additional.find((o) => o.id === '05')?.value ?? '';
	return {
		key: account.get('01') as string,
		name: top.get('59') ?? '',
		city: top.get('60') ?? '',
		amount: amountText === undefined ? null : Number(amountText),
		description: account.get('02') ?? '',
		txid: txid === '***' ? '' : txid,
	};
}

export const pixType = definePayload<PixValue>({
	id: ID,
	category: 'payment',
	fields: [
		field(ID, 'key', 'text', { required: true, maxLength: 77, hint: true }),
		field(ID, 'name', 'text', { required: true, maxLength: 25 }),
		field(ID, 'city', 'text', { required: true, maxLength: 15 }),
		field(ID, 'amount', 'amount', { min: 0.01, max: 9999999999.99 }),
		field(ID, 'description', 'text', { maxLength: 72 }),
		field(ID, 'txid', 'text', { maxLength: 25, advanced: true, hint: true }),
	],
	compatibility: [{ reader: 'pix', noteKey: 'payload.pix.compat.banking-apps', source: MANUAL }],
	rules,
	write,
	detect: (text) => (/^000201/.test(text) && /br\.gov\.bcb\.pix/i.test(text) ? 1 : 0),
	parse,
	safety: () => [{ code: 'payload/payment', severity: 'caution' }],
	vectors: [
		{
			text: '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
			value: {
				key: '123e4567-e12b-12d1-a456-426655440000',
				name: 'Fulano de Tal',
				city: 'BRASILIA',
				amount: null,
				description: '',
				txid: '',
			},
			source: `BCB, Manual de Padroes para Iniciacao do Pix v2.10.0, the static BR Code example. ${MANUAL}`,
		},
	],
});
