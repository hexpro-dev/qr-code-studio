/**
 * Editing a URL's query as text.
 *
 * `URL.searchParams` would do this, but writing it back re-serialises the
 * whole URL: the host comes out in punycode, a trailing slash appears, and
 * percent-encoding changes case. A person who pasted a link and added a
 * campaign tag expects their link back with the tag on the end, so these work
 * on the text and touch only the parameters named.
 */

import { percentDecode } from './escape.js';

interface SplitUrl {
	readonly base: string;
	readonly parts: readonly string[];
	readonly fragment: string;
}

function split(url: string): SplitUrl {
	const hash = url.indexOf('#');
	const fragment = hash === -1 ? '' : url.slice(hash);
	const rest = hash === -1 ? url : url.slice(0, hash);
	const mark = rest.indexOf('?');
	if (mark === -1) return { base: rest, parts: [], fragment };
	return { base: rest.slice(0, mark), parts: rest.slice(mark + 1).split('&'), fragment };
}

function nameOf(part: string): string {
	const equals = part.indexOf('=');
	const raw = equals === -1 ? part : part.slice(0, equals);
	return percentDecode(raw, true) ?? raw;
}

function join({ base, parts, fragment }: SplitUrl): string {
	const kept = parts.filter((part) => part !== '');
	return `${base}${kept.length === 0 ? '' : `?${kept.join('&')}`}${fragment}`;
}

/**
 * Set query parameters, replacing any already there with the same names and
 * appending the rest in the order given. Values are percent-encoded; a space
 * becomes %20, which every server reads, where + is only a space in forms.
 */
export function withQueryParams(
	url: string,
	params: readonly (readonly [string, string])[],
): string {
	if (params.length === 0) return url;
	const parsed = split(url);
	const names = new Set(params.map(([name]) => name));
	const parts = [
		...parsed.parts.filter((part) => part !== '' && !names.has(nameOf(part))),
		...params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`),
	];
	return join({ ...parsed, parts });
}

/**
 * Take the named parameters out of a URL: the URL without them, and the
 * first value of each one found. The rest of the URL is left as written.
 */
export function takeQueryParams(
	url: string,
	names: readonly string[],
): { readonly url: string; readonly taken: ReadonlyMap<string, string> } {
	const parsed = split(url);
	const wanted = new Set(names);
	const taken = new Map<string, string>();
	const parts: string[] = [];
	for (const part of parsed.parts) {
		const name = nameOf(part);
		if (!wanted.has(name)) {
			parts.push(part);
			continue;
		}
		const equals = part.indexOf('=');
		const raw = equals === -1 ? '' : part.slice(equals + 1);
		if (!taken.has(name)) taken.set(name, percentDecode(raw, true) ?? raw);
	}
	if (taken.size === 0) return { url, taken };
	return { url: join({ ...parsed, parts }), taken };
}
