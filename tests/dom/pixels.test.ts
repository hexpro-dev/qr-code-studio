/**
 * The pure pixel work in the dom layer: area averaging, which decides a
 * logo's pixels, and the Exif orientation a phone photograph carries.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../src/core/image.js';
import { areaAverage, fitWithin } from '../../src/dom/resample.js';
import { applyOrientation, jpegFacts, swapsSides } from '../../src/dom/orientation.js';

function image(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
	}
	return { width, height, data };
}

/** The same average, written the slow and obvious way: every source pixel's share of every target pixel. */
function bruteForce(source: RgbaImage, width: number, height: number): number[] {
	const out: number[] = [];
	const sx = source.width / width;
	const sy = source.height / height;
	for (let ty = 0; ty < height; ty += 1) {
		for (let tx = 0; tx < width; tx += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let y = 0; y < source.height; y += 1) {
				const oy = Math.max(0, Math.min(y + 1, (ty + 1) * sy) - Math.max(y, ty * sy));
				if (oy === 0) continue;
				for (let x = 0; x < source.width; x += 1) {
					const ox = Math.max(0, Math.min(x + 1, (tx + 1) * sx) - Math.max(x, tx * sx));
					if (ox === 0) continue;
					const w = (ox * oy) / (sx * sy);
					const at = (y * source.width + x) * 4;
					const alpha = (source.data[at + 3] as number) * w;
					r += (source.data[at] as number) * alpha;
					g += (source.data[at + 1] as number) * alpha;
					b += (source.data[at + 2] as number) * alpha;
					a += alpha;
				}
			}
			out.push(
				a > 0 ? Math.round(r / a) : 0,
				a > 0 ? Math.round(g / a) : 0,
				a > 0 ? Math.round(b / a) : 0,
				Math.round(a),
			);
		}
	}
	return out;
}

describe('area averaging', () => {
	it('matches the slow average over every source pixel', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 12 }),
				fc.integer({ min: 1, max: 12 }),
				fc.integer({ min: 0, max: 2 ** 31 }),
				(width, height, seed) => {
					let state = seed;
					const next = (): number => (state = (state * 1103515245 + 12345) % 2 ** 31) % 256;
					const source = image(width, height, () => [next(), next(), next(), next()]);
					const tw = 1 + (seed % width);
					const th = 1 + (seed % height);
					const out = areaAverage(source, tw, th);
					const expected = bruteForce(source, tw, th);
					for (let i = 0; i < expected.length; i += 4) {
						const alpha = expected[i + 3] as number;
						expect(Math.abs((out.data[i + 3] as number) - alpha)).toBeLessThanOrEqual(1);
						// The colour of a pixel nobody can see is anything.
						if (alpha === 0) continue;
						for (let c = 0; c < 3; c += 1) {
							expect(
								Math.abs((out.data[i + c] as number) - (expected[i + c] as number)),
							).toBeLessThanOrEqual(1);
						}
					}
				},
			),
			{ numRuns: 200, seed: 3 },
		);
	});

	it('averages colour by alpha, so a transparent pixel adds no fringe', () => {
		const source = image(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
		const out = areaAverage(source, 1, 1);
		expect(Array.from(out.data)).toEqual([255, 0, 0, 128]);
		const clear = areaAverage(
			image(2, 2, () => [9, 9, 9, 0]),
			1,
			1,
		);
		expect(Array.from(clear.data)).toEqual([0, 0, 0, 0]);
	});

	it('hands back the image itself at its own size, and refuses enlarging', () => {
		const source = image(3, 3, () => [1, 2, 3, 4]);
		expect(areaAverage(source, 3, 3)).toBe(source);
		expect(() => areaAverage(source, 4, 3)).toThrow(TypeError);
		expect(() => areaAverage(source, 0, 3)).toThrow(TypeError);
		expect(() => areaAverage(source, 1.5, 1)).toThrow(TypeError);
	});

	it('fits a size within a longest side, never enlarging', () => {
		expect(fitWithin(4000, 3000, 1024)).toEqual([1024, 768]);
		expect(fitWithin(300, 4000, 1024)).toEqual([77, 1024]);
		expect(fitWithin(10, 5000, 1024)).toEqual([2, 1024]);
		expect(fitWithin(1, 100000, 10)).toEqual([1, 10]);
		expect(fitWithin(800, 600, 1024)).toEqual([800, 600]);
	});
});

/** A minimal JPEG head: SOI, optionally APP1 Exif with an orientation, then SOF0 with a size. */
function jpeg(options: {
	orientation?: number;
	width: number;
	height: number;
	little?: boolean;
	extra?: number[];
}): Uint8Array {
	const bytes: number[] = [0xff, 0xd8];
	if (options.extra) bytes.push(...options.extra);
	if (options.orientation !== undefined) {
		const little = options.little ?? false;
		const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
		const u32 = (v: number) =>
			little
				? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]
				: [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
		const tiff = [
			...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
			...u16(42),
			...u32(8),
			...u16(2),
			// An unrelated tag first, then Orientation.
			...u16(0x010f),
			...u16(2),
			...u32(4),
			...u32(0),
			...u16(0x0112),
			...u16(3),
			...u32(1),
			...u16(options.orientation),
			0,
			0,
			...u32(0),
		];
		const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
		bytes.push(0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body);
	}
	// A comment segment, skipped.
	bytes.push(0xff, 0xfe, 0, 4, 0x41, 0x42);
	bytes.push(
		0xff,
		0xc0,
		0,
		17,
		8,
		options.height >> 8,
		options.height & 0xff,
		options.width >> 8,
		options.width & 0xff,
		3,
	);
	bytes.push(...new Array(9).fill(0));
	return new Uint8Array(bytes);
}

