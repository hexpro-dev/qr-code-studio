/**
 * A ZIP writer, for batch exports: a folder of PNGs or SVGs a person
 * downloads in one go.
 *
 * Writer only, and deliberately small: local headers, the central directory
 * and the end record (APPNOTE 6.3.10 sections 4.3.7, 4.3.12 and 4.3.16), each
 * entry stored or deflated, no ZIP64, no encryption, no extra fields. The same
 * entries give the same bytes every time: the timestamp is a parameter that
 * defaults to 1980-01-01 00:00 (the earliest a DOS date can say), entries are
 * written in the order given, and the compressor is this package's own.
 *
 * Names are checked rather than cleaned. A name that would extract outside the
 * folder somebody chose (an absolute path, a `..` segment, a backslash that
 * Windows reads as a separator) or overwrite another entry is a bug in the
 * caller, which should have built a safe name from the person's data first,
 * so it throws `TypeError` rather than being quietly rewritten into something
 * nobody asked for.
 */

import { crc32 } from './checksums.js';
import { deflateRaw } from './deflate.js';
import { ArchiveTooLargeError } from './errors.js';

export interface ZipEntry {
	/** A relative path with `/` between folders, in any script. */
	readonly name: string;
	readonly bytes: Uint8Array;
	/** Deflate this entry (stored anyway if that is not smaller). Defaults to false. */
	readonly compress?: boolean;
}

export interface ZipOptions {
	/** The modification date every entry carries, 1980 to 2107. Time of day is always 00:00. */
	readonly date?: { readonly year: number; readonly month: number; readonly day: number };
}

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
/** General purpose bit 11: the name is UTF-8. */
const UTF8_FLAG = 0x0800;
/** Without ZIP64, every count is 16 bits and every size and offset 32. */
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/**
 * UTF-8, written out because a name with a lone surrogate must be refused:
 * TextEncoder would replace it with U+FFFD, and two different names could
 * then come out as the same bytes.
 */
function utf8(name: string): Uint8Array {
	const out: number[] = [];
	for (let i = 0; i < name.length; i += 1) {
		let code = name.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdfff) {
			const low = name.charCodeAt(i + 1);
			if (code > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
				throw new TypeError('a ZIP entry name is not valid Unicode');
			}
			code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
			i += 1;
		}
		if (code < 0x80) {
			out.push(code);
		} else if (code < 0x800) {
			out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		} else {
			out.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}
	return Uint8Array.from(out);
}

/**
 * Refuse a name that would land outside the folder it is extracted into, or
 * that one of the common extractors would read differently.
 *
 * The message gives the entry's position, never the name: names in a batch
 * export are built from somebody's spreadsheet.
 */
function checkName(name: unknown, index: number): string {
	const where = `entry ${index}`;
	if (typeof name !== 'string' || name.length === 0) {
		throw new TypeError(`${where} has no name`);
	}
	if (name.includes('\\')) {
		throw new TypeError(`${where} has a backslash in its name, which Windows reads as a folder`);
	}
	if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
		throw new TypeError(`${where} has an absolute path for a name`);
	}
	// Control characters, including NUL, which ends the name in C extractors.
	for (let i = 0; i < name.length; i += 1) {
		const code = name.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) {
			throw new TypeError(`${where} has a control character in its name`);
		}
	}
	for (const segment of name.split('/')) {
		if (segment === '' || segment === '.' || segment === '..') {
			throw new TypeError(`${where} has an empty, '.' or '..' folder in its name`);
		}
	}
	return name;
}

