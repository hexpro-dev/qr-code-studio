/**
 * A link with Google Analytics campaign parameters (utm_source, utm_medium,
 * utm_campaign, and optionally utm_term and utm_content), as Google documents
 * them (support.google.com/analytics/answer/10917952).
 *
 * Source, medium and campaign are required together: Analytics groups a
 * visit by all three, and a tag missing one is reported in a bucket of its
 * own, which is rarely what was meant.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { hasErrors } from '../core/issue.js';
import { withQueryParams } from './query.js';

export interface UtmParams {
	readonly source: string;
	readonly medium: string;
	readonly campaign: string;
	readonly term?: string;
	readonly content?: string;
}

export interface UtmLinkResult {
	/** The tagged link, or null when there is an error issue. */
	readonly url: string | null;
	readonly issues: readonly Issue[];
}

const NAMES = [
	['source', 'utm_source'],
	['medium', 'utm_medium'],
	['campaign', 'utm_campaign'],
	['term', 'utm_term'],
	['content', 'utm_content'],
] as const;

const REQUIRED = new Set(['source', 'medium', 'campaign']);

function isWebUrl(text: string): boolean {
	if (/\s/.test(text)) return false;
	try {
		const parsed = new URL(text);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:';
	} catch {
		return false;
	}
}

/**
 * A control character, or half of a surrogate pair. The second matters as
 * much as the first: encodeURIComponent throws on one, and a link with a
 * broken character in it cannot be written at all.
 */
function unusable(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return true;
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			i += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

export function utmLink(url: string, params: UtmParams): UtmLinkResult {
	if (typeof url !== 'string' || typeof params !== 'object' || params === null) {
		throw new TypeError('utmLink takes a URL string and an object of campaign parameters.');
	}
	const issues: Issue[] = [];
	if (!isWebUrl(url)) issues.push(issue('own-link.issue.url', ['url']));
	const pairs: [string, string][] = [];
	for (const [key, name] of NAMES) {
		const value = params[key] ?? '';
		if (typeof value !== 'string') {
			issues.push(issue('own-link.issue.utm-value', [key]));
		} else if (value.trim() === '') {
			if (REQUIRED.has(key)) issues.push(issue('own-link.issue.utm-required', [key]));
		} else if (unusable(value)) {
			issues.push(issue('own-link.issue.utm-value', [key]));
		} else {
			pairs.push([name, value]);
		}
	}
	if (hasErrors(issues)) return { url: null, issues };
	return { url: withQueryParams(url, pairs), issues };
}
