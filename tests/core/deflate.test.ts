/**
 * DEFLATE and zlib, with Node's zlib as the oracle in both directions.
 *
 * zlib inflates everything this package compresses, at every level, over
 * inputs chosen for what each part of the compressor has to get right
 * (incompressible data for the stored fallback, text for the lazy matcher,
 * long runs and QR-shaped rasters for the hash chains, sizes on the stored and
 * block boundaries). This package inflates everything zlib compresses at
 * every level, strategy, window and memory level. The streams zlib would never
 * write are built bit by bit below, one per rule the inflater enforces.
 *
 * Determinism is pinned by SHA-256 of the output for fixed inputs. A change to
 * any of those hashes changes the bytes of every PNG this package exports, so
 * it is never an accident: update them only alongside a deliberate change to
 * the compressor, and say so in the commit.
 */

import { createHash } from 'node:crypto';
import { constants, deflateRawSync, deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { DeflateLevel } from '../../src/core/deflate.js';
import { deflateRaw, inflateRaw, zlibUnwrap, zlibWrap } from '../../src/core/deflate.js';
import {
	ArchiveMalformedError,
	ArchiveTooLargeError,
	QrStudioError,
} from '../../src/core/errors.js';
import { qrLikeRaster, seeded, textLike } from './helpers.js';

const LEVELS: readonly DeflateLevel[] = [0, 1, 6, 9];

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function same(a: Uint8Array, b: Uint8Array): boolean {
	return Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b)) === 0;
}

/** Inputs with what each one exercises. */
function corpus(): { name: string; bytes: Uint8Array }[] {
	const random = seeded(1951);
	const runs = new Uint8Array(200_000);
	for (let i = 0, value = 0; i < runs.length; value ^= 0xff) {
		const length = 1 + random.int(600);
		runs.fill(value, i, i + length);
		i += length;
	}
	// A pattern whose period is longer than the window: every repeat is out of
	// reach, so the matcher must not reach for it.
	const farPattern = random.bytes(40_000);
	const far = new Uint8Array(120_000);
	for (let i = 0; i < far.length; i += farPattern.length)
		far.set(farPattern.subarray(0, far.length - i), i);
	// The same, with a period just inside the window.
	const nearPattern = random.bytes(32_700);
	const near = new Uint8Array(100_000);
	for (let i = 0; i < near.length; i += nearPattern.length) {
		near.set(nearPattern.subarray(0, near.length - i), i);
	}
	const everyByte = new Uint8Array(256 * 40);
	for (let i = 0; i < everyByte.length; i += 1) everyByte[i] = (i * 167) & 0xff;
	return [
		{ name: 'empty', bytes: new Uint8Array(0) },
		{ name: 'one byte', bytes: new Uint8Array([0x41]) },
		{ name: 'three bytes', bytes: new Uint8Array([1, 2, 3]) },
		{ name: 'four equal bytes', bytes: new Uint8Array(4).fill(9) },
		{ name: 'random 1k', bytes: random.bytes(1000) },
		{ name: 'random 70k, past one stored block', bytes: random.bytes(70_000) },
		{ name: 'random 65535', bytes: random.bytes(65_535) },
		{ name: 'random 65536', bytes: random.bytes(65_536) },
		{ name: 'text 100k', bytes: textLike(100_000, 1) },
		{ name: 'zeros 300k', bytes: new Uint8Array(300_000) },
		{ name: 'alternating runs', bytes: runs },
		{ name: 'period past the window', bytes: far },
		{ name: 'period inside the window', bytes: near },
		{ name: 'every byte value', bytes: everyByte },
		{
			name: 'QR raster, grey',
			bytes: qrLikeRaster({ modules: 33, scale: 8, channels: 1, filter: 0, seed: 1 }),
		},
		{
			name: 'QR raster, RGBA, up filter',
			bytes: qrLikeRaster({ modules: 57, scale: 4, channels: 4, filter: 2, seed: 2 }),
		},
		{
			name: 'QR raster, version 40 at one pixel a module',
			bytes: qrLikeRaster({ modules: 177, scale: 1, channels: 1, filter: 0, seed: 3 }),
		},
	];
}

const CORPUS = corpus();

