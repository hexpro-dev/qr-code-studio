/**
 * The ZIP writer, read back by yauzl.
 *
 * yauzl is strict where it matters here: it validates every size, rejects
 * names that would escape the extraction folder, and checks each entry's
 * CRC-32 as it streams it. Everything this package writes is read back byte for
 * byte through it, and the raw headers are checked against APPNOTE as well,
 * because a reader that accepts a field it ignores proves nothing about that
 * field.
 */

import { inflateRawSync } from 'node:zlib';
import yauzl from 'yauzl';
import { describe, expect, it } from 'vitest';
import { ArchiveTooLargeError } from '../../src/core/errors.js';
import type { ZipEntry } from '../../src/core/zip.js';
import { writeZip } from '../../src/core/zip.js';
import { seeded, textLike } from './helpers.js';

interface Read {
	readonly name: string;
	readonly bytes: Buffer;
	readonly entry: yauzl.Entry;
}

function readZip(archive: Uint8Array): Promise<Read[]> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(
			Buffer.from(archive),
			{ lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true },
			(error, zip) => {
				if (error || !zip) {
					reject(error ?? new Error('no archive'));
					return;
				}
				const out: Read[] = [];
				zip.on('error', reject);
				zip.on('end', () => resolve(out));
				zip.on('entry', (entry: yauzl.Entry) => {
					zip.openReadStream(entry, (streamError, stream) => {
						if (streamError || !stream) {
							reject(streamError ?? new Error('no stream'));
							return;
						}
						const chunks: Buffer[] = [];
						stream.on('data', (chunk: Buffer) => chunks.push(chunk));
						stream.on('error', reject);
						stream.on('end', () => {
							out.push({ name: entry.fileName, bytes: Buffer.concat(chunks), entry });
							zip.readEntry();
						});
					});
				});
				zip.readEntry();
			},
		);
	});
}

const ENTRIES: readonly ZipEntry[] = [
	{ name: 'README.txt', bytes: textLike(5000, 31), compress: true },
	{ name: 'cards/2024/example-network.png', bytes: seeded(32).bytes(3000), compress: true },
	{ name: 'cards/2024/plain.svg', bytes: textLike(800, 33) },
	{ name: 'empty.csv', bytes: new Uint8Array(0), compress: true },
	{ name: 'Café/naïve 名前 𠀀.txt', bytes: textLike(300, 34), compress: true },
];

