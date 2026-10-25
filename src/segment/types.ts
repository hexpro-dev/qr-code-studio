/**
 * The shapes the segment layer trades in.
 *
 * A bitstream is the same idea in every symbology this package writes: a run
 * of segments, each a mode indicator, a character count and the characters,
 * with optional headers in front (structured append, ECI, FNC1) and a
 * terminator behind. What differs between QR, Micro QR and rMQR is only how
 * wide each of those fields is and which of them exist, and that is what a
 * `BitstreamProfile` describes. So segmentation, writing and reading are
 * written once, here, over a profile, and each symbology supplies profiles.
 */

export type EcLevel = 'L' | 'M' | 'Q' | 'H';
export type Mode = 'numeric' | 'alphanumeric' | 'byte' | 'kanji';

/** Everything a mode indicator can introduce: the four data modes and the four headers. */
export type Indicator = Mode | 'eci' | 'fnc1-first' | 'fnc1-second' | 'structured-append';

/** What one symbology version allows in its bitstream. */
export interface BitstreamProfile {
	/** Modes this version can carry. */
	readonly modes: readonly Mode[];
	/** 4 for QR, 0 to 3 for Micro QR, 3 for rMQR. */
	readonly modeIndicatorBits: number;
	/** The indicator's value, or undefined when this version cannot carry it. */
	modeIndicator(mode: Indicator): number | undefined;
	charCountBits(mode: Mode): number;
	/** 4 for QR; 3, 5, 7, 9 for M1 to M4; 3 for rMQR. */
	readonly terminatorBits: number;
	readonly eci: boolean;
	readonly fnc1: boolean;
	readonly structuredAppend: boolean;
}

export interface Segment {
	readonly mode: Mode;
	/** Character count as the bitstream records it. */
	readonly chars: number;
	/**
	 * Byte values for byte mode. For numeric and alphanumeric, the characters as
	 * ASCII bytes, exactly as they go into the bitstream: under FNC1 that means
	 * a GS separator is already the `%` that stands for it, and a literal `%`
	 * is already doubled. For kanji, the Shift_JIS bytes, two per character,
	 * lead byte first.
	 */
	readonly data: Uint8Array;
	/**
	 * The ECI designator in force for this segment, if one was written before
	 * it. `writeSegments` writes the designator before the first segment that
	 * carries it and again wherever it changes.
	 */
	readonly eci?: number;
}

export interface SegmentationPolicy {
	readonly kanji: 'never' | 'when-smaller' | 'always';
	readonly eci: 'auto' | 'never' | 'utf-8';
}

export interface SegmentHeader {
	readonly structuredAppend?: { index: number; total: number; parity: number };
	readonly fnc1?: 'gs1' | { applicationIndicator: number };
}

export interface DecodedSegment {
	readonly mode: Mode;
	readonly eci: number | null;
	/** The character count field as read. */
	readonly length: number;
}

export interface DecodedBitstream {
	readonly text: string;
	/**
	 * The payload as stored, before any text decoding: byte segments as their
	 * bytes, numeric and alphanumeric characters as ASCII (with FNC1's `%`
	 * already turned back into GS, 0x1D), kanji as Shift_JIS byte pairs.
	 */
	readonly bytes: Uint8Array;
	readonly textSource: 'utf-8' | 'latin1-fallback' | 'shift-jis' | `eci-${number}`;
	readonly segments: readonly DecodedSegment[];
	readonly structuredAppend: { index: number; total: number; parity: number } | null;
	readonly fnc1: 'gs1' | { applicationIndicator: number } | null;
}
