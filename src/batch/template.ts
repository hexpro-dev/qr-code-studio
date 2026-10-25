/**
 * Templates that fill in cells: `https://example.com/p/{sku}` for a field,
 * `label-{sku}` for a file name.
 *
 * `{name}` is the cell in the column called name. `{{` and `}}` are a
 * literal brace. A brace that starts nothing (`{` with no closing one, or an
 * empty `{}`) is kept as written, so a template is never refused for its
 * punctuation; only a name that is not a column is, by the caller.
 *
 * In a link, a cell's text has to stay one piece of the link. A product code
 * of `A/B` dropped raw into a path makes two path segments, and a campaign of
 * `spring&ref=evil` dropped into a query adds a parameter nobody wrote. So a
 * value placed after the link's scheme (anything once `https://` has been
 * written) is percent-encoded as a URL component (`encodeURIComponent`): it
 * can be a path segment, a query value or a fragment, and it cannot end
 * either or start another. A value placed before that is supplying the start
 * of the link itself (`{url}`, or `{site}/p/{sku}`), and goes in as it is,
 * to be checked as a link like any other.
 *
 * Text with an unpaired surrogate cannot be percent-encoded and goes in as it
 * is too, which the content type's validation then reports as the broken
 * character it is.
 */

import { foldHeader } from './csv.js';

export type TemplatePart = { readonly literal: string } | { readonly column: string };

/** A template's literal text and placeholders, in order. */
export function parseTemplate(template: string): readonly TemplatePart[] {
	const parts: TemplatePart[] = [];
	let literal = '';
	let at = 0;
	while (at < template.length) {
		const c = template[at] as string;
		if ((c === '{' || c === '}') && template[at + 1] === c) {
			literal += c;
			at += 2;
			continue;
		}
		if (c === '{') {
			const close = template.indexOf('}', at + 1);
			const inner = close === -1 ? '' : template.slice(at + 1, close);
			if (inner !== '' && !inner.includes('{')) {
				if (literal !== '') parts.push({ literal });
				literal = '';
				parts.push({ column: inner });
				at = close + 1;
				continue;
			}
		}
		literal += c;
		at += 1;
	}
	if (literal !== '') parts.push({ literal });
	return parts;
}

/**
 * The column a name refers to: the header that is exactly that name, else
 * the first that matches it ignoring case and surrounding spaces, else -1.
 * Spreadsheet headers pick up stray spaces, and a template typed by hand
 * rarely matches their case.
 */
export function findColumn(headers: readonly string[], name: string): number {
	const exact = headers.indexOf(name);
	if (exact !== -1) return exact;
	const folded = foldHeader(name);
	if (folded === '') return -1;
	return headers.findIndex((header) => foldHeader(header) === folded);
}

/** A template with each placeholder's column found. */
export interface CompiledTemplate {
	readonly parts: readonly ({ readonly literal: string } | { readonly index: number })[];
	/** Every column a placeholder reads. */
	readonly columns: readonly number[];
}

/** Each placeholder's column, or the name of the first that is not a column. */
export function compileTemplate(
	template: string,
	headers: readonly string[],
): CompiledTemplate | { readonly missing: string } {
	const parts: CompiledTemplate['parts'][number][] = [];
	const columns: number[] = [];
	for (const part of parseTemplate(template)) {
		if ('literal' in part) {
			parts.push(part);
			continue;
		}
		const index = findColumn(headers, part.column);
		if (index === -1) return { missing: part.column };
		parts.push({ index });
		columns.push(index);
	}
	return { parts, columns };
}

const SCHEME_WRITTEN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

function hasLoneSurrogate(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const low = text.charCodeAt(i + 1);
			if (!(low >= 0xdc00 && low <= 0xdfff)) return true;
			i += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

/** A compiled template filled in from one row; `url` escapes values placed after the scheme. */
export function fillTemplate(
	template: CompiledTemplate,
	cells: readonly string[],
	url: boolean,
): string {
	let out = '';
	for (const part of template.parts) {
		if ('literal' in part) {
			out += part.literal;
			continue;
		}
		const value = cells[part.index] ?? '';
		out +=
			url && SCHEME_WRITTEN.test(out) && !hasLoneSurrogate(value)
				? encodeURIComponent(value)
				: value;
	}
	return out;
}
