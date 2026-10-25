/**
 * The PNG decoder.
 *
 * A design file carries its logo as a PNG, and the website lets a person drop
 * one in, so this reads bytes nobody vouched for. It reads the whole format
 * (every colour type, every bit depth, palettes with tRNS, Adam7 interlacing)
 * and refuses everything else with one of two errors: 'image/unreadable' for
 * a file that is damaged or is not a PNG, and 'image/too-large' for one whose
 * header asks for more pixels than the caller allows. Nothing else escapes.
 *
 * It does not use `createImageBitmap` because that is not deterministic
 * (colour management differs by engine) and is not available where this runs
 * in a worker or on a server.
 *
 * Ancillary chunks are skipped unread, apart from tRNS, which is part of the
 * picture. Text chunks in particular are never decoded: a PNG's tEXt can hold
 * anything, and nothing a file says about itself should reach a design.
 *
 * Memory is bounded before it is spent. The header fixes how many bytes the
 * image data must inflate to, and that is the inflater's limit, so a stream
 * built to expand to gigabytes stops at the size its header claims.
 */

import { QrStudioError } from '../core/errors.js';
import { crc32 } from '../core/checksums.js';
import { zlibUnwrap } from '../core/deflate.js';
import type { RgbaImage } from '../core/image.js';
import { PNG_SIGNATURE } from './png.js';

export interface DecodePngOptions {
	/** Refuse an image with more pixels than this. Default 2^26, about 67 million. */
	readonly maxPixels?: number;
}

export const DEFAULT_MAX_PIXELS = 67108864;

/** Why a file was refused. A stage, never anything the file contained. */
export type PngFailure =
	'signature' | 'chunk' | 'crc' | 'header' | 'palette' | 'data' | 'truncated';

function unreadable(reason: PngFailure): QrStudioError {
	return new QrStudioError(
		'image/unreadable',
		'This image is damaged, or is not a PNG this tool can read.',
		{ reason },
	);
}

/** Bit depths each colour type allows, from the specification's table. */
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
	0: [1, 2, 4, 8, 16],
	2: [8, 16],
	3: [1, 2, 4, 8],
	4: [8, 16],
	6: [8, 16],
};

/** Samples per pixel for each colour type. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Adam7: the first column and row of each pass, and the steps between. */
const PASSES: readonly (readonly [number, number, number, number])[] = [
	[0, 0, 8, 8],
	[4, 0, 8, 8],
	[0, 4, 4, 8],
	[2, 0, 4, 4],
	[0, 2, 2, 4],
	[1, 0, 2, 2],
	[0, 1, 1, 2],
];

interface Header {
	readonly width: number;
	readonly height: number;
	readonly depth: number;
	readonly colourType: number;
	readonly interlaced: boolean;
}

interface Sub {
	readonly x0: number;
	readonly y0: number;
	readonly dx: number;
	readonly dy: number;
	readonly width: number;
	readonly height: number;
}

function readUint32(bytes: Uint8Array, at: number): number {
	return (
		(bytes[at] as number) * 16777216 +
		(((bytes[at + 1] as number) << 16) |
			((bytes[at + 2] as number) << 8) |
			(bytes[at + 3] as number))
	);
}

/** The images the data holds: one, or the seven Adam7 passes (some of which may be empty). */
function subImages(header: Header): Sub[] {
	const { width, height } = header;
	if (!header.interlaced) return [{ x0: 0, y0: 0, dx: 1, dy: 1, width, height }];
	return PASSES.map(([x0, y0, dx, dy]) => ({
		x0,
		y0,
		dx,
		dy,
		width: Math.ceil((width - x0) / dx),
		height: Math.ceil((height - y0) / dy),
	}));
}

function paeth(left: number, above: number, aboveLeft: number): number {
	const p = left + above - aboveLeft;
	const dl = Math.abs(p - left);
	const du = Math.abs(p - above);
	const dul = Math.abs(p - aboveLeft);
	return dl <= du && dl <= dul ? left : du <= dul ? above : aboveLeft;
}

/** Undo one row's filter in place, given the unfiltered row above (zeros for the first). */
function unfilter(type: number, row: Uint8Array, previous: Uint8Array, bpp: number): void {
	const n = row.length;
	if (type === 0) return;
	if (type === 1) {
		for (let i = bpp; i < n; i += 1)
			row[i] = ((row[i] as number) + (row[i - bpp] as number)) & 0xff;
		return;
	}
	if (type === 2) {
		for (let i = 0; i < n; i += 1) row[i] = ((row[i] as number) + (previous[i] as number)) & 0xff;
		return;
	}
	if (type === 3) {
		for (let i = 0; i < n; i += 1) {
			const left = i >= bpp ? (row[i - bpp] as number) : 0;
			row[i] = ((row[i] as number) + ((left + (previous[i] as number)) >> 1)) & 0xff;
		}
		return;
	}
	if (type === 4) {
		for (let i = 0; i < n; i += 1) {
			const left = i >= bpp ? (row[i - bpp] as number) : 0;
			const aboveLeft = i >= bpp ? (previous[i - bpp] as number) : 0;
			row[i] = ((row[i] as number) + paeth(left, previous[i] as number, aboveLeft)) & 0xff;
		}
		return;
	}
	throw unreadable('data');
}

