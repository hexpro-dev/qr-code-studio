/**
 * The specification vectors for the EPC credit transfer content type,
 * ../content/epc.ts. Test data: see ./built-in.ts for why it lives here rather
 * than on the type.
 */

import type { EpcValue } from '../content/epc.js';
import type { PayloadVector } from '../types.js';

const EPC069 =
	'https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2024-03/EPC069-12%20v3.1%20Quick%20Response%20Code%20-%20Guidelines%20to%20Enable%20the%20Data%20Capture%20for%20the%20Initiation%20of%20an%20SCT.pdf';

const NO_REMITTANCE = { reference: '', message: '', information: '' } as const;

export const epcVectors: readonly PayloadVector<EpcValue>[] = [
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
];