describe('writeZip', () => {
	it('is read back by yauzl, every entry byte for byte and in order', async () => {
		const read = await readZip(writeZip(ENTRIES));
		expect(read.map((entry) => entry.name)).toEqual(ENTRIES.map((entry) => entry.name));
		read.forEach((entry, i) => {
			expect(entry.bytes.equals(Buffer.from((ENTRIES[i] as ZipEntry).bytes)), entry.name).toBe(
				true,
			);
		});
	});

	it('deflates where asked and where it helps, and stores everything else', async () => {
		const read = await readZip(writeZip(ENTRIES));
		const methods = read.map((entry) => entry.entry.compressionMethod);
		// Text deflates; random bytes and an empty file do not get smaller, so
		// they are stored even though compression was asked for.
		expect(methods).toEqual([8, 0, 0, 0, 8]);
		for (const { entry } of read) {
			expect(entry.versionNeededToExtract).toBe(entry.compressionMethod === 8 ? 20 : 10);
		}
	});

	it('marks names as UTF-8 and writes the fixed 1980 timestamp by default', async () => {
		for (const { entry } of await readZip(writeZip(ENTRIES))) {
			expect(entry.generalPurposeBitFlag).toBe(0x0800);
			expect(entry.lastModFileTime).toBe(0);
			expect(entry.lastModFileDate).toBe((0 << 9) | (1 << 5) | 1);
			// MS-DOS host, so the zero attributes mean "ordinary file" everywhere.
			expect(entry.versionMadeBy).toBe(20);
			expect(entry.externalFileAttributes).toBe(0);
		}
	});

	it('writes the date it is given', async () => {
		const archive = writeZip([{ name: 'a.txt', bytes: new Uint8Array(1) }], {
			date: { year: 2026, month: 10, day: 25 },
		});
		const [read] = await readZip(archive);
		expect(read?.entry.lastModFileDate).toBe(((2026 - 1980) << 9) | (10 << 5) | 25);
		expect(read?.entry.getLastModDate({ timezone: 'UTC' }).toISOString()).toBe(
			'2026-10-25T00:00:00.000Z',
		);
	});

	it('gives the same bytes every time', () => {
		expect(writeZip(ENTRIES)).toEqual(writeZip(ENTRIES));
	});

	it('writes headers that agree with APPNOTE field by field', () => {
		const bytes = textLike(2000, 35);
		const archive = writeZip([{ name: 'a/b.txt', bytes, compress: true }]);
		const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
		expect(view.getUint32(0, true)).toBe(0x04034b50);
		const compressedSize = view.getUint32(18, true);
		expect(view.getUint32(22, true)).toBe(bytes.length);
		const nameLength = view.getUint16(26, true);
		expect(nameLength).toBe(7);
		expect(view.getUint16(28, true)).toBe(0);
		const data = archive.subarray(30 + nameLength, 30 + nameLength + compressedSize);
		// zlib reads the entry's data as plain raw DEFLATE.
		expect(inflateRawSync(data).equals(Buffer.from(bytes))).toBe(true);
		const directory = 30 + nameLength + compressedSize;
		expect(view.getUint32(directory, true)).toBe(0x02014b50);
		expect(view.getUint32(directory + 42, true)).toBe(0);
		const end = archive.length - 22;
		expect(view.getUint32(end, true)).toBe(0x06054b50);
		expect(view.getUint16(end + 8, true)).toBe(1);
		expect(view.getUint16(end + 10, true)).toBe(1);
		expect(view.getUint32(end + 12, true)).toBe(46 + nameLength);
		expect(view.getUint32(end + 16, true)).toBe(directory);
		expect(view.getUint16(end + 20, true)).toBe(0);
	});

	it('writes an empty archive as an end record alone', async () => {
		const archive = writeZip([]);
		expect(archive.length).toBe(22);
		expect(await readZip(archive)).toEqual([]);
	});

	it.each([
		['an empty name', ''],
		['an absolute path', '/etc/example'],
		['a drive letter', 'C:/Users/example.png'],
		['a backslash', 'cards\\example.png'],
		['a parent folder', '../example.png'],
		['a parent folder inside the path', 'cards/../../example.png'],
		['a current folder', './example.png'],
		['a current folder inside the path', 'cards/./example.png'],
		['an empty folder', 'cards//example.png'],
		['a trailing slash', 'cards/'],
		['a NUL', 'example\u0000.png'],
		['a control character', 'example\u001b.png'],
		['a DEL', 'example\u007f.png'],
		['a lone high surrogate', 'example\ud800.png'],
		['a lone low surrogate', 'example\udc00.png'],
		['a high surrogate at the very end', 'example\ud800'],
	])('refuses a name with %s', (_, name) => {
		expect(() => writeZip([{ name, bytes: new Uint8Array(1) }])).toThrow(TypeError);
	});

	it('refuses a name that is not a string', () => {
		expect(() => writeZip([{ name: 7 as unknown as string, bytes: new Uint8Array(1) }])).toThrow(
			TypeError,
		);
	});

	it('refuses names that would overwrite each other when extracted', () => {
		const entry = (name: string): ZipEntry => ({ name, bytes: new Uint8Array(1) });
		expect(() => writeZip([entry('a.png'), entry('a.png')])).toThrow(TypeError);
		// macOS and Windows extract without regard to case.
		expect(() => writeZip([entry('Card.png'), entry('card.png')])).toThrow(TypeError);
		// A file where a folder must be, either way round.
		expect(() => writeZip([entry('cards'), entry('cards/a.png')])).toThrow(TypeError);
		expect(() => writeZip([entry('cards/a.png'), entry('cards')])).toThrow(TypeError);
		expect(() => writeZip([entry('cards/a.png'), entry('Cards')])).toThrow(TypeError);
		// Siblings in one folder are fine.
		expect(() => writeZip([entry('cards/a.png'), entry('cards/b.png')])).not.toThrow();
	});

	it('keeps names out of its messages', () => {
		try {
			writeZip([
				{ name: 'Example Network.png', bytes: new Uint8Array(1) },
				{ name: 'example network.png', bytes: new Uint8Array(1) },
			]);
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).not.toMatch(/example/i);
			expect((error as Error).message).toContain('entry 1');
		}
	});

	it('refuses a name longer than a ZIP header can say', () => {
		expect(() => writeZip([{ name: 'a'.repeat(0x10000), bytes: new Uint8Array(1) }])).toThrow(
			TypeError,
		);
		expect(() => writeZip([{ name: 'a'.repeat(0xffff), bytes: new Uint8Array(1) }])).not.toThrow();
	});

	it('refuses more entries or more bytes than a ZIP without ZIP64 can hold', () => {
		try {
			writeZip(new Array<ZipEntry>(0x10000));
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ArchiveTooLargeError);
			expect((error as ArchiveTooLargeError).params).toEqual({ limit: 0xffff, unit: 'entries' });
		}
		// The size is checked before any entry is read, so stand-ins whose
		// lengths say four gigabytes are enough.
		const huge = { length: 0x80000000 } as unknown as Uint8Array;
		expect(() =>
			writeZip([
				{ name: 'a', bytes: huge },
				{ name: 'b', bytes: huge },
			]),
		).toThrow(ArchiveTooLargeError);
	});

	it('refuses a date a DOS timestamp cannot hold, or that is not on the calendar', () => {
		const at = (year: number, month: number, day: number): Uint8Array =>
			writeZip([], { date: { year, month, day } });
		for (const [year, month, day] of [
			[1979, 12, 31],
			[2108, 1, 1],
			[2026, 0, 1],
			[2026, 13, 1],
			[2026, 1, 0],
			[2026, 1, 32],
			[2026, 4, 31],
			[2023, 2, 29],
			[2100, 2, 29],
			[2026.5, 1, 1],
		] as const) {
			expect(() => at(year, month, day), `${year}-${month}-${day}`).toThrow(RangeError);
		}
		expect(() => at(2024, 2, 29)).not.toThrow();
		expect(() => at(2000, 2, 29)).not.toThrow();
		expect(() => at(1980, 1, 1)).not.toThrow();
		expect(() => at(2107, 12, 31)).not.toThrow();
	});
});
