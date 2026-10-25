/**
 * A SEPA credit transfer: the EPC QR code, often called a GiroCode
 * (European Payments Council, EPC069-12 version 3.1, 19 March 2024, "Quick
 * Response Code: Guidelines to Enable the Data Capture for the Initiation of
 * a SEPA Credit Transfer").
 *
 * Twelve elements, one per line: BCD, the version (001 or 002), the
 * character set, SCT, the BIC, the name, the IBAN, the amount as EUR and a
 * decimal, a purpose code, then either a structured creditor reference or an
 * unstructured message, never both, and a note for the person paying. The
 * BIC is mandatory in version 001 and optional in 002 within the EEA. The
 * last populated element has nothing after it, not even a line feed, and the
 * whole payload is at most 331 bytes, which with level M is version 13.
 *
 * The character set is always written as 1, UTF-8, and the encoder has to
 * put UTF-8 bytes in the symbol. The seven ISO 8859 sets are read, and since
 * the text arrives here already decoded, which one it was is not kept.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { compactCreditorReference, compactIban, isCreditorReference } from '../banking.js';
import { definePayload, field, unparseable } from '../define.js';
import { decimalPlaces, FIELD_ISSUES, formatDecimal, numberOf, textOf } from '../fields.js';

const ID = 'epc';
const EPC069 =
	'https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2024-03/EPC069-12%20v3.1%20Quick%20Response%20Code%20-%20Guidelines%20to%20Enable%20the%20Data%20Capture%20for%20the%20Initiation%20of%20an%20SCT.pdf';

export type EpcValue = {
	readonly version: string;
	readonly bic: string;
	readonly name: string;
	readonly iban: string;
	readonly amount: number | null;
	readonly purpose: string;
	readonly reference: string;
	readonly message: string;
	readonly information: string;
};

export const EPC_MAX_BYTES = 331;

function elements(value: EpcValue): string[] {
	const amount = numberOf(value, 'amount');
	const reference = textOf(value, 'reference');
	const lines = [
		'BCD',
		textOf(value, 'version'),
		'1',
		'SCT',
		textOf(value, 'bic').toUpperCase(),
		textOf(value, 'name'),
		compactIban(textOf(value, 'iban')),
		amount === null ? '' : `EUR${formatDecimal(amount, 2)}`,
		textOf(value, 'purpose'),
		/^RF/i.test(reference) ? compactCreditorReference(reference) : reference,
		textOf(value, 'message'),
		textOf(value, 'information'),
	];
	while (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

function write(value: EpcValue): string {
	return elements(value).join('\n');
}

function rules(value: EpcValue, flagged: (key: string) => boolean): Issue[] {
	const found: Issue[] = [];
	if (textOf(value, 'version') === '001' && textOf(value, 'bic') === '') {
		found.push(issue('payload.epc.issue.bic-required', ['fields', 'bic']));
	}
	const purpose = textOf(value, 'purpose');
	if (purpose !== '' && !flagged('purpose') && !/^[A-Z0-9]{4}$/.test(purpose)) {
		found.push(issue('payload.epc.issue.purpose', ['fields', 'purpose']));
	}
	const reference = textOf(value, 'reference');
	if (reference !== '' && textOf(value, 'message') !== '') {
		found.push(issue('payload.epc.issue.reference-and-message', ['fields', 'message']));
	}
	if (reference !== '' && !flagged('reference')) {
		if (/^RF/i.test(reference)) {
			if (!isCreditorReference(reference))
				found.push(issue('payload.issue.creditor-reference', ['fields', 'reference']));
		} else {
			found.push(
				issue('payload.epc.issue.reference-unchecked', ['fields', 'reference'], 'warning'),
			);
		}
	}
	const amount = numberOf(value, 'amount');
	if (amount !== null && !flagged('amount') && decimalPlaces(amount) > 2) {
		found.push(issue(FIELD_ISSUES.amountDecimals, ['fields', 'amount'], 'error', { max: 2 }));
	}
	const length = new TextEncoder().encode(elements(value).join('\n')).length;
	if (length > EPC_MAX_BYTES) {
		found.push(
			issue('payload.epc.issue.too-long', ['fields'], 'error', { length, max: EPC_MAX_BYTES }),
		);
	}
	return found;
}

function parse(text: string): EpcValue {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== 'BCD' || lines[3] !== 'SCT') throw unparseable(ID, 'not-epc');
	const [
		,
		version = '',
		charset = '',
		,
		bic = '',
		name = '',
		iban = '',
		amountText = '',
		purpose = '',
		reference = '',
		message = '',
		information = '',
	] = lines;
	if (!['001', '002'].includes(version) || !/^[1-8]$/.test(charset))
		throw unparseable(ID, 'header');
	if (lines.length > 12) throw unparseable(ID, 'too-many-elements');
	const amount = /^EUR(\d+(?:\.\d{1,2})?)$/.exec(amountText);
	if (amountText !== '' && !amount) throw unparseable(ID, 'amount');
	return {
		version,
		bic,
		name,
		iban,
		amount: amount ? Number(amount[1]) : null,
		purpose,
		reference,
		message,
		information,
	};
}

const NO_REMITTANCE = { reference: '', message: '', information: '' } as const;

export const epcType = definePayload<EpcValue>({
	id: ID,
	category: 'payment',
	fields: [
		field(ID, 'name', 'text', { required: true, maxLength: 70 }),
		field(ID, 'iban', 'iban', { required: true }),
		field(ID, 'bic', 'bic', { hint: true }),
		field(ID, 'amount', 'amount', { min: 0.01, max: 999999999.99 }),
		field(ID, 'reference', 'text', { maxLength: 35, hint: true }),
		field(ID, 'message', 'text', { maxLength: 140 }),
		field(ID, 'purpose', 'text', { maxLength: 4, advanced: true, hint: true }),
		field(ID, 'information', 'text', { maxLength: 70, advanced: true, hint: true }),
		field(ID, 'version', 'select', {
			required: true,
			options: ['002', '001'],
			default: '002',
			advanced: true,
		}),
	],
	constraints: { ecLevels: ['M'], maxVersion: '13' },
	rules,
	write,
	detect: (text) => (/^BCD\r?\n00[12]\r?\n[1-8]\r?\nSCT(?:\r?\n|$)/.test(text) ? 1 : 0),
	parse,
	safety: () => [{ code: 'payload/payment', severity: 'caution' }],
	vectors: [
		{
			text: 'BCD\n001\n1\nSCT\nBHBLDEHHXXX\nFranz Mustermänn\nDE71110220330123456789\nEUR12.3\nGDDS\nRF18539007547034',
			value: {
				version: '001',
				bic: 'BHBLDEHHXXX',
				name: 'Franz Mustermänn',
				iban: 'DE71110220330123456789',
				amount: 12.3,
				purpose: 'GDDS',
				...NO_REMITTANCE,
				reference: 'RF18539007547034',
			},
			source: `EPC069-12 v3.1 section 2.3, version 1 example, joined with LF as section 2.2 specifies; the document gives its size as 95 characters and 96 bytes, which this is. ${EPC069}`,
		},
		{
			text: "BCD\n002\n2\nSCT\n\nFrançois D'Alsace S.A.\nFR1420041010050500013M02606\nEUR12.3\n\n\nClient:Marie Louise La Lune",
			value: {
				version: '002',
				bic: '',
				name: "François D'Alsace S.A.",
				iban: 'FR1420041010050500013M02606',
				amount: 12.3,
				purpose: '',
				...NO_REMITTANCE,
				message: 'Client:Marie Louise La Lune',
			},
			source: `EPC069-12 v3.1 section 2.3, version 2 example in ISO 8859-1, joined with LF; 103 characters, as the document states. ${EPC069}`,
		},
	],
});