describe('deflateRaw', () => {
	it.each(CORPUS)('is inflated by zlib to the same bytes at every level: $name', ({ bytes }) => {
		for (const level of LEVELS) {
			const compressed = deflateRaw(bytes, { level });
			expect(same(inflateRawSync(compressed), bytes), `level ${level}`).toBe(true);
			expect(same(inflateRaw(compressed, { maxOutput: bytes.length }), bytes)).toBe(true);
		}
	});

	it('defaults to level 6', () => {
		const bytes = textLike(5000, 2);
		expect(deflateRaw(bytes)).toEqual(deflateRaw(bytes, { level: 6 }));
		expect(deflateRaw(bytes, {})).toEqual(deflateRaw(bytes, { level: 6 }));
	});

	it('writes what zlib writes for the trivial cases', () => {
		// An empty stream is one fixed block holding only end-of-block; level 0
		// is one empty stored block.
		expect([...deflateRaw(new Uint8Array(0))]).toEqual([0x03, 0x00]);
		expect([...deflateRaw(new Uint8Array(0), { level: 0 })]).toEqual([
			0x01, 0x00, 0x00, 0xff, 0xff,
		]);
		for (const level of LEVELS) {
			expect([...deflateRaw(new Uint8Array([0x41]), { level })]).toEqual([
				...deflateRawSync(new Uint8Array([0x41]), { level }),
			]);
		}
	});

	it('falls back to stored blocks for incompressible data', () => {
		const random = seeded(7);
		const bytes = random.bytes(100_000);
		for (const level of [1, 6, 9] as const) {
			// Each block of 16 383 literals goes out stored, at 5 bytes of framing
			// apiece, which is what zlib does too.
			const compressed = deflateRaw(bytes, { level });
			expect(compressed.length).toBe(bytes.length + 5 * Math.ceil(bytes.length / 16_383));
			expect(compressed.length).toBe(deflateRawSync(bytes, { level }).length);
		}
	});

	it('compresses run-heavy rasters within 5% of zlib at level 9', () => {
		const shapes = [
			{ modules: 21, scale: 10, channels: 1, filter: 0, seed: 11 },
			{ modules: 33, scale: 8, channels: 1, filter: 0, seed: 12 },
			{ modules: 57, scale: 4, channels: 4, filter: 0, seed: 13 },
			{ modules: 57, scale: 4, channels: 4, filter: 2, seed: 14 },
			{ modules: 101, scale: 3, channels: 1, filter: 2, seed: 15 },
			{ modules: 177, scale: 2, channels: 1, filter: 0, seed: 16 },
		] as const;
		for (const shape of shapes) {
			const raster = qrLikeRaster(shape);
			const ours = deflateRaw(raster, { level: 9 }).length;
			const theirs = deflateRawSync(raster, { level: 9 }).length;
			expect(ours, `${JSON.stringify(shape)}: ours ${ours}, zlib ${theirs}`).toBeLessThanOrEqual(
				theirs * 1.05,
			);
		}
	});

	it('compresses text and runs about as well as zlib at every level', () => {
		// Looser than the raster gate, which is the one that matters: this is
		// here to notice a matcher that has stopped finding matches at all.
		const runs = CORPUS.find((entry) => entry.name === 'alternating runs')?.bytes as Uint8Array;
		for (const bytes of [textLike(100_000, 3), runs]) {
			for (const level of [1, 6, 9] as const) {
				const ours = deflateRaw(bytes, { level }).length;
				const theirs = deflateRawSync(bytes, { level }).length;
				expect(ours, `level ${level}`).toBeLessThanOrEqual(theirs * 1.1);
			}
		}
	});

	it('gives the same bytes on every run, pinned by hash', () => {
		// Fixed inputs, so the hashes are a property of the compressor alone.
		const inputs = {
			text: textLike(50_000, 42),
			raster: qrLikeRaster({ modules: 29, scale: 6, channels: 1, filter: 0, seed: 42 }),
			random: seeded(42).bytes(20_000),
		};
		const hashes: Record<string, string> = {};
		for (const [name, bytes] of Object.entries(inputs)) {
			for (const level of LEVELS) {
				const first = deflateRaw(bytes, { level });
				expect(deflateRaw(bytes, { level })).toEqual(first);
				hashes[`${name} ${level}`] = sha256(first);
			}
		}
		expect(hashes).toEqual(GOLDEN);
	});

	it('refuses a level it does not have', () => {
		for (const level of [2, 5, 10, -1, 6.5]) {
			expect(() => deflateRaw(new Uint8Array(1), { level: level as DeflateLevel })).toThrow(
				TypeError,
			);
			expect(() => zlibWrap(new Uint8Array(1), { level: level as DeflateLevel })).toThrow(
				TypeError,
			);
		}
	});
});

