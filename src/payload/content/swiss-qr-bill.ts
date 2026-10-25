/**
 * A Swiss QR-bill: the Swiss QR Code on a payment part (SIX, "Swiss
 * Implementation Guidelines for the QR-bill", version 2.4 of 24 February
 * 2026, valid from 14 November 2026; version 2.3 stays valid until November
 * 2027).
 *
 * The rules that matter most:
 *
 * - The account is a CH or LI IBAN. A QR-IBAN, one whose institution ID is
 *   30000 to 31999 (section 2.8), takes a QR reference (QRR) and nothing
 *   else, and from version 2.4 only for bills in CHF. Any other IBAN takes an
 *   ISO 11649 creditor reference (SCOR) or none (NON).
 * - A QR reference is 26 digits and a modulo 10 recursive check digit.
 * - Addresses are structured (S): street, building number, postcode and town
 *   as separate lines. The combined type (K) was removed in version 2.3.
 *   This writes S only, and reads K so an old bill can still be explained,
 *   with a warning; the K lines land in the street and town fields, so the
 *   postcode has to be filled in before the bill can be made again.
 * - Text is UTF-8 from the Latin character set of section 4.1.1. Lines end
 *   in LF (CR LF is also allowed, and is read), the last line has no line
 *   end, and optional lines after the trailer are left off when empty.
 *   At most 997 characters, which at level M is version 25.
 * - The code is printed 46 by 46 mm with a 7 mm Swiss cross in the middle,
 *   black on white, and nothing about its design may change.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { compactCreditorReference, compactIban, isCreditorReference } from '../banking.js';
import { mod10Recursive } from '../check-digits.js';
import { definePayload, field, unparseable } from '../define.js';
import { charLength, decimalPlaces, FIELD_ISSUES, numberOf, textOf } from '../fields.js';
import type { FieldSchema } from '../types.js';

const ID = 'swiss-qr-bill';
const IG =
	'https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.4-en.pdf';

export type SwissQrBillValue = {
	readonly iban: string;
	readonly creditorName: string;
	readonly creditorStreet: string;
	readonly creditorBuilding: string;
	readonly creditorPostcode: string;
	readonly creditorTown: string;
	readonly creditorCountry: string;
	readonly creditorAddressType: string;
	readonly amount: number | null;
	readonly currency: string;
	readonly debtorName: string;
	readonly debtorStreet: string;
	readonly debtorBuilding: string;
	readonly debtorPostcode: string;
	readonly debtorTown: string;
	readonly debtorCountry: string;
	readonly debtorAddressType: string;
	readonly referenceType: string;
	readonly reference: string;
	readonly message: string;
	readonly billingInformation: string;
	readonly alternative1: string;
	readonly alternative2: string;
};

export const SWISS_MAX_CHARACTERS = 997;

const ADDRESS = ['Name', 'Street', 'Building', 'Postcode', 'Town', 'Country'] as const;
const TEXT_FIELDS = [
	...ADDRESS.slice(0, 5).map((part) => `creditor${part}`),
	...ADDRESS.slice(0, 5).map((part) => `debtor${part}`),
	'message',
	'billingInformation',
	'alternative1',
	'alternative2',
];

/** Section 4.1.1: Basic Latin, Latin-1 Supplement, Latin Extended-A, four Romanian letters and the euro sign. */
function allowedCharacter(code: number): boolean {
	return (
		(code >= 0x20 && code <= 0x7e) ||
		(code >= 0xa0 && code <= 0x17f) ||
		(code >= 0x218 && code <= 0x21b) ||
		code === 0x20ac
	);
}

/** The institution ID of a CH or LI IBAN marks a QR-IBAN when it is 30000 to 31999 (section 2.8). */
export function isQrIban(iban: string): boolean {
	const compact = compactIban(iban);
	const iid = Number(compact.slice(4, 9));
	return /^(?:CH|LI)\d{7}/.test(compact) && iid >= 30000 && iid <= 31999;
}

/** 27 digits, the last a modulo 10 recursive check over the other 26 (section 2.12.1). */
export function isQrReference(reference: string): boolean {
	const compact = reference.replace(/ /g, '');
	return /^\d{27}$/.test(compact) && mod10Recursive(compact.slice(0, 26)) === Number(compact[26]);
}