/** Sample `index` of a row at `depth` bits a sample, most significant bits first. */
function sample(row: Uint8Array, index: number, depth: number): number {
	if (depth === 8) return row[index] as number;
	if (depth === 16) return ((row[index * 2] as number) << 8) | (row[index * 2 + 1] as number);
	const perByte = 8 / depth;
	const byte = row[Math.floor(index / perByte)] as number;
	const shift = 8 - depth * ((index % perByte) + 1);
	return (byte >> shift) & ((1 << depth) - 1);
}

/** A sample scaled to 8 bits, rounded half up, as pngjs and libpng's simplified API do. */
function toByte(value: number, depth: number): number {
	if (depth === 8) return value;
	return Math.floor((value * 255) / ((1 << depth) - 1) + 0.5);
}

/** Decode a PNG to straight RGBA, 8 bits a channel. */
export function decodePng(bytes: Uint8Array, options: DecodePngOptions = {}): RgbaImage {
	if (!(bytes instanceof Uint8Array)) {
		throw new TypeError('decodePng: bytes is a Uint8Array.');
	}
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('decodePng: options is an object.');
	}
	const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
	if (!Number.isInteger(maxPixels) || maxPixels < 1) {
		throw new TypeError('decodePng: maxPixels is a whole number, 1 or more.');
	}
	return decode(bytes, maxPixels);
}

interface Chunk {
	readonly type: string;
	readonly body: Uint8Array;
	/** Where the next chunk starts. */
	readonly next: number;
}

/** The chunk at `at`, checked for length, type and CRC. */
function readChunk(bytes: Uint8Array, at: number): Chunk {
	if (at + 12 > bytes.length) throw unreadable('truncated');
	const length = readUint32(bytes, at);
	if (length > 0x7fffffff) throw unreadable('chunk');
	if (at + 12 + length > bytes.length) throw unreadable('truncated');
	const type = String.fromCharCode(
		bytes[at + 4] as number,
		bytes[at + 5] as number,
		bytes[at + 6] as number,
		bytes[at + 7] as number,
	);
	if (!/^[A-Za-z]{4}$/.test(type)) throw unreadable('chunk');
	if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== readUint32(bytes, at + 8 + length)) {
		throw unreadable('crc');
	}
	return { type, body: bytes.subarray(at + 8, at + 8 + length), next: at + 12 + length };
}

function decode(bytes: Uint8Array, maxPixels: number): RgbaImage {
	if (bytes.length < 8) throw unreadable('signature');
	for (let i = 0; i < 8; i += 1) {
		if (bytes[i] !== PNG_SIGNATURE[i]) throw unreadable('signature');
	}

	const first = readChunk(bytes, 8);
	if (first.type !== 'IHDR') throw unreadable('header');
	const header = readHeader(first.body);
	if (header.width * header.height > maxPixels) {
		throw new QrStudioError(
			'image/too-large',
			'This image has more pixels than this tool will open.',
			{
				width: header.width,
				height: header.height,
				maxPixels,
			},
		);
	}

	let palette: Uint8Array | null = null;
	let transparency: Uint8Array | null = null;
	const data: Uint8Array[] = [];
	let dataLength = 0;
	let dataEnded = false;
	let at = first.next;
	for (;;) {
		const { type, body, next } = readChunk(bytes, at);
		at = next;
		if (type === 'IEND') break;
		if (type !== 'IDAT' && data.length > 0) dataEnded = true;
		switch (type) {
			case 'IHDR':
				throw unreadable('header');
			case 'PLTE':
				if (palette !== null || data.length > 0) throw unreadable('palette');
				if (body.length === 0 || body.length % 3 !== 0 || body.length > 768) {
					throw unreadable('palette');
				}
				palette = body;
				break;
			case 'tRNS':
				// Ancillary, but part of the picture. One that does not fit its
				// colour type is ignored, as libpng does.
				if (data.length === 0) transparency = body;
				break;
			case 'IDAT':
				if (dataEnded) throw unreadable('data');
				data.push(body);
				dataLength += body.length;
				break;
			default:
				// A critical chunk this reader does not know means a picture it
				// cannot draw correctly; an ancillary one is skipped unread.
				if ((type.charCodeAt(0) & 0x20) === 0) throw unreadable('chunk');
		}
	}
	if (data.length === 0) throw unreadable('data');
	if (header.colourType === 3) {
		if (palette === null || palette.length / 3 > 1 << header.depth) throw unreadable('palette');
	}

	const compressed = new Uint8Array(dataLength);
	let offset = 0;
	for (const piece of data) {
		compressed.set(piece, offset);
		offset += piece.length;
	}

	const channels = CHANNELS[header.colourType] as number;
	const bitsPerPixel = channels * header.depth;
	const bpp = Math.max(1, bitsPerPixel >> 3);
	const subs = subImages(header);
	let expected = 0;
	for (const sub of subs) {
		if (sub.width > 0 && sub.height > 0)
			expected += sub.height * (1 + Math.ceil((sub.width * bitsPerPixel) / 8));
	}
	let raw: Uint8Array;
	try {
		raw = zlibUnwrap(compressed, { maxOutput: expected });
	} catch {
		// Malformed, or longer than the header says, which is the same thing
		// here. The limit is always a valid one, so nothing else is thrown.
		throw unreadable('data');
	}
	if (raw.length !== expected) throw unreadable('data');

	return toRgba(header, raw, subs, bitsPerPixel, bpp, palette, transparency);
}

