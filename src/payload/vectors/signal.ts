/**
 * The specification vectors for the Signal chat content type,
 * ../content/signal.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { SignalValue } from '../content/signal.js';
import type { PayloadVector } from '../types.js';

const SOURCE =
	'https://github.com/signalapp/Signal-Android/blob/main/app/src/main/java/org/thoughtcrime/securesms/util/SignalMeUtil.kt';

export const signalVectors: readonly PayloadVector<SignalValue>[] = [
	{
		text: 'https://signal.me/#p/+61400000000',
		value: { number: '+61400000000' },
		source: `Signal for Android, SignalMeUtil.kt, ${SOURCE}.`,
	},
];