/** A debtor is given when any line other than the country is, so a form that fills in a default country does not invent one. */
function hasDebtor(value: SwissQrBillValue): boolean {
	return ADDRESS.slice(0, 5).some((part) => textOf(value, `debtor${part}`) !== '');
}

function addressLines(
	value: SwissQrBillValue,
	party: 'creditor' | 'debtor',
	present: boolean,
): string[] {
	if (!present) return ['', '', '', '', '', '', ''];
	return ['S', ...ADDRESS.map((part) => textOf(value, `${party}${part}`))];
}

function reference(value: SwissQrBillValue): string {
	const text = textOf(value, 'reference');
	return textOf(value, 'referenceType') === 'scor'
		? compactCreditorReference(text)
		: text.replace(/ /g, '');
}

function lines(value: SwissQrBillValue): string[] {
	const amount = numberOf(value, 'amount');
	const out = [
		'SPC',
		'0200',
		'1',
		compactIban(textOf(value, 'iban')),
		...addressLines(value, 'creditor', true),
		// The ultimate creditor: reserved, and must not be filled in.
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		amount === null ? '' : amount.toFixed(2),
		textOf(value, 'currency').toUpperCase(),
		...addressLines(value, 'debtor', hasDebtor(value)),
		textOf(value, 'referenceType').toUpperCase(),
		reference(value),
		textOf(value, 'message'),
		'EPD',
		textOf(value, 'billingInformation'),
		textOf(value, 'alternative1'),
		textOf(value, 'alternative2'),
	];
	while (out.length > 31 && out[out.length - 1] === '') out.pop();
	return out;
}

function write(value: SwissQrBillValue): string {
	return lines(value).join('\n');
}

function addressIssues(value: SwissQrBillValue, party: 'creditor' | 'debtor'): Issue[] {
	const found: Issue[] = [];
	for (const part of ['Name', 'Postcode', 'Town', 'Country']) {
		if (textOf(value, `${party}${part}`) === '')
			found.push(issue(FIELD_ISSUES.required, ['fields', `${party}${part}`]));
	}
	if (textOf(value, `${party}AddressType`) === 'k') {
		found.push(
			issue(
				'payload.swiss-qr-bill.issue.combined-address',
				['fields', `${party}AddressType`],
				'warning',
			),
		);
	}
	return found;
}

function referenceIssues(value: SwissQrBillValue, flagged: (key: string) => boolean): Issue[] {
	const type = textOf(value, 'referenceType');
	const text = textOf(value, 'reference');
	const path = ['fields', 'reference'];
	const qrIban = isQrIban(textOf(value, 'iban'));
	const found: Issue[] = [];
	if (type === 'qrr') {
		if (!qrIban)
			found.push(
				issue('payload.swiss-qr-bill.issue.qrr-needs-qr-iban', ['fields', 'referenceType']),
			);
		if (textOf(value, 'currency') !== 'chf')
			found.push(issue('payload.swiss-qr-bill.issue.qrr-chf-only', ['fields', 'currency']));
		if (text === '') found.push(issue(FIELD_ISSUES.required, path));
		else if (!flagged('reference') && !isQrReference(text))
			found.push(issue('payload.swiss-qr-bill.issue.qr-reference', path));
		return found;
	}
	if (qrIban)
		found.push(issue('payload.swiss-qr-bill.issue.qr-iban-needs-qrr', ['fields', 'referenceType']));
	if (type === 'scor') {
		if (text === '') found.push(issue(FIELD_ISSUES.required, path));
		else if (!flagged('reference') && !isCreditorReference(text))
			found.push(issue('payload.issue.creditor-reference', path));
	} else if (text !== '') {
		found.push(issue('payload.swiss-qr-bill.issue.reference-not-allowed', path));
	}
	return found;
}

