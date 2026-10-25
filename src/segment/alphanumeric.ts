/**
 * Alphanumeric mode's character set, and the GS separator FNC1 maps onto it.
 *
 * Kept apart from the segmenter and the writer so each can use it without
 * importing the other.
 */

/** The alphanumeric mode's 45 characters, in their value order (ISO/IEC 18004 Table 5). */
export const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** GS, the separator GS1 element strings use where a variable-length field ends. */
export const GS = 0x1d;

/** `%`, which stands for GS in alphanumeric mode while FNC1 is in force. */
export const PERCENT = 0x25;

let index: Int8Array | undefined;

/** The value of a byte or ASCII code (0 or more) in alphanumeric mode, or -1. */
export function alphanumericValue(code: number): number {
	if (index === undefined) {
		index = new Int8Array(128).fill(-1);
		for (let i = 0; i < ALPHANUMERIC.length; i += 1) index[ALPHANUMERIC.charCodeAt(i)] = i;
	}
	return code < 128 ? (index[code] as number) : -1;
}
