/**
 * File names for the codes in a batch, built from a person's spreadsheet.
 *
 * A file name template such as `label-{sku}` fills in cells somebody else
 * typed, and the ZIP is opened on Windows, macOS and Linux by extractors of
 * every age. So each name is cleaned until it means the same everywhere and
 * can only land in the folder it was extracted into:
 *
 * - Unicode NFC, so a name typed on a Mac (which once stored decomposed
 *   accents) and the same name typed elsewhere are one name, for duplicates
 *   as well as for display.
 * - No path at all: `/` and `\` and the other characters Windows reserves
 *   (`< > : " | ? *`) become hyphens, and runs of dots become one, so no
 *   `..` survives anywhere in a name, let alone as a folder.
 * - No control characters, and none of the invisible ones that reorder or
 *   hide text: "invoice", a right-to-left override (U+202E) and "gpj.exe"
 *   display as "invoiceexe.jpg", which is why they are removed rather than
 *   kept.
 * - Nothing at either end that a system treats specially: a leading dot
 *   hides a file on Unix, a leading hyphen reads as an option to a shell
 *   command, and Windows drops trailing dots and spaces, so "a." and "a"
 *   would be one file there.
 * - Not one of Windows' device names (CON, PRN, AUX, NUL, COM0 to COM9, LPT0
 *   to LPT9 and the superscript forms), with or without an extension, which
 *   Windows will not create as files. These get a leading underscore.
 * - At most 120 bytes of UTF-8, cut at a character boundary, leaving room
 *   under every file system's 255 for a number and an extension.
 * - An extension this layer adds itself is taken off the end, so a template
 *   of `{sku}.png` does not give `ABC.png.png`.
 *
 * Every rule is applied until nothing changes, so cleaning a clean name gives
 * it back unchanged: `runBatch` cleans the names it is given again, in case
 * they did not come from `planBatch`, and must not rename anything that did.
 */

/** The most bytes of UTF-8 in a name before its number and extension. */
export const MAX_NAME_BYTES = 120;

/** The extensions `runBatch` writes, which a template need not and should not give. */
const OWN_EXTENSION = /\.(?:svg|png|pdf|eps)$/i;

/**
 * Whether a code point is removed outright: the C0 and C1 controls other
 * than the whitespace ones (which become spaces), DEL, the soft hyphen, the
 * zero width space and word joiner, the byte order mark, and every
 * bidirectional control: the Arabic letter mark, the left-to-right and
 * right-to-left marks, embeddings, overrides and isolates. Joiners stay,
 * because Persian and the Indic scripts need them, and so do emoji.
 */
function removed(code: number): boolean {
	if (code <= 0x08 || (code >= 0x0e && code <= 0x1f)) return true;
	if (code >= 0x7f && code <= 0x9f) return code !== 0x85;
	return (
		code === 0xad ||
		code === 0x061c ||
		code === 0x200b ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		code === 0x2060 ||
		(code >= 0x2066 && code <= 0x2069) ||
		code === 0xfeff
	);
}

/** The text without removed characters or unpaired surrogates, which a ZIP name cannot hold. */
function withoutInvisible(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const low = text.charCodeAt(i + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				out += text.slice(i, i + 2);
				i += 1;
			}
			continue;
		}
		if ((code >= 0xdc00 && code <= 0xdfff) || removed(code)) continue;
		out += text[i];
	}
	return out;
}

/** Whitespace of every kind, the line and paragraph separators and NEL included, becomes one space. */
const SPACES = /[\s\u0085]+/g;

