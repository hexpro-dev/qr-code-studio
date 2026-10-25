/**
 * The specification vectors for the text message content type,
 * ../content/sms.ts. Test data: see ./built-in.ts for why it lives here rather
 * than on the type.
 */

import type { SmsValue } from '../content/sms.js';
import type { PayloadVector } from '../types.js';

export const smsVectors: readonly PayloadVector<SmsValue>[] = [
	{
		text: 'SMSTO:+61400000000:Hello from the example',
		value: { number: '+61400000000', message: 'Hello from the example' },
		source: 'ZXing wiki, Barcode Contents, "SMS": SMSTO:number:message.',
	},
	{
		text: 'sms:+15105550101?body=hello%20there',
		value: { number: '+15105550101', message: 'hello there' },
		source: 'RFC 5724 section 2.5.',
	},
];
