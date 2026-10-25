/**
 * The PNG encoder.
 *
 * A canvas can write PNG, but each engine compresses with its own zlib and
 * picks its own filters, so the same picture comes out as different bytes in
 * Chromium, Safari and Firefox, and the export's checksum would say nothing.
 * This writes the same bytes everywhere: the colour type and every filter are
 * chosen by fixed rules, and compression is core's deterministic deflate.
 *
 * The colour type is the smallest exact one for the pixels, chosen without
 * trying several and keeping the shortest (which would double the work on a
 * large export for a few bytes):
 *
 * - opaque and grey: greyscale, at the fewest bits that hold every value
 *   exactly (a black and white code is one bit a pixel);
 * - 256 colours or fewer: a palette, with tRNS when any are translucent;
 * - grey with translucency: greyscale with alpha;
 * - opaque: RGB;
 * - otherwise RGBA.
 *
 * The chunk layout, the filter heuristic and the palette ordering follow the
 * encoder in Hex Pro's private-image-converter (src/codecs/png/encode.ts and
 * src/raster/quantise.ts), made synchronous here because core's deflate is.
 */

import { crc32 } from '../core/checksums.js';
import { zlibWrap } from '../core/deflate.js';
import type { RgbaImage } from '../core/image.js';
import { checkImage } from './scene.js';

export interface PngOptions {
	/** Pixels per inch, written as a pHYs chunk so a print workflow places the image at its size. */
	readonly dpi?: number;
	/** Deflate effort: 0 stores, 1 is fastest, 6 is the default, 9 tries hardest. */
	readonly level?: 0 | 1 | 6 | 9;
}

export const PNG_SIGNATURE: Uint8Array = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** IDAT is split into chunks of at most this many bytes, as most encoders do. */
const IDAT_CHUNK = 1 << 20;

/** A chunk: length, type, data, and the CRC of type and data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(data.length + 12);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
	return out;
}

function concat(pieces: readonly Uint8Array[]): Uint8Array {
	let total = 0;
	for (const piece of pieces) total += piece.length;
	const out = new Uint8Array(total);
	let at = 0;
	for (const piece of pieces) {
		out.set(piece, at);
		at += piece.length;
	}
	return out;
}

/**
 * Up to 257 distinct RGBA colours, in order of first appearance.
 *
 * Open addressing over packed colours: this runs once per pixel on a picture
 * that can be 64 million pixels, where a `Map` lookup is the difference
 * between a moment and a pause. It stops counting at 257, which is enough to
 * know a palette will not do.
 */
class Colours {
	private readonly keys = new Uint32Array(1024);
	private readonly used = new Uint8Array(1024);
	private readonly indices = new Int32Array(1024);
	readonly found: number[] = [];

	/** The colour's index, adding it if there is room; -1 once more than 256 have been seen. */
	index(key: number): number {
		let at = Math.imul(key, 0x9e3779b1) >>> 22;
		while (this.used[at] === 1) {
			if (this.keys[at] === key) return this.indices[at] as number;
			at = (at + 1) & 1023;
		}
		if (this.found.length > 256) return -1;
		this.used[at] = 1;
		this.keys[at] = key;
		this.indices[at] = this.found.length;
		this.found.push(key);
		return this.found.length - 1;
	}
}

interface Analysis {
	readonly opaque: boolean;
	readonly grey: boolean;
	/** Bits a grey sample needs to hold every value exactly: 1, 2, 4 or 8. */
	readonly greyBits: number;
	/** Distinct colours in first-appearance order, or null past 256. */
	readonly palette: readonly number[] | null;
	readonly colours: Colours;
}

function analyse(image: RgbaImage): Analysis {
	const { data } = image;
	const colours = new Colours();
	let opaque = true;
	let grey = true;
	let fits1 = true;
	let fits2 = true;
	let fits4 = true;
	let many = false;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] as number;
		const g = data[i + 1] as number;
		const b = data[i + 2] as number;
		const a = data[i + 3] as number;
		if (a !== 255) opaque = false;
		if (r !== g || g !== b) grey = false;
		else {
			if (r % 17 !== 0) fits4 = false;
			if (r % 85 !== 0) fits2 = false;
			if (r !== 0 && r !== 255) fits1 = false;
		}
		if (!many && colours.index(((r << 24) | (g << 16) | (b << 8) | a) >>> 0) < 0) many = true;
	}
	const greyBits = fits1 ? 1 : fits2 ? 2 : fits4 ? 4 : 8;
	return { opaque, grey, greyBits, palette: many ? null : colours.found, colours };
}

function bitsFor(entries: number): number {
	if (entries <= 2) return 1;
	if (entries <= 4) return 2;
	if (entries <= 16) return 4;
	return 8;
}

