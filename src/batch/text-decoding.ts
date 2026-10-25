/**
 * The bytes of a dropped CSV file, as text.
 *
 * A spreadsheet saves CSV in whatever its platform calls the default. Excel
 * on Windows writes "CSV (comma delimited)" in the machine's ANSI code page,
 * which for English and Western European installs is Windows-1252; "CSV
 * UTF-8" adds a byte order mark; "Unicode Text" is UTF-16 little endian with
 * one. Google Sheets and Numbers write UTF-8. So:
 *
 * 1. A UTF-16 byte order mark (FF FE or FE FF) means UTF-16. Nothing else
 *    starts that way: neither byte can begin UTF-8, and a Windows-1252 file
 *    opening with "y" diaeresis and thorn is not a spreadsheet.
 * 2. Otherwise strict UTF-8, which refuses any byte sequence UTF-8 cannot
 *    produce. A Windows-1252 file with an accented letter in it is almost
 *    never valid UTF-8 by accident, because a lone byte from 0x80 up is not.
 * 3. Otherwise Windows-1252, with a warning that says so, because a file in
 *    another code page (Cyrillic, Greek, Central European) will have come out
 *    wrong and the person is the only one who can tell.
 *
 * Windows-1252 is the WHATWG Encoding Standard's table, written out here
 * rather than asked of `TextDecoder`, which has it only in builds with full
 * ICU. The same goes for UTF-16, which is two lines. UTF-8 is `TextDecoder`'s,
 * which every engine has.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { BATCH_ISSUES } from './issues.js';
import type { DecodedText } from './types.js';

/**
 * Windows-1252 bytes 0x80 to 0x9F, from the WHATWG index. The five bytes the
 * code page leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the C1
 * control of the same number, as the standard says.
 */
const WINDOWS_1252_HIGH: readonly number[] = [
	0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
	0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
	0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/** Code units per `String.fromCharCode` call, well under every engine's argument limit. */
const CHUNK = 8192;

function fromUnits(units: Uint16Array | number[]): string {
	let out = '';
	for (let i = 0; i < units.length; i += CHUNK) {
		out += String.fromCharCode(...units.slice(i, i + CHUNK));
	}
	return out;
}

/** Windows-1252, every byte defined. */
export function decodeWindows1252(bytes: Uint8Array): string {
	const units = new Uint16Array(bytes.length);
	for (let i = 0; i < bytes.length; i += 1) {
		const byte = bytes[i] as number;
		units[i] = byte >= 0x80 && byte <= 0x9f ? (WINDOWS_1252_HIGH[byte - 0x80] as number) : byte;
	}
	return fromUnits(units);
}

/** UTF-16 code units in the given byte order. An unpaired surrogate is kept, for validation to report. */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
	const units = new Uint16Array(bytes.length >> 1);
	for (let i = 0; i < units.length; i += 1) {
		const a = bytes[2 * i] as number;
		const b = bytes[2 * i + 1] as number;
		units[i] = littleEndian ? a | (b << 8) : (a << 8) | b;
	}
	return fromUnits(units);
}

/** Strict UTF-8, or null when the bytes are not UTF-8. A leading byte order mark is dropped. */
function decodeUtf8(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

/** The text of a CSV file's bytes, the encoding it was read as, and a warning when that was a guess. */
export function decodeCsvBytes(bytes: Uint8Array): DecodedText {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('decodeCsvBytes: bytes is a Uint8Array.');
	const issues: Issue[] = [];
	const b0 = bytes[0];
	const b1 = bytes[1];
	if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
		const littleEndian = b0 === 0xff;
		issues.push(issue(BATCH_ISSUES.utf16, [], 'info'));
		if (bytes.length % 2 === 1) issues.push(issue(BATCH_ISSUES.oddLength, [], 'warning'));
		return {
			text: decodeUtf16(bytes.subarray(2), littleEndian),
			encoding: littleEndian ? 'utf-16le' : 'utf-16be',
			issues,
		};
	}
	const utf8 = decodeUtf8(bytes);
	if (utf8 !== null) return { text: utf8, encoding: 'utf-8', issues };
	issues.push(issue(BATCH_ISSUES.windows1252, [], 'warning'));
	const bom = b0 === 0xef && b1 === 0xbb && bytes[2] === 0xbf ? 3 : 0;
	return { text: decodeWindows1252(bytes.subarray(bom)), encoding: 'windows-1252', issues };
}
