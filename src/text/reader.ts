/**
 * Big endian reads over a slice of a font file, every one bounds checked.
 *
 * The parser never indexes the bytes directly. Each table gets a `Table`
 * covering exactly its own bytes, and every read names the table it is in,
 * so a value that would run past the end of a table is refused there with the
 * table's name, rather than quietly read from the next one (which is what an
 * offset into the whole file would do) or read as `undefined` and carried on
 * as NaN.
 */

import { malformed } from './errors.js';

export class Table {
	constructor(
		/** The whole file, shared by every table. */
		private readonly bytes: Uint8Array,
		/** Where this table starts in the file. */
		readonly start: number,
		/** How many bytes it has. */
		readonly length: number,
		/** Its tag, for errors. */
		readonly tag: string,
	) {}

	/** A table of `length` bytes from `offset` within this one, refused if it does not fit. */
	slice(offset: number, length: number = this.length - offset): Table {
		this.need(offset, length);
		return new Table(this.bytes, this.start + offset, length, this.tag);
	}

	/** Refuse unless `count` bytes from `offset` lie inside the table. */
	need(offset: number, count: number): void {
		if (!(offset >= 0 && count >= 0 && offset + count <= this.length)) {
			malformed(this.tag, 'truncated');
		}
	}

	u8(offset: number): number {
		this.need(offset, 1);
		return this.bytes[this.start + offset] as number;
	}

	i8(offset: number): number {
		const value = this.u8(offset);
		return value >= 0x80 ? value - 0x100 : value;
	}

	u16(offset: number): number {
		this.need(offset, 2);
		const at = this.start + offset;
		return ((this.bytes[at] as number) << 8) | (this.bytes[at + 1] as number);
	}

	i16(offset: number): number {
		const value = this.u16(offset);
		return value >= 0x8000 ? value - 0x10000 : value;
	}

	u32(offset: number): number {
		this.need(offset, 4);
		const at = this.start + offset;
		return (
			((this.bytes[at] as number) * 0x1000000 +
				(((this.bytes[at + 1] as number) << 16) |
					((this.bytes[at + 2] as number) << 8) |
					(this.bytes[at + 3] as number))) >>>
			0
		);
	}

	/** A 2.14 fixed point number, as composite glyph scales are written. */
	f2dot14(offset: number): number {
		return this.i16(offset) / 16384;
	}

	/** Four bytes as a tag. Bytes outside printable ASCII come back as `?`, since a tag reaches errors. */
	tagAt(offset: number): string {
		this.need(offset, 4);
		let text = '';
		for (let i = 0; i < 4; i += 1) {
			const code = this.bytes[this.start + offset + i] as number;
			text += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '?';
		}
		return text;
	}
}