/** What Windows reserves in a name, and the path separators everywhere. */
const RESERVED_CHARACTERS = /[<>:"/\\|?*]/g;

/** Windows device names, matched against the part of a name before its first dot. */
const DEVICE =
	/^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;

function utf8Length(text: string): number {
	let bytes = 0;
	for (const char of text) {
		const code = char.codePointAt(0) as number;
		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}
	return bytes;
}

/** The longest prefix of whole characters within `max` bytes of UTF-8. */
function truncate(text: string, max: number): string {
	if (utf8Length(text) <= max) return text;
	let out = '';
	let bytes = 0;
	for (const char of text) {
		const code = char.codePointAt(0) as number;
		const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
		if (bytes + size > max) break;
		out += char;
		bytes += size;
	}
	return out;
}

/** Leading dots, hyphens and spaces, and trailing ones with this layer's own extensions. */
function trimEnds(text: string): string {
	let out = text;
	for (;;) {
		const next = out
			.replace(OWN_EXTENSION, '')
			.replace(/^[ .-]+/, '')
			.replace(/[ .-]+$/, '');
		if (next === out) return out;
		out = next;
	}
}

function isDevice(name: string): boolean {
	const dot = name.indexOf('.');
	return DEVICE.test((dot === -1 ? name : name.slice(0, dot)).trim());
}

/** One pass of every rule. */
function clean(text: string, max: number): string {
	let out = withoutInvisible(text.normalize('NFC'))
		.replace(SPACES, ' ')
		.replace(RESERVED_CHARACTERS, '-')
		.replace(/-{2,}/g, '-')
		.replace(/\.{2,}/g, '.');
	out = trimEnds(out);
	if (isDevice(out)) out = `_${out}`;
	return trimEnds(truncate(out, max));
}

/**
 * A name safe to write into a ZIP on every system, without an extension, or
 * '' when nothing usable is left. The same name cleaned twice is unchanged.
 */
export function sanitiseFilename(text: string, max = MAX_NAME_BYTES): string {
	if (typeof text !== 'string') throw new TypeError('sanitiseFilename: text is a string.');
	if (!Number.isInteger(max) || max < 8 || max > 200) {
		throw new TypeError('sanitiseFilename: max is a whole number of bytes from 8 to 200.');
	}
	let out = text;
	// Each pass can only shorten the name or add the one underscore a device
	// name gets, which no later pass takes away, so this settles within a few.
	for (;;) {
		const next = clean(out, max);
		if (next === out) return out;
		out = next;
	}
}

/** How two names are compared for being the same file: NFC already, and case-folded as macOS and Windows extract. */
export function filenameKey(name: string): string {
	return name.toLowerCase();
}

export interface NamedRow {
	/** The cleaned name, or '' to use the fallback. */
	readonly name: string;
	/** The name to use when `name` is empty: `qr-<row number>`. */
	readonly fallback: string;
}

export interface UniqueName {
	readonly name: string;
	/** The number added to tell it from an earlier row with the same name, or null. */
	readonly number: number | null;
}

/**
 * One name per row, unique under case folding, in the order given.
 *
 * The first row with a name keeps it; a later row with the same one becomes
 * `name-2`, then `name-3`, skipping any number another row already has as its
 * own name, so a row that is really called `label-2` keeps that and the
 * second `label` becomes `label-3`. A numbered name is cut short first if it
 * would pass the length limit, so cleaning it again leaves it alone.
 */
export function uniqueFilenames(rows: readonly NamedRow[], max = MAX_NAME_BYTES): UniqueName[] {
	const wanted = rows.map((row) => (row.name === '' ? row.fallback : row.name));
	const taken = new Set<string>();
	const firstOf = new Map<string, number>();
	wanted.forEach((name, index) => {
		const key = filenameKey(name);
		if (!firstOf.has(key)) firstOf.set(key, index);
		taken.add(key);
	});
	// Where each name's numbering got to, so a thousand rows with one name
	// cost a thousand tries and not half a million.
	const next = new Map<string, number>();
	return wanted.map((name, index) => {
		const key = filenameKey(name);
		if (firstOf.get(key) === index) return { name, number: null };
		const numbered = (number: number): string => {
			const suffix = `-${number}`;
			return sanitiseFilename(`${trimEnds(truncate(name, max - suffix.length))}${suffix}`, max);
		};
		let number = next.get(key) ?? 2;
		let candidate = numbered(number);
		while (taken.has(filenameKey(candidate))) {
			number += 1;
			candidate = numbered(number);
		}
		taken.add(filenameKey(candidate));
		next.set(key, number + 1);
		return { name: candidate, number };
	});
}
