/**
 * Reading a bitstream back into segments and text.
 *
 * This is where a code stops being bits and becomes something a person asked
 * for, so the failure that matters is the quiet one: a wrong count width or a
 * wrong character set gives text that is nearly right. Everything about the
 * structure is therefore checked against the profile and refused when it does
 * not fit (a count that runs past the end, a numeric group above 999, a
 * structured append header anywhere but first), and the character set is
 * decided in one place, `decodeText`, after every segment is in.
 *
 * Lifted from the authenticator package's decoder (`src/qr/decode/segments.ts`
 * there), which reads only what a Google export uses, and extended to every
 * header: ECI, kanji, FNC1 in both positions, and structured append. It also
 * reads over any profile, so Micro QR and rMQR share it. Their terminators are
 * longer than their mode indicators (M4's mode indicator is three bits and its
 * numeric mode is 000), so the end of data is found by looking ahead for the
 * terminator's run of zeros rather than by reading an indicator and seeing
 * whether it is zero.
 *
 * Every failure on content is a QrStudioError: 'decode/unreadable' with
 * params { stage: 'segments' } for a bitstream that breaks the rules, and
 * 'decode/unsupported' for one that keeps them but needs a character set this
 * runtime cannot decode. `tests/segment/read.fuzz.test.ts` holds it to that.
 */

import { QrStudioError } from '../core/errors.js';
import { ALPHANUMERIC, GS, PERCENT } from './alphanumeric.js';
import { ECI_MAX, decodeEci, decodeLatin1, decodeUtf8Strict } from './eci.js';
import { kanjiCodeFromValue } from './kanji.js';
import type {
	BitstreamProfile,
	DecodedBitstream,
	DecodedSegment,
	Indicator,
	Mode,
} from './types.js';

const INDICATORS: readonly Indicator[] = [
	'numeric',
	'alphanumeric',
	'byte',
	'kanji',
	'eci',
	'fnc1-first',
	'fnc1-second',
	'structured-append',
];

let indicatorMaps: WeakMap<BitstreamProfile, ReadonlyMap<number, Indicator>> | undefined;

/** Indicator value to what it introduces, for one profile. */
function indicatorMap(profile: BitstreamProfile): ReadonlyMap<number, Indicator> {
	indicatorMaps ??= new WeakMap();
	let map = indicatorMaps.get(profile);
	if (map === undefined) {
		const built = new Map<number, Indicator>();
		for (const kind of INDICATORS) {
			const supported =
				kind === 'eci'
					? profile.eci
					: kind === 'structured-append'
						? profile.structuredAppend
						: kind === 'fnc1-first' || kind === 'fnc1-second'
							? profile.fnc1
							: profile.modes.includes(kind);
			const value = profile.modeIndicator(kind);
			if (supported && value !== undefined) built.set(value, kind);
		}
		map = built;
		indicatorMaps.set(profile, map);
	}
	return map;
}

function malformed(): QrStudioError {
	return new QrStudioError(
		'decode/unreadable',
		'This code was not made correctly, so what it holds cannot be read.',
		{ stage: 'segments' },
	);
}

function unsupported(feature: 'eci' | 'kanji', eci?: number): QrStudioError {
	return new QrStudioError(
		'decode/unsupported',
		'This code uses a character set this tool cannot read.',
		eci === undefined ? { stage: 'segments', feature } : { stage: 'segments', feature, eci },
	);
}

/** A cursor over the stream that refuses, as content, to read past its end. */
class Cursor {
	private position = 0;

	constructor(
		private readonly bytes: Uint8Array,
		private readonly end: number,
	) {}

	get remaining(): number {
		return this.end - this.position;
	}

	get offset(): number {
		return this.position;
	}

	read(bits: number): number {
		if (bits > this.remaining) throw malformed();
		let value = 0;
		for (let i = 0; i < bits; i += 1) {
			const at = this.position + i;
			value = value * 2 + (((this.bytes[at >>> 3] as number) >>> (7 - (at & 7))) & 1);
		}
		this.position += bits;
		return value;
	}

	/** True when the next `bits` bits (or all that are left) are zero. */
	zeroAhead(bits: number): boolean {
		const count = Math.min(bits, this.remaining);
		for (let i = 0; i < count; i += 1) {
			const at = this.position + i;
			if ((((this.bytes[at >>> 3] as number) >>> (7 - (at & 7))) & 1) !== 0) return false;
		}
		return true;
	}
}

