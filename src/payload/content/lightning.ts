/**
 * A Lightning invoice (BOLT 11), pasted from a wallet and wrapped as
 * lightning:<invoice>.
 *
 * Only wrapped, never made: an invoice is signed by the node that will be
 * paid, so the only honest source of one is that node's wallet. What is
 * checked is what can be checked without the network: the bech32 checksum
 * (BOLT 11 uses bech32 with BIP 173's length limit lifted), the prefix ("ln",
 * a BIP 173 currency prefix, then an optional amount with a multiplier), and
 * that the data is long enough to hold a timestamp and a signature.
 *
 * An invoice written in capitals is wrapped with a capital scheme, so the
 * whole text stays in the QR alphanumeric set and the code comes out smaller.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { bech32Decode } from '../bech32.js';
import { definePayload, field, unparseable } from '../define.js';
import { textOf } from '../fields.js';

const ID = 'lightning';

export type LightningValue = { readonly invoice: string };

/**
 * ln, then bc (mainnet), tb (testnet), tbs (signet) or bcrt (regtest), then
 * an amount with an optional multiplier: m, u, n or p (BOLT 11,
 * "Human-Readable Part").
 */
const PREFIX = /^ln(bcrt|tbs|bc|tb)(?:(\d+)([munp]?))?$/;

/** A timestamp is 7 groups and a signature 104 (BOLT 11, "Data Part"). */
const MIN_WORDS = 7 + 104;

export type InvoiceProblem = 'format' | 'checksum' | 'prefix' | 'amount' | 'testnet';

/** Undefined for a mainnet invoice that passes every offline check. */
export function invoiceProblem(invoice: string): InvoiceProblem | undefined {
	if (!/^ln/i.test(invoice)) return 'format';
	const decoded = bech32Decode(invoice, Number.POSITIVE_INFINITY);
	if (!decoded.ok) return decoded.reason === 'checksum' ? 'checksum' : 'format';
	if (decoded.value.encoding !== 'bech32') return 'checksum';
	const prefix = PREFIX.exec(decoded.value.hrp);
	if (!prefix) return 'prefix';
	const [, network, amount, multiplier] = prefix;
	// BOLT 11: a "p" amount must end in 0, because a picobitcoin is a tenth of
	// a millisatoshi and there is nothing that small to pay. A leading zero is
	// not allowed either.
	if (
		amount !== undefined &&
		(amount.startsWith('0') || (multiplier === 'p' && !amount.endsWith('0')))
	) {
		return 'amount';
	}
	if (decoded.value.words.length < MIN_WORDS) return 'format';
	return network === 'bc' ? undefined : 'testnet';
}

function rules(value: LightningValue, flagged: (key: string) => boolean): Issue[] {
	const invoice = textOf(value, 'invoice');
	if (invoice === '' || flagged('invoice')) return [];
	const problem = invoiceProblem(invoice);
	if (problem === undefined) return [];
	const path = ['fields', 'invoice'];
	return [
		issue(`payload.lightning.issue.${problem}`, path, problem === 'testnet' ? 'warning' : 'error'),
	];
}

function write(value: LightningValue): string {
	const invoice = textOf(value, 'invoice');
	return `${invoice === invoice.toUpperCase() ? 'LIGHTNING' : 'lightning'}:${invoice}`;
}

function parse(text: string): LightningValue {
	const invoice = text.replace(/^lightning:/i, '');
	if (!/^ln[a-z0-9]*1[a-z0-9]+$/i.test(invoice)) throw unparseable(ID, 'not-lightning');
	return { invoice };
}

export const lightningType = definePayload<LightningValue>({
	id: ID,
	category: 'payment',
	fields: [field(ID, 'invoice', 'text', { required: true, maxLength: 7000, hint: true })],
	rules,
	write,
	detect: (text) => {
		const invoice = text.replace(/^lightning:/i, '');
		if (!/^ln[a-z0-9]*1[a-z0-9]+$/i.test(invoice)) return 0;
		const problem = invoiceProblem(invoice);
		return problem === undefined || problem === 'testnet' ? 1 : 0.5;
	},
	parse,
	safety: () => [{ code: 'payload/payment', severity: 'caution' }],
});
