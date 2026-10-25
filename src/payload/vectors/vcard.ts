/**
 * The specification vectors for the vCard contact content type,
 * ../content/vcard.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { VcardValue } from '../content/vcard.js';
import type { PayloadVector } from '../types.js';

export const vcardVectors: readonly PayloadVector<VcardValue>[] = [
	{
		text: [
			'BEGIN:VCARD',
			'VERSION:3.0',
			'N:Example;Alex;;;',
			'FN:Alex Example',
			'ORG:Example Pty Ltd',
			'TEL;TYPE=CELL:+61400000000',
			'EMAIL;TYPE=INTERNET:alex@example.com',
			'END:VCARD',
		].join('\r\n'),
		value: {
			prefix: '',
			givenName: 'Alex',
			additionalNames: '',
			familyName: 'Example',
			suffix: '',
			formattedName: '',
			organisation: 'Example Pty Ltd',
			department: '',
			title: '',
			mobile: ['+61400000000'],
			workPhone: [],
			homePhone: [],
			fax: [],
			otherPhone: [],
			email: ['alex@example.com'],
			website: [],
			street: '',
			locality: '',
			region: '',
			postcode: '',
			country: '',
			addressType: 'work',
			note: '',
			birthday: '',
		},
		source:
			'RFC 2426 sections 3.1.1, 3.1.2, 3.3.1, 3.3.2 and 3.5.5 (FN, N, TEL, EMAIL, ORG); synthetic content.',
	},
];