/**
 * The absolute value of a byte read as a signed one, for all 256.
 *
 * The filter heuristic sums these over a row, once per candidate filter.
 */
const SIGNED_MAGNITUDE = Uint8Array.from({ length: 256 }, (_, byte) =>
	byte < 128 ? byte : 256 - byte,
);

function paeth(left: number, above: number, aboveLeft: number): number {
	const p = left + above - aboveLeft;
	const dl = Math.abs(p - left);
	const du = Math.abs(p - above);
	const dul = Math.abs(p - aboveLeft);
	return dl <= du && dl <= dul ? left : du <= dul ? above : aboveLeft;
}

/**
 * Filter one scanline five ways and keep the cheapest, by the specification's
 * own heuristic: the smallest sum of the filtered bytes read as signed.
 *
 * Ties go to the lower filter number, which the strictly-less comparisons
 * give when taken in order; that is part of what makes the bytes fixed.
 * `previous` is the row above, zeros for the first row as the specification
 * says.
 */
function filterRow(
	row: Uint8Array,
	previous: Uint8Array,
	bpp: number,
	out: Uint8Array,
	at: number,
): void {
	const width = row.length;
	const scores = [0, 0, 0, 0, 0];
	for (let i = 0; i < width; i += 1) {
		const raw = row[i] as number;
		const left = i >= bpp ? (row[i - bpp] as number) : 0;
		const above = previous[i] as number;
		const aboveLeft = i >= bpp ? (previous[i - bpp] as number) : 0;
		scores[0] = (scores[0] as number) + (SIGNED_MAGNITUDE[raw] as number);
		scores[1] = (scores[1] as number) + (SIGNED_MAGNITUDE[(raw - left) & 0xff] as number);
		scores[2] = (scores[2] as number) + (SIGNED_MAGNITUDE[(raw - above) & 0xff] as number);
		scores[3] =
			(scores[3] as number) + (SIGNED_MAGNITUDE[(raw - ((left + above) >> 1)) & 0xff] as number);
		scores[4] =
			(scores[4] as number) +
			(SIGNED_MAGNITUDE[(raw - paeth(left, above, aboveLeft)) & 0xff] as number);
	}
	let best = 0;
	for (let f = 1; f < 5; f += 1) if ((scores[f] as number) < (scores[best] as number)) best = f;
	out[at] = best;
	for (let i = 0; i < width; i += 1) {
		const raw = row[i] as number;
		const left = i >= bpp ? (row[i - bpp] as number) : 0;
		const above = previous[i] as number;
		const aboveLeft = i >= bpp ? (previous[i - bpp] as number) : 0;
		let predicted = 0;
		if (best === 1) predicted = left;
		else if (best === 2) predicted = above;
		else if (best === 3) predicted = (left + above) >> 1;
		else if (best === 4) predicted = paeth(left, above, aboveLeft);
		out[at + 1 + i] = (raw - predicted) & 0xff;
	}
}

interface Layout {
	readonly colourType: number;
	readonly bitDepth: number;
	/** Bytes per complete pixel, at least one, for the filters. */
	readonly bpp: number;
	/** Whether to filter adaptively; packed and indexed rows are written unfiltered. */
	readonly adaptive: boolean;
	readonly fill: (y: number, row: Uint8Array) => void;
	readonly extra: readonly Uint8Array[];
	readonly stride: number;
}