/**
 * SHA-256 of the compressor's output for the fixed inputs above. See the file
 * comment before changing any of these.
 */
const GOLDEN: Record<string, string> = {
	'text 0': '8122515c1caccbdf51c28091ac73d79acff630d2f3f18cb36180aa6c0bb9b5b5',
	'text 1': 'f28fd0fd43ab6f51fdc00d9c48d5942bc881ecb9c1cce8b2885b56e96cd626dd',
	'text 6': 'a680f6ecba9148989d5fa6cc4caa9f366842aaada622a438e67f7fee4fdf5424',
	'text 9': 'a2c7b65a973234b370845f89799593a7694149e840426a14319052ba2eda7026',
	'raster 0': 'e0c6248e2ce34ccace113cc186ed8e6229ea942bfcc43d97eb735d3dbd7b28c2',
	'raster 1': 'a518203ac5742d45ba9236208bdaeb528466170d8259f516f665a21d4726e655',
	'raster 6': 'b6373e20c89e0bacc128cd87e66ca63395223954285d42ad2dfcdacab35222ea',
	'raster 9': 'd02a30657fee358bfc18743b6fc6e55455708e70db239c3d5fae252785f2b9f4',
	'random 0': '235a763de2d4865ba4a44dfa6d92b6c81d38142c446a8ebc5e0dfcfc26de0127',
	// Incompressible, so every level stores it the same way.
	'random 1': '2bbdf3d3672437446eb334e652969365252287238c83844b52fb0b8ce09528c3',
	'random 6': '2bbdf3d3672437446eb334e652969365252287238c83844b52fb0b8ce09528c3',
	'random 9': '2bbdf3d3672437446eb334e652969365252287238c83844b52fb0b8ce09528c3',
};

