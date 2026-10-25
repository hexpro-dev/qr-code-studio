/**
 * The specification vectors for the location content type, ../content/geo.ts.
 * Test data: see ./built-in.ts for why it lives here rather than on the type.
 */

import type { GeoValue } from '../content/geo.js';
import type { PayloadVector } from '../types.js';

export const geoVectors: readonly PayloadVector<GeoValue>[] = [
	{
		text: 'geo:13.4125,103.8667',
		value: { latitude: 13.4125, longitude: 103.8667, altitude: null, uncertainty: null },
		source: 'RFC 5870 section 1.',
	},
	{
		text: 'geo:48.2010,16.3695,183',
		value: { latitude: 48.201, longitude: 16.3695, altitude: 183, uncertainty: null },
		source: 'RFC 5870 section 6.2.',
	},
	{
		text: 'geo:48.198634,16.371648;crs=wgs84;u=40',
		value: { latitude: 48.198634, longitude: 16.371648, altitude: null, uncertainty: 40 },
		source: 'RFC 5870 section 6.2.',
	},
];
