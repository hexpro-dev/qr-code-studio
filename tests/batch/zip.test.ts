/**
 * The incremental ZIP writer gives core's bytes exactly, entry for entry,
 * and refuses what core refuses.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZipWriter } from '../../src/batch/zip.js';
import { ArchiveTooLargeError } from '../../src/core/errors.js';
import type { ZipEntry } from '../../src/core/zip.js';
import { writeZip } from '../../src/core/zip.js';
import { seeded, textLike } from '../core/helpers.js';
import { readZip } from './helpers.js';

function incremental(
	entries: readonly ZipEntry[],
	date?: { year: number; month: number; day: number },
): Uint8Array {
	const writer = new ZipWriter(date);
	for (const entry of entries) writer.add(entry.name, entry.bytes, entry.compress);
	expect(writer.count).toBe(entries.length);
	return writer.finish();
}

describe('ZipWriter', () => {
	it('writes the same bytes as core for stored, deflated and incompressible entries', async () => {
		const random = seeded(0x21b);
		const entries: ZipEntry[] = [
			{ name: 'label-EX-001.svg', bytes: textLike(5000, 1), compress: true },
			{ name: 'noise.png', bytes: random.bytes(3000), compress: true },
			{ name: 'empty.pdf', bytes: new Uint8Array(0) },
			{ name: 'caf\u00e9 \u4f8b\u5b50.eps', bytes: textLike(800, 2), compress: true },
			{ name: 'folder/inside.svg', bytes: textLike(100, 3), compress: false },
			{ name: 'manifest.csv', bytes: new TextEncoder().encode('row,file\r\n'), compress: true },
		];
		const ours = incremental(entries);
		expect(ours).toEqual(writeZip(entries));
		const dated = incremental(entries, { year: 2026, month: 10, day: 26 });
		expect(dated).toEqual(writeZip(entries, { date: { year: 2026, month: 10, day: 26 } }));
		const read = await readZip(ours);
		expect(read.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
		read.forEach((entry, i) => expect(entry.bytes).toEqual(entries[i]?.bytes));
		expect(new ZipWriter().finish()).toEqual(writeZip([]));
	});

	it('agrees with core on any list of entries', () => {
		const entry = fc.record({
			name: fc
				.string({ minLength: 1, maxLength: 12 })
				.filter((name) => /^[A-Za-z0-9 ._-]+$/.test(name) && !/^\.+$/.test(name)),
			bytes: fc.uint8Array({ maxLength: 400 }),
			compress: fc.boolean(),
		});
		fc.assert(
			fc.property(
				fc.uniqueArray(entry, { selector: (e) => e.name.toLowerCase(), maxLength: 12 }),
				(entries) => {
					expect(incremental(entries)).toEqual(writeZip(entries));
				},
			),
			{ numRuns: 200 },
		);
	});

	it('refuses the names core refuses, giving the position only', () => {
		const bad = [
			'',
			'a\\b',
			'/abs',
			'C:x',
			'a\u0000b',
			'a\u007fb',
			'a//b',
			'./a',
			'a/../b',
			'end/',
			'\ud800',
			'x\udc00',
		];
		for (const name of bad) {
			expect(() => writeZip([{ name, bytes: new Uint8Array(0) }]), name).toThrow(TypeError);
			expect(() => new ZipWriter().add(name, new Uint8Array(0)), name).toThrow(/entry 0/);
		}
		expect(() => new ZipWriter().add('a'.repeat(0x10000), new Uint8Array(1))).toThrow(TypeError);
		expect(() => new ZipWriter().add('\ud83d\ude00', new Uint8Array(1))).not.toThrow();
	});

	it('refuses a name used twice, ignoring case, or one that is also a folder', () => {
		const writer = new ZipWriter();
		writer.add('Card.png', new Uint8Array(1));
		expect(() => writer.add('card.PNG', new Uint8Array(1))).toThrow(/same name/);
		writer.add('dir/a.png', new Uint8Array(1));
		expect(() => writer.add('DIR', new Uint8Array(1))).toThrow(/same name/);
		expect(() => writer.add('card.png/x', new Uint8Array(1))).toThrow(/inside a folder/);
	});

	it('refuses more entries or more bytes than a ZIP without ZIP64 holds', () => {
		const writer = new ZipWriter();
		const empty = new Uint8Array(0);
		for (let i = 0; i < 0xffff; i += 1) writer.add(`${i}`, empty);
		expect(() => writer.add('one-more', empty)).toThrow(ArchiveTooLargeError);
		// Checked before the entry is read, as core checks it, so a stand-in
		// whose length says four gigabytes is enough.
		const huge = { length: 0xffffffff } as unknown as Uint8Array;
		expect(() => new ZipWriter().add('a', huge)).toThrow(ArchiveTooLargeError);
	});

	it('refuses a date core refuses', () => {
		for (const date of [
			{ year: 1979, month: 1, day: 1 },
			{ year: 2108, month: 1, day: 1 },
			{ year: 2026, month: 13, day: 1 },
			{ year: 2025, month: 2, day: 29 },
			{ year: 2026.5, month: 1, day: 1 },
		]) {
			expect(() => new ZipWriter(date)).toThrow(RangeError);
		}
		expect(() => new ZipWriter({ year: 2024, month: 2, day: 29 })).not.toThrow();
		expect(() => new ZipWriter({ year: 2000, month: 2, day: 29 })).not.toThrow();
		expect(() => new ZipWriter({ year: 2100, month: 2, day: 29 })).toThrow(RangeError);
	});
});