/** One, two or three bytes, flagged by the leading bits of the first (ISO/IEC 18004 Table 4). */
function readEciDesignator(cursor: Cursor): number {
	const first = cursor.read(8);
	let value: number;
	if ((first & 0x80) === 0) value = first;
	else if ((first & 0xc0) === 0x80) value = ((first & 0x3f) << 8) | cursor.read(8);
	else if ((first & 0xe0) === 0xc0) value = ((first & 0x1f) << 16) | cursor.read(16);
	else throw malformed();
	if (value > ECI_MAX) throw malformed();
	return value;
}

/** Bits the characters of a segment take, to check before reading any of them. */
function dataBits(mode: Mode, count: number): number {
	switch (mode) {
		case 'numeric':
			return 10 * Math.floor(count / 3) + ([0, 4, 7][count % 3] as number);
		case 'alphanumeric':
			return 11 * Math.floor(count / 2) + 6 * (count % 2);
		case 'byte':
			return 8 * count;
		default:
			return 13 * count;
	}
}

/** Where a run of payload bytes is to be decoded from. */
type Charset =
	| { readonly kind: 'default' }
	| { readonly kind: 'eci'; readonly eci: number }
	| { readonly kind: 'sjis' };

interface Run {
	readonly charset: Charset;
	readonly bytes: number[];
}

function sameCharset(a: Charset, b: Charset): boolean {
	return a.kind === b.kind && (a.kind !== 'eci' || (b.kind === 'eci' && a.eci === b.eci));
}

function readNumeric(cursor: Cursor, count: number, out: number[]): void {
	let left = count;
	const digits = (value: number, width: number): void => {
		const text = String(value).padStart(width, '0');
		for (let i = 0; i < width; i += 1) out.push(text.charCodeAt(i));
	};
	while (left >= 3) {
		const value = cursor.read(10);
		if (value > 999) throw malformed();
		digits(value, 3);
		left -= 3;
	}
	if (left === 2) {
		const value = cursor.read(7);
		if (value > 99) throw malformed();
		digits(value, 2);
	} else if (left === 1) {
		const value = cursor.read(4);
		if (value > 9) throw malformed();
		digits(value, 1);
	}
}

function readAlphanumeric(cursor: Cursor, count: number, fnc1: boolean, out: number[]): void {
	const chars: number[] = [];
	let left = count;
	while (left >= 2) {
		const value = cursor.read(11);
		if (value >= 45 * 45) throw malformed();
		chars.push(
			ALPHANUMERIC.charCodeAt(Math.floor(value / 45)),
			ALPHANUMERIC.charCodeAt(value % 45),
		);
		left -= 2;
	}
	if (left === 1) {
		const value = cursor.read(6);
		if (value >= 45) throw malformed();
		chars.push(ALPHANUMERIC.charCodeAt(value));
	}
	if (!fnc1) {
		for (const char of chars) out.push(char);
		return;
	}
	// Under FNC1, `%%` is a literal percent and a lone `%` is GS. Pairs are
	// taken left to right within the segment, as zxing and BWIPP read them.
	for (let i = 0; i < chars.length; i += 1) {
		const char = chars[i] as number;
		if (char !== PERCENT) {
			out.push(char);
		} else if (chars[i + 1] === PERCENT) {
			out.push(PERCENT);
			i += 1;
		} else {
			out.push(GS);
		}
	}
}

function readKanji(cursor: Cursor, count: number, out: number[]): void {
	for (let i = 0; i < count; i += 1) {
		const code = kanjiCodeFromValue(cursor.read(13));
		if (code === undefined) throw malformed();
		out.push(code >>> 8, code & 0xff);
	}
}

/**
 * Decide the text, and say how.
 *
 * Bytes with no ECI are tried as strict UTF-8 first and read as ISO-8859-1
 * only when they are not UTF-8: the specification's default is ISO-8859-1,
 * but encoders write UTF-8 and no ECI, and a string that is valid UTF-8 and
 * meant as ISO-8859-1 is vanishingly rare (it needs, say, U+00C3 directly followed by U+00A9). All
 * of the symbol's ECI-less bytes are decided together, so one symbol never
 * mixes the two readings.
 *
 * textSource names the reading a person most needs to know about: the ECI
 * when one was declared, then the ISO-8859-1 fallback, then Shift_JIS for
 * kanji, and UTF-8 otherwise.
 */
