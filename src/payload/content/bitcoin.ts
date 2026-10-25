/**
 * A Bitcoin payment request: BIP 21, bitcoin:<address>?amount=&label=&message=,
 * read with the relaxations of BIP 321, which supersedes it (query keys are
 * case-insensitive, a label, message or amount may appear only once).
 *
 * The address is checked the way a wallet checks it before sending:
 * base58check with a known version byte for legacy and script-hash addresses,
 * bech32 (BIP 173) for segwit version 0 and bech32m (BIP 350) for version 1
 * and later. A testnet address is valid and reported, because a printed code
 * that pays testnet coins is almost always a mistake.
 *
 * A req- parameter is one the wallet must understand or refuse the whole link
 * (BIP 21, "Forward compatibility"). None are understood here, so a link with
 * one is unparseable rather than half explained.
 *
 * BIP 21's own example address, 175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W, fails its
 * base58check checksum (the last four bytes are 8a9c6129; the double SHA-256
 * gives 8a9c6111), and BIP 321's example addresses fail their bech32
 * checksums too: they are illustrations, not addresses. Both are kept as
 * parsing vectors (../vectors/bitcoin.ts), and the conformance suite expects
 * validation to report the checksum. The vector that validates puts BIP 173's
 * first test address into a BIP 21 link.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { base58CheckDecode } from '../base58.js';
import { decodeSegwitAddress } from '../bech32.js';
import { definePayload, field, unparseable } from '../define.js';
import { parseQuery } from '../escape.js';
import { decimalPlaces, FIELD_ISSUES, formatDecimal, numberOf, textOf } from '../fields.js';

const ID = 'bitcoin';

export type BitcoinValue = {
	readonly address: string;
	readonly amount: number | null;
	readonly label: string;
	readonly message: string;
};

export type AddressNetwork = 'mainnet' | 'testnet';

/** The network an address is for, or why it is not an address. */
export function bitcoinAddressNetwork(address: string): AddressNetwork | 'format' | 'checksum' {
	if (address.length > 100) return 'format';
	if (/^(?:bc|tb)1/i.test(address)) {
		const decoded = decodeSegwitAddress(address);
		if (!decoded.ok)
			return decoded.reason === 'checksum' || decoded.reason === 'wrong-encoding'
				? 'checksum'
				: 'format';
		// A string that starts bc1 can still have a longer human-readable part
		// ("bc1qq1..." has "bc1qq"), which no wallet pays.
		if (decoded.value.hrp === 'bc') return 'mainnet';
		return decoded.value.hrp === 'tb' ? 'testnet' : 'format';
	}
	const decoded = base58CheckDecode(address);
	if (!decoded.ok) return decoded.reason;
	if (decoded.value.length !== 21) return 'format';
	// Version bytes: 0x00 pay to public key hash and 0x05 pay to script hash
	// on mainnet, 0x6f and 0xc4 on testnet.
	const version = decoded.value[0];
	if (version === 0x00 || version === 0x05) return 'mainnet';
	if (version === 0x6f || version === 0xc4) return 'testnet';
	return 'format';
}

function rules(value: BitcoinValue, flagged: (key: string) => boolean): Issue[] {
	const found: Issue[] = [];
	const address = textOf(value, 'address');
	if (address !== '' && !flagged('address')) {
		const network = bitcoinAddressNetwork(address);
		const path = ['fields', 'address'];
		if (network === 'format') found.push(issue('payload.bitcoin.issue.address', path));
		else if (network === 'checksum')
			found.push(issue('payload.bitcoin.issue.address-checksum', path));
		else if (network === 'testnet')
			found.push(issue('payload.bitcoin.issue.testnet', path, 'warning'));
	}
	const amount = numberOf(value, 'amount');
	if (amount !== null && !flagged('amount') && decimalPlaces(amount) > 8) {
		// A satoshi is 0.00000001 BTC; there is nothing smaller to pay.
		found.push(issue(FIELD_ISSUES.amountDecimals, ['fields', 'amount'], 'error', { max: 8 }));
	}
	return found;
}

function write(value: BitcoinValue): string {
	const query: string[] = [];
	const amount = numberOf(value, 'amount');
	if (amount !== null) query.push(`amount=${formatDecimal(amount, 8)}`);
	if (textOf(value, 'label') !== '')
		query.push(`label=${encodeURIComponent(textOf(value, 'label'))}`);
	if (textOf(value, 'message') !== '')
		query.push(`message=${encodeURIComponent(textOf(value, 'message'))}`);
	return `bitcoin:${textOf(value, 'address')}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}

function parse(text: string): BitcoinValue {
	if (!/^bitcoin:/i.test(text)) throw unparseable(ID, 'not-bitcoin');
	const rest = text.slice(8);
	const mark = rest.indexOf('?');
	const address = mark === -1 ? rest : rest.slice(0, mark);
	const pairs = parseQuery(mark === -1 ? '' : rest.slice(mark + 1));
	if (pairs === undefined) throw unparseable(ID, 'malformed-escape');
	const seen = new Map<string, string>();
	for (const [rawName, raw] of pairs) {
		const name = rawName.toLowerCase();
		if (name.startsWith('req-')) throw unparseable(ID, 'unknown-required-parameter');
		if (['amount', 'label', 'message'].includes(name)) {
			if (seen.has(name)) throw unparseable(ID, 'repeated-parameter');
			seen.set(name, raw);
		}
	}
	const amountText = seen.get('amount');
	if (amountText !== undefined && !/^\d+(?:\.\d*)?$|^\.\d+$/.test(amountText))
		throw unparseable(ID, 'amount');
	return {
		address,
		amount: amountText === undefined ? null : Number(amountText),
		label: seen.get('label') ?? '',
		message: seen.get('message') ?? '',
	};
}

export const bitcoinType = definePayload<BitcoinValue>({
	id: ID,
	category: 'payment',
	fields: [
		field(ID, 'address', 'text', { required: true, maxLength: 100, hint: true }),
		field(ID, 'amount', 'amount', { min: 0.00000001, max: 21000000 }),
		field(ID, 'label', 'text', { maxLength: 200 }),
		field(ID, 'message', 'text', { maxLength: 200 }),
	],
	rules,
	write,
	detect: (text) => (/^bitcoin:/i.test(text) ? 1 : 0),
	parse,
	safety: () => [{ code: 'payload/payment', severity: 'caution' }],
});
