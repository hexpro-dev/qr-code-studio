/**
 * A deliberately plain PNG writer for the decoder's tests, sharing nothing
 * with `src/render/png.ts`.
 *
 * pngjs, the oracle, can decode every PNG but can only write a few kinds (no
 * palettes, no bit depths under 8, no interlacing), so this writes whatever a
 * test asks for: any colour type and bit depth, a palette, tRNS, Adam7, a
 * chosen filter on every row, extra chunks, and IDAT split anywhere. It
 * compresses with node:zlib and computes CRCs from its own table.
 */

import { deflateSync } from 'node:zlib';

export interface PngSpec {
	readonly width: number;
	readonly height: number;
	readonly depth: number;
	readonly colourType: number;
	readonly interlaced?: boolean;
	/** The raw samples of a pixel, at the file's own depth. */
	readonly samples: (x: number, y: number) => readonly number[];
	readonly palette?: readonly (readonly [number, number, number])[];
	readonly trns?: readonly number[];
	/** The filter for each row, by its index over all passes. Default cycles through all five. */
	readonly filter?: (row: number) => number;
	/** Chunks to put after IHDR, as [type, data]. */
	readonly extra?: readonly (readonly [string, Uint8Array])[];
	/** Bytes per IDAT chunk. Default all in one. */
	readonly split?: number;
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

export function crc(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of bytes) c = (TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
	return out;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PASSES = [
	[0, 0, 8, 8],
	[4, 0, 8, 8],
	[0, 4, 4, 8],
	[2, 0, 4, 4],
	[0, 2, 2, 4],
	[1, 0, 2, 2],
	[0, 1, 1, 2],
] as const;

function predictor(type: number, left: number, above: number, aboveLeft: number): number {
	if (type === 1) return left;
	if (type === 2) return above;
	if (type === 3) return (left + above) >> 1;
	if (type === 4) {
		const p = left + above - aboveLeft;
		const pa = Math.abs(p - left);
		const pb = Math.abs(p - above);
		const pc = Math.abs(p - aboveLeft);
		return pa <= pb && pa <= pc ? left : pb <= pc ? above : aboveLeft;
	}
	return 0;
}

/** The raw, filtered scanlines of the image, before compression. */
export function scanlines(spec: PngSpec): Uint8Array {
	const channels = CHANNELS[spec.colourType] as number;
	const bits = channels * spec.depth;
	const bpp = Math.max(1, bits >> 3);
	const passes = spec.interlaced ? PASSES : ([[0, 0, 1, 1]] as const);
	const out: number[] = [];
	let rowIndex = 0;
	for (const [x0, y0, dx, dy] of passes) {
		const w = Math.ceil((spec.width - x0) / dx);
		const h = Math.ceil((spec.height - y0) / dy);
		if (w <= 0 || h <= 0) continue;
		const stride = Math.ceil((w * bits) / 8);
		let previous = new Uint8Array(stride);
		for (let y = 0; y < h; y += 1) {
			const row = new Uint8Array(stride);
			let bit = 0;
			for (let x = 0; x < w; x += 1) {
				for (const value of spec.samples(x0 + x * dx, y0 + y * dy)) {
					if (spec.depth === 16) {
						row[bit >> 3] = value >> 8;
						row[(bit >> 3) + 1] = value & 0xff;
					} else {
						row[bit >> 3] = (row[bit >> 3] as number) | (value << (8 - spec.depth - (bit & 7)));
					}
					bit += spec.depth;
				}
			}
			const filter = spec.filter ? spec.filter(rowIndex) : rowIndex % 5;
			out.push(filter);
			for (let i = 0; i < stride; i += 1) {
				const left = i >= bpp ? (row[i - bpp] as number) : 0;
				const aboveLeft = i >= bpp ? (previous[i - bpp] as number) : 0;
				out.push(
					((row[i] as number) - predictor(filter, left, previous[i] as number, aboveLeft)) & 0xff,
				);
			}
			previous = row;
			rowIndex += 1;
		}
	}
	return Uint8Array.from(out);
}

export function writePng(spec: PngSpec): Uint8Array {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, spec.width);
	view.setUint32(4, spec.height);
	header[8] = spec.depth;
	header[9] = spec.colourType;
	header[12] = spec.interlaced ? 1 : 0;
	const pieces: Uint8Array[] = [
		Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
	];
	for (const [type, data] of spec.extra ?? []) pieces.push(chunk(type, data));
	if (spec.palette) pieces.push(chunk('PLTE', Uint8Array.from(spec.palette.flat())));
	if (spec.trns) pieces.push(chunk('tRNS', Uint8Array.from(spec.trns)));
	const compressed = new Uint8Array(deflateSync(scanlines(spec)));
	const split = spec.split ?? compressed.length;
	for (let at = 0; at < compressed.length; at += split) {
		pieces.push(chunk('IDAT', compressed.subarray(at, at + split)));
	}
	pieces.push(chunk('IEND', new Uint8Array(0)));
	const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const piece of pieces) {
		out.set(piece, at);
		at += piece.length;
	}
	return out;
}
