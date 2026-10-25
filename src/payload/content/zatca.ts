/**
 * A Saudi e-invoice code (ZATCA, "Security Features Implementation Standards"
 * version 1.2, 19 May 2023, section 4.1): read and explained, never made.
 *
 * The text is base64 of a run of tag, length, value records, each tag and
 * length one byte. Tags 1 to 5 are the seller's name, their VAT registration
 * number, the time stamp, the invoice total with VAT and the VAT total, as
 * UTF-8. Tags 6 to 9 arrived with phase 2 on 1 January 2023: the hash of the
 * XML invoice, its ECDSA signature, the public key, and for simplified
 * invoices ZATCA's signature over the cryptographic stamp.
 *
 * It cannot be generated honestly here. A phase 2 code is only valid with a
 * signature made by the seller's own certificate over the invoice itself,
 * and a phase 1 code (tags 1 to 5 alone) has not been accepted since. So this
 * type is `generate: false`, a contract addition; reading one shows what it
 * says and whether the phase 2 parts are there, and verifying the signature
 * is not attempted.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { booleanOf, textOf } from '../fields.js';

const ID = 'zatca';

export type ZatcaValue = {
	readonly sellerName: string;
	readonly vatNumber: string;
	readonly timestamp: string;
	readonly total: string;
	readonly vatTotal: string;
	readonly hasInvoiceHash: boolean;
	readonly hasSignature: boolean;
	readonly hasPublicKey: boolean;
	readonly hasStampSignature: boolean;
};

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding, strictly: undefined on anything else. `atob` throws a DOMException instead. */
export function base64Decode(text: string): Uint8Array | undefined {
	if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return undefined;
	const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
	const out = new Uint8Array((text.length / 4) * 3 - padding);
	let o = 0;
	for (let i = 0; i < text.length; i += 4) {
		const n = [0, 1, 2, 3].map((j) =>
			text[i + j] === '=' ? 0 : BASE64.indexOf(text[i + j] as string),
		);
		const triple =
			((n[0] as number) << 18) |
			((n[1] as number) << 12) |
			((n[2] as number) << 6) |
			(n[3] as number);
		for (const shift of [16, 8, 0]) {
			if (o < out.length) out[o++] = (triple >>> shift) & 0xff;
		}
	}
	return out;
}

/** For tests: base64 of some bytes. */
export function base64Encode(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] as number;
		const b = bytes[i + 1];
		const c = bytes[i + 2];
		const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
		out += BASE64[(triple >>> 18) & 63] as string;
		out += BASE64[(triple >>> 12) & 63] as string;
		out += b === undefined ? '=' : (BASE64[(triple >>> 6) & 63] as string);
		out += c === undefined ? '=' : (BASE64[triple & 63] as string);
	}
	return out;
}

function readRecords(bytes: Uint8Array): Map<number, Uint8Array> | undefined {
	const records = new Map<number, Uint8Array>();
	let i = 0;
	while (i < bytes.length) {
		if (i + 2 > bytes.length) return undefined;
		const tag = bytes[i] as number;
		const length = bytes[i + 1] as number;
		if (i + 2 + length > bytes.length || records.has(tag)) return undefined;
		records.set(tag, bytes.subarray(i + 2, i + 2 + length));
		i += 2 + length;
	}
	return records;
}

function parse(text: string): ZatcaValue {
	const bytes = base64Decode(text.trim());
	const records = bytes && bytes.length > 0 ? readRecords(bytes) : undefined;
	if (records === undefined || records.get(1) === undefined) throw unparseable(ID, 'not-zatca');
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const strings: string[] = [];
	for (const tag of [1, 2, 3, 4, 5]) {
		const value = records.get(tag);
		if (value === undefined) throw unparseable(ID, 'missing-tag');
		try {
			strings.push(decoder.decode(value));
		} catch {
			throw unparseable(ID, 'not-utf-8');
		}
	}
	const [sellerName, vatNumber, timestamp, total, vatTotal] = strings as [
		string,
		string,
		string,
		string,
		string,
	];
	return {
		sellerName,
		vatNumber,
		timestamp,
		total,
		vatTotal,
		hasInvoiceHash: records.has(6),
		hasSignature: records.has(7),
		hasPublicKey: records.has(8),
		hasStampSignature: records.has(9),
	};
}

/** What a reader should know about a code it has read: never a reason not to show it. */
function rules(value: ZatcaValue): Issue[] {
	const found: Issue[] = [];
	// A Saudi VAT registration number is 15 digits that start and end with 3.
	if (!/^3\d{13}3$/.test(textOf(value, 'vatNumber'))) {
		found.push(issue('payload.zatca.issue.vat-number', ['fields', 'vatNumber'], 'warning'));
	}
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(
			textOf(value, 'timestamp'),
		)
	) {
		found.push(issue('payload.zatca.issue.timestamp', ['fields', 'timestamp'], 'warning'));
	}
	for (const key of ['total', 'vatTotal']) {
		if (!/^\d+(?:\.\d+)?$/.test(textOf(value, key)))
			found.push(issue('payload.zatca.issue.amount', ['fields', key], 'warning'));
	}
	if (!(
		booleanOf(value, 'hasInvoiceHash') &&
		booleanOf(value, 'hasSignature') &&
		booleanOf(value, 'hasPublicKey')
	)) {
		found.push(issue('payload.zatca.issue.phase-one', ['fields'], 'info'));
	}
	return found;
}

export const zatcaType = definePayload<ZatcaValue>({
	id: ID,
	category: 'commerce',
	generate: false,
	fields: [
		field(ID, 'sellerName', 'text'),
		field(ID, 'vatNumber', 'text'),
		field(ID, 'timestamp', 'text'),
		field(ID, 'total', 'text'),
		field(ID, 'vatTotal', 'text'),
		field(ID, 'hasInvoiceHash', 'boolean'),
		field(ID, 'hasSignature', 'boolean'),
		field(ID, 'hasPublicKey', 'boolean'),
		field(ID, 'hasStampSignature', 'boolean'),
	],
	rules,
	write: () => {
		throw new TypeError(
			"Saudi e-invoice codes are read only here. A valid one is signed with the seller's own certificate, so it has to come from their invoicing system.",
		);
	},
	detect: (text) => {
		try {
			parse(text);
			return 1;
		} catch {
			return 0;
		}
	},
	parse,
});
