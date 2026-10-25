/**
 * The specification vectors for the FaceTime call content type,
 * ../content/facetime.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { FacetimeValue } from '../content/facetime.js';
import type { PayloadVector } from '../types.js';

const SOURCE =
	'https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/FacetimeLinks/FacetimeLinks.html';

export const facetimeVectors: readonly PayloadVector<FacetimeValue>[] = [
	{
		text: 'facetime:14085551234',
		value: { contact: '14085551234', audioOnly: false },
		source: `Apple URL Scheme Reference, "FaceTime Links", ${SOURCE}.`,
	},
	{
		text: 'facetime-audio:user@example.com',
		value: { contact: 'user@example.com', audioOnly: true },
		source: `Apple URL Scheme Reference, "FaceTime Links", ${SOURCE}.`,
	},
];
