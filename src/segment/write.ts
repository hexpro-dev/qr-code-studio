/**
 * Writing segments into a bitstream, and measuring them without writing.
 *
 * The order of a bitstream's headers follows ISO/IEC 18004 and the readers
 * that check it: structured append first (8.3: "at the beginning of the bit
 * stream"), then the ECI the first segment carries, then FNC1, then the
 * segments, with a new ECI wherever a segment's differs from the one in force.
 * zxing's encoder writes ECI before FNC1 in the same way, which is the
 * combination most readers have actually seen.
 *
 * Everything here is a caller's bug when it is wrong (a count longer than its
 * field, a digit segment holding a letter), never a person's content, so the
 * checks throw TypeError and RangeError and say nothing about the data.
 */

import type { BitBuffer } from '../core/bits.js';
import { eciDesignatorBits, eciDesignatorValue } from './eci.js';
import { kanjiValue, validKanjiCode } from './kanji.js';
import { alphanumericValue } from './alphanumeric.js';
import type { BitstreamProfile, Indicator, Mode, Segment, SegmentHeader } from './types.js';

/** Bits a segment's characters take, without its header. */
export function dataBitLength(mode: Mode, chars: number): number {
	switch (mode) {
		case 'numeric':
			return 10 * Math.floor(chars / 3) + ([0, 4, 7][chars % 3] as number);
		case 'alphanumeric':
			return 11 * Math.floor(chars / 2) + 6 * (chars % 2);
		case 'byte':
			return 8 * chars;
		case 'kanji':
			return 13 * chars;
		default:
			throw new TypeError('that is not a mode');
	}
}

function indicator(profile: BitstreamProfile, kind: Indicator): number {
	const value = profile.modeIndicator(kind);
	if (value === undefined) {
		throw new TypeError(`this bitstream profile has no ${kind} indicator`);
	}
	return value;
}

/**
 * The ECI designators `writeSegments` writes, in order, one for each segment
 * whose ECI differs from the one in force.
 */
function eciChanges(segments: readonly Segment[]): (number | undefined)[] {
	let active: number | undefined;
	return segments.map((segment) => {
		if (segment.eci === undefined || segment.eci === active) return undefined;
		active = segment.eci;
		return segment.eci;
	});
}

/**
 * Bits the segments take, ECI designators included, header and terminator
 * not: those are `headerBitLength` and the symbol's business.
 */
export function segmentsBitLength(segments: readonly Segment[], profile: BitstreamProfile): number {
	let bits = 0;
	const changes = eciChanges(segments);
	segments.forEach((segment, i) => {
		const eci = changes[i];
		if (eci !== undefined) bits += profile.modeIndicatorBits + eciDesignatorBits(eci);
		bits +=
			profile.modeIndicatorBits +
			profile.charCountBits(segment.mode) +
			dataBitLength(segment.mode, segment.chars);
	});
	return bits;
}

/** Bits the structured append and FNC1 headers take. */
export function headerBitLength(
	header: SegmentHeader | undefined,
	profile: BitstreamProfile,
): number {
	let bits = 0;
	if (header?.structuredAppend !== undefined) bits += profile.modeIndicatorBits + 16;
	if (header?.fnc1 !== undefined) {
		bits += profile.modeIndicatorBits + (header.fnc1 === 'gs1' ? 0 : 8);
	}
	return bits;
}

/**
 * Whether an FNC1 application indicator is one ISO/IEC 18004 7.4.8.3 allows:
 * a two-digit number 00 to 99, or a letter as its ASCII value plus 100.
 */
export function validApplicationIndicator(value: number): boolean {
	return (
		Number.isInteger(value) &&
		((value >= 0 && value <= 99) ||
			(value >= 165 && value <= 190) ||
			(value >= 197 && value <= 222))
	);
}

function checkHeader(header: SegmentHeader, profile: BitstreamProfile): void {
	const append = header.structuredAppend;
	if (append !== undefined) {
		if (!profile.structuredAppend) {
			throw new TypeError('this bitstream profile has no structured append');
		}
		const { index, total, parity } = append;
		if (!Number.isInteger(total) || total < 1 || total > 16) {
			throw new RangeError('a structured append set has 1 to 16 symbols');
		}
		if (!Number.isInteger(index) || index < 0 || index >= total) {
			throw new RangeError('a structured append index is 0 to one less than the total');
		}
		if (!Number.isInteger(parity) || parity < 0 || parity > 255) {
			throw new RangeError('a structured append parity is one byte');
		}
	}
	const { fnc1 } = header;
	if (fnc1 !== undefined) {
		if (!profile.fnc1) throw new TypeError('this bitstream profile has no FNC1');
		if (fnc1 !== 'gs1' && !validApplicationIndicator(fnc1.applicationIndicator)) {
			throw new RangeError('an FNC1 application indicator is 00 to 99, or a letter plus 100');
		}
	}
}

