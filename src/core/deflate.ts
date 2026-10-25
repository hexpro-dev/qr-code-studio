/**
 * DEFLATE (RFC 1951) and its zlib wrapper (RFC 1950), synchronous and
 * deterministic.
 *
 * This exists because the platform's `CompressionStream` gives different bytes
 * in Node, Chromium and Safari (each links its own zlib, at its own version),
 * so the same design would export a different PNG on each, and a PNG whose
 * bytes depend on the browser cannot be compared, cached or signed. Everything
 * here is integer arithmetic over typed arrays, so it gives the same output
 * everywhere, and zlib is its test oracle in both directions.
 *
 * The compressor is zlib's design in outline: LZ77 over a 32 KB window with
 * hash chains, greedy parsing at level 1 and lazy parsing at 6 and 9 (with
 * zlib's chain lengths and cut-offs), and blocks of 16 383 symbols. Each block
 * is written in whichever of dynamic Huffman, fixed Huffman or stored is
 * smallest. Code lengths are optimal for their limits (15 bits, 7 for the
 * code-length code) by package-merge, with every tie broken by symbol number,
 * so the output depends on the input and the level and on nothing else.
 *
 * The decompressor is strict in the same places zlib is (over-subscribed or
 * incomplete codes, a missing end-of-block code, distances before the start,
 * lengths past the declared counts) and stricter in one: bytes after the final
 * block are refused rather than ignored, because a stream that ends early
 * inside a container is a damaged container. It never allocates past
 * `maxOutput`: the check comes before the buffer grows, so a stream built to
 * expand to gigabytes is refused at the size it would reach next.
 */

import { adler32 } from './checksums.js';
import { ArchiveMalformedError, ArchiveTooLargeError } from './errors.js';
import { canonicalCodes, codeLengths, reverseBits } from './huffman.js';

export type DeflateLevel = 0 | 1 | 6 | 9;

export interface DeflateOptions {
	/** 0 stores, 1 is fastest, 6 is zlib's default, 9 tries hardest. Defaults to 6. */
	readonly level?: DeflateLevel;
}

export interface InflateOptions {
	/** The most bytes the output may hold. Required, because the input says nothing trustworthy about it. */
	readonly maxOutput: number;
}

