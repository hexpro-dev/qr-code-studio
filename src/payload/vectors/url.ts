/**
 * The specification vectors for the link content type, ../content/url.ts. Test
 * data: see ./built-in.ts for why it lives here rather than on the type.
 */

import type { UrlValue } from '../content/url.js';
import type { PayloadVector } from '../types.js';

const NO_UTM = {
	utmSource: '',
	utmMedium: '',
	utmCampaign: '',
	utmTerm: '',
	utmContent: '',
} as const;

export const urlVectors: readonly PayloadVector<UrlValue>[] = [
	{
		text: 'https://example.com/',
		value: { url: 'https://example.com/', ...NO_UTM },
		source: 'RFC 3986 section 3 (generic syntax); example.com is reserved by RFC 2606.',
	},
	{
		text: 'https://example.com/menu?utm_source=poster&utm_medium=qr&utm_campaign=spring',
		value: {
			url: 'https://example.com/menu',
			...NO_UTM,
			utmSource: 'poster',
			utmMedium: 'qr',
			utmCampaign: 'spring',
		},
		source:
			'Google Analytics campaign URL parameters, support.google.com/analytics/answer/10917952.',
	},
];