function checkSegment(segment: Segment, profile: BitstreamProfile): void {
	const { mode, chars, data } = segment;
	if (!profile.modes.includes(mode)) {
		throw new TypeError(`this bitstream profile has no ${mode} mode`);
	}
	if (!Number.isInteger(chars) || chars < 0 || chars >= 1 << profile.charCountBits(mode)) {
		throw new RangeError(
			`a ${mode} segment here holds 0 to ${(1 << profile.charCountBits(mode)) - 1} characters`,
		);
	}
	const expected = mode === 'kanji' ? chars * 2 : chars;
	if (data.length !== expected) {
		throw new RangeError(`a ${mode} segment of ${chars} characters has ${expected} data bytes`);
	}
	const step = mode === 'kanji' ? 2 : 1;
	for (let i = 0; i < data.length; i += step) {
		const byte = data[i] as number;
		const valid =
			mode === 'numeric'
				? byte >= 0x30 && byte <= 0x39
				: mode === 'alphanumeric'
					? alphanumericValue(byte) >= 0
					: mode === 'kanji'
						? validKanjiCode((byte << 8) | (data[i + 1] as number))
						: true;
		if (!valid) throw new RangeError(`a ${mode} segment holds a byte that mode cannot carry`);
	}
}

function writeData(segment: Segment, out: BitBuffer): void {
	const { data } = segment;
	switch (segment.mode) {
		case 'numeric': {
			let i = 0;
			for (; i + 3 <= data.length; i += 3) {
				out.append(
					((data[i] as number) - 0x30) * 100 +
						((data[i + 1] as number) - 0x30) * 10 +
						((data[i + 2] as number) - 0x30),
					10,
				);
			}
			if (data.length - i === 2) {
				out.append(((data[i] as number) - 0x30) * 10 + ((data[i + 1] as number) - 0x30), 7);
			} else if (data.length - i === 1) {
				out.append((data[i] as number) - 0x30, 4);
			}
			return;
		}
		case 'alphanumeric': {
			let i = 0;
			for (; i + 2 <= data.length; i += 2) {
				out.append(
					alphanumericValue(data[i] as number) * 45 + alphanumericValue(data[i + 1] as number),
					11,
				);
			}
			if (i < data.length) out.append(alphanumericValue(data[i] as number), 6);
			return;
		}
		case 'byte':
			for (let i = 0; i < data.length; i += 1) out.append(data[i] as number, 8);
			return;
		case 'kanji':
			for (let i = 0; i < data.length; i += 2) {
				const code = ((data[i] as number) << 8) | (data[i + 1] as number);
				out.append(kanjiValue(code), 13);
			}
			return;
	}
}

function writeEci(designator: number, profile: BitstreamProfile, out: BitBuffer): void {
	if (!profile.eci) throw new TypeError('this bitstream profile has no ECI');
	out.append(indicator(profile, 'eci'), profile.modeIndicatorBits);
	out.append(eciDesignatorValue(designator), eciDesignatorBits(designator));
}

/**
 * Append the header and the segments to `out`. The terminator and padding are
 * left to the caller, which knows the symbol's capacity.
 */
export function writeSegments(
	segments: readonly Segment[],
	profile: BitstreamProfile,
	out: BitBuffer,
	header: SegmentHeader = {},
): void {
	checkHeader(header, profile);
	for (const segment of segments) checkSegment(segment, profile);
	const changes = eciChanges(segments);
	const bits = profile.modeIndicatorBits;

	const append = header.structuredAppend;
	if (append !== undefined) {
		out.append(indicator(profile, 'structured-append'), bits);
		out.append(append.index, 4);
		out.append(append.total - 1, 4);
		out.append(append.parity, 8);
	}
	// The first segment's ECI goes before FNC1, as zxing writes it.
	const first = changes[0];
	if (first !== undefined) writeEci(first, profile, out);
	const { fnc1 } = header;
	if (fnc1 === 'gs1') {
		out.append(indicator(profile, 'fnc1-first'), bits);
	} else if (fnc1 !== undefined) {
		out.append(indicator(profile, 'fnc1-second'), bits);
		out.append(fnc1.applicationIndicator, 8);
	}
	segments.forEach((segment, i) => {
		const eci = changes[i];
		if (i > 0 && eci !== undefined) writeEci(eci, profile, out);
		out.append(indicator(profile, segment.mode), bits);
		out.append(segment.chars, profile.charCountBits(segment.mode));
		writeData(segment, out);
	});
}
