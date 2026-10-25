/**
 * A web link, http or https, with optional campaign (UTM) parameters.
 *
 * The parameters are Google Analytics' campaign tags
 * (support.google.com/analytics/answer/10917952). They sit behind the
 * advanced fields because most people making a code do not want them, and the
 * ones who do want all five spelt exactly.
 *
 * Detection is generous with confidence 0.5 for http and https, so every
 * type that lives at a specific host (wa.me, t.me, a GS1 Digital Link) can
 * outrank it. A link with a scheme that runs code is detected too, with a
 * lower score, so that the inspector explains it rather than calling it text.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { textOf } from '../fields.js';
import { takeQueryParams, withQueryParams } from '../uri.js';
import { analyseUrl } from '../url-safety.js';

const ID = 'url';

export type UrlValue = {
	readonly url: string;
	readonly utmSource: string;
	readonly utmMedium: string;
	readonly utmCampaign: string;
	readonly utmTerm: string;
	readonly utmContent: string;
};

const UTM = [
	['utmSource', 'utm_source'],
	['utmMedium', 'utm_medium'],
	['utmCampaign', 'utm_campaign'],
	['utmTerm', 'utm_term'],
	['utmContent', 'utm_content'],
] as const;

const utmField = (key: string) =>
	field(ID, key, 'text', { advanced: true, group: 'utm', maxLength: 200 });

function utmParams(value: UrlValue): [string, string][] {
	return UTM.filter(([key]) => textOf(value, key) !== '').map(([key, name]) => [
		name,
		textOf(value, key),
	]);
}

function rules(value: UrlValue): Issue[] {
	const set = UTM.filter(([key]) => textOf(value, key) !== '').map(([key]) => key);
	// Analytics groups a visit by source, medium and campaign together. A tag
	// with one of them missing still works, and is reported in a bucket of
	// its own, which is rarely what was meant.
	if (set.length === 0) return [];
	const missing = (['utmSource', 'utmMedium', 'utmCampaign'] as const).filter(
		(key) => !set.includes(key),
	);
	return missing.map((key) =>
		issue('payload.url.issue.utm-incomplete', ['fields', key], 'warning'),
	);
}

const DANGEROUS = /^(?:javascript|data|vbscript|file|blob):/i;

function detect(text: string): number {
	if (/\s/.test(text)) return 0;
	let parsed: URL;
	try {
		parsed = new URL(text);
	} catch {
		return 0;
	}
	if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return 0.5;
	if (DANGEROUS.test(text)) return 0.4;
	// Any other scheme written as an authority ("intent://", "ftp://") is a
	// link a phone may hand to some app. Anything else with a colon is more
	// likely a sentence.
	return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) ? 0.2 : 0;
}

function parse(text: string): UrlValue {
	if (detect(text) === 0) throw unparseable(ID, 'not-a-url');
	const { url, taken } = takeQueryParams(
		text,
		UTM.map(([, name]) => name),
	);
	const get = (name: string) => taken.get(name) ?? '';
	return {
		url,
		utmSource: get('utm_source'),
		utmMedium: get('utm_medium'),
		utmCampaign: get('utm_campaign'),
		utmTerm: get('utm_term'),
		utmContent: get('utm_content'),
	};
}

const NO_UTM = {
	utmSource: '',
	utmMedium: '',
	utmCampaign: '',
	utmTerm: '',
	utmContent: '',
} as const;

export const urlType = definePayload<UrlValue>({
	id: ID,
	category: 'link',
	fields: [
		field(ID, 'url', 'url', { required: true, hint: true }),
		...UTM.map(([key]) => utmField(key)),
	],
	rules,
	write: (value) => withQueryParams(textOf(value, 'url'), utmParams(value)),
	detect,
	parse,
	// The campaign tags are the person's own, added on purpose, so only the
	// link they typed is analysed.
	safety: (value) => analyseUrl(textOf(value, 'url')).findings,
	vectors: [
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
	],
});
