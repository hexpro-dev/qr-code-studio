/**
 * A Signal chat with a phone number: https://signal.me/#p/+<number>.
 *
 * Signal does not document this link in its help centre. The format is the
 * one the Android app itself recognises, from SignalMeUtil.kt in
 * signalapp/Signal-Android: `^(https|sgnl)://signal\.me/#p/(\+[0-9]+)$`. The
 * number lives in the fragment, which a browser never sends to a server, so
 * signal.me's web page never learns it.
 *
 * Username links (#eu/...) are an encrypted reference only Signal can resolve,
 * so they are left to the plain link type.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { telDigits, textOf } from '../fields.js';

const ID = 'signal';
const SOURCE =
	'https://github.com/signalapp/Signal-Android/blob/main/app/src/main/java/org/thoughtcrime/securesms/util/SignalMeUtil.kt';

export type SignalValue = { readonly number: string };

const LINK = /^(?:https|sgnl):\/\/signal\.me\/#p\/(\+[0-9]+)$/i;

function rules(value: SignalValue, flagged: (key: string) => boolean): Issue[] {
	if (flagged('number') || textOf(value, 'number').startsWith('+')) return [];
	return [issue('payload.signal.issue.international', ['fields', 'number'])];
}

function parse(text: string): SignalValue {
	const match = LINK.exec(text);
	if (!match) throw unparseable(ID, 'not-signal');
	return { number: match[1] as string };
}

export const signalType = definePayload<SignalValue>({
	id: ID,
	category: 'message',
	fields: [field(ID, 'number', 'tel', { required: true, hint: true })],
	compatibility: [{ reader: 'signal', noteKey: 'payload.signal.compat.app', source: SOURCE }],
	rules,
	write: (value) => `https://signal.me/#p/+${telDigits(textOf(value, 'number'))}`,
	detect: (text) => (LINK.test(text) ? 0.9 : 0),
	parse,
	vectors: [
		{
			text: 'https://signal.me/#p/+61400000000',
			value: { number: '+61400000000' },
			source: `Signal for Android, SignalMeUtil.kt, ${SOURCE}.`,
		},
	],
});
