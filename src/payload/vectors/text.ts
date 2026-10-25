/**
 * The specification vectors for the plain text content type,
 * ../content/text.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { TextValue } from '../content/text.js';
import type { PayloadVector } from '../types.js';

export const textVectors: readonly PayloadVector<TextValue>[] = [
	{
		text: 'Example text',
		value: { text: 'Example text' },
		source:
			'ISO/IEC 18004:2015 section 7.4: a symbol carries text with no structure required of it.',
	},
];
