/**
 * Bit-level writing and reading, most significant bit first.
 *
 * Every bit field in the symbologies this package writes is MSB first: mode
 * indicators, character counts, segment data, codewords, format information.
 * Having one implementation of that order rather than a shift at each call
 * site removes a whole category of bug, and it is the kind of bug that
 * produces plausible-looking wrong output rather than an obvious failure.
 *
 * Numbers that are out of range throw `RangeError`. They are bugs in the
 * caller (a field width of 33, a read past the end of a stream whose length
 * the caller already knew), never something to explain to a person. The
 * messages give widths and positions, never the value that was refused: a
 * value written here is a piece of somebody's content.
 */

/** 2^bits for 0 <= bits <= 32, without `**`, which the determinism zone bans. */
function span(bits: number): number {
	return bits === 32 ? 4294967296 : (1 << bits) >>> 0;
}

function checkWidth(bits: number): void {
	if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
		throw new RangeError('a bit field is 0 to 32 bits wide');
	}
}

export class BitBuffer {
	private bytes = new Uint8Array(32);
	private bitLength = 0;

	/** Bits written so far. */
	get length(): number {
		return this.bitLength;
	}

	/** Append the low `bits` bits of `value`, most significant first. */
	append(value: number, bits: number): void {
		checkWidth(bits);
		if (!Number.isInteger(value) || value < 0 || value >= span(bits)) {
			throw new RangeError(`the value does not fit in ${bits} bits`);
		}
		this.reserve(bits);
		for (let i = bits - 1; i >= 0; i -= 1) {
			this.push((value >>> i) & 1);
		}
	}

	/** Append every bit of `other`, which may be this buffer itself. */
	appendBits(other: BitBuffer): void {
		// Read the length first: appending a buffer to itself must copy what was
		// there when the call started, not chase its own tail.
		const count = other.bitLength;
		this.reserve(count);
		const source = other.bytes;
		for (let i = 0; i < count; i += 1) {
			this.push(((source[i >>> 3] as number) >>> (7 - (i & 7))) & 1);
		}
	}

	bit(index: number): 0 | 1 {
		if (!Number.isInteger(index) || index < 0 || index >= this.bitLength) {
			throw new RangeError(`bit ${index} is outside a buffer of ${this.bitLength} bits`);
		}
		return (((this.bytes[index >>> 3] as number) >>> (7 - (index & 7))) & 1) as 0 | 1;
	}

	/**
	 * The bits as bytes, the last one padded with zero bits.
	 *
	 * A copy: the buffer can go on being appended to without changing what a
	 * caller already holds.
	 */
	toBytes(): Uint8Array {
		return this.bytes.slice(0, (this.bitLength + 7) >>> 3);
	}

	private reserve(bits: number): void {
		const needed = (this.bitLength + bits + 7) >>> 3;
		if (needed <= this.bytes.length) return;
		let capacity = this.bytes.length * 2;
		while (capacity < needed) capacity *= 2;
		const grown = new Uint8Array(capacity);
		grown.set(this.bytes);
		this.bytes = grown;
	}

	/** Bits are only ever set, never cleared, so fresh bytes must start at zero, which they do. */
	private push(bit: number): void {
		if (bit !== 0) {
			const at = this.bitLength >>> 3;
			this.bytes[at] = (this.bytes[at] as number) | (0x80 >>> (this.bitLength & 7));
		}
		this.bitLength += 1;
	}
}

export class BitReader {
	private readonly bytes: Uint8Array;
	private readonly end: number;
	private offset = 0;

	/**
	 * `bitLength` limits the stream to fewer bits than the bytes hold, for a
	 * symbol whose data capacity is not a whole number of bytes (Micro QR M1
	 * and M3 end on a half codeword).
	 */
	constructor(bytes: Uint8Array, bitLength: number = bytes.length * 8) {
		if (!Number.isInteger(bitLength) || bitLength < 0 || bitLength > bytes.length * 8) {
			throw new RangeError(
				`a reader over ${bytes.length} bytes holds 0 to ${bytes.length * 8} bits`,
			);
		}
		this.bytes = bytes;
		this.end = bitLength;
	}

	get remaining(): number {
		return this.end - this.offset;
	}

	/** Bits read so far, for a caller reporting where in a stream something went wrong. */
	get position(): number {
		return this.offset;
	}

	/** Read `bits` bits as an unsigned number, most significant first. */
	read(bits: number): number {
		checkWidth(bits);
		if (bits > this.remaining) {
			throw new RangeError(`asked for ${bits} bits with ${this.remaining} left`);
		}
		let value = 0;
		for (let i = 0; i < bits; i += 1) {
			const at = this.offset;
			// Multiply rather than shift, so a 32 bit read stays positive.
			value = value * 2 + (((this.bytes[at >>> 3] as number) >>> (7 - (at & 7))) & 1);
			this.offset = at + 1;
		}
		return value;
	}
}
