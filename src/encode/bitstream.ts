/**
 * The data codewords for a symbol: header, segments, terminator, padding.
 *
 * ISO/IEC 18004 7.4.9 and 7.4.10. The terminator is the profile's run of
 * zeros, cut short when the symbol is nearly full (and left out when it is
 * full), then zero bits to the next codeword boundary, then the pad codewords
 * 11101100 and 00010001 alternately. Micro QR M1 and M3 end on a 4-bit data
 * codeword, which takes 0000 as its pad; it travels in the high nibble of the
 * last byte, the convention `SymbologyEntry.build` documents.
 */

import { BitBuffer } from '../core/bits.js';
import type { BitstreamProfile, Segment, SegmentHeader } from '../segment/types.js';
import { writeSegments } from '../segment/write.js';
import type { BlockLayout } from '../symbology/types.js';

const PAD = [0xec, 0x11] as const;

export function dataCodewords(
	segments: readonly Segment[],
	header: SegmentHeader | undefined,
	profile: BitstreamProfile,
	blocks: BlockLayout,
): Uint8Array {
	const out = new BitBuffer();
	writeSegments(segments, profile, out, header);
	const capacity = blocks.dataBits;
	if (out.length > capacity) {
		throw new RangeError(`${out.length} bits do not fit a symbol that holds ${capacity}`);
	}
	out.append(0, Math.min(profile.terminatorBits, capacity - out.length));
	while (out.length % 8 !== 0 && out.length < capacity) out.append(0, 1);
	for (let i = 0; capacity - out.length >= 8; i += 1) out.append(PAD[i % 2] as number, 8);
	// Only a 4-bit final codeword is left over here, and its pad is 0000.
	if (out.length < capacity) out.append(0, capacity - out.length);
	return out.toBytes();
}