describe('inflateRaw', () => {
	it('inflates zlib at every level, strategy, window and memory level', () => {
		const strategies = [
			constants.Z_DEFAULT_STRATEGY,
			constants.Z_FILTERED,
			constants.Z_HUFFMAN_ONLY,
			constants.Z_RLE,
			constants.Z_FIXED,
		];
		const inputs = [
			textLike(30_000, 5),
			qrLikeRaster({ modules: 25, scale: 4, channels: 1, filter: 2, seed: 5 }),
			seeded(5).bytes(3000),
			new Uint8Array(0),
		];
		for (const bytes of inputs) {
			for (let level = 0; level <= 9; level += 1) {
				for (const strategy of strategies) {
					const compressed = deflateRawSync(bytes, { level, strategy });
					expect(same(inflateRaw(compressed, { maxOutput: bytes.length }), bytes)).toBe(true);
				}
			}
			for (let windowBits = 9; windowBits <= 15; windowBits += 1) {
				for (const memLevel of [1, 5, 9]) {
					const compressed = deflateRawSync(bytes, { windowBits, memLevel, level: 9 });
					expect(same(inflateRaw(compressed, { maxOutput: bytes.length }), bytes)).toBe(true);
				}
			}
		}
	});

	it('stops at exactly maxOutput, and refuses one byte more', () => {
		const bytes = textLike(10_000, 6);
		const compressed = deflateRawSync(bytes);
		expect(inflateRaw(compressed, { maxOutput: 10_000 }).length).toBe(10_000);
		expect(() => inflateRaw(compressed, { maxOutput: 9_999 })).toThrow(ArchiveTooLargeError);
		const stored = deflateRawSync(bytes, { level: 0 });
		expect(() => inflateRaw(stored, { maxOutput: 9_999 })).toThrow(ArchiveTooLargeError);
		expect(inflateRaw(deflateRawSync(new Uint8Array(0)), { maxOutput: 0 }).length).toBe(0);
		expect(() => inflateRaw(deflateRawSync(new Uint8Array(1)), { maxOutput: 0 })).toThrow(
			ArchiveTooLargeError,
		);
	});

	it('refuses a stream that expands past the limit without ever holding the expansion', () => {
		// One literal and then matches of 258 at distance 1, about 13 bits each:
		// 400 kB of this claims roughly 60 MB. The limit is a megabyte, and the
		// refusal names it.
		const writer = new Bits();
		writer.put(1, 1).put(1, 2);
		fixedLiteral(writer, 0x41);
		for (let i = 0; i < 250_000; i += 1) {
			fixedLiteral(writer, 285);
			writer.huff(0, 5);
		}
		fixedLiteral(writer, 256);
		const bomb = writer.done();
		expect(bomb.length).toBeLessThan(500_000);
		try {
			inflateRaw(bomb, { maxOutput: 1 << 20 });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ArchiveTooLargeError);
			expect((error as ArchiveTooLargeError).params).toEqual({ limit: 1 << 20, unit: 'bytes' });
		}
	});

	it('refuses a maxOutput that is not a whole number of bytes', () => {
		const compressed = deflateRawSync(new Uint8Array(1));
		for (const maxOutput of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => inflateRaw(compressed, { maxOutput })).toThrow(RangeError);
		}
	});

	it.each(MALFORMED())('refuses $name', ({ bytes }) => {
		expect(() => inflateRaw(bytes, { maxOutput: 1 << 20 })).toThrow(ArchiveMalformedError);
		try {
			inflateRaw(bytes, { maxOutput: 1 << 20 });
		} catch (error) {
			expect((error as QrStudioError).code).toBe('archive/malformed');
			expect((error as QrStudioError).params).toEqual({ format: 'deflate' });
		}
	});

	it.each(ACCEPTED())('accepts $name, as zlib does', ({ bytes, expected }) => {
		expect([...inflateRawSync(bytes)]).toEqual(expected);
		expect([...inflateRaw(bytes, { maxOutput: 1 << 20 })]).toEqual(expected);
	});

	it('refuses bytes after the final block, which zlib would ignore', () => {
		const valid = deflateRawSync(textLike(100, 8));
		const trailing = new Uint8Array([...valid, 0]);
		expect(inflateRawSync(trailing).length).toBe(100);
		expect(() => inflateRaw(trailing, { maxOutput: 1000 })).toThrow(ArchiveMalformedError);
	});

	it('refuses every truncation of a valid stream', () => {
		const valid = deflateRaw(textLike(3000, 9), { level: 9 });
		for (let length = 0; length < valid.length; length += 1) {
			expect(
				() => inflateRaw(valid.subarray(0, length), { maxOutput: 1 << 16 }),
				`${length}`,
			).toThrow(ArchiveMalformedError);
		}
	});
});

describe('zlibWrap and zlibUnwrap', () => {
	it('round trip through zlib in both directions', () => {
		for (const { bytes } of CORPUS.slice(0, 10)) {
			for (const level of LEVELS) {
				const wrapped = zlibWrap(bytes, { level });
				expect(same(inflateSync(wrapped), bytes)).toBe(true);
				expect(same(zlibUnwrap(wrapped, { maxOutput: bytes.length }), bytes)).toBe(true);
				expect(
					same(zlibUnwrap(deflateSync(bytes, { level }), { maxOutput: bytes.length }), bytes),
				).toBe(true);
			}
		}
		expect(zlibWrap(new Uint8Array(3))).toEqual(zlibWrap(new Uint8Array(3), { level: 6 }));
	});

	it('writes the header zlib writes for each level', () => {
		const header = (level: DeflateLevel): number[] => [
			...zlibWrap(new Uint8Array(0), { level }).subarray(0, 2),
		];
		expect(header(0)).toEqual([0x78, 0x01]);
		expect(header(1)).toEqual([0x78, 0x01]);
		expect(header(6)).toEqual([0x78, 0x9c]);
		expect(header(9)).toEqual([0x78, 0xda]);
		for (const level of LEVELS) {
			expect(header(level)).toEqual([...deflateSync(new Uint8Array(0), { level }).subarray(0, 2)]);
		}
	});

	it('refuses a damaged wrapper', () => {
		const good = zlibWrap(textLike(200, 10));
		const variants: Record<string, Uint8Array> = {
			'too short': new Uint8Array([0x78]),
			empty: new Uint8Array(0),
			'method 7': Uint8Array.from([0x77, ...good.subarray(1)]),
			'window past 32 KB': Uint8Array.from([0x88, 0x1c, ...good.subarray(2)]),
			'bad check bits': Uint8Array.from([0x78, 0x9d, ...good.subarray(2)]),
			'a preset dictionary': Uint8Array.from([0x78, 0xbb, ...good.subarray(2)]),
			'wrong Adler-32': Uint8Array.from([...good.subarray(0, -1), (good.at(-1) as number) ^ 1]),
			'Adler-32 cut short': good.subarray(0, -1),
			'a byte after the Adler-32': Uint8Array.from([...good, 0]),
		};
		for (const [name, bytes] of Object.entries(variants)) {
			expect(() => zlibUnwrap(bytes, { maxOutput: 1000 }), name).toThrow(ArchiveMalformedError);
			try {
				zlibUnwrap(bytes, { maxOutput: 1000 });
			} catch (error) {
				expect((error as QrStudioError).params, name).toEqual({ format: 'zlib' });
			}
		}
		// The header checks are the wrapper's; a broken body is the deflate layer's.
		const brokenBody = Uint8Array.from([0x78, 0x9c, 0xff, 0xff, 0, 0, 0, 1]);
		expect(() => zlibUnwrap(brokenBody, { maxOutput: 1000 })).toThrow(ArchiveMalformedError);
		expect(() => zlibUnwrap(good, { maxOutput: 10 })).toThrow(ArchiveTooLargeError);
	});
});

