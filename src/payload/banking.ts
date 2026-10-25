/**
 * Bank identifiers: IBAN (ISO 13616), BIC (ISO 9362) and the structured
 * creditor reference (ISO 11649).
 *
 * The IBAN check is the one that saves somebody's money. A transposed pair of
 * digits passes every "looks like an IBAN" pattern and fails MOD 97-10, and a
 * payment code with a wrong IBAN that still validates at the bank sends the
 * money to a stranger.
 */

import { mod97 } from './check-digits.js';

/**
 * IBAN length by country, from the SWIFT IBAN Registry (release 99, 2025).
 * A country missing here is refused rather than guessed at. Written as
 * country and length pairs so the table reads as the registry's own list does.
 */
const IBAN_LENGTHS: ReadonlyMap<string, number> = new Map(
	[
		'AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BI27 BR29 BY28 CH21 CR22 CY28',
		'CZ24 DE22 DJ27 DK18 DO28 EE20 EG29 ES24 FI18 FK18 FO18 FR27 GB22 GE22 GI23',
		'GL18 GR27 GT28 HN28 HR21 HU28 IE22 IL23 IQ23 IS26 IT27 JO30 KW30 KZ20 LB28',
		'LC32 LI21 LT20 LU20 LV21 LY25 MC27 MD24 ME22 MK19 MN20 MR27 MT31 MU30 NI28',
		'NL18 NO15 OM23 PK24 PL28 PS29 PT25 QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24',
		'SI19 SK24 SM27 SO23 ST25 SV28 TL23 TN24 TR26 UA29 VA22 VG24 XK20 YE30',
	]
		.join(' ')
		.split(' ')
		.map((entry) => [entry.slice(0, 2), Number(entry.slice(2))] as const),
);

/** The electronic form: no spaces, upper case. A printed IBAN is grouped in fours. */
export function compactIban(text: string): string {
	return text.replace(/ /g, '').toUpperCase();
}

/** Letters to their two-digit values (A is 10), as ISO 13616 and ISO 11649 both convert them. */
export function lettersToDigits(text: string): string {
	let out = '';
	for (const char of text) {
		const code = char.charCodeAt(0);
		out += code >= 65 && code <= 90 ? String(code - 55) : char;
	}
	return out;
}

export type IbanProblem =
	| { readonly code: 'format' | 'country' | 'checksum' }
	| { readonly code: 'length'; readonly length: number; readonly expected: number };

/** Undefined for a valid IBAN, printed or electronic; otherwise what is wrong with it. */
export function ibanProblem(text: string): IbanProblem | undefined {
	const iban = compactIban(text);
	if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return { code: 'format' };
	const expected = IBAN_LENGTHS.get(iban.slice(0, 2));
	if (expected === undefined) return { code: 'country' };
	if (iban.length !== expected) return { code: 'length', length: iban.length, expected };
	if (mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) !== 1) return { code: 'checksum' };
	return undefined;
}

/** For tests and generators: an IBAN with its check digits worked out. */
export function ibanWithCheckDigits(country: string, bban: string): string {
	const remainder = mod97(lettersToDigits(`${bban}${country}00`));
	return `${country}${String(98 - remainder).padStart(2, '0')}${bban}`;
}

/**
 * Business party prefix, country, location and an optional branch (ISO 9362).
 * Lower case is accepted and upper-cased when built: people type BICs.
 */
export function isBic(text: string): boolean {
	return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(text.toUpperCase());
}

/**
 * An ISO 11649 structured creditor reference: "RF", two check digits, and 1
 * to 21 letters and digits, valid when MOD 97-10 over the rearranged
 * reference leaves 1. Printed in groups of four, so spaces are dropped first.
 */
export function compactCreditorReference(text: string): string {
	return text.replace(/ /g, '').toUpperCase();
}

export function isCreditorReference(text: string): boolean {
	const reference = compactCreditorReference(text);
	if (!/^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(reference)) return false;
	return mod97(lettersToDigits(reference.slice(4) + reference.slice(0, 4))) === 1;
}

/** For tests and generators: the full reference for a body. */
export function creditorReferenceFor(body: string): string {
	const remainder = mod97(lettersToDigits(`${body}RF00`));
	return `RF${String(98 - remainder).padStart(2, '0')}${body}`;
}