function readHeader(body: Uint8Array): Header {
	if (body.length !== 13) throw unreadable('header');
	const width = readUint32(body, 0);
	const height = readUint32(body, 4);
	const depth = body[8] as number;
	const colourType = body[9] as number;
	const allowed = DEPTHS[colourType];
	if (
		width < 1 ||
		height < 1 ||
		width > 0x7fffffff ||
		height > 0x7fffffff ||
		allowed === undefined ||
		!allowed.includes(depth) ||
		body[10] !== 0 ||
		body[11] !== 0 ||
		(body[12] !== 0 && body[12] !== 1)
	) {
		throw unreadable('header');
	}
	return { width, height, depth, colourType, interlaced: body[12] === 1 };
}

function toRgba(
	header: Header,
	raw: Uint8Array,
	subs: readonly Sub[],
	bitsPerPixel: number,
	bpp: number,
	palette: Uint8Array | null,
	transparency: Uint8Array | null,
): RgbaImage {
	const { width, height, depth, colourType } = header;
	const out = new Uint8ClampedArray(width * height * 4);
	const entries = palette === null ? 0 : palette.length / 3;
	// The transparent key for greyscale and RGB, at the file's own precision.
	// A pixel that matches it is left as four zeros, the one spelling of
	// nothing the rasteriser uses too (and what pngjs and a canvas give).
	const key =
		transparency !== null && colourType === 0 && transparency.length === 2
			? [((transparency[0] as number) << 8) | (transparency[1] as number)]
			: transparency !== null && colourType === 2 && transparency.length === 6
				? [0, 2, 4].map(
						(i) => (((transparency[i] as number) << 8) | (transparency[i + 1] as number)) >>> 0,
					)
				: null;
	const paletteAlpha = (index: number): number =>
		colourType === 3 &&
		transparency !== null &&
		index < transparency.length &&
		transparency.length <= entries
			? (transparency[index] as number)
			: 255;

	let at = 0;
	for (const sub of subs) {
		if (sub.width === 0 || sub.height === 0) continue;
		const stride = Math.ceil((sub.width * bitsPerPixel) / 8);
		let previous: Uint8Array = new Uint8Array(stride);
		for (let y = 0; y < sub.height; y += 1) {
			const filter = raw[at] as number;
			const row = raw.subarray(at + 1, at + 1 + stride);
			unfilter(filter, row, previous, bpp);
			previous = row;
			at += 1 + stride;
			const oy = sub.y0 + y * sub.dy;
			for (let x = 0; x < sub.width; x += 1) {
				const o = (oy * width + sub.x0 + x * sub.dx) * 4;
				if (colourType === 3) {
					const index = sample(row, x, depth);
					if (index >= entries) throw unreadable('palette');
					const p = palette as Uint8Array;
					out[o] = p[index * 3] as number;
					out[o + 1] = p[index * 3 + 1] as number;
					out[o + 2] = p[index * 3 + 2] as number;
					out[o + 3] = paletteAlpha(index);
				} else if (colourType === 0 || colourType === 4) {
					const grey = sample(row, x * (colourType === 4 ? 2 : 1), depth);
					if (colourType === 0 && key !== null && key[0] === grey) continue;
					const value = toByte(grey, depth);
					out[o] = value;
					out[o + 1] = value;
					out[o + 2] = value;
					out[o + 3] = colourType === 4 ? toByte(sample(row, x * 2 + 1, depth), depth) : 255;
				} else {
					const n = colourType === 6 ? 4 : 3;
					const r = sample(row, x * n, depth);
					const g = sample(row, x * n + 1, depth);
					const b = sample(row, x * n + 2, depth);
					if (colourType === 2 && key !== null && key[0] === r && key[1] === g && key[2] === b) {
						continue;
					}
					out[o] = toByte(r, depth);
					out[o + 1] = toByte(g, depth);
					out[o + 2] = toByte(b, depth);
					out[o + 3] = colourType === 6 ? toByte(sample(row, x * 4 + 3, depth), depth) : 255;
				}
			}
		}
	}
	return { width, height, data: out };
}
