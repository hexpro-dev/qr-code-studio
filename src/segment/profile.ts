/**
 * QR Model 2's bitstream profiles, one per character-count group.
 *
 * ISO/IEC 18004 Table 3 sizes the character count field by version in three
 * groups, 1 to 9, 10 to 26 and 27 to 40, and nothing else about the bitstream
 * changes with the version. So there are exactly three QR profiles, built on
 * first use and then shared: the encoder segments once per group, not once
 * per version, and a cache keyed on the profile object hits for every
 * version in the group.
 *
 * Reading the count with the wrong group's width does not fail. It reads a
 * plausible count from the wrong bits and then misreads everything after it,
 * which looks like a damaged symbol rather than a version bug. That is why the
 * widths live in one table and the group is chosen in one place.
 */

import type { BitstreamProfile, Indicator, Mode } from './types.js';

/** The mode indicators of ISO/IEC 18004 Table 2. Terminator is 0000. */
const QR_INDICATORS: Readonly<Record<Indicator, number>> = {
	numeric: 0b0001,
	alphanumeric: 0b0010,
	'structured-append': 0b0011,
	byte: 0b0100,
	'fnc1-first': 0b0101,
	eci: 0b0111,
	kanji: 0b1000,
	'fnc1-second': 0b1001,
};

/** Character count widths by group: versions 1 to 9, 10 to 26, 27 to 40. */
const QR_COUNT_BITS: Readonly<Record<Mode, readonly [number, number, number]>> = {
	numeric: [10, 12, 14],
	alphanumeric: [9, 11, 13],
	byte: [8, 16, 16],
	kanji: [8, 10, 12],
};

const QR_MODES: readonly Mode[] = Object.freeze(['numeric', 'alphanumeric', 'byte', 'kanji']);

/** 0 for versions 1 to 9, 1 for 10 to 26, 2 for 27 to 40. */
export function qrCountGroup(version: number): 0 | 1 | 2 {
	if (!Number.isInteger(version) || version < 1 || version > 40) {
		throw new TypeError('a QR version is a whole number from 1 to 40');
	}
	return version <= 9 ? 0 : version <= 26 ? 1 : 2;
}

let profiles: readonly BitstreamProfile[] | undefined;

function makeProfile(group: 0 | 1 | 2): BitstreamProfile {
	return Object.freeze({
		modes: QR_MODES,
		modeIndicatorBits: 4,
		modeIndicator: (mode: Indicator): number | undefined => QR_INDICATORS[mode],
		charCountBits: (mode: Mode): number => {
			const widths = QR_COUNT_BITS[mode];
			if (widths === undefined) throw new TypeError('that is not a QR mode');
			return widths[group];
		},
		terminatorBits: 4,
		eci: true,
		fnc1: true,
		structuredAppend: true,
	});
}

/** The profile for a QR version, 1 to 40. The same object for every version in a group. */
export function qrProfile(version: number): BitstreamProfile {
	const group = qrCountGroup(version);
	profiles ??= Object.freeze([makeProfile(0), makeProfile(1), makeProfile(2)]);
	return profiles[group] as BitstreamProfile;
}
