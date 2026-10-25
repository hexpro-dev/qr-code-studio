/**
 * The specification vectors for the Telegram chat content type,
 * ../content/telegram.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { TelegramValue } from '../content/telegram.js';
import type { PayloadVector } from '../types.js';

const LINKS = 'https://core.telegram.org/api/links';

export const telegramVectors: readonly PayloadVector<TelegramValue>[] = [
	{
		text: 'https://t.me/example_channel',
		value: { target: 'username', username: 'example_channel', phone: '', message: '' },
		source: `Telegram, "Deep links", public username links, ${LINKS}.`,
	},
	{
		text: 'https://t.me/+61400000000?text=Hello',
		value: { target: 'phone', username: '', phone: '+61400000000', message: 'Hello' },
		source: `Telegram, "Deep links", phone number links, ${LINKS}.`,
	},
];
