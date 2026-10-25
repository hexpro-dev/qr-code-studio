/**
 * Extended Channel Interpretation: which character set a byte segment is in.
 *
 * ISO/IEC 18004 says a byte segment with no ECI in front of it is ISO-8859-1.
 * Almost nothing that writes QR codes honours that: encoders emit UTF-8 and
 * no ECI, and readers, knowing this, try UTF-8 first. This package's encoder
 * follows the readers (see `SegmentationPolicy.eci` in `segment-text.ts`), and
 * its decoder reads both ways: strict UTF-8 first, ISO-8859-1 when the bytes
 * are not UTF-8, and whatever an ECI says when there is one.
 *
 * Designators are mapped to WHATWG `TextDecoder` labels where the runtime has
 * a decoder, and decoded here where it does not or where WHATWG means
 * something else by the label. That second case matters more than it looks:
 * WHATWG treats "iso-8859-1", "latin1" and "ascii" as windows-1252, so
 * `new TextDecoder('iso-8859-1')` turns 0x80 into a euro sign. ISO-8859-1 is
 * byte value equals code point, so it is decoded as exactly that. CP437 has no
 * WHATWG decoder at all, and is a 128-entry table below.
 */

/** Decoded here rather than through TextDecoder. */
type Builtin = 'latin1' | 'ascii' | 'cp437' | 'latin10' | 'cp1252';
const BUILTINS: readonly string[] = ['latin1', 'ascii', 'cp437', 'latin10', 'cp1252'];

/**
 * AIM ECI assignments (the ECI part of ISO/IEC 15424 and AIM ITS/04-001) to
 * the decoder that reads them. Unlisted designators are refused rather than
 * guessed: reading text in the wrong character set gives the right number of
 * wrong letters, which is worse than saying so.
 */
const ECI_DECODERS: ReadonlyMap<number, string | Builtin> = new Map<number, string | Builtin>([
	[0, 'cp437'],
	[1, 'latin1'],
	[2, 'cp437'],
	[3, 'latin1'],
	[4, 'iso-8859-2'],
	[5, 'iso-8859-3'],
	[6, 'iso-8859-4'],
	[7, 'iso-8859-5'],
	[8, 'iso-8859-6'],
	[9, 'iso-8859-7'],
	[10, 'iso-8859-8'],
	// WHATWG reads ISO-8859-9 as its superset windows-1254, and ISO-8859-11 as
	// windows-874; the extra characters sit in 0x80 to 0x9F, which the ISO sets
	// leave to control codes.
	[11, 'iso-8859-9'],
	[12, 'iso-8859-10'],
	[13, 'iso-8859-11'],
	[15, 'iso-8859-13'],
	[16, 'iso-8859-14'],
	[17, 'iso-8859-15'],
	// WHATWG lists ISO-8859-16 but Node's ICU does not ship it, so it is a
	// table here, and reads the same everywhere.
	[18, 'latin10'],
	[20, 'shift_jis'],
	[21, 'windows-1250'],
	[22, 'windows-1251'],
	[23, 'cp1252'],
	[24, 'windows-1256'],
	[25, 'utf-16be'],
	[26, 'utf-8'],
	[27, 'ascii'],
	[28, 'big5'],
	// GB 2312, which WHATWG decodes as its superset GBK.
	[29, 'gbk'],
	[30, 'euc-kr'],
	[31, 'gbk'],
	[32, 'gb18030'],
	[33, 'utf-16le'],
	[170, 'ascii'],
	// Binary data: no character set at all. Byte for code point keeps every byte
	// recoverable from the text.
	[899, 'latin1'],
]);

/** The UTF-8 designator, the only one this package's encoder writes. */
export const ECI_UTF8 = 26;

/** ECI designators run to 999999 (six decimal digits). */
export const ECI_MAX = 999999;

/**
 * CP437 0x80 to 0xFF. 0x00 to 0x7F are ASCII, as every decoder of it treats
 * them. The tables are code points rather than strings so the source holds no
 * typographic characters, only numbers.
 */
const CP437_HIGH: readonly number[] = [
	0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, 0x00ea, 0x00eb, 0x00e8, 0x00ef,
	0x00ee, 0x00ec, 0x00c4, 0x00c5, 0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
	0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192, 0x00e1, 0x00ed, 0x00f3, 0x00fa,
	0x00f1, 0x00d1, 0x00aa, 0x00ba, 0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
	0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557,
	0x255d, 0x255c, 0x255b, 0x2510, 0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
	0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567, 0x2568, 0x2564, 0x2565, 0x2559,
	0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
	0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4, 0x03a6, 0x0398, 0x03a9, 0x03b4,
	0x221e, 0x03c6, 0x03b5, 0x2229, 0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248,
	0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
];

