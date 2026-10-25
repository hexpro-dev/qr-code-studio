/**
 * Bech32 (BIP 173) and bech32m (BIP 350), and the segwit address rules on top.
 *
 * Used twice: a Bitcoin address in a BIP 21 link, and a Lightning invoice,
 * which is a bech32 string with no length limit (BOLT 11). The checksum is
 * the point. A mistyped address with a valid checksum is about one in a
 * billion; a QR code that carries one with a broken checksum was made by
 * something that should not be trusted with money.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;

/** The constants the checksum must leave: 1 for bech32, BIP 350's for bech32m. */
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

export type Bech32Encoding = 'bech32' | 'bech32m';

export interface Bech32Decoded {
	readonly hrp: string;
	/** The data part as 5-bit groups, without the six checksum groups. */
	readonly words: readonly number[];
	readonly encoding: Bech32Encoding;
}

/** Why a string is not bech32, as an identifier a message key can be built from. */
export type Bech32Failure = 'format' | 'mixed-case' | 'too-long' | 'checksum';

function polymod(values: readonly number[]): number {
	let chk = 1;
	for (const value of values) {
		const top = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ value;
		for (let i = 0; i < 5; i += 1) {
			if ((top >>> i) & 1) chk ^= GENERATOR[i] as number;
		}
	}
	return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >>> 5);
	out.push(0);
	for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
	return out;
}

/**
 * Decode a bech32 or bech32m string.
 *
 * `limit` is BIP 173's 90 characters for an address; BOLT 11 lifts it,
 * because an invoice with a description and route hints is far longer.
 */
export function bech32Decode(
	text: string,
	limit = 90,
):
	| { readonly ok: true; readonly value: Bech32Decoded }
	| { readonly ok: false; readonly reason: Bech32Failure } {
	if (text.length > limit) return { ok: false, reason: 'too-long' };
	if (text !== text.toLowerCase() && text !== text.toUpperCase()) {
		return { ok: false, reason: 'mixed-case' };
	}
	const lower = text.toLowerCase();
	const separator = lower.lastIndexOf('1');
	if (separator < 1 || separator + 7 > lower.length) return { ok: false, reason: 'format' };
	const hrp = lower.slice(0, separator);
	for (let i = 0; i < hrp.length; i += 1) {
		const code = hrp.charCodeAt(i);
		if (code < 33 || code > 126) return { ok: false, reason: 'format' };
	}
	const words: number[] = [];
	for (const char of lower.slice(separator + 1)) {
		const word = CHARSET.indexOf(char);
		if (word === -1) return { ok: false, reason: 'format' };
		words.push(word);
	}
	const check = polymod([...hrpExpand(hrp), ...words]);
	const encoding: Bech32Encoding | undefined =
		check === BECH32_CONST ? 'bech32' : check === BECH32M_CONST ? 'bech32m' : undefined;
	if (encoding === undefined) return { ok: false, reason: 'checksum' };
	return { ok: true, value: { hrp, words: words.slice(0, -6), encoding } };
}

/** Encode 5-bit groups under a human-readable part, lowercase. For tests and generators. */
export function bech32Encode(
	hrp: string,
	words: readonly number[],
	encoding: Bech32Encoding,
): string {
	const constant = encoding === 'bech32' ? BECH32_CONST : BECH32M_CONST;
	const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
	const mod = polymod(values) ^ constant;
	let out = `${hrp}1`;
	for (const word of words) out += CHARSET[word];
	for (let i = 0; i < 6; i += 1) out += CHARSET[(mod >>> (5 * (5 - i))) & 31];
	return out;
}

/**
 * Regroup bits, as BIP 173's reference `convertbits` does. Returns undefined
 * when the input does not regroup cleanly without padding: leftover bits that
 * are not zero, or a whole spare group.
 */
export function convertBits(
	data: readonly number[],
	from: number,
	to: number,
	pad: boolean,
): number[] | undefined {
	let accumulator = 0;
	let bits = 0;
	const out: number[] = [];
	const maxValue = (1 << to) - 1;
	for (const value of data) {
		accumulator = (accumulator << from) | value;
		bits += from;
		while (bits >= to) {
			bits -= to;
			out.push((accumulator >>> bits) & maxValue);
		}
		// Keep only the bits not yet emitted, so the accumulator never
		// outgrows 32 bits on a long input.
		accumulator &= (1 << bits) - 1;
	}
	if (pad) {
		if (bits > 0) out.push((accumulator << (to - bits)) & maxValue);
	} else if (bits >= from || ((accumulator << (to - bits)) & maxValue) !== 0) {
		return undefined;
	}
	return out;
}

export interface SegwitAddress {
	readonly hrp: string;
	readonly version: number;
	readonly program: Uint8Array;
}

/** Why a string is not a segwit address. */
export type SegwitFailure = Bech32Failure | 'version' | 'program' | 'wrong-encoding';

/**
 * Decode a segwit address and apply BIP 173 and BIP 350's rules: version 0
 * to 16, a program of 2 to 40 bytes, 20 or 32 for version 0, bech32 for
 * version 0 and bech32m for everything after.
 */
export function decodeSegwitAddress(
	text: string,
):
	| { readonly ok: true; readonly value: SegwitAddress }
	| { readonly ok: false; readonly reason: SegwitFailure } {
	const decoded = bech32Decode(text);
	if (!decoded.ok) return decoded;
	const { hrp, words, encoding } = decoded.value;
	const [version, ...rest] = words;
	if (version === undefined || version > 16) return { ok: false, reason: 'version' };
	const program = convertBits(rest, 5, 8, false);
	if (program === undefined || program.length < 2 || program.length > 40) {
		return { ok: false, reason: 'program' };
	}
	if (version === 0 && program.length !== 20 && program.length !== 32) {
		return { ok: false, reason: 'program' };
	}
	if ((version === 0) !== (encoding === 'bech32')) return { ok: false, reason: 'wrong-encoding' };
	return { ok: true, value: { hrp, version, program: Uint8Array.from(program) } };
}