/* Streams written by hand. */

/** An LSB-first bit writer, written independently of the one under test. */
class Bits {
	private readonly bytes: number[] = [];
	private current = 0;
	private used = 0;

	/** `count` bits of `value`, least significant first, as DEFLATE packs header fields. */
	put(value: number, count: number): this {
		for (let i = 0; i < count; i += 1) this.bit((value >>> i) & 1);
		return this;
	}

	/** A Huffman code, most significant bit first, as DEFLATE packs codes. */
	huff(code: number, length: number): this {
		for (let i = length - 1; i >= 0; i -= 1) this.bit((code >>> i) & 1);
		return this;
	}

	align(): this {
		while (this.used !== 0) this.bit(0);
		return this;
	}

	raw(...values: number[]): this {
		this.align();
		this.bytes.push(...values);
		return this;
	}

	done(): Uint8Array {
		if (this.used !== 0) this.align();
		return Uint8Array.from(this.bytes);
	}

	private bit(value: number): void {
		this.current |= value << this.used;
		this.used += 1;
		if (this.used === 8) {
			this.bytes.push(this.current);
			this.current = 0;
			this.used = 0;
		}
	}
}

/** A literal/length symbol in the fixed code of RFC 1951 section 3.2.6. */
function fixedLiteral(writer: Bits, symbol: number): Bits {
	if (symbol < 144) return writer.huff(0x30 + symbol, 8);
	if (symbol < 256) return writer.huff(0x190 + symbol - 144, 9);
	if (symbol < 280) return writer.huff(symbol - 256, 7);
	return writer.huff(0xc0 + symbol - 280, 8);
}

/** Canonical codes from lengths, written out here rather than imported. */
function codesFor(lengths: readonly number[]): number[] {
	const counts = new Array<number>(16).fill(0);
	for (const length of lengths) if (length > 0) counts[length] = (counts[length] as number) + 1;
	const next = new Array<number>(16).fill(0);
	let code = 0;
	for (let bits = 1; bits < 16; bits += 1) {
		code = (code + (counts[bits - 1] as number)) << 1;
		next[bits] = code;
	}
	return lengths.map((length) => {
		if (length === 0) return -1;
		const value = next[length] as number;
		next[length] = value + 1;
		return value;
	});
}

/**
 * A dynamic block header for the given literal/length and distance code
 * lengths, sending each length as a plain 4-bit code (code-length symbols 0
 * to 15 all of length 4, which is a complete code) so the test controls every
 * length directly.
 */
function dynamicHeader(writer: Bits, final: boolean, lit: number[], dist: number[]): void {
	const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
	writer.put(final ? 1 : 0, 1).put(2, 2);
	writer
		.put(lit.length - 257, 5)
		.put(dist.length - 1, 5)
		.put(19 - 4, 4);
	for (const symbol of order) writer.put(symbol >= 16 ? 0 : 4, 3);
	for (const length of [...lit, ...dist]) writer.huff(length, 4);
}

function lengths(size: number, set: Record<number, number>): number[] {
	const out = new Array<number>(size).fill(0);
	for (const [symbol, length] of Object.entries(set)) out[Number(symbol)] = length;
	return out;
}

