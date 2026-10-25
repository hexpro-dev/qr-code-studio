/**
 * Payments and commerce: Bitcoin, Lightning, SEPA, the Swiss QR-bill, Pix,
 * UPI, GS1 Digital Link and the Saudi e-invoice. A wrong digit here sends
 * money to the wrong place, so the checks are the specification's own and
 * the examples are the published ones.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { bitcoinAddressNetwork, bitcoinType } from '../../src/payload/content/bitcoin.js';
import { epcType } from '../../src/payload/content/epc.js';
import { gs1DigitalLinkType, gtin14 } from '../../src/payload/content/gs1-digital-link.js';
import { invoiceProblem, lightningType } from '../../src/payload/content/lightning.js';
import { isPixKey, pixType } from '../../src/payload/content/pix.js';
import {
	isQrIban,
	isQrReference,
	swissQrBillType,
} from '../../src/payload/content/swiss-qr-bill.js';
import { upiType } from '../../src/payload/content/upi.js';
import { base64Encode, zatcaType } from '../../src/payload/content/zatca.js';
import { emvCrc } from '../../src/payload/emv.js';
import type { PayloadType, PayloadValue } from '../../src/payload/types.js';
import { BOLT11_DONATION, VALID, invoiceWith } from './cases.js';

function refuses(type: PayloadType, text: string, code = 'payload/unparseable'): void {
	try {
		type.parse(text);
		expect.unreachable(`${type.id} read ${JSON.stringify(text)}`);
	} catch (error) {
		expect(error, text).toBeInstanceOf(QrStudioError);
		expect((error as QrStudioError).code, text).toBe(code);
	}
}

const build = (type: PayloadType, change: PayloadValue = {}) =>
	type.build({ ...VALID[type.id], ...change } as never).text;

const PAYMENT = [{ code: 'payload/payment', severity: 'caution' }];

describe('bitcoin', () => {
	it('writes the amount in plain decimal and encodes the label and message', () => {
		expect(
			build(bitcoinType, { amount: 0.00000001, label: 'Example & Co', message: 'Order 1' }),
		).toBe(
			'bitcoin:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4?amount=0.00000001&label=Example%20%26%20Co&message=Order%201',
		);
		expect(build(bitcoinType, { amount: null })).toBe(
			'bitcoin:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
		);
		expect(bitcoinType.safety?.(VALID.bitcoin as never)).toEqual(PAYMENT);
	});

	it('reads BIP 321 keys in any case and the amount forms BIP 21 allows', () => {
		expect(
			bitcoinType.parse('bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?AMOUNT=50.&Label=x'),
		).toMatchObject({
			amount: 50,
			label: 'x',
		});
		expect(bitcoinType.parse('bitcoin:addr?amount=.5&lightning=lnbc1x').amount).toBe(0.5);
		refuses(bitcoinType, 'bitcoin:addr?req-unknown=1');
		refuses(bitcoinType, 'bitcoin:addr?label=a&label=b');
		refuses(bitcoinType, 'bitcoin:addr?amount=1,000');
		refuses(bitcoinType, 'bitcoin:addr?label=%ZZ');
		refuses(bitcoinType, 'litecoin:addr');
		expect(bitcoinType.detect('litecoin:addr')).toBe(0);
	});

	it('knows each address network from its checks', () => {
		expect(bitcoinAddressNetwork('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('mainnet');
		expect(
			bitcoinAddressNetwork('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'),
		).toBe('mainnet');
		expect(bitcoinAddressNetwork(`1${'a'.repeat(100)}`)).toBe('format');
		expect(bitcoinAddressNetwork('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5')).toBe('checksum');
	});
});

describe('lightning', () => {
	it('wraps the invoice, keeping it upper case when it was', () => {
		expect(build(lightningType)).toBe(`lightning:${BOLT11_DONATION}`);
		const upper = BOLT11_DONATION.toUpperCase();
		expect(lightningType.build({ invoice: upper }).text).toBe(`LIGHTNING:${upper}`);
		expect(lightningType.parse(`LIGHTNING:${upper}`)).toEqual({ invoice: upper });
		expect(lightningType.safety?.(VALID.lightning as never)).toEqual(PAYMENT);
	});

	it('scores a damaged invoice below a good one', () => {
		expect(lightningType.detect(BOLT11_DONATION)).toBe(1);
		expect(lightningType.detect(invoiceWith('lntb20m'))).toBe(1);
		expect(lightningType.detect(`${BOLT11_DONATION.slice(0, -1)}m`)).toBe(0.5);
		expect(lightningType.detect('lightning:not an invoice')).toBe(0);
		refuses(lightningType, 'lnurl stuff');
	});

	it('accepts the prefixes BOLT 11 defines', () => {
		for (const hrp of ['lnbc', 'lnbc2500u', 'lnbc20m', 'lnbc10n', 'lnbc100p', 'lnbcrt1m']) {
			const problem = invoiceProblem(invoiceWith(hrp));
			expect(problem === undefined || problem === 'testnet', hrp).toBe(true);
		}
		expect(invoiceProblem(invoiceWith('lntbs1m'))).toBe('testnet');
		// BOLT 11's own "invalid multiplier" example.
		expect(invoiceProblem(invoiceWith('lnbc2500x'))).toBe('prefix');
		// BOLT 11's mixed-case example.
		expect(
			invoiceProblem(
				'LNBC2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpuyk0sg5g70me25alkluzd2x62aysf2pyy8edtjeevuv4p2d5p76r4zkmneet7uvyakky2zr4cusd45tftc9c5fh0nnqpnl2jfll544esqchsrny',
			),
		).toBe('format');
		// BOLT 11's "Bech32 checksum is invalid" example.
		expect(
			invoiceProblem(
				'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpuyk0sg5g70me25alkluzd2x62aysf2pyy8edtjeevuv4p2d5p76r4zkmneet7uvyakky2zr4cusd45tftc9c5fh0nnqpnl2jfll544esqchsrnt',
			),
		).toBe('checksum');
	});
});

describe('epc', () => {
	it('writes twelve elements at most and nothing after the last one used', () => {
		expect(build(epcType)).toBe(
			'BCD\n002\n1\nSCT\n\nExample\nDE89370400440532013000\nEUR12.3\n\n\nInvoice 1',
		);
		expect(
			build(epcType, {
				version: '001',
				bic: 'deutdeff',
				iban: 'de89 3704 0044 0532 0130 00',
				amount: null,
				message: '',
				reference: 'rf18 5390 0754 7034',
				information: 'Thank you',
			}),
		).toBe(
			'BCD\n001\n1\nSCT\nDEUTDEFF\nExample\nDE89370400440532013000\n\n\nRF18539007547034\n\nThank you',
		);
		expect(build(epcType, { message: '', reference: '1234 5678' })).toContain('\n1234 5678');
		expect(epcType.safety?.(VALID.epc as never)).toEqual(PAYMENT);
	});

	it('reads CRLF lines, and refuses a header or amount it does not know', () => {
		expect(
			epcType.parse('BCD\r\n002\r\n1\r\nSCT\r\n\r\nExample\r\nDE89370400440532013000'),
		).toMatchObject({
			name: 'Example',
			amount: null,
		});
		// A trailing line end breaks the letter of section 2.2 and nothing else.
		expect(epcType.parse(`${build(epcType)}\r\n`)).toEqual(VALID.epc);
		refuses(epcType, 'BCD\n003\n1\nSCT');
		refuses(epcType, 'BCD\n002\n9\nSCT');
		refuses(epcType, 'BCD\n002\n1\nSCX');
		refuses(epcType, 'BCD\n002\n1\nSCT\n\nExample\nDE89370400440532013000\nCHF12');
		refuses(epcType, `BCD\n002\n1\nSCT${'\nx'.repeat(9)}`);
		expect(epcType.detect('BCD\n002\n1\nSCT')).toBe(1);
		expect(epcType.detect('BCD\n002\n1\nSCTX')).toBe(0);
	});
});

describe('swiss-qr-bill', () => {
	it('writes the bill, leaving off empty lines after the trailer', () => {
		const lines = build(swissQrBillType).split('\n');
		expect(lines).toHaveLength(31);
		expect(lines[30]).toBe('EPD');
		expect(lines.slice(11, 18)).toEqual(['', '', '', '', '', '', '']);
		expect(lines.slice(20, 27)).toEqual(['', '', '', '', '', '', '']);
		const withAlternative = build(swissQrBillType, { alternative2: 'Example/2' }).split('\n');
		expect(withAlternative.slice(30)).toEqual(['EPD', '', '', 'Example/2']);
		expect(swissQrBillType.safety?.(VALID['swiss-qr-bill'] as never)).toEqual(PAYMENT);
	});

	it('writes a creditor reference compact and a debtor when there is one', () => {
		const text = build(swissQrBillType, {
			iban: 'CH93 0076 2011 6238 5295 7',
			referenceType: 'scor',
			reference: 'RF18 5390 0754 7034',
			currency: 'eur',
			amount: null,
			debtorName: 'Pia Example',
			debtorPostcode: '9400',
			debtorTown: 'Rorschach',
			debtorCountry: 'CH',
		});
		const lines = text.split('\n');
		expect(lines[3]).toBe('CH9300762011623852957');
		expect(lines.slice(18, 22)).toEqual(['', 'EUR', 'S', 'Pia Example']);
		expect(lines.slice(27, 29)).toEqual(['SCOR', 'RF18539007547034']);
		expect(swissQrBillType.parse(text)).toMatchObject({
			referenceType: 'scor',
			debtorTown: 'Rorschach',
		});
	});

	it('reads a retired combined address, with a warning when validated', () => {
		const rows = build(swissQrBillType).split('\n');
		rows.splice(4, 7, 'K', 'Example AG', 'Musterstrasse 1', '8000 Seldwyla', '', '', 'CH');
		const value = swissQrBillType.parse(rows.join('\r\n'));
		expect(value).toMatchObject({
			creditorAddressType: 'k',
			creditorStreet: 'Musterstrasse 1',
			creditorBuilding: '',
			creditorPostcode: '',
			creditorTown: '8000 Seldwyla',
		});
		const codes = swissQrBillType.validate(value).map((found) => [found.code, found.severity]);
		expect(codes).toContainEqual(['payload.swiss-qr-bill.issue.combined-address', 'warning']);
		expect(codes).toContainEqual(['payload.issue.required', 'error']);
	});

	it('makes a notification bill with an amount of 0.00, and reads a trailing line end', () => {
		const text = build(swissQrBillType, { amount: 0 });
		expect(text.split('\n')[18]).toBe('0.00');
		expect(swissQrBillType.parse(`${text}\n`)).toMatchObject({ amount: 0 });
	});

	it('refuses a bill it cannot read', () => {
		const rows = build(swissQrBillType).split('\n');
		const change = (index: number, line: string) =>
			rows.map((row, i) => (i === index ? line : row)).join('\n');
		refuses(swissQrBillType, change(1, '0100'));
		refuses(swissQrBillType, change(30, 'END'));
		refuses(swissQrBillType, change(4, 'X'));
		refuses(swissQrBillType, change(18, '10'));
		refuses(swissQrBillType, change(19, 'USD'));
		refuses(swissQrBillType, change(27, 'ABC'));
		refuses(swissQrBillType, `${rows.join('\n')}\na\nb\nc\nd`);
		refuses(swissQrBillType, 'BCD\n002');
		expect(swissQrBillType.detect('SPC\n0200\n1\n')).toBe(1);
		expect(swissQrBillType.detect('SPC\n0100\n1\n')).toBe(0);
	});

	it('knows a QR-IBAN and a QR reference', () => {
		expect(isQrIban('CH44 3199 9123 0008 8901 2')).toBe(true);
		expect(isQrIban('CH9300762011623852957')).toBe(false);
		expect(isQrIban('DE89370400440532013000')).toBe(false);
		expect(isQrReference('21 00000 00003 13947 14300 09017')).toBe(true);
		expect(isQrReference('210000000003139471430009018')).toBe(false);
		expect(isQrReference('2100000000031394714300090')).toBe(false);
	});
});

describe('pix', () => {
	it('writes amount, message and transaction ID in their places', () => {
		const text = build(pixType, { amount: 10.5, txid: 'ABC123' });
		// 26 holds the GUI (4 + 14), the key (4 + 36) and the message (4 + 7): 69.
		expect(text).toContain(
			'26690014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400000207Example',
		);
		expect(text).toContain('5204000053039865405' + '10.50' + '5802BR');
		expect(text).toContain('62100506ABC1236304');
		expect(text.slice(-4)).toBe(emvCrc(text.slice(0, -4)));
		expect(pixType.parse(text)).toEqual({ ...VALID.pix, amount: 10.5, txid: 'ABC123' });
		expect(pixType.safety?.(VALID.pix as never)).toEqual(PAYMENT);
	});

	it('says a damaged CRC is invalid rather than unreadable', () => {
		const text = build(pixType);
		refuses(pixType, `${text.slice(0, -4)}0000`, 'payload/invalid');
		refuses(pixType, 'not a pix code');
	});

	it('reads only static Pix in reais', () => {
		const payload = (objects: string) => {
			const body = `000201${objects}6304`;
			return `${body}${emvCrc(body)}`;
		};
		const account = '26330014BR.GOV.BCB.PIX0111123456789095204000053039865802BR5901X6001Y';
		expect(pixType.parse(payload(account))).toMatchObject({ key: '12345678909', txid: '' });
		// A damaged additional data template, and no name or city, still read.
		expect(
			pixType.parse(payload('26330014br.gov.bcb.pix0111123456789095204000053039865802BR6204xx99')),
		).toMatchObject({ key: '12345678909', name: '', city: '', txid: '' });
		refuses(pixType, payload('26180014br.gov.bcb.pix5204000053039865802BR'));
		refuses(pixType, payload('26360014br.gov.bcb.pix2514pix.example.com5204000053039865802BR'));
		refuses(pixType, payload('26180014br.com.other5204000053039865802BR'));
		refuses(pixType, payload('52040000'));
		refuses(pixType, payload('26290014br.gov.bcb.pix0107a@b.com5204000053038405802US'));
		refuses(pixType, payload('26290014br.gov.bcb.pix0107a@b.com52040000530398654041,005802BR'));
		expect(pixType.detect('000201 br.gov.bcb.pix')).toBe(1);
		expect(pixType.detect('000201')).toBe(0);
	});

	it('knows every kind of Pix key', () => {
		// Receita Federal's commonly published test numbers, and its example
		// of the alphanumeric CNPJ.
		expect(isPixKey('12345678909')).toBe(true);
		expect(isPixKey('12345678900')).toBe(false);
		expect(isPixKey('11111111111')).toBe(false);
		expect(isPixKey('11222333000181')).toBe(true);
		expect(isPixKey('11222333000182')).toBe(false);
		// Check digits that come from a remainder below 2, which makes them 0.
		expect(isPixKey('11222333001900')).toBe(true);
		expect(isPixKey('11222333000505')).toBe(true);
		expect(isPixKey('00000000000000')).toBe(false);
		expect(isPixKey('12ABC34501DE35')).toBe(true);
		expect(isPixKey('12ABC34501DE36')).toBe(false);
		expect(isPixKey('+5561912345678')).toBe(true);
		expect(isPixKey('+61400000000')).toBe(false);
		expect(isPixKey('someone@example.com')).toBe(true);
		expect(isPixKey(`${'a'.repeat(70)}@example.com`)).toBe(false);
		// DICT holds email and random keys in lower case.
		expect(isPixKey('123E4567-E12B-12D1-A456-426655440000')).toBe(false);
		expect(isPixKey('Someone@example.com')).toBe(false);
	});
});

describe('upi', () => {
	it('writes the address with its @, always in rupees', () => {
		expect(build(upiType, { amount: null, note: 'Table 4' })).toBe(
			'upi://pay?pa=example@upi&pn=Example%20Shop&cu=INR&tn=Table%204',
		);
		expect(upiType.safety?.(VALID.upi as never)).toEqual(PAYMENT);
	});

	it('refuses what is not a UPI payment in rupees', () => {
		expect(upiType.parse('UPI://pay?pa=a@b&am=')).toEqual({
			address: 'a@b',
			name: '',
			amount: null,
			note: '',
		});
		// Android's Uri.getQueryParameter, which UPI apps use, reads + as a space.
		expect(upiType.parse('upi://pay?pa=a@b&pn=Example+Shop').name).toBe('Example Shop');
		refuses(upiType, 'upi://pay?pn=x');
		refuses(upiType, 'upi://pay?pa=a@b&cu=USD');
		refuses(upiType, 'upi://pay?pa=a@b&am=ten');
		refuses(upiType, 'upi://pay?pa=%ZZ');
		refuses(upiType, 'upi://mandate?pa=a@b');
		expect(upiType.detect('upi://mandate?pa=a@b')).toBe(0);
	});
});

describe('gs1-digital-link', () => {
	it('writes GTIN-14, qualifiers in order, and sorted query parameters', () => {
		expect(
			build(gs1DigitalLinkType, {
				domain: 'example.com/gs1',
				gtin: '9520123456788',
				batch: 'A/B"1"',
				serial: "x&y=z?!'",
				expiry: '271231',
				bestBefore: '271200',
			}),
		).toBe(
			'https://example.com/gs1/01/09520123456788/10/A%2FB"1"/21/x%26y%3Dz%3F%21%27?15=271200&17=271231',
		);
		expect(build(gs1DigitalLinkType, { batch: '', serial: '', expiry: '' })).toBe(
			'https://id.gs1.org/01/09520123456788',
		);
		expect(
			build(gs1DigitalLinkType, { domain: 'Example.COM/GS1', batch: '', serial: '', expiry: '' }),
		).toBe('https://example.com/GS1/01/09520123456788');
	});

	it('reads a link under a path prefix, a short GTIN and either query delimiter', () => {
		expect(
			gs1DigitalLinkType.parse(
				'http://EXAMPLE.com/gs1/01/9520123456788/21/A%2FB/?17=271231;15=271200;x=1#top',
			),
		).toEqual({
			domain: 'example.com/gs1',
			gtin: '09520123456788',
			batch: '',
			serial: 'A/B',
			expiry: '271231',
			bestBefore: '271200',
		});
		expect(gs1DigitalLinkType.parse('https://id.gs1.org/01/09520123456788')).toEqual({
			domain: 'id.gs1.org',
			gtin: '09520123456788',
			batch: '',
			serial: '',
			expiry: '',
			bestBefore: '',
		});
		refuses(gs1DigitalLinkType, 'https://id.gs1.org/01/09520123456788/21/1/10/2');
		refuses(gs1DigitalLinkType, 'https://id.gs1.org/01/09520123456788/10/1/10/2');
		refuses(gs1DigitalLinkType, 'https://id.gs1.org/01/09520123456788/22/1');
		refuses(gs1DigitalLinkType, 'https://id.gs1.org/01/09520123456788/10');
		refuses(gs1DigitalLinkType, 'https://id.gs1.org/01/09520123456788/10/%ZZ');
		refuses(gs1DigitalLinkType, 'https://id.gs1.org/01/0952012345');
		refuses(gs1DigitalLinkType, 'https://id.gs1.org/gtin/09520123456788');
	});

	it('normalises GTINs and analyses the domain', () => {
		expect(gtin14('96385074')).toBe('00000096385074');
		expect(gtin14('123456789')).toBeUndefined();
		expect(
			gs1DigitalLinkType.safety?.({ ...VALID['gs1-digital-link'], domain: 'bit.ly' } as never),
		).toEqual([{ code: 'host/shortener', severity: 'caution', params: { host: 'bit.ly' } }]);
		expect(
			gs1DigitalLinkType.safety?.({ ...VALID['gs1-digital-link'], gtin: '1' } as never),
		).toEqual([]);
	});
});

describe('zatca', () => {
	const tlv = (records: readonly (readonly [number, string | Uint8Array])[]) => {
		const bytes: number[] = [];
		for (const [tag, value] of records) {
			const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
			bytes.push(tag, data.length, ...data);
		}
		return base64Encode(Uint8Array.from(bytes));
	};
	const PHASE_ONE = [
		[1, 'Example Trading'],
		[2, '300000000000003'],
		[3, '2026-10-25T09:30:00Z'],
		[4, '115.00'],
		[5, '15.00'],
	] as const;

	it('reads the phase 2 parts as present or absent, never more', () => {
		const text = tlv([
			...PHASE_ONE,
			[6, new Uint8Array(32)],
			[7, new Uint8Array(70)],
			[8, new Uint8Array(88)],
			[9, new Uint8Array(72)],
		]);
		expect(zatcaType.parse(` ${text} `)).toEqual({
			sellerName: 'Example Trading',
			vatNumber: '300000000000003',
			timestamp: '2026-10-25T09:30:00Z',
			total: '115.00',
			vatTotal: '15.00',
			hasInvoiceHash: true,
			hasSignature: true,
			hasPublicKey: true,
			hasStampSignature: true,
		});
		expect(zatcaType.validate(zatcaType.parse(text))).toEqual([]);
		expect(zatcaType.detect(text)).toBe(1);
	});

	it('cannot be made', () => {
		expect(zatcaType.generate).toBe(false);
		expect(() => zatcaType.build(VALID.zatca as never)).toThrow(TypeError);
	});

	it('refuses what is not an e-invoice code', () => {
		refuses(zatcaType, tlv(PHASE_ONE.slice(0, 4)));
		refuses(zatcaType, tlv([...PHASE_ONE, [1, 'again']]));
		refuses(zatcaType, tlv([[2, 'x']]));
		refuses(zatcaType, tlv([...PHASE_ONE.slice(0, 4), [5, Uint8Array.from([0xff, 0xfe])]]));
		refuses(zatcaType, base64Encode(Uint8Array.from([1, 9, 65])));
		refuses(zatcaType, base64Encode(Uint8Array.from([1])));
		refuses(zatcaType, '');
		refuses(zatcaType, 'not base64!');
		expect(zatcaType.detect('AQ==')).toBe(0);
	});
});
