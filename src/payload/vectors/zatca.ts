/**
 * The specification vectors for the Saudi e-invoice content type,
 * ../content/zatca.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 *
 * This type is read but never made here, so the vector checks reading, and
 * that `build` refuses.
 */

import type { ZatcaValue } from '../content/zatca.js';
import type { PayloadVector } from '../types.js';

const STANDARD =
	'https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf';

const GUIDE = 'https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/QRCodeCreation.pdf';

export const zatcaVectors: readonly PayloadVector<ZatcaValue>[] = [
	{
		text: 'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==',
		value: {
			sellerName: 'Bobs Records',
			vatNumber: '310122393500003',
			timestamp: '2022-04-25T15:30:00Z',
			total: '1000.00',
			vatTotal: '150.00',
			hasInvoiceHash: false,
			hasSignature: false,
			hasPublicKey: false,
			hasStampSignature: false,
		},
		source: `ZATCA, "Guide to Developed FATOORA Compliant QR Code", 18 November 2021, the worked example (format as in ${STANDARD}). ${GUIDE}`,
	},
];