function MALFORMED(): { name: string; bytes: Uint8Array }[] {
	const cases: { name: string; bytes: Uint8Array }[] = [];
	const add = (name: string, build: (writer: Bits) => void): void => {
		const writer = new Bits();
		build(writer);
		cases.push({ name, bytes: writer.done() });
	};
	add('an empty input', () => undefined);
	add('block type 3', (w) => w.put(1, 1).put(3, 2));
	add('a stored block whose length check is wrong', (w) =>
		w.put(1, 1).put(0, 2).raw(5, 0, 0, 0, 1, 2, 3, 4, 5),
	);
	add('a stored block cut short', (w) => w.put(1, 1).put(0, 2).raw(5, 0, 0xfa, 0xff, 1, 2));
	add('a stored header cut short', (w) => w.put(1, 1).put(0, 2).raw(5, 0, 0xfa));
	add('a non-final stored block with nothing after it', (w) =>
		w.put(0, 1).put(0, 2).raw(0, 0, 0xff, 0xff),
	);
	add('literal/length code 286 in the fixed code', (w) => fixedLiteral(w.put(1, 1).put(1, 2), 286));
	add('literal/length code 287 in the fixed code', (w) => fixedLiteral(w.put(1, 1).put(1, 2), 287));
	add('distance code 30 in the fixed code', (w) => {
		fixedLiteral(w.put(1, 1).put(1, 2), 0x41);
		fixedLiteral(w, 257);
		w.huff(30, 5);
	});
	add('distance code 31 in the fixed code', (w) => {
		fixedLiteral(w.put(1, 1).put(1, 2), 0x41);
		fixedLiteral(w, 257);
		w.huff(31, 5);
	});
	add('a distance before the start of the output', (w) => {
		fixedLiteral(w.put(1, 1).put(1, 2), 0x41);
		fixedLiteral(w, 257);
		w.huff(1, 5); // distance 2, with one byte written
	});
	add('a fixed block with no end-of-block', (w) => fixedLiteral(w.put(1, 1).put(1, 2), 0x41));
	add('a length code cut off before its extra bits', (w) => {
		fixedLiteral(w.put(1, 1).put(1, 2), 0x41);
		fixedLiteral(w, 285 - 1); // code 284 takes 5 extra bits
	});
	add('287 literal/length codes', (w) => w.put(1, 1).put(2, 2).put(30, 5).put(0, 5).put(0, 4));
	add('31 distance codes', (w) => w.put(1, 1).put(2, 2).put(0, 5).put(30, 5).put(0, 4));
	add('an incomplete code-length code', (w) => {
		w.put(1, 1).put(2, 2).put(0, 5).put(0, 5).put(0, 4);
		w.put(0, 3).put(0, 3).put(0, 3).put(1, 3); // only symbol 0, one bit
	});
	add('an over-subscribed code-length code', (w) => {
		w.put(1, 1).put(2, 2).put(0, 5).put(0, 5).put(0, 4);
		w.put(1, 3).put(1, 3).put(1, 3).put(1, 3); // four one-bit codes
	});
	add('a code-length code with no codes at all', (w) => {
		w.put(1, 1).put(2, 2).put(0, 5).put(0, 5).put(0, 4);
		w.put(0, 3).put(0, 3).put(0, 3).put(0, 3);
	});
	add('a repeat of the previous length with nothing before it', (w) => {
		// Code-length symbols 0 and 16, one bit each: canonical order gives 0
		// the code 0 and 16 the code 1.
		w.put(1, 1).put(2, 2).put(0, 5).put(0, 5).put(0, 4);
		w.put(1, 3).put(0, 3).put(0, 3).put(1, 3);
		w.huff(1, 1).put(0, 2);
	});
	add('a run of zero lengths past the declared count', (w) => {
		// Symbols 18 and 0, one bit each: 0 is code 0, 18 is code 1.
		w.put(1, 1).put(2, 2).put(0, 5).put(0, 5).put(0, 4);
		w.put(0, 3).put(0, 3).put(1, 3).put(1, 3);
		w.huff(1, 1).put(127, 7).huff(1, 1).put(127, 7);
	});
	add('a literal/length code with no end-of-block', (w) => {
		dynamicHeader(w, true, lengths(257, { 0: 1, 1: 1 }), [1]);
	});
	add('an incomplete literal/length code of more than one code', (w) => {
		dynamicHeader(w, true, lengths(257, { 0: 1, 256: 2 }), [1]);
	});
	add('an over-subscribed literal/length code', (w) => {
		dynamicHeader(w, true, lengths(257, { 0: 1, 1: 1, 256: 1 }), [1]);
	});
	add('an incomplete distance code of more than one code', (w) => {
		dynamicHeader(w, true, lengths(258, { 65: 1, 256: 2, 257: 2 }), [1, 2]);
	});
	add('a distance read from a distance code with no codes', (w) => {
		const lit = lengths(258, { 65: 1, 256: 2, 257: 2 });
		dynamicHeader(w, true, lit, [0]);
		const codes = codesFor(lit);
		w.huff(codes[65] as number, 1)
			.huff(codes[257] as number, 2)
			.put(0, 16);
	});
	add('a bit pattern no code uses', (w) => {
		// A single one-bit literal/length code is allowed, but its unused
		// pattern is not a symbol. Enough bits follow that the decoder runs out
		// of code lengths before it runs out of input.
		dynamicHeader(w, true, lengths(257, { 256: 1 }), [1]);
		w.huff(1, 1).put(0, 16);
	});
	add('a truncated bit pattern no code uses', (w) => {
		dynamicHeader(w, true, lengths(257, { 256: 1 }), [1]);
		w.huff(1, 1);
	});
	return cases;
}

