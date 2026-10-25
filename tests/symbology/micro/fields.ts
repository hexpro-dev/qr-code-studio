/**
 * Micro QR's bitstream field widths, written out a second time for the tests.
 *
 * From zxing-cpp (Apache 2.0) core/src/qrcode/QRCodecMode.cpp, which is a
 * different transcription of ISO/IEC 18004 Tables 2 and 3 from the BWIPP one
 * the source uses, so the profile test is a comparison of two readings of the
 * standard rather than of a table with itself.
 */

import type { TestProfile } from './helpers.js';

export const MICRO_FIELDS: Readonly<Record<'M1' | 'M2' | 'M3' | 'M4', TestProfile>> = {
	M1: {
		modeBits: 0,
		modeIndicator: { numeric: 0 },
		charCountBits: { numeric: 3 },
		terminatorBits: 3,
	},
	M2: {
		modeBits: 1,
		modeIndicator: { numeric: 0, alphanumeric: 1 },
		charCountBits: { numeric: 4, alphanumeric: 3 },
		terminatorBits: 5,
	},
	M3: {
		modeBits: 2,
		modeIndicator: { numeric: 0, alphanumeric: 1, byte: 2, kanji: 3 },
		charCountBits: { numeric: 5, alphanumeric: 4, byte: 4, kanji: 3 },
		terminatorBits: 7,
	},
	M4: {
		modeBits: 3,
		modeIndicator: { numeric: 0, alphanumeric: 1, byte: 2, kanji: 3 },
		charCountBits: { numeric: 6, alphanumeric: 5, byte: 5, kanji: 4 },
		terminatorBits: 9,
	},
};