describe('Exif orientation', () => {
	it('reads the orientation and the stored size, in either byte order', () => {
		expect(jpegFacts(jpeg({ orientation: 6, width: 400, height: 300 }))).toEqual({
			orientation: 6,
			width: 400,
			height: 300,
		});
		expect(jpegFacts(jpeg({ orientation: 3, width: 40, height: 30, little: true }))).toEqual({
			orientation: 3,
			width: 40,
			height: 30,
		});
		expect(jpegFacts(jpeg({ width: 8, height: 9 }))).toEqual({
			orientation: 1,
			width: 8,
			height: 9,
		});
		// Fill bytes before a marker are allowed.
		expect(jpegFacts(jpeg({ width: 8, height: 9, extra: [0xff] }))?.width).toBe(8);
	});

	it('treats anything it cannot read as not a JPEG, or as upright', () => {
		expect(jpegFacts(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
		expect(jpegFacts(new Uint8Array([0xff, 0xd8]))).toBeNull();
		expect(jpegFacts(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 0]))).toBeNull();
		expect(jpegFacts(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0]))).toBeNull();
		expect(jpegFacts(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]))).toBeNull();
		// A frame header cut short.
		expect(jpegFacts(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]))).toBeNull();
		// An orientation out of range, a TIFF block that is not one, an IFD past the end.
		const bad = jpeg({ orientation: 9, width: 2, height: 2 });
		expect(jpegFacts(bad)?.orientation).toBe(1);
		const notTiff = jpeg({ orientation: 6, width: 2, height: 2 });
		notTiff[12] = 0x58;
		expect(jpegFacts(notTiff)?.orientation).toBe(1);
		const wrongMagic = jpeg({ orientation: 6, width: 2, height: 2 });
		wrongMagic[15] = 41;
		expect(jpegFacts(wrongMagic)?.orientation).toBe(1);
		const farIfd = jpeg({ orientation: 6, width: 2, height: 2 });
		farIfd[19] = 200;
		expect(jpegFacts(farIfd)?.orientation).toBe(1);
		const manyEntries = jpeg({ orientation: 6, width: 2, height: 2 });
		manyEntries[21] = 40;
		expect(jpegFacts(manyEntries)?.orientation).toBe(6);
		const short = jpeg({ orientation: 6, width: 2, height: 2 });
		short[5] = 7;
		expect(jpegFacts(short.slice(0, 13))).toBeNull();
		// An Exif-looking segment whose name is not Exif.
		const other = jpeg({ orientation: 6, width: 2, height: 2 });
		other[6] = 0x46;
		expect(jpegFacts(other)?.orientation).toBe(1);
		// A tag list with no orientation in it, and one that claims more tags than it holds.
		const none = jpeg({ orientation: 6, width: 2, height: 2 });
		none[35] = 0x13;
		expect(jpegFacts(none)?.orientation).toBe(1);
		none[21] = 40;
		expect(jpegFacts(none)?.orientation).toBe(1);
	});

	it('turns and flips each of the eight ways', () => {
		// 3 by 2, each pixel numbered in its red channel.
		const source = image(3, 2, (x, y) => [y * 3 + x, 0, 0, 255]);
		const red = (out: RgbaImage): number[][] => {
			const rows: number[][] = [];
			for (let y = 0; y < out.height; y += 1) {
				const row: number[] = [];
				for (let x = 0; x < out.width; x += 1)
					row.push(out.data[(y * out.width + x) * 4] as number);
				rows.push(row);
			}
			return rows;
		};
		expect(red(applyOrientation(source, 1))).toEqual([
			[0, 1, 2],
			[3, 4, 5],
		]);
		expect(applyOrientation(source, 1)).toBe(source);
		expect(applyOrientation(source, 9)).toBe(source);
		expect(red(applyOrientation(source, 2))).toEqual([
			[2, 1, 0],
			[5, 4, 3],
		]);
		expect(red(applyOrientation(source, 3))).toEqual([
			[5, 4, 3],
			[2, 1, 0],
		]);
		expect(red(applyOrientation(source, 4))).toEqual([
			[3, 4, 5],
			[0, 1, 2],
		]);
		expect(red(applyOrientation(source, 5))).toEqual([
			[0, 3],
			[1, 4],
			[2, 5],
		]);
		expect(red(applyOrientation(source, 6))).toEqual([
			[3, 0],
			[4, 1],
			[5, 2],
		]);
		expect(red(applyOrientation(source, 7))).toEqual([
			[5, 2],
			[4, 1],
			[3, 0],
		]);
		expect(red(applyOrientation(source, 8))).toEqual([
			[2, 5],
			[1, 4],
			[0, 3],
		]);
		expect([1, 2, 3, 4, 5, 6, 7, 8].filter(swapsSides)).toEqual([5, 6, 7, 8]);
	});
});
