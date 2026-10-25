/**
 * Plain text: the fallback every reader understands and the type anything is
 * when it is not something more specific.
 */

import { definePayload, field } from '../define.js';
import { textOf } from '../fields.js';

const ID = 'text';

export type TextValue = { readonly text: string };

export const textType = definePayload<TextValue>({
	id: ID,
	category: 'text',
	fields: [field(ID, 'text', 'multiline', { required: true })],
	write: (value) => textOf(value, 'text'),
	// Any text is text, so this never says no; and it never says more than
	// "possibly", so every specific type outranks it.
	detect: (text) => (text === '' ? 0 : 0.01),
	parse: (text) => ({ text }),
});
