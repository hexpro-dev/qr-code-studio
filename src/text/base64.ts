/**
 * Base64 to bytes, for the compiled font tables.
 *
 * `atob` would do it in a browser, but it is not in every server runtime this
 * package is imported into, and it returns a Latin-1 string rather than
 * bytes. This is plain arithmetic, the same everywhere, and strict: anything
 * but the standard alphabet with correct padding is refused.
 */

import { malformed } from './errors.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

let lookup: Int8Array | undefined;

function table(): Int8Array {
	if (lookup !== undefined) return lookup;
	const built = new Int8Array(128).fill(-1);
	for (let i = 0; i < ALPHABET.length; i += 1) built[ALPHABET.charCodeAt(i)] = i;
	lookup = built;
	return built;
}

/** Standard base64 with padding, as RFC 4648 section 4 defines it. */
export function decodeBase64(text: string): Uint8Array {
	const values = table();
	if (text.length % 4 !== 0) malformed('compiled', 'truncated');
	const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
	const out = new Uint8Array((text.length / 4) * 3 - padding);
	let at = 0;
	for (let i = 0; i < text.length; i += 4) {
		let n = 0;
		for (let j = 0; j < 4; j += 1) {
			const code = text.charCodeAt(i + j);
			const last = i + 4 === text.length;
			const pad = last && code === 0x3d && j >= 4 - padding;
			const value = pad ? 0 : code < 128 ? (values[code] as number) : -1;
			if (value < 0) malformed('compiled', 'out-of-range');
			n = n * 64 + value;
		}
		if (at < out.length) out[at++] = (n >> 16) & 0xff;
		if (at < out.length) out[at++] = (n >> 8) & 0xff;
		if (at < out.length) out[at++] = n & 0xff;
	}
	return out;
}
