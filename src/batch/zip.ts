/**
 * A ZIP written one entry at a time, for a batch that cannot afford to hold
 * every file uncompressed and then compress them all in one go.
 *
 * Core's `writeZip` takes the whole list and deflates it in a single call. A
 * batch of two thousand dotted SVGs is a hundred megabytes of text, which is
 * a hundred megabytes held at once and a minute of deflate in one slice that
 * the page cannot draw during. This writer deflates each entry as it is added,
 * during that row's slice, keeps only what goes in the file, and joins it all
 * up at the end with nothing left to do but copy.
 *
 * The bytes are core's, exactly: the same headers in the same order, the same
 * fixed date (1980-01-01 unless one is given), deflate at level 6 kept only
 * when it is smaller, and the same refusals. `tests/batch/zip.test.ts` checks
 * every archive it writes against `writeZip` over the same entries, byte for
 * byte, so this is a different schedule for the same file and not a second
 * format to keep in step by hand.
 */

import { crc32 } from '../core/checksums.js';
import { deflateRaw } from '../core/deflate.js';
import { ArchiveTooLargeError } from '../core/errors.js';

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const UTF8_FLAG = 0x0800;
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

interface Written {
	readonly name: Uint8Array;
	readonly data: Uint8Array;
	readonly deflated: boolean;
	readonly crc: number;
	readonly size: number;
	readonly offset: number;
}

/**
 * Refuse a name core's writer would refuse. Batch names are cleaned before
 * they get here, so each of these is a bug in this layer, not a person's
 * file, and the message gives the entry's position only.
 */
function checkName(name: string, index: number): void {
	const where = `entry ${index}`;
	if (name.length === 0) throw new TypeError(`${where} has no name`);
	if (name.includes('\\')) throw new TypeError(`${where} has a backslash in its name`);
	if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
		throw new TypeError(`${where} has an absolute path for a name`);
	}
	for (let i = 0; i < name.length; i += 1) {
		const code = name.charCodeAt(i);
		if (code < 0x20 || code === 0x7f)
			throw new TypeError(`${where} has a control character in its name`);
		if (code >= 0xd800 && code <= 0xdfff) {
			const low = name.charCodeAt(i + 1);
			if (code > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
				throw new TypeError(`${where} name is not valid Unicode`);
			}
			i += 1;
		}
	}
	for (const segment of name.split('/')) {
		if (segment === '' || segment === '.' || segment === '..') {
			throw new TypeError(`${where} has an empty, '.' or '..' folder in its name`);
		}
	}
}

function dosDate(date: { year: number; month: number; day: number } | undefined): number {
	const { year, month, day } = date ?? { year: 1980, month: 1, day: 1 };
	if (!Number.isInteger(year) || year < 1980 || year > 2107) {
		throw new RangeError('a ZIP date is in the years 1980 to 2107');
	}
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		throw new RangeError('a ZIP date has a month from 1 to 12');
	}
	const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
	if (!Number.isInteger(day) || day < 1 || day > days) {
		throw new RangeError(`that month has days 1 to ${days}`);
	}
	return ((year - 1980) << 9) | (month << 5) | day;
}

export class ZipWriter {
	private readonly entries: Written[] = [];
	private readonly names = new Set<string>();
	private readonly folders = new Set<string>();
	private readonly date: number;
	private readonly encoder = new TextEncoder();
	private offset = 0;
	/** The most the finished file can be, counted as core counts it before writing. */
	private largest = END_RECORD;

	constructor(date?: { year: number; month: number; day: number }) {
		this.date = dosDate(date);
	}

	get count(): number {
		return this.entries.length;
	}

	/** Add an entry, deflating it now when asked and when that is smaller. */
	add(name: string, bytes: Uint8Array, compress = false): void {
		const index = this.entries.length;
		if (index >= MAX_ENTRIES) throw new ArchiveTooLargeError(MAX_ENTRIES, 'entries');
		checkName(name, index);
		const folded = name.toLowerCase();
		const parts = folded.split('/');
		if (this.names.has(folded) || this.folders.has(folded)) {
			throw new TypeError(`entry ${index} has the same name as an earlier entry or its folder`);
		}
		for (let i = 1; i < parts.length; i += 1) {
			const folder = parts.slice(0, i).join('/');
			if (this.names.has(folder)) {
				throw new TypeError(`entry ${index} is inside a folder that is an earlier entry's name`);
			}
			this.folders.add(folder);
		}
		this.names.add(folded);
		const encoded = this.encoder.encode(name);
		if (encoded.length > 0xffff) throw new TypeError(`entry ${index} has too long a name`);
		this.largest += LOCAL_HEADER + CENTRAL_HEADER + 2 * encoded.length + bytes.length;
		if (this.largest > MAX_BYTES) throw new ArchiveTooLargeError(MAX_BYTES);
		let data = bytes;
		let deflated = false;
		if (compress) {
			const packed = deflateRaw(bytes, { level: 6 });
			if (packed.length < bytes.length) {
				data = packed;
				deflated = true;
			}
		}
		this.entries.push({
			name: encoded,
			data,
			deflated,
			crc: crc32(bytes),
			size: bytes.length,
			offset: this.offset,
		});
		this.offset += LOCAL_HEADER + encoded.length + data.length;
	}

	/** The archive. The writer holds nothing useful afterwards. */
	finish(): Uint8Array {
		const directoryOffset = this.offset;
		let directorySize = 0;
		for (const item of this.entries) directorySize += CENTRAL_HEADER + item.name.length;
		const out = new Uint8Array(directoryOffset + directorySize + END_RECORD);
		const view = new DataView(out.buffer);
		let at = 0;
		const u16 = (value: number): void => {
			view.setUint16(at, value, true);
			at += 2;
		};
		const u32 = (value: number): void => {
			view.setUint32(at, value, true);
			at += 4;
		};
		for (const item of this.entries) {
			u32(0x04034b50);
			u16(item.deflated ? 20 : 10);
			u16(UTF8_FLAG);
			u16(item.deflated ? 8 : 0);
			u16(0);
			u16(this.date);
			u32(item.crc);
			u32(item.data.length);
			u32(item.size);
			u16(item.name.length);
			u16(0);
			out.set(item.name, at);
			at += item.name.length;
			out.set(item.data, at);
			at += item.data.length;
		}
		for (const item of this.entries) {
			u32(0x02014b50);
			u16(20);
			u16(item.deflated ? 20 : 10);
			u16(UTF8_FLAG);
			u16(item.deflated ? 8 : 0);
			u16(0);
			u16(this.date);
			u32(item.crc);
			u32(item.data.length);
			u32(item.size);
			u16(item.name.length);
			u16(0);
			u16(0);
			u16(0);
			u16(0);
			u32(0);
			u32(item.offset);
			out.set(item.name, at);
			at += item.name.length;
		}
		u32(0x06054b50);
		u16(0);
		u16(0);
		u16(this.entries.length);
		u16(this.entries.length);
		u32(directorySize);
		u32(directoryOffset);
		u16(0);
		this.entries.length = 0;
		return out;
	}
}
