/**
 * The specification vectors for the WhatsApp chat content type,
 * ../content/whatsapp.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { WhatsappValue } from '../content/whatsapp.js';
import type { PayloadVector } from '../types.js';

const FAQ = 'https://faq.whatsapp.com/5913398998672934';

export const whatsappVectors: readonly PayloadVector<WhatsappValue>[] = [
	{
		text: 'https://wa.me/15551234567',
		value: { number: '+15551234567', message: '' },
		source: `WhatsApp Help Centre, "How to use click to chat", ${FAQ}.`,
	},
	{
		text: "https://wa.me/15551234567?text=I'm%20interested%20in%20your%20car%20for%20sale",
		value: { number: '+15551234567', message: "I'm interested in your car for sale" },
		source: `WhatsApp Help Centre, "How to use click to chat", ${FAQ}.`,
	},
];
