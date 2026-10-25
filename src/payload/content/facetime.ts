/**
 * A FaceTime call, video or audio only, to a phone number or an Apple
 * account's email address: Apple's facetime: and facetime-audio: URL schemes
 * (Apple URL Scheme Reference, "FaceTime Links").
 *
 * Written as Apple's HTML examples write it, with a single colon. The
 * `facetime://` form from the same page's native examples is read too.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { percentDecode } from '../escape.js';
import { booleanOf, compactTel, isEmail, isTel, textOf } from '../fields.js';

const ID = 'facetime';
const SOURCE =
	'https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/FacetimeLinks/FacetimeLinks.html';

export type FacetimeValue = { readonly contact: string; readonly audioOnly: boolean };

/**
 * The contact as it goes after the colon. An address keeps its @ and +, which
 * Apple's examples show bare; anything else an address may hold (a %, say) is
 * percent-encoded, so that reading it back gives the same address.
 */
function contactText(contact: string): string {
	if (!isEmail(contact)) return compactTel(contact);
	return encodeURIComponent(contact).replace(/%40/g, '@').replace(/%2B/g, '+');
}

function rules(value: FacetimeValue, flagged: (key: string) => boolean): Issue[] {
	const contact = textOf(value, 'contact');
	if (flagged('contact') || contact === '' || isEmail(contact) || isTel(contact)) return [];
	return [issue('payload.facetime.issue.contact', ['fields', 'contact'])];
}

function parse(text: string): FacetimeValue {
	const match = /^(facetime|facetime-audio):(?:\/\/)?\s*(.+)$/i.exec(text);
	if (!match) throw unparseable(ID, 'not-facetime');
	const contact = percentDecode(match[2] as string);
	if (contact === undefined) throw unparseable(ID, 'malformed-escape');
	return { contact, audioOnly: (match[1] as string).toLowerCase() === 'facetime-audio' };
}

export const facetimeType = definePayload<FacetimeValue>({
	id: ID,
	category: 'contact',
	fields: [
		field(ID, 'contact', 'text', { required: true, maxLength: 254, hint: true }),
		field(ID, 'audioOnly', 'boolean', { default: false }),
	],
	compatibility: [
		{ reader: 'apple', noteKey: 'payload.facetime.compat.apple-only', source: SOURCE },
	],
	rules,
	write: (value) =>
		`${booleanOf(value, 'audioOnly') ? 'facetime-audio' : 'facetime'}:${contactText(textOf(value, 'contact'))}`,
	detect: (text) => (/^facetime(?:-audio)?:/i.test(text) ? 1 : 0),
	parse,
	vectors: [
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
	],
});
