/**
 * The specification vectors for the MECARD contact content type,
 * ../content/mecard.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { MecardValue } from '../content/mecard.js';
import type { PayloadVector } from '../types.js';

const ZXING = 'https://github.com/zxing/zxing/wiki/Barcode-Contents#contact-information';

export const mecardVectors: readonly PayloadVector<MecardValue>[] = [
	{
		text: 'MECARD:N:Doe,John;TEL:13035551212;EMAIL:john.doe@example.com;;',
		value: {
			familyName: 'Doe',
			givenName: 'John',
			nickname: '',
			phones: ['13035551212'],
			email: ['john.doe@example.com'],
			url: '',
			address: '',
			organisation: '',
			note: '',
			birthday: '',
		},
		source: `ZXing wiki, Barcode Contents, MECARD example. ${ZXING}`,
	},
];