function dosDate(options: ZipOptions | undefined): number {
	const { year, month, day } = options?.date ?? { year: 1980, month: 1, day: 1 };
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

interface Prepared {
	readonly name: Uint8Array;
	readonly data: Uint8Array;
	readonly deflated: boolean;
	readonly crc: number;
	readonly size: number;
	readonly offset: number;
}

/** A ZIP archive of `entries`, in the order given. */
export function writeZip(entries: readonly ZipEntry[], options?: ZipOptions): Uint8Array {
	const date = dosDate(options);
	if (entries.length > MAX_ENTRIES) throw new ArchiveTooLargeError(MAX_ENTRIES, 'entries');

	// Names first, and the size before any entry is read, so an archive that
	// cannot be written is refused before the work of compressing it. Exact and
	// case-folded names are both checked, with every folder a name implies:
	// macOS and Windows extract without regard to case, so 'Card.png' and
	// 'card.png' would overwrite each other there, and a file cannot share a
	// path with a folder.
	const files = new Set<string>();
	const folders = new Set<string>();
	const names: Uint8Array[] = [];
	let largest = END_RECORD;
	entries.forEach((entry, index) => {
		const name = checkName(entry.name, index);
		const folded = name.toLowerCase();
		const parts = folded.split('/');
		if (files.has(folded) || folders.has(folded)) {
			throw new TypeError(`entry ${index} has the same name as an earlier entry or its folder`);
		}
		for (let i = 1; i < parts.length; i += 1) {
			const folder = parts.slice(0, i).join('/');
			if (files.has(folder)) {
				throw new TypeError(`entry ${index} is inside a folder that is an earlier entry's name`);
			}
			folders.add(folder);
		}
		files.add(folded);
		const encoded = utf8(name);
		if (encoded.length > 0xffff) throw new TypeError(`entry ${index} has too long a name`);
		names.push(encoded);
		// Stored size is the most an entry can take, since deflate is kept only
		// when it is smaller.
		largest += LOCAL_HEADER + CENTRAL_HEADER + 2 * encoded.length + entry.bytes.length;
	});
	// Without ZIP64 every offset and size is 32 bits. Checked against the stored
	// size, so a batch that would only fit once compressed is refused too; that
	// is four gigabytes, far past anything a browser tab holds.
	if (largest > MAX_BYTES) throw new ArchiveTooLargeError(MAX_BYTES);

	const prepared: Prepared[] = [];
	let offset = 0;
	entries.forEach((entry, index) => {
		const name = names[index] as Uint8Array;
		const bytes = entry.bytes;
		let data = bytes;
		let deflated = false;
		if (entry.compress === true) {
			const compressed = deflateRaw(bytes, { level: 6 });
			if (compressed.length < bytes.length) {
				data = compressed;
				deflated = true;
			}
		}
		prepared.push({ name, data, deflated, crc: crc32(bytes), size: bytes.length, offset });
		offset += LOCAL_HEADER + name.length + data.length;
	});

	const directoryOffset = offset;
	let directorySize = 0;
	for (const item of prepared) directorySize += CENTRAL_HEADER + item.name.length;

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

	for (const item of prepared) {
		u32(0x04034b50);
		u16(item.deflated ? 20 : 10); // version needed: 2.0 for deflate, 1.0 to store
		u16(UTF8_FLAG);
		u16(item.deflated ? 8 : 0);
		u16(0); // time: 00:00:00
		u16(date);
		u32(item.crc);
		u32(item.data.length);
		u32(item.size);
		u16(item.name.length);
		u16(0); // no extra field
		out.set(item.name, at);
		at += item.name.length;
		out.set(item.data, at);
		at += item.data.length;
	}
	for (const item of prepared) {
		u32(0x02014b50);
		// Made by MS-DOS, spec 2.0. A Unix host byte would make extractors read
		// the zero external attributes below as mode 0000, unreadable files.
		u16(20);
		u16(item.deflated ? 20 : 10);
		u16(UTF8_FLAG);
		u16(item.deflated ? 8 : 0);
		u16(0);
		u16(date);
		u32(item.crc);
		u32(item.data.length);
		u32(item.size);
		u16(item.name.length);
		u16(0); // extra field
		u16(0); // comment
		u16(0); // disk number
		u16(0); // internal attributes
		u32(0); // external attributes
		u32(item.offset);
		out.set(item.name, at);
		at += item.name.length;
	}
	u32(0x06054b50);
	u16(0); // this disk
	u16(0); // disk with the directory
	u16(prepared.length);
	u16(prepared.length);
	u32(directorySize);
	u32(directoryOffset);
	u16(0); // comment
	return out;
}
