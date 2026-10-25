/**
 * Reading a capture the way the scan check counts it.
 *
 * The decode layer's strict profile does the reading, in the design's own
 * polarity and for its own symbology only. A capture then passes only when
 * it read to exactly the bytes the clean symbol holds, at the version it was
 * made at, and with the reserve left unspent in every block: the strict
 * profile's last rule, which the decode layer leaves to this one because it
 * is a statement about how much damage a capture may cost rather than about
 * reading.
 */

import type { RgbaImage } from '../core/image.js';
import { decodeImage } from '../decode/decoder.js';
import { reserveFor } from './coverage.js';
import type { Prepared } from './prepare.js';

export interface CaptureRead {
	readonly read: boolean;
	/** The least spare correction in any block, after the reserve; null when nothing read. */
	readonly margin: number | null;
}

/** Spare corrections after the reserve, in the block with fewest. */
export function blockMargin(
	errorsPerBlock: readonly number[],
	capacityPerBlock: readonly number[],
): number {
	let least = Number.POSITIVE_INFINITY;
	for (let i = 0; i < capacityPerBlock.length; i += 1) {
		const t = capacityPerBlock[i] as number;
		const spare = t - reserveFor(t) - (errorsPerBlock[i] as number);
		if (spare < least) least = spare;
	}
	return least === Number.POSITIVE_INFINITY ? 0 : least;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
	return true;
}

/** The strict reading of one capture, judged against the clean symbol. */
export function strictRead(image: RgbaImage, prepared: Prepared): CaptureRead {
	const result = decodeImage(
		image,
		{
			profile: 'strict-v1',
			polarity: prepared.polarity,
			symbologies: [prepared.entry.id],
			maxSymbols: 1,
		},
		prepared.registries.symbologies,
	);
	const found = result.ok ? result.value[0] : undefined;
	if (found === undefined) return { read: false, margin: null };
	const { read } = found;
	const reference = prepared.reference;
	if (
		read.version !== reference.version ||
		!sameBytes(read.bitstream.bytes, reference.bitstream.bytes)
	) {
		// Read, but to something else: as bad as not reading, and worse for the
		// person holding the phone.
		return { read: false, margin: null };
	}
	const margin = blockMargin(read.errorsPerBlock, read.capacityPerBlock);
	return { read: margin >= 0, margin };
}