function ACCEPTED(): { name: string; bytes: Uint8Array; expected: number[] }[] {
	const cases: { name: string; bytes: Uint8Array; expected: number[] }[] = [];
	{
		// A single one-bit distance code (incomplete, which zlib allows).
		const w = new Bits();
		const lit = lengths(258, { 65: 1, 256: 2, 257: 2 });
		dynamicHeader(w, true, lit, [1]);
		const codes = codesFor(lit);
		w.huff(codes[65] as number, 1)
			.huff(codes[257] as number, 2)
			.huff(0, 1);
		w.huff(codes[256] as number, 2);
		cases.push({
			name: 'a single one-bit distance code',
			bytes: w.done(),
			expected: [65, 65, 65, 65],
		});
	}
	{
		// No distance codes at all, in a block that uses none.
		const w = new Bits();
		const lit = lengths(257, { 65: 1, 256: 1 });
		dynamicHeader(w, true, lit, [0]);
		const codes = codesFor(lit);
		w.huff(codes[65] as number, 1)
			.huff(codes[65] as number, 1)
			.huff(codes[256] as number, 1);
		cases.push({
			name: 'an empty distance code that is never used',
			bytes: w.done(),
			expected: [65, 65],
		});
	}
	{
		// A single one-bit literal/length code, which can only be end-of-block.
		const w = new Bits();
		dynamicHeader(w, true, lengths(257, { 256: 1 }), [1]);
		w.huff(0, 1);
		cases.push({
			name: 'a block of nothing in a one-code literal/length code',
			bytes: w.done(),
			expected: [],
		});
	}
	{
		// Empty stored blocks before a final one, and a stored block after a
		// fixed one that ends mid-byte.
		const w = new Bits();
		w.put(0, 1).put(0, 2).raw(0, 0, 0xff, 0xff);
		w.put(0, 1).put(1, 2);
		fixedLiteral(w, 0x42);
		fixedLiteral(w, 256);
		w.put(1, 1).put(0, 2).raw(2, 0, 0xfd, 0xff, 0x43, 0x44);
		cases.push({
			name: 'stored blocks around a fixed one',
			bytes: w.done(),
			expected: [0x42, 0x43, 0x44],
		});
	}
	{
		// The longest length, 258, with the farthest distance code in reach.
		const w = new Bits();
		w.put(1, 1).put(1, 2);
		for (let i = 0; i < 300; i += 1) fixedLiteral(w, i & 0x7f);
		fixedLiteral(w, 285);
		w.huff(16, 5).put(300 - 257, 7); // distance code 16: 257 plus 7 extra bits
		fixedLiteral(w, 256);
		const prefix = Array.from({ length: 300 }, (_, i) => i & 0x7f);
		const expected = [...prefix];
		for (let i = 0; i < 258; i += 1) expected.push(expected[expected.length - 300] as number);
		cases.push({ name: 'a 258 byte match from 300 back', bytes: w.done(), expected });
	}
	return cases;
}
