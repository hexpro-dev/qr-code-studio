/**
 * What each Micro QR version allows in its bitstream.
 *
 * Every field shrinks with the symbol. The mode indicator is (version number
 * - 1) bits: none at all in M1, which carries digits only, one bit in M2
 * (numeric 0, alphanumeric 1), two in M3 and three in M4 for all four modes in
 * the order numeric, alphanumeric, byte, kanji. The terminator is 2 * number +
 * 1 zero bits, 3, 5, 7 or 9, because it has to be longer than any mode
 * indicator followed by a zero character count. There is no ECI, no FNC1 and
 * no structured append in any version: the symbol has no room to spend on
 * them (ISO/IEC 18004 Tables 2 and 3; BWIPP `qrcode.mids`, `qrcode.cclens`,
 * `qrcode.termlens`; zxing-cpp QRCodecMode.cpp).
 */

import type { BitstreamProfile, Mode } from '../../segment/types.js';
import { microSpec } from './tables.js';

let profiles: Map<string, BitstreamProfile> | undefined;

export function microProfile(version: string): BitstreamProfile {
	const spec = microSpec(version);
	profiles ??= new Map();
	let found = profiles.get(spec.version);
	if (found !== undefined) return found;
	const { modes, charCountBits } = spec;
	found = Object.freeze({
		modes,
		modeIndicatorBits: spec.number - 1,
		modeIndicator(mode: Mode | 'eci' | 'fnc1-first' | 'fnc1-second' | 'structured-append') {
			const index = (modes as readonly string[]).indexOf(mode);
			return index < 0 ? undefined : index;
		},
		charCountBits(mode: Mode): number {
			const bits = charCountBits[mode];
			if (bits === undefined) {
				throw new TypeError('this Micro QR version cannot carry that mode');
			}
			return bits;
		},
		terminatorBits: spec.number * 2 + 1,
		eci: false,
		fnc1: false,
		structuredAppend: false,
	});
	profiles.set(spec.version, found);
	return found;
}
