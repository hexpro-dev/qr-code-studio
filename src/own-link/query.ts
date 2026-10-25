/**
 * Setting query parameters on a URL as text.
 *
 * The same rule as `payload/uri.ts`, kept here because own-link may import
 * only from core: the link comes back as the person wrote it, with the named
 * parameters replaced or appended, rather than re-serialised by `URL`.
 */

function decodedName(part: string): string {
	const equals = part.indexOf('=');
	const raw = (equals === -1 ? part : part.slice(0, equals)).replace(/\+/g, ' ');
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

/** Set the given parameters, of which there is always at least one. */
export function withQueryParams(
	url: string,
	params: readonly (readonly [string, string])[],
): string {
	const hash = url.indexOf('#');
	const fragment = hash === -1 ? '' : url.slice(hash);
	const rest = hash === -1 ? url : url.slice(0, hash);
	const mark = rest.indexOf('?');
	const base = mark === -1 ? rest : rest.slice(0, mark);
	const existing = mark === -1 ? [] : rest.slice(mark + 1).split('&');
	const names = new Set(params.map(([name]) => name));
	const parts = [
		...existing.filter((part) => part !== '' && !names.has(decodedName(part))),
		...params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`),
	];
	return `${base}?${parts.join('&')}${fragment}`;
}
