/**
 * The escaping rules of the text formats a QR code commonly carries.
 *
 * There are two families and they disagree. MECARD and the WIFI: string put a
 * backslash before each reserved character and otherwise leave text alone.
 * vCard and iCalendar escape text the same way but also turn a newline into
 * `\n`, and on top of that fold long lines. Getting either wrong produces a
 * card that scans and then shows a name cut off at its first comma, which
 * looks like the reader's fault and is not.
 */

/** A backslash before each character in `reserved`, as MECARD and WIFI: write it. */
export function backslashEscape(text: string, reserved: string): string {
	let out = '';
	for (const char of text) out += reserved.includes(char) ? `\\${char}` : char;
	return out;
}

/** Undo `backslashEscape`: a backslash keeps whatever follows it. A trailing lone backslash is kept. */
export function backslashUnescape(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i] as string;
		if (char === '\\' && i + 1 < text.length) {
			i += 1;
			out += text[i] as string;
		} else {
			out += char;
		}
	}
	return out;
}

/** Split at each `separator` not preceded by an escaping backslash. Pieces stay escaped. */
export function splitUnescaped(text: string, separator: string): string[] {
	const pieces: string[] = [];
	let current = '';
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i] as string;
		if (char === '\\' && i + 1 < text.length) {
			current += char + (text[i + 1] as string);
			i += 1;
		} else if (char === separator) {
			pieces.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	pieces.push(current);
	return pieces;
}

/**
 * A TEXT value for vCard (RFC 2426 section 5, RFC 6350 section 3.4) or
 * iCalendar (RFC 5545 section 3.3.11): backslash, comma and semicolon get a
 * backslash, a newline becomes `\n`. Escaping the semicolon in a value that is
 * not compound is allowed by all three and read correctly by every parser, and
 * it means one function serves both kinds of value.
 */
export function escapeText(text: string): string {
	let out = '';
	for (const char of text) {
		if (char === '\\' || char === ',' || char === ';') out += `\\${char}`;
		else if (char === '\n') out += '\\n';
		else out += char;
	}
	return out;
}

/** Undo `escapeText`. `\N` is a newline too (RFC 5545 allows it); any other escaped character stands for itself. */
export function unescapeText(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i] as string;
		if (char !== '\\' || i + 1 >= text.length) {
			out += char;
			continue;
		}
		i += 1;
		const next = text[i] as string;
		out += next === 'n' || next === 'N' ? '\n' : next;
	}
	return out;
}

function utf8Length(codePoint: number): number {
	if (codePoint < 0x80) return 1;
	if (codePoint < 0x800) return 2;
	if (codePoint < 0x10000) return 3;
	return 4;
}

/**
 * Fold a content line at 75 octets, as RFC 5545 section 3.1 and RFC 6350
 * section 3.2 ask: CRLF and a space, never inside a UTF-8 sequence. The space
 * that starts a continuation counts towards that line's 75.
 */
export function foldLine(line: string): string {
	const out: string[] = [];
	let current = '';
	let octets = 0;
	for (const char of line) {
		const size = utf8Length(char.codePointAt(0) as number);
		if (octets + size > 75) {
			out.push(current);
			current = ' ';
			octets = 1;
		}
		current += char;
		octets += size;
	}
	out.push(current);
	return out.join('\r\n');
}

/**
 * Split text into unfolded content lines. CRLF is the standard ending; a bare
 * LF is accepted because plenty of generators write one, and a continuation
 * starts with one space or tab.
 */
export function unfoldLines(text: string): string[] {
	const lines: string[] = [];
	for (const raw of text.split(/\r\n|\n|\r/)) {
		if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
			lines[lines.length - 1] += raw.slice(1);
		} else {
			lines.push(raw);
		}
	}
	return lines;
}

export interface ContentLine {
	/** Upper case, without any group prefix. */
	readonly name: string;
	/** Parameter names upper case; each value split at unquoted commas, quotes removed. */
	readonly params: ReadonlyMap<string, readonly string[]>;
	/** As written: still escaped. */
	readonly value: string;
}

/**
 * Read `group.NAME;PARAM=a,b;TYPE="x,y":value` into its parts.
 *
 * Parameter values may be quoted, and a quoted one may hold the colon and
 * semicolon that otherwise end it. vCard 2.1 writes bare types (`TEL;CELL:`),
 * which are read as TYPE values so an old card still says which number is the
 * mobile. Undefined when the line has no colon outside quotes.
 */
export function parseContentLine(line: string): ContentLine | undefined {
	let quoted = false;
	let colon = -1;
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (char === '"') quoted = !quoted;
		else if (char === ':' && !quoted) {
			colon = i;
			break;
		}
	}
	if (colon === -1) return undefined;
	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const parts = splitOutsideQuotes(head, ';');
	const qualified = (parts.shift() as string).toUpperCase();
	const name = qualified.slice(qualified.lastIndexOf('.') + 1);
	const params = new Map<string, string[]>();
	for (const part of parts) {
		const equals = part.indexOf('=');
		const key = equals === -1 ? 'TYPE' : part.slice(0, equals).toUpperCase();
		const raw = equals === -1 ? part : part.slice(equals + 1);
		const values = splitOutsideQuotes(raw, ',').map((item) => item.replace(/^"|"$/g, ''));
		params.set(key, [...(params.get(key) ?? []), ...values]);
	}
	return { name, params, value };
}

function splitOutsideQuotes(text: string, separator: string): string[] {
	const pieces: string[] = [];
	let current = '';
	let quoted = false;
	for (const char of text) {
		if (char === '"') quoted = !quoted;
		if (char === separator && !quoted) {
			pieces.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	pieces.push(current);
	return pieces;
}

/** Split an escaped compound value (`N`, `ADR`, `ORG`) at its unescaped semicolons, then unescape each part. */
export function splitCompound(value: string): string[] {
	return splitUnescaped(value, ';').map(unescapeText);
}

/** `decodeURIComponent` that answers undefined on a malformed escape rather than throwing URIError. */
export function percentDecode(text: string, plusAsSpace = false): string | undefined {
	try {
		return decodeURIComponent(plusAsSpace ? text.replace(/\+/g, ' ') : text);
	} catch {
		return undefined;
	}
}

/**
 * The query of a URI as decoded name and value pairs, in order, names as
 * written. Undefined when any escape is malformed, because a link whose
 * parameters cannot be read cannot be explained either.
 */
export function parseQuery(
	query: string,
	plusAsSpace = false,
): (readonly [string, string])[] | undefined {
	const pairs: (readonly [string, string])[] = [];
	if (query === '') return pairs;
	for (const part of query.split('&')) {
		if (part === '') continue;
		const equals = part.indexOf('=');
		const name = percentDecode(equals === -1 ? part : part.slice(0, equals), plusAsSpace);
		const value = percentDecode(equals === -1 ? '' : part.slice(equals + 1), plusAsSpace);
		if (name === undefined || value === undefined) return undefined;
		pairs.push([name, value]);
	}
	return pairs;
}
