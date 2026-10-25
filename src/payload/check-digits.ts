/**
 * Check digits for content, kept with the content types that use them.
 *
 * The containers' own checksums (CRC-32, Adler-32) live in core. These are
 * the ones a payment or a product code carries inside its text, and getting
 * one wrong means a code that scans perfectly and is then refused by the bank
 * or the till, which is worse than one that does not scan at all.
 *
 * Every function takes the digits as a string, because these are identifiers
 * that can be longer than a double holds exactly (an IBAN converted to digits
 * runs past thirty), and a string of something other than digits is a caller
 * mistake, so it throws `TypeError`.
 */

const DIGITS = /^[0-9]+$/;

function requireDigits(digits: string, what: string): void {
	if (typeof digits !== 'string' || !DIGITS.test(digits)) {
		throw new TypeError(`${what} takes a non-empty string of the digits 0 to 9.`);
	}
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xffff, no reflection,
 * no final XOR. EMVCo's merchant-presented QR specification (and so Pix's BR
 * Code) puts this over every byte up to and including the `6304` that
 * introduces it. The catalogue check value over the ASCII bytes of
 * "123456789" is 0x29b1.
 */
export function crc16CcittFalse(bytes: Uint8Array): number {
	let crc = 0xffff;
	for (const byte of bytes) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
		}
	}
	return crc;
}

/**
 * The remainder of a decimal number mod 97, as ISO 7064 MOD 97-10 uses it.
 *
 * An IBAN is valid when its rearranged digits leave 1; an ISO 11649 creditor
 * reference the same. Worked in chunks of seven digits so the running value
 * stays far inside the range a double holds exactly.
 */
export function mod97(digits: string): number {
	requireDigits(digits, 'mod97');
	let remainder = 0;
	for (let i = 0; i < digits.length; i += 7) {
		remainder = Number(`${remainder}${digits.slice(i, i + 7)}`) % 97;
	}
	return remainder;
}

/** The carry table from the Swiss QR-bill guidelines, section "Modulo 10, recursive". */
const RECURSIVE_TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5] as const;

/**
 * The check digit of a Swiss QR reference: modulo 10 recursive over the first
 * 26 digits, appended as the 27th. The guidelines' worked example takes
 * 21000000000313947143000901 to 7.
 */
export function mod10Recursive(digits: string): number {
	requireDigits(digits, 'mod10Recursive');
	let carry = 0;
	for (const digit of digits) {
		carry = RECURSIVE_TABLE[(carry + Number(digit)) % 10] as number;
	}
	return (10 - carry) % 10;
}

/**
 * The GS1 check digit for the digits that come before it: weights 3 and 1
 * alternating from the right, the rightmost data digit weighted 3. The same
 * rule serves GTIN-8, 12, 13 and 14, SSCC, GLN and the other GS1 keys (GS1
 * General Specifications, section 7.9.1).
 */
export function gs1CheckDigit(digits: string): number {
	requireDigits(digits, 'gs1CheckDigit');
	let sum = 0;
	for (let i = 0; i < digits.length; i += 1) {
		const digit = Number(digits[digits.length - 1 - i]);
		sum += i % 2 === 0 ? digit * 3 : digit;
	}
	return (10 - (sum % 10)) % 10;
}

/**
 * The Luhn check digit for the digits that come before it (ISO/IEC 7812-1,
 * Annex B). Doubling starts from the rightmost data digit, because that is
 * the one next to where the check digit goes.
 */
export function luhn(digits: string): number {
	requireDigits(digits, 'luhn');
	let sum = 0;
	for (let i = 0; i < digits.length; i += 1) {
		let digit = Number(digits[digits.length - 1 - i]);
		if (i % 2 === 0) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return (10 - (sum % 10)) % 10;
}
