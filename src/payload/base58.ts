/**
 * Base58 and base58check, as Bitcoin's legacy and script-hash addresses use
 * them: the alphabet without 0, O, I and l, a version byte, and the first four
 * bytes of a double SHA-256 as the check.
 */

import { sha256 } from './hash.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Undefined when a character is outside the alphabet. */
export function base58Decode(text: string): Uint8Array | undefined {
	// Big-endian base conversion on a byte array, one character at a time.
	// Leading '1's are leading zero bytes and carry no value, so they are
	// counted separately.
	let zeros = 0;
	while (zeros < text.length && text[zeros] === '1') zeros += 1;
	const bytes: number[] = [];
	for (const char of text.slice(zeros)) {
		let carry = ALPHABET.indexOf(char);
		if (carry === -1) return undefined;
		for (let i = bytes.length - 1; i >= 0; i -= 1) {
			carry += (bytes[i] as number) * 58;
			bytes[i] = carry & 0xff;
			carry >>>= 8;
		}
		while (carry > 0) {
			bytes.unshift(carry & 0xff);
			carry >>>= 8;
		}
	}
	return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

export function base58Encode(bytes: Uint8Array): string {
	let zeros = 0;
	while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
	const digits: number[] = [];
	for (const byte of bytes.subarray(zeros)) {
		let carry = byte;
		for (let i = digits.length - 1; i >= 0; i -= 1) {
			carry += (digits[i] as number) * 256;
			digits[i] = carry % 58;
			carry = Math.floor(carry / 58);
		}
		while (carry > 0) {
			digits.unshift(carry % 58);
			carry = Math.floor(carry / 58);
		}
	}
	return '1'.repeat(zeros) + digits.map((digit) => ALPHABET[digit]).join('');
}

function checksum(payload: Uint8Array): Uint8Array {
	return sha256(sha256(payload)).subarray(0, 4);
}

/** Why a string is not base58check. */
export type Base58CheckFailure = 'format' | 'checksum';

/** The payload (version byte first) without its four check bytes. */
export function base58CheckDecode(
	text: string,
):
	| { readonly ok: true; readonly value: Uint8Array }
	| { readonly ok: false; readonly reason: Base58CheckFailure } {
	const bytes = base58Decode(text);
	if (bytes === undefined || bytes.length < 5) return { ok: false, reason: 'format' };
	const payload = bytes.subarray(0, bytes.length - 4);
	const expected = checksum(payload);
	for (let i = 0; i < 4; i += 1) {
		if (bytes[payload.length + i] !== expected[i]) return { ok: false, reason: 'checksum' };
	}
	return { ok: true, value: Uint8Array.from(payload) };
}

/** For tests and generators: the payload with its check appended, in base58. */
export function base58CheckEncode(payload: Uint8Array): string {
	const out = new Uint8Array(payload.length + 4);
	out.set(payload);
	out.set(checksum(payload), payload.length);
	return base58Encode(out);
}
