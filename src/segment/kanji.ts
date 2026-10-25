/**
 * Which characters may go into kanji mode, and their Shift_JIS codes.
 *
 * Kanji mode stores a character as its Shift_JIS code in 13 bits, against 24
 * for the same character in UTF-8, so it is the densest way to carry Japanese.
 * The catch is that the reader turns the code back into a character with its
 * own Shift_JIS table, and Shift_JIS is not one table. JIS X 0208 as
 * published, Microsoft's CP932 and the WHATWG decoder every browser ships
 * disagree about a handful of codes: 0x8160 is WAVE DASH to one and FULLWIDTH
 * TILDE to another, 0x815F is REVERSE SOLIDUS or its fullwidth form. A code
 * from that handful reaches a phone as a different character from the one the
 * person typed, and nothing anywhere reports an error.
 *
 * So a character is eligible only where the decoders agree. The table is
 * derived from the WHATWG decoder this runtime already has (it is the one
 * hex-web's browsers use), with three things taken out:
 *
 *   - The codes where published decoders are known to disagree, listed in
 *     `DIVERGENT` with what each side reads. `tests/segment/kanji.test.ts`
 *     re-derives the list from two independent tables (iconv-lite's CP932 and
 *     the strict JIS X 0208 table jsQR reads with) and fails if this one
 *     drifts from them.
 *   - Row 13 (lead byte 0x87), NEC's special characters. Several are second
 *     codes for characters that also sit in row 2, readers outside Windows
 *     often lack the row, and nothing is lost: its characters either have
 *     another code or go into byte mode.
 *   - Anything the decoder does not map to a single character.
 *
 * The table is built on first use, never at import: it costs a few thousand
 * decoder calls, and most codes never contain a kanji. A runtime whose
 * TextDecoder has no Shift_JIS (Node built with small ICU) gets no table, and
 * `kanjiAvailable()` is false there, so kanji mode is never chosen rather than
 * chosen from a table that is not there.
 */

/** The QR kanji ranges of ISO/IEC 18004 7.4.6: 0x8140 to 0x9FFC and 0xE040 to 0xEBBF. */
const LEAD_RANGES: readonly (readonly [number, number])[] = [
	[0x81, 0x9f],
	[0xe0, 0xeb],
];
const LAST_CODE = 0xebbf;

/** NEC row 13. */
const EXCLUDED_LEAD = 0x87;

/**
 * Codes whose character depends on whose Shift_JIS table reads them.
 *
 * Each pair is (what WHATWG and CP932 read, what JIS X 0208 as published reads).
 */
export const DIVERGENT: ReadonlyMap<number, readonly [number, number]> = new Map([
	// EM DASH in JIS X 0208:1997, HORIZONTAL BAR in CP932 and WHATWG.
	[0x815c, [0x2015, 0x2014]],
	[0x815f, [0xff3c, 0x005c]],
	[0x8160, [0xff5e, 0x301c]],
	[0x8161, [0x2225, 0x2016]],
	[0x817c, [0xff0d, 0x2212]],
	// FULLWIDTH YEN SIGN to most, YEN SIGN to the readers that fold 1-79 into
	// the single-byte yen.
	[0x818f, [0xffe5, 0x00a5]],
	[0x8191, [0xffe0, 0x00a2]],
	[0x8192, [0xffe1, 0x00a3]],
	[0x81ca, [0xffe2, 0x00ac]],
]);

/** code point -> Shift_JIS code; null once the runtime has been found to lack a decoder. */
let table: Map<number, number> | null | undefined;

function build(): Map<number, number> | null {
	let decoder: TextDecoder;
	try {
		decoder = new TextDecoder('shift_jis');
	} catch {
		return null;
	}
	const map = new Map<number, number>();
	const pair = new Uint8Array(2);
	for (const [first, last] of LEAD_RANGES) {
		for (let lead = first; lead <= last; lead += 1) {
			if (lead === EXCLUDED_LEAD) continue;
			for (let trail = 0x40; trail <= 0xfc; trail += 1) {
				const code = (lead << 8) | trail;
				if (trail === 0x7f || code > LAST_CODE || DIVERGENT.has(code)) continue;
				pair[0] = lead;
				pair[1] = trail;
				const text = decoder.decode(pair);
				// An unmapped pair decodes to U+FFFD, followed by the trail byte when
				// that byte is ASCII. Only a single character other than U+FFFD is a
				// mapping.
				if (text.length !== 1 || text === '\ufffd') continue;
				// Within these ranges, with row 13 gone, no two codes decode to the
				// same character; the kanji test holds the table to that, so a plain
				// set cannot be overwriting anything.
				map.set(text.charCodeAt(0), code);
			}
		}
	}
	return map;
}

function tables(): Map<number, number> | null {
	if (table === undefined) table = build();
	return table;
}

/** True when this runtime can decode Shift_JIS, which kanji mode needs at both ends. */
export function kanjiAvailable(): boolean {
	return tables() !== null;
}

/** The Shift_JIS code for a character, only where WHATWG, Shift_JIS and CP932 agree. Built lazily. */
export function kanjiCode(codePoint: number): number | undefined {
	return tables()?.get(codePoint);
}

/**
 * A Shift_JIS code as kanji mode's 13-bit value (ISO/IEC 18004 7.4.6): take
 * 0x8140 or 0xC140 off, then the lead byte times 0xC0 plus the trail byte.
 */
export function kanjiValue(code: number): number {
	const offset = code <= 0x9ffc ? code - 0x8140 : code - 0xc140;
	return (offset >>> 8) * 0xc0 + (offset & 0xff);
}

/** Whether a Shift_JIS code is inside the kanji ranges, with a trail byte Shift_JIS allows. */
export function validKanjiCode(code: number): boolean {
	const trail = code & 0xff;
	const inRange = (code >= 0x8140 && code <= 0x9ffc) || (code >= 0xe040 && code <= LAST_CODE);
	return Number.isInteger(code) && inRange && trail >= 0x40 && trail <= 0xfc && trail !== 0x7f;
}

/**
 * The Shift_JIS code a 13-bit kanji value stands for, or undefined when the
 * value cannot have come from a code in the kanji ranges.
 */
export function kanjiCodeFromValue(value: number): number | undefined {
	const offset = Math.floor(value / 0xc0) * 0x100 + (value % 0xc0);
	const code = offset + (offset < 0x1f00 ? 0x8140 : 0xc140);
	return validKanjiCode(code) ? code : undefined;
}