/* RFC 1951 section 3.2.5: length and distance codes. */
const LENGTH_BASE = [
	3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
	163, 195, 227, 258,
];
const LENGTH_EXTRA = [
	0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
	1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
	3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
	0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** The order code-length code lengths are sent in (section 3.2.7). */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const LITLEN_CODES = 286;
const DIST_CODES = 30;
const CODE_LENGTH_CODES = 19;
const MAX_BITS = 15;
const MAX_CODE_LENGTH_BITS = 7;
const END_OF_BLOCK = 256;
const MAX_STORED = 65535;

const WINDOW = 32768;
const WINDOW_MASK = WINDOW - 1;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const MIN_MATCH = 3;
/** Bytes the match-finder's hash covers; see `compress`. */
const HASH_BYTES = 4;
const MAX_MATCH = 258;
/** zlib's TOO_FAR: a three byte match further back than this costs more than three literals. */
const TOO_FAR = 4096;
/** zlib's block size at its default memory level: lit_bufsize - 1. */
const BLOCK_SYMBOLS = 16383;

interface Effort {
	readonly lazy: boolean;
	/** Search a quarter as far once the previous match is at least this long. */
	readonly good: number;
	/** Stop looking for a better match once one is this long (lazy), or insert no more of a match than this (greedy). */
	readonly maxLazy: number;
	/** Stop walking the chain once a match is this long. */
	readonly nice: number;
	/** The most chain entries examined per position. */
	readonly chain: number;
}

/** zlib's configuration_table rows for levels 1, 6 and 9. */
const EFFORT: Readonly<Record<1 | 6 | 9, Effort>> = {
	1: { lazy: false, good: 4, maxLazy: 4, nice: 8, chain: 4 },
	6: { lazy: true, good: 8, maxLazy: 16, nice: 128, chain: 128 },
	9: { lazy: true, good: 32, maxLazy: 258, nice: 258, chain: 4096 },
};

/* Lookup tables, built on first use. */

let lengthCodes: Uint8Array | undefined;
let distanceCodes: Uint8Array | undefined;

/** Match length 3..258 to its code index 0..28. */
function lengthCodeTable(): Uint8Array {
	if (lengthCodes) return lengthCodes;
	const table = new Uint8Array(MAX_MATCH + 1);
	for (let code = 0; code < LENGTH_BASE.length; code += 1) {
		const base = LENGTH_BASE[code] as number;
		const span = 1 << (LENGTH_EXTRA[code] as number);
		for (let length = base; length < base + span && length <= MAX_MATCH; length += 1) {
			table[length] = code;
		}
	}
	// 258 has a code of its own with no extra bits, rather than being the top of
	// code 27's range.
	table[MAX_MATCH] = 28;
	lengthCodes = table;
	return table;
}

/** Distance 1..32768 to its code index 0..29. */
function distanceCodeTable(): Uint8Array {
	if (distanceCodes) return distanceCodes;
	const table = new Uint8Array(WINDOW + 1);
	for (let code = 0; code < DIST_BASE.length; code += 1) {
		const base = DIST_BASE[code] as number;
		const span = 1 << (DIST_EXTRA[code] as number);
		for (let distance = base; distance < base + span; distance += 1) table[distance] = code;
	}
	distanceCodes = table;
	return table;
}

function fixedLitLenLengths(): Uint8Array {
	const lengths = new Uint8Array(288);
	lengths.fill(8, 0, 144);
	lengths.fill(9, 144, 256);
	lengths.fill(7, 256, 280);
	lengths.fill(8, 280, 288);
	return lengths;
}

/**
 * Code lengths for a block's tree, with at least two codes.
 *
 * A single code would be one bit for a symbol that needs none, and zlib's
 * inflater refuses an incomplete code-length code outright, so like zlib's
 * deflater this pads the set to two with the lowest unused symbols. They are
 * given a frequency for the construction only, and cost nothing because they
 * are never sent.
 */
function treeLengths(frequencies: Uint32Array, limit: number): Uint8Array {
	let count = 0;
	for (const value of frequencies) if (value > 0) count += 1;
	if (count >= 2) return codeLengths(frequencies, limit);
	const padded = frequencies.slice();
	for (let symbol = 0; symbol < padded.length && count < 2; symbol += 1) {
		if (padded[symbol] === 0) {
			padded[symbol] = 1;
			count += 1;
		}
	}
	return codeLengths(padded, limit);
}

/* Output. */

class BitWriter {
	private out: Uint8Array;
	private size = 0;
	private buffer = 0;
	private count = 0;

	constructor(capacity: number) {
		this.out = new Uint8Array(Math.max(64, capacity));
	}

	/** Bits pending in the partial last byte, 0 to 7. */
	get pending(): number {
		return this.count;
	}

	bits(value: number, count: number): void {
		this.buffer |= value << this.count;
		this.count += count;
		while (this.count >= 8) {
			this.byte(this.buffer & 0xff);
			this.buffer >>>= 8;
			this.count -= 8;
		}
	}

	align(): void {
		if (this.count > 0) {
			this.byte(this.buffer & 0xff);
			this.buffer = 0;
			this.count = 0;
		}
	}

	/** Raw bytes, for a stored block. Only called when aligned. */
	copy(source: Uint8Array, start: number, end: number): void {
		this.reserve(end - start);
		this.out.set(source.subarray(start, end), this.size);
		this.size += end - start;
	}

	finish(): Uint8Array {
		this.align();
		return this.out.slice(0, this.size);
	}

	private byte(value: number): void {
		this.reserve(1);
		this.out[this.size] = value;
		this.size += 1;
	}

	private reserve(extra: number): void {
		if (this.size + extra <= this.out.length) return;
		let capacity = this.out.length * 2;
		while (capacity < this.size + extra) capacity *= 2;
		const grown = new Uint8Array(capacity);
		grown.set(this.out.subarray(0, this.size));
		this.out = grown;
	}
}

function writeStored(
	writer: BitWriter,
	input: Uint8Array,
	start: number,
	end: number,
	final: boolean,
): void {
	let at = start;
	do {
		const length = Math.min(MAX_STORED, end - at);
		const last = at + length === end;
		writer.bits(final && last ? 1 : 0, 3);
		writer.align();
		writer.bits(length, 16);
		writer.bits(length ^ 0xffff, 16);
		writer.copy(input, at, at + length);
		at += length;
	} while (at < end);
}

/** The bits `writeStored` would use, starting with `pending` bits in the partial byte. */
function storedBits(pending: number, length: number): number {
	let bits = 0;
	let partial = pending;
	let rest = length;
	do {
		const chunk = Math.min(MAX_STORED, rest);
		bits += 3 + ((8 - ((partial + 3) & 7)) & 7) + 32 + 8 * chunk;
		partial = 0;
		rest -= chunk;
	} while (rest > 0);
	return bits;
}

/** The symbols of one block, as the parser produced them. */
interface Block {
	/** A literal byte, or a match length 3..258. */
	readonly lit: Uint16Array;
	/** 0 for a literal, otherwise the match distance. */
	readonly dist: Uint16Array;
	readonly count: number;
	/** The input bytes the symbols cover, for the stored alternative. */
	readonly start: number;
	readonly end: number;
}

/** Run-length code the code lengths of one tree, as zlib's send_tree does. */
function runLengths(lengths: Uint8Array, count: number, symbols: number[], extras: number[]): void {
	let previous = -1;
	let next = lengths[0] as number;
	let run = 0;
	let maxRun = next === 0 ? 138 : 7;
	let minRun = next === 0 ? 3 : 4;
	for (let n = 0; n < count; n += 1) {
		const current = next;
		next = n + 1 < count ? (lengths[n + 1] as number) : -1;
		run += 1;
		if (run < maxRun && current === next) continue;
		if (run < minRun) {
			for (let i = 0; i < run; i += 1) {
				symbols.push(current);
				extras.push(0);
			}
		} else if (current !== 0) {
			if (current !== previous) {
				symbols.push(current);
				extras.push(0);
				run -= 1;
			}
			symbols.push(16);
			extras.push(run - 3);
		} else if (run <= 10) {
			symbols.push(17);
			extras.push(run - 3);
		} else {
			symbols.push(18);
			extras.push(run - 11);
		}
		run = 0;
		previous = current;
		if (next === 0) {
			maxRun = 138;
			minRun = 3;
		} else if (current === next) {
			maxRun = 6;
			minRun = 3;
		} else {
			maxRun = 7;
			minRun = 4;
		}
	}
}

const CODE_LENGTH_EXTRA = [2, 3, 7];

function writeBlock(writer: BitWriter, input: Uint8Array, block: Block, final: boolean): void {
	const lengthCode = lengthCodeTable();
	const distanceCode = distanceCodeTable();
	const litFreq = new Uint32Array(LITLEN_CODES);
	const distFreq = new Uint32Array(DIST_CODES);
	let extraBits = 0;
	for (let i = 0; i < block.count; i += 1) {
		const distance = block.dist[i] as number;
		if (distance === 0) {
			litFreq[block.lit[i] as number] = (litFreq[block.lit[i] as number] as number) + 1;
			continue;
		}
		const lc = lengthCode[block.lit[i] as number] as number;
		const dc = distanceCode[distance] as number;
		litFreq[257 + lc] = (litFreq[257 + lc] as number) + 1;
		distFreq[dc] = (distFreq[dc] as number) + 1;
		extraBits += (LENGTH_EXTRA[lc] as number) + (DIST_EXTRA[dc] as number);
	}
	litFreq[END_OF_BLOCK] = 1;

	// The dynamic alternative.
	const litLengths = treeLengths(litFreq, MAX_BITS);
	const distLengths = treeLengths(distFreq, MAX_BITS);
	let hlit = LITLEN_CODES;
	while (hlit > 257 && litLengths[hlit - 1] === 0) hlit -= 1;
	let hdist = DIST_CODES;
	while (hdist > 1 && distLengths[hdist - 1] === 0) hdist -= 1;
	const rleSymbols: number[] = [];
	const rleExtras: number[] = [];
	runLengths(litLengths, hlit, rleSymbols, rleExtras);
	runLengths(distLengths, hdist, rleSymbols, rleExtras);
	const clFreq = new Uint32Array(CODE_LENGTH_CODES);
	for (const symbol of rleSymbols) clFreq[symbol] = (clFreq[symbol] as number) + 1;
	const clLengths = treeLengths(clFreq, MAX_CODE_LENGTH_BITS);
	let hclen = CODE_LENGTH_CODES;
	while (hclen > 4 && clLengths[CODE_LENGTH_ORDER[hclen - 1] as number] === 0) hclen -= 1;

	let dynamicBits = 3 + 5 + 5 + 4 + 3 * hclen + extraBits;
	for (let s = 0; s < CODE_LENGTH_CODES; s += 1) {
		dynamicBits += (clFreq[s] as number) * (clLengths[s] as number);
		if (s >= 16) dynamicBits += (clFreq[s] as number) * (CODE_LENGTH_EXTRA[s - 16] as number);
	}
	let fixedBits = 3 + extraBits;
	const fixed = fixedLitLenLengths();
	for (let s = 0; s < LITLEN_CODES; s += 1) {
		dynamicBits += (litFreq[s] as number) * (litLengths[s] as number);
		fixedBits += (litFreq[s] as number) * (fixed[s] as number);
	}
	for (let s = 0; s < DIST_CODES; s += 1) {
		dynamicBits += (distFreq[s] as number) * (distLengths[s] as number);
		fixedBits += (distFreq[s] as number) * 5;
	}
	const stored = storedBits(writer.pending, block.end - block.start);

	if (stored < fixedBits && stored < dynamicBits) {
		writeStored(writer, input, block.start, block.end, final);
		return;
	}
	let litCodes: Uint16Array;
	let litBits: Uint8Array;
	let distCodes: Uint16Array;
	let distBits: Uint8Array;
	if (fixedBits <= dynamicBits) {
		writer.bits(final ? 0b011 : 0b010, 3);
		litBits = fixed;
		litCodes = canonicalCodes(fixed);
		distBits = new Uint8Array(DIST_CODES).fill(5);
		distCodes = canonicalCodes(distBits);
	} else {
		writer.bits(final ? 0b101 : 0b100, 3);
		writer.bits(hlit - 257, 5);
		writer.bits(hdist - 1, 5);
		writer.bits(hclen - 4, 4);
		for (let i = 0; i < hclen; i += 1) {
			writer.bits(clLengths[CODE_LENGTH_ORDER[i] as number] as number, 3);
		}
		const clCodes = canonicalCodes(clLengths);
		for (let i = 0; i < rleSymbols.length; i += 1) {
			const symbol = rleSymbols[i] as number;
			writer.bits(clCodes[symbol] as number, clLengths[symbol] as number);
			if (symbol >= 16) {
				writer.bits(rleExtras[i] as number, CODE_LENGTH_EXTRA[symbol - 16] as number);
			}
		}
		litBits = litLengths;
		litCodes = canonicalCodes(litLengths);
		distBits = distLengths;
		distCodes = canonicalCodes(distLengths);
	}

	for (let i = 0; i < block.count; i += 1) {
		const distance = block.dist[i] as number;
		const value = block.lit[i] as number;
		if (distance === 0) {
			writer.bits(litCodes[value] as number, litBits[value] as number);
			continue;
		}
		const lc = lengthCode[value] as number;
		writer.bits(litCodes[257 + lc] as number, litBits[257 + lc] as number);
		const lengthExtra = LENGTH_EXTRA[lc] as number;
		if (lengthExtra > 0) writer.bits(value - (LENGTH_BASE[lc] as number), lengthExtra);
		const dc = distanceCode[distance] as number;
		writer.bits(distCodes[dc] as number, distBits[dc] as number);
		const distExtra = DIST_EXTRA[dc] as number;
		if (distExtra > 0) writer.bits(distance - (DIST_BASE[dc] as number), distExtra);
	}
	writer.bits(litCodes[END_OF_BLOCK] as number, litBits[END_OF_BLOCK] as number);
}

/** LZ77 over the whole input, handing blocks of symbols to `writeBlock` as they fill. */
function compress(input: Uint8Array, effort: Effort, writer: BitWriter): void {
	const n = input.length;
	const head = new Int32Array(HASH_SIZE).fill(-1);
	const prev = new Int32Array(WINDOW);
	const lit = new Uint16Array(BLOCK_SYMBOLS);
	const dist = new Uint16Array(BLOCK_SYMBOLS);
	let count = 0;
	let blockStart = 0;
	let covered = 0;

	const flush = (final: boolean): void => {
		writeBlock(writer, input, { lit, dist, count, start: blockStart, end: covered }, final);
		blockStart = covered;
		count = 0;
	};
	const emit = (value: number, distance: number, span: number): void => {
		if (count === BLOCK_SYMBOLS) flush(false);
		lit[count] = value;
		dist[count] = distance;
		count += 1;
		covered += span;
	};
	// A multiplicative hash of the next four bytes (Math.imul is exact, so it
	// is as deterministic as shifts). Four rather than zlib's classic three, as
	// Chromium's zlib (the one Node ships) does: in a raster, three bytes of
	// white say almost nothing, every position in a run shares one chain, and
	// with three the row above falls off the end of a level 6 search. Matches
	// are still compared from their first byte, so three-byte matches are not
	// excluded, only no longer looked for.
	const hash = (p: number): number =>
		Math.imul(
			(input[p] as number) |
				((input[p + 1] as number) << 8) |
				((input[p + 2] as number) << 16) |
				((input[p + 3] as number) << 24),
			0x9e3779b1,
		) >>>
		(32 - HASH_BITS);
	const insert = (p: number): void => {
		const h = hash(p);
		prev[p & WINDOW_MASK] = head[h] as number;
		head[h] = p;
	};

	// The longest match at `pos` longer than `better`, from the chain at `start`.
	let matchLength = 0;
	let matchDistance = 0;
	const search = (pos: number, start: number, better: number): void => {
		matchLength = MIN_MATCH - 1;
		matchDistance = 0;
		const maxLength = Math.min(MAX_MATCH, n - pos);
		if (better >= maxLength) return;
		const nice = Math.min(effort.nice, maxLength);
		const limit = pos - WINDOW;
		let best = Math.max(better, MIN_MATCH - 1);
		let chain = better >= effort.good ? effort.chain >>> 2 : effort.chain;
		for (let candidate = start; candidate >= 0 && candidate >= limit && chain > 0; chain -= 1) {
			// Cheapest rejection first: a longer match must agree one byte past the
			// best so far.
			if (
				input[candidate + best] === input[pos + best] &&
				input[candidate] === input[pos] &&
				input[candidate + 1] === input[pos + 1]
			) {
				let length = 2;
				while (length < maxLength && input[candidate + length] === input[pos + length]) {
					length += 1;
				}
				if (length > best) {
					best = length;
					matchLength = length;
					matchDistance = pos - candidate;
					if (length >= nice) return;
				}
			}
			candidate = prev[candidate & WINDOW_MASK] as number;
		}
	};

	if (!effort.lazy) {
		let pos = 0;
		while (pos < n) {
			if (pos + HASH_BYTES <= n) {
				const h = hash(pos);
				search(pos, head[h] as number, MIN_MATCH - 1);
				prev[pos & WINDOW_MASK] = head[h] as number;
				head[h] = pos;
				if (matchLength >= MIN_MATCH) {
					const length = matchLength;
					emit(length, matchDistance, length);
					// Like zlib's deflate_fast: index the inside of short matches only.
					if (length <= effort.maxLazy) {
						for (let p = pos + 1; p < pos + length && p + HASH_BYTES <= n; p += 1) insert(p);
					}
					pos += length;
					continue;
				}
			}
			emit(input[pos] as number, 0, 1);
			pos += 1;
		}
	} else {
		// zlib's deflate_slow: hold each match back one byte in case the next
		// position starts a longer one.
		let pos = 0;
		let prevLength = MIN_MATCH - 1;
		let prevDistance = 0;
		let available = false;
		while (pos < n) {
			let length = MIN_MATCH - 1;
			let distance = 0;
			if (pos + HASH_BYTES <= n) {
				const h = hash(pos);
				if (prevLength < effort.maxLazy) {
					search(pos, head[h] as number, prevLength);
					length = matchLength;
					distance = matchDistance;
					if (length === MIN_MATCH && distance > TOO_FAR) length = MIN_MATCH - 1;
				}
				prev[pos & WINDOW_MASK] = head[h] as number;
				head[h] = pos;
			}
			if (prevLength >= MIN_MATCH && length <= prevLength) {
				emit(prevLength, prevDistance, prevLength);
				const end = pos - 1 + prevLength;
				for (let p = pos + 1; p < end && p + HASH_BYTES <= n; p += 1) insert(p);
				pos = end;
				available = false;
				prevLength = MIN_MATCH - 1;
			} else {
				if (available) emit(input[pos - 1] as number, 0, 1);
				available = true;
				prevLength = length;
				prevDistance = distance;
				pos += 1;
			}
		}
		if (available) emit(input[n - 1] as number, 0, 1);
	}
	flush(true);
}

function checkLevel(options: DeflateOptions | undefined): DeflateLevel {
	const level = options?.level ?? 6;
	if (level !== 0 && level !== 1 && level !== 6 && level !== 9) {
		throw new TypeError('the deflate level is 0, 1, 6 or 9');
	}
	return level;
}

/** Compress `bytes` as a raw DEFLATE stream, with no header or checksum. */
export function deflateRaw(bytes: Uint8Array, options?: DeflateOptions): Uint8Array {
	const level = checkLevel(options);
	const stored = bytes.length + 5 * (Math.floor(bytes.length / MAX_STORED) + 1);
	const writer = new BitWriter(level === 0 ? stored : bytes.length >>> 1);
	if (level === 0) {
		writeStored(writer, bytes, 0, bytes.length, true);
	} else {
		compress(bytes, EFFORT[level], writer);
	}
	return writer.finish();
}

/** The zlib stream for `bytes`: a two byte header, the DEFLATE stream, then Adler-32 big endian. */
export function zlibWrap(bytes: Uint8Array, options?: DeflateOptions): Uint8Array {
	const level = checkLevel(options);
	const body = deflateRaw(bytes, { level });
	// CMF 0x78: deflate with a 32 KB window. FLEVEL as zlib sets it, then FCHECK
	// so the pair is a multiple of 31.
	const cmf = 0x78;
	const flevel = level <= 1 ? 0 : level === 6 ? 2 : 3;
	let flg = flevel << 6;
	flg += (31 - ((cmf * 256 + flg) % 31)) % 31;
	const out = new Uint8Array(body.length + 6);
	out[0] = cmf;
	out[1] = flg;
	out.set(body, 2);
	const check = adler32(bytes);
	out[body.length + 2] = check >>> 24;
	out[body.length + 3] = (check >>> 16) & 0xff;
	out[body.length + 4] = (check >>> 8) & 0xff;
	out[body.length + 5] = check & 0xff;
	return out;
}

/* Decompression. */

interface Decoder {
	/** Codes per length, 0 to 15. */
	readonly counts: Uint16Array;
	/** Symbols in canonical order: by length, then by symbol. */
	readonly symbols: Uint16Array;
	/** Indexed by the next `root` bits: symbol << 4 | length, or 0 to take the slow path. */
	readonly table: Uint16Array;
	readonly root: number;
}

const ROOT_BITS = 9;

function malformed(): never {
	throw new ArchiveMalformedError('deflate');
}

/**
 * A decoding table for `count` code lengths starting at `start`.
 *
 * Refuses an over-subscribed set, and an incomplete one except where zlib
 * allows it: a literal/length or distance code with a single one-bit code, or
 * with no codes at all (which fails later, if a symbol is ever read from it).
 */
function buildDecoder(
	lengths: Uint8Array,
	start: number,
	count: number,
	codeLengthCode: boolean,
): Decoder {
	const counts = new Uint16Array(MAX_BITS + 1);
	for (let i = 0; i < count; i += 1) {
		const length = lengths[start + i] as number;
		counts[length] = (counts[length] as number) + 1;
	}
	counts[0] = 0;
	let left = 1;
	let max = 0;
	for (let bits = 1; bits <= MAX_BITS; bits += 1) {
		left = left * 2 - (counts[bits] as number);
		if (left < 0) malformed();
		if ((counts[bits] as number) > 0) max = bits;
	}
	if (left > 0 && max > 0 && (codeLengthCode || max !== 1)) malformed();

	const offsets = new Uint16Array(MAX_BITS + 2);
	for (let bits = 1; bits <= MAX_BITS; bits += 1) {
		offsets[bits + 1] = (offsets[bits] as number) + (counts[bits] as number);
	}
	const symbols = new Uint16Array(count);
	for (let i = 0; i < count; i += 1) {
		const length = lengths[start + i] as number;
		if (length === 0) continue;
		symbols[offsets[length] as number] = i;
		offsets[length] = (offsets[length] as number) + 1;
	}

	const root = Math.max(1, Math.min(ROOT_BITS, max));
	const table = new Uint16Array(1 << root);
	let code = 0;
	let index = 0;
	for (let bits = 1; bits <= root; bits += 1) {
		for (let k = 0; k < (counts[bits] as number); k += 1) {
			const entry = ((symbols[index] as number) << 4) | bits;
			const reversed = reverseBits(code, bits);
			for (let fill = reversed; fill < table.length; fill += 1 << bits) table[fill] = entry;
			code += 1;
			index += 1;
		}
		code <<= 1;
	}
	return { counts, symbols, table, root };
}

let fixedDecoders: { litlen: Decoder; dist: Decoder } | undefined;

function fixedTables(): { litlen: Decoder; dist: Decoder } {
	// All 288 literal/length and 32 distance codes, as zlib builds them: the
	// codes past the alphabet exist in the fixed code, and reading one is an
	// error caught where the symbol is used.
	fixedDecoders ??= {
		litlen: buildDecoder(fixedLitLenLengths(), 0, 288, false),
		dist: buildDecoder(new Uint8Array(32).fill(5), 0, 32, false),
	};
	return fixedDecoders;
}

interface Inflated {
	readonly output: Uint8Array;
	/** The byte after the last one the stream used. */
	readonly end: number;
}

function inflate(input: Uint8Array, offset: number, maxOutput: number): Inflated {
	if (!Number.isSafeInteger(maxOutput) || maxOutput < 0) {
		throw new RangeError('maxOutput is a whole number of bytes');
	}
	let pos = offset;
	let buffer = 0;
	let count = 0;
	// A first guess at the output size, grown by doubling; never past maxOutput.
	let out = new Uint8Array(
		Math.min(maxOutput, Math.max(1024, Math.min((input.length - offset) * 4, 1 << 22))),
	);
	let size = 0;

	const need = (bits: number): void => {
		while (count < bits) {
			if (pos >= input.length) malformed();
			buffer |= (input[pos] as number) << count;
			pos += 1;
			count += 8;
		}
	};
	const take = (bits: number): number => {
		need(bits);
		const value = buffer & ((1 << bits) - 1);
		buffer >>>= bits;
		count -= bits;
		return value;
	};
	const reserve = (extra: number): void => {
		if (size + extra <= out.length) return;
		if (size + extra > maxOutput) throw new ArchiveTooLargeError(maxOutput);
		const grown = new Uint8Array(Math.min(maxOutput, Math.max(size + extra, out.length * 2)));
		grown.set(out.subarray(0, size));
		out = grown;
	};
	const decode = (decoder: Decoder): number => {
		// Fill without failing: the stream may end in a code shorter than the
		// table's index, and the slow path below finds a real shortfall.
		while (count < decoder.root && pos < input.length) {
			buffer |= (input[pos] as number) << count;
			pos += 1;
			count += 8;
		}
		const entry = decoder.table[buffer & ((1 << decoder.root) - 1)] as number;
		const length = entry & 15;
		if (length !== 0 && length <= count) {
			buffer >>>= length;
			count -= length;
			return entry >>> 4;
		}
		// Bit at a time through the canonical code (puff's method), for codes
		// longer than the table and for the bit patterns no code uses.
		let code = 0;
		let first = 0;
		let index = 0;
		for (let bits = 1; bits <= MAX_BITS; bits += 1) {
			code |= take(1);
			const n = decoder.counts[bits] as number;
			if (code - first < n) return decoder.symbols[index + code - first] as number;
			index += n;
			first = (first + n) << 1;
			code <<= 1;
		}
		return malformed();
	};

	const lengths = new Uint8Array(LITLEN_CODES + DIST_CODES);
	let final = false;
	while (!final) {
		final = take(1) === 1;
		const type = take(2);
		if (type === 0) {
			// Back up to the byte boundary: whole bytes already pulled into the bit
			// buffer go back to the input.
			pos -= count >>> 3;
			buffer = 0;
			count = 0;
			if (pos + 4 > input.length) malformed();
			const length = (input[pos] as number) | ((input[pos + 1] as number) << 8);
			const check = (input[pos + 2] as number) | ((input[pos + 3] as number) << 8);
			if ((length ^ 0xffff) !== check) malformed();
			pos += 4;
			if (pos + length > input.length) malformed();
			reserve(length);
			out.set(input.subarray(pos, pos + length), size);
			size += length;
			pos += length;
			continue;
		}
		let litlen: Decoder;
		let dist: Decoder;
		if (type === 1) {
			({ litlen, dist } = fixedTables());
		} else if (type === 2) {
			const hlit = take(5) + 257;
			const hdist = take(5) + 1;
			const hclen = take(4) + 4;
			if (hlit > LITLEN_CODES || hdist > DIST_CODES) malformed();
			const clLengths = new Uint8Array(CODE_LENGTH_CODES);
			for (let i = 0; i < hclen; i += 1) clLengths[CODE_LENGTH_ORDER[i] as number] = take(3);
			const cl = buildDecoder(clLengths, 0, CODE_LENGTH_CODES, true);
			const total = hlit + hdist;
			lengths.fill(0);
			for (let i = 0; i < total;) {
				const symbol = decode(cl);
				if (symbol < 16) {
					lengths[i] = symbol;
					i += 1;
					continue;
				}
				let value = 0;
				let repeat: number;
				if (symbol === 16) {
					if (i === 0) malformed();
					value = lengths[i - 1] as number;
					repeat = 3 + take(2);
				} else if (symbol === 17) {
					repeat = 3 + take(3);
				} else {
					repeat = 11 + take(7);
				}
				if (i + repeat > total) malformed();
				lengths.fill(value, i, i + repeat);
				i += repeat;
			}
			if (lengths[END_OF_BLOCK] === 0) malformed();
			litlen = buildDecoder(lengths, 0, hlit, false);
			dist = buildDecoder(lengths, hlit, hdist, false);
		} else {
			return malformed();
		}

		for (;;) {
			const symbol = decode(litlen);
			if (symbol < 256) {
				reserve(1);
				out[size] = symbol;
				size += 1;
				continue;
			}
			if (symbol === END_OF_BLOCK) break;
			const lc = symbol - 257;
			if (lc >= 29) malformed();
			const length = (LENGTH_BASE[lc] as number) + take(LENGTH_EXTRA[lc] as number);
			const dc = decode(dist);
			if (dc >= 30) malformed();
			const distance = (DIST_BASE[dc] as number) + take(DIST_EXTRA[dc] as number);
			if (distance > size) malformed();
			reserve(length);
			for (let i = 0; i < length; i += 1) {
				out[size] = out[size - distance] as number;
				size += 1;
			}
		}
	}
	return { output: out.slice(0, size), end: pos - (count >>> 3) };
}

/**
 * Decompress a raw DEFLATE stream.
 *
 * Throws `ArchiveMalformedError` on a stream that breaks the format or has
 * bytes after its final block, and `ArchiveTooLargeError` before the output
 * would pass `maxOutput`.
 */
export function inflateRaw(bytes: Uint8Array, options: InflateOptions): Uint8Array {
	const { output, end } = inflate(bytes, 0, options.maxOutput);
	if (end !== bytes.length) malformed();
	return output;
}

/** Decompress a zlib stream, checking its header and its Adler-32. */
export function zlibUnwrap(bytes: Uint8Array, options: InflateOptions): Uint8Array {
	const wrapper = (): never => {
		throw new ArchiveMalformedError('zlib');
	};
	if (bytes.length < 2) wrapper();
	const cmf = bytes[0] as number;
	const flg = bytes[1] as number;
	// Deflate, a window of at most 32 KB, a valid check, and no preset
	// dictionary (this package never writes one, and has none to offer).
	if ((cmf & 0x0f) !== 8 || cmf >>> 4 > 7 || (cmf * 256 + flg) % 31 !== 0 || (flg & 0x20) !== 0) {
		wrapper();
	}
	const { output, end } = inflate(bytes, 2, options.maxOutput);
	if (end + 4 !== bytes.length) wrapper();
	const expected =
		((bytes[end] as number) * 16777216 +
			((bytes[end + 1] as number) << 16) +
			((bytes[end + 2] as number) << 8) +
			(bytes[end + 3] as number)) >>>
		0;
	if (adler32(output) !== expected) wrapper();
	return output;
}