function decodeText(
	runs: readonly Run[],
	firstEci: number | null,
): { text: string; textSource: DecodedBitstream['textSource'] } {
	const defaults = runs
		.filter((run) => run.charset.kind === 'default')
		.map((run) => decodeUtf8Strict(Uint8Array.from(run.bytes)));
	const latin1 = defaults.some((text) => text === undefined);
	let sjis: TextDecoder | undefined;
	let defaultIndex = 0;
	let text = '';
	for (const run of runs) {
		const bytes = Uint8Array.from(run.bytes);
		const { charset } = run;
		if (charset.kind === 'default') {
			text += latin1 ? decodeLatin1(bytes) : (defaults[defaultIndex] as string);
			defaultIndex += 1;
		} else if (charset.kind === 'eci') {
			const decoded = decodeEci(charset.eci, bytes);
			if (decoded === undefined) throw unsupported('eci', charset.eci);
			text += decoded;
		} else {
			if (sjis === undefined) {
				try {
					sjis = new TextDecoder('shift_jis');
				} catch {
					throw unsupported('kanji');
				}
			}
			text += sjis.decode(bytes);
		}
	}
	const hasKanji = runs.some((run) => run.charset.kind === 'sjis');
	const textSource: DecodedBitstream['textSource'] =
		firstEci !== null
			? `eci-${firstEci}`
			: latin1
				? 'latin1-fallback'
				: hasKanji
					? 'shift-jis'
					: 'utf-8';
	return { text, textSource };
}

/** Throws QrStudioError 'decode/unreadable' (params { stage: 'segments' }) on a malformed bitstream. */
export function readSegments(
	bytes: Uint8Array,
	bitLength: number,
	profile: BitstreamProfile,
): DecodedBitstream {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('readSegments takes a Uint8Array');
	if (!Number.isInteger(bitLength) || bitLength < 0 || bitLength > bytes.length * 8) {
		throw new RangeError(`a stream of ${bytes.length} bytes holds 0 to ${bytes.length * 8} bits`);
	}
	const indicators = indicatorMap(profile);
	const cursor = new Cursor(bytes, bitLength);
	const segments: DecodedSegment[] = [];
	const runs: Run[] = [];
	let structuredAppend: DecodedBitstream['structuredAppend'] = null;
	let fnc1: DecodedBitstream['fnc1'] = null;
	let eci: number | null = null;
	let firstEci: number | null = null;

	const append = (charset: Charset, values: readonly number[]): void => {
		const last = runs[runs.length - 1];
		if (last !== undefined && sameCharset(last.charset, charset)) {
			for (const value of values) last.bytes.push(value);
		} else {
			runs.push({ charset, bytes: [...values] });
		}
	};

	for (;;) {
		if (cursor.remaining < profile.modeIndicatorBits) break;
		if (cursor.zeroAhead(profile.terminatorBits)) break;
		const kind = indicators.get(cursor.read(profile.modeIndicatorBits));
		if (kind === undefined) throw malformed();

		if (kind === 'structured-append') {
			// Only ever first in the stream (ISO/IEC 18004 8.3).
			if (cursor.offset !== profile.modeIndicatorBits) throw malformed();
			const index = cursor.read(4);
			const total = cursor.read(4) + 1;
			const parity = cursor.read(8);
			if (index >= total) throw malformed();
			structuredAppend = { index, total, parity };
			continue;
		}
		if (kind === 'eci') {
			eci = readEciDesignator(cursor);
			firstEci ??= eci;
			continue;
		}
		if (kind === 'fnc1-first' || kind === 'fnc1-second') {
			// FNC1 describes the whole message, so it comes once, before any data.
			if (fnc1 !== null || segments.length > 0) throw malformed();
			fnc1 = kind === 'fnc1-first' ? 'gs1' : { applicationIndicator: cursor.read(8) };
			continue;
		}

		const count = cursor.read(profile.charCountBits(kind));
		if (dataBits(kind, count) > cursor.remaining) throw malformed();
		const values: number[] = [];
		const charset: Charset = eci === null ? { kind: 'default' } : { kind: 'eci', eci };
		if (kind === 'numeric') {
			readNumeric(cursor, count, values);
		} else if (kind === 'alphanumeric') {
			readAlphanumeric(cursor, count, fnc1 !== null, values);
		} else if (kind === 'byte') {
			for (let i = 0; i < count; i += 1) values.push(cursor.read(8));
		} else {
			readKanji(cursor, count, values);
		}
		append(kind === 'kanji' ? { kind: 'sjis' } : charset, values);
		segments.push(Object.freeze({ mode: kind, eci, length: count }));
	}

	const { text, textSource } = decodeText(runs, firstEci);
	const stored: number[] = [];
	for (const run of runs) for (const value of run.bytes) stored.push(value);
	return Object.freeze({
		text,
		bytes: Uint8Array.from(stored),
		textSource,
		segments: Object.freeze(segments),
		structuredAppend: structuredAppend === null ? null : Object.freeze(structuredAppend),
		fnc1: fnc1 === null || fnc1 === 'gs1' ? fnc1 : Object.freeze(fnc1),
	});
}
