/**
 * Base64, for embedding a PNG in an SVG as a data URI.
 *
 * `btoa` would do it, but it takes a string of Latin-1 characters rather than
 * bytes, and building that string from a large image is its own trap (a
 * spread into `String.fromCharCode` overflows the stack). This is plain
 * arithmetic on the bytes and gives the same text everywhere.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding, as RFC 4648 section 4 defines it. */
export function base64(bytes: Uint8Array): string {
	const parts: string[] = [];
	let chunk = '';
	const whole = bytes.length - (bytes.length % 3);
	for (let i = 0; i < whole; i += 3) {
		const n =
			((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
		chunk +=
			(ALPHABET[n >> 18] as string) +
			(ALPHABET[(n >> 12) & 63] as string) +
			(ALPHABET[(n >> 6) & 63] as string) +
			(ALPHABET[n & 63] as string);
		// Joined in pieces so a long string is never rebuilt one quad at a time.
		if (chunk.length >= 8192) {
			parts.push(chunk);
			chunk = '';
		}
	}
	const rest = bytes.length - whole;
	if (rest === 1) {
		const n = (bytes[whole] as number) << 16;
		chunk += `${ALPHABET[n >> 18] as string}${ALPHABET[(n >> 12) & 63] as string}==`;
	} else if (rest === 2) {
		const n = ((bytes[whole] as number) << 16) | ((bytes[whole + 1] as number) << 8);
		chunk += `${ALPHABET[n >> 18] as string}${ALPHABET[(n >> 12) & 63] as string}${ALPHABET[(n >> 6) & 63] as string}=`;
	}
	parts.push(chunk);
	return parts.join('');
}
