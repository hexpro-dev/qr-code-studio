/**
 * What each rMQR version allows in its bitstream.
 *
 * A three bit mode indicator in every version: 001 numeric, 010
 * alphanumeric, 011 byte, 100 kanji, 101 FNC1 in first position, 110 FNC1 in
 * second position, 111 ECI, and 000 as the terminator, which is therefore
 * three bits too (ISO/IEC 23941 Table 2, as zxing-cpp's QRCodecMode.cpp
 * transcribes it; BWIPP's `qrcode.mids` agrees on the four modes, ECI and
 * FNC1 in first position). Character count widths vary by version and are in
 * `tables.ts`. ECI and both FNC1 modes are allowed, as ISO/IEC 23941 allows
 * them; structured append is not part of rMQR.
 */

import type { BitstreamProfile, Mode } from '../../segment/types.js';
import { rmqrSpec } from './tables.js';

const MODES: readonly Mode[] = Object.freeze(['numeric', 'alphanumeric', 'byte', 'kanji']);

const INDICATORS: Readonly<Record<string, number>> = Object.freeze({
	numeric: 0b001,
	alphanumeric: 0b010,
	byte: 0b011,
	kanji: 0b100,
	'fnc1-first': 0b101,
	'fnc1-second': 0b110,
	eci: 0b111,
});

let profiles: Map<string, BitstreamProfile> | undefined;

export function rmqrProfile(version: string): BitstreamProfile {
	const spec = rmqrSpec(version);
	profiles ??= new Map();
	let found = profiles.get(spec.version);
	if (found !== undefined) return found;
	const { charCountBits } = spec;
	found = Object.freeze({
		modes: MODES,
		modeIndicatorBits: 3,
		modeIndicator(mode: Mode | 'eci' | 'fnc1-first' | 'fnc1-second' | 'structured-append') {
			return INDICATORS[mode];
		},
		charCountBits(mode: Mode): number {
			const bits = charCountBits[mode];
			if (bits === undefined) throw new TypeError('rMQR has no mode by that name');
			return bits;
		},
		terminatorBits: 3,
		eci: true,
		fnc1: true,
		structuredAppend: false,
	});
	profiles.set(spec.version, found);
	return found;
}
