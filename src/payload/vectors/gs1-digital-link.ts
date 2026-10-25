/**
 * The specification vectors for the GS1 Digital Link content type,
 * ../content/gs1-digital-link.ts. Test data: see ./built-in.ts for why it
 * lives here rather than on the type.
 */

import type { Gs1DigitalLinkValue } from '../content/gs1-digital-link.js';
import type { PayloadVector } from '../types.js';

const STANDARD =
	'https://ref.gs1.org/standards/digital-link/uri-syntax/1.7.0/GS1-Digital-Link-Standard-URI-Syntax-i1-7-r-2026-08-06.pdf';

export const gs1DigitalLinkVectors: readonly PayloadVector<Gs1DigitalLinkValue>[] = [
	{
		text: 'https://id.gs1.org/01/09520123456788/10/ABC1/21/12345?17=180426',
		value: {
			domain: 'id.gs1.org',
			gtin: '09520123456788',
			batch: 'ABC1',
			serial: '12345',
			expiry: '180426',
			bestBefore: '',
		},
		source: `GS1 Digital Link Standard: URI Syntax 1.7.0, section 5.5 example. ${STANDARD}`,
	},
];