function rules(value: SwissQrBillValue, flagged: (key: string) => boolean): Issue[] {
	const found: Issue[] = [];
	const iban = compactIban(textOf(value, 'iban'));
	if (iban !== '' && !flagged('iban') && !/^(?:CH|LI)/.test(iban)) {
		found.push(issue('payload.swiss-qr-bill.issue.iban-country', ['fields', 'iban']));
	}
	found.push(...addressIssues(value, 'creditor'));
	if (hasDebtor(value)) found.push(...addressIssues(value, 'debtor'));
	found.push(...referenceIssues(value, flagged));
	const amount = numberOf(value, 'amount');
	if (amount !== null && !flagged('amount') && decimalPlaces(amount) > 2) {
		found.push(issue(FIELD_ISSUES.amountDecimals, ['fields', 'amount'], 'error', { max: 2 }));
	}
	const combined =
		charLength(textOf(value, 'message')) + charLength(textOf(value, 'billingInformation'));
	if (combined > 140) {
		found.push(
			issue('payload.swiss-qr-bill.issue.message-too-long', ['fields', 'message'], 'error', {
				length: combined,
				max: 140,
			}),
		);
	}
	for (const key of TEXT_FIELDS) {
		if (flagged(key)) continue;
		const text = textOf(value, key);
		let position = 0;
		for (const char of text) {
			if (!allowedCharacter(char.codePointAt(0) as number)) {
				found.push(
					issue('payload.swiss-qr-bill.issue.character', ['fields', key], 'error', { position }),
				);
				break;
			}
			position += 1;
		}
	}
	const length = charLength(write(value));
	if (length > SWISS_MAX_CHARACTERS) {
		found.push(
			issue('payload.swiss-qr-bill.issue.too-long', ['fields'], 'error', {
				length,
				max: SWISS_MAX_CHARACTERS,
			}),
		);
	}
	return found;
}

interface ReadAddress {
	readonly type: string;
	readonly parts: readonly string[];
}

/** Seven lines from `start`: S or K, then the six address lines. Empty when there is no party. */
function readAddress(rows: readonly string[], start: number): ReadAddress {
	const [type = '', name = '', line1 = '', line2 = '', postcode = '', town = '', country = ''] =
		rows.slice(start, start + 7);
	if (type === '') return { type: 's', parts: ['', '', '', '', '', ''] };
	if (type === 'S') return { type: 's', parts: [name, line1, line2, postcode, town, country] };
	if (type === 'K') return { type: 'k', parts: [name, line1, '', '', line2, country] };
	throw unparseable(ID, 'address-type');
}

function parse(text: string): SwissQrBillValue {
	const rows = text.split(/\r?\n/);
	if (rows[0] !== 'SPC') throw unparseable(ID, 'not-swiss-qr-bill');
	if (rows[1] !== '0200' || rows[2] !== '1' || rows[30] !== 'EPD' || rows.length > 34)
		throw unparseable(ID, 'header');
	const creditor = readAddress(rows, 4);
	const debtor = readAddress(rows, 20);
	const amountText = rows[18] as string;
	if (amountText !== '' && !/^\d{1,9}\.\d{2}$/.test(amountText)) throw unparseable(ID, 'amount');
	const currency = (rows[19] as string).toLowerCase();
	const referenceType = (rows[27] as string).toLowerCase();
	if (!['chf', 'eur'].includes(currency) || !['qrr', 'scor', 'non'].includes(referenceType)) {
		throw unparseable(ID, 'code');
	}
	const party = (prefix: string, address: ReadAddress) =>
		Object.fromEntries([
			...ADDRESS.map((part, index) => [`${prefix}${part}`, address.parts[index] as string]),
			[`${prefix}AddressType`, address.type],
		]);
	return {
		iban: rows[3] as string,
		...party('creditor', creditor),
		amount: amountText === '' ? null : Number(amountText),
		currency,
		...party('debtor', debtor),
		referenceType,
		reference: rows[28] as string,
		message: rows[29] as string,
		billingInformation: rows[31] ?? '',
		alternative1: rows[32] ?? '',
		alternative2: rows[33] ?? '',
	} as SwissQrBillValue;
}

