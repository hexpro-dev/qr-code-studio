/**
 * The specification vectors for the phone number content type,
 * ../content/phone.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { PhoneValue } from '../content/phone.js';
import type { PayloadVector } from '../types.js';

export const phoneVectors: readonly PayloadVector<PhoneValue>[] = [
	{
		text: 'tel:+1-201-555-0123',
		value: { number: '+1-201-555-0123' },
		source: 'RFC 3966 section 6, first example.',
	},
];