function layout(image: RgbaImage, analysis: Analysis): Layout {
	const { width, data } = image;
	const pack =
		(bits: number, value: (x: number, y: number) => number) => (y: number, row: Uint8Array) => {
			if (bits === 8) {
				for (let x = 0; x < width; x += 1) row[x] = value(x, y);
				return;
			}
			row.fill(0);
			const perByte = 8 / bits;
			for (let x = 0; x < width; x += 1) {
				const byte = Math.floor(x / perByte);
				row[byte] = (row[byte] as number) | (value(x, y) << (8 - bits * ((x % perByte) + 1)));
			}
		};

	if (analysis.opaque && analysis.grey) {
		const bits = analysis.greyBits;
		const scale = 255 / ((1 << bits) - 1);
		return {
			colourType: 0,
			bitDepth: bits,
			bpp: 1,
			adaptive: bits === 8,
			fill: pack(bits, (x, y) => (data[(y * width + x) * 4] as number) / scale),
			extra: [],
			stride: Math.ceil((width * bits) / 8),
		};
	}

	if (analysis.palette !== null) {
		// Translucent entries first, so tRNS (which runs from entry zero and
		// stops wherever it likes, opaque after) is only as long as it must be.
		const palette = analysis.palette;
		const alphaOf = (i: number): number => (palette[i] as number) & 0xff;
		const order = palette.map((_, i) => i);
		const translucent = order.filter((i) => alphaOf(i) !== 255);
		const opaque = order.filter((i) => alphaOf(i) === 255);
		const sorted = [...translucent, ...opaque];
		const renumber = new Uint8Array(sorted.length);
		sorted.forEach((original, index) => {
			renumber[original] = index;
		});
		const plte = new Uint8Array(sorted.length * 3);
		const trns = new Uint8Array(translucent.length);
		sorted.forEach((original, index) => {
			const key = palette[original] as number;
			plte[index * 3] = key >>> 24;
			plte[index * 3 + 1] = (key >>> 16) & 0xff;
			plte[index * 3 + 2] = (key >>> 8) & 0xff;
			if (index < trns.length) trns[index] = key & 0xff;
		});
		const bits = bitsFor(sorted.length);
		const colours = analysis.colours;
		const extra = [pngChunk('PLTE', plte)];
		if (trns.length > 0) extra.push(pngChunk('tRNS', trns));
		return {
			colourType: 3,
			bitDepth: bits,
			bpp: 1,
			adaptive: false,
			fill: pack(bits, (x, y) => {
				const at = (y * width + x) * 4;
				const key =
					(((data[at] as number) << 24) |
						((data[at + 1] as number) << 16) |
						((data[at + 2] as number) << 8) |
						(data[at + 3] as number)) >>>
					0;
				return renumber[colours.index(key)] as number;
			}),
			extra,
			stride: Math.ceil((width * bits) / 8),
		};
	}

	const channels = analysis.grey ? 2 : analysis.opaque ? 3 : 4;
	const colourType = analysis.grey ? 4 : analysis.opaque ? 2 : 6;
	return {
		colourType,
		bitDepth: 8,
		bpp: channels,
		adaptive: true,
		fill: (y, row) => {
			for (let x = 0; x < width; x += 1) {
				const at = (y * width + x) * 4;
				if (channels === 2) {
					row[x * 2] = data[at] as number;
					row[x * 2 + 1] = data[at + 3] as number;
				} else {
					row[x * channels] = data[at] as number;
					row[x * channels + 1] = data[at + 1] as number;
					row[x * channels + 2] = data[at + 2] as number;
					if (channels === 4) row[x * 4 + 3] = data[at + 3] as number;
				}
			}
		},
		extra: [],
		stride: width * channels,
	};
}

/** Encode an RGBA image as PNG, the same bytes in every engine. */
export function encodePng(image: RgbaImage, options: PngOptions = {}): Uint8Array {
	checkImage(image, 'encodePng');
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('encodePng: options is an object.');
	}
	const { dpi, level } = options;
	if (level !== undefined && level !== 0 && level !== 1 && level !== 6 && level !== 9) {
		throw new TypeError('encodePng: level is 0, 1, 6 or 9.');
	}
	let perMetre = -1;
	if (dpi !== undefined) {
		// Pixels per metre, rounded, as pHYs stores it: 300 dpi is 11811.
		perMetre = typeof dpi === 'number' ? Math.round((dpi * 10000) / 254) : Number.NaN;
		if (!(perMetre >= 1 && perMetre <= 0x7fffffff)) {
			throw new TypeError('encodePng: dpi is a positive number of pixels per inch.');
		}
	}

	const { width, height } = image;
	const plan = layout(image, analyse(image));
	const rowBytes = plan.stride + 1;
	const raw = new Uint8Array(rowBytes * height);
	let row = new Uint8Array(plan.stride);
	let previous = new Uint8Array(plan.stride);
	for (let y = 0; y < height; y += 1) {
		plan.fill(y, row);
		if (plan.adaptive) {
			filterRow(row, previous, plan.bpp, raw, y * rowBytes);
			const spent = previous;
			previous = row;
			row = spent;
		} else {
			// Filter byte zero, already there.
			raw.set(row, y * rowBytes + 1);
		}
	}

	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = plan.bitDepth;
	header[9] = plan.colourType;
	// Compression, filter method and interlace each have one value here.
	const pieces: Uint8Array[] = [PNG_SIGNATURE, pngChunk('IHDR', header)];
	if (perMetre > 0) {
		const phys = new Uint8Array(9);
		const physView = new DataView(phys.buffer);
		physView.setUint32(0, perMetre);
		physView.setUint32(4, perMetre);
		phys[8] = 1;
		pieces.push(pngChunk('pHYs', phys));
	}
	pieces.push(...plan.extra);
	const compressed = zlibWrap(raw, level === undefined ? {} : { level });
	for (let at = 0; at < compressed.length; at += IDAT_CHUNK) {
		pieces.push(
			pngChunk('IDAT', compressed.subarray(at, Math.min(at + IDAT_CHUNK, compressed.length))),
		);
	}
	pieces.push(pngChunk('IEND', new Uint8Array(0)));
	return concat(pieces);
}
