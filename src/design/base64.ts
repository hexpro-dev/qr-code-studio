/**
 * Base64 both ways, in the standard alphabet (embedded PNGs) and the URL
 * alphabet without padding (design links).
 *
 * Decoding is strict: one spelling per byte string. A character outside the
 * alphabet, padding where there should be none, or leftover bits that are
 * not zero all refuse the text, so two different strings never decode to the
 * same bytes and a link is canonical in both directions.
 */

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function lookup(alphabet: string): Int16Array {
	const table = new Int16Array(128).fill(-1);
	for (let i = 0; i < alphabet.length; i += 1) table[alphabet.charCodeAt(i)] = i;
	return table;
}

function encodeWith(bytes: Uint8Array, alphabet: string, pad: boolean): string {
	let out = '';
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n =
			((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
		out +=
			(alphabet[n >> 18] as string) +
			(alphabet[(n >> 12) & 63] as string) +
			(alphabet[(n >> 6) & 63] as string) +
			(alphabet[n & 63] as string);
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = (bytes[i] as number) << 16;
		out += (alphabet[n >> 18] as string) + (alphabet[(n >> 12) & 63] as string) + (pad ? '==' : '');
	} else if (rest === 2) {
		const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
		out +=
			(alphabet[n >> 18] as string) +
			(alphabet[(n >> 12) & 63] as string) +
			(alphabet[(n >> 6) & 63] as string) +
			(pad ? '=' : '');
	}
	return out;
}

function decodeWith(text: string, table: Int16Array, pad: boolean): Uint8Array | null {
	let body = text;
	if (pad) {
		if (text.length % 4 !== 0) return null;
		if (text.endsWith('==')) body = text.slice(0, -2);
		else if (text.endsWith('=')) body = text.slice(0, -1);
	}
	if (body.length % 4 === 1) return null;
	const out = new Uint8Array(Math.floor((body.length * 3) / 4));
	let bits = 0;
	let value = 0;
	let at = 0;
	for (let i = 0; i < body.length; i += 1) {
		const code = body.charCodeAt(i);
		const digit = code < 128 ? (table[code] as number) : -1;
		if (digit < 0) return null;
		value = ((value << 6) | digit) & 0xffffff;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[at] = (value >> bits) & 0xff;
			at += 1;
		}
	}
	// The bits left over past the last whole byte must be zero, or two texts
	// would spell the same bytes.
	if ((value & ((1 << bits) - 1)) !== 0) return null;
	return out;
}

let standardTable: Int16Array | undefined;
let urlTable: Int16Array | undefined;

export function base64Encode(bytes: Uint8Array): string {
	return encodeWith(bytes, STANDARD, true);
}

/** The bytes, or null when the text is not canonical standard base64 with padding. */
export function base64Decode(text: string): Uint8Array | null {
	standardTable ??= lookup(STANDARD);
	return decodeWith(text, standardTable, true);
}

export function base64UrlEncode(bytes: Uint8Array): string {
	return encodeWith(bytes, URL, false);
}

/** The bytes, or null when the text is not canonical unpadded base64url. */
export function base64UrlDecode(text: string): Uint8Array | null {
	urlTable ??= lookup(URL);
	return decodeWith(text, urlTable, false);
}