/** ISO-8859-16 0xA0 to 0xFF; below that it is ISO-8859-1. */
const LATIN10_HIGH: readonly number[] = [
	0x00a0, 0x0104, 0x0105, 0x0141, 0x20ac, 0x201e, 0x0160, 0x00a7, 0x0161, 0x00a9, 0x0218, 0x00ab,
	0x0179, 0x00ad, 0x017a, 0x017b, 0x00b0, 0x00b1, 0x010c, 0x0142, 0x017d, 0x201d, 0x00b6, 0x00b7,
	0x017e, 0x010d, 0x0219, 0x00bb, 0x0152, 0x0153, 0x0178, 0x017c, 0x00c0, 0x00c1, 0x00c2, 0x0102,
	0x00c4, 0x0106, 0x00c6, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cb, 0x00cc, 0x00cd, 0x00ce, 0x00cf,
	0x0110, 0x0143, 0x00d2, 0x00d3, 0x00d4, 0x0150, 0x00d6, 0x015a, 0x0170, 0x00d9, 0x00da, 0x00db,
	0x00dc, 0x0118, 0x021a, 0x00df, 0x00e0, 0x00e1, 0x00e2, 0x0103, 0x00e4, 0x0107, 0x00e6, 0x00e7,
	0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec, 0x00ed, 0x00ee, 0x00ef, 0x0111, 0x0144, 0x00f2, 0x00f3,
	0x00f4, 0x0151, 0x00f6, 0x015b, 0x0171, 0x00f9, 0x00fa, 0x00fb, 0x00fc, 0x0119, 0x021b, 0x00ff,
];

/**
 * windows-1252 0x80 to 0x9F, as WHATWG maps them; above and below that it is
 * ISO-8859-1. A table here because Node decodes the windows-1252 label as
 * ISO-8859-1 (its TextDecoder takes a latin1 shortcut), so the runtime's
 * answer would differ between Node and a browser.
 */
const CP1252_C1: readonly number[] = [
	0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
	0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
	0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/** Byte value as code point: ISO-8859-1 exactly, with C1 controls kept as controls. */
export function decodeLatin1(bytes: readonly number[] | Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] as number);
	return out;
}

/** The code point a builtin character set gives a byte. */
function builtinCodePoint(kind: Exclude<Builtin, 'latin1'>, byte: number): number {
	if (byte < 0x80) return byte;
	switch (kind) {
		case 'cp437':
			return CP437_HIGH[byte - 0x80] as number;
		case 'latin10':
			return byte < 0xa0 ? byte : (LATIN10_HIGH[byte - 0xa0] as number);
		case 'cp1252':
			return byte < 0xa0 ? (CP1252_C1[byte - 0x80] as number) : byte;
		default:
			return 0xfffd;
	}
}

function decodeBuiltin(kind: Builtin, bytes: Uint8Array): string {
	if (kind === 'latin1') return decodeLatin1(bytes);
	let out = '';
	for (let i = 0; i < bytes.length; i += 1) {
		out += String.fromCharCode(builtinCodePoint(kind, bytes[i] as number));
	}
	return out;
}

/**
 * Text for bytes under an ECI designator, or undefined when the designator is
 * not one this package knows or this runtime has no decoder for.
 *
 * Decoding is not fatal: a symbol that says UTF-8 and holds a byte that is not
 * gets U+FFFD in its place, as WHATWG decoders do, and the inspector can see
 * it there. The byte order mark is kept, because it is part of what was
 * stored.
 */
export function decodeEci(designator: number, bytes: Uint8Array): string | undefined {
	const label = ECI_DECODERS.get(designator);
	if (label === undefined) return undefined;
	if (BUILTINS.includes(label)) return decodeBuiltin(label as Builtin, bytes);
	let decoder: TextDecoder;
	try {
		decoder = new TextDecoder(label, { ignoreBOM: true });
	} catch {
		return undefined;
	}
	return decoder.decode(bytes);
}

/** Strict UTF-8, or undefined when the bytes are not UTF-8. */
export function decodeUtf8Strict(bytes: Uint8Array): string | undefined {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return undefined;
	}
}

/** Bits an ECI designator takes: 8, 16 or 24 (ISO/IEC 18004 Table 4). */
export function eciDesignatorBits(designator: number): number {
	if (!Number.isInteger(designator) || designator < 0 || designator > ECI_MAX) {
		throw new TypeError('an ECI designator is a whole number from 0 to 999999');
	}
	return designator < 128 ? 8 : designator < 16384 ? 16 : 24;
}

/** The designator's bits, with the one, two or three byte prefix. */
export function eciDesignatorValue(designator: number): number {
	const bits = eciDesignatorBits(designator);
	if (bits === 8) return designator;
	if (bits === 16) return 0x8000 | designator;
	return 0xc00000 | designator;
}
