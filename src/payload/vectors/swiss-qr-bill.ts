/**
 * The specification vectors for the Swiss QR-bill content type,
 * ../content/swiss-qr-bill.ts. Test data: see ./built-in.ts for why it lives
 * here rather than on the type.
 */

import type { SwissQrBillValue } from '../content/swiss-qr-bill.js';
import type { PayloadVector } from '../types.js';

const IG =
	'https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.4-en.pdf';

export const swissQrBillVectors: readonly PayloadVector<SwissQrBillValue>[] = [
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
];