function addressFields(party: 'creditor' | 'debtor'): FieldSchema[] {
	const required = party === 'creditor';
	const extras = (more: object) => ({
		group: party,
		...(required ? {} : { advanced: true }),
		...more,
	});
	return [
		field(ID, `${party}Name`, 'text', extras({ maxLength: 70, ...(required ? { required } : {}) })),
		field(ID, `${party}Street`, 'text', extras({ maxLength: 70 })),
		field(ID, `${party}Building`, 'text', extras({ maxLength: 16 })),
		field(ID, `${party}Postcode`, 'text', extras({ maxLength: 16 })),
		field(ID, `${party}Town`, 'text', extras({ maxLength: 35 })),
		field(ID, `${party}Country`, 'country', extras(required ? { default: 'CH' } : {})),
		field(ID, `${party}AddressType`, 'select', {
			group: party,
			options: ['s', 'k'],
			default: 's',
			advanced: true,
			hint: true,
		}),
	];
}

export const swissQrBillType = definePayload<SwissQrBillValue>({
	id: ID,
	category: 'payment',
	fields: [
		field(ID, 'iban', 'iban', { required: true, hint: true }),
		...addressFields('creditor'),
		field(ID, 'amount', 'amount', { min: 0.01, max: 999999999.99 }),
		field(ID, 'currency', 'select', { required: true, options: ['chf', 'eur'], default: 'chf' }),
		...addressFields('debtor'),
		field(ID, 'referenceType', 'select', {
			required: true,
			options: ['qrr', 'scor', 'non'],
			default: 'non',
			hint: true,
		}),
		field(ID, 'reference', 'text', { maxLength: 27 + 6 }),
		field(ID, 'message', 'text', { maxLength: 140 }),
		field(ID, 'billingInformation', 'text', { maxLength: 140, advanced: true }),
		field(ID, 'alternative1', 'text', { maxLength: 100, advanced: true }),
		field(ID, 'alternative2', 'text', { maxLength: 100, advanced: true }),
	],
	constraints: {
		ecLevels: ['M'],
		maxVersion: '25',
		sizeMm: 46,
		colours: 'black-on-white',
		designLocked: true,
		overlay: 'swiss-cross',
	},
	rules,
	write,
	detect: (text) => (/^SPC\r?\n0200\r?\n1\r?\n/.test(text) ? 1 : 0),
	parse,
	safety: () => [{ code: 'payload/payment', severity: 'caution' }],
	vectors: [
		{
			text: [
				'SPC',
				'0200',
				'1',
				'CH4431999123000889012',
				'S',
				'Max Muster & Söhne (sample company)',
				'Musterstrasse',
				'123',
				'8000',
				'Seldwyla',
				'CH',
				'',
				'',
				'',
				'',
				'',
				'',
				'',
				'1949.75',
				'CHF',
				'S',
				'Simon Muster',
				'Musterstrasse',
				'1',
				'8000',
				'Seldwyla',
				'CH',
				'QRR',
				'210000000003139471430009017',
				'Order from 15.10.2020',
				'EPD',
				'//S1/10/1234/11/201021/30/102673386/32/7.7/40/0:30',
				'eBill/B/simon.muster@example.com',
			].join('\n'),
			value: {
				iban: 'CH4431999123000889012',
				creditorName: 'Max Muster & Söhne (sample company)',
				creditorStreet: 'Musterstrasse',
				creditorBuilding: '123',
				creditorPostcode: '8000',
				creditorTown: 'Seldwyla',
				creditorCountry: 'CH',
				creditorAddressType: 's',
				amount: 1949.75,
				currency: 'chf',
				debtorName: 'Simon Muster',
				debtorStreet: 'Musterstrasse',
				debtorBuilding: '1',
				debtorPostcode: '8000',
				debtorTown: 'Seldwyla',
				debtorCountry: 'CH',
				debtorAddressType: 's',
				referenceType: 'qrr',
				reference: '210000000003139471430009017',
				message: 'Order from 15.10.2020',
				billingInformation: '//S1/10/1234/11/201021/30/102673386/32/7.7/40/0:30',
				alternative1: 'eBill/B/simon.muster@example.com',
				alternative2: '',
			},
			source: `SIX Swiss Implementation Guidelines for the QR-bill v2.4, Annex A, table 18 (example 2), lines joined with LF as section 4.1.4 allows. ${IG}`,
		},
	],
});
